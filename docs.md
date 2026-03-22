Use one of the following domains for embed URLs:
vidfast.pro, vidfast.in, vidfast.io, vidfast.me, vidfast.net, vidfast.pm, vidfast.xyz
Documentation
Complete reference guide for embedding and customizing VidFast players on your website.


Endpoints

Implementation

Customization

Events

PostMessage
Events & Progress Tracking
The player can send watch progress events to the parent window. You can save this progress to localStorage or your own backend.

Available Events
playTriggered when video starts playing
pauseTriggered when video is paused
seekedTriggered when user seeks to a different timestamp
endedTriggered when video playback ends
timeupdateTriggered periodically during playback
playerstatusTriggered when getStatus is called
Event Data Structure
{
    type: "PLAYER_EVENT",
    data: {
        event: "play" | "pause" | "seeked" | "ended" | "timeupdate" | "playerstatus",
        currentTime: number,
        duration: number,
        tmdbId: number,
        mediaType: "movie" | "tv",
        season?: number,
        episode?: number,
        playing: bool,
        muted: bool,
        volume: number
    }
}

Event Listener Implementation
Add this script where your iframe is located. For React/Next.js, place it in a useEffect hook.

const vidfastOrigins = [
    'https://vidfast.pro',
    'https://vidfast.in',
    'https://vidfast.io',
    'https://vidfast.me',
    'https://vidfast.net',
    'https://vidfast.pm',
    'https://vidfast.xyz'
];

window.addEventListener('message', ({ origin, data }) => {
    if (!vidfastOrigins.includes(origin) || !data) {
        return;
    }

    if (data.type === 'PLAYER_EVENT') {
        const { event, currentTime, duration } = data.data;

        console.log(`Player ${event} at ${currentTime}s of ${duration}s`);

        // Add custom event handling logic here
    }
});

Direct Media Data Event Listener
This simpler event listener directly captures and stores the complete media data structure:

const vidfastOrigins = [
    'https://vidfast.pro',
    'https://vidfast.in',
    'https://vidfast.io',
    'https://vidfast.me',
    'https://vidfast.net',
    'https://vidfast.pm',
    'https://vidfast.xyz'
];

window.addEventListener('message', ({ origin, data }) => {
    if (!vidfastOrigins.includes(origin) || !data) {
        return;
    }

    if (data.type === 'MEDIA_DATA') {
        localStorage.setItem('vidFastProgress', JSON.stringify(data.data));
    }
});

Stored Data Structure Example
The data is stored in localStorage and contains movie/show details, watch progress, and episode-specific progress for TV shows.

{
    "t63174": {
        "id": 63174,
        "type": "tv",
        "title": "Lucifer",
        "poster_path": "/ekZobS8isE6mA53RAiGDG93hBxL.jpg",
        "backdrop_path": "/wbiPjTWpZMIB8ffBq7HvzAph4Ft.jpg",
        "progress": {
            "watched": 793.207692,
            "duration": 2695.3689
        },
        "last_season_watched": 1,
        "last_episode_watched": 1,
        "show_progress": {
            "s1e1": {
                "season": 1,
                "episode": 1,
                "progress": {
                    "watched": 793.207692,
                    "duration": 2695.3689
                },
                "last_updated": 1742578021768
            }
        },
        "last_updated": 1742578021768
    },
    "m533535": {
        "id": 533535,
        "type": "movie",
        "title": "Deadpool & Wolverine",
        "poster_path": "/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
        "backdrop_path": "/by8z9Fe8y7p4jo2YlW2SZDnptyT.jpg",
        "progress": {
            "watched": 353.530349,
            "duration": 7667.227
        },
        "last_updated": 1742577064433
    }
}

PostMessage API Control
Control VidFast players programmatically using the PostMessage API. Perfect for watch party features and custom player integrations.

