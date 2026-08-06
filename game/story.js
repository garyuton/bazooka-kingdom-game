"use strict";

/**
 * バズーカ王国物語 ノベルゲームエンジン v0.2
 *
 * 表示処理、音声処理、シナリオデータを分離しています。
 * JSONに bgm / se / choices を追加しても既存の表示処理を崩さず拡張できます。
 */

const CONFIG = {
  scenarioUrl: "story.json?v=20260806-final-stage-2",
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
  imaginationHaze: document.querySelector("#imagination-haze"),
  imaginationCaption: document.querySelector("#imagination-caption"),
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
  exploration: document.querySelector("#exploration-ui"),
  explorationLocation: document.querySelector("#exploration-location"),
  explorationChoices: document.querySelector("#exploration-choices"),
  explorationStatus: document.querySelector("#exploration-status"),
  ending: document.querySelector("#ending-roll"),
  endingVisual: document.querySelector("#ending-visual"),
  endingGlow: document.querySelector("#ending-glow"),
  endingPhotoStage: document.querySelector("#ending-photo-stage"),
  endingPhotos: [
    document.querySelector("#ending-photo-a"),
    document.querySelector("#ending-photo-b"),
  ],
  endingLyric: document.querySelector("#ending-lyric"),
  endingContent: document.querySelector("#ending-content"),
  endingSkip: document.querySelector("#ending-skip"),
  chapter2Teaser: document.querySelector("#chapter2-teaser"),
  characterPlaceholder: document.querySelector("#character-placeholder"),
  characterPlaceholderName: document.querySelector("#character-placeholder-name"),
  characters: {
    left: document.querySelector("#character-left"),
    center: document.querySelector("#character-center"),
    right: document.querySelector("#character-right"),
  },
};

let backgroundRequestId = 0;
let undergroundExploration = null;

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
  playedSeKeys: new Set(),
  playedVoiceKeys: new Set(),
  ambientSe: new Audio(),
  ambientSeKey: null,
  ambientSeFadeTimer: null,
  bgmFadeTimer: null,
  pendingAmbientSe: null,
  pendingBgm: false,
  playedAmbientSeKeys: new Set(),

  playBgm(source, volume = 0.55, options = {}) {
    clearInterval(this.bgmFadeTimer);
    this.bgmFadeTimer = null;
    if (!source) {
      if (options.fadeOutMs) {
        this.fadeBgmOut(options.fadeOutMs);
      } else {
        this.stopBgm();
      }
      return;
    }
    if (this.bgm.dataset.source === source) {
      this.resumePendingBgm();
      return;
    }
    this.stopBgm();
    this.bgm = new Audio(source);
    this.bgm.dataset.source = source;
    this.bgm.dataset.volume = String(volume);
    this.bgm.loop = true;
    this.bgm.volume = options.fadeInMs ? 0 : volume;
    elements.game.dataset.bgm = source;
    elements.game.dataset.bgmState = options.fadeInMs ? "fading-in" : "playing";
    elements.game.dataset.bgmVolume = this.bgm.volume.toFixed(3);
    this.bgm.play().then(() => {
      this.pendingBgm = false;
    }).catch(() => {
      // 自動再生制限時は、次のユーザー操作まで再生を保留します。
      this.pendingBgm = true;
      elements.game.dataset.bgmState = "blocked";
    });
    if (options.fadeInMs) this.fadeBgmTo(volume, options.fadeInMs);
  },

  resumePendingBgm() {
    if (!this.pendingBgm || !this.bgm.src) return;
    this.bgm.play().then(() => {
      this.pendingBgm = false;
      elements.game.dataset.bgmState = "playing";
    }).catch(() => {});
  },

  fadeBgmTo(targetVolume, duration) {
    clearInterval(this.bgmFadeTimer);
    const startVolume = this.bgm.volume;
    const startedAt = performance.now();
    this.bgmFadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      this.bgm.volume = startVolume + ((targetVolume - startVolume) * progress);
      elements.game.dataset.bgmVolume = this.bgm.volume.toFixed(3);
      if (progress >= 1) {
        clearInterval(this.bgmFadeTimer);
        this.bgmFadeTimer = null;
        elements.game.dataset.bgmState = this.pendingBgm ? "blocked" : "playing";
      }
    }, 40);
  },

  fadeBgmOut(duration) {
    if (this.bgm.paused || !this.bgm.src || this.bgm.volume <= 0) {
      this.stopBgm();
      return;
    }
    const bgm = this.bgm;
    const startVolume = bgm.volume;
    const startedAt = performance.now();
    elements.game.dataset.bgmState = "fading-out";
    this.bgmFadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      bgm.volume = startVolume * (1 - progress);
      elements.game.dataset.bgmVolume = bgm.volume.toFixed(3);
      if (progress >= 1) this.stopBgm();
    }, 40);
  },

  stopBgm() {
    clearInterval(this.bgmFadeTimer);
    this.bgmFadeTimer = null;
    this.bgm.pause();
    this.pendingBgm = false;
    this.bgm.removeAttribute("src");
    delete this.bgm.dataset.source;
    elements.game.dataset.bgm = "none";
    elements.game.dataset.bgmState = "stopped";
    elements.game.dataset.bgmVolume = "0.000";
  },

  playSe(source, volume = 0.8, options = {}) {
    if (!source) return;
    if (options.key && this.playedSeKeys.has(options.key) && !options.retry) return;
    if (options.key) this.playedSeKeys.add(options.key);
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
    this.playSe(source, volume, { ...options, retry: true });
  },

  /** 遠鐘など、論理Sceneをまたいで一度だけ鳴る環境SEを管理します。 */
  playAmbientSe(source, volume = 0.18, key = source, fadeToMs = 0) {
    if (!source) return;
    clearInterval(this.ambientSeFadeTimer);
    this.ambientSeFadeTimer = null;

    if (this.ambientSeKey === key && this.ambientSe.dataset.source === source) {
      this.fadeAmbientSeTo(volume, fadeToMs);
      return;
    }
    if (this.playedAmbientSeKeys.has(key)) return;

    this.stopAmbientSe();
    const ambientSe = new Audio(source);
    ambientSe.dataset.source = source;
    ambientSe.volume = volume;
    this.ambientSe = ambientSe;
    this.ambientSeKey = key;
    this.playedAmbientSeKeys.add(key);
    ambientSe.play().then(() => {
      this.pendingAmbientSe = null;
    }).catch(() => {
      // 自動再生制限時も同じAudioを保持し、次の操作で再試行します。
      this.pendingAmbientSe = ambientSe;
    });
  },

  fadeAmbientSeTo(targetVolume, duration = 0) {
    clearInterval(this.ambientSeFadeTimer);
    this.ambientSeFadeTimer = null;
    if (!duration || this.ambientSe.paused) {
      this.ambientSe.volume = targetVolume;
      return;
    }

    const startVolume = this.ambientSe.volume;
    const startedAt = performance.now();
    this.ambientSeFadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      this.ambientSe.volume = startVolume + ((targetVolume - startVolume) * progress);
      if (progress >= 1) {
        clearInterval(this.ambientSeFadeTimer);
        this.ambientSeFadeTimer = null;
      }
    }, 40);
  },

  resumePendingAmbientSe() {
    if (!this.pendingAmbientSe) return;
    const ambientSe = this.pendingAmbientSe;
    this.pendingAmbientSe = null;
    ambientSe.play().catch(() => {
      this.pendingAmbientSe = ambientSe;
    });
  },

  stopAmbientSe(key = null) {
    if (key && this.ambientSeKey !== key) return;
    clearInterval(this.ambientSeFadeTimer);
    this.ambientSeFadeTimer = null;
    this.ambientSe.pause();
    this.ambientSe.removeAttribute("src");
    this.ambientSeKey = null;
    this.pendingAmbientSe = null;
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

  /** 終幕前はボイスのendedを待ち、読み上げ途中の切断を防ぎます。 */
  waitForVoiceEnd(timeoutMs = 8000) {
    const voice = this.voice;
    if (!voice?.src || voice.ended) return Promise.resolve();

    return new Promise((resolve) => {
      let timeoutId = null;
      const finish = () => {
        voice.removeEventListener("ended", finish);
        voice.removeEventListener("error", finish);
        clearTimeout(timeoutId);
        resolve();
      };
      voice.addEventListener("ended", finish, { once: true });
      voice.addEventListener("error", finish, { once: true });
      timeoutId = setTimeout(finish, timeoutMs);
    });
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
      this.stop({ preserveRequest: true });
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

    const continuesCurrentSource = this.audio.dataset.source === this.requestedSource;
    this.prepare(this.requestedSource);
    this.audio.dataset.volume = String(volume);
    if (options.fadeToMs && continuesCurrentSource) {
      this.fadeTo(volume, options.fadeToMs);
      return;
    }
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

  stop(options = {}) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.volume = 0;
    if (!options.preserveRequest) {
      this.requestedSource = null;
      elements.game.dataset.ambience = "none";
    }
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

  /** 同じ環境音を止めず、現在音量から目標音量へ滑らかに移動します。 */
  fadeTo(targetVolume = 0.28, duration = 800) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.audio.dataset.volume = String(targetVolume);
    if (this.audio.paused || duration <= 0) {
      this.audio.volume = targetVolume;
      return;
    }

    const startVolume = this.audio.volume;
    const startedAt = performance.now();
    elements.game.dataset.ambienceState = "fading-volume";
    this.fadeTimer = setInterval(() => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      this.audio.volume = startVolume + ((targetVolume - startVolume) * progress);
      if (progress >= 1) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        elements.game.dataset.ambienceState = "playing";
      }
    }, 40);
  },

  /** 場所を離れる際、環境音を滑らかに消してから停止します。 */
  fadeOut(duration = 800) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    // フェード中の操作でresume()されないよう、停止要求を先に確定します。
    this.requestedSource = null;
    elements.game.dataset.ambience = "none";
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
  chapter2Teaser: "../assets/images/ending/chapter2_emblem_foreshadowing.png?v=20260720-teaser",
};

