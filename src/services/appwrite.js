import { Client, Databases, ID, Query, Account } from 'appwrite'

export const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID;
export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;
export const TABLE_ID = import.meta.env.VITE_APPWRITE_TABLE_ID;
export const WATCH_PARTIES_TABLE_ID = import.meta.env.VITE_APPWRITE_WATCH_PARTIES_TABLE_ID;
export const PARTY_MEMBERS_TABLE_ID = import.meta.env.VITE_APPWRITE_PARTY_MEMBERS_TABLE_ID;
export const WATCH_PROGRESS_TABLE_ID = import.meta.env.VITE_APPWRITE_WATCH_PROGRESS_TABLE_ID;

const client = new Client()
  .setEndpoint('https://fra.cloud.appwrite.io/v1')
  .setProject(PROJECT_ID)

const database = new Databases(client);
const account = new Account(client);

// --- Auth Services ---

export const signup = async (email, password, name) => {
  try {
    const user = await account.create(ID.unique(), email, password, name);
    // Automatically log in after signup
    return await loginEmailPassword(email, password);
  } catch (error) {
    console.error('Signup error:', error);
    throw error;
  }
};

export const loginEmailPassword = async (email, password) => {
  try {
    return await account.createEmailPasswordSession(email, password);
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await account.deleteSession('current');
  } catch (error) {
    console.error('Logout error:', error);
  }
};

export const getCurrentUser = async () => {
  try {
    return await account.get();
  } catch (error) {
    return null;
  }
};

// --- Watch Party Services ---

export const createWatchParty = async (roomCode, movie) => {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("Must be logged in to create a party");

    const party = await database.createDocument(
      DATABASE_ID,
      WATCH_PARTIES_TABLE_ID,
      ID.unique(),
      {
        room_code: roomCode,
        movie_id: movie.id.toString(),
        movie_title: movie.title,
        creator_id: user.$id,
        creator_name: user.name,
        created_at: new Date().toISOString(),
        playback_status: 'pause',
        last_sync_time: 0,
        last_sync_at: new Date().toISOString(),
        media_type: movie.media_type || 'movie',
        season: movie.season || 1,
        episode: movie.episode || 1
      }
    );

    // Also join as the first member (Host)
    await joinWatchParty(roomCode, user, true);

    return party;
  } catch (error) {
    console.error("Create party error:", error);
    throw error;
  }
};

export const joinWatchParty = async (roomCode, user, isCreator = false) => {
  try {
    // 1. Check member limit (20)
    const existingMembers = await database.listDocuments(
      DATABASE_ID,
      PARTY_MEMBERS_TABLE_ID,
      [Query.equal('party_id', roomCode)]
    );

    // 1. Check if already a member
    const existing = await database.listDocuments(
      DATABASE_ID,
      PARTY_MEMBERS_TABLE_ID,
      [
        Query.equal('party_id', roomCode),
        Query.equal('user_id', user.$id)
      ]
    );

    if (existing.total > 0) return existing.documents[0];

    // 2. Check member limit (20)
    const membersCount = await database.listDocuments(
      DATABASE_ID,
      PARTY_MEMBERS_TABLE_ID,
      [Query.equal('party_id', roomCode)]
    );

    if (membersCount.total >= 20 && !isCreator) {
      throw new Error("Room is full (max 20 members)");
    }

    // 3. Add member
    return await database.createDocument(
      DATABASE_ID,
      PARTY_MEMBERS_TABLE_ID,
      ID.unique(),
      {
        party_id: roomCode,
        user_id: user.$id,
        username: user.name,
        role: isCreator ? 'host' : 'viewer',
        joined_at: Date.now()
      }
    );
  } catch (error) {
    console.error("Join party error:", error);
    throw error;
  }
};

export const getWatchParty = async (roomCode) => {
  try {
    const result = await database.listDocuments(
      DATABASE_ID,
      WATCH_PARTIES_TABLE_ID,
      [Query.equal('room_code', roomCode)]
    );
    return result.documents[0] || null;
  } catch (error) {
    console.error("Get party error:", error);
    return null;
  }
};

export const syncRoomState = async (roomIdentifier, playbackStatus, lastSyncTime, tvMeta = {}) => {
  try {
    let documentId = roomIdentifier;

    // If identifier is a room code (roughly 6-8 chars), we need to find the document ID
    if (roomIdentifier.length < 15) {
      const party = await getWatchParty(roomIdentifier);
      if (!party) return;
      documentId = party.$id;
    }

    const data = {
      playback_status: playbackStatus,
      last_sync_time: Math.floor(lastSyncTime),
      last_sync_at: new Date().toISOString()
    };

    if (tvMeta.season !== undefined) data.season = tvMeta.season;
    if (tvMeta.episode !== undefined) data.episode = tvMeta.episode;
    if (tvMeta.custom_subtitle_url !== undefined) data.custom_subtitle_url = tvMeta.custom_subtitle_url;

    await database.updateDocument(
      DATABASE_ID,
      WATCH_PARTIES_TABLE_ID,
      documentId,
      data
    );
  } catch (error) {
    console.error("Sync room state error:", error);
  }
};

// --- Progress Tracking ---

export const updateWatchProgress = async (movieId, watchedTime, duration, tvMeta = {}) => {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const progressPercentage = Math.floor((watchedTime / duration) * 100);

    // Check if progress exists
    const existing = await database.listDocuments(
      DATABASE_ID,
      WATCH_PROGRESS_TABLE_ID,
      [
        Query.equal('userId', user.$id),
        Query.equal('movieId', parseInt(movieId))
      ]
    );

    const data = {
      userId: user.$id,
      movieId: parseInt(movieId),
      progressPercentage,
      lastWatchedTimestamp: new Date().toISOString(),
      watchStatus: progressPercentage >= 95 ? 'completed' : 'inProgress',
      deviceType: 'web',
      media_type: tvMeta.media_type || 'movie',
      season: tvMeta.season || 1,
      episode: tvMeta.episode || 1
    };

    console.log("Updating progress with data:", data);

    if (existing.total > 0) {
      await database.updateDocument(
        DATABASE_ID,
        WATCH_PROGRESS_TABLE_ID,
        existing.documents[0].$id,
        data
      );
    } else {
      await database.createDocument(
        DATABASE_ID,
        WATCH_PROGRESS_TABLE_ID,
        ID.unique(),
        data
      );
    }
  } catch (error) {
    console.error("Update progress error details:", error.response); // Get more info from Appwrite
    console.error("Update progress total error:", error);
  }
};

// --- Legacy Metric Services ---

export const updateSearchCount = async (searchTerm, movie) => {
  try {
   const result = await database.listDocuments(DATABASE_ID, TABLE_ID, [
     Query.equal('searchTerm', searchTerm),
   ])

   if(result.documents.length > 0) {
    const doc = result.documents[0];

    await database.updateDocument(DATABASE_ID, TABLE_ID, doc.$id, {
     count: doc.count + 1,
    })
   } else {
    await database.createDocument(DATABASE_ID, TABLE_ID, ID.unique(), {
     searchTerm,
     count: 1,
     movie_id: movie.id,
     poster_url: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
    })
   }
  } catch (error) {
   console.error(error);
  }
}

export const getTrendingMovies = async () => {
  try {
   const result = await database.listDocuments(DATABASE_ID, TABLE_ID, [
     Query.limit(5),
     Query.orderDesc("count")
   ])

   return result.documents;
  } catch (error) {
    console.error(error);
    return [];
  }
}

export { client, database, account };
