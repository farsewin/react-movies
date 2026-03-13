import React, { useEffect } from 'react';
import { updateWatchProgress } from '../services/appwrite';

const PartyPlayer = ({ movie, roomCode }) => {
  useEffect(() => {
    if (!movie) return;

    const handleMessage = (event) => {
      if (event.origin !== "https://www.vidsrc.wtf") return;

      if (event.data?.type === "MEDIA_DATA") {
        const mediaData = event.data.data;
        // Save to LocalStorage for immediate use
        localStorage.setItem("vidsrc-progress", JSON.stringify(mediaData));
        // Sync to Appwrite for persistence
        updateWatchProgress(movie.movie_id, mediaData.watched_time, mediaData.duration);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [movie]);

  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-light-100/10 shadow-2xl bg-black">
      <iframe
        src={`https://vidsrc.wtf/api/3/movie/?id=${movie?.movie_id}`}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
        title="Movie Player"
      />
    </div>
  );
};

export default PartyPlayer;
