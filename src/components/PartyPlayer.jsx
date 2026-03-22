/* eslint-disable react/prop-types */
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { updateWatchProgress, syncRoomState } from '../services/appwrite';
import ChatOverlay from './ChatOverlay';
import VoiceChatOverlay from './VoiceChatOverlay';
import WatchPartySync from './WatchPartySync';

const PartyPlayer = forwardRef(({
  movie,
  roomCode,
  roomDocId,
  user,
  roomState,
  localEpisode,
  displayedEpisode,
  onNativeNavigation,
  chatMessages,
  partyMembers,
  isCinematic,
  onLeaveParty,
  voiceChatProps
}, ref) => {
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const watchPartyRef = useRef(null);
  const roomStateRef = useRef(roomState);
  const hasInitialSynced = useRef(false);

  // UI State
  const [fsState, setFsState] = useState(0);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [seekFeedback, setSeekFeedback] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const controlsTimeoutRef = useRef(null);
  const lastCommandRef = useRef({ key: null, time: 0 });

  const isHost = user?.$id === movie?.creator_id && !!movie?.creator_id;

  // Mobile detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // Keep roomStateRef in sync
  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  // Fullscreen handling
  const toggleFullscreenMode = () => {
    if (!containerRef.current) return;

    if (isMobile) {
      if (fsState === 0) {
        containerRef.current.requestFullscreen().then(() => {
          if (screen.orientation?.lock) screen.orientation.lock("landscape").catch(() => {});
        }).catch(err => console.error("Fullscreen error:", err));
        setFsState(1);
      } else if (fsState === 1) {
        setFsState(2);
      } else {
        document.exitFullscreen().catch(err => console.error("Exit fullscreen error:", err));
        setFsState(0);
      }
    } else {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(err => console.error("Fullscreen error:", err));
      } else {
        document.exitFullscreen();
      }
    }
  };

  useImperativeHandle(ref, () => ({
    toggleFullscreen: toggleFullscreenMode
  }));

  // Mouse activity and Fullscreen visibility
  useEffect(() => {
    const handleActivity = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
        if (isCinematic || document.fullscreenElement) setShowControls(false);
      }, 3000);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleActivity);
      container.addEventListener('touchstart', handleActivity, { passive: true });
    }

    const handleFullscreenChange = () => {
      const isActuallyFS = !!document.fullscreenElement;
      if (!isActuallyFS) {
        setFsState(0);
        if (screen.orientation?.unlock) screen.orientation.unlock().catch(() => {});
        document.body.classList.remove('overflow-hidden');
      } else {
        document.body.classList.add('overflow-hidden');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleActivity);
        container.removeEventListener('touchstart', handleActivity);
      }
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.body.classList.remove('overflow-hidden');
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isCinematic]);

  // Delay iframe load
  useEffect(() => {
    const timer = setTimeout(() => setShouldLoadIframe(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Build player URL
  const isTV = (roomState?.media_type || movie?.media_type) === 'tv';
  const tmdbId = roomState?.movie_id || movie?.movie_id;
  const season = roomState?.season || 1;
  const iframeEpisode = localEpisode || roomState?.episode || 1;
  const uiEpisode = displayedEpisode || iframeEpisode;

  const playerURL = isTV
    ? `https://vidfast.pro/tv/${tmdbId}/${season}/${iframeEpisode}?autoPlay=true&nextButton=true&autoNext=false`
    : `https://vidfast.pro/movie/${tmdbId}?autoPlay=true`;

  // Keyboard controls
  const triggerSeek = (side) => {
    const player = iframeRef.current?.contentWindow;
    if (!player) return;

    const delta = side === 'left' ? -10 : 10;

    setSeekFeedback(side);
    player.postMessage({ command: "seek", time: Math.floor(watchPartyRef.current?.viewerCurrentTime || 0) + delta }, "*");

    setTimeout(() => setSeekFeedback(null), 300);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isHost) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.code === "ArrowLeft") {
        e.preventDefault();
        triggerSeek('left');
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        triggerSeek('right');
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHost]);

  // ============================
  // WatchPartySync Integration (v3)
  // ============================
  useEffect(() => {
    if (!iframeRef.current || !shouldLoadIframe || !roomDocId) return;

    // 1. Define the transport bridge between the sync engine and Appwrite
    const transport = {
      send: (cmd) => {
        if (!isHost) return;
        // Broadcast host action to room via Appwrite
        // We use Math.floor for last_sync_time to avoid jitter in Appwrite db if needed,
        // but WatchPartySync v3 allows sub-second. Let's use full float.
        syncRoomState(roomDocId, cmd.action, cmd.time, {
          sentAt: cmd.sentAt
        });
      },
      onMessage: (callback) => {
        // We use the roomState prop (from useWatchParty hook) to drive remote commands.
        // This is where we bridge Appwrite real-time updates to the sync engine.
        // We wrap this in a ref-like check or just let the effect handle it.
        return () => {}; // No explicit unsub needed as we'll handle updates via the effect below
      }
    };

    // 2. Create the v3 sync engine instance
    watchPartyRef.current = new WatchPartySync({
      iframe: iframeRef.current,
      transport,
      isHost,
      isMobile
    });

    // 3. Keep UI isSyncing state in sync with the engine
    const syncStatusInterval = setInterval(() => {
      if (watchPartyRef.current && isSyncing !== watchPartyRef.current.isSyncing) {
        setIsSyncing(watchPartyRef.current.isSyncing);
      }
    }, 500);

    return () => {
      if (syncStatusInterval) clearInterval(syncStatusInterval);
      if (watchPartyRef.current) {
        watchPartyRef.current.destroy();
        watchPartyRef.current = null;
      }
      hasInitialSynced.current = false;
    };
  }, [isHost, isMobile, shouldLoadIframe, roomDocId, isSyncing]);

  // Handle roomState updates from Appwrite and forward to WatchPartySync transport
  useEffect(() => {
    if (isHost || !roomState || !watchPartyRef.current) return;

    // Bridge roomState to the sync engine's internal _handleRemote method.
    // We simulate a transport message based on the latest roomState.
    const remoteCmd = {
      action: roomState.playback_status,
      time: roomState.last_sync_time || 0,
      sentAt: roomState.last_sync_at ? new Date(roomState.last_sync_at).getTime() : Date.now()
    };

    // Only sync if it's actually a new command to prevent feedback loops
    // (WatchPartySync v3 already has internal guards like lastSyncSentAt)
    watchPartyRef.current._handleRemote(remoteCmd);
  }, [roomState, isHost]);

  // Handle initial sync when join mid-session
  useEffect(() => {
    if (!isHost && watchPartyRef.current && roomState && !hasInitialSynced.current) {
        watchPartyRef.current.syncToHost({
          time: roomState.last_sync_time || 0,
          playing: roomState.playback_status === 'play',
          sentAt: roomState.last_sync_at ? new Date(roomState.last_sync_at).getTime() : Date.now()
        });
        hasInitialSynced.current = true;
    }
  }, [roomState, isHost]);

  // Handle local events from host player
  useEffect(() => {
    if (!isHost || !watchPartyRef.current) return;

    const handleMessage = (event) => {
      const isVidfast = /vidfast\.(pro|in|io|me|net|pm|xyz)/.test(event.origin);
      if (!isVidfast || !event.data) return;

      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;

        // VidFast sends 'PLAYER_EVENT' for play/pause/seeked
        // These are handled by WatchPartySync v3 internally if we forward them
        // Wait, WatchPartySync v3 adds its own window listener in constructor!
        // So we don't need to manually call handleLocalEvent unless we want to overide.
        
        // Let's keep progress tracking as it's separate from sync
        if (playerEvent === "timeupdate") {
          const now = Date.now();
          if (now - (window.lastProgressUpdate || 0) > 5000) {
            window.lastProgressUpdate = now;
            updateWatchProgress(tmdbId, currentTime, duration, isTV ? { media_type: 'tv', season, episode: uiEpisode } : { media_type: 'movie' });
          }
        }
      }

      if (event.data.type === "MEDIA_DATA") {
        localStorage.setItem('vidFastProgress', JSON.stringify(event.data.data));
        if (isHost && isTV) {
          const showKey = `t${tmdbId}`;
          if (event.data.data?.[showKey]) {
            const newEpisode = event.data.data[showKey].last_episode_watched;
            if (newEpisode && newEpisode > uiEpisode && onNativeNavigation) {
              onNativeNavigation(newEpisode);
            }
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isHost, isTV, tmdbId, season, uiEpisode, onNativeNavigation]);


  // Gesture system for mobile
  const lastTapRef = useRef(0);
  const handlePointerEvent = (e, side) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < 300) {
      if (isHost) triggerSeek(side);
      lastTapRef.current = 0;
    } else {
      setShowControls(prev => !prev);
      lastTapRef.current = now;
    }
  };

  const isFullscreen = !!document.fullscreenElement;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-black group/player transition-all duration-500 ${
        isFullscreen || isCinematic
          ? 'fixed inset-0 w-screen h-dvh z-[9999]'
          : 'aspect-video rounded-2xl border border-light-100/10 shadow-2xl'
      }`}
    >
      {/* Video Layer */}
      <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden pointer-events-none">
        {shouldLoadIframe ? (
          <iframe
            ref={iframeRef}
            id="party-player-iframe"
            src={playerURL}
            className={`w-full h-full transition-transform duration-500 ease-out pointer-events-auto ${
              fsState === 2 ? 'scale-[1.4] sm:scale-[1.15] object-cover' : 'scale-100'
            }`}
            allowFullScreen
            allow="autoplay; encrypted-media"
            title="Media Player"
            frameBorder="0"
          />
        ) : (
          <div className="size-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        )}
      </div>

      {/* Gesture Layer */}
      <div className="absolute inset-x-0 top-0 h-[75%] z-20 pointer-events-none flex">
        <div
          className="w-[30%] h-full pointer-events-auto cursor-pointer"
          onPointerUp={(e) => handlePointerEvent(e, 'left')}
          onClick={(e) => e.preventDefault()}
        />
        <div className="w-[40%] h-full pointer-events-none" />
        {isHost ? (
          <div
            className="w-[30%] h-full pointer-events-auto cursor-pointer"
            onPointerUp={(e) => handlePointerEvent(e, 'right')}
            onClick={(e) => e.preventDefault()}
          />
        ) : (
          <div className="w-[30%] h-full pointer-events-none" />
        )}
      </div>

      {/* UI Overlay */}
      <div className={`absolute inset-0 z-30 pointer-events-none flex flex-col`}>
        {/* Top Bar */}
        <div className={`pt-2 px-6 py-4 flex items-center justify-between transition-all duration-500 transform pointer-events-auto bg-linear-to-b from-black/90 via-black/40 to-transparent ${showControls || (!isFullscreen && !isCinematic) ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}>
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onLeaveParty) onLeaveParty();
              }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all hover:scale-110 active:scale-90"
            >
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(roomCode); alert("Room Code Copied!"); }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-light-200 transition-all hover:scale-105 active:scale-95 border border-white/5 flex items-center gap-2"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
              <span className="font-mono text-sm uppercase tracking-tighter hidden sm:block">{roomCode}</span>
            </button>
          </div>

          <div className="flex flex-col items-center flex-1 mx-4 max-w-[40%] text-center">
            <h2 className="text-white font-black text-sm sm:text-lg tracking-tight truncate w-full shadow-black drop-shadow-md">
              {movie?.movie_title}
            </h2>
            {isTV && (
              <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest -mt-1 drop-shadow-sm">
                Season {season} Episode {uiEpisode}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsChatVisible(!isChatVisible)}
              className={`transition-all hover:scale-110 active:scale-95 ${isChatVisible ? 'text-indigo-400' : 'text-white/40 hover:text-white'}`}
            >
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </button>

            <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
              <div className="size-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              <span className="text-white font-black text-sm tracking-tighter">{(partyMembers?.length || 1)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Floating Overlays */}
        <div className="relative pointer-events-none pb-2">
          {/* Sync Status */}
          <div className={`absolute bottom-20 left-6 z-[60] flex flex-wrap gap-2 transition-all duration-500 ${showControls || (!isFullscreen && !isCinematic) ? 'opacity-100' : 'opacity-0'}`}>
            {isHost ? (
              <div className="px-3 py-1 bg-amber-500/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-400/20 shadow-lg">
                <span className="size-1.5 bg-white rounded-full" />
                Host
              </div>
            ) : (
              <div className="px-3 py-1 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-indigo-400/20 shadow-lg">
                <span className={`size-1.5 bg-white rounded-full ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
                {isSyncing ? 'Syncing...' : 'Synced with Host'}
                <button
                  onClick={() => watchPartyRef.current?.forceResync()}
                  className="ml-1 hover:bg-white/10 rounded p-0.5 transition-colors pointer-events-auto"
                  title="Resync"
                  type="button"
                >
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Voice Chat */}
          {voiceChatProps && (
            <VoiceChatOverlay
              isConnected={voiceChatProps.isConnected}
              isMuted={voiceChatProps.isMuted}
              toggleMute={voiceChatProps.toggleMute}
              speakingParticipants={voiceChatProps.speakingParticipants}
              participants={voiceChatProps.participants}
              showControls={showControls || (!isFullscreen && !isCinematic)}
            />
          )}



          {/* Fullscreen Button */}
          <div className={`absolute bottom-20 right-6 z-[60] flex items-center gap-2 transition-all duration-500 pointer-events-auto ${showControls || (!isFullscreen && !isCinematic) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
              onClick={toggleFullscreenMode}
              className={`px-3 py-1.5 backdrop-blur-sm rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border shadow-lg transition-all hover:scale-105 active:scale-95 ${fsState === 2 ? 'bg-indigo-600/90 border-indigo-400/20 text-white' : 'bg-white/5 hover:bg-white/10 border-white/10 text-light-200'}`}
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {fsState === 0 ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                ) : fsState === 1 ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5" />
                )}
              </svg>
              {isMobile ? (fsState === 0 ? "Fullscreen" : (fsState === 1 ? "Fit" : "Fill")) : "Fullscreen"}
            </button>
          </div>

          {/* Chat Overlay */}
          <div className={`absolute bottom-28 right-6 z-[60] pointer-events-auto transition-all duration-300 ${isChatVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
            <ChatOverlay messages={chatMessages} roomCode={roomCode} user={user} isCinematic={isCinematic} isVisible={true} />
          </div>
        </div>
      </div>

      {/* Seek Feedback */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-between px-[15%]">
        <div className={`text-white font-black text-xl flex flex-col items-center justify-center gap-2 transition-all duration-300 ${seekFeedback === 'left' ? 'scale-125 opacity-100' : 'scale-75 opacity-0'}`}>
          <div className="size-16 bg-indigo-500/30 backdrop-blur-xl rounded-full flex items-center justify-center border border-indigo-400/50 shadow-[0_0_30px_rgba(99,102,241,0.5)]">
            <svg className="size-8 text-white opacity-90 drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)] ml-[-0.25rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </div>
          <span className="drop-shadow-lg">-10s</span>
        </div>

        <div className={`text-white font-black text-xl flex flex-col items-center justify-center gap-2 transition-all duration-300 ${seekFeedback === 'right' ? 'scale-125 opacity-100' : 'scale-75 opacity-0'}`}>
          <div className="size-16 bg-indigo-500/30 backdrop-blur-xl rounded-full flex items-center justify-center border border-indigo-400/50 shadow-[0_0_30px_rgba(99,102,241,0.5)]">
            <svg className="size-8 text-white opacity-90 drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)] ml-[0.25rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </div>
          <span className="drop-shadow-lg">+10s</span>
        </div>
      </div>
    </div>
  );
});

PartyPlayer.displayName = 'PartyPlayer';

export default PartyPlayer;
