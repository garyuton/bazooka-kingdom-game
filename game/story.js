"use strict";

/**
 * バズーカ王国物語 ノベルゲームエンジン v0.2
 *
 * 表示処理、音声処理、シナリオデータを分離しています。
 * JSONに bgm / se / choices を追加しても既存の表示処理を崩さず拡張できます。
 */

const CONFIG = {
  scenarioUrl: "story.json?v=20260718-romako-bazuton-voice",
  typeInterval: 38,
  transitionDuration: 420,
};

const elements = {
  game: document.querySelector("#novel-game"),
  background: document.querySelector("#background-layer"),
  backgroundCrossfade: document.querySelector("#background-crossfade"),
  backgroundPlaceholder: document.querySelector("#background-placeholder"),
  bookTransition: document.querySelector("#book-transition"),
  bookTransitionClosed: document.querySelector("#book-transition-closed"),
  bookTransitionOpen: document.querySelector("#book-transition-open"),
  characterLayer: document.querySelector("#character-layer"),
  effect: document.querySelector("#scene-effect"),
  imagination: document.querySelector("#imagination-overlay"),
  imaginationImage: document.querySelector("#imagination-image"),
  reactionMark: document.querySelector("#reaction-mark"),
  fader: document.querySelector("#scene-fader"),
  advance: document.querySelector("#advance-layer"),
  speaker: document.querySelector("#speaker-name"),
  narratorIcon: document.querySelector("#narrator-icon"),
  dialogue: document.querySelector("#dialogue-text"),
  dialoguePanel: document.querySelector(".dialogue-panel"),
  error: document.querySelector("#error-message"),
  back: document.querySelector("#back-button"),
  nameEntry: document.querySelector("#name-entry"),
  nameEntryForm: document.querySelector("#name-entry-form"),
  playerNameInput: document.querySelector("#player-name-input"),
  chapterEnd: document.querySelector("#chapter-end"),
  chapterEndBack: document.querySelector("#chapter-end-back"),
  ending: document.querySelector("#ending-roll"),
  endingVisual: document.querySelector("#ending-visual"),
  endingGlow: document.querySelector("#ending-glow"),
  endingContent: document.querySelector("#ending-content"),
  endingSkip: document.querySelector("#ending-skip"),
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
  seTimer: null,
  voiceTimer: null,
  imaginationTimers: [],
  reactionTimer: null,
  fullText: "",
  currentLogicalScene: null,
  advanceLockedUntil: 0,
  variables: {
    playerName: "ガリュウ",
  },
};

/** BGMとSEを管理する小さな窓口。JSONにパスを指定すると再生できます。 */
const audioManager = {
  bgm: new Audio(),
  voice: new Audio(),
  pendingSe: null,
  pendingVoice: null,
  sceneSes: [],
  playedVoiceKeys: new Set(),

  playBgm(source) {
    if (!source) {
      this.bgm.pause();
      this.bgm.removeAttribute("src");
      delete this.bgm.dataset.source;
      return;
    }
    if (this.bgm.dataset.source === source) return;
    this.bgm.pause();
    this.bgm = new Audio(source);
    this.bgm.dataset.source = source;
    this.bgm.loop = true;
    this.bgm.volume = 0.55;
    this.bgm.play().catch(() => {
      // 自動再生制限時は、次のユーザー操作まで再生を保留します。
    });
  },

  playSe(source, volume = 0.8, options = {}) {
    if (!source) return;
    const se = new Audio(source);
    se.volume = volume;
    if (options.trackScene) {
      this.sceneSes.push(se);
    }
    se.play().then(() => {
      this.pendingSe = null;
    }).catch(() => {
      // 自動再生が制限された場合は、次のタップで再試行します。
      this.pendingSe = { source, volume, options };
    });
  },

  resumePendingSe() {
    if (!this.pendingSe) return;
    const { source, volume, options } = this.pendingSe;
    this.pendingSe = null;
    this.playSe(source, volume, options);
  },

  /** ボイスはシーン固有キーで一度だけ再生し、連打による多重再生を防ぎます。 */
  playVoice(source, volume = 0.92, key = source) {
    if (!source || this.playedVoiceKeys.has(key)) return;

    this.voice.pause();
    this.voice = new Audio(source);
    this.voice.volume = volume;
    this.voice.dataset.key = key;
    this.voice.play().then(() => {
      this.playedVoiceKeys.add(key);
      this.pendingVoice = null;
    }).catch(() => {
      // 自動再生制限時は、次のユーザー操作で同じボイスを再試行します。
      this.pendingVoice = { source, volume, key };
    });
  },

  resumePendingVoice() {
    if (!this.pendingVoice) return;
    const { source, volume, key } = this.pendingVoice;
    this.pendingVoice = null;
    this.playVoice(source, volume, key);
  },

  stopVoice() {
    this.voice.pause();
    this.voice.removeAttribute("src");
    this.pendingVoice = null;
  },

  stopSceneSe() {
    this.sceneSes.forEach((se) => {
      se.pause();
      se.removeAttribute("src");
    });
    this.sceneSes = [];
    if (this.pendingSe?.options?.trackScene) {
      this.pendingSe = null;
    }
  },
};

