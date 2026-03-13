VidFast Embed API — Complete Developer Documentation

VidFast provides embeddable video players for movies and TV shows that can be integrated into any website using an iframe. The player supports customization, events, progress tracking, and programmatic control via the PostMessage API.

Supported Embed Domains

You can use any of the following domains when generating embed URLs:

vidfast.pro

vidfast.in

vidfast.io

vidfast.me

vidfast.net

vidfast.pm

vidfast.xyz

If one domain becomes unavailable, simply switch to another.

Endpoints
Movie Embed
Endpoint
https://vidfast.pro/movie/{id}
Required Parameter
Parameter	Description
id	Movie identifier from IMDb or TMDB
Example
https://vidfast.pro/movie/tt6263850
TV Show Embed
Endpoint
https://vidfast.pro/tv/{id}/{season}/{episode}
Required Parameters
Parameter	Description
id	TV show identifier from IMDb or TMDB
season	Season number
episode	Episode number
Example
https://vidfast.pro/tv/tt4052886/1/5
Player Parameters

Optional parameters allow customization of the player.

Parameter	Description
title	Show or hide media title
poster	Show or hide poster image
autoPlay	Start playback automatically
startAt	Start playback at a specific time (seconds)
theme	Player color theme (hex code without #)
server	Default streaming server
hideServer	Hide server selector button
fullscreenButton	Show or hide fullscreen button
chromecast	Show or hide Chromecast button
sub	Default subtitle language

TV-specific parameters:

Parameter	Description
nextButton	Show "Next Episode" button when 90% watched
autoNext	Automatically play next episode
Basic Implementation

The simplest way to embed the player is using an iframe.

<iframe 
  src="https://vidfast.pro/movie/533535" 
  width="100%" 
  height="100%" 
  frameborder="0" 
  allowfullscreen 
  allow="encrypted-media"
></iframe>
Attribute Explanation
Attribute	Purpose
src	Player URL
width	Player width
height	Player height
frameborder	Removes iframe border
allowfullscreen	Enables fullscreen
allow="encrypted-media"	Allows DRM media playback
Responsive Implementation

To maintain a 16:9 aspect ratio, wrap the iframe in a container.

<div style="position: relative; padding-bottom: 56.25%; height: 0;">
  <iframe
    src="https://vidfast.pro/movie/533535"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
    frameborder="0"
    allowfullscreen
    allow="encrypted-media"
  ></iframe>
</div>

The 56.25% padding ensures the container maintains a 16:9 video ratio.

Responsive Implementation (React + Tailwind)

For React applications using Tailwind CSS:

function MoviePlayer({ id }) {
  return (
    <div className="relative w-full pt-[56.25%]">
      <iframe
        src={`https://vidfast.pro/movie/${id}`}
        className="absolute top-0 left-0 w-full h-full"
        frameBorder="0"
        allowFullScreen
        allow="encrypted-media"
      />
    </div>
  );
}

Usage:

<MoviePlayer id="533535" />
Color Themes

Customize the player UI color using the theme parameter.

Syntax
?theme=HEXCOLOR
Examples

Green theme

<iframe src="https://vidfast.pro/movie/533535?theme=16A085"></iframe>

Blue theme

<iframe src="https://vidfast.pro/movie/533535?theme=2980B9"></iframe>

Purple theme

<iframe src="https://vidfast.pro/movie/533535?theme=9B59B6"></iframe>

You can use any hex color.

Example:

https://vidfast.pro/movie/533535?theme=E50914
Advanced Feature Example

Multiple parameters can be combined.

<iframe
  src="https://vidfast.pro/tv/tt4052886/1/5?autoPlay=true&title=true&poster=true&theme=16A085&nextButton=true&autoNext=true"
  width="100%"
  height="100%"
  frameborder="0"
  allowfullscreen
  allow="encrypted-media"
></iframe>
Feature Compatibility
Feature	Movies	TV Shows
Color Themes	✓	✓
AutoPlay	✓	✓
Start Time	✓	✓
Poster Display	✓	✓
Next Episode	✗	✓
Auto Next	✗	✓
Events & Progress Tracking

The player sends playback events to the parent page using the PostMessage API.

These events allow developers to track user progress and create features like Continue Watching.

Available Events
Event	Description
play	Video started
pause	Video paused
seeked	User jumped to another timestamp
ended	Playback finished
timeupdate	Sent periodically during playback
playerstatus	Returned when requesting player status
Event Data Structure

Example event message:

{
  "type": "PLAYER_EVENT",
  "data": {
    "event": "play",
    "currentTime": 120,
    "duration": 5400,
    "tmdbId": 533535,
    "mediaType": "movie",
    "playing": true,
    "muted": false,
    "volume": 1
  }
}
Event Listener Example
const vidfastOrigins = [
  "https://vidfast.pro",
  "https://vidfast.in",
  "https://vidfast.io",
  "https://vidfast.me",
  "https://vidfast.net",
  "https://vidfast.pm",
  "https://vidfast.xyz"
];

window.addEventListener("message", ({ origin, data }) => {
  if (!vidfastOrigins.includes(origin) || !data) return;

  if (data.type === "PLAYER_EVENT") {
    const { event, currentTime, duration } = data.data;

    console.log(`Player ${event} at ${currentTime}s of ${duration}s`);
  }
});
Progress Tracking Example

VidFast can send full media progress data.

window.addEventListener("message", ({ origin, data }) => {
  if (!vidfastOrigins.includes(origin) || !data) return;

  if (data.type === "MEDIA_DATA") {
    localStorage.setItem("vidFastProgress", JSON.stringify(data.data));
  }
});
Stored Progress Structure Example

Example saved data:

{
  "m533535": {
    "id": 533535,
    "type": "movie",
    "title": "Deadpool & Wolverine",
    "progress": {
      "watched": 353.53,
      "duration": 7667.22
    }
  }
}
PostMessage API — Player Control

The player can also receive commands from the parent page.

General command format:

iframe.contentWindow.postMessage({
  command: "COMMAND_NAME"
}, "*");
Play
iframe.contentWindow.postMessage({
  command: "play"
}, "*");
Pause
iframe.contentWindow.postMessage({
  command: "pause"
}, "*");
Seek
iframe.contentWindow.postMessage({
  command: "seek",
  time: 120
}, "*");
Volume
iframe.contentWindow.postMessage({
  command: "volume",
  level: 0.5
}, "*");
Mute
iframe.contentWindow.postMessage({
  command: "mute",
  muted: true
}, "*");
Get Player Status
iframe.contentWindow.postMessage({
  command: "getStatus"
}, "*");

Example listener:

window.addEventListener("message", ({ data }) => {
  if (data.type === "PLAYER_EVENT" && data.data.event === "playerstatus") {
    console.log(data.data);
  }
});
Watch Party Integration Example

The PostMessage API enables synchronized playback across multiple users.

Typical architecture:

User action
      ↓
Frontend player command
      ↓
Server broadcast (WebSocket)
      ↓
Other clients receive command
      ↓
Players update playback state

Example controller structure:

WatchPartyController
   ├── syncPlay()
   ├── syncPause()
   ├── syncSeek()
   └── broadcastToParty()

This allows real-time synchronization across multiple viewers.

Important Notes

• PostMessage commands work across all VidFast domains
• Commands are processed asynchronously
• Always verify message origins for security
• Seek times are provided in seconds
• Watch party implementations should handle network latency

Recommended Integration Architecture

Typical streaming website architecture:

Frontend (React / Next.js)
        │
        │ iframe embed
        ▼
VidFast Player
        │
        │ postMessage events
        ▼
Frontend Event Handler
        │
        ├── Save progress (localStorage / backend)
        ├── Analytics
        └── Watch party synchronization