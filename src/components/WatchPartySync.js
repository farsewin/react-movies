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

class WatchPartySync {
  constructor(iframe, transport, isHost, isMobile = false) {
    this.iframe = iframe;
    this.transport = transport;
    this.isHost = isHost;
    this.isMobile = isMobile;

    // Internal state
    this.allowedOrigins = VIDFAST_ORIGINS;
    this.lastBroadcastAt = 0;
    this.pendingStatusResolve = null;
    this.pendingStatusTimeout = null;
    this.isApplyingRemoteCommand = false;
    this.lastKnownHostTime = 0;
    this.driftInterval = null;
    this.messageHandler = null;
    this.retryAttempts = 0;
    this.maxRetries = 3;
    this.retryDelay = 250;
    this.isSyncing = false; // Add isSyncing property for UI feedback

    // Initialize
    this.setupEventListeners();
    // Delay drift correction start to ensure iframe is ready
    setTimeout(() => this.startDriftCorrection(), 2000);
  }

  // 2) Implement secure sendToPlayer method
  sendToPlayer(command, payload = {}) {
    if (!this.iframe?.contentWindow) {
      console.warn("WatchPartySync: iframe not ready for command:", command);
      return false;
    }

    try {
      const message = { command, ...payload };
      this.iframe.contentWindow.postMessage(message, "*");
      return true;
    } catch (error) {
      console.error("WatchPartySync: failed to send command:", command, error);
      return false;
    }
  }

  // 3) Define standard sync command schema and broadcastAction
  broadcastAction(action, time) {
    if (!this.isHost) return;

    const sentAt = Date.now();

    // Throttling: 1000ms for time sync, immediate for play/pause/seek
    const throttleMs = action === "sync" ? 1000 : 0;
    if (sentAt - this.lastBroadcastAt < throttleMs) return;

    this.lastBroadcastAt = sentAt;

    const command = {
      action,
      time: Math.floor(time), // Integer seconds
      sentAt,
      senderId: this.transport?.senderId || "unknown",
      roomId: this.transport?.roomId || "unknown",
    };

    this.transport.send(command);
  }

  // 5) Implement handlePartyCommand with loop suppression and stale filtering
  handlePartyCommand(command) {
    if (this.isHost && command.senderId !== this.transport?.senderId) return;

    const { action, time, sentAt } = command;
    const now = Date.now();

    // Stale command filtering (5 seconds)
    if (sentAt && now - sentAt > 5000) {
      console.warn("WatchPartySync: ignoring stale command:", command);
      return;
    }

    // Latency compensation
    const latency = sentAt ? (now - sentAt) / 1000 : 0;
    const adjustedTime = time + latency;

    // Prevent event loop
    this.isApplyingRemoteCommand = true;
    this.isSyncing = true;

    try {
      switch (action) {
        case "play":
          this.sendToPlayer("play");
          break;
        case "pause":
          this.sendToPlayer("pause");
          break;
        case "seek":
          this.sendToPlayer("seek", { time: Math.floor(adjustedTime) });
          this.lastKnownHostTime = adjustedTime;
          break;
        case "sync":
          this.sendToPlayer("seek", { time: Math.floor(adjustedTime) });
          this.lastKnownHostTime = adjustedTime;
          break;
        case "mute":
          this.sendToPlayer("mute", { muted: command.muted });
          break;
        case "volume":
          this.sendToPlayer("volume", { level: command.level });
          break;
      }
    } finally {
      // Reset suppression flag after brief delay
      setTimeout(() => {
        this.isApplyingRemoteCommand = false;
        this.isSyncing = false;
      }, 100);
    }
  }

  // 7) Implement syncToHost for mid-session joins
  syncToHost(hostState) {
    if (this.isHost) return;

    this.isSyncing = true;

    // Wait for iframe readiness with retry logic
    const attemptSync = (attempts = 0) => {
      if (attempts >= this.maxRetries) {
        console.error("WatchPartySync: failed to sync after max retries");
        this.isSyncing = false;
        return;
      }

      if (!this.iframe?.contentWindow) {
        setTimeout(() => attemptSync(attempts + 1), this.retryDelay);
        return;
      }

      // Additional 500ms buffer for iframe loading
      setTimeout(() => {
        const { time, playing } = hostState;

        // Seek to host time
        this.sendToPlayer("seek", { time: Math.floor(time) });
        this.lastKnownHostTime = time;

        // Apply play/pause state
        if (playing) {
          this.sendToPlayer("play");
        } else {
          this.sendToPlayer("pause");
        }

        console.log("WatchPartySync: synced to host state:", hostState);
        this.isSyncing = false;
      }, 500);
    };

    attemptSync();
  }