/** 雨などの環境音をBGMとは別にループ管理します。 */
const ambienceManager = {
  audio: new Audio(),
  requestedSource: null,
  fadeTimer: null,

  prepare(source) {
    if (!source) return;
    if (this.audio.dataset.source !== source) {
      this.stop();
      this.audio = new Audio(source);
      this.audio.dataset.source = source;
      this.audio.loop = true;
      this.audio.volume = 0;
    }
    this.audio.play().then(() => {
      elements.game.dataset.ambienceState = "prepared";
    }).catch(() => {
      elements.game.dataset.ambienceState = "pending";
    });
  },

  set(source, volume = 0.28, options = {}) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.requestedSource = source || null;
    elements.game.dataset.ambience = this.requestedSource || "none";
    if (!this.requestedSource) {
      this.stop();
      return;
    }

    this.prepare(this.requestedSource);
    this.audio.dataset.volume = String(volume);
    if (options.fadeInMs) {
      this.fadeIn(volume, options.fadeInMs);
      return;
    }
    this.audio.volume = volume;
    if (!this.audio.paused) elements.game.dataset.ambienceState = "playing";
  },

  resume() {
    if (!this.requestedSource || !this.audio.paused) return Promise.resolve();
    return this.audio.play().then(() => {
      this.audio.volume = Number(this.audio.dataset.volume || 0.28);
      elements.game.dataset.ambienceState = "playing";
    });
  },

  stop() {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.volume = 0;
    elements.game.dataset.ambienceState = "stopped";
  },

  fadeIn(targetVolume = 0.28, duration = 1000) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.audio.dataset.volume = String(targetVolume);
    this.audio.volume = 0;
    const startedAt = performance.now();
    elements.game.dataset.ambienceState = "fading-in";
    this.fadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      this.audio.volume = targetVolume * progress;
      if (progress >= 1) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        if (!this.audio.paused) elements.game.dataset.ambienceState = "playing";
      }
    }, 40);
  },

  /** 場所を離れる際、環境音を滑らかに消してから停止します。 */
  fadeOut(duration = 800) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.audio.paused || this.audio.volume <= 0 || duration <= 0) {
      this.stop();
      return;
    }

    const startVolume = this.audio.volume;
    const startedAt = performance.now();
    elements.game.dataset.ambienceState = "fading-out";
    this.fadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      this.audio.volume = startVolume * (1 - progress);
      if (progress >= 1) this.stop();
    }, 40);
  },
};

const ENDING_ASSETS = {
  theme: "../assets/audio/bgm/bazooka_kingdom_chapter1.mp3?v=20260715-ending",
  bookOpen: "../assets/images/book/book_open_01.png?v=20260713-book",
  bookClosed: "../assets/images/book/book_closed_01.png?v=20260713-book",
  carriage: "../assets/cg/scene_royal_carriage_rain_01.png?v=20260712",
  rescue: "../assets/cg/scene_child_found_in_rain_01.png?v=20260712",
  dormitory: "../assets/bg/servants_dormitory_morning.png?v=20260704",
  underground: "../assets/bg/underground_corridor.png?v=20260704",
};

