import type { CSSProperties } from "react";

type Phase =
  | "connecting"
  | "connected"
  | "searching"
  | "found"
  | "joining"
  | "ready"
  | "error";

interface Props {
  phase: Phase;
  elapsed: number;
}

export default function MatchmakingLoader({ phase, elapsed }: Props) {
  const isFound = phase === "found" || phase === "ready";
  const isJoining = phase === "joining";
  const isError = phase === "error";
  const isSearching = phase === "searching";
  const isConnecting = phase === "connecting" || phase === "connected";

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const accentColor = isError
    ? "#ef4444"
    : isFound || isJoining
      ? "#14b8a6"
      : "#f97316";

  return (
    <div className="mm-loader-root">
      <style>{`
        @keyframes mmRipple {
          0%   { transform: scale(0.85); opacity: 0.6; }
          100% { transform: scale(2.2);  opacity: 0; }
        }
        @keyframes mmOrbit        { to { transform: rotate(360deg); } }
        @keyframes mmOrbitReverse { to { transform: rotate(-360deg); } }
        @keyframes mmPulseCore {
          0%, 100% { transform: translate(-50%,-50%) scale(1);    opacity: 1; }
          50%       { transform: translate(-50%,-50%) scale(0.86); opacity: 0.65; }
        }
        @keyframes mmLockIn {
          0%   { transform: translate(-50%,-50%) scale(0.4);  opacity: 0; }
          65%  { transform: translate(-50%,-50%) scale(1.18); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(1);    opacity: 1; }
        }
        @keyframes mmShake {
          0%,100% { transform: translate(-50%,-50%) translateX(0); }
          20%     { transform: translate(-50%,-50%) translateX(-7px); }
          40%     { transform: translate(-50%,-50%) translateX(7px); }
          60%     { transform: translate(-50%,-50%) translateX(-4px); }
          80%     { transform: translate(-50%,-50%) translateX(4px); }
        }
        @keyframes mmSpin { to { transform: rotate(360deg); } }
        @keyframes mmDotPulse {
          0%,100% { opacity: 1;    transform: scale(1); }
          50%      { opacity: 0.3; transform: scale(0.6); }
        }
        @keyframes mmMatchGlow {
          0%,100% { box-shadow: 0 0 0 0    rgba(20,184,166,0.4); }
          50%      { box-shadow: 0 0 0 14px rgba(20,184,166,0); }
        }
        @keyframes mmCheckDraw { to { stroke-dashoffset: 0; } }
        @keyframes mmRingPop {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes mmConnectedFlash {
          0%,100% { box-shadow: 0 0 0 0    rgba(249,115,22,0.55); }
          50%      { box-shadow: 0 0 0 10px rgba(249,115,22,0); }
        }
        @keyframes mmSpinIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }

        .mm-loader-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }

        /* Arena */
        .mm-arena {
          position: relative;
          width: 140px;
          height: 140px;
          flex-shrink: 0;
        }

        .mm-ripple {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1.5px solid var(--acc);
          animation: mmRipple 2.4s ease-out infinite;
        }
        .mm-ripple:nth-child(2) { animation-delay: 0.8s; }
        .mm-ripple:nth-child(3) { animation-delay: 1.6s; }

        .mm-track {
          position: absolute;
          border-radius: 50%;
          border: 1px solid var(--acc);
          opacity: 0.12;
        }
        .mm-track-outer { inset: 8px;  animation: mmOrbit 14s linear infinite; }
        .mm-track-inner { inset: 28px; animation: mmOrbitReverse 9s linear infinite; }

        .mm-orb {
          position: absolute;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--acc);
          opacity: 0.75;
        }
        .mm-orb-outer { top: 8px;    left: 50%; transform: translateX(-50%); }
        .mm-orb-inner { bottom: 28px; left: 50%; transform: translateX(-50%); }

        .mm-spinner {
          position: absolute;
          inset: 18px;
          border-radius: 50%;
          border: 1.5px solid transparent;
          border-top-color: var(--acc);
          border-right-color: color-mix(in srgb, var(--acc) 35%, transparent);
          animation: mmSpin 0.9s linear infinite, mmSpinIn 0.3s ease-out;
        }

        .mm-found-ring {
          position: absolute;
          inset: 14px;
          border-radius: 50%;
          border: 2px solid var(--acc);
          opacity: 0.55;
          animation: mmRingPop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .mm-found-ring-inner {
          position: absolute;
          inset: 30px;
          border-radius: 50%;
          border: 1.5px solid var(--acc);
          opacity: 0.3;
          animation: mmRingPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.07s both;
        }

        .mm-core {
          position: absolute;
          top: 50%; left: 50%;
          border-radius: 50%;
          background: var(--acc);
        }
        .mm-core-idle {
          width: 14px; height: 14px;
          animation: mmPulseCore 1.8s ease-in-out infinite;
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--acc) 18%, transparent);
        }
        .mm-core-flash {
          width: 14px; height: 14px;
          animation: mmConnectedFlash 0.7s ease-in-out 2;
        }
        .mm-core-found {
          width: 22px; height: 22px;
          animation: mmLockIn 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards,
                     mmMatchGlow 2s ease-in-out 0.5s infinite;
        }
        .mm-core-error {
          width: 14px; height: 14px;
          background: #ef4444 !important;
          animation: mmShake 0.55s ease-in-out forwards;
        }

        .mm-icon {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%,-50%);
          display: flex; align-items: center; justify-content: center;
        }

        /* Chip */
        .mm-chip {
          margin-top: 18px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          transition: color 0.35s;
          min-height: 16px;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .mm-dots { display: inline-flex; gap: 4px; margin-left: 1px; }
        .mm-dot {
          width: 4px; height: 4px;
          border-radius: 50%;
          background: currentColor;
          animation: mmDotPulse 1.2s ease-in-out infinite;
        }
        .mm-dot:nth-child(2) { animation-delay: 0.2s; }
        .mm-dot:nth-child(3) { animation-delay: 0.4s; }

        /* Timer pill */
        .mm-timer-pill {
          margin-top: 16px;
          display: flex;
          align-items: center;
          gap: 7px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 100px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.05em;
          color: rgba(255,255,255,0.38);
          transition: border-color 0.5s, color 0.5s;
        }
        .mm-timer-pill.mm-teal {
          border-color: rgba(20,184,166,0.28);
          color: rgba(20,184,166,0.85);
        }
        .mm-timer-blinker {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--acc);
          animation: mmDotPulse 0.9s ease-in-out infinite;
          flex-shrink: 0;
        }

        /* (phase log removed) */
      `}</style>

      {/* ── Arena ── */}
      <div className="mm-arena" style={{ ["--acc" as string]: accentColor }}>
        {/* Ripple rings — searching / joining */}
        {(isSearching || isJoining) && (
          <>
            <div className="mm-ripple" />
            <div className="mm-ripple" />
            <div className="mm-ripple" />
          </>
        )}

        {/* Orbit tracks — searching only */}
        {isSearching && (
          <>
            <div className="mm-track mm-track-outer">
              <div className="mm-orb mm-orb-outer" />
            </div>
            <div className="mm-track mm-track-inner">
              <div className="mm-orb mm-orb-inner" />
            </div>
          </>
        )}

        {/* Spinner arc — connecting / connected */}
        {isConnecting && <div className="mm-spinner" />}

        {/* Static rings — found / ready / error */}
        {(isFound || isError) && (
          <>
            <div
              className="mm-found-ring"
              style={
                isError ? { borderColor: "#ef4444", opacity: 0.4 } : undefined
              }
            />
            <div
              className="mm-found-ring-inner"
              style={
                isError ? { borderColor: "#ef4444", opacity: 0.25 } : undefined
              }
            />
          </>
        )}

        {/* Core */}
        {isConnecting && (
          <div
            className={`mm-core ${phase === "connected" ? "mm-core-flash" : "mm-core-idle"}`}
          />
        )}
        {isSearching && <div className="mm-core mm-core-idle" />}
        {isJoining && (
          <div
            className="mm-core mm-core-idle"
            style={{ ["--acc" as string]: "#14b8a6" } as CSSProperties}
          />
        )}
        {isFound && <div className="mm-core mm-core-found" />}
        {isError && <div className="mm-core mm-core-error" />}

        {/* Checkmark */}
        {phase === "ready" && (
          <div className="mm-icon">
            <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
              <path
                d="M1 5L4.5 8.5L11 1"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="18"
                strokeDashoffset="18"
                style={{
                  animation: "mmCheckDraw 0.35s ease-out 0.15s forwards",
                }}
              />
            </svg>
          </div>
        )}

        {/* X mark */}
        {isError && (
          <div className="mm-icon">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>

      {/* ── Status chip ── */}
      <div
        className="mm-chip"
        style={
          {
            ["--acc" as string]: accentColor,
            color: accentColor,
          } as CSSProperties
        }
      >
        {phase === "connecting" && (
          <>
            Connecting
            <span className="mm-dots">
              <span className="mm-dot" />
              <span className="mm-dot" />
              <span className="mm-dot" />
            </span>
          </>
        )}
        {phase === "connected" && "Connected — entering queue"}
        {phase === "searching" && (
          <>
            Scanning
            <span className="mm-dots">
              <span className="mm-dot" />
              <span className="mm-dot" />
              <span className="mm-dot" />
            </span>
          </>
        )}
        {phase === "found" && "Opponent located"}
        {phase === "joining" && (
          <>
            Handshaking
            <span className="mm-dots">
              <span className="mm-dot" />
              <span className="mm-dot" />
              <span className="mm-dot" />
            </span>
          </>
        )}
        {phase === "ready" && "Match confirmed"}
        {phase === "error" && "Connection lost"}
      </div>

      {/* ── Realtime elapsed timer ── */}
      {!isError && phase !== "ready" && (
        <div
          className={`mm-timer-pill ${isFound || isJoining ? "mm-teal" : ""}`}
          style={{ ["--acc" as string]: accentColor } as CSSProperties}
        >
          <div className="mm-timer-blinker" />
          {fmt(elapsed)}
        </div>
      )}

      {/* timing shown inside opponent card in MatchmakingScreen */}
    </div>
  );
}
