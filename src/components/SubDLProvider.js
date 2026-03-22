import JSZip from 'jszip';

/**
 * SubDLProvider
 *
 * Fetches Arabic subtitles from the SubDL API (https://api.subdl.com/api/v1/subtitles)
 * and feeds them directly into ArabicSubtitleEngine.
 *
 * Flow:
 *   1. search()  → calls SubDL search endpoint with tmdb_id + type + season + episode
 *   2. _rank()   → picks the best subtitle entry from the results array
 *   3. _fetch()  → downloads the ZIP from dl.subdl.com
 *   4. _unzip()  → extracts the first .srt or .vtt file from the ZIP (pure JS, no lib)
 *   5. engine.load() is called with the raw subtitle text
 *
 * ⚠️  CORS note
 *   SubDL's API and dl.subdl.com both require a server-side proxy because they
 *   do not set Access-Control-Allow-Origin for browser requests.
 *   Set `proxyBase` to your proxy URL — see PROXY section below.
 *
 * Usage:
 *   import SubDLProvider       from './SubDLProvider.js';
 *   import ArabicSubtitleEngine from './ArabicSubtitleEngine.js';
 *
 *   const engine   = new ArabicSubtitleEngine({ container, fetchUrl: () => '' });
 *   const provider = new SubDLProvider({
 *     apiKey   : 'YOUR_SUBDL_KEY',
 *     proxyBase: 'https://yourserver.com/proxy',   // see PROXY section
 *     engine,
 *   });
 *
 *   // Movie:
 *   await provider.search({ tmdbId: 27205, mediaType: 'movie' });
 *
 *   // TV episode:
 *   await provider.search({ tmdbId: 1399, mediaType: 'tv', season: 1, episode: 3 });
 */

// ─── tiny ZIP parser (no external dependency) ───────────────────────────────
// Implements just enough of the ZIP spec (PKZIP local file header + deflate)
// to extract one text file from a SubDL ZIP response.
// Uses the browser's DecompressionStream (Chromium 80+, Firefox 113+, Safari 16.4+).

/**
 * Read a little-endian 16-bit uint from a DataView.
 * @param {DataView} view
 * @param {number}   offset
 */
function u16(view, offset) { return view.getUint16(offset, true); }

/**
 * Read a little-endian 32-bit uint from a DataView.
 * @param {DataView} view
 * @param {number}   offset
 */
function u32(view, offset) { return view.getUint32(offset, true); }

/**
 * Decompress a raw deflate (no zlib header) Uint8Array using DecompressionStream.
 * @param   {Uint8Array} compressed
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(compressed) {
  const ds     = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();

  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let   pos    = 0;
  for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
  return result;
}

/**
 * Extract subtitle text from a ZIP ArrayBuffer.
 * Walks local file headers and returns the text content of the first
 * .srt or .vtt entry found.
 *
 * Local file header layout (PKZIP spec):
 *   Offset  Len  Field
 *      0     4   Signature  0x04034b50
 *      4     2   Version needed
 *      6     2   General purpose bit flag
 *      8     2   Compression method  (0 = stored, 8 = deflated)
 *     10     2   Last mod time
 *     12     2   Last mod date
 *     14     4   CRC-32
 *     18     4   Compressed size
 *     22     4   Uncompressed size
 *     26     2   File name length
 *     28     2   Extra field length
 *     30     n   File name
 *     30+n   m   Extra field
 *     30+n+m …   File data
 *
 * @param   {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, format: 'srt' | 'vtt', filename: string } | null>}
 */