// 写真・歌詞・クレジットはED曲のcurrentTime（秒）だけを基準に管理します。
const ENDING_TITLE_END = 22;
const ENDING_PHOTO_END = 150;
const ENDING_PHOTO_FADE_START = 150;
const ENDING_CREDITS_START = 157;
const ENDING_FINAL_TITLE_DURATION = 6;
const ENDING_SILENT_PAUSE_MS = 1000;
// 歌詞がない時間帯は字幕を空にします。voiceは短いフェードのセリフ表示です。
const ENDING_LYRICS = [
  { start: 22, end: 32, text: "冷たい雨に震えていた\n名もなき子が石畳に眠る" },
  { start: 33, end: 43, text: "巡幸の馬車　王と妃が\nその手を差し伸べた" },
  { start: 44, end: 54, text: "運命の扉が開いた\n小さな希望の炎" },
  { start: 55, end: 66, text: "バズーカ発射！　運命を撃ち抜け！\n掴んだチャンスをモノにしろ！" },
  { start: 67, end: 82, text: "モテ男になるため　伯爵目指せ！\n心の友　「バズ㌧」と共に！" },
  { start: 89, end: 99.1, text: "地下の闇に光り輝く\n９mmの何かが　俺を呼ぶ" },
  { start: 99.35, end: 101.4, text: "「ボク、バズ㌧！」", type: "voice" },
  { start: 101, end: 110, text: "静寂を切り裂き声が響く\n相棒の誕生だ！" },
  { start: 111, end: 122, text: "王の命を　背に受けながら\n鐘が鳴る　新たな旅立ち" },
  { start: 124, end: 134, text: "バズーカ発射！　運命を撃ち抜け！\n掴んだチャンスをモノにしろ！" },
  { start: 135, end: 150, text: "モテ男になるため　伯爵目指せ！\n心の友　「バズ㌧」と共に！" },
  { start: 157, end: 167, text: "ひとりじゃなかった　あの日から\nバズ㌧が笑う　ただそれだけで" },
  { start: 168, end: 180, text: "涙も爆発に変わる\n歩き出す未来へ" },
  { start: 181, end: 191, text: "バズーカ発射！　運命を撃ち抜け！\n掴んだチャンスをモノにしろ！" },
  { start: 192, end: 206, text: "モテ男になるため　伯爵目指せ！\n心の友　バズ㌧と共に！" },
];

