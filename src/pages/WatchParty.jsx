import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getWatchParty, getCurrentUser, joinWatchParty, syncRoomState } from '../services/appwrite'
import { useWatchParty } from '../hooks/useWatchParty'
import Spinner from '../components/Spinner'
import PartyPlayer from '../components/PartyPlayer'
import PartyMembers from '../components/PartyMembers'

const API_BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = import.meta.env.VITE_TMDB_API_KEY;

const WatchParty = () => {
  const { roomCode } = useParams()
  const navigate = useNavigate()
  const [party, setParty] = useState(null)
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [totalEpisodes, setTotalEpisodes] = useState(null);
  const { partyMembers, roomState } = useWatchParty(roomCode)
  
  // States to keep UI in sync while preventing iframe reloads
  const [displayedEpisode, setDisplayedEpisode] = useState(1); // For header/counter
  const [playerEpisode, setPlayerEpisode] = useState(1);       // For iframe src
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSeasonLoading, setIsSeasonLoading] = useState(false);

  useEffect(() => {
    const ep = roomState?.episode || party?.episode || 1;
    setDisplayedEpisode(ep);
    
    // Only update player if the room state changed to an episode 
    // we aren't already displaying/playing. This stops the "echo" reload.
    if (ep !== displayedEpisode) {
      setPlayerEpisode(ep);
    }
  }, [roomState?.episode, party?.episode]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  useEffect(() => {
    const fetchSeasonDetails = async () => {
      const tmdbId = roomState?.movie_id || party?.movie_id;
      const season = roomState?.season || party?.season || 1;
      const mediaType = roomState?.media_type || party?.media_type;

      if (!tmdbId || mediaType !== 'tv') return;

      setIsSeasonLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/tv/${tmdbId}/season/${season}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${API_KEY}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setTotalEpisodes(data.episodes?.length || null);
        }
      } catch (error) {
        console.error("Error fetching season details:", error);
      } finally {
        setIsSeasonLoading(false);
      }
    };

    fetchSeasonDetails();
  }, [roomState?.movie_id, party?.movie_id, roomState?.season, party?.season, roomState?.media_type, party?.media_type]);

  useEffect(() => {
    const init = async () => {
      try {
        const [usr, prty] = await Promise.all([
          getCurrentUser(),
          getWatchParty(roomCode)
        ])

        if (!usr) return;

        if (!prty) {
          alert("Party not found")
          navigate("/")
          return
        }

        setUser(usr)
        setParty(prty)

        // Automatically join the party if logged in
        await joinWatchParty(roomCode, usr, usr.$id === prty.creator_id);
      } catch (error) {
        console.error("Init Error:", error)
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [roomCode, navigate])

  if (isLoading) return <div className="min-h-screen bg-primary flex items-center justify-center"><Spinner /></div>

  if (!user) {
    return (
      <div className="min-h-screen bg-primary flex flex-col items-center justify-center text-white p-5 text-center">
        <h1 className="mb-4 text-gradient">Login Required</h1>
        <p className="text-light-200 mb-8 max-w-md">You need to be logged in to join this watch party and sync your progress with friends.</p>
        <button 
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-full font-bold shadow-xl transition-all hover:scale-105" 
          onClick={() => navigate("/")}
        >
          Go Back to Login
        </button>
      </div>
    )
  }

  return (
    <main className="bg-primary min-h-screen text-white p-5 lg:p-10 relative overflow-hidden">
      <div className="pattern opacity-30" />
      
      <div className="max-w-7xl mx-auto relative z-10">
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="w-full md:w-auto">
              <button 
                onClick={() => navigate("/")} 
                className="text-light-200 hover:text-white mb-4 flex items-center gap-2 group transition-colors text-sm"
              >
                <span className="group-hover:-translate-x-1 transition-transform">←</span> Back
              </button>
              <h1 className="text-left text-2xl sm:text-4xl md:text-5xl mx-0 mb-2 font-black tracking-tight leading-tight">{party?.movie_title}</h1>
              <p className="text-indigo-400 text-sm font-medium flex items-center gap-2">
                <span className="size-2 bg-indigo-400 rounded-full animate-pulse" />
                Hosted by {party?.creator_name}
              </p>
            </div>
            <div className="w-full md:w-auto glass-panel px-4 sm:px-6 py-3 rounded-2xl shadow-xl flex items-center justify-between sm:justify-start gap-4 sm:gap-6">
               {(party?.media_type === 'tv' || roomState?.media_type === 'tv') && user?.$id === party?.creator_id && (
                 <div className="flex items-center gap-3 border-r border-light-100/10 pr-4 sm:pr-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-light-200 uppercase font-bold">Season</span>
                      <input 
                        type="number" 
                        min="1" 
                        value={roomState?.season || party?.season || 1} 
                        onChange={(e) => syncRoomState(party?.$id || roomCode, roomState?.playback_status || 'pause', roomState?.last_sync_time || 0, { season: parseInt(e.target.value), episode: roomState?.episode || party?.episode || 1 })}
                        className="bg-transparent text-white font-bold w-12 focus:outline-hidden"
                      />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-light-200 uppercase font-bold">
                        Episode {totalEpisodes ? `/ ${totalEpisodes}` : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="1" 
                          max={totalEpisodes || 100}
                          value={displayedEpisode} 
                          onChange={(e) => {
                            const newEp = parseInt(e.target.value);
                            setDisplayedEpisode(newEp);
                            setPlayerEpisode(newEp);
                            syncRoomState(party?.$id || roomCode, roomState?.playback_status || 'pause', roomState?.last_sync_time || 0, { season: roomState?.season || party?.season || 1, episode: newEp });
                          }}
                          className="bg-transparent text-white font-bold w-12 focus:outline-hidden"
                        />
                        <button 
                          onClick={() => {
                            if (totalEpisodes && displayedEpisode >= totalEpisodes) return;
                            const newEp = displayedEpisode + 1;
                            setDisplayedEpisode(newEp);
                            setPlayerEpisode(newEp);
                            syncRoomState(party?.$id || roomCode, roomState?.playback_status || 'play', 0, { season: roomState?.season || party?.season || 1, episode: newEp });
                          }}
                          disabled={totalEpisodes ? displayedEpisode >= totalEpisodes : false}
                          className={`bg-indigo-600/30 hover:bg-indigo-600 text-indigo-400 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold transition-all ${totalEpisodes && displayedEpisode >= totalEpisodes ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          NEXT →
                        </button>
                      </div>
                    </div>
                 </div>
               )}
                <div className="flex flex-col shrink-0">
                 <p className="text-[10px] text-light-200 uppercase tracking-widest mb-0.5 font-bold">Room Code</p>
                 <div className="flex items-center gap-2">
                   <span className="font-mono text-xl sm:text-2xl font-bold text-indigo-400 tracking-tighter">{roomCode}</span>
                   <button 
                    onClick={handleCopyCode}
                    className={`p-1.5 rounded-lg transition-all ${copySuccess ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-light-200 hover:bg-white/10 hover:text-white'}`}
                    title="Copy Room Code"
                   >
                     {copySuccess ? (
                       <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                       </svg>
                     ) : (
                       <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                       </svg>
                     )}
                   </button>
                 </div>
               </div>
            </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
           <div className="lg:col-span-3">
             <PartyPlayer 
               movie={roomState || party} 
               roomCode={roomCode} 
               roomDocId={party?.$id}
               user={user} 
               roomState={roomState}
               displayedEpisode={displayedEpisode}
               localEpisode={playerEpisode}
               onLocalEpisodeChange={(ep) => {
                 setDisplayedEpisode(ep);
                 setPlayerEpisode(ep);
                 syncRoomState(party?.$id || roomCode, "play", 0, { episode: ep });
               }}
                onNativeNavigation={(ep) => {
                 setDisplayedEpisode(ep);
                 syncRoomState(party?.$id || roomCode, "play", 0, { episode: ep });
               }}
             />
           </div>

           <div className="lg:col-span-1">
             <PartyMembers members={partyMembers} />
           </div>
        </div>
      </div>
    </main>
  )
}

export default WatchParty

