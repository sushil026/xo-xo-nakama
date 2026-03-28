import { useEffect, useRef, useState } from "react";
import { connect, getSocket } from "../../services/nakamaClient";

type Phase =
  | "connecting"
  | "searching"
  | "found"
  | "joining"
  | "ready"
  | "error";

interface MatchInfo {
  matchId: string;
  opponentName: string;
  opponentId: string;
  iAmCreator: boolean; // true = I was first in the pair (play as X)
}

interface Props {
  onMatchFound: (matchId: string, opponentName: string, iAmX: boolean) => void;
  onCancel: () => void;
}

export default function MatchmakingScreen({ onMatchFound, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [elapsed, setElapsed] = useState(0);
  const [latency, setLatency] = useState(24);
  const [searching, setSearching] = useState(24);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the matchmaker ticket so we can cancel it
  const ticketRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => {
      if (cancelledRef.current) return;
      setElapsed((e) => e + 1);
      // Jitter latency & searching count for the HUD feel
      setLatency(18 + Math.floor(Math.random() * 14));
      setSearching(22 + Math.floor(Math.random() * 6));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Main matchmaking flow
  useEffect(() => {
    let socket: ReturnType<typeof getSocket> | null = null;

    const run = async () => {
      try {
        // 1. Connect (idempotent — reuses existing session if already connected)
        setPhase("connecting");
        const result = await connect();
        socket = result.socket as ReturnType<typeof getSocket>;

        if (cancelledRef.current) return;

        // 2. Add to matchmaker pool
        // min/max count = 2 means "pair me with exactly 1 other player"
        setPhase("searching");
        const ticket = await socket.addMatchmaker("*", 2, 2, {
          // Optional: pass skill/rating properties here for skill-based matching
          // "properties.rating": currentRating,
        });

        ticketRef.current = ticket.ticket;

        // 3. Listen for the match event
        socket.onmatchmakermatched = async (matched) => {
          if (cancelledRef.current) return;

          setPhase("found");

          // Determine which user is "us" and which is the opponent
          const myUserId = result.session.user_id!;

          const me = matched.users.find((u) => u.presence.user_id === myUserId);
          const opponent = matched.users.find(
            (u) => u.presence.user_id !== myUserId,
          );

          if (!me || !opponent) {
            setError("Matched users missing — try again.");
            setPhase("error");
            return;
          }

          // Nakama doesn't expose display_name in matchmakerUser by default —
          // it surfaces the username from the presence. Fall back gracefully.
          const opponentName =
            opponent.presence.username ??
            `Player_${opponent.presence.user_id.slice(0, 4).toUpperCase()}`;

          // The "creator" is simply the user with the lexicographically smaller
          // user_id — a stable, deterministic rule both clients agree on without
          // a server round-trip. Creator plays as X.
          const iAmCreator = myUserId < opponent.presence.user_id;

          setMatchInfo({
            matchId: matched.match_id,
            opponentName,
            opponentId: opponent.presence.user_id,
            iAmCreator,
          });

          // 4. Join the authoritative match
          setPhase("joining");
          if (!socket) {
            setError("Socket disconnected");
            setPhase("error");
            return;
          }
          await socket.joinMatch(matched.match_id);

          if (cancelledRef.current) {
            if (socket) {
              await socket.leaveMatch(matched.match_id);
            }
            return;
          }

          setPhase("ready");

          // Brief pause so the "Found!" UI is visible before transitioning
          setTimeout(() => {
            if (!cancelledRef.current) {
              onMatchFound(matched.match_id, opponentName, iAmCreator);
            }
          }, 1200);
        };
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : "Connection failed";
        setError(msg);
        setPhase("error");
      }
    };

    run();

    // Cleanup: remove from matchmaker pool if the user cancels or unmounts
    return () => {
      cancelledRef.current = true;
      if (ticketRef.current) {
        try {
          getSocket().removeMatchmaker(ticketRef.current);
        } catch {
          // Socket may already be gone — safe to ignore
        }
        ticketRef.current = null;
      }
    };
  }, [onMatchFound]);

  const handleCancel = async () => {
    cancelledRef.current = true;
    if (ticketRef.current) {
      try {
        getSocket().removeMatchmaker(ticketRef.current);
      } catch {
        // ignore
      }
      ticketRef.current = null;
    }
    onCancel();
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const stepDone = (p: Phase) =>
    ["searching", "found", "joining", "ready"].includes(phase) ||
    (phase === "error" && p === "connecting");

  const stepLive = (p: Phase) => phase === p;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="screen" role="main">
      {/* BG glyphs */}
      <span
        className="bg-glyph"
        style={{ fontSize: 180, right: -20, top: 40 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph"
        style={{ fontSize: 140, left: -10, bottom: 100 }}
        aria-hidden
      >
        O
      </span>

      {/* TOPBAR */}
      <header className="topbar">
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleCancel}
          type="button"
        >
          ← Back
        </button>
        <span className="coord">GLOBAL QUEUE</span>
        <span className="coord" style={{ color: "var(--coral)" }}>
          MM_4F91BC
        </span>
      </header>

      {/* Status strip */}
      <div
        style={{
          background: "var(--surface-lo)",
          borderBottom: "1px solid var(--rim)",
          padding: "6px var(--pad)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span className="lbl" style={{ color: "var(--coral)" }}>
          STATUS //{" "}
          {phase === "error"
            ? "ERROR"
            : phase === "ready"
              ? "MATCH_FOUND"
              : "ACTIVE_ENGAGEMENT"}
        </span>
        <span className="coord">SEC_03 // 99.2</span>
      </div>

      {/* Main body */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px var(--pad)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* ── TACTICAL SQUARE LOADER ── */}
        <TacLoader phase={phase} />

        {/* Title */}
        {phase !== "found" && phase !== "ready" && (
          <>
            <h2
              style={{
                fontFamily: "var(--font-head)",
                fontSize: 24,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: -0.5,
                textAlign: "center",
                marginTop: 24,
                color: phase === "error" ? "var(--muted)" : "var(--text)",
              }}
            >
              {phase === "connecting" && (
                <>
                  Connecting
                  <Blink />
                </>
              )}
              {phase === "searching" && (
                <>
                  Finding opponent
                  <Blink />
                </>
              )}
              {phase === "joining" && (
                <>
                  Joining match
                  <Blink />
                </>
              )}
              {phase === "error" && "Connection failed"}
            </h2>
            {phase === "error" && error && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 8,
                  textAlign: "center",
                }}
              >
                {error}
              </p>
            )}
            {phase !== "error" && (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  textAlign: "center",
                  marginTop: 6,
                }}
              >
                Elapsed:{" "}
                <span
                  style={{
                    color: "var(--soft)",
                    fontFamily: "var(--font-head)",
                  }}
                >
                  {fmtElapsed(elapsed)}
                </span>
              </p>
            )}
          </>
        )}

        {/* ── MATCH FOUND card ── */}
        {(phase === "found" || phase === "ready") && matchInfo && (
          <MatchFoundCard info={matchInfo} />
        )}

        {/* HUD stats */}
        {(phase === "searching" || phase === "found") && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1px 1fr 1px 1fr",
              background: "var(--surface)",
              border: "1px solid var(--rim)",
              marginTop: 16,
              width: "100%",
            }}
          >
            <HudStat
              label="Latency"
              value={`${latency}ms`}
              color="var(--teal)"
            />
            <div style={{ background: "var(--rim)" }} />
            <HudStat
              label="Searching"
              value={String(searching)}
              color="var(--coral)"
            />
            <div style={{ background: "var(--rim)" }} />
            <HudStat label="Avg wait" value="~8s" color="var(--amber)" />
          </div>
        )}

        {/* Step indicators */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            marginTop: 14,
            width: "100%",
          }}
        >
          <Step
            done={stepDone("connecting")}
            live={stepLive("connecting")}
            title="Connected"
            sub="server.xo.game · 24ms"
          />
          <Step
            done={phase === "found" || phase === "joining" || phase === "ready"}
            live={stepLive("searching")}
            title="In queue"
            sub="Searching for match..."
          />
          <Step
            done={phase === "ready"}
            live={phase === "found" || phase === "joining"}
            title="Opponent found"
            sub={matchInfo ? `vs ${matchInfo.opponentName}` : "Pending..."}
          />
        </div>

        {/* Error retry */}
        {phase === "error" && (
          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 16 }}
            onClick={() => {
              cancelledRef.current = false;
              setPhase("connecting");
              setElapsed(0);
            }}
            type="button"
          >
            ↻ Retry
          </button>
        )}
      </div>

      {/* Cancel */}
      <div style={{ padding: "0 var(--pad) 24px" }}>
        <button
          className="btn btn-danger btn-full"
          onClick={handleCancel}
          type="button"
        >
          Cancel search
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function Blink() {
  return <span className="blink">...</span>;
}

function HudStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ padding: "10px 8px", textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-head)",
          fontSize: 20,
          fontWeight: 800,
          lineHeight: 1,
          color,
        }}
      >
        {value}
      </div>
      <div className="lbl" style={{ fontSize: 8, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function Step({
  done,
  live,
  title,
  sub,
}: {
  done: boolean;
  live: boolean;
  title: string;
  sub: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 13px",
        background: "var(--surface)",
        border: `1px solid ${done ? "rgba(78,205,196,0.3)" : live ? "rgba(255,85,64,0.3)" : "var(--rim)"}`,
        opacity: !done && !live ? 0.4 : 1,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-head)",
          fontSize: 12,
          fontWeight: 700,
          width: 16,
          flexShrink: 0,
          color: done ? "var(--teal)" : live ? "var(--coral)" : "var(--muted)",
        }}
        className={live ? "blink" : ""}
      >
        {done ? "✓" : live ? "◉" : "○"}
      </span>
      <div>
        <div
          style={{
            fontFamily: "var(--font-head)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: done
              ? "var(--teal)"
              : live
                ? "var(--coral)"
                : "var(--muted)",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function MatchFoundCard({ info }: { info: MatchInfo }) {
  return (
    <div style={{ width: "100%", marginTop: 20, textAlign: "center" }}>
      <div className="lbl" style={{ marginBottom: 12, color: "var(--teal)" }}>
        ✓ OPPONENT FOUND
      </div>

      {/* VS row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 12,
          alignItems: "center",
          background: "var(--surface)",
          border: "1px solid var(--rim)",
          padding: "14px 16px",
        }}
      >
        {/* You */}
        <div style={{ textAlign: "left" }}>
          <div className="lbl" style={{ marginBottom: 4 }}>
            You
          </div>
          <div
            style={{
              fontFamily: "var(--font-head)",
              fontSize: 18,
              fontWeight: 800,
              color: info.iAmCreator ? "var(--coral)" : "var(--amber)",
              textTransform: "uppercase",
            }}
          >
            {localStorage.getItem("xo_username") ?? "YOU"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-head)",
              fontSize: 11,
              fontWeight: 700,
              color: info.iAmCreator ? "var(--coral)" : "var(--amber)",
              letterSpacing: 1,
              marginTop: 4,
            }}
          >
            plays {info.iAmCreator ? "X" : "O"}
          </div>
        </div>

        {/* VS glyph */}
        <div
          style={{
            fontFamily: "var(--font-head)",
            fontSize: 22,
            fontWeight: 800,
            color: "var(--muted)",
            letterSpacing: -1,
          }}
        >
          VS
        </div>

        {/* Opponent */}
        <div style={{ textAlign: "right" }}>
          <div className="lbl" style={{ marginBottom: 4, textAlign: "right" }}>
            Opponent
          </div>
          <div
            style={{
              fontFamily: "var(--font-head)",
              fontSize: 18,
              fontWeight: 800,
              color: info.iAmCreator ? "var(--amber)" : "var(--coral)",
              textTransform: "uppercase",
            }}
          >
            {info.opponentName}
          </div>
          <div
            style={{
              fontFamily: "var(--font-head)",
              fontSize: 11,
              fontWeight: 700,
              color: info.iAmCreator ? "var(--amber)" : "var(--coral)",
              letterSpacing: 1,
              marginTop: 4,
            }}
          >
            plays {info.iAmCreator ? "O" : "X"}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
        Joining match<span className="blink">...</span>
      </p>
    </div>
  );
}

// ── Tactical square loader ──────────────────────────────────────────────

function TacLoader({ phase }: { phase: Phase }) {
  const isFound = phase === "found" || phase === "ready";

  return (
    <div style={{ position: "relative", width: 160, height: 160 }}>
      {/* Rotating dashed outer ring */}
      <div
        style={{
          position: "absolute",
          inset: -8,
          border: "1px dashed rgba(255,85,64,0.18)",
          animation: "tacRing 10s linear infinite",
        }}
      />

      {/* Main frame */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: `1px solid ${isFound ? "rgba(78,205,196,0.4)" : "rgba(255,85,64,0.2)"}`,
          transition: "border-color 300ms",
        }}
      />

      {/* Corner brackets — drawn with inline SVG */}
      {(["tl", "tr", "bl", "br"] as const).map((pos) => (
        <CornerBracket
          key={pos}
          pos={pos}
          color={isFound ? "var(--teal)" : "var(--coral)"}
        />
      ))}

      {/* Blinking corner pips */}
      {[
        { top: 8, left: 8, delay: "0s" },
        { top: 8, right: 8, delay: "0.3s" },
        { bottom: 8, left: 8, delay: "0.15s" },
        { bottom: 8, right: 8, delay: "0.45s" },
      ].map((style, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 3,
            height: 3,
            background: isFound ? "var(--teal)" : "var(--coral)",
            animation: `blink 0.6s steps(1) ${style.delay} infinite`,
            ...style,
          }}
        />
      ))}

      {/* Outer tick marks */}
      <div
        style={{
          position: "absolute",
          height: 1,
          width: 18,
          background: "rgba(255,85,64,0.35)",
          top: "50%",
          left: -24,
          transform: "translateY(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          height: 1,
          width: 18,
          background: "rgba(255,85,64,0.35)",
          top: "50%",
          right: -24,
          transform: "translateY(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1,
          height: 18,
          background: "rgba(255,85,64,0.35)",
          left: "50%",
          top: -24,
          transform: "translateX(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1,
          height: 18,
          background: "rgba(255,85,64,0.35)",
          left: "50%",
          bottom: -24,
          transform: "translateX(-50%)",
        }}
      />

      {/* Crosshair */}
      <div
        style={{
          position: "absolute",
          left: "20%",
          right: "20%",
          height: 1,
          top: "50%",
          background: "rgba(255,85,64,0.12)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "20%",
          bottom: "20%",
          width: 1,
          left: "50%",
          background: "rgba(255,85,64,0.12)",
        }}
      />

      {/* Scanning line (hidden when found) */}
      {!isFound && (
        <div
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            height: 1,
            background:
              "linear-gradient(90deg,transparent,var(--coral) 50%,transparent)",
            animation: "tacScan 2s ease-in-out infinite",
          }}
        />
      )}

      {/* Center pip */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: isFound ? 8 : 5,
          height: isFound ? 8 : 5,
          background: isFound ? "var(--teal)" : "var(--coral)",
          transform: "translate(-50%,-50%)",
          transition: "all 200ms",
          animation: "tacPip 1s steps(2) infinite",
        }}
      />

      {/* Inner label */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 18,
          pointerEvents: "none",
        }}
      >
        {isFound ? (
          <div
            style={{
              fontFamily: "var(--font-head)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--teal)",
            }}
          >
            LOCKED
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: "var(--font-head)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "var(--coral)",
              }}
            >
              Scanning<span className="blink">...</span>
            </div>
          </>
        )}
      </div>

      {/* CSS animations injected once */}
      <style>{`
        @keyframes tacRing { to { transform: rotate(360deg); } }
        @keyframes tacScan {
          0%  { top: 2px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100%{ top: calc(100% - 2px); opacity: 0; }
        }
        @keyframes tacPip { 0%,100%{opacity:1} 50%{opacity:.15} }
      `}</style>
    </div>
  );
}

function CornerBracket({
  pos,
  color,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  color: string;
}) {
  const style: React.CSSProperties = {
    position: "absolute",
    width: 18,
    height: 18,
    ...(pos === "tl" ? { top: -1, left: -1 } : {}),
    ...(pos === "tr" ? { top: -1, right: -1, transform: "scaleX(-1)" } : {}),
    ...(pos === "bl" ? { bottom: -1, left: -1, transform: "scaleY(-1)" } : {}),
    ...(pos === "br"
      ? { bottom: -1, right: -1, transform: "scale(-1,-1)" }
      : {}),
  };

  return (
    <div style={style}>
      <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
        <path d="M0 16V2C0 .9.9 0 2 0h14" stroke={color} strokeWidth="2.5" />
      </svg>
    </div>
  );
}