// 写真側だけが歌詞の時刻を参照します。歌詞タイムコード自体は変更しません。
const ENDING_SLIDES = [
  { start: ENDING_LYRICS[0].start, end: ENDING_LYRICS[0].end, zoom: 1.022, src: "../assets/images/ending/chapter1/ch01_ending_01_rainy_castle.png", alt: "雨の王城" },
  { start: ENDING_LYRICS[1].start, end: ENDING_LYRICS[1].end, zoom: 1.026, src: "../assets/images/ending/chapter1/ch01_ending_02_royal_carriage.png", alt: "雨の中を進む王家の馬車" },
  { start: ENDING_LYRICS[2].start, end: ENDING_LYRICS[2].end, zoom: 1.021, src: "../assets/images/ending/chapter1/sepia_royal_carriage_interior.webp", alt: "馬車内の国王と王妃" },
  { start: ENDING_LYRICS[3].start, end: ENDING_LYRICS[3].end, zoom: 1.024, src: "../assets/images/ending/chapter1/sepia_child_in_the_rain.webp", alt: "雨の中で見つかった少年" },
  { start: ENDING_LYRICS[4].start, end: ENDING_LYRICS[4].end, zoom: 1.023, src: "../assets/images/ending/chapter1/ch01_ending_03_servants_dormitory.png", alt: "下男宿舎" },
  // 「ボク、バズ㌧！」だけは例外として、独立セリフの終了まで食堂写真を維持します。
  { start: ENDING_LYRICS[5].start, end: ENDING_LYRICS[6].end, zoom: 1.025, src: "../assets/images/ending/chapter1/ch01_ending_04_dining_hall.png", alt: "灯火の食堂" },
  { start: 101.55, end: ENDING_LYRICS[7].end, zoom: 1.022, src: "../assets/images/ending/chapter1/ch01_ending_05_castle_courtyard.png", alt: "王城中庭" },
  { start: ENDING_LYRICS[8].start, end: ENDING_LYRICS[8].end, zoom: 1.024, src: "../assets/images/ending/chapter1/ch01_ending_06_underground_entrance.png", alt: "地下回廊の入口" },
  { start: ENDING_LYRICS[9].start, end: ENDING_LYRICS[9].end, zoom: 1.023, src: "../assets/images/ending/chapter1/ch01_ending_07_underground_corridor.png", alt: "地下回廊" },
  { start: ENDING_LYRICS[10].start, end: ENDING_LYRICS[10].end, zoom: 1.012, src: "../assets/images/ending/chapter1/sepia_bazooka_chronicle.webp", alt: "バズーカ王国物語の本" },
].map((slide) => ({ ...slide, zoomDuration: slide.end - slide.start }));

const ENDING_CREDITS = [
  { key: "production", title: "製作", lines: ["ChatGPT", "Codex", "SUNO"] },
  { key: "original", title: "原作・企画", lines: ["臥龍"] },
  { key: "scenario", title: "シナリオ", lines: ["臥龍", "ChatGPT"] },
  { key: "program", title: "プログラム", lines: ["Codex"] },
  { key: "background", title: "背景美術", lines: ["ChatGPT"] },
  { key: "images", title: "画像生成", lines: ["ChatGPT"] },
  { key: "music", title: "音楽", lines: ["SUNO"] },
  { key: "sound", title: "効果音", lines: ["ChatGPT"] },
  { key: "direction", title: "演出", lines: ["臥龍", "ChatGPT", "Codex"] },
  { key: "debug", title: "デバッグ", lines: ["臥龍", "Codex"] },
  { key: "voice", title: "声の出演", lines: ["バズ㌧", "バズーカ伯爵（友情出演）"] },
  { key: "thanks", title: "Special Thanks", lines: ["罵尻ロマ子様", "はげだんご様"] },
  { key: "support", title: "Thanks for the financial support", lines: ["バズーカ伯爵様", "こめ59様"] },
];