const endingManager = {
  audio: new Audio(),
  rafId: null,
  resumeHandler: null,
  skipDisplayTime: null,
  currentCard: "",
  isRunning: false,

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentCard = "";
    cancelAnimationFrame(this.rafId);
    if (this.resumeHandler) {
      elements.ending.removeEventListener("click", this.resumeHandler);
      this.resumeHandler = null;
    }

    audioManager.playBgm(null);
    audioManager.stopSceneSe();
    ambienceManager.fadeOut(1200);
    clearBookTransition();
    setCharacters([]);
    setNarratorIcon(null);
    setSceneEffect(null, false);
    elements.back.hidden = true;
    elements.dialoguePanel.classList.add("is-hidden");

    elements.ending.hidden = false;
    elements.endingSkip.hidden = true;
    this.setVisual(ENDING_ASSETS.bookOpen, "is-book");
    this.setGlow(false);
    this.setContent(`<div class="ending-card ending-card--quiet"><p>物語のページが、静かに閉じられていく。</p></div>`);

    await wait(3800);
    this.setVisual(ENDING_ASSETS.bookClosed, "is-book");
    await wait(1800);
    this.clearVisual();
    this.setContent("");
    await wait(1600);

    this.audio.pause();
    this.audio = new Audio(ENDING_ASSETS.theme);
    this.audio.loop = false;
    this.audio.volume = 0;
    this.audio.addEventListener("ended", () => this.finish(), { once: true });
    this.audio.play().then(() => {
      this.tick();
    }).catch(() => {
      this.showCard("tap-to-play", `
        <div class="ending-card ending-card--quiet">
          <p>画面をタップすると、第一章の余韻が流れ始めます。</p>
        </div>
      `, null, false);
      elements.endingSkip.hidden = false;
      this.resumeHandler = () => {
        this.audio.play().then(() => {
          elements.ending.removeEventListener("click", this.resumeHandler);
          this.resumeHandler = null;
          this.currentCard = "";
          this.tick();
        }).catch(() => {});
      };
      elements.ending.addEventListener("click", this.resumeHandler);
    });
  },

  tick() {
    if (!this.isRunning) return;
    const time = this.audio.currentTime || 0;
    if (!this.audio.paused && time < 6) {
      this.audio.volume = Math.min(0.78, (time / 6) * 0.78);
    }
    const displayTime = this.skipDisplayTime && time < this.skipDisplayTime
      ? this.skipDisplayTime
      : time;
    if (this.skipDisplayTime && time >= this.skipDisplayTime) {
      this.skipDisplayTime = null;
    }
    this.render(displayTime);
    this.rafId = requestAnimationFrame(() => this.tick());
  },

  render(time) {
    if (time >= 20) elements.endingSkip.hidden = false;

    if (time < 10) {
      this.showCard("black", "", null, false);
    } else if (time < 20) {
      this.showCard("title", `
        <div class="ending-card">
          <h2 class="ending-title">バズーカ王国物語</h2>
          <p class="ending-subtitle">第一章</p>
        </div>
      `, null, false);
    } else if (time < 40) {
      this.showCard("book-close", `
        <div class="ending-card ending-card--quiet">
          <p>雨の夜に開かれた物語は、</p>
          <p>ひとつの出会いを残して、そっとページを閉じる。</p>
        </div>
      `, ENDING_ASSETS.bookClosed, false, "is-book");
    } else if (time < 80) {
      this.showCard("credits-1", `
        <div class="ending-roll-list">
          <strong>第一章　雨の日の朝</strong>
          <span>語り　ガリュ㌧</span>
          <span>王と王妃の巡幸</span>
          <span>雨の石畳に倒れていた少年</span>
        </div>
      `, ENDING_ASSETS.carriage, false);
    } else if (time < 115) {
      this.showCard("memory-1", `
        <div class="ending-roll-list">
          <strong>名もなき少年</strong>
          <span>下男宿舎で目を覚まし、</span>
          <span>はじめて雨風をしのぐ屋根を得た。</span>
        </div>
      `, ENDING_ASSETS.dormitory, false);
    } else if (time < 145) {
      this.showCard("memory-2", `
        <div class="ending-roll-list">
          <strong>地下通路</strong>
          <span>冷たい石の奥で、</span>
          <span>小さな光が少年を待っていた。</span>
        </div>
      `, ENDING_ASSETS.underground, false);
    } else if (time < 170) {
      this.showCard("credits-2", `
        <div class="ending-roll-list">
          <strong>出会い</strong>
          <span>バズ㌧</span>
          <span>「僕、バズ㌧！」</span>
        </div>
      `, ENDING_ASSETS.rescue, false);
    } else if (time < 190) {
      this.showCard("quiet-before-peak", `
        <div class="ending-card ending-card--quiet">
          <p>これはまだ、物語の始まり。</p>
        </div>
      `, ENDING_ASSETS.bookClosed, true, "is-book");
    } else if (time < 218) {
      this.showCard("complete", `
        <div class="ending-complete">
          <h2 class="ending-complete__title">バズーカ王国物語</h2>
          <p class="ending-complete__chapter">第一章　完</p>
        </div>
      `, null, true);
    } else {
      this.showCard("fadeout", "", null, false);
    }
  },

  showCard(key, html, visual, glow = false, visualClass = "") {
    if (this.currentCard === key) return;
    this.currentCard = key;
    this.setContent(html);
    if (visual) this.setVisual(visual, visualClass);
    else this.clearVisual();
    this.setGlow(glow);
  },

  setContent(html) {
    elements.endingContent.innerHTML = html;
  },

  setVisual(source, extraClass = "") {
    elements.endingVisual.style.backgroundImage = `url("${source}")`;
    elements.endingVisual.className = `ending-roll__visual is-visible ${extraClass}`.trim();
  },

  clearVisual() {
    elements.endingVisual.className = "ending-roll__visual";
    elements.endingVisual.style.backgroundImage = "";
  },

  setGlow(visible) {
    elements.endingGlow.classList.toggle("is-visible", Boolean(visible));
  },

  skipToFinale() {
    if (!this.isRunning || !this.audio.src) return;
    const finaleTime = 190;
    const seekFinale = () => {
      try {
        this.audio.currentTime = Math.max(this.audio.currentTime || 0, finaleTime);
      } catch {}
    };
    seekFinale();
    if (!Number.isFinite(this.audio.duration) || this.audio.duration < finaleTime) {
      this.audio.addEventListener("loadedmetadata", seekFinale, { once: true });
    }
    this.skipDisplayTime = finaleTime;
    this.audio.volume = 0.78;
    this.render(finaleTime);
    if (this.audio.paused) {
      this.audio.play().then(() => this.tick()).catch(() => {});
    }
  },

  async finish() {
    if (!this.isRunning) return;
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.skipDisplayTime = null;
    if (this.resumeHandler) {
      elements.ending.removeEventListener("click", this.resumeHandler);
      this.resumeHandler = null;
    }
    this.audio.pause();
    this.setGlow(false);
    this.clearVisual();
    this.setContent("");
    elements.endingSkip.hidden = true;
    await wait(2600);
    window.location.href = "index.html";
  },
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function clearAutoAdvance() {
  clearTimeout(state.autoAdvanceTimer);
  state.autoAdvanceTimer = null;
}

