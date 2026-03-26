import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { sendChatMessage } from "../services/appwrite";

const ChatOverlay = ({ messages, roomCode, user, isVisible = true }) => {
  const [newMessage, setNewMessage] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!isVisible) return null;

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    try {
      const text = newMessage;
      setNewMessage("");
      await sendChatMessage(roomCode, user, text);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const addEmoji = (emoji) => {
    setNewMessage((prev) => prev + emoji);
    setShowEmoji(false);
  };

  const emojis = ["😊", "😂", "🔥", "❤", "😮", "😢", "👏", "🎬"];

  return (
    <div className="flex flex-col items-end w-full h-full max-w-[320px]">
      {/* Messages Area */}
      <div className="w-full overflow-hidden transition-all duration-300 opacity-100 mb-4">
        <div
          ref={scrollRef}
          className="max-h-[350px] overflow-y-auto space-y-4 p-2 hide-scrollbar mask-fade-top flex flex-col pt-10"
        >
          {messages.map((msg, idx) => (
            <div
              key={msg.$id || idx}
              className={`flex flex-col ${msg.user_id === user?.$id ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span
                  className={`text-[9px] font-black uppercase tracking-[0.2em] ${msg.user_id === user?.$id ? "text-indigo-400" : "text-amber-400"}`}
                >
                  {msg.username}
                </span>
              </div>
              <div
                className={`px-4 py-2 text-xs font-medium backdrop-blur-2xl border-b-2 transition-all duration-300 rounded-lg ${
                  msg.user_id === user?.$id
                    ? "bg-indigo-500/10 border-indigo-500/60 text-white text-right"
                    : "bg-white/5 border-white/20 text-light-100"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-1 w-full">
        <div className="w-full bg-black/20 backdrop-blur-2xl border-b border-white/10 px-4 py-3 rounded-xl transition-all duration-300 flex items-center gap-3 opacity-100 group focus-within:border-indigo-500/50">
          <button
            onClick={() => setShowEmoji(!showEmoji)}
            className="text-light-200/50 hover:text-white transition-colors"
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
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
          <form onSubmit={handleSendMessage} className="flex-1">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="bg-transparent text-white text-xs w-full focus:outline-none placeholder:text-white/20"
            />
          </form>
          <button
            onClick={handleSendMessage}
            className={`transition-all ${newMessage.trim() ? "text-indigo-400" : "text-white/5 pointer-events-none"}`}
          >
            <svg
              className="size-4 rotate-90"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Emoji Picker */}
      {showEmoji && (
        <div className="absolute bottom-20 right-0 bg-black/40 backdrop-blur-2xl p-3 rounded-2xl border border-white/10 flex gap-2 shadow-2xl animate-fade-in z-50">
          {emojis.map((e) => (
            <button
              key={e}
              onClick={() => addEmoji(e)}
              className="hover:scale-125 transition-transform text-lg"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

ChatOverlay.propTypes = {
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      $id: PropTypes.string,
      user_id: PropTypes.string,
      username: PropTypes.string,
      text: PropTypes.string,
    }),
  ).isRequired,
  roomCode: PropTypes.string.isRequired,
  user: PropTypes.shape({
    $id: PropTypes.string,
  }),
  isVisible: PropTypes.bool,
};

export default ChatOverlay;