  // 8) Register VidFast PLAYER_EVENT listeners
  setupEventListeners() {
    this.messageHandler = (event) => {
      // Security validation
      if (!this.allowedOrigins.includes(event.origin)) return;
      if (event.source !== this.iframe?.contentWindow) return;
      if (!event.data || event.data.type !== "PLAYER_EVENT") return;

      const { event: playerEvent, currentTime } = event.data.data;

      // Skip if applying remote command (prevents loops)
      if (this.isApplyingRemoteCommand) return;

      switch (playerEvent) {
        case "play":
          if (this.isHost) {
            this.broadcastAction("play", currentTime);
          }
          break;
        case "pause":
          if (this.isHost) {
            this.broadcastAction("pause", currentTime);
          }
          break;
        case "seeked":
          if (this.isHost) {
            this.broadcastAction("seek", currentTime);
          }
          this.lastKnownHostTime = currentTime;
          break;
        case "timeupdate":
          // Periodic sync for drift correction
          this.lastKnownHostTime = currentTime;
          if (this.isHost && Date.now() - this.lastBroadcastAt > 1000) {
            this.broadcastAction("sync", currentTime);
          }
          break;
        case "playerstatus":
          // Handle async status response
          this.handleStatusResponse(event.data.data);
          break;
      }
    };

    window.addEventListener("message", this.messageHandler);
  }

  // 9) Manual control methods
  play(time) {
    if (time !== undefined) {
      this.seek(time);
    } else {
      this.sendToPlayer("play");
      if (this.isHost) {
        this.broadcastAction("play", this.lastKnownHostTime);
      }
    }
  }

  pause(time) {
    if (time !== undefined) {
      this.seek(time);
    } else {
      this.sendToPlayer("pause");
      if (this.isHost) {
        this.broadcastAction("pause", this.lastKnownHostTime);
      }
    }
  }

  seek(time) {
    const seekTime = Math.floor(time);
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

  // 10) Promise-based getStatus
  async getStatus() {
    // Check if iframe is ready before attempting to get status
    if (!this.iframe?.contentWindow) {
      throw new Error("Iframe not ready");
    }
    return new Promise((resolve, reject) => {
      // Clear any pending request
      if (this.pendingStatusTimeout) {
        clearTimeout(this.pendingStatusTimeout);
      }

      this.pendingStatusResolve = resolve;

      // Send status request
      this.sendToPlayer("getStatus");

      // Set timeout
      this.pendingStatusTimeout = setTimeout(() => {
        this.pendingStatusResolve = null;
        reject(new Error("Status request timeout"));
      }, 2000);
    });
  }

  // Handle status response
  handleStatusResponse(status) {
    if (this.pendingStatusResolve) {
      this.pendingStatusResolve(status);
      this.pendingStatusResolve = null;
      if (this.pendingStatusTimeout) {
        clearTimeout(this.pendingStatusTimeout);
        this.pendingStatusTimeout = null;
      }
    }
  }

  // 11) Periodic drift correction
  startDriftCorrection() {
    this.driftInterval = setInterval(() => {
      if (!this.isHost && this.iframe?.contentWindow) {
        // For viewers, check if we're significantly behind host
        // Only run drift correction if iframe is ready
        this.getStatus()
          .then((status) => {
            const drift = Math.abs(status.currentTime - this.lastKnownHostTime);
            if (drift > 0.8) {
              // 0.8 second threshold
              console.log("WatchPartySync: correcting drift:", drift);
              this.isSyncing = true;
              this.seek(this.lastKnownHostTime);
              setTimeout(() => (this.isSyncing = false), 1000);
            }
          })
          .catch((error) => {
            // Ignore errors during drift correction (iframe not ready, timeout, etc.)
            if (error.message !== "Iframe not ready") {
              console.debug(
                "WatchPartySync: drift correction skipped:",
                error.message,
              );
            }
          });
      }
    }, 3000); // Every 3 seconds
  }

  // 14) Cleanup
  destroy() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
    }
    if (this.driftInterval) {
      clearInterval(this.driftInterval);
    }
    if (this.pendingStatusTimeout) {
      clearTimeout(this.pendingStatusTimeout);
    }
    this.pendingStatusResolve = null;
  }
}

export default WatchPartySync;
