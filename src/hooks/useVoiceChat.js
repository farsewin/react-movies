import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { generateLiveKitToken, LIVEKIT_URL } from '../services/livekit';

/**
 * useVoiceChat — manages a LiveKit Room connection for voice chat.
 * Handles remote audio attachment so participants can actually hear each other.
 *
 * @param {string} roomCode - The watch party room code (used as LiveKit room name)
 * @param {object|null} user - Appwrite user object ({ $id, name })
 * @param {boolean} enabled - Whether to connect at all (only when party is loaded)
 */
export const useVoiceChat = (roomCode, user, enabled = true) => {
  const roomRef = useRef(null);
  // Track attached audio elements so we can clean them up
  const audioElementsRef = useRef(new Map()); // trackSid -> HTMLAudioElement[]

  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [speakingParticipants, setSpeakingParticipants] = useState(new Set());
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState(null);

  // Attach a remote audio track to a real <audio> element so it plays
  const attachAudioTrack = useCallback((track, participantIdentity) => {
    if (track.kind !== Track.Kind.Audio) return;

    const elements = track.attach(); // Returns HTMLMediaElement[]
    elements.forEach((el) => {
      el.setAttribute('data-livekit-participant', participantIdentity);
      el.autoplay = true;
      el.style.display = 'none'; // invisible, audio only
      document.body.appendChild(el);
    });
    // Store reference for cleanup
    audioElementsRef.current.set(track.sid, elements);
  }, []);

  // Detach and remove audio elements for a track
  const detachAudioTrack = useCallback((track) => {
    const elements = audioElementsRef.current.get(track.sid);
    if (elements) {
      elements.forEach((el) => {
        el.pause();
        el.srcObject = null;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      audioElementsRef.current.delete(track.sid);
    }
    // Also call track.detach() to clean up livekit internals
    try { track.detach(); } catch (_) {}
  }, []);

  // Build participant list
  const refreshParticipants = useCallback((room) => {
    if (!room) return;
    const list = [];
    list.push({
      identity: room.localParticipant.identity,
      name: room.localParticipant.name || room.localParticipant.identity,
      isLocal: true,
    });
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

    let cancelled = false;

    const connect = async () => {
      try {
        const token = await generateLiveKitToken(
          roomCode,
          user.$id,
          user.name || user.$id
        );

        if (cancelled) return;

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          // Ensure we subscribe to remote audio automatically
          disconnectOnPageLeave: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        roomRef.current = room;

        // === Remote track events ===

        // A remote participant published a track → subscribe and attach audio
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (track.kind === Track.Kind.Audio) {
            attachAudioTrack(track, participant.identity);
          }
        });

        // Remote track removed → clean up audio element
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            detachAudioTrack(track);
          }
        });

        // === Participant events ===
        room.on(RoomEvent.ParticipantConnected, () => refreshParticipants(room));
        room.on(RoomEvent.ParticipantDisconnected, (p) => {
          refreshParticipants(room);
          setSpeakingParticipants((prev) => {
            const next = new Set(prev);
            next.delete(p.identity);
            return next;
          });
        });

        // === Speaking detection ===
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingParticipants(new Set(speakers.map((s) => s.identity)));
        });

        room.on(RoomEvent.Disconnected, () => {
          setIsConnected(false);
          setSpeakingParticipants(new Set());
          setParticipants([]);
        });

        // === Autoplay unlock: call startAudio() when user first interacts ===
        // LiveKit needs a user gesture to start audio context in browsers
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!room.canPlaybackAudio) {
            // Will retry automatically on next user gesture
            room.startAudio().catch(() => {});
          }
        });

        await room.connect(LIVEKIT_URL, token);

        if (cancelled) {
          room.disconnect();
          return;
        }

        // Explicitly try to start audio playback (handles browser autoplay policy)
        try {
          await room.startAudio();
        } catch (_) {
          // Will be retried on first user interaction via AudioPlaybackStatusChanged
        }

        // Attach any already-subscribed remote tracks (e.g. if joining late)
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            if (publication.track && publication.kind === Track.Kind.Audio) {
              attachAudioTrack(publication.track, participant.identity);
            }
          });
        });

        setIsConnected(true);
        setError(null);
        refreshParticipants(room);

        // Join muted — no mic until user clicks unmute
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (err) {
        console.error('[useVoiceChat] Connection error:', err);
        setError(err.message);
      }
    };

    connect();

    return () => {
      cancelled = true;

      // Clean up all audio elements we created
      audioElementsRef.current.forEach((elements) => {
        elements.forEach((el) => {
          el.pause();
          el.srcObject = null;
          if (el.parentNode) el.parentNode.removeChild(el);
        });
      });
      audioElementsRef.current.clear();

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

      // Every unmute is a user gesture — good moment to unlock audio context
      if (!newMuted) {
        room.startAudio().catch(() => {});
      }
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
    speakingParticipants,
    participants,
    error,
    disconnect,
  };
};
