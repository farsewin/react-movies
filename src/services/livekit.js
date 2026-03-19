import { SignJWT } from 'jose';

const LIVEKIT_API_KEY = import.meta.env.VITE_LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = import.meta.env.VITE_LIVEKIT_API_SECRET;
export const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

/**
 * Generates a LiveKit access token (JWT) client-side.
 * @param {string} roomName - The room to join (we use the watch party roomCode)
 * @param {string} identity - Unique identity for this participant (user.$id)
 * @param {string} name - Display name for this participant (user.name)
 */
export const generateLiveKitToken = async (roomName, identity, name) => {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error('LiveKit credentials not configured');
  }

  const secretKey = new TextEncoder().encode(LIVEKIT_API_SECRET);

  const videoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  const token = await new SignJWT({
    video: videoGrant,
    name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(LIVEKIT_API_KEY)
    .setSubject(identity)
    .setIssuedAt()
    .setExpirationTime('6h')
    .sign(secretKey);

  return token;
};
