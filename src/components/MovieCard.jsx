import React from 'react'
import WatchWithFriendsButton from './WatchWithFriendsButton.jsx'

const MovieCard = React.memo(({ movie }) => {
  // TV Shows use 'name' and 'first_air_date', Movies use 'title' and 'release_date'
  const title = movie.title || movie.name;
  const date = movie.release_date || movie.first_air_date;
  const { vote_average, poster_path, original_language, media_type } = movie;

  return (
    <div className="movie-card relative group hover-lift">
      {media_type && (
        <span className="absolute top-4 right-4 z-10 bg-indigo-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider shadow-lg transform transition-transform group-hover:scale-105">
          {media_type === 'movie' ? 'Movie' : 'TV Show'}
        </span>
      )}
      
      <img
        src={movie.poster_path ? `https://image.tmdb.org/t/p/w342/${movie.poster_path}` : '/no-movie.png'}
        alt={movie.title}
        className="w-full aspect-[2/3] rounded-2xl object-cover"
        loading="lazy"
      />

      <div className="mt-4">
        <h3>{title}</h3>

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