const endingManager = {
  audio: new Audio(),
  rafId: null,
  resumeHandler: null,
  skipDisplayTime: null,
  currentCard: "",
  isRunning: false,
  teaserTimers: [],
  endingPauseTimer: null,
  lyricTimer: null,
  currentLyric: "",
  currentLyricType: "",
  currentSlideIndex: -1,
  activePhotoLayer: 0,
  finishing: false,
  teaserStarted: false,

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.finishing = false;
    this.currentCard = "";
    this.currentLyric = "";
    this.currentLyricType = "";
    this.currentSlideIndex = -1;
    this.activePhotoLayer = 0;
    this.teaserStarted = false;
    this.clearEndingPause();
    this.clearTeaser();
    this.clearEndingPresentation();
    cancelAnimationFrame(this.rafId);
    if (this.resumeHandler) {
      elements.ending.removeEventListener("click", this.resumeHandler);
      this.resumeHandler = null;
    }

    audioManager.playBgm(null);
    audioManager.stopSceneSe();
    audioManager.stopVoice();
    ambienceManager.fadeOut(900);
    clearBookTransition();
    setCharacters([]);
    setNarratorIcon(null);
    setSceneEffect(null, false);
    elements.back.hidden = true;
    elements.dialoguePanel.classList.add("is-hidden");

    elements.ending.hidden = false;
    elements.endingSkip.hidden = true;
    this.setGlow(false);
    this.clearVisual();
    this.setContent("");
    await wait(350);

    this.audio.pause();
    this.audio = new Audio(ENDING_ASSETS.theme);
    this.audio.loop = false;
    this.audio.volume = 0;
    this.audio.addEventListener("ended", () => this.finish({ pauseBeforeTeaser: true }), { once: true });
    ENDING_SLIDES.forEach(({ src }) => {
      const image = new Image();
      image.src = src;
    });
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

    // 0～22秒は黒背景と章タイトルだけを見せます。
    if (time < ENDING_TITLE_END) {
      this.hidePhotoStage(true);
      this.setLyric("");
      const isLeaving = time >= ENDING_TITLE_END - 1.5;
      this.showCard("opening-title", `
        <div class="ending-opening-title">
          <h2>バズーカ王国物語</h2>
          <p>第一章</p>
        </div>
      `, null, false);
      elements.endingContent.querySelector(".ending-opening-title")?.classList.toggle("is-leaving", isLeaving);
      return;
    }

    if (time < ENDING_PHOTO_END) {
      this.showCard("photos", "", null, false);
      if (time < ENDING_PHOTO_FADE_START) this.renderPhoto(time);
      else this.hidePhotoStage();
      this.renderLyric(time);
      return;
    }

    this.hidePhotoStage();
    const duration = this.getAudioDuration();
    const finalTitleStart = Math.max(ENDING_CREDITS_START, duration - ENDING_FINAL_TITLE_DURATION);
    if (time < ENDING_CREDITS_START) {
      this.setLyric("");
      this.showCard("post-photos-pause", "", null, false);
      return;
    }
    if (time < finalTitleStart) {
      this.renderCredits(time, duration, finalTitleStart);
      this.renderLyric(time);
      return;
    }

    // 終了1秒前から消し、ended時点では文字を完全に残しません。
    this.setLyric("");
    const isLeaving = time >= duration - 1;
    this.showCard("ending-complete", `
      <div class="ending-complete">
        <h2 class="ending-complete__title">バズーカ王国物語</h2>
        <p class="ending-complete__chapter">第一章</p>
        <p class="ending-complete__end">完</p>
      </div>
    `, null, false);
    elements.endingContent.querySelector(".ending-complete")?.classList.toggle("is-leaving", isLeaving);
  },

  renderPhoto(time) {
    const slideIndex = ENDING_SLIDES.findIndex(({ start, end }) => time >= start && time < end);
    if (slideIndex < 0) {
      if (this.currentSlideIndex >= 0) {
        const activePhoto = elements.endingPhotos[this.activePhotoLayer];
        activePhoto.style.setProperty("--ending-photo-fade-out-duration", "0.25s");
        activePhoto.classList.add("is-fading-out");
        activePhoto.classList.remove("is-active");
        this.currentSlideIndex = -1;
      }
      return;
    }
    elements.endingPhotoStage.hidden = false;
    elements.endingPhotoStage.classList.remove("is-leaving");
    if (slideIndex === this.currentSlideIndex) return;

    const layerIndex = this.currentSlideIndex < 0 ? 0 : 1 - this.activePhotoLayer;
    const layer = elements.endingPhotos[layerIndex];
    const slide = ENDING_SLIDES[slideIndex];
    elements.endingPhotos.forEach((photo, index) => {
      photo.classList.remove("is-active", "is-fading-out", "is-hidden-immediate");
      if (index !== layerIndex) photo.classList.add("is-hidden-immediate");
    });
    layer.src = slide.src;
    layer.alt = slide.alt;
    layer.dataset.motion = "zoom";
    layer.style.setProperty("--ending-photo-zoom", String(slide.zoom));
    layer.style.setProperty("--ending-photo-zoom-duration", `${slide.zoomDuration}s`);
    layer.style.removeProperty("--ending-photo-fade-out-duration");
    layer.classList.remove("is-active", "is-fading-out", "is-hidden-immediate");
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("is-active")));
    this.activePhotoLayer = layerIndex;
    this.currentSlideIndex = slideIndex;
  },

  renderLyric(time) {
    const cue = ENDING_LYRICS.find(({ start, end }) => time >= start && time < end);
    this.setLyric(cue?.text || "", cue?.type || "");
  },

  setLyric(text, type = "") {
    if (this.currentLyric === text && this.currentLyricType === type) return;
    this.currentLyric = text;
    this.currentLyricType = type;
      clearTimeout(this.lyricTimer);
      elements.endingLyric.classList.remove("is-visible");
      if (!text) {
        elements.endingLyric.textContent = "";
        elements.endingLyric.classList.remove("ending-lyric--voice");
        return;
      }
      this.lyricTimer = setTimeout(() => {
        if (!this.isRunning || this.currentLyric !== text) return;
        // 表示テキストと専用スタイルを同じタイミングで更新し、
        // フェード中の旧テキストだけが通常サイズへ戻る瞬間を防ぐ。
        elements.endingLyric.classList.toggle("ending-lyric--voice", type === "voice");
        elements.endingLyric.textContent = text;
        elements.endingLyric.classList.add("is-visible");
      }, type === "voice" ? 60 : 180);
  },

  hidePhotoStage(immediate = false) {
    if (elements.endingPhotoStage.hidden) return;
    if (immediate) {
      elements.endingPhotoStage.hidden = true;
      elements.endingPhotoStage.classList.remove("is-leaving");
      return;
    }
    elements.endingPhotoStage.classList.add("is-leaving");
  },

  getAudioDuration() {
    const fallbackDuration = 224;
    return Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : fallbackDuration;
  },

  renderCredits(time, audioDuration = this.getAudioDuration(), creditsEnd = audioDuration - ENDING_FINAL_TITLE_DURATION) {
    const creditsStart = ENDING_CREDITS_START;
    const segmentDuration = (creditsEnd - creditsStart) / ENDING_CREDITS.length;
    const index = Math.min(
      ENDING_CREDITS.length - 1,
      Math.max(0, Math.floor((time - creditsStart) / segmentDuration)),
    );
    const credit = ENDING_CREDITS[index];
    const lines = credit.lines.map((line) => `<span>${line}</span>`).join("");
    const layoutClass = credit.key === "voice" ? " ending-roll-list--voice" : "";
    this.showCard(`credit-${credit.key}`, `
      <div class="ending-roll-list ending-roll-list--staff${layoutClass}">
        <strong>${credit.title}</strong>
        ${lines}
      </div>
    `, null, false);
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
    if (!this.isRunning || this.finishing) return;
    this.finish({ skipTeaser: true });
  },

  async finish({ skipTeaser = false, pauseBeforeTeaser = false } = {}) {
    if (!this.isRunning || this.finishing) return;
    this.finishing = true;
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.skipDisplayTime = null;
    if (this.resumeHandler) {
      elements.ending.removeEventListener("click", this.resumeHandler);
      this.resumeHandler = null;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
    this.setGlow(false);
    this.clearVisual();
    this.setContent("");
    this.clearEndingPresentation();
    elements.endingSkip.hidden = true;
    if (!skipTeaser) {
      // 曲のended後は、何も描画・再生しない黒画面を1秒だけ維持します。
      if (pauseBeforeTeaser) await this.waitForEndingPause();
      this.teaserStarted = true;
      await this.showChapter2Teaser();
      await wait(1600);
    }
    window.location.href = "index.html";
  },

  waitForEndingPause() {
    this.clearEndingPause();
    return new Promise((resolve) => {
      this.endingPauseTimer = window.setTimeout(() => {
        this.endingPauseTimer = null;
        resolve();
      }, ENDING_SILENT_PAUSE_MS);
    });
  },

  clearEndingPause() {
    clearTimeout(this.endingPauseTimer);
    this.endingPauseTimer = null;
  },

  /** エンドロール後の第二章予告。既存EndingManager内で完結させます。 */
  showChapter2Teaser() {
    if (!this.finishing || !this.teaserStarted) return Promise.resolve();
    this.clearTeaser();
    elements.chapter2Teaser.hidden = false;

    // DOMへ反映してから開始クラスを付け、フェードインを確実に発火させます。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => elements.chapter2Teaser.classList.add("is-active"));
    });

    return new Promise((resolve) => {
      this.teaserTimers.push(setTimeout(() => {
        elements.chapter2Teaser.classList.add("show-title");
      }, 3000));
      this.teaserTimers.push(setTimeout(() => {
        elements.chapter2Teaser.classList.add("show-chapter");
      }, 3700));
      this.teaserTimers.push(setTimeout(() => {
        elements.chapter2Teaser.classList.add("show-status");
      }, 4400));
      this.teaserTimers.push(setTimeout(() => elements.chapter2Teaser.classList.add("is-leaving"), 8400));
      this.teaserTimers.push(setTimeout(() => {
        this.clearTeaser();
        resolve();
      }, 9800));
    });
  },

  clearTeaser() {
    this.teaserTimers.forEach((timer) => clearTimeout(timer));
    this.teaserTimers = [];
    elements.chapter2Teaser.classList.remove(
      "is-active",
      "is-leaving",
      "show-title",
      "show-chapter",
      "show-status",
    );
    elements.chapter2Teaser.hidden = true;
  },

  clearEndingPresentation() {
    clearTimeout(this.lyricTimer);
    this.lyricTimer = null;
    this.currentLyric = "";
    this.currentLyricType = "";
    this.currentSlideIndex = -1;
    this.activePhotoLayer = 0;
    elements.endingLyric.textContent = "";
    elements.endingLyric.classList.remove("is-visible", "ending-lyric--voice");
    elements.endingPhotoStage.hidden = true;
    elements.endingPhotoStage.classList.remove("is-leaving");
    elements.endingPhotos.forEach((photo) => {
      photo.classList.remove("is-active");
      photo.removeAttribute("src");
      photo.removeAttribute("alt");
      photo.removeAttribute("data-motion");
    });
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
  elements.imaginationImage.className = "imagination-image imagination-romako";
  elements.imaginationHaze.className = "imagination-haze";
  elements.imaginationCaption.className = "imagination-caption";
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

/** ロマ子姫の想像を、霧の奥に一枚だけ浮かび上がらせます。 */
function playRomakoImagination(options = {}) {
  clearImaginationTimers();
  elements.imagination.className = "imagination-overlay is-romako-reveal";
  elements.imaginationImage.className = "imagination-image imagination-romako";
  elements.imaginationImage.src = options.src;
  elements.imaginationImage.alt = options.alt || "主人公が想像したロマ子姫";
  elements.imaginationHaze.className = "imagination-haze";
  elements.imaginationCaption.className = "imagination-caption";

  state.imaginationTimers.push(setTimeout(() => {
    elements.imaginationHaze.classList.add("is-active");
  }, options.hazeDelayMs ?? 800));
  state.imaginationTimers.push(setTimeout(() => {
    elements.imaginationImage.classList.add("is-visible");
  }, options.imageDelayMs ?? 1000));
  state.imaginationTimers.push(setTimeout(() => {
    elements.imaginationCaption.classList.add("is-visible");
  }, options.captionDelayMs ?? 1500));
  state.imaginationTimers.push(setTimeout(() => {
    fadeRomakoImagination(options.fadeDurationMs ?? 1000);
  }, options.fadeAtMs ?? 5000));
}

function fadeRomakoImagination(durationMs = 1000) {
  clearImaginationTimers();
  elements.imaginationImage.classList.remove("is-visible");
  elements.imaginationImage.classList.add("is-fading");
  elements.imaginationHaze.classList.remove("is-active");
  elements.imaginationHaze.classList.add("is-fading");
  elements.imaginationCaption.classList.remove("is-visible");
  state.imaginationTimers.push(setTimeout(() => setImagination(null), durationMs));
}

function clearImagination(effect = null) {
  clearImaginationTimers();
  if (effect === "mist" && elements.imagination.classList.contains("is-romako-reveal")) {
    fadeRomakoImagination(1800);
    return;
  }
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
    const hasCharacter = Boolean(character?.src);
    const shouldFadeIn = hasCharacter && character.enterEffect === "fade";
    const revealToken = String((Number(image.dataset.revealToken) || 0) + 1);
    image.dataset.revealToken = revealToken;
    image.classList.remove("is-visible", "is-fade-in", "is-fade-visible");
    if (character?.enterDurationMs) {
      image.style.setProperty("--character-enter-duration", `${character.enterDurationMs}ms`);
    } else {
      image.style.removeProperty("--character-enter-duration");
    }

    if (hasCharacter) {
      image.src = character.src;
      image.alt = character.name || "";
      if (shouldFadeIn) {
        // hidden/opacity:0 を描画してから、visibility と opacity を別フレームで更新します。
        image.classList.add("is-fade-in");
        requestAnimationFrame(() => {
          if (image.dataset.revealToken !== revealToken) return;
          image.classList.add("is-visible");
          requestAnimationFrame(() => {
            if (image.dataset.revealToken !== revealToken) return;
            image.classList.add("is-fade-visible");
          });
        });
      } else {
        image.classList.add("is-visible");
      }
    } else {
      image.removeAttribute("src");
      image.alt = "";
    }
  }
}

