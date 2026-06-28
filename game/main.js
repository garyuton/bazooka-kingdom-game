"use strict";

// タイトル画面の操作をこのファイルにまとめ、表示用コードと分離します。
const startButton = document.querySelector("#start-button");

/**
 * 「はじめから」で物語画面へ移動します。
 * 相対URLなので、ローカル環境とGitHub Pagesのどちらでも動作します。
 */
function startNewGame() {
  window.location.href = "story.html";
}

startButton.addEventListener("click", startNewGame);
