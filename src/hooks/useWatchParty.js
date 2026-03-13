import { useState, useEffect } from 'react';
import { database, client, PARTY_MEMBERS_TABLE_ID, DATABASE_ID } from '../services/appwrite';
import { Query } from 'appwrite';

export const useWatchParty = (roomCode) => {
  const [partyMembers, setPartyMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomCode) return;

    const fetchMembers = async () => {
      try {
        const result = await database.listDocuments(
          DATABASE_ID,
          PARTY_MEMBERS_TABLE_ID,
          [Query.equal('party_id', roomCode)]
        );
        setPartyMembers(result.documents);
      } catch (err) {
        console.error('Error fetching members:', err);
        setError('Failed to load party members');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();

    // Subscribe to real-time updates
    const unsubscribe = client.subscribe(
      `databases.${DATABASE_ID}.collections.party_members.documents`,
      (response) => {
        if (response.events.includes('databases.*.collections.*.documents.*.create')) {
          const newMember = response.payload;
          if (newMember.party_id === roomCode) {
            setPartyMembers((prev) => [...prev, newMember]);
          }
        }
        
        if (response.events.includes('databases.*.collections.*.documents.*.delete')) {
          const deletedMemberId = response.payload.$id;
          setPartyMembers((prev) => prev.filter((m) => m.$id !== deletedMemberId));
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [roomCode]);

  return { partyMembers, isLoading, error };
};
