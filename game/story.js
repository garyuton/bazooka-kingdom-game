"use strict";

/**
 * バズーカ王国物語 ノベルゲームエンジン v0.2
 *
 * 表示処理、音声処理、シナリオデータを分離しています。
 * JSONに bgm / se / choices を追加しても既存の表示処理を崩さず拡張できます。
 */

const CONFIG = {
  scenarioUrl: "story.json",
  typeInterval: 38,
  transitionDuration: 420,
};

const elements = {
  game: document.querySelector("#novel-game"),
  background: document.querySelector("#background-layer"),
  backgroundPlaceholder: document.querySelector("#background-placeholder"),
  fader: document.querySelector("#scene-fader"),
  advance: document.querySelector("#advance-layer"),
  speaker: document.querySelector("#speaker-name"),
  dialogue: document.querySelector("#dialogue-text"),
  error: document.querySelector("#error-message"),
  back: document.querySelector("#back-button"),
  characterPlaceholder: document.querySelector("#character-placeholder"),
  characterPlaceholderName: document.querySelector("#character-placeholder-name"),
  characters: {
    left: document.querySelector("#character-left"),
    center: document.querySelector("#character-center"),
    right: document.querySelector("#character-right"),
  },
};

let backgroundRequestId = 0;

const state = {
  scenario: null,
  sceneIndex: 0,
  isTyping: false,
  isTransitioning: false,
  interactionId: 0,
  handledInteractionId: -1,
  typingTimer: null,
  autoAdvanceTimer: null,
  fullText: "",
};

