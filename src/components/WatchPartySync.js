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

const debugLog = () => {};

class WatchPartySync {
  constructor(iframe, transport, isHost, isMobile = false) {
    debugLog("WatchPartySync: constructor called with", {
      iframe: !!iframe,
      transport: !!transport,
      isHost,
      isMobile,
    });

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
    this.maxRetries = 5;
    this.retryDelay = 350;
    this.isSyncing = false; // Add isSyncing property for UI feedback

    // Initialize
    this.setupEventListeners();
    // Delay drift correction start to ensure iframe is ready
    setTimeout(() => this.startDriftCorrection(), 2500);

    // Test debug logging
    debugLog("WatchPartySync: initialized", {
      isHost: this.isHost,
      isMobile: this.isMobile,
    });
  }

  // 2) Implement secure sendToPlayer method
  sendToPlayer(command, payload = {}) {
    if (!this.iframe?.contentWindow) {
      debugLog("WatchPartySync: iframe not ready for command", { command });
      return false;
    }

    try {
      const message = { command, ...payload };
      this.iframe.contentWindow.postMessage(message, "*");
      debugLog("WatchPartySync: sent command to player", { command, payload });
      return true;
    } catch (error) {
      console.error("WatchPartySync: failed to send command:", command, error);
      return false;
    }
  }

  // 3) Define standard sync command schema and broadcastAction
  broadcastAction(action, time) {
    debugLog("WatchPartySync: broadcastAction called", {
      action,
      time,
      isHost: this.isHost,
    });

    if (!this.isHost) {
      debugLog("WatchPartySync: not host, skipping broadcast");
      return;
    }

    const sentAt = Date.now();

    // Throttling: 800ms for time sync, immediate for play/pause/seek
    const throttleMs = action === "sync" ? 800 : 0;
    if (sentAt - this.lastBroadcastAt < throttleMs) {
      debugLog("WatchPartySync: throttled, skipping broadcast", {
        throttleMs,
        timeSinceLast: sentAt - this.lastBroadcastAt,
      });
      return;
    }

    this.lastBroadcastAt = sentAt;

    const command = {
      action,
      time: Math.floor(time), // Integer seconds
      sentAt,
      senderId: this.transport?.senderId || "unknown",
      roomId: this.transport?.roomId || "unknown",
    };

    debugLog("WatchPartySync: broadcasting action", command);
    this.transport.send(command);
  }

  // 5) Implement handlePartyCommand with loop suppression and stale filtering
  handlePartyCommand(command) {
    if (this.isHost && command.senderId !== this.transport?.senderId) return;

    const { action, time, sentAt } = command;
    const now = Date.now();

    // Stale command filtering (7 seconds)
    if (sentAt && now - sentAt > 7000) {
      console.warn("WatchPartySync: ignoring stale command:", command);
      return;
    }

    // Latency compensation
    const latency = sentAt ? (now - sentAt) / 1000 : 0;
    const adjustedTime = time + latency;

    debugLog("WatchPartySync: handling party command", { command, latency });

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
      }, 150);
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

      // Additional 700ms buffer for iframe loading
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
      }, 700);
    };

    attemptSync();
  }

  // 8) Register VidFast PLAYER_EVENT listeners
  setupEventListeners() {
    this.messageHandler = (event) => {
      debugLog("WatchPartySync: message received", {
        origin: event.origin,
        type: event.data?.type,
        event: event.data?.data?.event,
        allowedOrigins: this.allowedOrigins,
        isFromIframe: event.source === this.iframe?.contentWindow,
        eventSource: event.source,
        iframeContentWindow: this.iframe?.contentWindow,
        iframeReady: !!this.iframe?.contentWindow,
      });

      // Security validation
      if (!this.allowedOrigins.includes(event.origin)) {
        debugLog("WatchPartySync: origin not allowed", {
          origin: event.origin,
        });
        return;
      }

      // TEMPORARILY DISABLE SOURCE CHECK FOR DEBUGGING
      // if (event.source !== this.iframe?.contentWindow) {
      //   debugLog("WatchPartySync: source not from iframe", {
      //     source: event.source,
      //     iframeWindow: this.iframe?.contentWindow,
      //   });
      //   return;
      // }

      if (!event.data || event.data.type !== "PLAYER_EVENT") {
        debugLog("WatchPartySync: not a PLAYER_EVENT", {
          type: event.data?.type,
        });
        return;
      }

      const { event: playerEvent, currentTime } = event.data.data;
      debugLog("WatchPartySync: processing PLAYER_EVENT", {
        playerEvent,
        currentTime,
        isHost: this.isHost,
      });

      // Skip if applying remote command (prevents loops)
      if (this.isApplyingRemoteCommand) {
        debugLog("WatchPartySync: skipping due to applying remote command");
        return;
      }

      switch (playerEvent) {
        case "play":
          debugLog("WatchPartySync: handling play event", {
            isHost: this.isHost,
            currentTime,
          });
          if (this.isHost) {
            debugLog("WatchPartySync: broadcasting play action");
            this.broadcastAction("play", currentTime);
          } else {
            debugLog("WatchPartySync: not host, not broadcasting play");
          }
          break;
        case "pause":
          debugLog("WatchPartySync: handling pause event", {
            isHost: this.isHost,
            currentTime,
          });
          if (this.isHost) {
            debugLog("WatchPartySync: broadcasting pause action");
            this.broadcastAction("pause", currentTime);
          } else {
            debugLog("WatchPartySync: not host, not broadcasting pause");
          }
          break;
        case "seeked":
          debugLog("WatchPartySync: handling seeked event", {
            isHost: this.isHost,
            currentTime,
          });
          if (this.isHost) {
            debugLog("WatchPartySync: broadcasting seek action");
            this.broadcastAction("seek", currentTime);
          } else {
            debugLog("WatchPartySync: not host, not broadcasting seek");
          }
          this.lastKnownHostTime = currentTime;
          break;
        case "timeupdate":
          // Periodic sync for drift correction
          this.lastKnownHostTime = currentTime;
          if (this.isHost && Date.now() - this.lastBroadcastAt > 800) {
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

  // Toggle play/pause
  playPause() {
    // For now, just send play command - in a real implementation you'd check current state
    // But since we don't have state tracking, we'll assume pause and send play
    debugLog("WatchPartySync: playPause called");
    this.sendToPlayer("play");
    if (this.isHost) {
      this.broadcastAction("play", this.lastKnownHostTime);
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
      }, 3000);
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
            if (drift > 1.1) {
              // 1.1 second threshold
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
    }, 2500); // Every 2.5 seconds
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
