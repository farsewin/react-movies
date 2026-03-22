import React, { useState } from 'react'
import { useCreateParty } from '../hooks/useCreateParty'
import WatchWithFriendsButton from './WatchWithFriendsButton.jsx'
import Spinner from './Spinner.jsx'

const MovieCard = React.memo(({ movie, onDetailsClick }) => {
  const { handleCreateParty, isCreating } = useCreateParty();
  const [imgLoading, setImgLoading] = useState(!!movie.poster_path);
  const [imgError, setImgError] = useState(false);
  // TV Shows use 'name' and 'first_air_date', Movies use 'title' and 'release_date'
  const title = movie.title || movie.name;
  const date = movie.release_date || movie.first_air_date;
  const { vote_average, poster_path, original_language, media_type } = movie;

  const onCardClick = (e) => {
    e.preventDefault();
    if (onDetailsClick) {
      onDetailsClick(movie);
    } else {
      handleCreateParty(movie);
    }
  };

  return (
    <div className="movie-card relative group hover-lift">
      {media_type && (
        <span className="absolute top-4 right-4 z-10 bg-indigo-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider shadow-lg transform transition-transform group-hover:scale-105">
          {media_type === 'movie' ? 'Movie' : 'TV Show'}
        </span>
      )}
      
      <div onClick={onCardClick} className="cursor-pointer relative overflow-hidden rounded-2xl">
        <img
          src={movie.poster_path ? `https://image.tmdb.org/t/p/w342/${movie.poster_path}` : '/no-movie.png'}
          alt={title}
          className="w-full aspect-[2/3] object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
          onLoad={() => setImgLoading(false)}
          onError={() => { setImgError(true); setImgLoading(false); }}
        />

        {/* Spinner while image is loading */}
        {imgLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
            <Spinner />
          </div>
        )}

        {/* Spinner overlay when creating a party from this card */}
        {isCreating && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
            <Spinner />
          </div>
        )}

        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
           <div className="bg-indigo-600 p-4 rounded-full scale-75 group-hover:scale-100 transition-transform duration-300">
              <svg className="size-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
           </div>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="cursor-pointer hover:text-indigo-400 transition-colors" onClick={onCardClick}>{title}</h3>

        <div className="content">
          <div className="rating">
            <img src="star.svg" alt="Star Icon" />
            <p>{vote_average ? vote_average.toFixed(1) : 'N/A'}</p>
          </div>

          <span>•</span>
          <p className="lang">{original_language}</p>

          <span>•</span>
          <p className="year">
            {date ? date.split('-')[0] : 'N/A'}
          </p>
        </div>

        <WatchWithFriendsButton movie={{ ...movie, title }} />
      </div>
    </div>
  )
});

export default MovieCard;
