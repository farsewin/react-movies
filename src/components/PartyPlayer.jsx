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

const PartyPlayer = ({ movie, roomCode, user, roomState }) => {
  const iframeRef = useRef(null);
  const isHost = user?.$id === movie?.creator_id;
  const lastSyncBroadcastRef = useRef(0);
  const viewerCurrentTimeRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // --- Common Logic: Listen for Player Events ---
  useEffect(() => {
    if (!movie) return;

    const handleMessage = (event) => {
      if (!vidfastOrigins.includes(event.origin) || !event.data) return;

      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;
        
        // Update local reference of current time (for both host and viewer)
        viewerCurrentTimeRef.current = currentTime;

        // HOST ONLY: Broadcast changes to the room
        if (isHost) {
          const now = Date.now();
          const timeSinceLastBroadcast = now - lastSyncBroadcastRef.current;

          if (playerEvent === "play" || playerEvent === "pause" || playerEvent === "seeked") {
            // Throttling broadcasts to avoid database spam
            if (timeSinceLastBroadcast > 500) {
              lastSyncBroadcastRef.current = now;
              syncRoomState(roomCode, playerEvent === "play" ? "play" : "pause", currentTime);
            }
          }

          if (playerEvent === "timeupdate") {
            updateWatchProgress(movie.movie_id, currentTime, duration);
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [movie, isHost, roomCode]);

  // --- Viewer Logic: Sync with Host State ---
  useEffect(() => {
    if (isHost || !roomState || !iframeRef.current) return;

    const player = iframeRef.current.contentWindow;
    const { playback_status, last_sync_time, last_sync_at } = roomState;

    // 1. Handle Play/Pause Sync
    if (playback_status === "play") {
      player.postMessage({ command: "play" }, "*");
    } else {
      player.postMessage({ command: "pause" }, "*");
    }

    // 2. Handle Drift Alignment
    const timeSinceSync = (new Date().getTime() - new Date(last_sync_at).getTime()) / 1000;
    const expectedTime = playback_status === "play" ? last_sync_time + timeSinceSync : last_sync_time;
    
    // Calculate difference between local time and host's expected time
    const drift = Math.abs(viewerCurrentTimeRef.current - expectedTime);

    // Only seek if drift exceeds threshold (2 seconds)
    if (drift > 2) {
      setIsSyncing(true);
      player.postMessage({ command: "seek", time: expectedTime }, "*");
      
      // Clear syncing status after a short delay
      setTimeout(() => setIsSyncing(false), 1000);
    }

  }, [roomState, isHost]);

  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-light-100/10 shadow-2xl bg-black">
      <iframe
        ref={iframeRef}
        src={`https://vidfast.pro/movie/${movie?.movie_id}?autoPlay=true&theme=6366f1&sub=ara`}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
        allow="encrypted-media"
        title="Movie Player"
        frameBorder="0"
      />
      
      {/* Floating Status Badges */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        {isHost ? (
          <div className="px-3 py-1 bg-amber-500/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-400/20 shadow-lg">
            <span className="size-1.5 bg-white rounded-full" />
            Host (Master Control)
          </div>
        ) : (
          <div className="px-3 py-1 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-indigo-400/20 shadow-lg">
            <span className={`size-1.5 bg-white rounded-full ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
            {isSyncing ? 'Syncing...' : 'Synced with Host'}
          </div>
        )}
      </div>
    </div>
  );
};

export default PartyPlayer;
