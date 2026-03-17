import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { updateWatchProgress, syncRoomState } from '../services/appwrite';
import ChatOverlay from './ChatOverlay';

const vidfastOrigins = [
  "https://vidfast.pro",
  "https://vidfast.in",
  "https://vidfast.io",
  "https://vidfast.me",
  "https://vidfast.net",
  "https://vidfast.pm",
  "https://vidfast.xyz"
];

const PartyPlayer = forwardRef(({ movie, roomCode, roomDocId, user, roomState, localEpisode, displayedEpisode, onLocalEpisodeChange, onNativeNavigation, chatMessages, partyMembers, isCinematic, onLeaveParty }, ref) => {
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  
  // 3-State Fullscreen Logic
  // 0 -> Not Fullscreen
  // 1 -> Fullscreen (FIT)
  // 2 -> Fullscreen (FILL)
  const [fsState, setFsState] = useState(0);

  const toggleFullscreenMode = () => {
    if (!containerRef.current) return;

    if (isMobile) {
      if (fsState === 0) {
        // Enter Fullscreen (Fit mode default)
        containerRef.current.requestFullscreen().then(() => {
          if (screen.orientation?.lock) {
            screen.orientation.lock("landscape").catch(() => {});
          }
        }).catch(err => console.error("Fullscreen error:", err));
        setFsState(1);
      } else if (fsState === 1) {
        // Switch to Fill Mode
        setFsState(2);
      } else {
        // Exit Fullscreen
        document.exitFullscreen().catch(err => console.error("Exit fullscreen error:", err));
        setFsState(0);
      }
    } else {
      // Desktop: Standard 2-state toggle
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

  const isHost = user?.$id === movie?.creator_id && !!movie?.creator_id;
  const lastSyncBroadcastRef = useRef(0);
  const viewerCurrentTimeRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(false);
  const lastSentCommandRef = useRef(null);
  const lastOutgoingSyncTimeRef = useRef(0);
  const [showControls, setShowControls] = useState(true);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [seekFeedback, setSeekFeedback] = useState(null); // 'left', 'right', 'center'
  const controlsTimeoutRef = useRef(null);
  
  // Mobile Detection
  const isMobile = useRef(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)).current;

  // Optimization: Delay iframe loading
  useEffect(() => {
    const timer = setTimeout(() => setShouldLoadIframe(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Handle Mouse Activity for UI visibility
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
        if (screen.orientation?.unlock) {
          screen.orientation.unlock().catch(() => {});
        }
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
    };
  }, [isCinematic]);

  // Player URL and Information
  const isTV = (roomState?.media_type || movie?.media_type) === 'tv';
  const tmdbId = roomState?.movie_id || movie?.movie_id;
  const season = roomState?.season || 1;
  const iframeEpisode = localEpisode || roomState?.episode || 1;
  const uiEpisode = displayedEpisode || iframeEpisode;

  const playerURL = isTV
    ? `https://vidfast.pro/tv/${tmdbId}/${season}/${iframeEpisode}?autoPlay=true&nextButton=true&autoNext=false`
    : `https://vidfast.pro/movie/${tmdbId}?autoPlay=true`;

  // Desktop Arrow Control
  const triggerSeek = (side) => {
    const player = iframeRef.current?.contentWindow;
    if (!player) return;

    const delta = side === 'left' ? -10 : 10;
    
    setSeekFeedback(side);
    player.postMessage({ command: "seek", time: Math.floor((viewerCurrentTimeRef.current || 0) + delta) }, "*");
    
    setTimeout(() => setSeekFeedback(null), 300);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
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
  }, []);

  // Listen for Player Events
  useEffect(() => {
    if (!tmdbId) return;

    const handleMessage = (event) => {
      const isVidfast = /vidfast\.(pro|in|io|me|net|pm|xyz)/.test(event.origin);
      if (!isVidfast || !event.data) return;

      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;
        viewerCurrentTimeRef.current = currentTime;

        if (isHost) {
          const now = Date.now();
          const timeSinceLastBroadcast = now - lastSyncBroadcastRef.current;

          if (playerEvent === "play" || playerEvent === "pause" || playerEvent === "seeked" || playerEvent === "next") {
            if (playerEvent === "pause" && now - lastOutgoingSyncTimeRef.current < 2000) return;

            if (timeSinceLastBroadcast > 500 || playerEvent === "next") {
              lastSyncBroadcastRef.current = now;
              const newEpisode = playerEvent === "next" ? uiEpisode + 1 : uiEpisode;

              if (playerEvent === "next") {
                 if (onNativeNavigation) onNativeNavigation(newEpisode);
              } else {
                 const status = (playerEvent === 'pause') ? 'pause' : 'play';
                 syncRoomState(roomDocId || roomCode, status, Math.floor(currentTime), { episode: newEpisode });
                 lastOutgoingSyncTimeRef.current = Date.now();
              }
            }
          }

          if (playerEvent === "timeupdate") {
            viewerCurrentTimeRef.current = currentTime;
            if (now - (window.lastProgressUpdate || 0) > 5000) {
              window.lastProgressUpdate = now;
              updateWatchProgress(tmdbId, currentTime, duration, { media_type: isTV ? 'tv' : 'movie', season, episode: uiEpisode });
            }
          }
        }
      } else if (event.data.type === "MEDIA_DATA") {
        localStorage.setItem('vidFastProgress', JSON.stringify(event.data.data));

        if (isHost && isTV) {
          const showKey = `t${tmdbId}`;
          if (event.data.data && event.data.data[showKey]) {
            const newEpisode = event.data.data[showKey].last_episode_watched;
            if (newEpisode && newEpisode > (displayedEpisode || uiEpisode)) {
              if (onNativeNavigation) onNativeNavigation(newEpisode);
            }
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [tmdbId, isHost, roomCode, isTV, season, uiEpisode, displayedEpisode, localEpisode, roomDocId, onNativeNavigation]);

  // Host Heartbeat
  useEffect(() => {
    if (!isHost || !roomDocId) return;
    const heartbeatInterval = setInterval(() => {
      const currentTime = viewerCurrentTimeRef.current || 0;
      syncRoomState(roomDocId, roomState?.playback_status || 'play', currentTime, { episode: uiEpisode });
    }, 120000);
    return () => clearInterval(heartbeatInterval);
  }, [isHost, roomDocId, uiEpisode, roomState?.playback_status]);

  // Viewer Logic
  useEffect(() => {
    if (isHost || !roomState || !iframeRef.current) return;

    const player = iframeRef.current.contentWindow;
    const { playback_status, last_sync_time, last_sync_at } = roomState;

    if (playback_status !== lastSentCommandRef.current) {
      if (playback_status === "play") {
        player.postMessage({ command: "play" }, "*");
        player.postMessage({ command: "playpause" }, "*");
        if (iframeRef.current) {
           try { iframeRef.current.click(); } catch(e) {}
        }
      } else {
        player.postMessage({ command: "pause" }, "*");
        player.postMessage({ command: "playpause" }, "*");
      }
      lastSentCommandRef.current = playback_status;
    }

    const timeSinceSync = (new Date().getTime() - new Date(last_sync_at).getTime()) / 1000;
    const expectedTime = playback_status === "play" ? last_sync_time + timeSinceSync : last_sync_time;
    const drift = Math.abs(viewerCurrentTimeRef.current - expectedTime);

    const threshold = isMobile ? 6 : 4;
    const cooldown = isMobile ? 4000 : 2500; // Increased cooldown to prevent command spam

    if (drift > threshold && drift < 300 && !isSyncing) {
      setIsSyncing(true);
      // Official Docs: "Seek commands accept time in seconds (integer values)"
      player.postMessage({ command: "seek", time: Math.floor(expectedTime) }, "*");
      setTimeout(() => setIsSyncing(false), cooldown);
    }
  }, [roomState, isHost]);

  const isFullscreen = !!document.fullscreenElement;

  // --- Gesture System (Elite Architecture) ---
  const lastTapRef = useRef(0);

  const handlePointerEvent = (e, side) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < 300) {
      // It's a double tap!
      triggerSeek(side);
      lastTapRef.current = 0; // Reset to prevent 3rd tap from skipping again
    } else {
      // It's a single tap (or first half of a double tap)
      setShowControls(prev => !prev);
      lastTapRef.current = now;
    }
  };

  const gestureZoneClass = "absolute inset-y-0 h-full pointer-events-auto cursor-pointer";

  return (
    <div 
      ref={containerRef} 
      className={`relative overflow-hidden bg-black group/player transition-all duration-300 ${
        isFullscreen || isCinematic 
          ? 'fixed inset-0 w-screen h-dvh z-[9999]' 
          : 'aspect-video rounded-2xl border border-light-100/10 shadow-2xl'
      }`}
    >
      {/* 1️⃣ VIDEO LAYER: z-0 */}
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

      {/* 2️⃣ GESTURE LAYER: z-20 (Top 75% interactive, Bottom 25% passthrough) */}
      <div className="absolute inset-x-0 top-0 h-[75%] z-20 pointer-events-none flex">
        {/* Left Zone - 30% */}
        <div 
          className="w-[30%] h-full pointer-events-auto cursor-pointer"
          onPointerUp={(e) => handlePointerEvent(e, 'left')}
          onClick={(e) => e.preventDefault()} // Ensure click doesn't bubble if pointerUp is handled
        />
        {/* Center Zone - 40% (Native Passthrough for Play/Pause) */}
        <div className="w-[40%] h-full pointer-events-none" />
        {/* Right Zone - 30% */}
        <div 
          className="w-[30%] h-full pointer-events-auto cursor-pointer"
          onPointerUp={(e) => handlePointerEvent(e, 'right')}
          onClick={(e) => e.preventDefault()}
        />
      </div>

      {/* 3️⃣ UI OVERLAY LAYER: z-30 */}
      <div className={`absolute inset-0 z-30 pointer-events-none flex flex-col`}>
        
        {/* Cinematic Top Bar (Safe padding ensures no clipping) */}
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

        {/* Middle Spacer */}
        <div className="flex-1" />

        {/* Floating Overlays Layer (Chat and Sync Status) */}
        <div className="relative pointer-events-none pb-safe">
            {/* Sync Status Badge (Bottom Left, above player controls) */}
            <div className={`absolute bottom-20 left-6 z-[60] flex flex-wrap gap-2 transition-all duration-500 ${showControls || (!isFullscreen && !isCinematic) ? 'opacity-100' : 'opacity-0'}`}>
              {isHost ? (
                <div className="px-3 py-1 bg-amber-500/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-400/20 shadow-lg status-badge-pulse">
                  <span className="size-1.5 bg-white rounded-full" />
                  Host
                </div>
              ) : (
                <div className="px-3 py-1 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-indigo-400/20 shadow-lg status-badge-pulse">
                  <span className={`size-1.5 bg-white rounded-full ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
                  {isSyncing ? 'Syncing...' : 'Synced with Host'}
                </div>
              )}
            </div>

            {/* Auto-Fullscreen Button (Mobile/Cinematic) */}
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

            {/* Chat Overlay (Anchored bottom right) */}
            <div className={`absolute bottom-28 right-6 z-[60] pointer-events-auto transition-all duration-300 ${isChatVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
              <ChatOverlay messages={chatMessages} roomCode={roomCode} user={user} isCinematic={isCinematic} isVisible={true} />
            </div>
        </div>
      </div>

      {/* 4️⃣ FEEDBACK LAYER: z-40 (Netflix style pulses) */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-between px-[15%]">
        <div className={`text-white font-black text-xl flex flex-col items-center justify-center gap-2 transition-all duration-300 ${seekFeedback === 'left' ? 'scale-125 opacity-100' : 'scale-75 opacity-0'}`}>
           <div className="size-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20">
             <span className="text-3xl">⏪</span>
           </div>
           -10s
        </div>



        <div className={`text-white font-black text-xl flex flex-col items-center justify-center gap-2 transition-all duration-300 ${seekFeedback === 'right' ? 'scale-125 opacity-100' : 'scale-75 opacity-0'}`}>
           <div className="size-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20">
             <span className="text-3xl">⏩</span>
           </div>
           +10s
        </div>
      </div>

    </div>
  );
});

export default PartyPlayer;
