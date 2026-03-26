import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Search from "../components/Search.jsx";
import MovieCard from "../components/MovieCard.jsx";
import {
  MovieCardSkeleton,
  TrendingSkeleton,
} from "../components/Skeleton.jsx";
import AuthModal from "../components/AuthModal.jsx";
import { useDebounce } from "react-use";
import { updateSearchCount, logout } from "../services/appwrite.js";
import { useUser } from "../context/UserContext.jsx";
import {
  fetchPopularMedia,
  searchMedia,
  fetchTrendingMedia,
} from "../services/tmdb";
import MovieDetailsModal from "../components/MovieDetailsModal";

const Home = () => {
  const { user, refreshUser } = useUser();
  const [mediaType, setMediaType] = useState("movie"); // 'movie' or 'tv'
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [mediaList, setMediaList] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [trendingMovies, setTrendingMovies] = useState([]);
  const [trendingTimeWindow, setTrendingTimeWindow] = useState("day"); // 'day' or 'week'
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  useDebounce(() => setDebouncedSearchTerm(searchTerm), 500, [searchTerm]);

  const fetchMedia = async (query = "") => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const results = query
        ? await searchMedia(query, mediaType)
        : await fetchPopularMedia(mediaType);

      setMediaList(results);

      if (query && results.length > 0) {
        await updateSearchCount(query, results[0]);
      }
    } catch (error) {
      console.error(`Error fetching media: ${error}`);
      setErrorMessage(
        `Error fetching ${mediaType === "movie" ? "movies" : "TV shows"}. Please try again later.`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadTrendingMovies = async () => {
    try {
      const results = await fetchTrendingMedia(mediaType, trendingTimeWindow);
      setTrendingMovies(results.slice(0, 10));
    } catch (error) {
      console.error(`Error fetching trending content: ${error}`);
    }
  };

  const handleAuthSuccess = () => {
    refreshUser();
  };

  const handleShowDetails = (media) => {
    setSelectedMedia(media);
    setIsDetailsModalOpen(true);
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
  }, [trendingTimeWindow, mediaType]);

  return (
    <main>
      <div className="pattern" />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      <MovieDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        mediaId={selectedMedia?.id}
        mediaType={mediaType}
      />

      <div className="wrapper">
        <nav className="flex justify-between items-center mb-10 relative z-50">
          <p className="text-white font-bold text-xl">MovieApp</p>
          <div className="flex items-center gap-6">
            <Link
              to="/parties"
              className="text-light-200 hover:text-white font-bold transition-all flex items-center gap-2 hover:scale-105 active:scale-95"
            >
              <svg
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              Watch Parties
            </Link>
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-white">Hi, {user.name}</span>
                <button
                  onClick={handleLogout}
                  className="text-light-200 hover:text-white transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="bg-indigo-600 text-white px-6 py-2 rounded-full font-bold hover:bg-indigo-700 transition-all"
              >
                Login / Sign Up
              </button>
            )}
          </div>
        </nav>

        <header>
          <h1>
            Find{" "}
            <span className="text-gradient">
              {mediaType === "movie" ? "Movies" : "TV Shows"}
            </span>{" "}
            You&apos;ll Enjoy Without the Hassle
          </h1>

          <div className="flex justify-center gap-4 mb-8 relative z-50">
            <button
              onClick={() => setMediaType("movie")}
              className={`px-8 py-3 rounded-full font-bold transition-all ${mediaType === "movie" ? "bg-indigo-600 text-white shadow-xl scale-105" : "bg-dark-100/50 text-light-200 hover:text-white"}`}
            >
              Movies
            </button>
            <button
              onClick={() => setMediaType("tv")}
              className={`px-8 py-3 rounded-full font-bold transition-all ${mediaType === "tv" ? "bg-indigo-600 text-white shadow-xl scale-105" : "bg-dark-100/50 text-light-200 hover:text-white"}`}
            >
              TV Shows
            </button>
          </div>

          <Search searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        </header>

        {trendingMovies && trendingMovies.length > 0 ? (
          <section className="trending">
            <div className="flex items-center justify-between mb-6">
              <div className="flex flex-col">
                <h2>
                  Trending {mediaType === "movie" ? "Movies" : "TV Shows"}
                </h2>
              </div>
              <div className="flex bg-dark-100/40 p-1 rounded-lg backdrop-blur-sm border border-white/5">
                <button
                  onClick={() => setTrendingTimeWindow("day")}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${trendingTimeWindow === "day" ? "bg-indigo-600 text-white shadow-lg" : "text-light-200 hover:text-white"}`}
                >
                  Today
                </button>
                <button
                  onClick={() => setTrendingTimeWindow("week")}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${trendingTimeWindow === "week" ? "bg-indigo-600 text-white shadow-lg" : "text-light-200 hover:text-white"}`}
                >
                  This Week
                </button>
              </div>
            </div>
            <ul>
              {trendingMovies.map((movie, index) => (
                <li
                  key={movie.id}
                  onClick={() => handleShowDetails(movie)}
                  className="cursor-pointer group relative overflow-hidden rounded-xl"
                >
                  <p>{index + 1}</p>
                  <img
                    src={
                      movie.poster_path
                        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                        : "/no-poster.png"
                    }
                    alt={movie.title || movie.name}
                    className="transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="bg-indigo-600 p-3 rounded-full scale-50 group-hover:scale-100 transition-transform duration-300">
                      <svg
                        className="size-5 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <TrendingSkeleton />
        )}

        <section className="all-movies">
          <div className="flex flex-col mb-6">
            <h2> Popular {mediaType === "movie" ? "Movies" : "TV Shows"}</h2>
          </div>
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
                <MovieCard
                  key={item.id}
                  movie={{ ...item, media_type: mediaType }}
                  onDetailsClick={handleShowDetails}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
};

export default Home;