Available Commands
play
Resume video playback
iframe.contentWindow.postMessage({
    command: 'play'
}, '*');
pause
Pause video playback
iframe.contentWindow.postMessage({
    command: 'pause'
}, '*');
seek
Jump to specific time in video (seconds)
iframe.contentWindow.postMessage({
    command: 'seek',
    time: 120  // Jump to 2 minutes
}, '*');
volume
Set player volume (0.0 to 1.0)
iframe.contentWindow.postMessage({
    command: 'volume',
    level: 0.5  // Set to 50% volume
}, '*');
mute
Toggle mute state
iframe.contentWindow.postMessage({
    command: 'mute',
    muted: true  // true to mute, false to unmute
}, '*');
getStatus
Get current player status
iframe.contentWindow.postMessage({
    command: 'getStatus'
}, '*');

// Listen for response
window.addEventListener('message', ({ data }) => {
    if (data.type === 'PLAYER_EVENT' && data.data.event === 'playerstatus') {
        console.log('Current time:', data.data.currentTime);
        console.log('Duration:', data.data.duration);
        console.log('Is playing:', data.data.playing);
        console.log('Is muted:', data.data.muted);
        console.log('Volume:', data.data.volume);
    }
});
Watch Party Integration Example
Perfect for synchronizing video playback across multiple users in a watch party scenario.

// Watch Party Controller Example
class WatchPartyController {
    vidfastOrigins = [
        'https://vidfast.pro',
        'https://vidfast.in',
        'https://vidfast.io',
        'https://vidfast.me',
        'https://vidfast.net',
        'https://vidfast.pm',
        'https://vidfast.xyz'
    ]

    constructor(iframeElement) {
        this.iframe = iframeElement;
        this.setupEventListeners();
    }

    // Sync play command to all participants
    syncPlay(time) {
        this.iframe.contentWindow.postMessage({
            command: 'play',
            time: time
        }, '*');

        // Broadcast to other participants
        this.broadcastToParty({
            action: 'play',
            time: time
        });
    }

    // Sync pause command to all participants
    syncPause(time) {
        this.iframe.contentWindow.postMessage({
            command: 'pause',
            time: time
        }, '*');

        this.broadcastToParty({
            action: 'pause',
            time: time
        });
    }

    // Sync seek to specific time for all participants
    syncSeek(time) {
        this.iframe.contentWindow.postMessage({
            command: 'seek',
            time: time
        }, '*');

        this.broadcastToParty({
            action: 'seek',
            time: time
        });
    }

    // Handle incoming party commands
    handlePartyCommand(command) {
        switch (command.action) {
            case 'play':
                this.iframe.contentWindow.postMessage({
                    command: 'play'
                }, '*');
                break;
            case 'pause':
                this.iframe.contentWindow.postMessage({
                    command: 'pause'
                }, '*');
                break;
            case 'seek':
                this.iframe.contentWindow.postMessage({
                    command: 'seek',
                    time: command.time
                }, '*');
                break;
        }
    }

    broadcastToParty(command) {
        // Your party synchronization logic here
        // (WebSocket, Socket.IO, etc.)
    }

    onPlayerStatusUpdate(status) {
        // Your status update logic here
    }

    setupEventListeners() {
        // Listen for player events
        window.addEventListener('message', (event) => {
            if (!this.vidfastOrigins.includes(event.origin) || !event.data) {
                return;
            }

            if (event.data.type === 'PLAYER_EVENT') {
                const {
                    event: playerEvent,
                    currentTime
                } = event.data.data;

                switch (playerEvent) {
                    case 'play':
                        this.syncPlay(currentTime);
                        break;
                    case 'pause':
                        this.syncPause(currentTime);
                        break;
                    case 'seeked':
                        this.syncSeek(currentTime);
                        break;
                }
            }

            if (event.data.type === 'PLAYER_EVENT' && event.data.data.event === 'playerstatus') {
                this.onPlayerStatusUpdate(event.data.data);
            }
        });
    }
}

// Usage
const iframe = document.querySelector('#vidfast-player');
const watchParty = new WatchPartyController(iframe);
⚠️ Important Notes
• PostMessage commands work across all VidFast domains
• Commands are processed asynchronously - status responses may have a small delay
• For watch parties, implement proper synchronization logic to handle network latency
• Always handle message events to receive player status updates
• Seek commands accept time in seconds (integer values)