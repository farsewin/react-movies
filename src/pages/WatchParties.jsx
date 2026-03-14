import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAvailableRooms, client, DATABASE_ID, WATCH_PARTIES_TABLE_ID } from '../services/appwrite';
import RoomCard from '../components/RoomCard';
import Spinner from '../components/Spinner';

const WatchParties = () => {
  const [rooms, setRooms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const fetchRooms = async () => {
    setIsLoading(true);
    const availableRooms = await getAvailableRooms();
    setRooms(availableRooms);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchRooms();

    // Subscribe to real-time updates for new rooms
    const unsubscribe = client.subscribe(
      `databases.${DATABASE_ID}.collections.${WATCH_PARTIES_TABLE_ID}.documents`,
      (response) => {
        if (response.events.includes('databases.*.collections.*.documents.*.create')) {
          setRooms((prev) => [response.payload, ...prev]);
        }
        if (response.events.includes('databases.*.collections.*.documents.*.delete')) {
          setRooms((prev) => prev.filter((r) => r.$id !== response.payload.$id));
        }
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <main className="bg-primary min-h-screen relative overflow-hidden">
      <div className="pattern opacity-30" />
      
      <div className="wrapper relative z-10">
        <nav className="flex justify-between items-center mb-16 px-2">
           <div className="flex items-center gap-8">
             <p onClick={() => navigate('/')} className="text-white font-black text-2xl tracking-tighter cursor-pointer hover:text-indigo-400 transition-colors">
               MovieApp<span className="text-indigo-500">.</span>
             </p>
             <div className="hidden md:flex items-center gap-6 text-sm font-bold text-light-200">
                <button onClick={() => navigate('/')} className="hover:text-white transition-colors flex items-center gap-2">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  Home
                </button>
             </div>
           </div>
           
           <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate('/')}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-full font-black text-sm transition-all flex items-center gap-2 shadow-lg shadow-red-600/20 active:scale-95"
              >
                <span className="text-lg">+</span> Create Room
              </button>
           </div>
        </nav>

        <header className="mb-12 px-2">
          <h1 className="text-left mx-0 max-w-none text-4xl sm:text-5xl font-black mb-4 tracking-tighter">
            Watch Party
          </h1>
          <p className="text-light-200 text-lg font-medium max-w-2xl">
            Watch movies and TV shows with friends in perfect sync. Join an existing room or create your own.
          </p>
        </header>

        <section className="bg-dark-100/30 backdrop-blur-xl border border-white/5 rounded-[40px] p-6 sm:p-10 shadow-3xl">
          <div className="flex justify-between items-center mb-10">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              Available rooms
              <span className="size-2 bg-indigo-500 rounded-full animate-pulse" />
            </h2>
            <button 
              onClick={fetchRooms}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-light-200 transition-all flex items-center gap-2 border border-white/5"
            >
              <svg className={`size-3 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Spinner />
              <p className="text-light-200 font-bold animate-pulse uppercase tracking-widest text-[10px]">Scanning for active parties...</p>
            </div>
          ) : rooms.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {rooms.map((room) => (
                <RoomCard key={room.$id} room={room} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 text-center">
               <div className="size-20 bg-indigo-600/10 rounded-full flex items-center justify-center mb-6 border border-indigo-500/20">
                  <svg className="size-10 text-indigo-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
               </div>
               <h3 className="text-white text-xl font-black mb-2">No active rooms found</h3>
               <p className="text-light-200 max-w-xs text-sm font-medium">Be the first to start a party! Go back home, find a movie, and invite your friends.</p>
               <button 
                 onClick={() => navigate('/')}
                 className="mt-8 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-black transition-all"
               >
                 Find a Movie
               </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export default WatchParties;
