import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { fetchMediaDetails } from "../services/tmdb";
import Spinner from "./Spinner";
import { useCreateParty } from "../hooks/useCreateParty";

const MovieDetailsModal = ({ isOpen, onClose, mediaId, mediaType }) => {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const { handleCreateParty, isCreating } = useCreateParty();

  useEffect(() => {
    if (isOpen && mediaId) {
      setLoading(true);
      fetchMediaDetails(mediaId, mediaType)
        .then((data) => {
          setDetails(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen, mediaId, mediaType]);

  if (!isOpen) return null;

  const handleStartParty = () => {
    if (details) {
      handleCreateParty({
        ...details,
        id: details.id,
        media_type: mediaType,
        title: details.title || details.name,
        poster_path: details.poster_path,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-dark-100/60 backdrop-blur-2xl border border-white/10 rounded-[32px] shadow-3xl flex flex-col md:flex-row p-8 md:p-10 gap-10 animate-in fade-in slide-in-from-bottom-8 duration-500 custom-scrollbar">
        {/* Custom CSS for hiding scrollbar and styling the main one */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 6px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `,
          }}
        />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-50 size-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all text-white"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {loading ? (
          <div className="w-full h-96 flex flex-col items-center justify-center gap-4">
            <Spinner />
            <p className="text-light-200 font-bold animate-pulse text-sm">
              Fetching detailed intel...
            </p>
          </div>
        ) : details ? (
          <>
            {/* Left: Poster */}
            <div className="w-full md:w-1/3 shrink-0">
              <div className="relative aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                <img
                  src={
                    details.poster_path
                      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
                      : "/no-movie.png"
                  }
                  alt={details.title || details.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Right: Info */}
            <div className="flex-1 flex flex-col min-w-0">
              <h2 className="text-3xl md:text-4xl font-black text-white mb-2 leading-tight line-clamp-2">
                {details.title || details.name}
              </h2>

              <div className="flex flex-wrap items-center gap-4 mb-6 text-sm font-bold text-light-200">
                <div className="flex items-center gap-1.5 bg-indigo-600/20 px-3 py-1 rounded-full text-indigo-400 border border-indigo-500/20">
                  <svg
                    className="size-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {details.vote_average?.toFixed(1) || "N/A"}
                </div>
                <span>•</span>
                <span>
                  {
                    (details.release_date || details.first_air_date)?.split(
                      "-",
                    )[0]
                  }
                </span>
                {details.runtime && (
                  <>
                    <span>•</span>
                    <span>
                      {Math.floor(details.runtime / 60)}h {details.runtime % 60}
                      m
                    </span>
                  </>
                )}
                <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5 uppercase text-[10px] tracking-widest leading-none flex items-center">
                  {mediaType}
                </span>
              </div>

              <div className="mb-6">
                <h3 className="text-white font-bold mb-2 uppercase text-xs tracking-widest opacity-50">
                  Overview
                </h3>
                <p className="text-light-200 leading-relaxed text-sm md:text-base font-medium line-clamp-4 md:line-clamp-5">
                  {details.overview || "No overview available."}
                </p>
              </div>

              {details.genres && details.genres.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-white font-bold mb-2 uppercase text-xs tracking-widest opacity-50">
                    Genres
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {details.genres.map((g) => (
                      <span
                        key={g.id}
                        className="bg-white/5 hover:bg-white/10 border border-white/5 px-3 py-1 rounded-lg text-xs font-bold text-light-100 transition-colors"
                      >
                        {g.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {details.credits?.cast && details.credits.cast.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-white font-bold mb-3 uppercase text-xs tracking-widest opacity-50">
                    Top Cast
                  </h3>
                  <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
                    {details.credits.cast.slice(0, 5).map((person) => (
                      <div
                        key={person.id}
                        className="shrink-0 flex items-center gap-3 bg-white/5 p-2 rounded-xl border border-white/5"
                      >
                        <div className="size-10 rounded-lg overflow-hidden bg-dark-200">
                          <img
                            src={
                              person.profile_path
                                ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
                                : "/no-avatar.png"
                            }
                            alt={person.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-white text-xs font-bold truncate max-w-[100px]">
                            {person.name}
                          </span>
                          <span className="text-light-200 text-[10px] opacity-70 truncate max-w-[100px]">
                            {person.character}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto pt-6 border-t border-white/5 flex gap-4">
                <button
                  onClick={handleStartParty}
                  disabled={isCreating}
                  className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white py-4.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-3 shadow-xl shadow-red-600/30 active:scale-95 group"
                >
                  {isCreating ? (
                    <Spinner />
                  ) : (
                    <>
                      <svg
                        className="size-5 transition-transform group-hover:scale-110"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Start Watch Party
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full py-20 text-center">
            <p className="text-red-400 font-bold">
              Failed to load content details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

MovieDetailsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  mediaId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  mediaType: PropTypes.string,
};

export default MovieDetailsModal;