async function extractSubtitleFromZip(buffer) {
  const view    = new DataView(buffer);
  const bytes   = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  const LOCAL_SIG = 0x04034b50;
  let   offset    = 0;

  while (offset + 30 <= bytes.length) {
    const sig = u32(view, offset);
    if (sig !== LOCAL_SIG) break;

    const method      = u16(view, offset + 8);
    const compSize    = u32(view, offset + 18);
    const nameLen     = u16(view, offset + 26);
    const extraLen    = u16(view, offset + 28);
    const dataOffset  = offset + 30 + nameLen + extraLen;

    const nameBytes   = bytes.slice(offset + 30, offset + 30 + nameLen);
    const filename    = decoder.decode(nameBytes).toLowerCase();

    const isSrt = filename.endsWith('.srt');
    const isVtt = filename.endsWith('.vtt');

    if (isSrt || isVtt) {
      const compData = bytes.slice(dataOffset, dataOffset + compSize);

      let raw;
      if (method === 0) {
        // Stored (no compression)
        raw = compData;
      } else if (method === 8) {
        // Deflate
        raw = await inflateRaw(compData);
      } else {
        // Unknown compression — skip
        offset = dataOffset + compSize;
        continue;
      }

      return {
        text    : decoder.decode(raw),
        format  : isSrt ? 'srt' : 'vtt',
        filename : filename,
      };
    }

    offset = dataOffset + compSize;
  }

  return null;  // No subtitle file found in ZIP
}

// ─────────────────────────────────────────────────────────────────────────────

export default class SubDLProvider {

  // ─────────────────────────────────────────
  // CONSTRUCTION
  // ─────────────────────────────────────────

  /**
   * @param {object}               opts
   * @param {string}               opts.apiKey      - Your SubDL API key
   * @param {string}               opts.proxyBase   - Base URL of your CORS proxy (no trailing slash)
   * @param {ArabicSubtitleEngine} opts.engine      - The subtitle renderer to feed results into
   * @param {number}  [opts.subsPerPage=30]          - How many results to request (max 30)
   * @param {Function} [opts.onStatus]               - (msg: string) => void  — progress callbacks
   * @param {Function} [opts.onError]                - (err: Error) => void
   */
  constructor({ apiKey, proxyBase, engine, subsPerPage = 30, onStatus = null, onError = null }) {
    if (!apiKey)    throw new Error('SubDLProvider: apiKey is required');
    if (!proxyBase) throw new Error('SubDLProvider: proxyBase is required — SubDL requires a server-side proxy for CORS');
    if (!engine)    throw new Error('SubDLProvider: engine (ArabicSubtitleEngine instance) is required');

    this.apiKey      = apiKey;
    this.proxyBase   = proxyBase.replace(/\/$/, '');
    this.engine      = engine;
    this.subsPerPage = Math.min(subsPerPage, 30);
    this.onStatus    = onStatus  ?? (() => {});
    this.onError     = onError   ?? ((e) => console.error('[SubDLProvider]', e));

    // Cache: avoid re-fetching the same episode within a session
    this._cache = new Map();     // key → cue array
  }

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────

