// src/components/WatchPartySync.js
const VIDFAST_ORIGINS = [
  "https://vidfast.pro",
  "https://vidfast.in",
  "https://vidfast.io",
  "https://vidfast.me",
  "https://vidfast.net",
  "https://vidfast.pm",
  "https://vidfast.xyz",
];

const HOST_SYNC_THROTTLE_MS = 800;

const debugLog = () => {};

class WatchPartySync {
  constructor(iframe, transport, isHost, isMobile = false) {
    this.iframe = iframe;
    this.transport = transport;
    this.isHost = isHost;
    this.isMobile = isMobile;

    this.allowedOrigins = VIDFAST_ORIGINS;
    this.lastBroadcastAt = 0;
    this.lastKnownHostTime = 0;
    this.isApplyingRemoteCommand = false;
    this.isSyncing = false;
    this.messageHandler = null;

    this.setupEventListeners();
  }

  sendToPlayer(command, payload = {}) {
    if (!this.iframe?.contentWindow) {
      return false;
    }

    try {
      this.iframe.contentWindow.postMessage({ command, ...payload }, "*");
      return true;
    } catch (error) {
      console.error("WatchPartySync: sendToPlayer failed:", command, error);
      return false;
    }
  }

  broadcastAction(action, time) {
    if (!this.isHost) {
      return;
    }

    const sentAt = Date.now();
    const throttleMs = action === "sync" ? HOST_SYNC_THROTTLE_MS : 0;
    if (sentAt - this.lastBroadcastAt < throttleMs) {
      return;
    }

    this.lastBroadcastAt = sentAt;
    this.transport?.send({
      action,
      time: Math.floor(time),
      sentAt,
      senderId: this.transport?.senderId || "unknown",
      roomId: this.transport?.roomId || "unknown",
    });
  }

  handlePartyCommand(command) {
    // Viewers only. Host should never apply incoming room commands.
    if (this.isHost) {
      return;
    }

    const { action, time, sentAt } = command;
    const now = Date.now();

    if (sentAt && now - sentAt > 7000) {
      console.warn("WatchPartySync: dropped stale command", command);
      return;
    }

    const latency = sentAt ? (now - sentAt) / 1000 : 0;
    const adjustedTime = Math.floor((time || 0) + latency);
    this.lastKnownHostTime = adjustedTime;

    this.isApplyingRemoteCommand = true;
    this.isSyncing = true;

    switch (action) {
      case "play":
        this.sendToPlayer("seek", { time: adjustedTime });
        this.sendToPlayer("play");
        break;
      case "pause":
        this.sendToPlayer("seek", { time: adjustedTime });
        this.sendToPlayer("pause");
        break;
      case "seek":
        this.sendToPlayer("seek", { time: adjustedTime });
        break;
      default:
        break;
    }

    setTimeout(() => {
      this.isApplyingRemoteCommand = false;
      this.isSyncing = false;
    }, 600);
  }

  syncToHost(hostState) {
    if (this.isHost) {
      return;
    }

    const attemptSync = (attempts = 0) => {
      if (attempts >= 5) {
        return;
      }

      if (!this.iframe?.contentWindow) {
        setTimeout(() => attemptSync(attempts + 1), 350);
        return;
      }

      setTimeout(() => {
        const targetTime = Math.floor(hostState?.time || 0);
        this.lastKnownHostTime = targetTime;
        this.sendToPlayer("seek", { time: targetTime });

        if (hostState?.playing) {
          this.sendToPlayer("play");
        } else {
          this.sendToPlayer("pause");
        }
      }, 700);
    };

    attemptSync();
  }

  setupEventListeners() {
    this.messageHandler = (event) => {
      if (!this.allowedOrigins.includes(event.origin)) {
        return;
      }

      if (!event.data || event.data.type !== "PLAYER_EVENT") {
        return;
      }

      if (this.isApplyingRemoteCommand) {
        return;
      }

      const { event: playerEvent, currentTime } = event.data.data || {};
      this.lastKnownHostTime = Number.isFinite(currentTime)
        ? currentTime
        : this.lastKnownHostTime;

      if (!this.isHost) {
        return;
      }

      switch (playerEvent) {
        case "play":
          this.broadcastAction("play", currentTime || 0);
          break;
        case "pause":
          this.broadcastAction("pause", currentTime || 0);
          break;
        case "seeked":
          this.broadcastAction("seek", currentTime || 0);
          break;
        default:
          debugLog("WatchPartySync: ignored player event", { playerEvent });
          break;
      }
    };

    window.addEventListener("message", this.messageHandler);
  }

  play(time) {
    if (time !== undefined) {
      this.seek(time);
      return;
    }

    this.sendToPlayer("play");
    if (this.isHost) {
      this.broadcastAction("play", this.lastKnownHostTime);
    }
  }

  pause(time) {
    if (time !== undefined) {
      this.seek(time);
      return;
    }

    this.sendToPlayer("pause");
    if (this.isHost) {
      this.broadcastAction("pause", this.lastKnownHostTime);
    }
  }

  seek(time) {
    const seekTime = Math.floor(time || 0);
    this.sendToPlayer("seek", { time: seekTime });
    this.lastKnownHostTime = seekTime;
    if (this.isHost) {
      this.broadcastAction("seek", seekTime);
    }
  }

  setVolume(level) {
    this.sendToPlayer("volume", { level });
    if (this.isHost) {
      this.broadcastAction("volume", this.lastKnownHostTime);
    }
  }

  toggleMute(muted) {
    this.sendToPlayer("mute", { muted });
    if (this.isHost) {
      this.broadcastAction("mute", this.lastKnownHostTime);
    }
  }

  playPause() {
    this.sendToPlayer("play");
    if (this.isHost) {
      this.broadcastAction("play", this.lastKnownHostTime);
    }
  }

  destroy() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
    }
  }
}

export default WatchPartySync;
