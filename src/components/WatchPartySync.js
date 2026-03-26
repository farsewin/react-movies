/**
 * WatchPartySync v6
 *
 * Changes vs v5:
 *  - Host user actions (play/pause/seek) remain immediate sync triggers.
 *  - Periodic host status pulse now sends soft status snapshots instead of forcing playback each tick.
 */
export default class WatchPartySync {
  // ─────────────────────────────────────────
  // CONSTRUCTION
  // ─────────────────────────────────────────

  /**
   * @param {object}   opts
   * @param {HTMLIFrameElement} opts.iframe
   * @param {object}   opts.transport           - { send(cmd), onMessage(cb) → unsubFn }
   * @param {boolean}  [opts.isHost=false]
   * @param {boolean}  [opts.isMobile=false]
   * @param {string}   [opts.viewerId]          - Stable ID for this peer (used for co-host grant/revoke).
   *                                              Required if you want co-host promotion to work.
   * @param {string}   [opts.toastMessage]      - Override the default locked toast text.
   * @param {Function} [opts.onControlChange]   - (hasControl: boolean) => void
   *                                              Fires when this viewer gains or loses co-host control.
   */
  constructor({
    iframe,
    transport,
    isHost = false,
    isMobile = false,
    toastMessage = "التحكم في التشغيل متاح للمضيف فقط", // "Playback control is for the host only"
  }) {
    this.iframe = iframe;
    this.transport = transport;
    this.isHost = isHost;
    this.isMobile = isMobile;
    this.toastMessage = toastMessage;

    // ── Player state ──────────────────────────────
    this.playing = false;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1;
    this.muted = false;

    // ── Sync anchor ───────────────────────────────
    this.lastSyncTime = 0;
    this.lastSyncLocalAt = 0;
    this.lastSyncSentAt = 0;

    // ── Drift tracking ────────────────────────────
    this.driftSamples = [];
    this.MAX_SAMPLES = 6;

    // ── Sync control ──────────────────────────────
    this.isSyncing = false;
    this.lastBroadcastAt = 0;
    this.lastCommandAt = 0;

    // ── Thresholds ────────────────────────────────
    this.BASE_THRESHOLD = isMobile ? 6 : 4;
    this.SOFT_ZONE = 1.5;
    this.MAX_DRIFT_BONUS = 3;
    this.COOLDOWN = isMobile ? 4000 : 2500;
    this.BROADCAST_DEBOUNCE = 300;
    this.STATUS_PULSE_MS = isMobile ? 10000 : 8000;

    // ── VidFast origins ───────────────────────────
    this.vidfastOrigins = [
      "https://vidfast.pro",
      "https://vidfast.in",
      "https://vidfast.io",
      "https://vidfast.me",
      "https://vidfast.net",
      "https://vidfast.pm",
      "https://vidfast.xyz",
    ];

    this._statusCallbacks = [];
    this._toastEl = null;
    this._toastTimer = null;
    this._statusPulseInterval = null;
    this._statusPulseBusy = false;

    this._onMessage = this._onMessage.bind(this);
    this._unsubTransport = null;
    this._init();
  }

  // ─────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────

  _init() {
    window.addEventListener("message", this._onMessage);
    const unsub = this.transport?.onMessage((cmd) => this._handleRemote(cmd));
    if (typeof unsub === "function") this._unsubTransport = unsub;
    this._startStatusPulse();
    this._buildToast();
  }

  destroy() {
    window.removeEventListener("message", this._onMessage);
    this._unsubTransport?.();
    this._stopStatusPulse();
    this._toastEl?.remove();
    this._toastEl = null;
  }

  // ─────────────────────────────────────────
  // POSTMESSAGE API (internal)
  // ─────────────────────────────────────────

