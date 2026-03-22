/**
 * WatchPartySync v3
 *
 * A robust host/viewer sync engine for VidFast-embedded players.
 *
 * Fixes vs v2:
 *  - Separate lastBroadcastAt so host debounce actually fires
 *  - Drift samples skipped / cleared during cooldown window
 *  - syncToHost resets drift samples
 *  - Clock-mismatch: local receipt time used for drift math, sentAt only for ordering
 *  - Dynamic threshold is capped to prevent unbounded growth
 *  - seek() preserves sub-second precision (no Math.floor)
 *  - Empty driftSamples guard (no NaN divide-by-zero)
 *  - destroy() tears down the transport listener
 *  - forceResync awaits a real playerstatus response, 500ms hard fallback remains
 *  - isMobile persisted on instance
 *  - Full playerstatus event handled (volume, muted, duration exposed)
 *  - volume() and mute() commands added
 */
export default class WatchPartySync {

  // ─────────────────────────────────────────
  // CONSTRUCTION
  // ─────────────────────────────────────────

  /**
   * @param {object}   opts
   * @param {HTMLIFrameElement} opts.iframe     - The VidFast iframe element
   * @param {object}   opts.transport           - { send(cmd), onMessage(cb) → unsubFn }
   * @param {boolean}  [opts.isHost=false]      - True for the room host
   * @param {boolean}  [opts.isMobile=false]    - Relaxes thresholds on mobile
   */
  constructor({ iframe, transport, isHost = false, isMobile = false }) {
    this.iframe    = iframe;
    this.transport = transport;
    this.isHost    = isHost;
    this.isMobile  = isMobile;         // persisted (was discarded in v2)

    // ── Player state ──────────────────────────────
    this.playing     = false;
    this.currentTime = 0;
    this.duration    = 0;
    this.volume      = 1;
    this.muted       = false;

    // ── Sync anchor (LOCAL timestamps only for math) ──
    this.lastSyncTime    = 0;   // seconds – player time at last sync
    this.lastSyncLocalAt = 0;   // ms     – Date.now() at last sync
    this.lastSyncSentAt  = 0;   // ms     – sentAt from remote cmd (ordering only)

    // ── Drift tracking ────────────────────────────
    this.driftSamples = [];
    this.MAX_SAMPLES  = 6;

    // ── Sync control ──────────────────────────────
    this.isSyncing       = false;
    this.lastBroadcastAt = 0;   // host-side debounce  (was reusing lastCommandAt in v2)
    this.lastCommandAt   = 0;   // viewer-side: suppress old remote cmds

    // ── Thresholds ────────────────────────────────
    this.BASE_THRESHOLD   = isMobile ? 6   : 4;
    this.SOFT_ZONE        = 1.5;
    this.MAX_DRIFT_BONUS  = 3;          // cap on dynamic threshold growth
    this.COOLDOWN         = isMobile ? 4000 : 2500;
    this.BROADCAST_DEBOUNCE = 300;      // ms between host broadcasts

    // ── Allowed origins ───────────────────────────
    this.vidfastOrigins = [
      'https://vidfast.pro',
      'https://vidfast.in',
      'https://vidfast.io',
      'https://vidfast.me',
      'https://vidfast.net',
      'https://vidfast.pm',
      'https://vidfast.xyz',
    ];

    // ── Status-request callbacks ──────────────────
    this._statusCallbacks = [];

    // Bind & init
    this._onMessage = this._onMessage.bind(this);
    this._unsubTransport = null;
    this._init();
  }

  // ─────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────

  _init() {
    window.addEventListener('message', this._onMessage);
    // transport.onMessage may return an unsubscribe fn – store it for destroy()
    const unsub = this.transport?.onMessage((cmd) => this._handleRemote(cmd));
    if (typeof unsub === 'function') this._unsubTransport = unsub;
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    this._unsubTransport?.();          // avoid transport listener leak (v2 bug)
  }

  // ─────────────────────────────────────────
  // LOW-LEVEL POSTMESSAGE API
  // ─────────────────────────────────────────

  _post(command, payload = {}) {
    this.iframe?.contentWindow?.postMessage({ command, ...payload }, '*');
  }

  /** Resume playback */
  play()              { this._post('play'); }

