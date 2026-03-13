import React, { useEffect, useRef } from 'react';
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
  const lastUpdateRef = useRef(0);

  // --- Host Logic: Broadcast changes ---
  useEffect(() => {
    if (!movie || !isHost) return;

    const handleMessage = (event) => {
      if (!vidfastOrigins.includes(event.origin) || !event.data) return;

      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;
        
        // Only sync if significant change happened to avoid loop
        const now = Date.now();
        if (now - lastUpdateRef.current < 1000) return;

        if (playerEvent === "play" || playerEvent === "pause" || playerEvent === "seeked") {
          lastUpdateRef.current = now;
          syncRoomState(roomCode, playerEvent === "play" ? "play" : "pause", currentTime);
        }

        if (playerEvent === "timeupdate") {
          updateWatchProgress(movie.movie_id, currentTime, duration);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [movie, isHost, roomCode]);

  // --- Viewer Logic: Sync with Host ---
  useEffect(() => {
    if (isHost || !roomState || !iframeRef.current) return;

    const player = iframeRef.current.contentWindow;
    const { playback_status, last_sync_time, last_sync_at } = roomState;

    // Command the player
    if (playback_status === "play") {
      player.postMessage({ command: "play" }, "*");
    } else {
      player.postMessage({ command: "pause" }, "*");
    }

    // Handle Drift
    const timeSinceSync = (new Date().getTime() - new Date(last_sync_at).getTime()) / 1000;
    const expectedTime = playback_status === "play" ? last_sync_time + timeSinceSync : last_sync_time;

    // If drift is > 2 seconds, seek
    // Note: We'd ideally need 'getStatus' to know current viewer time, 
    // but for now we enforce the sync on every roomState update.
    player.postMessage({ command: "seek", time: expectedTime }, "*");

  }, [roomState, isHost]);

  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-light-100/10 shadow-2xl bg-black">
      <iframe
        ref={iframeRef}
        src={`https://vidfast.pro/movie/${movie?.movie_id}?autoPlay=true`}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
        allow="encrypted-media"
        title="Movie Player"
        frameBorder="0"
      />
      {!isHost && (
        <div className="absolute top-4 left-4 z-20 px-3 py-1 bg-indigo-600/90 backdrop-blur-sm rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="size-2 bg-white rounded-full animate-pulse" />
          Synced with Host
        </div>
      )}
    </div>
  );
};

export default PartyPlayer;