/** Scene途中から開いた場合も、同じScene内で直前に指定された舞台状態を復元します。 */
function getInheritedSceneValue(index, logicalScene, key) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const candidate = state.scenario.scenes[cursor];
    if ((candidate.scene || candidate.id) !== logicalScene) break;
    if (Object.hasOwn(candidate, key)) return candidate[key];
  }
  return undefined;
}

async function hideExplorationDialogue(fadeMs = 0) {
  clearTimeout(state.typingTimer);
  state.isTyping = false;
  state.fullText = "";
  elements.advance.dataset.state = "transitioning";
  elements.dialoguePanel.classList.add("is-hidden");
  if (fadeMs > 0) await wait(fadeMs);
  elements.dialogue.textContent = "";
  elements.speaker.textContent = "";
  setNarratorIcon(null);
}

function suppressDialogueUi(suppressed) {
  elements.advance.classList.toggle("is-dialogue-suppressed", suppressed);
  if (suppressed) {
    elements.dialogue.textContent = "";
    elements.speaker.textContent = "";
    setNarratorIcon(null);
  }
}

function waitForPaint(frames = 1) {
  return new Promise((resolve) => {
    const nextFrame = (remaining) => {
      window.requestAnimationFrame(() => {
        if (remaining <= 1) resolve();
        else nextFrame(remaining - 1);
      });
    };
    nextFrame(Math.max(frames, 1));
  });
}

