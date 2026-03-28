import { useEffect, useRef, useState } from "react";
import { connect, disconnect, getSocket } from "../../services/nakamaClient";
import MatchmakingLoader from "./MatchmakingLoader";

// "connected" is an internal UI-only phase: socket is ready but we hold briefly
// before entering the queue, so the user sees it transition rather than snap.
type Phase =
  | "connecting"
  | "connected"
  | "searching"
  | "found"
  | "joining"
  | "ready"
  | "error";

interface MatchInfo {
  matchId: string;
  opponentName: string;
  opponentId: string;
  iAmCreator: boolean;
}

interface Props {
  onMatchFound: (matchId: string, opponentName: string, iAmX: boolean) => void;
  onCancel: () => void;
}

const CONNECTED_LINGER_MS = 2200; // After socket opens, wait before joining queue
const FOUND_LINGER_MS = 3000; // After opponent detected, wait before joinMatch

//  Logging helpers
const ts = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (m: string, d?: unknown) =>
    console.log(`%c[MM ${ts()}] ${m}`, "color:#22c55e", d ?? ""),
  warn: (m: string, d?: unknown) =>
    console.warn(`%c[MM ${ts()}] ${m}`, "color:#f59e0b", d ?? ""),
  error: (m: string, d?: unknown) =>
    console.error(`%c[MM ${ts()}] ${m}`, "color:#ef4444", d ?? ""),
};

//  Formats search duration for the opponent card
const fmtDuration = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