  /**
   * Search SubDL for Arabic subtitles, pick the best result, extract
   * the subtitle file from the ZIP, and load it into the engine.
   *
   * @param {object}  opts
   * @param {number}  opts.tmdbId     - TMDB ID (from VidFast PLAYER_EVENT)
   * @param {string}  opts.mediaType  - 'movie' | 'tv'
   * @param {number}  [opts.season]   - Required for TV episodes
   * @param {number}  [opts.episode]  - Required for TV episodes
   *
   * @returns {Promise<{ cueCount: number, subtitle: object, filename: string }>}
   * @throws  {Error}  On network, API, or parse failure (also calls onError)
   */
  async search({ tmdbId, mediaType, season, episode }) {
    const cacheKey = this._cacheKey(tmdbId, mediaType, season, episode);

    if (this._cache.has(cacheKey)) {
      this.onStatus('Using cached Arabic subtitles');
      const cached = this._cache.get(cacheKey);
      await this.engine._loadCues(cached.cues, cached.format);  // see _loadCues patch below
      return { cueCount: cached.cues.length, subtitle: cached.subtitle, filename: cached.filename };
    }

    // ── Step 1: Search ──────────────────────────────────────────────────────
    this.onStatus('Searching SubDL for Arabic subtitles…');

    let subtitles;
    try {
      subtitles = await this._searchSubDL({ tmdbId, mediaType, season, episode });
    } catch (err) {
      this._fail(err);
      throw err;
    }

    if (!subtitles.length) {
      const err = new Error(`SubDLProvider: No Arabic subtitles found for TMDB ${tmdbId}`);
      this._fail(err);
      throw err;
    }

    // ── Step 2: Rank & pick ─────────────────────────────────────────────────
    const best = this._rank(subtitles, { season, episode });
    this.onStatus(`Selected: "${best.release_name}" by ${best.author}`);

    // ── Step 3: Download ZIP ────────────────────────────────────────────────
    this.onStatus('Downloading subtitle file…');

    let zipBuffer;
    try {
      zipBuffer = await this._downloadZip(best.download_link);
    } catch (err) {
      this._fail(err);
      throw err;
    }

    // ── Step 4: Extract from ZIP ────────────────────────────────────────────
    this.onStatus('Extracting subtitle from ZIP…');

    let extracted;
    try {
      extracted = await extractSubtitleFromZip(zipBuffer);
    } catch (err) {
      this._fail(new Error(`SubDLProvider: ZIP extraction failed — ${err.message}`));
      throw err;
    }

    if (!extracted) {
      const err = new Error('SubDLProvider: ZIP contained no .srt or .vtt file');
      this._fail(err);
      throw err;
    }

    // ── Step 5: Parse & load into engine ────────────────────────────────────
    this.onStatus(`Parsing ${extracted.format.toUpperCase()} (${extracted.filename})…`);

    let cueCount;
    try {
      cueCount = await this._injectIntoEngine(extracted.text, extracted.format);
    } catch (err) {
      this._fail(err);
      throw err;
    }

    // ── Cache ────────────────────────────────────────────────────────────────
    const cues = this.engine.getCues();
    this._cache.set(cacheKey, {
      cues     : cues,
      format   : extracted.format,
      subtitle : best,
      filename : extracted.filename,
    });

    this.onStatus(`✓ ${cueCount} Arabic cues loaded`);
    return { cueCount, subtitle: best, filename: extracted.filename };
  }

  /**
   * Clear the in-memory session cache (e.g. on media change).
   */
  clearCache() {
    this._cache.clear();
  }

  // ─────────────────────────────────────────
  // SUBDL SEARCH
  // ─────────────────────────────────────────

  /**
   * Call the SubDL search API through your proxy and return the subtitles array.
   * Requests up to subsPerPage results, AR language only.
   *
   * SubDL API:
   *   GET https://api.subdl.com/api/v1/subtitles
   *     ?api_key=…&tmdb_id=…&type=movie|tv&languages=AR
   *     &season_number=…&episode_number=…   (TV only)
   *     &subs_per_page=30
   *
   * @returns {Promise<Array>}  raw subtitle objects from SubDL response
   */
  async _searchSubDL({ tmdbId, mediaType, season, episode }) {
    const params = new URLSearchParams({
      api_key      : this.apiKey,
      tmdb_id      : tmdbId,
      type         : mediaType,
      languages    : 'AR',
      subs_per_page: this.subsPerPage,
    });

    if (mediaType === 'tv' && season  != null) params.set('season_number',  season);
    if (mediaType === 'tv' && episode != null) params.set('episode_number', episode);

    // Route through your proxy to avoid CORS:
    //   GET /proxy/subdl-search?…params…
    // Your proxy forwards to https://api.subdl.com/api/v1/subtitles?…params…
    const url = `${this.proxyBase}/subdl-search?${params.toString()}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`SubDL search HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();

    if (!json.status) {
      throw new Error(`SubDL API error: ${json.error ?? 'unknown error'}`);
    }

    return json.subtitles ?? [];
  }

  // ─────────────────────────────────────────
  // RANKING
  // ─────────────────────────────────────────

