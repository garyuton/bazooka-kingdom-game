"use strict";

// ダミー画面からタイトルへ戻る操作。物語機能は今後ここへ追加します。
const backButton = document.querySelector("#back-button");

function returnToTitle() {
  window.location.href = "index.html";
}

backButton.addEventListener("click", returnToTitle);