  _post(command, payload = {}) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage({ command, ...payload }, "*");
  }

  _forcePlay() {
    this._post("play");
  }
  _forcePause() {
    this._post("pause");
  }
  _forceSeek(time) {
    this._post("seek", { time });
  }

  // ─────────────────────────────────────────
  // PUBLIC PLAYER API (guarded)
  // ─────────────────────────────────────────

  play(time) {
    this._guardedControl(() =>
      this._post("play", Number.isFinite(time) ? { time } : {}),
    );
  }
  pause(time) {
    this._guardedControl(() =>
      this._post("pause", Number.isFinite(time) ? { time } : {}),
    );
  }
  seek(time) {
    this._guardedControl(() => this._post("seek", { time }));
  }
  setVolume(level) {
    this._guardedControl(() =>
      this._post("volume", { level: Math.max(0, Math.min(1, level)) }),
    );
  }
  setMuted(muted) {
    this._guardedControl(() => this._post("mute", { muted: !!muted }));
  }

  // Public entry point for transport-level commands (Appwrite/WebSocket/etc.).
  handlePartyCommand(command) {
    this._handleRemote(command);
  }

  getStatus(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._statusCallbacks = this._statusCallbacks.filter(
          (cb) => cb !== resolve,
        );
        reject(new Error("getStatus timed out"));
      }, timeoutMs);

      this._statusCallbacks.push((status) => {
        clearTimeout(timer);
        resolve(status);
      });
      this._post("getStatus");
    });
  }

  // ─────────────────────────────────────────
  // CONTROL GATE
  // ─────────────────────────────────────────

  _guardedControl(action) {
    if (this.isHost) {
      action();
    } else {
      this._showToast();
    }
  }

  // ─────────────────────────────────────────
  // INBOUND PLAYER EVENTS
  // ─────────────────────────────────────────

  _onMessage({ origin, data }) {
    if (!this.vidfastOrigins.includes(origin) || !data) return;
    if (data.type !== "PLAYER_EVENT") return;

    const payload = data.data;
    if (!payload || typeof payload !== "object") return;

    const { event, currentTime, duration, playing, muted, volume } = payload;

    this.currentTime = currentTime;
    if (duration !== undefined) this.duration = duration;
    if (this.isHost && playing !== undefined) this.playing = playing;
    if (muted !== undefined) this.muted = muted;
    if (volume !== undefined) this.volume = volume;

    // Ignore events that we triggered ourselves (cooldown / sync window)
    if (this.isSyncing) return;

    switch (event) {
      case "play":
        if (this.isHost) {
          this.playing = true;
          this._broadcast("play", currentTime);
        } else {
          this._interceptPlay(currentTime);
        }
        break;

      case "pause":
        if (this.isHost) {
          this.playing = false;
          this._broadcast("pause", currentTime);
        } else {
          this._interceptPause(currentTime);
        }
        break;

      case "seeked":
        if (this.isHost) {
          this._broadcast("seek", currentTime);
        } else {
          this._interceptSeek();
        }
        break;

      case "timeupdate":
        if (!this.isHost) {
          this._trackDrift(currentTime);
          this._handleDrift();
        }
        break;

      case "ended":
        if (this.isHost) {
          this.playing = false;
          this._broadcast("pause", currentTime);
        }
        break;

      case "playerstatus":
        if (this._statusCallbacks.length > 0) {
          const cbs = [...this._statusCallbacks];
          this._statusCallbacks = [];
          cbs.forEach((cb) => cb(payload));
        }
        break;
    }
  }

  // ─────────────────────────────────────────
  // INTERCEPT
  // ─────────────────────────────────────────

  _interceptPlay() {
    if (this.lastSyncLocalAt === 0) {
      this._forcePause();
      this._showToast();
      return;
    }
    const expectedTime = this.playing
      ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
      : this.lastSyncTime;

    // If host is already playing, just snap the time.
    // This prevents "AbortError: The play() request was interrupted by a call to pause()."
    if (this.playing) {
      this._forceSeek(expectedTime);
    } else {
      this._forcePause();
      this._forceSeek(expectedTime);
    }
    this._showToast();
  }

  _interceptPause() {
    if (this.lastSyncLocalAt === 0) {
      this._showToast();
      return;
    }
    const expectedTime = this.playing
      ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
      : this.lastSyncTime;

    if (this.playing) {
      this._forceSeek(expectedTime);
      this._forcePlay();
    }
    this._showToast();
  }

  _interceptSeek() {
    if (this.lastSyncLocalAt === 0) {
      this._forceSeek(0);
      this._showToast();
      return;
    }
    const expectedTime = this.playing
      ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
      : this.lastSyncTime;

    this._forceSeek(expectedTime);
    if (this.playing) this._forcePlay();
    this._showToast();
  }

  // ─────────────────────────────────────────
  // BROADCAST
  // ─────────────────────────────────────────

  _broadcast(action, time) {
    if (!this.isHost) return;

    const now = Date.now();
    if (now - this.lastBroadcastAt < this.BROADCAST_DEBOUNCE) return;
    this.lastBroadcastAt = now;

    this.transport?.send({ action, time, sentAt: now });
    this._updateSyncAnchor(time, now);
  }

  // ─────────────────────────────────────────
  // REMOTE COMMANDS
  // ─────────────────────────────────────────

  _handleRemote(cmd) {
    if (this.isHost) return;
    if (
      !cmd ||
      !cmd.action ||
      !Number.isFinite(cmd.time) ||
      !Number.isFinite(cmd.sentAt)
    )
      return;
    if (cmd.sentAt <= this.lastSyncSentAt) return;

    if (cmd.action === "status") {
      this._handleStatusSnapshot(cmd);
      return;
    }

    const localReceivedAt = Date.now();
    this.lastCommandAt = localReceivedAt;

    const latency = (localReceivedAt - cmd.sentAt) / 1000;
    const targetTime = cmd.action !== "pause" ? cmd.time + latency : cmd.time;

    switch (cmd.action) {
      case "play":
        this._forceSeek(targetTime);
        this._forcePlay();
        this.playing = true;
        break;

      case "pause":
        this._forceSeek(targetTime);
        this._forcePause();
        this.playing = false;
        break;

      case "seek":
        this._forceSeek(targetTime);
        break;
    }

    this._updateSyncAnchor(targetTime, localReceivedAt, cmd.sentAt);
    this._startCooldown();
  }

  _handleStatusSnapshot(cmd) {
    const localReceivedAt = Date.now();
    const isPlaying = !!cmd.playing;
    const latency = (localReceivedAt - cmd.sentAt) / 1000;
    const targetTime = isPlaying ? cmd.time + latency : cmd.time;
    const drift = (this.currentTime || 0) - targetTime;
    const hardThreshold = this.BASE_THRESHOLD + 1;

    if (this.playing !== isPlaying) {
      this._forceSeek(targetTime);
      isPlaying ? this._forcePlay() : this._forcePause();
      this.playing = isPlaying;
      this._updateSyncAnchor(targetTime, localReceivedAt, cmd.sentAt);
      this._startCooldown();
      return;
    }

    if (Math.abs(drift) > hardThreshold) {
      this._forceSeek(targetTime);
      this._updateSyncAnchor(targetTime, localReceivedAt, cmd.sentAt);
      this._startCooldown();
      return;
    }

    // Soft snapshot: refresh anchor without forcing playback when drift is small.
    this.playing = isPlaying;
    this._updateSyncAnchor(targetTime, localReceivedAt, cmd.sentAt);
  }

  // ─────────────────────────────────────────
  // DRIFT
  // ─────────────────────────────────────────

  _trackDrift(viewerTime) {
    if (this.isSyncing || this.lastSyncLocalAt === 0) return;

    const expectedTime = this.playing
      ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
      : this.lastSyncTime;

    this.driftSamples.push(viewerTime - expectedTime);
    if (this.driftSamples.length > this.MAX_SAMPLES) this.driftSamples.shift();
  }

  _handleDrift() {
    if (this.isSyncing || this.lastSyncLocalAt === 0) return;
    if (this.driftSamples.length < 3) return;

    const avgDrift =
      this.driftSamples.reduce((a, b) => a + b, 0) / this.driftSamples.length;

    const dynamicBonus = Math.min(
      Math.abs(avgDrift) * 0.5,
      this.MAX_DRIFT_BONUS,
    );
    const dynamicThreshold = this.BASE_THRESHOLD + dynamicBonus;

    if (Math.abs(avgDrift) < this.SOFT_ZONE) return;

    if (Math.abs(avgDrift) > dynamicThreshold) {
      const expectedTime = this.playing
        ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
        : this.lastSyncTime;

      this._forceSeek(expectedTime);
      this._startCooldown();
    }
  }

  // ─────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────

  _buildToast() {
    const container = this.iframe?.parentElement ?? document.body;
    const cs = getComputedStyle(container);
    if (cs.position === "static") container.style.position = "relative";

    const el = document.createElement("div");
    el.setAttribute("role", "alert");

    Object.assign(el.style, {
      position: "absolute",
      top: "10%",
      left: "50%",
      transform: "translateX(-50%) translateY(-12px)",
      zIndex: "10000",
      background: "rgba(20, 20, 20, 0.9)",
      color: "#fff",
      borderRadius: "12px",
      padding: "12px 24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(255,255,255,0.1)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "0.9rem",
      fontWeight: "600",
      direction: "rtl",
      textAlign: "center",
      whiteSpace: "nowrap",
      opacity: "0",
      transition: "all 300ms cubic-bezier(0.4, 0, 0.2, 1)",
      pointerEvents: "none",
    });

    el.textContent = this.toastMessage;
    container.appendChild(el);
    this._toastEl = el;
  }

  _showToast() {
    if (this.isHost) return;
    const el = this._toastEl;
    if (!el) return;

    if (this._toastTimer) clearTimeout(this._toastTimer);

    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";

    this._toastTimer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(-12px)";
      this._toastTimer = null;
    }, 3000);
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  _updateSyncAnchor(time, localAt = Date.now(), sentAt = localAt) {
    this.lastSyncTime = time;
    this.lastSyncLocalAt = localAt;
    this.lastSyncSentAt = sentAt;
  }

  _startCooldown() {
    this.isSyncing = true;
    this.driftSamples = [];
    setTimeout(() => {
      this.isSyncing = false;
    }, this.COOLDOWN);
  }

  _startStatusPulse() {
    if (!this.isHost || this._statusPulseInterval) return;
    this._statusPulseInterval = setInterval(() => {
      this._tickStatusPulse();
    }, this.STATUS_PULSE_MS);
  }

  _stopStatusPulse() {
    if (!this._statusPulseInterval) return;
    clearInterval(this._statusPulseInterval);
    this._statusPulseInterval = null;
  }

  async _tickStatusPulse() {
    if (!this.isHost || this._statusPulseBusy) return;
    this._statusPulseBusy = true;

    try {
      const status = await this.getStatus(1500);
      if (!status || !Number.isFinite(status.currentTime)) return;

      const now = Date.now();
      const isPlaying = !!status.playing;
      this.playing = isPlaying;
      if (Number.isFinite(status.duration)) this.duration = status.duration;
      if (Number.isFinite(status.volume)) this.volume = status.volume;
      if (typeof status.muted === "boolean") this.muted = status.muted;

      this.transport?.send({
        action: "status",
        time: status.currentTime,
        sentAt: now,
        playing: isPlaying,
      });

      this._updateSyncAnchor(status.currentTime, now, now);
    } catch {
      // Ignore pulse failures; local event-driven sync continues to run.
    } finally {
      this._statusPulseBusy = false;
    }
  }

  async forceResync() {
    let resolved = false;
    try {
      const status = await this.getStatus(500);
      resolved = true;
      this._applyResync(status.currentTime, status.playing);
    } catch {
      if (!resolved) {
        if (this.lastSyncLocalAt === 0) {
          this._applyResync(0, false);
          return;
        }
        const expectedTime = this.playing
          ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
          : this.lastSyncTime;
        this._applyResync(expectedTime, this.playing);
      }
    }
  }

  _applyResync(time, playing) {
    this._forceSeek(time);
    playing ? this._forcePlay() : this._forcePause();
    this._updateSyncAnchor(time);
    this._startCooldown();
  }

  syncToHost({ time, playing, sentAt }) {
    const latency = (Date.now() - sentAt) / 1000;
    const targetTime = playing ? time + latency : time;
    this._forceSeek(targetTime);
    playing ? this._forcePlay() : this._forcePause();
    this.playing = playing;
    this.driftSamples = [];
    this._updateSyncAnchor(targetTime, Date.now(), sentAt);
  }
}