function clearScheduledSe() {
  clearTimeout(state.seTimer);
  state.seTimer = null;
}

function clearScheduledVoice() {
  clearTimeout(state.voiceTimer);
  state.voiceTimer = null;
}

function clearImaginationTimers() {
  state.imaginationTimers.forEach((timer) => clearTimeout(timer));
  state.imaginationTimers = [];
}

function clearReactionTimer() {
  clearTimeout(state.reactionTimer);
  state.reactionTimer = null;
}

function formatText(value = "") {
  return String(value).replaceAll("{playerName}", state.variables.playerName);
}

function setNarratorIcon(source, alt = "ガリュ㌧") {
  elements.narratorIcon.classList.toggle("is-visible", Boolean(source));
  if (source) {
    elements.narratorIcon.src = source;
    elements.narratorIcon.alt = alt;
  } else {
    elements.narratorIcon.removeAttribute("src");
    elements.narratorIcon.alt = "";
  }
}

function setSceneEffect(effect, characterGlow = false) {
  elements.effect.className = "scene-effect";
  if (effect) elements.effect.classList.add(`is-${effect}`);
  elements.characterLayer.classList.toggle("has-glow", characterGlow);
}

function setImagination(source, options = {}) {
  if (!options.preserveTimers) clearImaginationTimers();
  elements.imagination.className = "imagination-overlay";
  if (!source) {
    elements.imaginationImage.removeAttribute("src");
    elements.imaginationImage.alt = "";
    return;
  }

  if (elements.imaginationImage.getAttribute("src")) {
    elements.imagination.classList.add("is-switching");
    state.imaginationTimers.push(setTimeout(() => {
      elements.imaginationImage.src = source;
      elements.imaginationImage.alt = options.alt || "想像";
      elements.imagination.classList.remove("is-switching");
      elements.imagination.classList.add("is-visible");
      if (options.effect) elements.imagination.classList.add(`is-${options.effect}`);
    }, options.switchDelayMs ?? 220));
    return;
  }

  elements.imaginationImage.src = source;
  elements.imaginationImage.alt = options.alt || "想像";
  elements.imagination.classList.add("is-visible");
  if (options.effect) elements.imagination.classList.add(`is-${options.effect}`);
}

