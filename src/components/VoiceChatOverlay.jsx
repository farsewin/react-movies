import PropTypes from "prop-types";

/**
 * VoiceChatOverlay — Discord-style voice chat UI.
 *
 * - Mute/unmute mic button always visible (small, bottom-left)
 * - Speaker avatars ONLY appear when someone is actively talking
 * - Animated ring pulse on active speakers
 */
const VoiceChatOverlay = ({
  isConnected,
  speakingParticipants, // Set<identity>
  participants, // [{ identity, name, isLocal }]
}) => {
  if (!isConnected) return null;

  // Initials helper
  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Only show participants who are currently speaking (excludes local mic, which they can hear themselves)
  const activeSpeakers = participants.filter((p) =>
    speakingParticipants.has(p.identity),
  );

  return (
    <>
      {/* === Speaking Avatars (only render when someone is talking) === */}
      {activeSpeakers.length > 0 && (
        <div
          className="absolute bottom-[7.5rem] left-6 z-[65] flex flex-col-reverse gap-2 pointer-events-none"
          style={{ maxHeight: "12rem", overflowY: "hidden" }}
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
                    background: "rgba(99,102,241,0.45)",
                    animationDuration: "1s",
                  }}
                />
                {/* Avatar circle */}
                <div
                  className="relative size-9 rounded-full flex items-center justify-center text-white font-black text-[11px] border-2 border-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.7)]"
                  style={{
                    background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
                  }}
                >
                  {getInitials(p.name)}
                </div>
              </div>
              {/* Name tag */}
              <span
                className="text-[10px] font-black uppercase tracking-widest text-white bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/10"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
              >
                {p.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

VoiceChatOverlay.propTypes = {
  isConnected: PropTypes.bool,
  speakingParticipants: PropTypes.shape({
    has: PropTypes.func.isRequired,
  }).isRequired,
  participants: PropTypes.arrayOf(
    PropTypes.shape({
      identity: PropTypes.string,
      name: PropTypes.string,
      isLocal: PropTypes.bool,
    }),
  ).isRequired,
};

export default VoiceChatOverlay;
