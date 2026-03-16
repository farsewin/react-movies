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
        containerRef.current.requestFullscreen().catch(err => {
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
      if (!document.fullscreenElement) {
        setIsFillMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleActivity);
        container.removeEventListener('touchstart', handleActivity);
      }
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
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
      if (!vidfastOrigins.includes(event.origin) || !event.data) return;

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
                 syncRoomState(roomDocId || roomCode, status, currentTime, { episode: newEpisode });
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
      } else if (event.data.type === "MEDIA_DATA" && isHost && isTV) {
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
        player.postMessage({ command: "play" }, "*");
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
      player.postMessage({ command: "seek", time: expectedTime }, "*");
      setTimeout(() => setIsSyncing(false), cooldown);
    }

  }, [roomState, isHost]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-black group/player transition-all duration-300 ${isCinematic ? 'w-full h-full' : 'aspect-video rounded-2xl border border-light-100/10 shadow-2xl'}`}>
      {/* Cinematic Top Bar */}
      <div className={`absolute top-0 inset-x-0 z-50 bg-linear-to-b from-black/90 via-black/40 to-transparent p-6 flex items-center justify-between transition-all duration-500 transform ${showControls || (!document.fullscreenElement && !isCinematic) ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-4">
          <button 
            onClick={onLeaveParty}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all hover:scale-110 active:scale-90"
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

      {shouldLoadIframe ? (
        <iframe
          ref={iframeRef}
          id="party-player-iframe"
          src={playerURL}
          className={`absolute inset-0 w-full h-full transition-transform duration-500 ease-in-out ${isFillMode ? 'scale-[1.05]' : 'scale-100'}`}
          allowFullScreen
          allow="autoplay; encrypted-media"
          title="Media Player"
          frameBorder="0"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      )}

      <div className={`absolute ${isMobile ? 'bottom-10' : 'bottom-4'} left-4 z-20 flex gap-2 transition-all duration-500 transform ${showControls || (!document.fullscreenElement && !isCinematic) ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
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

        {isTV && (
          <div className="px-3 py-1 bg-dark-100/80 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 shadow-lg text-indigo-300">
            S{season} : E{uiEpisode}
          </div>
        )}

        <button 
           onClick={toggleFullscreen}
           className={`px-3 py-1 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border shadow-lg transition-all hover:scale-105 active:scale-95 ${isFillMode ? 'bg-indigo-600/90 border-indigo-400/20 text-white' : 'bg-white/5 hover:bg-white/10 border-white/10 text-light-200'}`}
           title={isMobile ? (document.fullscreenElement ? (isFillMode ? "Fit Aspect" : "Fill Screen") : "Enter Fullscreen") : "Toggle Cinematic Fullscreen"}
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isMobile ? (
              !document.fullscreenElement ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              ) : isFillMode ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5" />
              )
            ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            )}
          </svg>
          {isMobile ? (!document.fullscreenElement ? "Fullscreen" : (isFillMode ? "Fit" : "Fill")) : "Fullscreen"}
        </button>
      </div>

      <ChatOverlay 
        messages={chatMessages} 
        roomCode={roomCode} 
        user={user} 
        isCinematic={isCinematic}
        isVisible={isChatVisible}
      />

    </div>
  );
});

export default PartyPlayer;
