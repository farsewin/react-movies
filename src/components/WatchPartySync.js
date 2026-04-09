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

const HOST_SYNC_GATE_MS = 1200;
const HOST_SYNC_THROTTLE_MS = 800;
const VIEWER_DRIFT_CHECK_INTERVAL_MS = 2500;
const MOBILE_VIEWER_DRIFT_CHECK_INTERVAL_MS = 1250;
const VIEWER_DRIFT_THRESHOLD_SEC = 1.1;
const MOBILE_VIEWER_DRIFT_THRESHOLD_SEC = 0.5;
const VIEWER_CORRECTION_COOLDOWN_MS = 7000;

const debugLog = () => {};

const pushCappedSample = (arr, value, limit = 300) => {
  arr.push(value);
  if (arr.length > limit) arr.shift();
};

const percentile = (arr, p) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
};

const getHealthStatus = ({ driftP95Sec, correctionPerMin, staleDrops }) => {
  if (driftP95Sec === null) return { label: "Starting", tone: "neutral" };

  if (staleDrops > 2 || driftP95Sec > 1.5 || correctionPerMin > 3) {
    return { label: "Poor", tone: "bad" };
  }

  if (driftP95Sec > 1 || correctionPerMin > 1.5) {
    return { label: "Good", tone: "warn" };
  }

  return { label: "Perfect", tone: "good" };
};

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
    this.driftCheckIntervalMs =
      this.isMobile && !this.isHost
        ? MOBILE_VIEWER_DRIFT_CHECK_INTERVAL_MS
        : VIEWER_DRIFT_CHECK_INTERVAL_MS;
    this.driftThresholdSec =
      this.isMobile && !this.isHost
        ? MOBILE_VIEWER_DRIFT_THRESHOLD_SEC
        : VIEWER_DRIFT_THRESHOLD_SEC;

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
    this.lastCorrectionAt = 0;
    this.metricsInterval = null;
    this.metricsUi = null;
    this.metricsLogLines = [];
    this.healthBadge = null;
    this.metrics = {
      startedAt: Date.now(),
      lastSummaryAt: Date.now(),
      hostSyncSentAt: null,
      syncIntervalsMs: [],
      driftSamplesSec: [],
      correctionCount: 0,
      staleCommandDrops: 0,
      receivedSyncCount: 0,
      receivedSeekCount: 0,
    };

    // Initialize
    this.setupEventListeners();
    this.initMetricsUi();
    // Delay drift correction start to ensure iframe is ready
    setTimeout(() => this.startDriftCorrection(), 2500);
    this.metricsInterval = setInterval(() => this.logMetricsSummary(), 10000);

    // Test debug logging
    debugLog("WatchPartySync: initialized", {
      isHost: this.isHost,
      isMobile: this.isMobile,
    });
  }

  initMetricsUi() {
    if (typeof document === "undefined") return;

    const existing = document.getElementById("watchparty-metrics-panel");
    if (existing) {
      const output = existing.querySelector("pre");
      this.metricsUi = {
        root: existing,
        output,
      };
      return;
    }

    const root = document.createElement("section");
    root.id = "watchparty-metrics-panel";
    root.style.cssText = [
      "position: fixed",
      "right: 12px",
      "bottom: 12px",
      "width: min(420px, calc(100vw - 24px))",
      "max-height: 40vh",
      "background: rgba(8, 10, 16, 0.92)",
      "border: 1px solid rgba(255,255,255,0.18)",
      "border-radius: 10px",
      "padding: 10px",
      "z-index: 10000",
      "box-shadow: 0 8px 30px rgba(0,0,0,0.45)",
      "font-family: Consolas, 'Courier New', monospace",
      "color: #dbe6ff",
      "font-size: 12px",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;";

    const title = document.createElement("div");
    title.textContent = "Watch Party Metrics";
    title.style.cssText = "font-weight: 700; letter-spacing: 0.3px;";

    const healthBadge = document.createElement("span");
    healthBadge.textContent = "Starting";
    healthBadge.style.cssText = [
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "padding: 3px 8px",
      "border-radius: 999px",
      "font-size: 11px",
      "font-weight: 700",
      "letter-spacing: 0.2px",
      "background: rgba(255,255,255,0.12)",
      "color: #dbe6ff",
      "border: 1px solid rgba(255,255,255,0.16)",
      "min-width: 72px",
      "text-align: center",
    ].join(";");

    this.healthBadge = healthBadge;

    header.appendChild(title);
    header.appendChild(healthBadge);

    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px;";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText =
      "background: #3f63ff; color: white; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer;";
    copyBtn.onclick = () => {
      const content = this.metricsLogLines.join("\n");
      navigator.clipboard
        .writeText(content)
        .then(() => {
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1200);
        })
        .catch(() => {
          copyBtn.textContent = "Copy failed";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1200);
        });
    };

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText =
      "background: #2a2f45; color: #dbe6ff; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 4px 8px; cursor: pointer;";
    clearBtn.onclick = () => {
      this.metricsLogLines = [];
      if (this.metricsUi?.output) {
        this.metricsUi.output.textContent = "";
      }
    };

    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);

    const output = document.createElement("pre");
    output.style.cssText =
      "margin: 0; white-space: pre-wrap; line-height: 1.35; overflow: auto; max-height: calc(40vh - 68px);";

    root.appendChild(header);
    root.appendChild(actions);
    root.appendChild(output);
    document.body.appendChild(root);

    this.metricsUi = { root, output };
  }

  appendMetricsLog(entry) {
    const line = `${new Date().toLocaleTimeString()} ${JSON.stringify(entry)}`;
    pushCappedSample(this.metricsLogLines, line, 120);

    if (this.metricsUi?.output) {
      this.metricsUi.output.textContent = this.metricsLogLines.join("\n");
      this.metricsUi.output.scrollTop = this.metricsUi.output.scrollHeight;
    }
  }

  logMetricsSummary() {
    const now = Date.now();
    const sinceLastMs = now - this.metrics.lastSummaryAt;
    const minutes = sinceLastMs / 60000;
    const correctionRate =
      minutes > 0 ? this.metrics.correctionCount / minutes : 0;
    const p95Drift = percentile(this.metrics.driftSamplesSec, 0.95);
    const medianSyncMs = percentile(this.metrics.syncIntervalsMs, 0.5);
    const health = getHealthStatus({
      driftP95Sec: p95Drift,
      correctionPerMin: correctionRate,
      staleDrops: this.metrics.staleCommandDrops,
    });

    const summary = {
      role: this.isHost ? "host" : "viewer",
      uptimeSec: Math.floor((now - this.metrics.startedAt) / 1000),
      driftP95Sec: p95Drift,
      correctionPerMin: Number(correctionRate.toFixed(2)),
      correctionCount: this.metrics.correctionCount,
      staleDrops: this.metrics.staleCommandDrops,
      recvSync: this.metrics.receivedSyncCount,
      recvSeek: this.metrics.receivedSeekCount,
      hostSyncMedianMs: medianSyncMs,
      hostSyncSamples: this.metrics.syncIntervalsMs.length,
      driftSamples: this.metrics.driftSamplesSec.length,
      health: health.label,
    };

    if (this.healthBadge) {
      this.healthBadge.textContent = health.label;
      this.healthBadge.style.background =
        health.tone === "good"
          ? "rgba(34,197,94,0.18)"
          : health.tone === "warn"
            ? "rgba(245,158,11,0.18)"
            : health.tone === "bad"
              ? "rgba(239,68,68,0.18)"
              : "rgba(255,255,255,0.12)";
      this.healthBadge.style.borderColor =
        health.tone === "good"
          ? "rgba(34,197,94,0.45)"
          : health.tone === "warn"
            ? "rgba(245,158,11,0.45)"
            : health.tone === "bad"
              ? "rgba(239,68,68,0.45)"
              : "rgba(255,255,255,0.16)";
      this.healthBadge.style.color =
        health.tone === "good"
          ? "#bbf7d0"
          : health.tone === "warn"
            ? "#fde68a"
            : health.tone === "bad"
              ? "#fecaca"
              : "#dbe6ff";
    }

    console.info("[sync-metrics]", summary);
    this.appendMetricsLog(summary);

    this.metrics.lastSummaryAt = now;
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

    if (action === "sync") {
      if (this.metrics.hostSyncSentAt) {
        pushCappedSample(
          this.metrics.syncIntervalsMs,
          sentAt - this.metrics.hostSyncSentAt,
        );
      }
      this.metrics.hostSyncSentAt = sentAt;
    }

    // Throttling for periodic time sync, immediate for play/pause/seek
    const throttleMs = action === "sync" ? HOST_SYNC_THROTTLE_MS : 0;
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
      this.metrics.staleCommandDrops += 1;
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
          this.metrics.receivedSeekCount += 1;
          this.sendToPlayer("seek", { time: Math.floor(adjustedTime) });
          this.lastKnownHostTime = adjustedTime;
          break;
        case "sync":
          this.metrics.receivedSyncCount += 1;
          // Soft sync update: keep host time locally and let drift correction
          // decide if/when an actual seek is required.
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
          if (
            this.isHost &&
            Date.now() - this.lastBroadcastAt > HOST_SYNC_GATE_MS
          ) {
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
            pushCappedSample(this.metrics.driftSamplesSec, drift);
            if (drift > this.driftThresholdSec) {
              const now = Date.now();
              if (now - this.lastCorrectionAt < VIEWER_CORRECTION_COOLDOWN_MS) {
                return;
              }

              // Mobile viewers use a tighter threshold to correct drift sooner.
              this.metrics.correctionCount += 1;
              this.lastCorrectionAt = now;
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
    }, this.driftCheckIntervalMs);
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
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.metricsUi?.root) {
      this.metricsUi.root.remove();
    }
    this.pendingStatusResolve = null;
  }
}

export default WatchPartySync;
