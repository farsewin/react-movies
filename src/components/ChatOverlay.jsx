import React, { useState, useEffect, useRef } from 'react';
import { sendChatMessage } from '../services/appwrite';

const ChatOverlay = ({ roomCode, user, messages }) => {
  const [newMessage, setNewMessage] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef(null);

  const emojis = ['😊', '😂', '🔥', '❤', '😮', '😢', '👏', '🎬'];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    try {
      const text = newMessage;
      setNewMessage('');
      await sendChatMessage(roomCode, user, text);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const addEmoji = (emoji) => {
    setNewMessage(prev => prev + emoji);
    setShowEmoji(false);
  };

  return (
    <div className={`absolute bottom-20 right-6 z-40 flex flex-col items-end transition-all duration-300 ${isExpanded ? 'w-[320px] max-w-[90vw]' : 'w-12 h-12'}`}>
      
      {/* Messages Area */}
      <div className={`w-full overflow-hidden transition-all duration-300 ${isExpanded ? 'opacity-100 mb-4' : 'opacity-0 pointer-events-none mb-0 h-0'}`}>
        <div 
          ref={scrollRef}
          className="max-h-[300px] overflow-y-auto space-y-2 p-2 scrollbar-none mask-fade-top flex flex-col"
        >
          {messages.map((msg, idx) => (
            <div 
              key={msg.$id || idx} 
              className={`flex flex-col ${msg.user_id === user?.$id ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                 <span className={`text-[10px] font-bold uppercase tracking-widest ${msg.user_id === user?.$id ? 'text-indigo-400' : 'text-amber-400'}`}>
                    {msg.username}
                 </span>
              </div>
              <div className={`px-4 py-2 rounded-2xl text-xs font-medium shadow-lg backdrop-blur-md border ${
                msg.user_id === user?.$id 
                  ? 'bg-indigo-600/80 border-indigo-500/30 rounded-tr-none text-white' 
                  : 'bg-dark-200/80 border-white/5 rounded-tl-none text-light-100'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input / Control Bar */}
      <div className="flex items-center gap-2 w-full">
         <div className={`flex-1 glass-panel px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-3 ${isExpanded ? 'border-white/10 opacity-100 shadow-2xl' : 'border-transparent opacity-0 pointer-events-none'}`}>
            <button 
              onClick={() => setShowEmoji(!showEmoji)}
              className="text-light-200 hover:text-white transition-colors"
            >
               <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
               </svg>
            </button>
            <form onSubmit={handleSendMessage} className="flex-1">
              <input 
                type="text" 
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="bg-transparent text-white text-xs w-full focus:outline-none placeholder:text-light-200/50"
              />
            </form>
            <button 
              onClick={handleSendMessage}
              className={`transition-all ${newMessage.trim() ? 'text-indigo-400 scale-110' : 'text-light-200/20 pointer-events-none'}`}
            >
               <svg className="size-5 rotate-90" fill="currentColor" viewBox="0 0 20 20">
                 <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
               </svg>
            </button>
         </div>

         {/* Toggle Button */}
         <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className={`size-12 rounded-full backdrop-blur-md border border-white/10 flex items-center justify-center transition-all duration-300 shadow-2xl ${
               isExpanded ? 'bg-indigo-600 border-indigo-500' : 'bg-dark-100/80 hover:bg-dark-200'
            }`}
         >
            {isExpanded ? (
               <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
               </svg>
            ) : (
               <div className="relative">
                  <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {messages.length > 0 && (
                     <span className="absolute -top-1 -right-1 size-3 bg-red-500 rounded-full border border-white pulse-subtle" />
                  )}
               </div>
            )}
         </button>
      </div>

      {/* Emoji Picker */}
      {showEmoji && isExpanded && (
        <div className="absolute bottom-20 right-0 glass-panel p-3 rounded-2xl border border-white/5 flex gap-2 shadow-2xl animate-fade-in">
           {emojis.map(e => (
             <button key={e} onClick={() => addEmoji(e)} className="hover:scale-125 transition-transform">{e}</button>
           ))}
        </div>
      )}
    </div>
  );
};

export default ChatOverlay;
