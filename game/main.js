const titleScreen = document.querySelector("#title-screen");
const novelScreen = document.querySelector("#novel-screen");
const startButton = document.querySelector("#start-button");
const backButton = document.querySelector("#back-button");
const dialogueBox = document.querySelector("#dialogue-box");
const speakerElement = document.querySelector("#speaker");
const dialogueElement = document.querySelector("#dialogue");
const sceneLabel = document.querySelector("#scene-label");
const loadError = document.querySelector("#load-error");

let storySteps = [];
let currentStep = 0;

function cleanMarkdown(line) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^・/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function parseStory(markdown) {
  const steps = [];
  let scene = "第一章";
  let pendingSpeaker = "";

  for (const sourceLine of markdown.split(/\r?\n/)) {
    const raw = sourceLine.trim();
    if (!raw || raw === "---" || raw === "↓") continue;

    const text = cleanMarkdown(raw);
    if (!text || text === "STORY_01") continue;

    if (/^シーン\d+/.test(text) || /^第一話/.test(text)) {
      scene = text;
      pendingSpeaker = "";
      continue;
    }

    const isDialogue = /^[「『].+[」』]$/.test(text);
    const isDirection = /^(背景|BGM|タップ|決定|主人公名入力|画面暗転|その夜|どこからか|暗い通路|何かが|光の中から|第一話 完)/.test(text);

    if (!isDialogue && !isDirection && text.length <= 18) {
      pendingSpeaker = text.replace(/（.*?）/g, "");
      continue;
    }

    steps.push({
      scene,
      speaker: isDialogue ? pendingSpeaker : "",
      text,
    });
  }

  return steps;
}

function renderStep() {
  if (!storySteps.length) return;

  if (currentStep >= storySteps.length) {
    speakerElement.textContent = "";
    dialogueElement.textContent = "第一話 完　― タップしてタイトルへ ―";
    sceneLabel.textContent = "バズーカ王国物語";
    dialogueBox.dataset.finished = "true";
    return;
  }

  const step = storySteps[currentStep];
  speakerElement.textContent = step.speaker;
  dialogueElement.textContent = step.text;
  sceneLabel.textContent = step.scene;
  dialogueBox.dataset.finished = "false";
}

function showTitle() {
  novelScreen.classList.remove("is-active");
  titleScreen.classList.add("is-active");
  startButton.focus();
}

async function startStory() {
  titleScreen.classList.remove("is-active");
  novelScreen.classList.add("is-active");
  loadError.textContent = "";
  dialogueElement.textContent = "読み込み中…";
  speakerElement.textContent = "";

  try {
    const response = await fetch("../STORY_01.md");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    storySteps = parseStory(await response.text());
    if (!storySteps.length) throw new Error("物語データが空です");
    currentStep = 0;
    renderStep();
    dialogueBox.focus();
  } catch (error) {
    dialogueElement.textContent = "物語を読み込めませんでした。";
    loadError.textContent = "ローカルサーバー経由で game/index.html を開いてください。";
    console.error(error);
  }
}

startButton.addEventListener("click", startStory);
backButton.addEventListener("click", showTitle);
dialogueBox.addEventListener("click", () => {
  if (dialogueBox.dataset.finished === "true") {
    showTitle();
    return;
  }
  currentStep += 1;
  renderStep();
});