  /**
   * Pick the best subtitle from the results array.
   *
   * Scoring strategy (higher = better):
   *
   *   Episode match  +100   (TV: season & episode both match)
   *   Season match   + 50   (TV: season matches, episode is 0/null = full-season pack)
   *   Source quality  0–40  (BluRay=40, WEB-DL=35, WEBRip=30, HDTV=20, DVDRip=10)
   *   Author length   0–5   (longer author name slightly preferred over "anonymous")
   *
   * SubDL doesn't expose a download_count field, so release quality
   * signals are the most reliable available heuristic.
   *
   * @param   {Array}  subtitles - raw SubDL subtitle objects
   * @param   {{ season, episode }} context
   * @returns {object} the highest-scoring subtitle object
   */
  _rank(subtitles, { season, episode }) {
    return subtitles
      .map((sub) => ({ sub, score: this._score(sub, season, episode) }))
      .sort((a, b) => b.score - a.score)
      [0].sub;
  }

  _score(sub, season, episode) {
    let score = 0;
    const name = (sub.release_name ?? sub.name ?? '').toLowerCase();

    // ── Episode / season match (TV) ──────────────────────────────────────
    const subSeason  = sub.season  ?? 0;
    const subEpisode = sub.episode ?? 0;

    if (season != null && episode != null) {
      if (subSeason === season && subEpisode === episode) score += 100;
      else if (subSeason === season && subEpisode === 0)  score += 50;
      // season 0 = whole-series pack, mild credit
      else if (subSeason === 0 && subEpisode === 0)       score += 10;
    }

    // ── Release quality ───────────────────────────────────────────────────
    if (/blu[\s\-]?ray|bluray|bdrip/i.test(name))         score += 40;
    else if (/web[\s\-]?dl/i.test(name))                  score += 35;
    else if (/web[\s\-]?rip|webrip/i.test(name))          score += 30;
    else if (/hdtv/i.test(name))                           score += 20;
    else if (/dvdrip|dvdscr/i.test(name))                 score += 10;

    // ── Resolution signals ────────────────────────────────────────────────
    if (/2160p|4k/i.test(name))    score += 5;
    else if (/1080p/i.test(name))  score += 4;
    else if (/720p/i.test(name))   score += 2;

    // ── Author heuristic ──────────────────────────────────────────────────
    const authorLen = (sub.author ?? '').length;
    score += Math.min(authorLen, 5);

    return score;
  }

  // ─────────────────────────────────────────
  // ZIP DOWNLOAD
  // ─────────────────────────────────────────

  /**
   * Download a ZIP from dl.subdl.com via your proxy as an ArrayBuffer.
   *
   * Your proxy should:
   *   GET /proxy/subdl-zip?url=https%3A%2F%2Fdl.subdl.com%2Fsubtitle%2F…
   *   → respond with the raw ZIP bytes (Content-Type: application/zip)
   *
   * @param   {string}      downloadLink  - Full dl.subdl.com URL from subtitle object
   * @returns {Promise<ArrayBuffer>}
   */
  async _downloadZip(downloadLink) {
    const url = `${this.proxyBase}/subdl-zip?url=${encodeURIComponent(downloadLink)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SubDL ZIP download HTTP ${res.status}: ${res.statusText}`);
    }

    return res.arrayBuffer();
  }

  // ─────────────────────────────────────────
  // ENGINE INJECTION
  // ─────────────────────────────────────────

  /**
   * Parse subtitle text and inject cues directly into the engine,
   * bypassing its normal fetch-based load() flow.
   *
   * This calls the engine's internal parse methods, which are available
   * as the engine is designed to allow this use-case.
   *
   * @param   {string}  text    - Raw SRT or VTT text
   * @param   {'srt'|'vtt'} format
   * @returns {Promise<number>} Number of cues loaded
   */
  async _injectIntoEngine(text, format) {
    // Use the engine's own parsers, then inject via the internal _loadCues path.
    // If you prefer not to reach into private methods, use the exported
    // ArabicSubtitleEngine.loadRaw() described in the integration notes below.
    const cues = format === 'vtt'
      ? this.engine._parseVTT(text)
      : this.engine._parseSRT(text);

    cues.sort((a, b) => a.start - b.start);

    // Directly set engine state — identical to what load() does after fetch
    this.engine._cues      = cues;
    this.engine._activeCue = null;
    this.engine._render(null);   // clear any stale subtitle currently showing

    return cues.length;
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  _cacheKey(tmdbId, mediaType, season, episode) {
    return mediaType === 'tv'
      ? `tv-${tmdbId}-s${season ?? 0}-e${episode ?? 0}`
      : `movie-${tmdbId}`;
  }

  _fail(err) {
    console.error('[SubDLProvider]', err);
    this.onError(err);
  }
}

