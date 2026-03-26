import { useCreateParty } from "../hooks/useCreateParty";
import PropTypes from "prop-types";

const WatchWithFriendsButton = ({ movie }) => {
  const { handleCreateParty, isCreating } = useCreateParty();

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCreateParty(movie);
      }}
      disabled={isCreating}
      className="mt-4 w-full bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white border border-indigo-600/50 py-2 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
    >
      {isCreating ? (
        <span className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          Watch with Friends
        </>
      )}
    </button>
  );
};

WatchWithFriendsButton.propTypes = {
  movie: PropTypes.object.isRequired,
};

export default WatchWithFriendsButton;
