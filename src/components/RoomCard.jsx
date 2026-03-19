import React, { useEffect, useState } from 'react';
import Spinner from './Spinner.jsx';
import { useNavigate } from 'react-router-dom';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = import.meta.env.VITE_TMDB_API_KEY;

const RoomCard = ({ room }) => {
  const navigate = useNavigate();
  const { room_code, movie_title, poster_url, creator_name, media_type, movie_id } = room;
  const [fetchedPoster, setFetchedPoster] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);

  useEffect(() => {
    // If we already have a poster URL, no need to fetch
    if (poster_url) {
      setPosterLoading(false);
      return;
    }

    // Fetch poster from TMDB if missing
    const fetchPoster = async () => {
      setPosterLoading(true);
      try {
        const type = media_type || 'movie';
        const response = await fetch(`${API_BASE_URL}/${type}/${movie_id}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${API_KEY}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.poster_path) {
            setFetchedPoster(`https://image.tmdb.org/t/p/w500${data.poster_path}`);
          }
        }
      } catch (error) {
        console.error("Error fetching poster for room card:", error);
      } finally {
        setPosterLoading(false);
      }
    };

    if (movie_id) fetchPoster();
  }, [poster_url, movie_id, media_type]);

  const handleJoin = async () => {
    const isMobile = window.innerWidth < 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (!isMobile) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.warn("Fullscreen request failed:", err);
      }
    }
    navigate(`/party/${room_code}`);
  };

  const currentPoster = poster_url || fetchedPoster;

  return (
    <div className="bg-dark-100/40 backdrop-blur-md rounded-3xl overflow-hidden border border-white/5 hover:border-indigo-500/30 transition-all group flex flex-col h-full shadow-2xl">
      {/* Poster Section */}
      <div className="relative aspect-[2/3] overflow-hidden bg-dark-100 flex items-center justify-center">
        {currentPoster && !imageError ? (
          <>
            <img 
              src={currentPoster} 
              alt={movie_title}
              onLoad={() => setPosterLoading(false)}
              onError={() => { setImageError(true); setPosterLoading(false); }}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            />

            {posterLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                <Spinner />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="size-16 text-white/10 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-white/40 font-black text-sm uppercase tracking-widest leading-loose">
              Poster<br/>Not Available
            </p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-dark-100 via-transparent to-transparent opacity-60" />
        
        {/* Badge for Media Type */}
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="bg-indigo-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider">
            {media_type === 'tv' ? 'TV Show' : 'Movie'}
          </span>
        </div>

        {/* Member Count Overlay (Placeholder for now) */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10">
           <svg className="size-3 text-light-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
           </svg>
           <span className="text-[10px] font-bold text-white">1</span>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-5 flex flex-col flex-1 justify-between gap-4">
        <div>
          <h3 className="text-white font-black text-lg leading-tight mb-1 line-clamp-1 group-hover:text-indigo-400 transition-colors uppercase tracking-tight">
            {room.room_title || movie_title}
          </h3>
          <p className="text-light-200 text-xs font-medium flex items-center gap-2">
            <span className="w-1 h-3 bg-red-500 rounded-full" />
            {movie_title}
          </p>
          
          <div className="mt-4 flex items-center gap-2">
            <div className="size-6 rounded-full bg-indigo-600/30 flex items-center justify-center text-[10px] font-bold text-indigo-400 border border-indigo-500/20">
              {creator_name?.charAt(0) || 'U'}
            </div>
            <p className="text-gray-400 text-[10px] font-semibold">
              By <span className="text-light-100">{creator_name}</span>
            </p>
          </div>
        </div>

        <button 
          onClick={handleJoin}
          className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 active:scale-[0.98]"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
          JOIN ROOM
        </button>
      </div>
    </div>
  );
};

export default RoomCard;