  /** Pause playback */
  pause()             { this._post('pause'); }

  /**
   * Seek to time in seconds.
   * Preserves sub-second precision (v2 used Math.floor which lost up to 0.999s).
   * VidFast docs say "integer values" but floats work in practice; round only if
   * you discover a specific player that rejects them.
   */
  seek(time)          { this._post('seek', { time }); }

  /** Set volume 0.0 – 1.0 */
  setVolume(level)    { this._post('volume', { level: Math.max(0, Math.min(1, level)) }); }

  /** Set mute state */
  setMuted(muted)     { this._post('mute', { muted: !!muted }); }

  /**
   * Request current player status.
   * Returns a Promise that resolves with the status object,
   * or rejects after `timeoutMs` milliseconds (default 3000).
   */
  getStatus(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._statusCallbacks = this._statusCallbacks.filter(cb => cb !== resolve);
        reject(new Error('getStatus timed out'));
      }, timeoutMs);

      this._statusCallbacks.push((status) => {
        clearTimeout(timer);
        resolve(status);
      });

      this._post('getStatus');
    });
  }

  // ─────────────────────────────────────────
  // INBOUND PLAYER EVENTS
  // ─────────────────────────────────────────

  _onMessage({ origin, data }) {
    if (!this.vidfastOrigins.includes(origin) || !data) return;
    if (data.type !== 'PLAYER_EVENT') return;

    const { event, currentTime, duration, playing, muted, volume } = data.data;

    // Keep local state current
    this.currentTime = currentTime;
    if (duration  !== undefined) this.duration = duration;
    if (playing   !== undefined) this.playing  = playing;
    if (muted     !== undefined) this.muted    = muted;
    if (volume    !== undefined) this.volume   = volume;

    switch (event) {
      case 'play':
        this.playing = true;
        this._broadcast('play', currentTime);
        break;

      case 'pause':
        this.playing = false;
        this._broadcast('pause', currentTime);
        break;

      case 'seeked':
        this._broadcast('seek', currentTime);
        break;

      case 'timeupdate':
        this._trackDrift(currentTime);
        this._handleDrift();
        break;

      case 'ended':
        this.playing = false;
        this._broadcast('pause', currentTime);
        break;

      case 'playerstatus':
        // Resolve any pending getStatus() promises
        if (this._statusCallbacks.length > 0) {
          const callbacks = [...this._statusCallbacks];
          this._statusCallbacks = [];
          callbacks.forEach(cb => cb(data.data));
        }
        break;
    }
  }

  // ─────────────────────────────────────────
  // BROADCAST  (host → room)
  // ─────────────────────────────────────────

  _broadcast(action, time) {
    if (!this.isHost) return;

    // Use dedicated lastBroadcastAt — v2 mistakenly used lastCommandAt (viewer field)
    const now = Date.now();
    if (now - this.lastBroadcastAt < this.BROADCAST_DEBOUNCE) return;
    this.lastBroadcastAt = now;

    this.transport?.send({ action, time, sentAt: now });
    this._updateSyncAnchor(time, now);
  }

  // ─────────────────────────────────────────
  // REMOTE COMMANDS  (room → viewer)
  // ─────────────────────────────────────────

  _handleRemote(cmd) {
    if (this.isHost) return;

    // Discard stale / out-of-order commands (compare sentAt for ordering only)
    if (cmd.sentAt <= this.lastSyncSentAt) return;

    const localReceivedAt = Date.now();
    this.lastCommandAt = localReceivedAt;

    const latency    = (localReceivedAt - cmd.sentAt) / 1000;
    const targetTime = cmd.action !== 'pause' ? cmd.time + latency : cmd.time;

    switch (cmd.action) {
      case 'play':
        this.seek(targetTime);
        this.play();
        this.playing = true;
        break;

      case 'pause':
        this.seek(targetTime);
        this.pause();
        this.playing = false;
        break;

      case 'seek':
        this.seek(targetTime);
        break;
    }

    // Store LOCAL received time as sync anchor — not sentAt — so drift math stays on
    // one clock.  sentAt is stored separately purely for ordering guards.
    this._updateSyncAnchor(targetTime, localReceivedAt, cmd.sentAt);
    this._startCooldown();
  }

  // ─────────────────────────────────────────
  // DRIFT TRACKING
  // ─────────────────────────────────────────

  _trackDrift(viewerTime) {
    // Skip accumulation during cooldown — samples against stale anchor pollute the
    // average and caused spurious re-seeks in v2
    if (this.isSyncing) return;

    const expectedTime = this.playing
      ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
      : this.lastSyncTime;

    const drift = viewerTime - expectedTime;

    this.driftSamples.push(drift);
    if (this.driftSamples.length > this.MAX_SAMPLES) this.driftSamples.shift();
  }

  // ─────────────────────────────────────────
  // DRIFT CORRECTION
  // ─────────────────────────────────────────

  _handleDrift() {
    if (this.isHost || this.isSyncing) return;

    // Guard against empty array divide-by-zero (v2 produced NaN on first timeupdate)
    if (this.driftSamples.length === 0) return;

    const avgDrift =
      this.driftSamples.reduce((a, b) => a + b, 0) / this.driftSamples.length;

    // Cap the dynamic bonus so the threshold can't grow unboundedly (v2 bug)
    const dynamicBonus     = Math.min(Math.abs(avgDrift) * 0.5, this.MAX_DRIFT_BONUS);
    const dynamicThreshold = this.BASE_THRESHOLD + dynamicBonus;

    // Stability zone — small wobble, ignore
    if (Math.abs(avgDrift) < this.SOFT_ZONE) return;

    // Hard correction
    if (Math.abs(avgDrift) > dynamicThreshold) {
      const expectedTime = this.playing
        ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
        : this.lastSyncTime;

      this.seek(expectedTime);
      this._startCooldown();
    }
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  /**
   * @param {number} time        - Player seconds at this sync point
   * @param {number} localAt     - Local Date.now() for drift math
   * @param {number} [sentAt]    - Remote sentAt for ordering only (optional)
   */
  _updateSyncAnchor(time, localAt = Date.now(), sentAt = localAt) {
    this.lastSyncTime    = time;
    this.lastSyncLocalAt = localAt;
    this.lastSyncSentAt  = sentAt;
  }

  _startCooldown() {
    this.isSyncing = true;
    // Clear stale samples so post-cooldown tracking starts clean
    this.driftSamples = [];
    setTimeout(() => { this.isSyncing = false; }, this.COOLDOWN);
  }

  // ─────────────────────────────────────────
  // RECOVERY
  // ─────────────────────────────────────────

  /**
   * Force a hard resync.
   * First tries to get a real status from the player; falls back to the stored
   * anchor after 500 ms if the player doesn't respond in time.
   *
   * v2 race: the fallback ran against an unconditionally stale anchor.
   * Here we only fall back if the real status hasn't arrived.
   */
  async forceResync() {
    let resolved = false;

    // Try real status first
    try {
      const status = await this.getStatus(500);
      resolved = true;
      this._applyResync(status.currentTime, status.playing);
    } catch {
      // Player didn't respond in 500 ms — use stored anchor
      if (!resolved) {
        const expectedTime = this.playing
          ? this.lastSyncTime + (Date.now() - this.lastSyncLocalAt) / 1000
          : this.lastSyncTime;
        this._applyResync(expectedTime, this.playing);
      }
    }
  }

  _applyResync(time, playing) {
    this.seek(time);
    playing ? this.play() : this.pause();
    this._updateSyncAnchor(time);
    this._startCooldown();
  }

  // ─────────────────────────────────────────
  // JOIN / INITIAL SYNC
  // ─────────────────────────────────────────

  /**
   * Called when a viewer joins mid-session.
   * @param {{ time: number, playing: boolean, sentAt: number }} snapshot
   */
  syncToHost({ time, playing, sentAt }) {
    const latency    = (Date.now() - sentAt) / 1000;
    const targetTime = playing ? time + latency : time;

    this.seek(targetTime);
    playing ? this.play() : this.pause();

    this.playing = playing;

    // Reset drift history — v2 left stale samples that immediately triggered
    // a correction on the first timeupdate after joining
    this.driftSamples = [];

    this._updateSyncAnchor(targetTime, Date.now(), sentAt);
  }
}