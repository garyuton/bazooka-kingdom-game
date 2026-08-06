"use strict";

/**
 * 部屋単位の探索を扱う汎用マネージャー。
 *
 * マップ、台詞、分岐はJSONへ置き、画面・音響の実処理はコールバックへ委譲する。
 * Chapter2以降でも別データを渡すだけで再利用できる構造にしている。
 */
class ExplorationManager {
  constructor(options) {
    this.dataUrl = options.dataUrl;
    this.elements = options.elements;
    this.callbacks = options.callbacks;
    this.data = null;
    this.active = false;
    this.busy = false;
    this.currentRoomId = null;
    this.previousRoomId = null;
    this.visitedRooms = new Set();
    this.narratedRooms = new Set();
    this.completedActions = new Set();
    this.lineQueue = [];
    this.lineIndex = -1;
    this.afterLines = null;
    this.ambienceStarted = false;

    this.elements.root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !this.active || this.busy || this.elements.root.hidden) return;
      const focusedChoice = event.target.closest?.(".exploration-choice");
      const choiceButton = focusedChoice || this.elements.choices.querySelector(".exploration-choice");
      if (!choiceButton) return;
      // ブラウザごとのbutton既定動作に依存せず、Enterを一度の選択として扱う。
      event.preventDefault();
      choiceButton.click();
    });
  }

  async load() {
    if (this.data) return this.data;
    const response = await fetch(this.dataUrl);
    if (!response.ok) throw new Error(`探索データを読み込めませんでした: HTTP ${response.status}`);
    this.data = await response.json();
    if (!this.data.rooms || !this.data.startRoom) {
      throw new Error("探索データに rooms または startRoom がありません");
    }
    return this.data;
  }

  /** 探索開始時に、この探索内だけで使うフラグを初期化する。 */
  resetFlags() {
    this.currentRoomId = null;
    this.previousRoomId = null;
    this.visitedRooms.clear();
    this.narratedRooms.clear();
    this.completedActions.clear();
    this.lineQueue = [];
    this.lineIndex = -1;
    this.afterLines = null;
    this.ambienceStarted = false;
  }

  async startAmbienceOnce() {
    if (this.ambienceStarted || !this.data.ambience) return;
    this.ambienceStarted = true;
    await this.callbacks.startAmbience(this.data.ambience);
  }

  async start() {
    await this.load();
    this.resetFlags();
    this.active = true;
    this.busy = true;
    this.elements.root.hidden = true;
    this.callbacks.onActiveChange(true);
    if (!this.data.ambience?.startAfterRoomLines) {
      await this.startAmbienceOnce();
    }
    await this.enterRoom(this.data.startRoom, false);
  }

  stop(options = {}) {
    this.active = false;
    this.busy = false;
    this.lineQueue = [];
    this.lineIndex = -1;
    this.afterLines = null;
    this.elements.root.hidden = true;
    this.callbacks.onActiveChange(false);
  }

  async enterRoom(roomId, moving = true) {
    if (!this.active) return;
    const room = this.data.rooms[roomId];
    if (!room) throw new Error(`探索先の部屋がありません: ${roomId}`);

    this.busy = true;
    this.elements.root.hidden = true;
    const firstVisit = !this.visitedRooms.has(roomId);
    const previousRoomId = this.currentRoomId;
    this.previousRoomId = previousRoomId;
    this.currentRoomId = roomId;
    this.visitedRooms.add(roomId);
    await this.callbacks.setRoom(room, moving);

    const lines = firstVisit
      ? (room.firstVisitLinesByPrevious?.[previousRoomId] || room.firstVisitLines || [])
      : (room.revisitLines || []);
    if (firstVisit) this.narratedRooms.add(roomId);

    const afterLines = async () => {
      if (room.startAmbienceAfterLines) {
        await this.startAmbienceOnce();
      }
      if (room.nextRoom) {
        await this.enterRoom(room.nextRoom, room.playFootsteps !== false);
      } else if (room.onComplete) {
        await this.completeRoute(room.onComplete);
      } else {
        this.showChoices(room);
      }
    };

    if (lines.length) {
      this.beginLines(lines, afterLines);
    } else {
      await afterLines();
    }
    this.busy = false;
  }

  beginLines(lines, afterLines) {
    this.lineQueue = lines;
    this.lineIndex = 0;
    this.afterLines = afterLines;
    this.callbacks.showLine(this.lineQueue[0]);
  }

  async advance() {
    if (!this.active || this.busy || this.lineIndex < 0) return;
    if (this.lineIndex + 1 < this.lineQueue.length) {
      this.lineIndex += 1;
      this.callbacks.showLine(this.lineQueue[this.lineIndex]);
      return;
    }

    this.lineQueue = [];
    this.lineIndex = -1;
    const completion = this.afterLines;
    this.afterLines = null;
    if (completion) {
      this.busy = true;
      await completion();
      this.busy = false;
    }
  }

  exploredRoomCount() {
    const targets = new Set(this.data.explorationRooms || []);
    return Array.from(this.visitedRooms).filter((roomId) => targets.has(roomId)).length;
  }

  showChoices(room) {
    this.callbacks.hideDialogue();
    this.elements.location.textContent = room.title || "";
    this.elements.choices.replaceChildren();

    const exploredCount = this.exploredRoomCount();
    const choices = (room.choices || []).filter((choice) => (
      (!choice.requiresExploredCount || exploredCount >= choice.requiresExploredCount)
      && (!choice.id || !this.completedActions.has(choice.id))
    ));

    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "exploration-choice";
      const wasVisited = Boolean(choice.to && this.visitedRooms.has(choice.to));
      button.textContent = `${choice.label}${choice.markVisited && wasVisited ? "（探索済み）" : ""}`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.choose(choice);
      });
      this.elements.choices.append(button);
    });

    const missing = Math.max((this.data.requiredExploredRooms || 0) - exploredCount, 0);
    this.elements.status.textContent = missing > 0
      ? this.callbacks.format(this.data.lockedHint || `あと${missing}か所を探索しよう。`)
        .replace("{remaining}", String(missing))
      : (room.unlockedHint || "");
    this.elements.root.hidden = false;
    this.elements.choices.querySelector("button")?.focus({ preventScroll: true });
  }

  async choose(choice) {
    if (!this.active || this.busy) return;
    this.busy = true;
    this.elements.root.hidden = true;

    if (choice.id) this.completedActions.add(choice.id);
    if (choice.resultLines?.length) {
      this.beginLines(choice.resultLines, async () => {
        if (choice.to) {
          await this.enterRoom(choice.to, choice.playFootsteps !== false);
        }
      });
      this.busy = false;
      return;
    }

    await this.enterRoom(choice.to, choice.playFootsteps !== false);
    this.busy = false;
  }

  async completeRoute(routeId) {
    if (routeId !== "true") throw new Error(`未対応の探索終了です: ${routeId}`);
    this.active = false;
    this.callbacks.onActiveChange(false);
    await this.callbacks.onTrue();
  }
}

window.ExplorationManager = ExplorationManager;
