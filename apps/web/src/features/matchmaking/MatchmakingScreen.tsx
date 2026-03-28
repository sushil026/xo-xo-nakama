import { useEffect, useRef, useState } from "react";
import { connect, disconnect, getSocket } from "../../services/nakamaClient";
import MatchmakingLoader from "./MatchmakingLoader";

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

const CONNECTED_LINGER_MS = 2200;
const FOUND_LINGER_MS = 3000;

const ts = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (m: string, d?: unknown) =>
    console.log(`%c[MM ${ts()}] ${m}`, "color:#22c55e", d ?? ""),
  warn: (m: string, d?: unknown) =>
    console.warn(`%c[MM ${ts()}] ${m}`, "color:#f59e0b", d ?? ""),
  error: (m: string, d?: unknown) =>
    console.error(`%c[MM ${ts()}] ${m}`, "color:#ef4444", d ?? ""),
};

const fmtDuration = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

export default function MatchmakingScreen({ onMatchFound, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [elapsed, setElapsed] = useState(0);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);

  const ticketRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const joinedRef = useRef(false);
  const searchStartRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("connecting");

  useEffect(() => {
    const id = setInterval(() => {
      if (!cancelledRef.current) setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const transition = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

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
        const result = await connect();
        if (!alive) return;

        transition("connected");
        await new Promise<void>((res) => setTimeout(res, CONNECTED_LINGER_MS));
        if (!alive) return;

        searchStartRef.current = Date.now();
        transition("searching");

        result.socket.onmatchmakermatched = async (matched) => {
          if (!alive || joinedRef.current) return;
          joinedRef.current = true;

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

          await new Promise<void>((res) => setTimeout(res, FOUND_LINGER_MS));
          if (!alive) return;

          transition("joining");

          const match = await result.socket.joinMatch(matched.match_id);
          if (!alive) return;

          setMatchInfo({
            matchId: match.match_id,
            opponentName,
            opponentId: opponent.presence.user_id,
            iAmCreator,
          });

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

  const isSearching = phase === "searching" || phase === "joining";
  const isFound = phase === "found" || phase === "ready";
  const isError = phase === "error";

  // Coral when searching/connecting, amber when found, red when error
  const accentColor = isError
    ? "var(--coral)"
    : isFound
      ? "var(--amber)"
      : "var(--coral)";

  const accentRgb = isError
    ? "255,85,64"
    : isFound
      ? "240,160,80"
      : "255,85,64";

  const phaseLabel = {
    connecting: "CONNECTING",
    connected: "CONNECTED",
    searching: "SEARCHING",
    found: "MATCHED",
    joining: "JOINING",
    ready: "READY",
    error: "ERROR",
  }[phase];

  const headline = {
    connecting: "Connecting",
    connected: "Connected",
    searching: "Finding opponent",
    found: "Opponent found",
    joining: "Joining match",
    ready: "Ready to play",
    error: "Connection failed",
  }[phase];

  const subtitle = {
    connecting: "Establishing secure connection",
    connected: "Entering matchmaking queue",
    searching: "Scanning global matchmaking pool",
    found: "Locking in your opponent",
    joining: "Syncing match state",
    ready: "Starting match...",
    error: "Could not reach the server",
  }[phase];

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
        @keyframes mmBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.35; }
        }
      `}</style>

      <div
        className="screen"
        role="main"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          animation: "mmScreenFadeIn 0.3s ease-out",
        }}
      >
        {/* Background glyphs — same as game screen */}
        <span
          className="bg-glyph pulse"
          style={{
            fontSize: 200,
            right: -30,
            top: -20,
            animationName: "pulse",
          }}
          aria-hidden
        >
          X
        </span>
        <span
          className="bg-glyph"
          style={{
            fontSize: 150,
            left: -20,
            bottom: 80,
            animationName: "pulse",
            animationDelay: "2s",
          }}
          aria-hidden
        >
          O
        </span>

        {/* Grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            animation: "mmGridPulse 4s ease-in-out infinite",
            zIndex: 0,
          }}
        />

        {/* Accent glow behind center */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(ellipse 70% 50% at 50% 60%, rgba(${accentRgb},0.07) 0%, transparent 70%)`,
            transition: "background 0.8s ease",
            zIndex: 0,
          }}
        />

        {/* TOPBAR */}
        <header
          className="topbar"
          style={{ flexShrink: 0, position: "relative", zIndex: 2 }}
        >
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleCancel}
            type="button"
          >
            ←
          </button>
          <div className="topbar-logo">
            XO<span className="topbar-logo-accent">.</span>
          </div>
          {/* Phase pill */}
          <span
            className="pill"
            style={{
              borderColor: accentColor,
              color: accentColor,
              fontSize: 9,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {/* Blinking dot — steps(1) like game screen's turnBlink */}
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                background: accentColor,
                animation: isSearching
                  ? "mmBlink .8s steps(1) infinite"
                  : "none",
              }}
            />
            {phaseLabel}
          </span>
        </header>

        {/* BODY */}
        <main
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 var(--pad) 24px",
            overflowY: "auto",
          }}
        >
          {/* Loader component — unchanged */}
          <MatchmakingLoader phase={phase} />

          {/* Headline */}
          <div
            style={{
              marginTop: 28,
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: -1,
              lineHeight: 1,
              color: isError ? "var(--coral)" : "var(--soft)",
              textAlign: "center",
              transition: "color 0.3s steps(3)",
            }}
          >
            {headline}
            {/* Blinking cursor — exactly like game screen terminals */}
            {isSearching && (
              <span
                style={{
                  display: "inline-block",
                  width: 3,
                  height: "0.85em",
                  background: accentColor,
                  marginLeft: 6,
                  verticalAlign: "middle",
                  animation: "mmBlink .6s steps(1) infinite",
                }}
              />
            )}
          </div>

          {/* Subtitle */}
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "var(--muted)",
              textAlign: "center",
              minHeight: 18,
            }}
          >
            {subtitle}
          </div>

          {/* Scan bar — while actively searching/joining */}
          {isSearching && (
            <div
              style={{
                marginTop: 24,
                width: "100%",
                maxWidth: 220,
                height: 2,
                background: "var(--surface-hi)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "40%",
                  transformOrigin: "left",
                  animation: "mmBarLoop 1.8s ease-in-out infinite",
                  background:
                    phase === "joining"
                      ? `linear-gradient(90deg, transparent, var(--amber), transparent)`
                      : `linear-gradient(90deg, transparent, var(--coral), transparent)`,
                }}
              />
            </div>
          )}

          {/* Elapsed counter — shown while searching */}
          {(phase === "searching" || phase === "joining") && (
            <div
              style={{
                marginTop: 14,
                fontFamily: "var(--font-display)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 2,
                color: "var(--muted)",
                textTransform: "uppercase",
              }}
            >
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
            </div>
          )}

          {/* Opponent card — found / joining */}
          {(isFound || phase === "joining") && matchInfo && (
            <div
              style={{
                marginTop: 28,
                width: "100%",
                maxWidth: 320,
                background: "var(--surface-lo)",
                border: `1px solid rgba(${accentRgb},0.3)`,
                boxShadow: `0 0 0 1px rgba(${accentRgb},0.08), 0 16px 40px rgba(0,0,0,0.5)`,
                animation: "mmOpponentIn 0.38s cubic-bezier(0.34,1.56,0.64,1)",
                overflow: "hidden",
              }}
            >
              {/* Top accent bar */}
              <div
                style={{
                  height: 3,
                  background: `linear-gradient(to right, rgba(${accentRgb},0.2), ${accentColor}, rgba(${accentRgb},0.2))`,
                }}
              />

              <div style={{ padding: "16px 16px 18px" }}>
                {/* Label row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      background: accentColor,
                      animation: "mmBlink .8s steps(1) infinite",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      color: accentColor,
                    }}
                  >
                    Opponent located
                  </span>
                </div>

                {/* Player info row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Avatar box — same style as game screen player symbol box */}
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      border: `2px solid rgba(${accentRgb},0.4)`,
                      background: `rgba(${accentRgb},0.08)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 16,
                        fontWeight: 900,
                        color: accentColor,
                        textTransform: "uppercase",
                        letterSpacing: -0.5,
                      }}
                    >
                      {matchInfo.opponentName.slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="t-label"
                      style={{ color: "var(--muted)", marginBottom: 2 }}
                    >
                      Opponent
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 18,
                        fontWeight: 800,
                        lineHeight: 1,
                        color: "var(--soft)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {matchInfo.opponentName}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {/* Symbol pill */}
                      <span
                        className="pill"
                        style={{
                          borderColor: accentColor,
                          color: accentColor,
                          fontSize: 8,
                          padding: "3px 8px",
                          letterSpacing: 2,
                        }}
                      >
                        ▸ Playing {matchInfo.iAmCreator ? "O" : "X"}
                      </span>
                      {/* Found-in pill */}
                      {searchDurationMs !== null && (
                        <span
                          className="pill"
                          style={{
                            borderColor: "var(--rim)",
                            color: "var(--muted)",
                            fontSize: 8,
                            padding: "3px 8px",
                            letterSpacing: 1.5,
                          }}
                        >
                          {fmtDuration(searchDurationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error hint */}
          {isError && (
            <p
              style={{
                marginTop: 16,
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "var(--muted)",
                textAlign: "center",
                maxWidth: 240,
                lineHeight: 1.8,
                animation: "mmFadeSlideIn 0.3s ease-out",
              }}
            >
              Could not reach the server
              <br />
              Check connection and retry
            </p>
          )}
        </main>

        {/* FOOTER */}
        <footer
          style={{
            padding: "12px var(--pad)",
            flexShrink: 0,
            position: "relative",
            zIndex: 2,
          }}
        >
          <div className="prog-bar" style={{ marginBottom: 12 }} />
          <button
            className="btn btn-ghost btn-full"
            onClick={handleCancel}
            type="button"
          >
            {isError ? "← Go back" : isFound ? "← Cancel" : "← Cancel search"}
          </button>
        </footer>
      </div>
    </>
  );
}