function clearImagination(effect = null) {
  clearImaginationTimers();
  if (effect) {
    elements.imagination.className = `imagination-overlay is-visible is-${effect}`;
    state.imaginationTimers.push(setTimeout(() => setImagination(null), 620));
    return;
  }
  setImagination(null);
}

function playImaginationSequence(sequence = []) {
  clearImaginationTimers();
  let elapsed = 0;
  sequence.forEach((item) => {
    state.imaginationTimers.push(setTimeout(() => {
      setImagination(item.src, {
        alt: item.alt,
        switchDelayMs: item.switchDelayMs ?? 180,
        preserveTimers: true,
      });
    }, elapsed));
    elapsed += item.durationMs ?? 450;
  });
}

function setReactionMark(mark = null, durationMs = 900) {
  clearReactionTimer();
  elements.reactionMark.textContent = mark || "";
  elements.reactionMark.classList.toggle("is-visible", Boolean(mark));
  if (mark && durationMs) {
    state.reactionTimer = setTimeout(() => setReactionMark(null), durationMs);
  }
}

function getNextIndex(scene) {
  const linkedIndex = scene.nextSceneId
    ? state.scenario.scenes.findIndex((item) => item.id === scene.nextSceneId)
    : -1;
  return linkedIndex >= 0 ? linkedIndex : state.sceneIndex + 1;
}

function showNameEntry() {
  elements.dialoguePanel.classList.add("is-hidden");
  elements.nameEntry.hidden = false;
  elements.playerNameInput.value = state.variables.playerName;
  elements.playerNameInput.focus();
}

