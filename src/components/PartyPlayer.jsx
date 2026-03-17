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
  
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (isMobile) {
      if (!document.fullscreenElement) {
        // State 1: Enter Fullscreen
        containerRef.current.requestFullscreen().then(() => {
            if (screen.orientation?.lock) {
              screen.orientation.lock("landscape").catch(() => {});
            }
        }).catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      } else {
        // State 2 & 3: Toggle Fill/Original
        setIsFillMode(!isFillMode);
      }
      return;
    }

    // Desktop: Standard Toggle
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useImperativeHandle(ref, () => ({
    toggleFullscreen
  }));

  const isHost = user?.$id === movie?.creator_id && !!movie?.creator_id;
  const lastSyncBroadcastRef = useRef(0);
  const viewerCurrentTimeRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(false);
  const lastSentCommandRef = useRef(null); // Tracks last command sent to iframe to avoid redundancy
  const lastStateRef = useRef(null);      // Tracks last playback_status we reacted to
  const lastOutgoingSyncTimeRef = useRef(0); // For Host grace period
  const [showControls, setShowControls] = useState(true);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isFillMode, setIsFillMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState(null); // 'left', 'right', 'center'
  const controlsTimeoutRef = useRef(null);
  
  // Mobile Detection
  const isMobile = useRef(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)).current;

  // Optimization: Delay iframe loading to prioritize UI paint
  useEffect(() => {
    const timer = setTimeout(() => setShouldLoadIframe(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Handle Mouse Activity for Top Bar
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
      container.addEventListener('touchstart', handleActivity);
    }

    const handleFullscreenChange = () => {
      const isActuallyFS = !!document.fullscreenElement;
      if (!isActuallyFS) {
        setIsFillMode(false);
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
  }, [isCinematic, isMobile]);

  // Determine Player URL - use localEpisode to prevent reloads on native 'next' navigation
  const isTV = (roomState?.media_type || movie?.media_type) === 'tv';
  const tmdbId = roomState?.movie_id || movie?.movie_id;
  const season = roomState?.season || 1;
  const iframeEpisode = localEpisode || roomState?.episode || 1;
  const uiEpisode = displayedEpisode || iframeEpisode;

  const playerURL = isTV
    ? `https://vidfast.pro/tv/${tmdbId}/${season}/${iframeEpisode}?autoPlay=true&nextButton=true&autoNext=false`
    : `https://vidfast.pro/movie/${tmdbId}?autoPlay=true`;

  // --- Common Logic: Listen for Player Events ---
  useEffect(() => {
    if (!tmdbId) return;

    const handleMessage = (event) => {
      // Robust origin check for any vidfast subdomain or TLD
      const isVidfast = /vidfast\.(pro|in|io|me|net|pm|xyz)/.test(event.origin);
      if (!isVidfast || !event.data) return;

      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;

        viewerCurrentTimeRef.current = currentTime;

        if (isHost) {
          const now = Date.now();
          const timeSinceLastBroadcast = now - lastSyncBroadcastRef.current;

          if (playerEvent === "play" || playerEvent === "pause" || playerEvent === "seeked" || playerEvent === "next") {
            // GRACE PERIOD: If browser pauses automatically right after host clicks "play" (common on mobile), ignore it.
            if (playerEvent === "pause" && now - lastOutgoingSyncTimeRef.current < 2000) {
              return;
            }

            if (timeSinceLastBroadcast > 500 || playerEvent === "next") {
              lastSyncBroadcastRef.current = now;
              const newEpisode = playerEvent === "next" ? uiEpisode + 1 : uiEpisode;

              if (playerEvent === "next") {
                 if (onNativeNavigation) {
                   onNativeNavigation(newEpisode); // ONLY updates UI and room state, skips iframe reload
                 }
              } else {
                 const status = (playerEvent === 'pause') ? 'pause' : 'play';
                 syncRoomState(roomDocId || roomCode, status, currentTime, { 
                   episode: newEpisode
                 });
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
        // Doc Recommendation: Persist progress to localStorage
        localStorage.setItem('vidFastProgress', JSON.stringify(event.data.data));

        if (isHost && isTV) {
          const mediaData = event.data.data;
          const showKey = `t${tmdbId}`;

          if (mediaData && mediaData[showKey]) {
            const showData = mediaData[showKey];
            const newEpisode = showData.last_episode_watched;

            if (newEpisode && newEpisode > (displayedEpisode || uiEpisode)) {
              if (onNativeNavigation) {
                onNativeNavigation(newEpisode); // ONLY updates UI, does not reload iframe
              }
            }
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [tmdbId, isHost, roomCode, isTV, season, uiEpisode, displayedEpisode, localEpisode, roomDocId, onNativeNavigation]);

  // --- Host Heartbeat: Keep Room Active with REAL position ---
  useEffect(() => {
    if (!isHost || !roomDocId) return;

    const heartbeatInterval = setInterval(() => {
      // Use the ref because it's updated constantly by the player message listener
      const currentTime = viewerCurrentTimeRef.current || 0;
      syncRoomState(roomDocId, roomState?.playback_status || 'play', currentTime, { episode: uiEpisode });
    }, 120000); // 2 minutes

    return () => clearInterval(heartbeatInterval);
  }, [isHost, roomDocId, uiEpisode, roomState?.playback_status]);

  // --- Viewer Logic: Sync with Host State ---
  useEffect(() => {
    if (isHost || !roomState || !iframeRef.current) return;

    const player = iframeRef.current.contentWindow;
    const { playback_status, last_sync_time, last_sync_at } = roomState;

    // 1. Buffering: Only send play/pause if it actually changed
    if (playback_status !== lastSentCommandRef.current) {
      if (playback_status === "play") {
        // Doc Recommendation: Send time with play for instant sync
        player.postMessage({ command: "play", time: Math.floor(expectedTime) }, "*");
      } else {
        player.postMessage({ command: "pause" }, "*");
      }
      lastSentCommandRef.current = playback_status;
    }

    // 2. Drift & Sync Logic
    const timeSinceSync = (new Date().getTime() - new Date(last_sync_at).getTime()) / 1000;
    const expectedTime = playback_status === "play" ? last_sync_time + timeSinceSync : last_sync_time;

    const drift = Math.abs(viewerCurrentTimeRef.current - expectedTime);

    // Adaptive Threshold: Phones need more "breathing room" (6s) than PCs (4s)
    const threshold = isMobile ? 6 : 4;
    const cooldown = isMobile ? 3000 : 2000;

    // Only seek if drift is > threshold AND we haven't synced in the last 'cooldown' ms
    if (drift > threshold && drift < 300 && !isSyncing) {
      setIsSyncing(true);
      player.postMessage({ command: "seek", time: Math.floor(expectedTime) }, "*");
      setTimeout(() => setIsSyncing(false), cooldown);
    }

  }, [roomState, isHost]);

  const isFullscreen = !!document.fullscreenElement;

  // Gesture Handling
  const lastTapRef = useRef(0);
  const handleGesture = (e) => {
    e.preventDefault();
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double Tap detected
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const width = rect.width;
      
      const player = iframeRef.current?.contentWindow;
      if (!player) return;

      if (x < width * 0.3) {
        // Left 30%: Rewind
        setSeekFeedback('left');
        player.postMessage({ command: "seek", time: Math.floor((viewerCurrentTimeRef.current || 0) - 10) }, "*");
      } else if (x > width * 0.7) {
        // Right 30%: Fast Forward
        setSeekFeedback('right');
        player.postMessage({ command: "seek", time: Math.floor((viewerCurrentTimeRef.current || 0) + 10) }, "*");
      } else {
        // Center 40%: Pause/Play
        const newStatus = roomState?.playback_status === 'play' ? 'pause' : 'play';
        setSeekFeedback('center');
        
        // Doc Recommendation: Use play + time for instant response
        if (newStatus === 'play') {
          player.postMessage({ command: "play", time: Math.floor(viewerCurrentTimeRef.current || 0) }, "*");
        } else {
          player.postMessage({ command: "pause" }, "*");
        }

        // Host then syncs this to the room
        if (isHost) {
          syncRoomState(roomDocId || roomCode, newStatus, viewerCurrentTimeRef.current, { episode: uiEpisode });
        }
      }
      
      // Clear feedback after animation
      setTimeout(() => setSeekFeedback(null), 600);
      lastTapRef.current = 0; // Reset
    } else {
      lastTapRef.current = now;
      // Single Tap: Toggle UI
      setShowControls(prev => !prev);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={`relative overflow-hidden bg-black group/player transition-all duration-300 ${
        isFullscreen || isCinematic 
          ? 'fixed inset-0 w-screen h-dvh z-[9999]' 
          : 'aspect-video rounded-2xl border border-light-100/10 shadow-2xl'
      }`}
    >
      {/* 1️⃣ VIDEO LAYER: Handles scaling only */}
      <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden pointer-events-none">
        {shouldLoadIframe ? (
          <iframe
            ref={iframeRef}
            id="party-player-iframe"
            src={playerURL}
            className={`w-full h-full transition-transform duration-500 ease-out pointer-events-auto ${
              isFillMode ? 'scale-[1.4] sm:scale-[1.15]' : 'scale-100'
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

      {/* 2️⃣ GESTURE LAYER: Invisible overlay for taps/double-taps */}
      <div 
        onClick={handleGesture}
        onTouchStart={(e) => {
          // Prevent default only if it's a double tap candidate to allow UI toggling
          const now = Date.now();
          if (now - lastTapRef.current < 300) e.preventDefault();
        }}
        className="absolute inset-0 z-20 cursor-pointer pointer-events-auto"
        title="Tap to controls | Double tap to seek"
      />

      {/* 3️⃣ UI OVERLAY LAYER: Fixed elements anchored to screen */}
      <div className={`absolute inset-0 z-30 pointer-events-none flex flex-col`}>
        
        {/* Cinematic Top Bar */}
        <div className={`pt-safe px-6 py-4 flex items-center justify-between transition-all duration-500 transform pointer-events-auto bg-linear-to-b from-black/90 via-black/40 to-transparent ${showControls || !isFullscreen ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onLeaveParty) onLeaveParty();
              }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all hover:scale-110 active:scale-90 relative z-50"
            >
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(roomCode);
                alert("Room Code Copied!");
              }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-light-200 transition-all hover:scale-105 active:scale-95 border border-white/5 flex items-center gap-2"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
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
              className={`transition-all hover:scale-110 active:scale-95 flex items-center justify-center ${isChatVisible ? 'text-indigo-400' : 'text-white/40 hover:text-white'}`}
              title={isChatVisible ? "Hide Chat" : "Show Chat"}
            >
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>

            <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
              <div className="size-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              <span className="text-white font-black text-sm tracking-tighter">{(partyMembers?.length || 1)}</span>
              <svg className="size-4 text-light-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Middle Spacer */}
        <div className="flex-1" />

        {/* Bottom Controls Area */}
        <div className={`pb-safe px-6 py-6 transition-all duration-500 transform pointer-events-auto flex flex-col gap-4 ${showControls || !isFullscreen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
          
          {/* Cinematic Progress Bar */}
          <div className="w-full flex flex-col gap-2 group/progress">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-mono text-white/40">
                {new Date(viewerCurrentTimeRef.current * 1000).toISOString().substr(11, 8)}
              </span>
              <span className="text-[10px] font-mono text-white/40">
                {roomState?.duration ? new Date(roomState.duration * 1000).toISOString().substr(11, 8) : '--:--:--'}
              </span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden relative cursor-pointer">
              <div 
                className="absolute inset-y-0 left-0 bg-linear-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-300" 
                style={{ width: `${roomState?.duration ? (viewerCurrentTimeRef.current / roomState.duration) * 100 : 0}%` }}
              />
              <div 
                className="absolute top-1/2 -translate-y-1/2 size-2.5 bg-white rounded-full shadow-[0_0_10px_white] opacity-0 group-hover/progress:opacity-100 transition-opacity"
                style={{ left: `${roomState?.duration ? (viewerCurrentTimeRef.current / roomState.duration) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="flex items-end justify-between w-full">
            <div className="flex items-center gap-3">
              {isHost ? (
                <div className="px-3 py-1.5 bg-amber-500/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-400/20 shadow-lg">
                  <span className="size-1.5 bg-white rounded-full shadow-[0_0_5px_white]" />
                  Host
                </div>
              ) : (
                <div className="px-3 py-1.5 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-indigo-400/20 shadow-lg">
                  <span className={`size-1.5 bg-white rounded-full ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
                  {isSyncing ? 'Syncing...' : 'Synced'}
                </div>
              )}

              {isTV && (
                <div className="px-3 py-1.5 bg-white/5 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 shadow-lg text-indigo-300">
                  S{season} : E{uiEpisode}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/5">
                <button 
                  onClick={() => {
                    const nextMuteState = !isMuted;
                    setIsMuted(nextMuteState);
                    // Doc Recommendation: Use specific mute command
                    iframeRef.current?.contentWindow?.postMessage({ 
                      command: "mute", 
                      muted: nextMuteState 
                    }, "*");
                  }}
                  className={`p-1.5 transition-all hover:scale-110 active:scale-90 ${isMuted ? 'text-red-400' : 'text-white/60 hover:text-white'}`}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? (
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>

                <button 
                  onClick={() => {
                    const player = iframeRef.current?.contentWindow;
                    // Try common variations since doc is minimal
                    player?.postMessage({ command: "subtitles" }, "*");
                    player?.postMessage({ command: "captions" }, "*");
                    player?.postMessage({ command: "toggleCaptions" }, "*");
                    player?.postMessage({ command: "toggle-captions" }, "*");
                  }}
                  className="p-1.5 text-white/40 hover:text-white transition-all hover:scale-110 active:scale-95" 
                  title="Toggle Subtitles"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                </button>

                <button 
                  onClick={() => {
                    const player = iframeRef.current?.contentWindow;
                    // Try common variations
                    player?.postMessage({ command: "settings" }, "*");
                    player?.postMessage({ command: "toggleSettings" }, "*");
                    player?.postMessage({ command: "toggle-settings" }, "*");
                    player?.postMessage({ command: "showSettings" }, "*");
                  }}
                  className="p-1.5 text-white/40 hover:text-white transition-all hover:scale-110 active:scale-95" 
                  title="Player Settings"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>

              <button 
                 onClick={toggleFullscreen}
                 className={`px-3 py-1.5 backdrop-blur-sm rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border shadow-lg transition-all hover:scale-105 active:scale-95 ${isFillMode ? 'bg-indigo-600/90 border-indigo-400/20 text-white' : 'bg-white/5 hover:bg-white/10 border-white/10 text-light-200'}`}
                 title={isMobile ? (isFullscreen ? (isFillMode ? "Fit Aspect" : "Fill Screen") : "Enter Fullscreen") : "Toggle Cinematic Fullscreen"}
              >
                <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                {isMobile ? (!isFullscreen ? "Fullscreen" : (isFillMode ? "Fit" : "Fill")) : "Fullscreen"}
              </button>
            </div>
          </div>
        </div>

        {/* Chat Overlay (Anchored within UI Layer) */}
        <div className={`absolute bottom-28 right-6 z-[60] pointer-events-auto pr-safe pb-safe ${isChatVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'} transition-all duration-300`}>
          <ChatOverlay 
            messages={chatMessages} 
            roomCode={roomCode} 
            user={user} 
            isCinematic={isCinematic}
            isVisible={true}
          />
        </div>

      </div>

      {/* 4️⃣ FEEDBACK LAYER: Double-tap or Play/Pause animations */}
      <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center">
        {/* Seek Feedback (Left/Right) */}
        {seekFeedback === 'left' && (
          <div className="absolute left-[15%] flex flex-col items-center gap-2">
            <div className="size-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 animate-seek-pulse">
               <svg className="size-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                 <path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-7 4.666a1 1 0 000 1.664l7 4.666z" />
               </svg>
            </div>
            <span className="text-white font-black text-xl tracking-tighter animate-fade-in">-10s</span>
          </div>
        )}
        {seekFeedback === 'right' && (
          <div className="absolute right-[15%] flex flex-col items-center gap-2">
            <div className="size-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 animate-seek-pulse">
               <svg className="size-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                 <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l7-4.666a1 1 0 000-1.664l-7-4.666A1 1 0 0010 6v2.798L4.555 5.168z" />
               </svg>
            </div>
            <span className="text-white font-black text-xl tracking-tighter animate-fade-in">+10s</span>
          </div>
        )}
        
        {/* Play/Pause Pulse (Center) */}
        {seekFeedback === 'center' && (
           <div className="size-32 bg-indigo-500/20 backdrop-blur-xl rounded-full flex items-center justify-center border border-indigo-500/40 animate-play-pulse">
              {roomState?.playback_status === 'play' ? (
                <svg className="size-16 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="size-16 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
           </div>
        )}
      </div>

    </div>
  );
});

export default PartyPlayer;
