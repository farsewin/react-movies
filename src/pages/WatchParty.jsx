import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getWatchParty, getCurrentUser } from '../services/appwrite'
import { useWatchParty } from '../hooks/useWatchParty'
import Spinner from '../components/Spinner'
import PartyPlayer from '../components/PartyPlayer'
import PartyMembers from '../components/PartyMembers'

const WatchParty = () => {
  const { roomCode } = useParams()
  const navigate = useNavigate()
  const [party, setParty] = useState(null)
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const { partyMembers, roomState } = useWatchParty(roomCode)

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
        <header className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <button 
                onClick={() => navigate("/")} 
                className="text-light-200 hover:text-white mb-4 flex items-center gap-2 group transition-colors"
              >
                <span className="group-hover:-translate-x-1 transition-transform">←</span> Back to Discovery
              </button>
              <h1 className="text-left text-3xl sm:text-5xl mx-0 mb-2 font-black tracking-tight">{party?.movie_title}</h1>
              <p className="text-indigo-400 font-medium flex items-center gap-2">
                <span className="size-2 bg-indigo-400 rounded-full animate-pulse" />
                Hosted by {party?.creator_name}
              </p>
            </div>
            <div className="bg-dark-100/80 backdrop-blur-md px-6 py-3 rounded-2xl border border-light-100/10 shadow-xl">
               <p className="text-xs text-light-200 uppercase tracking-widest mb-1 font-bold">In the Room</p>
               <span className="font-mono text-2xl font-bold text-indigo-400 tracking-tighter">{roomCode}</span>
            </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
           <div className="lg:col-span-3">
             <PartyPlayer movie={party} roomCode={roomCode} user={user} roomState={roomState} />
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

