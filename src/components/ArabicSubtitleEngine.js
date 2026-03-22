/**
 * ArabicSubtitleEngine
 *
 * A lightweight subtitle renderer that overlays Arabic text on a video container.
 * Supports SRT and VTT parsing, time-based cue selection, and RTL rendering.
 */
export default class ArabicSubtitleEngine {
  constructor({ container, fetchUrl = null }) {
    this.container = container;
    this.fetchUrl  = fetchUrl;
    
    this._cues       = [];
    this._activeCue  = null;
    this._overlayEl  = null;
    this._videoEl    = null;
    
    this._init();
  }

  _init() {
    this._buildOverlay();
  }

  /**
   * Attach to a video element to sync subtitles with its time.
   * @param {HTMLVideoElement} video 
   */
  attach(video) {
    this._videoEl = video;
    video.addEventListener('timeupdate', () => this.updateTime(video.currentTime));
  }

  /**
   * Build the floating subtitle overlay
   */
  _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'arabic-subtitle-overlay';
    Object.assign(el.style, {
      position: 'absolute',
      bottom: '15%',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '100',
      width: '90%',
      textAlign: 'center',
      direction: 'rtl',
      pointerEvents: 'none',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 'max(1.2rem, 2vw)',
      fontWeight: '600',
      color: 'white',
      textShadow: '0 2px 4px rgba(0,0,0,0.8), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
      opacity: '1',
      transition: 'opacity 200ms ease',
    });
    
    this.container.appendChild(el);
    this._overlayEl = el;
  }

  /**
   * Update the displayed subtitle based on current time
   * @param {number} time - current time in seconds
   */
  updateTime(time) {
    const cue = this._cues.find(c => time >= c.start && time <= c.end);
    
    if (cue !== this._activeCue) {
      this._activeCue = cue;
      this._render(cue);
    }
  }

  /**
   * Public alias for SubDLProvider
   */
  _loadCues(cues) {
    this._cues = cues;
    this._activeCue = null;
    this._render(null);
  }

  getCues() {
    return this._cues;
  }

  /**
   * Final rendering logic
   */
  _render(cue) {
    if (!this._overlayEl) return;
    
    if (!cue) {
      this._overlayEl.textContent = '';
      this._overlayEl.style.opacity = '0';
    } else {
      this._overlayEl.innerHTML = cue.text.replace(/\n/g, '<br>');
      this._overlayEl.style.opacity = '1';
    }
  }

  // ─── Parsers ──────────────────────────────────────────────────────────────

  /**
   * Parse SRT format into a cue array
   */
  _parseSRT(text) {
    const cues = [];
    const blocks = text.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;
      
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (!timeMatch) continue;
      
      const start = this._tsToSec(timeMatch[1]);
      const end   = this._tsToSec(timeMatch[2]);
      const content = lines.slice(2).join('\n');
      
      cues.push({ start, end, text: content });
    }
    return cues;
  }

  /**
   * Parse VTT format into a cue array
   */
  _parseVTT(text) {
    const cues = [];
    const lines = text.trim().split('\n');
    let i = 0;
    
    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes(' --> ')) i++;
    
    while (i < lines.length) {
      const timeLine = lines[i];
      if (!timeLine.includes(' --> ')) { i++; continue; }
      
      const timeMatch = timeLine.match(/(\d{2}:)?\d{2}:\d{2}\.\d{3} --> (\d{2}:)?\d{2}:\d{2}\.\d{3}/);
      if (!timeMatch) { i++; continue; }
      
      const start = this._tsToSec(timeMatch[0].split(' --> ')[0].replace('.', ','));
      const end   = this._tsToSec(timeMatch[0].split(' --> ')[1].replace('.', ','));
      
      let content = "";
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes(' --> ')) {
        content += (content ? "\n" : "") + lines[i];
        i++;
      }
      
      cues.push({ start, end, text: content });
    }
    return cues;
  }

  /**
   * Helper: Timestamp to Seconds (00:00:20,000 -> 20.000)
   */
  _tsToSec(ts) {
    const [hms, ms] = ts.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return (h * 3600) + (m * 60) + s + (parseInt(ms) / 1000);
  }
}
