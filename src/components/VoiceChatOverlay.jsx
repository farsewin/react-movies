import React from 'react';

/**
 * VoiceChatOverlay — Discord-style voice chat UI.
 *
 * - Mute/unmute mic button always visible (small, bottom-left)
 * - Speaker avatars ONLY appear when someone is actively talking
 * - Animated ring pulse on active speakers
 */
const VoiceChatOverlay = ({
  isConnected,
  isMuted,
  toggleMute,
  speakingParticipants, // Set<identity>
  participants,          // [{ identity, name, isLocal }]
  showControls,
}) => {
  if (!isConnected) return null;

  // Initials helper
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Only show participants who are currently speaking (excludes local mic, which they can hear themselves)
  const activeSpeakers = participants.filter(
    (p) => speakingParticipants.has(p.identity)
  );

  return (
    <>
      {/* === Speaking Avatars (only render when someone is talking) === */}
      {activeSpeakers.length > 0 && (
        <div
          className="absolute bottom-[7.5rem] left-6 z-[65] flex flex-col-reverse gap-2 pointer-events-none"
          style={{ maxHeight: '12rem', overflowY: 'hidden' }}
        >
          {activeSpeakers.map((p) => (
            <div
              key={p.identity}
              className="flex items-center gap-2 animate-fade-in"
            >
              {/* Pulsing ring avatar */}
              <div className="relative flex-shrink-0">
                {/* Outer pulse ring */}
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{
                    background: 'rgba(99,102,241,0.45)',
                    animationDuration: '1s',
                  }}
                />
                {/* Avatar circle */}
                <div
                  className="relative size-9 rounded-full flex items-center justify-center text-white font-black text-[11px] border-2 border-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.7)]"
                  style={{
                    background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                  }}
                >
                  {getInitials(p.name)}
                </div>
              </div>
              {/* Name tag */}
              <span
                className="text-[10px] font-black uppercase tracking-widest text-white bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/10"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
              >
                {p.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* === Mute / Unmute Button (always visible, bottom-left, above sync badge) === */}
      <div
        className={`absolute bottom-[5.5rem] left-6 z-[65] pointer-events-auto transition-all duration-500 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        <button
          onClick={toggleMute}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`relative flex items-center justify-center size-9 rounded-full border transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg ${
            isMuted
              ? 'bg-black/50 backdrop-blur-sm border-white/20 text-white/50 hover:text-white hover:border-white/40'
              : 'bg-indigo-600/90 backdrop-blur-sm border-indigo-400/50 text-white shadow-[0_0_14px_rgba(99,102,241,0.5)]'
          }`}
        >
          {isMuted ? (
            /* Muted mic icon */
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
              {/* Diagonal slash — muted */}
              <line x1="4" y1="4" x2="20" y2="20" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            /* Active mic icon */
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}

          {/* Live dot when unmuted */}
          {!isMuted && (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 bg-emerald-400 rounded-full border-2 border-black animate-pulse" />
          )}
        </button>
      </div>
    </>
  );
};

export default VoiceChatOverlay;
