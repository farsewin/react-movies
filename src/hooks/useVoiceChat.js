import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';
import { generateLiveKitToken, LIVEKIT_URL } from '../services/livekit';

/**
 * useVoiceChat — manages a LiveKit Room connection for voice chat.
 * Returns speaking state and controls without any LiveKit React UI components.
 *
 * @param {string} roomCode - The watch party room code (used as LiveKit room name)
 * @param {object|null} user - Appwrite user object ({ $id, name })
 * @param {boolean} enabled - Whether to connect at all (only connect when party is loaded)
 */
export const useVoiceChat = (roomCode, user, enabled = true) => {
  const roomRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Start muted by default
  const [speakingParticipants, setSpeakingParticipants] = useState(new Set());
  const [participants, setParticipants] = useState([]); // [{ identity, name }]
  const [error, setError] = useState(null);

  // Build participant list from room
  const refreshParticipants = useCallback((room) => {
    if (!room) return;
    const list = [];
    // Local participant
    list.push({
      identity: room.localParticipant.identity,
      name: room.localParticipant.name || room.localParticipant.identity,
      isLocal: true,
    });
    // Remote participants
    room.remoteParticipants.forEach((p) => {
      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        isLocal: false,
      });
    });
    setParticipants(list);
  }, []);

  useEffect(() => {
    if (!roomCode || !user || !enabled) return;

    let room;
    let cancelled = false;

    const connect = async () => {
      try {
        const token = await generateLiveKitToken(
          roomCode,
          user.$id,
          user.name || user.$id
        );

        if (cancelled) return;

        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          // We don't auto-publish audio — user must explicitly unmute
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        roomRef.current = room;

        // --- Event listeners ---
        room.on(RoomEvent.ParticipantConnected, () => refreshParticipants(room));
        room.on(RoomEvent.ParticipantDisconnected, (p) => {
          refreshParticipants(room);
          setSpeakingParticipants((prev) => {
            const next = new Set(prev);
            next.delete(p.identity);
            return next;
          });
        });
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingParticipants(new Set(speakers.map((s) => s.identity)));
        });
        room.on(RoomEvent.Disconnected, () => {
          setIsConnected(false);
          setSpeakingParticipants(new Set());
          setParticipants([]);
        });

        await room.connect(LIVEKIT_URL, token);

        if (cancelled) {
          room.disconnect();
          return;
        }

        setIsConnected(true);
        setError(null);
        refreshParticipants(room);

        // Create mic track but keep it muted (don't publish until user unmutes)
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (err) {
        console.error('[useVoiceChat] Connection error:', err);
        setError(err.message);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      setIsConnected(false);
      setIsMuted(true);
      setSpeakingParticipants(new Set());
      setParticipants([]);
    };
  }, [roomCode, user?.$id, enabled]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !isConnected) return;

    try {
      const newMuted = !isMuted;
      await room.localParticipant.setMicrophoneEnabled(!newMuted);
      setIsMuted(newMuted);
    } catch (err) {
      console.error('[useVoiceChat] Toggle mute error:', err);
    }
  }, [isMuted, isConnected]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
  }, []);

  return {
    isConnected,
    isMuted,
    toggleMute,
    speakingParticipants, // Set<identity string>
    participants,          // [{ identity, name, isLocal }]
    error,
    disconnect,
  };
};
