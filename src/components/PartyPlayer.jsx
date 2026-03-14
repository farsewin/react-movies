import React, { useEffect, useRef, useState } from 'react';
import { updateWatchProgress, syncRoomState } from '../services/appwrite';

const vidfastOrigins = [
  "https://vidfast.pro",
  "https://vidfast.in",
  "https://vidfast.io",
  "https://vidfast.me",
  "https://vidfast.net",
  "https://vidfast.pm",
  "https://vidfast.xyz"
];

const PartyPlayer = ({ movie, roomCode, roomDocId, user, roomState, localEpisode, displayedEpisode, onLocalEpisodeChange, onNativeNavigation }) => {
  const iframeRef = useRef(null);
  const isHost = user?.$id === movie?.creator_id && !!movie?.creator_id;
  const lastSyncBroadcastRef = useRef(0);
  const viewerCurrentTimeRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(false);
  const lastSentCommandRef = useRef(null); // Tracks last command sent to iframe to avoid redundancy
  const lastStateRef = useRef(null);      // Tracks last playback_status we reacted to
  
  // Mobile Detection
  const isMobile = useRef(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)).current;

  // Optimization: Delay iframe loading to prioritize UI paint
  useEffect(() => {
    const timer = setTimeout(() => setShouldLoadIframe(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Determine Player URL based on media type
  const isTV = (roomState?.media_type || movie?.media_type) === 'tv';
  const tmdbId = roomState?.movie_id || movie?.movie_id;
  const season = roomState?.season || 1;
  const episode = displayedEpisode || localEpisode || roomState?.episode || 1;

  const playerURL = isTV
    ? `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}?autoPlay=true&nextButton=true&autoNext=false`
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
            if (timeSinceLastBroadcast > 500 || playerEvent === "next") {
              lastSyncBroadcastRef.current = now;
              const newEpisode = playerEvent === "next" ? episode + 1 : episode;

              if (playerEvent === "next") {
                 if (onLocalEpisodeChange) {
                   onLocalEpisodeChange(newEpisode); // Instantly update UI and iframe src
                 }
              } else {
                 syncRoomState(roomDocId || roomCode, playerEvent, currentTime, { episode: newEpisode });
              }
            }
          }

          if (playerEvent === "timeupdate") {
            viewerCurrentTimeRef.current = currentTime;

            if (now - (window.lastProgressUpdate || 0) > 5000) {
              window.lastProgressUpdate = now;
              updateWatchProgress(tmdbId, currentTime, duration, { media_type: isTV ? 'tv' : 'movie', season, episode });
            }
          }
        }
      } else if (event.data.type === "MEDIA_DATA" && isHost && isTV) {
        const mediaData = event.data.data;
        const showKey = `t${tmdbId}`;

        if (mediaData && mediaData[showKey]) {
          const showData = mediaData[showKey];
          const newEpisode = showData.last_episode_watched;

          if (newEpisode && newEpisode > (displayedEpisode || episode)) {
            if (onNativeNavigation) {
              onNativeNavigation(newEpisode); // ONLY updates UI, does not reload iframe
            }
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [tmdbId, isHost, roomCode, isTV, season, episode, displayedEpisode, localEpisode, roomDocId]);

  // --- Host Heartbeat: Keep Room Active with REAL position ---
  useEffect(() => {
    if (!isHost || !roomDocId) return;

    const heartbeatInterval = setInterval(() => {
      // Use the ref because it's updated constantly by the player message listener
      const currentTime = viewerCurrentTimeRef.current || 0;
      syncRoomState(roomDocId, roomState?.playback_status || 'play', currentTime, { episode });
    }, 120000); // 2 minutes

    return () => clearInterval(heartbeatInterval);
  }, [isHost, roomDocId, episode, roomState?.playback_status]);

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
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-light-100/10 shadow-2xl bg-black">
      {shouldLoadIframe ? (
        <iframe
          ref={iframeRef}
          id="party-player-iframe"
          src={playerURL}
          className="absolute inset-0 w-full h-full"
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

      <div className="absolute top-4 left-4 z-20 flex gap-2">
        {isHost ? (
          <div className="px-3 py-1 bg-amber-500/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-400/20 shadow-lg status-badge-pulse">
            <span className="size-1.5 bg-white rounded-full" />
            Host (Master Control)
          </div>
        ) : (
          <div className="px-3 py-1 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-indigo-400/20 shadow-lg status-badge-pulse">
            <span className={`size-1.5 bg-white rounded-full ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
            {isSyncing ? 'Syncing...' : 'Synced with Host'}
          </div>
        )}

        {isTV && (
          <div className="px-3 py-1 bg-dark-100/80 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 shadow-lg text-indigo-300">
            S{season} : E{episode}
          </div>
        )}
      </div>

    </div>
  );
};

export default PartyPlayer;
