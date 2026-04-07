## Plan: Implement VidFast PostMessage API Integration for Watch Party Sync

Implement a WatchPartySync class that controls VidFast video players programmatically using PostMessage API, enabling real-time synchronization across watch party participants with proper handling of network latency and async responses.

**Steps**
1. Create WatchPartySync class constructor with iframe, transport, isHost, and isMobile parameters
2. Implement sendToPlayer method for sending commands to VidFast iframe with origin validation
3. Add broadcastAction method with throttling to handle network latency (200ms minimum interval)
4. Implement handlePartyCommand for processing incoming sync commands from other participants
5. Create syncToHost method for viewers joining mid-session with buffering for iframe load time
6. Set up message event listeners for PLAYER_EVENT types (play, pause, seeked, timeupdate, playerstatus)
7. Add manual control methods (play, pause, seek, setVolume, toggleMute) with integer time handling
8. Implement getStatus method with callback support for async status responses
9. Add timeout handling for status requests (2s) and stale command filtering (5s)
10. Include destroy method for cleanup of event listeners and callbacks

**Relevant files**
- `src/components/WatchPartySync.js` — Main implementation file (currently empty)
- `src/components/PartyPlayer.jsx` — Integrates WatchPartySync instance with transport bridge
- `src/services/appwrite.js` — Provides syncRoomState function for broadcasting commands
- `src/hooks/useWatchParty.js` — Manages party state and subscriptions for receiving commands

**Verification**
1. Test PostMessage commands (play, pause, seek) work with VidFast iframe in isolation
2. Verify host broadcasts actions and viewers receive them via Appwrite subscriptions
3. Check latency handling: join mid-session syncs correctly, stale commands are ignored
4. Confirm async status responses are handled with callbacks and timeouts
5. Test edge cases: network disconnects, iframe reloads, multiple rapid commands
6. Validate security: only accepts messages from VidFast origins
7. Ensure integer seconds for seek commands and proper time synchronization

**Decisions**
- Use class-based implementation to match existing PartyPlayer integration expectations
- Implement 200ms throttling for broadcasts to prevent Appwrite spam during network latency
- Filter commands older than 5 seconds to handle network delays gracefully
- Use Math.floor for all seek times to ensure integer seconds as required by API
- Add 500ms buffer for initial sync to account for iframe loading delays

**Further Considerations**
1. Consider adding retry logic for failed PostMessage sends if iframe not ready
2. Evaluate implementing volume sync for complete media state synchronization
3. Assess need for heartbeat mechanism to detect disconnected participants
4. Consider mobile-specific optimizations for touch-based controls
