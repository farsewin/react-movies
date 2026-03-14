import { useEffect, useState } from 'react'
import Search from '../components/Search.jsx'
import Spinner from '../components/Spinner.jsx'
import MovieCard from '../components/MovieCard.jsx'
import { MovieCardSkeleton, TrendingSkeleton } from '../components/Skeleton.jsx'
import AuthModal from '../components/AuthModal.jsx'
import { useDebounce } from 'react-use'
import { getTrendingMovies, updateSearchCount, logout } from '../services/appwrite.js'
import { useUser } from '../context/UserContext.jsx'

const API_BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = import.meta.env.VITE_TMDB_API_KEY;

const API_OPTIONS = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    Authorization: `Bearer ${API_KEY}`
  }
}

const Home = () => {
  const { user, refreshUser } = useUser();
  const [mediaType, setMediaType] = useState('movie'); // 'movie' or 'tv'
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [searchTerm, setSearchTerm] = useState('');
  const [mediaList, setMediaList] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [trendingMovies, setTrendingMovies] = useState([]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useDebounce(() => setDebouncedSearchTerm(searchTerm), 500, [searchTerm])

  const fetchMedia = async (query = '') => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const endpoint = query
        ? `${API_BASE_URL}/search/${mediaType}?query=${encodeURIComponent(query)}`
        : `${API_BASE_URL}/discover/${mediaType}?sort_by=popularity.desc`;

      const response = await fetch(endpoint, API_OPTIONS);
      if(!response.ok) throw new Error(`Failed to fetch ${mediaType === 'movie' ? 'movies' : 'TV shows'}`);
      const data = await response.json();
      setMediaList(data.results || []);
      if(query && data.results.length > 0) {
        await updateSearchCount(query, data.results[0]);
      }
    } catch (error) {
      console.error(`Error fetching media: ${error}`);
      setErrorMessage(`Error fetching ${mediaType === 'movie' ? 'movies' : 'TV shows'}. Please try again later.`);
    } finally {
      setIsLoading(false);
    }
  }

  const loadTrendingMovies = async () => {
    try {
      const movies = await getTrendingMovies();
      setTrendingMovies(movies);
    } catch (error) {
      console.error(`Error fetching trending movies: ${error}`);
    }
  }

  const handleAuthSuccess = () => {
    refreshUser();
  };
 
  const handleLogout = async () => {
    await logout();
    refreshUser();
  };

  useEffect(() => {
    fetchMedia(debouncedSearchTerm);
  }, [debouncedSearchTerm, mediaType]);

  useEffect(() => {
    loadTrendingMovies();
  }, []);

  return (
    <main>
      <div className="pattern"/>
      
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        onAuthSuccess={handleAuthSuccess}
      />

      <div className="wrapper">
        <nav className="flex justify-between items-center mb-10 relative z-50">
           <p className="text-white font-bold text-xl">MovieApp</p>
           {user ? (
             <div className="flex items-center gap-4">
               <span className="text-white">Hi, {user.name}</span>
               <button onClick={handleLogout} className="text-light-200 hover:text-white transition-colors">Logout</button>
             </div>
           ) : (
             <button onClick={() => setIsAuthModalOpen(true)} className="bg-indigo-600 text-white px-6 py-2 rounded-full font-bold hover:bg-indigo-700 transition-all">
                Login / Sign Up
             </button>
           )}
        </nav>

        <header>
          <img src="/hero.png" alt="Hero Banner" />
          <h1>Find <span className="text-gradient">{mediaType === 'movie' ? 'Movies' : 'TV Shows'}</span> You'll Enjoy Without the Hassle</h1>
          
          <div className="flex justify-center gap-4 mb-8 relative z-50">
            <button 
              onClick={() => setMediaType('movie')}
              className={`px-8 py-3 rounded-full font-bold transition-all ${mediaType === 'movie' ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'bg-dark-100/50 text-light-200 hover:text-white'}`}
            >
              Movies
            </button>
            <button 
              onClick={() => setMediaType('tv')}
              className={`px-8 py-3 rounded-full font-bold transition-all ${mediaType === 'tv' ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'bg-dark-100/50 text-light-200 hover:text-white'}`}
            >
              TV Shows
            </button>
          </div>

          <Search searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        </header>

        {trendingMovies && trendingMovies.length > 0 ? (
          <section className="trending">
            <h2>Trending Movies</h2>
            <ul>
              {trendingMovies.map((movie, index) => (
                <li key={movie.$id}>
                  <p>{index + 1}</p>
                  <img src={movie.poster_url} alt={movie.title} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <TrendingSkeleton />
        )}

        <section className="all-movies">
          <h2>{mediaType === 'movie' ? 'All Movies' : 'All TV Shows'}</h2>
          {isLoading ? (
            <ul>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <MovieCardSkeleton key={i} />
              ))}
            </ul>
          ) : errorMessage ? (
            <p className="text-red-500">{errorMessage}</p>
          ) : (
            <ul>
              {mediaList.map((item) => (
                <MovieCard key={item.id} movie={{ ...item, media_type: mediaType }} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

export default Home
