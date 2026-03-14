import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWatchParty } from '../services/appwrite';
import { generateRoomCode } from '../utils/roomCode';
import { useUser } from '../context/UserContext.jsx';

export const useCreateParty = () => {
  const { user } = useUser();
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleCreateParty = async (movie) => {
    if (!user) {
      alert("Please login to start a watch party!");
      return;
    }

    setIsCreating(true);
    try {
      const roomCode = generateRoomCode();
      const movieWithTitle = { ...movie, title: movie.title || movie.name };
      
      await createWatchParty(roomCode, movieWithTitle);
      
      const isMobile = window.innerWidth < 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      if (!isMobile) {
        try {
          await document.documentElement.requestFullscreen();
        } catch (err) {
          console.warn("Fullscreen request failed:", err);
        }
      }
      
      navigate(`/party/${roomCode}`);
    } catch (error) {
      console.error("Failed to create party:", error);
      alert("Could not create watch party. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return { handleCreateParty, isCreating };
};