function showChapterEnd() {
  elements.dialoguePanel.classList.add("is-hidden");
  elements.back.hidden = true;
  elements.chapterEnd.hidden = false;
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
    // background: null は意図的な黒画面として扱います。
    elements.backgroundPlaceholder.classList.add("is-hidden");
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

async function crossfadeBackground(source, duration = 500) {
  const currentBackground = elements.background.style.backgroundImage;
  await preloadImage(source);
  if (currentBackground && currentBackground !== "none") {
    elements.backgroundCrossfade.style.backgroundImage = currentBackground;
    elements.backgroundCrossfade.style.setProperty("--crossfade-duration", `${duration}ms`);
    elements.backgroundCrossfade.classList.remove("is-fading");
    elements.backgroundCrossfade.classList.add("is-active");
  }
  setBackground(source);
  await wait(30);
  elements.backgroundCrossfade.classList.add("is-fading");
  await wait(duration);
  elements.backgroundCrossfade.classList.remove("is-active", "is-fading");
  elements.backgroundCrossfade.style.backgroundImage = "";
  elements.backgroundCrossfade.style.removeProperty("--crossfade-duration");
}

function preloadImage(source) {
  return new Promise((resolve) => {
    if (!source) {
      resolve();
      return;
    }
    const image = new Image();
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
    image.src = source;
  });
}

async function playBookTransition(transition) {
  if (!transition?.closed || !transition?.open) return;

  await Promise.all([
    preloadImage(transition.closed),
    preloadImage(transition.open),
    preloadImage(transition.worldBackground),
  ]);
  elements.dialoguePanel.classList.add("is-hidden");
  setNarratorIcon(null);

  elements.bookTransitionClosed.style.backgroundImage = `url("${transition.closed}")`;
  elements.bookTransitionOpen.style.backgroundImage = `url("${transition.open}")`;
  elements.bookTransition.classList.remove("is-open", "is-zooming", "is-glowing", "is-fading-to-world");
  elements.bookTransition.classList.add("is-visible");

  await wait(80);
  elements.bookTransition.classList.add("is-open");
  await wait(transition.crossFadeMs ?? 600);
  await wait(transition.holdMs ?? 800);

  elements.bookTransition.classList.add("is-zooming");
  await wait(transition.glowDelayMs ?? 600);
  elements.bookTransition.classList.add("is-glowing");

  await wait(transition.rainDelayMs ?? 400);
  if (transition.ambience) {
    ambienceManager.set(transition.ambience, transition.ambienceVolume ?? 0.18, {
      fadeInMs: transition.ambienceFadeInMs ?? 1200,
    });
  }

  await wait(transition.worldDelayMs ?? 200);
  if (transition.worldBackground) {
    setBackground(transition.worldBackground);
  }
  elements.bookTransition.classList.add("is-fading-to-world");
  await wait(transition.worldCrossFadeMs ?? 850);
  await wait(transition.worldHoldMs ?? 900);
}

function clearBookTransition() {
  elements.bookTransition.classList.remove("is-visible", "is-open", "is-zooming", "is-glowing", "is-fading-to-world");
  elements.bookTransitionClosed.style.backgroundImage = "";
  elements.bookTransitionOpen.style.backgroundImage = "";
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
  const scene = state.scenario?.scenes[state.sceneIndex];
  state.advanceLockedUntil = scene?.postDelayMs ? performance.now() + scene.postDelayMs : 0;
  scheduleAutoAdvance();
}

/** Unicode文字を1文字ずつ表示し、タイプライター演出を行います。 */
function typeDialogue(text, interval = CONFIG.typeInterval) {
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

    state.typingTimer = setTimeout(typeNext, interval);
  };

  typeNext();
}

