"use strict";

// タイトル画面の操作をこのファイルにまとめ、表示用コードと分離します。
const startButton = document.querySelector("#start-button");
const titleContent = document.querySelector(".title-content");

/**
 * 「はじめから」で物語画面へ移動します。
 * 相対URLなので、ローカル環境とGitHub Pagesのどちらでも動作します。
 */
function startNewGame() {
  titleContent.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = "story.html";
  }, 520);
}

startButton.addEventListener("click", startNewGame);