function showExplorationLine(line) {
  if (line.stopAmbienceBefore) ambienceManager.stop();
  const isNarrator = Boolean(line.narrator);
  const speaker = line.speaker === "主人公"
    ? state.variables.playerName
    : formatText(line.speaker || "");
  elements.speaker.textContent = line.hideName ? "" : speaker;
  setNarratorIcon(
    isNarrator ? undergroundExploration.data.narratorIcon : null,
    "ガリュ㌧",
  );
  elements.dialoguePanel.classList.remove("is-hidden");
  typeDialogue(formatText(line.text || ""), line.typeInterval ?? CONFIG.typeInterval);
}

async function setExplorationRoom(room, moving) {
  const duration = moving ? 320 : 0;
  if (room.ambienceFadeOutOnEnterMs) {
    ambienceManager.fadeOut(room.ambienceFadeOutOnEnterMs);
  }
  if (moving) {
    elements.fader.style.transitionDuration = `${duration}ms`;
    elements.fader.classList.add("is-dark");
    const movement = undergroundExploration.data.movementSe;
    if (movement?.src) {
      audioManager.playSe(movement.src, movement.volume ?? 0.48, { trackScene: true });
    }
    await wait(duration);
  }

  if (room.stopMovementOnEnter) {
    clearScheduledSe();
    audioManager.stopSceneSe();
  }

  await preloadImage(room.background);
  setBackground(room.background);
  setCharacters(room.characters || []);
  setNarratorIcon(null);
  setSceneEffect(room.effect || "dim", false);
  if (Object.hasOwn(room, "ambience")) {
    if (room.ambience?.src) {
      ambienceManager.set(room.ambience.src, room.ambience.volume ?? 0.18, {
        fadeInMs: room.ambience.fadeInMs ?? 500,
      });
    } else {
      ambienceManager.stop();
    }
  }
  if (room.bgmFadeOutOnEnterMs) {
    audioManager.fadeBgmOut(room.bgmFadeOutOnEnterMs);
  }

  if (moving) {
    elements.fader.classList.remove("is-dark");
    await wait(duration);
    elements.fader.style.removeProperty("transition-duration");
  }
}

async function continueFromExplorationTrueEnd() {
  elements.exploration.hidden = true;
  setCharacters([]);
  setNarratorIcon(null);
  setSceneEffect("dim", false);

  // 最後の独白を消し切り、枠・名前欄・送りカーソルを残さず静寂へ移ります。
  await hideExplorationDialogue(900);
  suppressDialogueUi(true);
  await waitForPaint(2);
  clearScheduledSe();
  audioManager.stopSceneSe();
  audioManager.stopBgm();
  ambienceManager.fadeOut(800);
  await wait(800);
  ambienceManager.stop();

  // 理屈で説明できない、音もUIもない完全な静寂を十分に見せます。
  await wait(2600);

  const targetIndex = state.scenario.scenes.findIndex((scene) => scene.id === "scene009-19");
  if (targetIndex < 0) throw new Error("TRUEルート接続先 scene009-19 がありません");
  state.sceneIndex = targetIndex;
  state.isTransitioning = false;
  await renderScene(targetIndex, false);
}