/** フェードアウト中に次のシーンの素材と文章を差し替えます。 */
async function renderScene(index, useTransition = true) {
  const scene = state.scenario.scenes[index];
  if (!scene) return;

  const logicalScene = scene.scene || scene.id;
  const isNewLogicalScene = state.currentLogicalScene !== logicalScene;

  state.isTransitioning = true;
  clearTimeout(state.typingTimer);
  clearAutoAdvance();
  clearScheduledSe();
  clearScheduledVoice();

  const transitionDuration = scene.transitionDurationMs ?? CONFIG.transitionDuration;
  const usesBackgroundCrossfade = useTransition && scene.transitionMode === "crossfade";

  if (useTransition && !usesBackgroundCrossfade) {
    elements.fader.style.transitionDuration = `${transitionDuration}ms`;
    elements.fader.classList.add("is-dark");
    if (scene.revealOnly) {
      // 黒画面を一度描画してから背景を差し替え、ゆっくり物語世界を現します。
      await wait(50);
    } else {
      await wait(transitionDuration);
    }
  }

  const defaults = state.scenario.defaults || {};
  if (isNewLogicalScene) {
    audioManager.stopSceneSe();
    audioManager.stopVoice();
    clearBookTransition();
    setCharacters([]);
    setNarratorIcon(null);
    setSceneEffect(null, false);
    clearImagination();
    setReactionMark(null);
  }
  state.currentLogicalScene = logicalScene;

  if (Object.hasOwn(scene, "background")) {
    if (usesBackgroundCrossfade && scene.background) {
      await crossfadeBackground(scene.background, transitionDuration);
    } else {
      setBackground(scene.background);
    }
  } else if (isNewLogicalScene) {
    setBackground(defaults.background ?? null);
  }
  if (Object.hasOwn(scene, "characters")) setCharacters(scene.characters || []);
  if (Object.hasOwn(scene, "icon")) setNarratorIcon(scene.icon, scene.iconAlt);
  if (Object.hasOwn(scene, "effect") || Object.hasOwn(scene, "characterGlow")) {
    setSceneEffect(scene.effect || null, Boolean(scene.characterGlow));
  }
  if (Object.hasOwn(scene, "imagination")) {
    if (scene.imagination) setImagination(scene.imagination.src, scene.imagination);
    else clearImagination(scene.imaginationEffect || null);
  }
  if (scene.imaginationSequence) playImaginationSequence(scene.imaginationSequence);
  if (Object.hasOwn(scene, "reaction")) {
    setReactionMark(scene.reaction, scene.reactionDurationMs ?? 900);
  }

  elements.back.hidden = logicalScene === "scene000";
  // イベントCGなど、話者情報を保持しつつ名前欄だけ隠す演出に対応します。
  elements.speaker.textContent = scene.hideName ? "" : formatText(scene.speaker || "");
  if (Object.hasOwn(scene, "bgm")) {
    audioManager.playBgm(scene.bgm);
  } else if (isNewLogicalScene) {
    audioManager.playBgm(defaults.bgm ?? null);
  }
  if (Object.hasOwn(scene, "ambience")) {
    ambienceManager.set(scene.ambience, scene.ambienceVolume, { fadeInMs: scene.ambienceFadeInMs });
  } else if (isNewLogicalScene) {
    ambienceManager.set(defaults.ambience ?? null);
  }
  if (scene.se) {
    if (scene.seDelayMs) {
      state.seTimer = setTimeout(() => audioManager.playSe(scene.se, scene.seVolume, { trackScene: true }), scene.seDelayMs);
    } else {
      audioManager.playSe(scene.se, scene.seVolume, { trackScene: true });
    }
  }
  if (scene.voice) {
    const playVoice = () => audioManager.playVoice(
      scene.voice,
      scene.voiceVolume ?? 0.92,
      scene.voiceKey || `${scene.id}:${scene.voice}`,
    );
    if (scene.voiceDelayMs) {
      state.voiceTimer = setTimeout(playVoice, scene.voiceDelayMs);
    } else {
      playVoice();
    }
  }

  // choices はv0.3以降で選択肢UIへ渡すため、シーンデータに予約しています。
  elements.game.dataset.hasChoices = String(Boolean(scene.choices?.length));
  state.fullText = formatText(scene.text || "");
  state.isTyping = false;
  elements.dialogue.textContent = "";
  elements.advance.dataset.state = "transitioning";

  elements.fader.classList.remove("is-dark");
  // フェードイン完了までは入力を受けず、連続タップによる読み飛ばしを防ぎます。
  if (useTransition && !usesBackgroundCrossfade) {
    await wait(transitionDuration);
    elements.fader.style.removeProperty("transition-duration");
  }

  if (scene.startDelayMs) {
    elements.dialoguePanel.classList.add("is-hidden");
    await wait(scene.startDelayMs);
  }

  if (scene.action === "nameInput") {
    state.isTransitioning = false;
    showNameEntry();
    return;
  }
  if (scene.action === "wait") {
    elements.dialoguePanel.classList.add("is-hidden");
    await wait(scene.waitMs ?? 500);
    const nextIndex = getNextIndex(scene);
    if (nextIndex < state.scenario.scenes.length) {
      state.sceneIndex = nextIndex;
      const nextScene = state.scenario.scenes[nextIndex];
      const changesLogicalScene = (nextScene.scene || nextScene.id) !== (scene.scene || scene.id);
      await renderScene(nextIndex, changesLogicalScene || Boolean(scene.forceTransition));
    }
    return;
  }
  if (scene.action === "chapterEnd") {
    state.isTransitioning = false;
    showChapterEnd();
    return;
  }
  if (scene.action === "ending") {
    state.isTransitioning = false;
    endingManager.start();
    return;
  }

  // 背景と立ち絵が見えてから文字送りを始めます。
  elements.dialoguePanel.classList.remove("is-hidden");
  typeDialogue(state.fullText, scene.typeInterval ?? CONFIG.typeInterval);
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
  if (state.advanceLockedUntil && performance.now() < state.advanceLockedUntil) return;

  // nextSceneId があれば章・場所をまたぐ明示的な遷移を優先します。
  const currentScene = state.scenario.scenes[state.sceneIndex];
  if (currentScene.action) return;
  const nextIndex = getNextIndex(currentScene);

  // 全文表示後のタップで、次のセリフへ進みます。
  if (nextIndex < state.scenario.scenes.length) {
    audioManager.playSe(currentScene.advanceSe ?? null, currentScene.advanceSeVolume);
    ambienceManager.prepare(currentScene.advanceAmbience ?? null);
    if (currentScene.ambienceFadeOutMs) {
      ambienceManager.fadeOut(currentScene.ambienceFadeOutMs);
    }
    if (currentScene.bookTransition) {
      state.isTransitioning = true;
      await playBookTransition(currentScene.bookTransition);
    }
    state.sceneIndex = nextIndex;
    const nextScene = state.scenario.scenes[nextIndex];
    const changesLogicalScene = (nextScene.scene || nextScene.id) !== (currentScene.scene || currentScene.id);
    const shouldTransition = !currentScene.skipNextTransition
      && (changesLogicalScene || Boolean(currentScene.forceTransition));
    await renderScene(state.sceneIndex, shouldTransition);
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
  audioManager.resumePendingSe();
  audioManager.resumePendingVoice();
  ambienceManager.resume().catch(() => {});
});
elements.advance.addEventListener("click", (event) => {
  audioManager.resumePendingSe();
  audioManager.resumePendingVoice();
  ambienceManager.resume().catch(() => {});
  // detail=0 はEnter/Spaceなどのキーボード操作です。
  if (event.detail === 0) state.interactionId += 1;
  if (state.handledInteractionId === state.interactionId) return;
  state.handledInteractionId = state.interactionId;
  advanceStory();
});
elements.back.addEventListener("click", () => {
  window.location.href = "index.html";
});
elements.chapterEndBack.addEventListener("click", () => {
  window.location.href = "index.html";
});
elements.endingSkip.addEventListener("click", (event) => {
  event.stopPropagation();
  endingManager.skipToFinale();
});
elements.nameEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const enteredName = elements.playerNameInput.value.trim();
  if (!enteredName) {
    elements.playerNameInput.focus();
    return;
  }
  state.variables.playerName = enteredName;
  localStorage.setItem("bazookaKingdom.playerName", enteredName);
  elements.nameEntry.hidden = true;

  const currentScene = state.scenario.scenes[state.sceneIndex];
  const nextIndex = getNextIndex(currentScene);
  if (nextIndex >= state.scenario.scenes.length) return;
  state.sceneIndex = nextIndex;
  await renderScene(nextIndex, false);
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