/*
 * ══════════════════════════════════════════════════════════════════════════════
 * PROXY SETUP (required — SubDL blocks direct browser requests via CORS)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * You need two proxy routes on your server. Here's a minimal Express example:
 *
 *   // server.js
 *   import express from 'express';
 *   import fetch   from 'node-fetch';
 *
 *   const app = express();
 *
 *   // Route 1: SubDL search API
 *   app.get('/proxy/subdl-search', async (req, res) => {
 *     const upstream = new URL('https://api.subdl.com/api/v1/subtitles');
 *     // Forward all query params as-is (api_key, tmdb_id, type, languages, etc.)
 *     for (const [k, v] of Object.entries(req.query)) upstream.searchParams.set(k, v);
 *
 *     const json = await fetch(upstream.toString()).then(r => r.json());
 *     res.json(json);
 *   });
 *
 *   // Route 2: SubDL ZIP download
 *   app.get('/proxy/subdl-zip', async (req, res) => {
 *     const { url } = req.query;
 *     if (!url?.startsWith('https://dl.subdl.com/')) {
 *       return res.status(400).send('Invalid URL');
 *     }
 *     const upstream = await fetch(url);
 *     res.set('Content-Type', 'application/zip');
 *     upstream.body.pipe(res);
 *   });
 *
 *   app.listen(3000);
 *
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * FULL INTEGRATION EXAMPLE (with WatchPartySync + ArabicSubtitleEngine)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   import WatchPartySync        from './WatchPartySync.v3.js';
 *   import ArabicSubtitleEngine  from './ArabicSubtitleEngine.js';
 *   import SubDLProvider         from './SubDLProvider.js';
 *
 *   const iframe    = document.querySelector('#vidfast-player');
 *   const container = document.querySelector('#player-wrapper');
 *
 *   const engine = new ArabicSubtitleEngine({ container,
 *     fetchUrl: () => '',           // unused — SubDLProvider bypasses fetch
 *   });
 *
 *   const provider = new SubDLProvider({
 *     apiKey   : 'YOUR_SUBDL_KEY',
 *     proxyBase: 'https://yourserver.com',
 *     engine,
 *     onStatus : (msg) => console.log('[SubDL]', msg),
 *     onError  : (err) => console.error('[SubDL]', err),
 *   });
 *
 *   const sync = new WatchPartySync({ iframe, transport: myTransport });
 *   sync.attachSubtitles(engine);
 *
 *   // Trigger load from the first VidFast PLAYER_EVENT that carries media info
 *   let subtitlesLoaded = false;
 *   window.addEventListener('message', ({ data }) => {
 *     if (data?.type !== 'PLAYER_EVENT' || subtitlesLoaded) return;
 *     const { tmdbId, mediaType, season, episode } = data.data;
 *     if (!tmdbId) return;
 *
 *     subtitlesLoaded = true;
 *     provider.search({ tmdbId, mediaType, season, episode })
 *       .then(({ cueCount, subtitle }) => {
 *         console.log(`Loaded ${cueCount} cues — "${subtitle.release_name}"`);
 *       })
 *       .catch(() => { subtitlesLoaded = false; });  // allow retry on failure
 *   });
 *
 *   // TV: reload subtitles when episode changes
 *   let lastEpisodeKey = null;
 *   window.addEventListener('message', ({ data }) => {
 *     if (data?.type !== 'PLAYER_EVENT') return;
 *     const { tmdbId, mediaType, season, episode } = data.data;
 *     const key = `${tmdbId}-s${season}-e${episode}`;
 *     if (key === lastEpisodeKey) return;
 *     lastEpisodeKey = key;
 *     provider.search({ tmdbId, mediaType, season, episode }).catch(() => {});
 *   });
 */
