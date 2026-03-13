import { useState, useEffect } from 'react';
import { database, client, PARTY_MEMBERS_TABLE_ID, WATCH_PARTIES_TABLE_ID, DATABASE_ID } from '../services/appwrite';
import { Query } from 'appwrite';

export const useWatchParty = (roomCode) => {
  const [partyMembers, setPartyMembers] = useState([]);
  const [roomState, setRoomState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomCode) return;

    const fetchData = async () => {
      try {
        // Fetch Members
        const membersResult = await database.listDocuments(
          DATABASE_ID,
          PARTY_MEMBERS_TABLE_ID,
          [Query.equal('party_id', roomCode)]
        );
        setPartyMembers(membersResult.documents);

        // Fetch Room State
        const roomResult = await database.listDocuments(
          DATABASE_ID,
          WATCH_PARTIES_TABLE_ID,
          [Query.equal('room_code', roomCode)]
        );
        if (roomResult.documents[0]) {
          setRoomState(roomResult.documents[0]);
        }
      } catch (err) {
        console.error('Error fetching party data:', err);
        setError('Failed to load party data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Subscribe to Members updates
    const unsubscribeMembers = client.subscribe(
      `databases.${DATABASE_ID}.collections.${PARTY_MEMBERS_TABLE_ID}.documents`,
      (response) => {
        if (response.events.includes('databases.*.collections.*.documents.*.create')) {
          if (response.payload.party_id === roomCode) {
            setPartyMembers((prev) => [...prev, response.payload]);
          }
        }
        if (response.events.includes('databases.*.collections.*.documents.*.delete')) {
          setPartyMembers((prev) => prev.filter((m) => m.$id !== response.payload.$id));
        }
      }
    );

    // Subscribe to Room updates (Sync)
    const unsubscribeRoom = client.subscribe(
      `databases.${DATABASE_ID}.collections.${WATCH_PARTIES_TABLE_ID}.documents`,
      (response) => {
        if (response.payload.room_code === roomCode) {
          setRoomState(response.payload);
        }
      }
    );

    return () => {
      unsubscribeMembers();
      unsubscribeRoom();
    };
  }, [roomCode]);

  return { partyMembers, roomState, isLoading, error };
};
