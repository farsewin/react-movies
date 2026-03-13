import React, { useEffect } from 'react';
import { updateWatchProgress } from '../services/appwrite';

const vidfastOrigins = [
  "https://vidfast.pro",
  "https://vidfast.in",
  "https://vidfast.io",
  "https://vidfast.me",
  "https://vidfast.net",
  "https://vidfast.pm",
  "https://vidfast.xyz"
];

const PartyPlayer = ({ movie, roomCode }) => {
  useEffect(() => {
    if (!movie) return;

    const handleMessage = (event) => {
      if (!vidfastOrigins.includes(event.origin) || !event.data) return;

      // Handle VidFast PLAYER_EVENT
      if (event.data.type === "PLAYER_EVENT") {
        const { event: playerEvent, currentTime, duration } = event.data.data;
        if (playerEvent === "timeupdate") {
          updateWatchProgress(movie.movie_id, currentTime, duration);
        }
      }

      // Handle VidFast MEDIA_DATA (Detailed progress)
      if (event.data.type === "MEDIA_DATA") {
        const mediaData = event.data.data;
        const movieKey = `m${movie.movie_id}`;
        
        if (mediaData[movieKey]) {
          const { watched, duration } = mediaData[movieKey].progress;
          localStorage.setItem("vidfast-progress", JSON.stringify(mediaData[movieKey]));
          updateWatchProgress(movie.movie_id, watched, duration);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [movie]);

  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-light-100/10 shadow-2xl bg-black">
      <iframe
        src={`https://vidfast.pro/movie/${movie?.movie_id}`}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
        allow="encrypted-media"
        title="Movie Player"
        frameBorder="0"
      />
    </div>
  );
};

export default PartyPlayer;