export default function MatchmakingScreen({ onMatchFound, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [elapsed, setElapsed] = useState(0);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);

  // Refs so async callbacks always read fresh values without stale closures
  const ticketRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const joinedRef = useRef(false);

  // Timestamp when searching phase began — to measure how long it took to find
  const searchStartRef = useRef<number>(0);
  // Track the current phase in a ref so async callbacks always read latest
  const phaseRef = useRef<Phase>("connecting");

  //  Global elapsed timer
  useEffect(() => {
    const id = setInterval(() => {
      if (!cancelledRef.current) setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  //  Phase transition helper
  const transition = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  //  Main matchmaking flow
  useEffect(() => {
    cancelledRef.current = false;
    joinedRef.current = false;
    ticketRef.current = null;
    phaseRef.current = "connecting";
    searchStartRef.current = 0;

    setPhase("connecting");
    setSearchDurationMs(null);
    setElapsed(0);
    setMatchInfo(null);

    let alive = true;
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    log.info(`[${id}] start`);

    const run = async () => {
      try {
        //  1. Connect
        const result = await connect();
        if (!alive) return;

        //  2. Linger on "connected" so the user sees the state
        transition("connected");
        await new Promise<void>((res) => setTimeout(res, CONNECTED_LINGER_MS));
        if (!alive) return;

        //  3. Enter matchmaking queue
        searchStartRef.current = Date.now();
        transition("searching");

        result.socket.onmatchmakermatched = async (matched) => {
          if (!alive || joinedRef.current) return;
          joinedRef.current = true;

          //  4. Opponent found — record how long search took, linger
          const dur = Date.now() - searchStartRef.current;
          setSearchDurationMs(dur);
          transition("found");
          log.info(`[${id}] match found in ${dur}ms`);

          const myId =
            matched.self?.presence?.user_id ?? result.session.user_id!;

          const opponent = matched.users.find(
            (u) => u.presence.user_id !== myId,
          );

          if (!opponent) {
            transition("error");
            return;
          }

          const opponentName =
            opponent.presence.username ??
            `P_${opponent.presence.user_id.slice(0, 4)}`;

          const iAmCreator = myId < opponent.presence.user_id;

          setMatchInfo({
            matchId: matched.match_id,
            opponentName,
            opponentId: opponent.presence.user_id,
            iAmCreator,
          });

          // Hold on "found" so the user can see the opponent card appear
          await new Promise<void>((res) => setTimeout(res, FOUND_LINGER_MS));
          if (!alive) return;

          //  5. Join match
          transition("joining");

          const match = await result.socket.joinMatch(matched.match_id);
          if (!alive) return;

          setMatchInfo({
            matchId: match.match_id,
            opponentName,
            opponentId: opponent.presence.user_id,
            iAmCreator,
          });

          //  6. Ready
          transition("ready");

          setTimeout(() => {
            onMatchFound(match.match_id, opponentName, iAmCreator);
          }, 500);
        };

        const ticket = await result.socket.addMatchmaker("*", 2, 2);
        if (!alive) return;

        ticketRef.current = ticket.ticket;
      } catch (e) {
        if (!alive) return;
        log.error(`[${id}] error`, e);
        transition("error");
      }
    };

    run();

    return () => {
      alive = false;
      cancelledRef.current = true;

      const ticket = ticketRef.current;
      ticketRef.current = null;

      if (ticket && !joinedRef.current) {
        try {
          getSocket().removeMatchmaker(ticket);
        } catch {
          // ignore
        }
      }

      try {
        getSocket().onmatchmakermatched = () => {};
      } catch {
        // ignore
      }

      if (!joinedRef.current) disconnect();
    };
  }, [onMatchFound]);

  //  Cancel
  const handleCancel = () => {
    cancelledRef.current = true;
    joinedRef.current = true;

    const ticket = ticketRef.current;
    ticketRef.current = null;

    if (ticket) {
      try {
        getSocket().removeMatchmaker(ticket);
      } catch {
        // ignore
      }
    }

    try {
      getSocket().onmatchmakermatched = () => {};
    } catch {
      // ignore
    }

    disconnect();
    onCancel();
  };

  //  Derived state
  const isSearching = phase === "searching" || phase === "joining";
  const isFound = phase === "found" || phase === "ready";
  const isError = phase === "error";

  return (
    <>
      <style>{`
        @keyframes mmScreenFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes mmGridPulse {
          0%, 100% { opacity: 0.04; }
          50%       { opacity: 0.075; }
        }
        @keyframes mmBarLoop {
          0%   { transform: scaleX(0) translateX(0); }
          40%  { transform: scaleX(0.6) translateX(0); }
          60%  { transform: scaleX(0.6) translateX(100%); }
          100% { transform: scaleX(0) translateX(200%); }
        }
        @keyframes mmOpponentIn {
          from { opacity: 0; transform: translateY(10px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes mmFadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .mm-screen {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 100dvh;
          background: #0a0a0f;
          color: #e8e8f0;
          font-family: 'Inter', 'SF Pro Display', system-ui, sans-serif;
          overflow: hidden;
          animation: mmScreenFadeIn 0.3s ease-out;
        }

        .mm-bg-gradient {
          position: absolute;
          inset: 0;
          pointer-events: none;
          transition: background 0.8s ease;
        }
        .mm-bg-searching {
          background:
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(249,115,22,0.07) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 20%, rgba(20,184,166,0.05) 0%, transparent 55%);
        }
        .mm-bg-found {
          background:
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(20,184,166,0.08) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 20%, rgba(20,184,166,0.06) 0%, transparent 55%);
        }
        .mm-bg-error {
          background:
            radial-gradient(ellipse 80% 60% at 50% 80%, rgba(239,68,68,0.07) 0%, transparent 60%);
        }

        .mm-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 44px 44px;
          animation: mmGridPulse 4s ease-in-out infinite;
        }

        /*  Topbar  */
        .mm-topbar {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .mm-back-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.55);
          font-size: 13px;
          font-weight: 500;
          padding: 7px 12px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
          letter-spacing: 0.01em;
        }
        .mm-back-btn:hover {
          border-color: rgba(255,255,255,0.22);
          color: rgba(255,255,255,0.8);
        }
        .mm-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .mm-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          transition: background 0.4s, box-shadow 0.4s;
        }
        .mm-badge-dot-queue  { background: #f97316; box-shadow: 0 0 0 2px rgba(249,115,22,0.28); }
        .mm-badge-dot-found  { background: #14b8a6; box-shadow: 0 0 0 2px rgba(20,184,166,0.28); }
        .mm-badge-dot-error  { background: #ef4444; }
        .mm-region {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.22);
        }

        /*  Body  */
        .mm-body {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0 24px 24px;
        }

        .mm-title {
          margin-top: 26px;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #f0f0f8;
          text-align: center;
          transition: color 0.3s;
        }
        .mm-title-error { color: #ef4444; }
        .mm-subtitle {
          margin-top: 8px;
          font-size: 14px;
          color: rgba(255,255,255,0.36);
          text-align: center;
          letter-spacing: 0.01em;
          min-height: 22px;
        }

        /*  Scan bar  */
        .mm-scan-track {
          margin-top: 28px;
          width: 100%;
          max-width: 220px;
          height: 2px;
          background: rgba(255,255,255,0.07);
          border-radius: 2px;
          overflow: hidden;
        }
        .mm-scan-bar {
          height: 100%;
          width: 40%;
          transform-origin: left;
          animation: mmBarLoop 1.8s ease-in-out infinite;
          transition: background 0.4s;
        }

        /*  Opponent card  */
        .mm-opponent-card {
          margin-top: 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(20,184,166,0.08);
          border: 1px solid rgba(20,184,166,0.22);
          border-radius: 14px;
          padding: 14px 18px;
          animation: mmOpponentIn 0.38s cubic-bezier(0.34,1.56,0.64,1);
          min-width: 218px;
        }
        .mm-avatar {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: rgba(20,184,166,0.18);
          border: 1px solid rgba(20,184,166,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          color: #14b8a6;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .mm-opp-name  { font-size: 15px; font-weight: 600; color: #e8e8f0; letter-spacing: -0.01em; }
        .mm-opp-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #14b8a6; margin-top: 3px; }
        .mm-opp-side  { font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.3); margin-top: 2px; }

        /*  Error hint  */
        .mm-error-hint {
          margin-top: 14px;
          font-size: 13px;
          color: rgba(255,255,255,0.28);
          text-align: center;
          max-width: 240px;
          line-height: 1.55;
          animation: mmFadeSlideIn 0.3s ease-out;
        }

        /*  Footer  */
        .mm-footer {
          position: relative;
          z-index: 2;
          padding: 0 20px 36px;
        }
        .mm-cancel-btn {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          border: none;
          transition: background 0.2s, color 0.2s, transform 0.1s;
        }
        .mm-cancel-btn:active { transform: scale(0.98); }
        .mm-btn-queue {
          background: rgba(255,255,255,0.055);
          color: rgba(255,255,255,0.45);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .mm-btn-queue:hover {
          background: rgba(255,255,255,0.09);
          color: rgba(255,255,255,0.65);
        }
        .mm-btn-error {
          background: rgba(249,115,22,0.12);
          color: #f97316;
          border: 1px solid rgba(249,115,22,0.2);
        }
        .mm-btn-error:hover { background: rgba(249,115,22,0.18); }

        .mm-opp-found-time {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: rgba(20,184,166,0.65);
          margin-top: 5px;
        }
      `}</style>

      <div className="mm-screen">
        {/* Background */}
        <div
          className={`mm-bg-gradient ${
            isError
              ? "mm-bg-error"
              : isFound
                ? "mm-bg-found"
                : "mm-bg-searching"
          }`}
        />
        <div className="mm-grid" />

        {/*  Topbar  */}
        <header className="mm-topbar">
          <button className="mm-back-btn" onClick={handleCancel}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M9 2L4 7L9 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </button>

          <div className="mm-badge">
            <div
              className={`mm-badge-dot ${
                isError
                  ? "mm-badge-dot-error"
                  : isFound
                    ? "mm-badge-dot-found"
                    : "mm-badge-dot-queue"
              }`}
            />
            <span
              style={{
                color: isError ? "#ef4444" : isFound ? "#14b8a6" : "#f97316",
                transition: "color 0.4s",
              }}
            >
              {isError ? "Error" : isFound ? "Matched" : "Global Queue"}
            </span>
          </div>

          <span className="mm-region">Auto</span>
        </header>

        {/*  Body  */}
        <main className="mm-body">
          {/* Loader (arena + chip + timer + phase log) */}
          <MatchmakingLoader phase={phase} elapsed={elapsed} />

          {/* Title */}
          <h2 className={`mm-title ${isError ? "mm-title-error" : ""}`}>
            {phase === "connecting" && "Connecting..."}
            {phase === "connected" && "Connected"}
            {phase === "searching" && "Finding opponent"}
            {phase === "found" && "Opponent found!"}
            {phase === "joining" && "Joining match..."}
            {phase === "ready" && "Ready to play"}
            {phase === "error" && "Connection failed"}
          </h2>

          <p className="mm-subtitle">
            {phase === "connecting" && "Establishing secure connection"}
            {phase === "connected" && "Entering matchmaking queue"}
            {phase === "searching" && "Scanning global matchmaking pool"}
            {phase === "found" && "Locking in your opponent"}
            {phase === "joining" && "Syncing match state"}
            {phase === "ready" && "Starting match..."}
            {phase === "error" && "Could not reach the server"}
          </p>

          {/* Scan bar — while actively searching / joining */}
          {isSearching && (
            <div className="mm-scan-track">
              <div
                className="mm-scan-bar"
                style={{
                  background:
                    phase === "joining"
                      ? "linear-gradient(90deg, transparent, #14b8a6, transparent)"
                      : "linear-gradient(90deg, transparent, #f97316, transparent)",
                }}
              />
            </div>
          )}

          {/* Opponent card */}
          {(isFound || phase === "joining") && matchInfo && (
            <div className="mm-opponent-card">
              <div className="mm-avatar">
                {matchInfo.opponentName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="mm-opp-name">{matchInfo.opponentName}</div>
                <div className="mm-opp-label">
                  Playing as {matchInfo.iAmCreator ? "O" : "X"}
                </div>
                {searchDurationMs !== null && (
                  <div className="mm-opp-found-time">
                    Found in {fmtDuration(searchDurationMs)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error hint */}
          {isError && (
            <p className="mm-error-hint">
              Could not reach the matchmaking server.
              <br />
              Check your connection and try again.
            </p>
          )}
        </main>

        {/*  Footer  */}
        <footer className="mm-footer">
          <button
            className={`mm-cancel-btn ${isError ? "mm-btn-error" : "mm-btn-queue"}`}
            onClick={handleCancel}
          >
            {isError ? "Go back" : isFound ? "Cancel" : "Cancel search"}
          </button>
        </footer>
      </div>
    </>
  );
}
