// Simple, production-ready watch party synchronization for VidFast iframes
export default class WatchPartySync {
  constructor({
    iframe,
    isHost = false,
    onLocalEvent,     // Called when local player emits an event to broadcast
    onRemoteCommand,  // Called when remote command should be executed
    onStatusUpdate,   // Called with player status updates (optional)
    onMediaData       // Called when MEDIA_DATA is received (optional)
  }) {
    this.iframe = iframe;
    this.isHost = isHost;
    this.onLocalEvent = onLocalEvent;
    this.onRemoteCommand = onRemoteCommand;
    this.onStatusUpdate = onStatusUpdate;
    this.onMediaData = onMediaData;

    // Internal state
    this.lastSyncTime = 0;        // Last known playback time from iframe
    this.lastSyncAt = Date.now(); // When we last updated state
    this.viewerCurrentTime = 0;   // Current time for external read access
    this.playbackStatus = 'pause';
    this.isRemoteCommand = false; // Prevents feedback loops

    // Configuration
    this.DRIFT_THRESHOLD = 4;     // Seconds of drift to correct
    this.COOLDOWN = 2000;         // Min time between corrections (ms)

    this.lastCorrectionAt = 0;
    this.vidfastOrigins = [
      'https://vidfast.pro',
      'https://vidfast.in',
      'https://vidfast.io',
      'https://vidfast.me',
      'https://vidfast.net',
      'https://vidfast.pm',
      'https://vidfast.xyz'
    ];
    // Note: Caller must forward window message events to handleMessage()
  }

  // ============================
  // Send commands to iframe
  // ============================
  _postMessage(command, data = {}) {
    this.iframe?.contentWindow?.postMessage(
      { command, ...data },
      '*'
    );
  }

  play() {
    this._postMessage('play');
  }

  pause() {
    this._postMessage('pause');
  }

  seek(time) {
    this._postMessage('seek', { time });
  }

  volume(level) {
    this._postMessage('volume', { level });
  }

  mute(muted) {
    this._postMessage('mute', { muted });
  }

  // ============================
  // Request current player status
  // ============================
  requestStatus() {
    this._postMessage('getStatus');
  }

  // ============================
  // Process incoming messages - call this from window message listener
  // ============================
  handleMessage(event) {
    // Validate origin
    if (!this.vidfastOrigins.includes(event.origin) || !event.data) {
      return false; // Not a vidfast message
    }

    const data = event.data;

    // Handle status response from iframe (response to our requestStatus)
    if (data.type === 'PLAYER_EVENT' && data.data.event === 'playerstatus') {
      const { currentTime, playing, duration, muted, volume } = data.data;
      if (currentTime !== undefined) {
        // Use playing status to determine play/pause state
        this._handlePlayerEvent(playing ? 'play' : 'pause', currentTime);
      }
      return true;
    }

    // Handle direct player events (play, pause, seeked, ended, timeupdate)
    if (data.type === 'PLAYER_EVENT') {
      const { event: playerEvent, currentTime } = data.data;
      this._handlePlayerEvent(playerEvent, currentTime);
      return true;
    }

    // Handle MEDIA_DATA for progress tracking
    if (data.type === 'MEDIA_DATA') {
      if (this.onMediaData) {
        this.onMediaData(data.data);
      }
      return true;
    }

    return false; // Not handled
  }

  // ============================
  // Handle local player events
  // ============================
  handleLocalEvent(eventType, currentTime) {
    // Update our state
    if (eventType === 'play' || eventType === 'pause' || eventType === 'seeked') {
      this.playbackStatus = eventType === 'play' ? 'play' : 'pause';
      this.lastSyncTime = currentTime;
      this.lastSyncAt = Date.now();

      // Broadcast to party
      if (this.onLocalEvent) {
        this.onLocalEvent({
          action: eventType === 'seeked' ? 'seek' : eventType,
          time: currentTime,
          sentAt: Date.now()
        });
      }
    }
  }

  // ============================
  // Handle incoming player events from iframe
  // ============================
  _handlePlayerEvent(eventType, currentTime) {
    this.lastSyncTime = currentTime;
    this.viewerCurrentTime = currentTime; // Keep in sync
    this.lastSyncAt = Date.now();

    if (eventType === 'play' || eventType === 'pause') {
      this.playbackStatus = eventType;
    }

    if (this.onStatusUpdate) {
      this.onStatusUpdate({ status: this.playbackStatus, time: currentTime });
    }

    // Check for drift (only for viewers, only on timeupdate events)
    if (!this.isHost && eventType === 'timeupdate') {
      this._checkDrift(currentTime);
    }
  }

  // ============================
  // Drift detection and correction
  // ============================
  _checkDrift(currentTime) {
    const now = Date.now();
    const timeSinceSync = (now - this.lastSyncAt) / 1000;

    // Calculate expected time based on last sync and elapsed time
    const expectedTime = this.playbackStatus === 'play'
      ? this.lastSyncTime + timeSinceSync
      : this.lastSyncTime;

    const drift = currentTime - expectedTime;
    const absDrift = Math.abs(drift);

    // Ignore small drift
    if (absDrift < 1) return;

    // Check if we should correct
    if (absDrift > this.DRIFT_THRESHOLD && (now - this.lastCorrectionAt) > this.COOLDOWN) {
      console.log(`[WatchPartySync] Correcting drift: ${absDrift.toFixed(2)}s`);

      // Seek to expected position
      this.seek(expectedTime);
      this.lastCorrectionAt = now;
    }
  }

  // ============================
  // Handle remote commands from host
  // ============================
  executeRemoteCommand(command, time) {
    // Prevent feedback loops
    if (this.isRemoteCommand) return;

    this.isRemoteCommand = true;

    try {
      if (command === 'play') {
        this.play();
      } else if (command === 'pause') {
        this.pause();
      } else if (command === 'seek' && time !== undefined) {
        this.seek(time);
        // Immediately update our state to avoid unnecessary corrections
        this.lastSyncTime = time;
        this.viewerCurrentTime = time;
        this.lastSyncAt = Date.now();
      }
    } finally {
      // Reset flag after a short delay
      setTimeout(() => {
        this.isRemoteCommand = false;
      }, 100);
    }
  }

  // ============================
  // Cleanup
  // ============================
  destroy() {
    // Cleanup if needed
  }
}