/** BGMとSEを管理する小さな窓口。JSONにパスを指定すると再生できます。 */
const audioManager = {
  bgm: new Audio(),

  playBgm(source) {
    if (!source || this.bgm.dataset.source === source) return;
    this.bgm.pause();
    this.bgm = new Audio(source);
    this.bgm.dataset.source = source;
    this.bgm.loop = true;
    this.bgm.volume = 0.55;
    this.bgm.play().catch(() => {
      // 自動再生制限時は、次のユーザー操作まで再生を保留します。
    });
  },

  playSe(source) {
    if (!source) return;
    const se = new Audio(source);
    se.volume = 0.8;
    se.play().catch(() => {});
  },
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function clearAutoAdvance() {
  clearTimeout(state.autoAdvanceTimer);
  state.autoAdvanceTimer = null;
}

/** 全文表示後、JSONで指定された時間だけ待って次のシーンへ進みます。 */
function scheduleAutoAdvance() {
  clearAutoAdvance();
  const scene = state.scenario?.scenes[state.sceneIndex];
  if (!scene?.autoAdvanceMs) return;

  state.autoAdvanceTimer = setTimeout(() => {
    if (!state.isTyping && !state.isTransitioning) advanceStory();
  }, scene.autoAdvanceMs);
}

function setBackground(source) {
  const requestId = ++backgroundRequestId;
  elements.backgroundPlaceholder.classList.remove("is-hidden");

  if (!source) {
    elements.background.style.backgroundImage = "none";
    return;
  }

  const image = new Image();
  image.addEventListener("load", () => {
    if (requestId !== backgroundRequestId) return;
    elements.background.style.backgroundImage = `url("${source}")`;
    elements.backgroundPlaceholder.classList.add("is-hidden");
  });
  image.addEventListener("error", () => {
    if (requestId !== backgroundRequestId) return;
    elements.background.style.backgroundImage = "none";
    elements.backgroundPlaceholder.classList.remove("is-hidden");
  });
  image.src = source;
}

/** left / center / right の3枠へ立ち絵を配置します。 */
function setCharacters(characters = []) {
  const centerCharacter = characters.find((item) => item.position === "center");
  elements.characterPlaceholderName.textContent = centerCharacter?.name || "";
  elements.characterPlaceholder.classList.toggle("is-visible", Boolean(centerCharacter));

  for (const [position, image] of Object.entries(elements.characters)) {
    const character = characters.find((item) => item.position === position);
    image.classList.toggle("is-visible", Boolean(character?.src));

    if (character?.src) {
      image.src = character.src;
      image.alt = character.name || "";
    } else {
      image.removeAttribute("src");
      image.alt = "";
    }
  }
}

function finishTyping() {
  clearTimeout(state.typingTimer);
  state.isTyping = false;
  elements.dialogue.textContent = state.fullText;
  elements.advance.dataset.state = "ready";
  scheduleAutoAdvance();
}

/** Unicode文字を1文字ずつ表示し、タイプライター演出を行います。 */
function typeDialogue(text) {
  clearTimeout(state.typingTimer);
  clearAutoAdvance();
  state.fullText = text;
  state.isTyping = true;
  elements.advance.dataset.state = "typing";
  elements.dialogue.textContent = "";

  const characters = Array.from(text);
  let cursor = 0;

  const typeNext = () => {
    if (!state.isTyping) return;
    elements.dialogue.textContent += characters[cursor] ?? "";
    cursor += 1;

    if (cursor >= characters.length) {
      finishTyping();
      return;
    }

    state.typingTimer = setTimeout(typeNext, CONFIG.typeInterval);
  };

  typeNext();
}

/** フェードアウト中に次のシーンの素材と文章を差し替えます。 */
async function renderScene(index, useTransition = true) {
  const scene = state.scenario.scenes[index];
  if (!scene) return;

  state.isTransitioning = true;
  clearTimeout(state.typingTimer);
  clearAutoAdvance();

  if (useTransition) {
    elements.fader.classList.add("is-dark");
    await wait(CONFIG.transitionDuration);
  }

  const defaults = state.scenario.defaults || {};
  setBackground(scene.background ?? defaults.background ?? null);
  setCharacters(scene.characters || []);
  // イベントCGなど、話者情報を保持しつつ名前欄だけ隠す演出に対応します。
  elements.speaker.textContent = scene.hideName ? "" : (scene.speaker || "");
  audioManager.playBgm(scene.bgm ?? defaults.bgm ?? null);
  audioManager.playSe(scene.se ?? null);

  // choices はv0.3以降で選択肢UIへ渡すため、シーンデータに予約しています。
  elements.game.dataset.hasChoices = String(Boolean(scene.choices?.length));
  state.fullText = scene.text || "";
  state.isTyping = false;
  elements.dialogue.textContent = "";
  elements.advance.dataset.state = "transitioning";

  elements.fader.classList.remove("is-dark");
  // フェードイン完了までは入力を受けず、連続タップによる読み飛ばしを防ぎます。
  if (useTransition) {
    await wait(CONFIG.transitionDuration);
  }

  // 背景と立ち絵が見えてから文字送りを始めます。
  typeDialogue(state.fullText);
  state.isTransitioning = false;
}

async function advanceStory() {
  if (state.isTransitioning || !state.scenario) return;
  clearAutoAdvance();

  // 文字送り中の最初のタップは、現在のセリフを全文表示します。
  if (state.isTyping) {
    finishTyping();
    return;
  }

  // nextSceneId があれば章・場所をまたぐ明示的な遷移を優先します。
  const currentScene = state.scenario.scenes[state.sceneIndex];
  const linkedIndex = currentScene.nextSceneId
    ? state.scenario.scenes.findIndex((scene) => scene.id === currentScene.nextSceneId)
    : -1;
  const nextIndex = linkedIndex >= 0 ? linkedIndex : state.sceneIndex + 1;

  // 全文表示後のタップで、次のセリフへ進みます。
  if (nextIndex < state.scenario.scenes.length) {
    state.sceneIndex = nextIndex;
    await renderScene(state.sceneIndex);
    return;
  }

  elements.advance.dataset.state = "end";
}

async function loadScenario() {
  try {
    const response = await fetch(CONFIG.scenarioUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const scenario = await response.json();
    if (!Array.isArray(scenario.scenes) || scenario.scenes.length === 0) {
      throw new Error("シーンがありません");
    }

    state.scenario = scenario;
    const requestedSceneId = new URLSearchParams(window.location.search).get("scene");
    const requestedIndex = requestedSceneId
      ? scenario.scenes.findIndex((scene) => scene.id === requestedSceneId)
      : -1;
    state.sceneIndex = requestedIndex >= 0 ? requestedIndex : 0;
    await renderScene(state.sceneIndex, false);
  } catch (error) {
    elements.dialogue.textContent = "シナリオを読み込めませんでした。";
    elements.error.textContent = "ローカルサーバー経由で開いてください。";
    console.error("Scenario loading failed:", error);
  }
}

// 1回のタップからclickが複数回届いても、シーンを1つだけ進めます。
elements.advance.addEventListener("pointerdown", () => {
  state.interactionId += 1;
});
elements.advance.addEventListener("click", (event) => {
  // detail=0 はEnter/Spaceなどのキーボード操作です。
  if (event.detail === 0) state.interactionId += 1;
  if (state.handledInteractionId === state.interactionId) return;
  state.handledInteractionId = state.interactionId;
  advanceStory();
});
elements.back.addEventListener("click", () => {
  window.location.href = "index.html";
});

// 画像が存在しない場合は、その立ち絵だけを非表示にします。
Object.values(elements.characters).forEach((image) => {
  image.addEventListener("load", () => {
    if (image === elements.characters.center) {
      elements.characterPlaceholder.classList.remove("is-visible");
    }
  });
  image.addEventListener("error", () => {
    image.classList.remove("is-visible");
    if (image === elements.characters.center && image.src) {
      elements.characterPlaceholder.classList.add("is-visible");
    }
  });
});

loadScenario();
