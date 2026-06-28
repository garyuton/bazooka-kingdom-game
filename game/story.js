"use strict";

/**
 * バズーカ王国物語 ノベルゲームエンジン v0.2
 *
 * 表示処理、音声処理、シナリオデータを分離しています。
 * JSONに bgm / se / choices を追加しても既存の表示処理を崩さず拡張できます。
 */

const CONFIG = {
  scenarioUrl: "scenario/story01.json",
  typeInterval: 38,
  transitionDuration: 420,
};

const elements = {
  game: document.querySelector("#novel-game"),
  background: document.querySelector("#background-layer"),
  fader: document.querySelector("#scene-fader"),
  advance: document.querySelector("#advance-layer"),
  speaker: document.querySelector("#speaker-name"),
  dialogue: document.querySelector("#dialogue-text"),
  error: document.querySelector("#error-message"),
  back: document.querySelector("#back-button"),
  characters: {
    left: document.querySelector("#character-left"),
    center: document.querySelector("#character-center"),
    right: document.querySelector("#character-right"),
  },
};

const state = {
  scenario: null,
  sceneIndex: 0,
  isTyping: false,
  isTransitioning: false,
  typingTimer: null,
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

function setBackground(source) {
  elements.background.style.backgroundImage = source ? `url("${source}")` : "none";
}

/** left / center / right の3枠へ立ち絵を配置します。 */
function setCharacters(characters = []) {
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
}

/** Unicode文字を1文字ずつ表示し、タイプライター演出を行います。 */
function typeDialogue(text) {
  clearTimeout(state.typingTimer);
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

  if (useTransition) {
    elements.fader.classList.add("is-dark");
    await wait(CONFIG.transitionDuration);
  }

  const defaults = state.scenario.defaults || {};
  setBackground(scene.background ?? defaults.background ?? null);
  setCharacters(scene.characters || []);
  elements.speaker.textContent = scene.speaker || "";
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

  // 文字送り中の最初のタップは、現在のセリフを全文表示します。
  if (state.isTyping) {
    finishTyping();
    return;
  }

  // 全文表示後のタップで、次のセリフへ進みます。
  if (state.sceneIndex < state.scenario.scenes.length - 1) {
    state.sceneIndex += 1;
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
    state.sceneIndex = 0;
    await renderScene(0, false);
  } catch (error) {
    elements.dialogue.textContent = "シナリオを読み込めませんでした。";
    elements.error.textContent = "ローカルサーバー経由で開いてください。";
    console.error("Scenario loading failed:", error);
  }
}

elements.advance.addEventListener("click", advanceStory);
elements.back.addEventListener("click", () => {
  window.location.href = "index.html";
});

// 画像が存在しない場合は、その立ち絵だけを非表示にします。
Object.values(elements.characters).forEach((image) => {
  image.addEventListener("error", () => image.classList.remove("is-visible"));
});

loadScenario();