async function startUndergroundExploration() {
  if (!undergroundExploration) {
    undergroundExploration = new window.ExplorationManager({
      dataUrl: "data/chapter1-underground.json?v=20260806-final-stage-2",
      elements: {
        root: elements.exploration,
        location: elements.explorationLocation,
        choices: elements.explorationChoices,
        status: elements.explorationStatus,
      },
      callbacks: {
        format: formatText,
        setRoom: setExplorationRoom,
        showLine: showExplorationLine,
        hideDialogue: hideExplorationDialogue,
        startAmbience: async (ambience) => {
          if (!ambience?.src) return;
          ambienceManager.set(ambience.src, ambience.volume ?? 0.18, {
            fadeInMs: ambience.fadeInMs ?? 500,
          });
        },
        onActiveChange: (active) => {
          elements.game.dataset.exploration = active ? "active" : "inactive";
        },
        onTrue: continueFromExplorationTrueEnd,
      },
    });
  }
  await undergroundExploration.start();
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
  const isBazutonEntrance = ["scene009-19", "scene009-20", "scene009-21"].includes(scene.id);
  if (isBazutonEntrance) suppressDialogueUi(true);

  state.isTransitioning = true;
  clearTimeout(state.typingTimer);
  clearAutoAdvance();
  clearScheduledSe();
  clearScheduledVoice();

  // CGだけを見せる待機や入力UIへの切り替えでは、転換開始時から空の会話欄を隠します。
  if (
    scene.startDelayMs
    || scene.action === "wait"
    || scene.action === "nameInput"
    || scene.action === "exploration"
    || scene.transitionLabel
    || scene.hideDialogue
  ) {
    elements.dialoguePanel.classList.add("is-hidden");
  }

  const transitionDuration = scene.transitionDurationMs ?? CONFIG.transitionDuration;
  const usesBackgroundCrossfade = useTransition && scene.transitionMode === "crossfade";

  if (useTransition && !usesBackgroundCrossfade) {
    elements.fader.style.transitionDuration = `${transitionDuration}ms`;
    elements.fader.classList.add("is-dark");
    if (scene.revealOnly) {
      // 完全暗転を作ってから重要CGへ切り替えます。
      await wait(transitionDuration);
      if (scene.transitionBlackHoldMs) await wait(scene.transitionBlackHoldMs);
    } else {
      await wait(transitionDuration);
      // 場面ごとに指定された短い黒画面の余韻を、背景差し替え前に保持します。
      if (scene.transitionBlackHoldMs) {
        await wait(scene.transitionBlackHoldMs);
      }
    }

    if (scene.transitionLabel) {
      const captionTextFadeInMs = scene.transitionLabelFadeInMs ?? 250;
      const captionPanelFadeInMs = scene.transitionLabelPanelFadeInMs ?? captionTextFadeInMs;
      const captionBlackHoldMs = scene.transitionLabelBlackHoldMs ?? 0;
      const captionTextDelayMs = scene.transitionLabelTextDelayMs ?? 0;
      const captionFadeOutMs = scene.transitionLabelFadeOutMs ?? 250;
      // 既存DOMを初期非表示へ確定してから、字幕を一度だけ設定します。
      // 通常表示のopacity:1からcaption用opacity:0へ遷移する点滅を防ぎます。
      elements.dialoguePanel.classList.add("is-transition-caption");
      elements.dialoguePanel.classList.add("is-caption-preparing");
      elements.dialoguePanel.classList.remove("is-caption-text-visible");
      elements.dialoguePanel.style.setProperty("--transition-caption-fade", `${captionPanelFadeInMs}ms`);
      elements.dialoguePanel.style.setProperty("--transition-caption-text-fade", `${captionTextFadeInMs}ms`);
      elements.speaker.textContent = "";
      elements.dialogue.textContent = formatText(scene.transitionLabel);
      setNarratorIcon(null);
      elements.advance.dataset.state = "transitioning";
      if (captionBlackHoldMs) await wait(captionBlackHoldMs);
      // 黒画面の余白が終わってから、会話枠を暗転レイヤーより前へ出します。
      elements.dialoguePanel.classList.remove("is-caption-preparing");
      elements.advance.classList.add("is-transition-caption");
      elements.dialoguePanel.classList.remove("is-hidden");
      await wait(captionPanelFadeInMs);
      if (captionTextDelayMs) await wait(captionTextDelayMs);
      elements.dialoguePanel.classList.add("is-caption-text-visible");
      await wait(captionTextFadeInMs);
      await wait(scene.transitionLabelHoldMs ?? scene.transitionLabelMs ?? 900);
      elements.dialoguePanel.style.setProperty("--transition-caption-fade", `${captionFadeOutMs}ms`);
      elements.dialoguePanel.style.setProperty("--transition-caption-text-fade", `${captionFadeOutMs}ms`);
      elements.dialoguePanel.classList.remove("is-caption-text-visible");
      elements.dialoguePanel.classList.add("is-hidden");
      await wait(captionFadeOutMs);
      elements.dialogue.textContent = "";
      elements.dialoguePanel.style.removeProperty("--transition-caption-fade");
      elements.dialoguePanel.style.removeProperty("--transition-caption-text-fade");
      elements.dialoguePanel.classList.remove("is-transition-caption");
      elements.dialoguePanel.classList.remove("is-caption-preparing");
      elements.advance.classList.remove("is-transition-caption");
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

  const inheritedBackground = isNewLogicalScene
    ? getInheritedSceneValue(index, logicalScene, "background")
    : undefined;
  const background = Object.hasOwn(scene, "background") ? scene.background : inheritedBackground;
  if (background !== undefined) {
    if (usesBackgroundCrossfade && background) {
      await crossfadeBackground(background, transitionDuration);
    } else {
      setBackground(background);
    }
  } else if (isNewLogicalScene) {
    setBackground(defaults.background ?? null);
  }
  const inheritedCharacters = isNewLogicalScene
    ? getInheritedSceneValue(index, logicalScene, "characters")
    : undefined;
  const characters = Object.hasOwn(scene, "characters") ? scene.characters : inheritedCharacters;
  if (characters !== undefined) setCharacters(characters || []);
  if (Object.hasOwn(scene, "icon")) setNarratorIcon(scene.icon, scene.iconAlt);
  if (Object.hasOwn(scene, "effect") || Object.hasOwn(scene, "characterGlow")) {
    setSceneEffect(scene.effect || null, Boolean(scene.characterGlow));
  }
  if (Object.hasOwn(scene, "imagination")) {
    if (scene.imagination) setImagination(scene.imagination.src, scene.imagination);
    else clearImagination(scene.imaginationEffect || null);
  }
  if (scene.imaginationReveal) playRomakoImagination(scene.imaginationReveal);
  if (scene.imaginationSequence) playImaginationSequence(scene.imaginationSequence);
  if (Object.hasOwn(scene, "reaction")) {
    setReactionMark(scene.reaction, scene.reactionDurationMs ?? 900);
  }

  elements.back.hidden = logicalScene === "scene000";
  // イベントCGなど、話者情報を保持しつつ名前欄だけ隠す演出に対応します。
  const nameInputIndex = state.scenario.scenes.findIndex((item) => item.action === "nameInput");
  const usesPlayerName = scene.speaker === "主人公" && index > nameInputIndex;
  const displaySpeaker = usesPlayerName ? state.variables.playerName : scene.speaker;
  elements.speaker.textContent = scene.hideName ? "" : formatText(displaySpeaker || "");
  const inheritedBgm = isNewLogicalScene
    ? getInheritedSceneValue(index, logicalScene, "bgm")
    : undefined;
  const bgm = Object.hasOwn(scene, "bgm") ? scene.bgm : inheritedBgm;
  if (bgm !== undefined) {
    const bgmSource = Object.hasOwn(scene, "bgm")
      ? scene
      : state.scenario.scenes.slice(0, index + 1).reverse().find((candidate) => (
        (candidate.scene || candidate.id) === logicalScene && Object.hasOwn(candidate, "bgm")
      ));
    audioManager.playBgm(bgm, bgmSource?.bgmVolume, {
      fadeInMs: bgmSource?.bgmFadeInMs,
      fadeOutMs: bgmSource?.bgmFadeOutMs,
    });
  } else if (isNewLogicalScene) {
    audioManager.playBgm(defaults.bgm ?? null);
  }
  if (Object.hasOwn(scene, "ambience")) {
    ambienceManager.set(scene.ambience, scene.ambienceVolume, {
      fadeInMs: scene.ambienceFadeInMs,
      fadeToMs: scene.ambienceFadeToMs,
    });
  } else if (isNewLogicalScene) {
    ambienceManager.set(defaults.ambience ?? null);
  }
  if (scene.stopAmbientSeKey) {
    audioManager.stopAmbientSe(scene.stopAmbientSeKey);
  }
  if (scene.ambientSe) {
    audioManager.playAmbientSe(
      scene.ambientSe,
      scene.ambientSeVolume,
      scene.ambientSeKey || scene.ambientSe,
      scene.ambientSeFadeToMs,
    );
  }
  if (scene.se) {
    if (scene.seDelayMs) {
      state.seTimer = setTimeout(() => audioManager.playSe(scene.se, scene.seVolume, {
        trackScene: true,
        key: scene.seKey,
      }), scene.seDelayMs);
    } else {
      audioManager.playSe(scene.se, scene.seVolume, { trackScene: true, key: scene.seKey });
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

  if (scene.action !== "ending") {
    elements.fader.classList.remove("is-dark");
    // フェードイン完了までは入力を受けず、連続タップによる読み飛ばしを防ぎます。
    if (useTransition && !usesBackgroundCrossfade) {
      await wait(transitionDuration);
      elements.fader.style.removeProperty("transition-duration");
    }
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
  if (scene.action === "exploration") {
    state.isTransitioning = false;
    try {
      await startUndergroundExploration();
    } catch (error) {
      elements.error.textContent = "地下探索を開始できませんでした。";
      console.error("Exploration loading failed:", error);
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
    // EndingManagerの黒いオーバーレイを表示してから、暗転レイヤーを開放します。
    elements.fader.classList.remove("is-dark");
    elements.fader.style.removeProperty("transition-duration");
    return;
  }

  if (scene.hideDialogue) {
    elements.dialoguePanel.classList.add("is-hidden");
    state.isTransitioning = false;
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

  if (undergroundExploration?.active) {
    await undergroundExploration.advance();
    return;
  }

  // nextSceneId があれば章・場所をまたぐ明示的な遷移を優先します。
  const currentScene = state.scenario.scenes[state.sceneIndex];
  if (currentScene.action) return;
  const nextIndex = getNextIndex(currentScene);

  if (currentScene.waitForVoiceEnd) {
    state.isTransitioning = true;
    await audioManager.waitForVoiceEnd(currentScene.voiceWaitTimeoutMs ?? 8000);
    await wait(currentScene.endingHoldMs ?? 1000);
  }

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
  const searchParams = new URLSearchParams(window.location.search);
  if (!searchParams.get("scene") && searchParams.get("start") !== "1") {
    window.location.replace("index.html?v=20260801-final-polish");
    return;
  }

  try {
    const response = await fetch(CONFIG.scenarioUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const scenario = await response.json();
    if (!Array.isArray(scenario.scenes) || scenario.scenes.length === 0) {
      throw new Error("シーンがありません");
    }

    state.scenario = scenario;
    const requestedSceneId = searchParams.get("scene");
    const requestedIndex = requestedSceneId
      ? scenario.scenes.findIndex((scene) => scene.id === requestedSceneId || scene.scene === requestedSceneId)
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
  audioManager.resumePendingBgm();
  audioManager.resumePendingSe();
  audioManager.resumePendingAmbientSe();
  audioManager.resumePendingVoice();
  ambienceManager.resume().catch(() => {});
});
elements.advance.addEventListener("click", (event) => {
  audioManager.resumePendingBgm();
  audioManager.resumePendingSe();
  audioManager.resumePendingAmbientSe();
  audioManager.resumePendingVoice();
  ambienceManager.resume().catch(() => {});
  // detail=0 はEnter/Spaceなどのキーボード操作です。
  if (event.detail === 0) state.interactionId += 1;
  if (state.handledInteractionId === state.interactionId) return;
  state.handledInteractionId = state.interactionId;
  advanceStory();
});
elements.back.addEventListener("click", () => {
  undergroundExploration?.stop();
  ambienceManager.stop();
  endingManager.clearTeaser();
  window.location.href = "index.html";
});
elements.chapterEndBack.addEventListener("click", () => {
  endingManager.clearTeaser();
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

// 終幕中にページが閉じられた場合も、残っている時限処理を破棄します。
window.addEventListener("pagehide", () => {
  undergroundExploration?.stop();
  endingManager.clearEndingPause();
  endingManager.clearTeaser();
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
