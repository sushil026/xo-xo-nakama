import { useState, useEffect, useCallback, useRef } from "react";
import {
  connect,
  createRoom,
  joinByCode,
  listPublicRooms,
  type RoomInfo,
} from "../../services/nakamaClient";

//  Types

type Tab = "create" | "browse" | "code";

interface Props {
  onBack: () => void;
  onJoin: (matchId: string, opponentName: string, iAmX: boolean) => void;
}

//  Helpers

function copyText(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const el = document.createElement("textarea");
    el.value = text;
    Object.assign(el.style, { position: "fixed", opacity: "0" });
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function attachMatchListener(
  socket: ReturnType<typeof import("../../services/nakamaClient").getSocket>,
  myUserId: string,
  onJoin: Props["onJoin"],
  matchId: string,
  onKnock?: (knockerName: string) => void,
  onDeclined?: () => void,
  onExpired?: () => void,
  onTimeRemaining?: (seconds: number) => void,
): () => void {
  const prev = socket.onmatchdata;

  socket.onmatchdata = (data) => {
    try {
      const state = JSON.parse(new TextDecoder().decode(data.data)) as {
        players?: { userId: string; username: string; symbol: string }[];
        phase?: string;
        knockerName?: string;
        timeRemaining?: number;
        expiresAt?: number;
      };

      // FIX: server sends expiresAt (absolute ms), compute remaining seconds
      if (typeof state.expiresAt === "number") {
        onTimeRemaining?.(
          Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000)),
        );
      }

      if (state.phase === "knocking" && state.knockerName) {
        onKnock?.(state.knockerName);
        return;
      }

      if (state.phase === "declined") {
        onDeclined?.();
        if (!onKnock) {
          socket.leaveMatch(matchId).catch(() => {});
          socket.onmatchdata = prev ?? null;
        }
        return;
      }

      if (state.phase === "expired") {
        onExpired?.();
        socket.onmatchdata = prev ?? null;
        return;
      }

      if (
        state.phase === "active" &&
        state.players &&
        state.players.length === 2
      ) {
        socket.onmatchdata = prev ?? null;
        localStorage.removeItem("xo_active_room");
        const me = state.players.find((p) => p.userId === myUserId);
        const opponent = state.players.find((p) => p.userId !== myUserId);
        onJoin(matchId, opponent?.username ?? "Opponent", me?.symbol === "X");
        return;
      }
    } catch {
      // not a state message — pass through
    }
    if (prev) prev.call(socket, data);
  };

  return () => {
    socket.onmatchdata = prev ?? null;
  };
}

//  RetryCountdownButton

function RetryCountdownButton({
  endsAt,
  onClick,
  label = "↩ Retry",
}: {
  endsAt: number;
  onClick: () => void;
  label?: string;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const isDebounced = remaining > 0;
  const pct = isDebounced ? remaining / 15 : 0;
  const t = 1 - pct;
  const r2 = Math.round(139 + (255 - 139) * t);
  const g2 = Math.round(124 + (85 - 124) * t);
  const b2 = Math.round(246 + (64 - 246) * t);
  const color = `rgb(${r2},${g2},${b2})`;
  const colorRgb = `${r2},${g2},${b2}`;

  return (
    <button
      type="button"
      onClick={isDebounced ? undefined : onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        border: `1px solid rgba(${colorRgb},${isDebounced ? 0.35 : 0.5})`,
        borderRadius: 3,
        background: `rgba(${colorRgb},0.08)`,
        padding: "7px 12px",
        cursor: isDebounced ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flexShrink: 0,
        transition: "border-color 0.3s ease, background 0.3s ease",
        minWidth: 90,
      }}
    >
      {isDebounced && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${pct * 100}%`,
            background: `rgba(${colorRgb},0.12)`,
            transition: "width 0.25s linear",
          }}
        />
      )}
      <span
        style={{
          position: "relative",
          fontFamily: "var(--font-display)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color,
          transition: "color 0.3s ease",
        }}
      >
        {isDebounced ? `Retry in ${remaining}s` : label}
      </span>
    </button>
  );
}

//  TimeRing

function TimeRing({
  seconds,
  total = 900,
}: {
  seconds: number;
  total?: number;
}) {
  const pct = Math.max(0, Math.min(1, seconds / total));
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const urgent = seconds <= 60;
  const warning = seconds <= 180;
  const color = urgent ? "var(--coral)" : warning ? "#F5A623" : "#8B7CF6";

  return (
    <div
      style={{
        position: "relative",
        width: 64,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: "rotate(-90deg)",
        }}
      >
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="3"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.5s ease" }}
        />
      </svg>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: 0.5,
          color: urgent ? "var(--coral)" : "var(--soft)",
          transition: "color 0.5s ease",
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        {formatTime(seconds)}
      </div>
    </div>
  );
}

//  TabBar

function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "create", label: "Create" },
    { id: "browse", label: "Browse" },
    { id: "code", label: "Join Code" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--rim)",
        borderRadius: 4,
        padding: 3,
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          style={{
            flex: 1,
            padding: "8px 0",
            fontFamily: "var(--font-display)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
            transition: "all 0.15s ease",
            background: active === t.id ? "var(--coral)" : "transparent",
            color: active === t.id ? "#fff" : "var(--muted)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

//  CreateTab

function CreateTab({
  onJoin,
  restoredRoom,
}: {
  onJoin: Props["onJoin"];
  restoredRoom: {
    matchId: string;
    roomCode: string;
    expiresAt?: number;
  } | null;
}) {
  const [isPublic, setIsPublic] = useState(true);
  const [status, setStatus] = useState<
    "idle" | "creating" | "waiting" | "error"
  >("idle");
  const [roomCode, setRoomCode] = useState("");
  const [matchId, setMatchId] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [knockerName, setKnockerName] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  const matchIdRef = useRef("");
  const statusRef = useRef(status);
  const didJoinRef = useRef(false);
  const timeRemainingRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Keep ref in sync and start ticker the first time we get a real value
  useEffect(() => {
    timeRemainingRef.current = timeRemaining;

    if (timeRemaining !== null && tickerRef.current === null) {
      tickerRef.current = setInterval(() => {
        if (timeRemainingRef.current === null) return;
        if (timeRemainingRef.current <= 0) {
          clearInterval(tickerRef.current!);
          tickerRef.current = null;
          return;
        }
        timeRemainingRef.current = timeRemainingRef.current - 1;
        setTimeRemaining(timeRemainingRef.current);
      }, 1000);
    }
  }, [timeRemaining]);

  // Cleanup ticker on unmount
  useEffect(() => {
    return () => {
      if (tickerRef.current !== null) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, []);

  // Auto-expire on unmount if room is still waiting
  useEffect(() => {
    return () => {
      if (
        statusRef.current === "waiting" &&
        matchIdRef.current &&
        !didJoinRef.current
      ) {
        connect()
          .then(({ socket }) => {
            try {
              socket.sendMatchState(
                matchIdRef.current,
                4,
                new TextEncoder().encode(JSON.stringify({})),
              );
            } catch {
              // ignore
            }
          })
          .catch(() => {});
        localStorage.removeItem("xo_active_room");
      }
    };
  }, []);

  // Mount-time room recovery
  useEffect(() => {
    if (!restoredRoom) return;
    setRoomCode(restoredRoom.roomCode);
    setMatchId(restoredRoom.matchId);
    matchIdRef.current = restoredRoom.matchId;
    setStatus("waiting");

    // Immediately show time from stored expiresAt so ring appears at once
    if (restoredRoom.expiresAt) {
      const secs = Math.max(
        0,
        Math.round((restoredRoom.expiresAt - Date.now()) / 1000),
      );
      setTimeRemaining(secs);
    }

    connect().then(({ socket, session }) => {
      socket.joinMatch(restoredRoom.matchId).then(() => {
        attachMatchListener(
          socket,
          session.user_id!,
          (matchId, opponentName, iAmX) => {
            didJoinRef.current = true;
            onJoin(matchId, opponentName, iAmX);
          },
          restoredRoom.matchId,
          (name) => setKnockerName(name),
          () => setKnockerName(null),
          () => {
            setStatus("error");
            setErrorMsg("Room expired.");
            localStorage.removeItem("xo_active_room");
          },
          (secs) => setTimeRemaining(secs),
        );
      });
    });
  }, [restoredRoom]);

  const handleCreate = async () => {
    setStatus("creating");
    setErrorMsg("");
    try {
      const { session, socket } = await connect();
      const result = await createRoom(session, isPublic);

      setRoomCode(result.roomCode);
      setMatchId(result.matchId);
      matchIdRef.current = result.matchId;
      setStatus("waiting");

      // Set timer immediately on creation — server always sets expiresAt = now + 900s
      setTimeRemaining(900);

      const expiresAt = Date.now() + 900_000;
      localStorage.setItem(
        "xo_active_room",
        JSON.stringify({
          matchId: result.matchId,
          roomCode: result.roomCode,
          expiresAt,
        }),
      );

      attachMatchListener(
        socket,
        session.user_id!,
        (matchId, opponentName, iAmX) => {
          didJoinRef.current = true;
          onJoin(matchId, opponentName, iAmX);
        },
        result.matchId,
        (name) => setKnockerName(name),
        () => setKnockerName(null),
        () => {
          setStatus("error");
          setErrorMsg("Room expired.");
          localStorage.removeItem("xo_active_room");
        },
        // Server broadcasts will correct the value if there's any drift
        (secs) => setTimeRemaining(secs),
      );

      await socket.joinMatch(result.matchId);
    } catch (e) {
      console.error("[RoomScreen] create failed", e);
      setStatus("error");
      setErrorMsg(
        "Failed to create room. Check your connection and try again.",
      );
    }
  };

  const handleCopy = () => {
    copyText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAccept = async () => {
    const { socket } = await connect();
    socket.sendMatchState(
      matchIdRef.current,
      3,
      new TextEncoder().encode(JSON.stringify({ accept: true })),
    );
    setKnockerName(null);
  };

  const handleDecline = async () => {
    const { socket } = await connect();
    socket.sendMatchState(
      matchIdRef.current,
      3,
      new TextEncoder().encode(JSON.stringify({ accept: false })),
    );
    setKnockerName(null);
  };

  const handleCancel = async () => {
    const currentMatchId = matchIdRef.current;
    try {
      const { socket } = await connect();
      await socket.sendMatchState(
        currentMatchId,
        4,
        new TextEncoder().encode(JSON.stringify({})),
      );
    } catch {}
    localStorage.removeItem("xo_active_room");
    // Stop ticker
    if (tickerRef.current !== null) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    setStatus("idle");
    setRoomCode("");
    setMatchId("");
    matchIdRef.current = "";
    setKnockerName(null);
    setTimeRemaining(null);
    timeRemainingRef.current = null;
  };

  //  Waiting state
  if (status === "waiting") {
    const urgent = timeRemaining !== null && timeRemaining <= 60;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Code card */}
        <div
          style={{
            background: "rgba(139,124,246,0.06)",
            border: "1px solid rgba(139,124,246,0.2)",
            borderLeft: "3px solid rgba(139,124,246,0.5)",
            borderRadius: 4,
            padding: "16px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: "#8B7CF6",
                  marginBottom: 8,
                }}
              >
                ▸ {isPublic ? "Public" : "Private"} room · Live
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 32,
                  fontWeight: 900,
                  letterSpacing: 6,
                  color: "var(--soft)",
                  lineHeight: 1,
                  marginBottom: 3,
                }}
              >
                {roomCode}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  color: "var(--muted)",
                  letterSpacing: 0.5,
                }}
              >
                Share this code · Room open for challengers
              </div>
            </div>

            {/* TimeRing — always visible once status is waiting */}
            {timeRemaining !== null && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <TimeRing seconds={timeRemaining} total={900} />
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 8,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: urgent ? "var(--coral)" : "var(--muted)",
                    transition: "color 0.5s ease",
                  }}
                >
                  {urgent ? "Expiring!" : "Room life"}
                </div>
              </div>
            )}
          </div>

          {urgent && (
            <div
              style={{
                background: "rgba(255,85,64,0.07)",
                border: "1px solid rgba(255,85,64,0.25)",
                borderRadius: 3,
                padding: "7px 10px",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                color: "var(--coral)",
                letterSpacing: 0.5,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11 }}>⚠</span>
              Room closing soon — share the code now
            </div>
          )}
        </div>

        {/* Status */}
        {!knockerName && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "2px 0",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#8B7CF6",
                display: "inline-block",
                animation: "pulse-dot 1.4s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 11,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Room open — waiting for a knock
            </span>
          </div>
        )}

        {/* Knock notification */}
        {knockerName && (
          <div
            style={{
              background: "rgba(139,124,246,0.07)",
              border: "1px solid rgba(139,124,246,0.3)",
              borderRadius: 4,
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              animation: "slideIn 0.2s ease",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                color: "var(--soft)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "rgba(139,124,246,0.18)",
                  border: "1px solid rgba(139,124,246,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                🚪
              </span>
              <span>
                <span style={{ color: "#8B7CF6" }}>{knockerName}</span>
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  {" "}
                  is at the door
                </span>
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={handleAccept}
                style={{ fontSize: 12 }}
              >
                ✓ Let them in
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-full"
                onClick={handleDecline}
                style={{ fontSize: 12 }}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-full"
            onClick={handleCopy}
            style={{ fontSize: 12 }}
          >
            {copied ? "✓ Copied" : "Copy Code"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCancel}
            style={{
              fontSize: 12,
              padding: "0 16px",
              flexShrink: 0,
              opacity: 0.45,
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  //  Idle / error state
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--rim)",
          borderRadius: 4,
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          Visibility
        </div>

        {(
          [
            {
              value: true,
              title: "Public",
              desc: "Listed in room browser · Anyone can challenge",
              color: "var(--coral)",
              rgb: "255,85,64",
            },
            {
              value: false,
              title: "Private",
              desc: "Invite only · Join via code",
              color: "#8B7CF6",
              rgb: "139,124,246",
            },
          ] as const
        ).map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => setIsPublic(opt.value)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "11px 12px",
              background:
                isPublic === opt.value
                  ? `rgba(${opt.rgb},0.07)`
                  : "transparent",
              border: `1px solid ${isPublic === opt.value ? `rgba(${opt.rgb},0.3)` : "var(--rim)"}`,
              borderRadius: 3,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
            }}
          >
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: "50%",
                flexShrink: 0,
                marginTop: 2,
                border: `2px solid ${isPublic === opt.value ? opt.color : "var(--muted)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isPublic === opt.value && (
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: opt.color,
                  }}
                />
              )}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: isPublic === opt.value ? opt.color : "var(--soft)",
                }}
              >
                {opt.title}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  color: "var(--muted)",
                  marginTop: 2,
                  letterSpacing: 0.3,
                }}
              >
                {opt.desc}
              </div>
            </div>
          </button>
        ))}
      </div>

      {status === "error" && (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            color: "var(--coral)",
            padding: "9px 12px",
            border: "1px solid rgba(255,85,64,0.22)",
            borderRadius: 3,
            background: "rgba(255,85,64,0.05)",
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-full"
        onClick={handleCreate}
        disabled={status === "creating"}
      >
        {status === "creating" ? "Creating…" : "Create Room"}
      </button>
    </div>
  );
}

//  BrowseTab

const BROWSE_DEBOUNCE_MS = 15_000;

function BrowseTab({ onJoin }: { onJoin: Props["onJoin"] }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [myUserId, setMyUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [roomStates, setRoomStates] = useState<
    Record<string, "idle" | "waiting" | "declined" | "timeout">
  >({});
  const [debounceEnds, setDebounceEnds] = useState<Record<string, number>>({});
  const listenerCleanups = useRef<Record<string, () => void>>({});

  const setRoomState = (
    matchId: string,
    s: "idle" | "waiting" | "declined" | "timeout",
  ) => setRoomStates((prev) => ({ ...prev, [matchId]: s }));

  const setDebounce = (matchId: string, endsAt: number) =>
    setDebounceEnds((prev) => ({ ...prev, [matchId]: endsAt }));

  const fetchRooms = useCallback(async () => {
    try {
      const { session } = await connect();
      setMyUserId(session.user_id ?? "");
      const list = await listPublicRooms(session);
      setRooms(list);
      setError("");
    } catch {
      setError("Could not load rooms.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const id = setInterval(fetchRooms, 5000);
    return () => clearInterval(id);
  }, [fetchRooms]);

  // On tab re-focus, reset any stale "waiting" states for rooms that are
  // no longer in the list (host closed them while we were on another tab)
  useEffect(() => {
    setRoomStates((prev) => {
      const liveIds = new Set(rooms.map((r) => r.matchId));
      const next = { ...prev };
      for (const matchId of Object.keys(next)) {
        if (!liveIds.has(matchId) && next[matchId] === "waiting") {
          next[matchId] = "idle";
        }
      }
      return next;
    });
  }, [rooms]);

  const handleJoin = async (matchId: string) => {
    const debounceEnd = debounceEnds[matchId] ?? 0;
    if (Date.now() < debounceEnd) return;

    setRoomState(matchId, "waiting");
    setError("");

    try {
      const { session, socket } = await connect();

      listenerCleanups.current[matchId]?.();
      delete listenerCleanups.current[matchId];

      const cleanup = attachMatchListener(
        socket,
        session.user_id!,
        onJoin,
        matchId,
        undefined,
        () => {
          setRoomState(matchId, "declined");
          setDebounce(matchId, Date.now() + BROWSE_DEBOUNCE_MS);
          delete listenerCleanups.current[matchId];
        },
        () => {
          setRoomState(matchId, "idle");
          setError("That room has expired.");
          delete listenerCleanups.current[matchId];
          fetchRooms();
        },
      );
      listenerCleanups.current[matchId] = cleanup;

      await socket.joinMatch(matchId);

      const username =
        localStorage.getItem("xo_username") ?? session.user_id!.slice(0, 8);
      socket.sendMatchState(
        matchId,
        2,
        new TextEncoder().encode(
          JSON.stringify({ knock: true, knockerName: username }),
        ),
      );
    } catch {
      setError("Failed to join. The room may no longer be available.");
      setRoomState(matchId, "idle");
      fetchRooms();
    }
  };

  const handleTimeout = (matchId: string) => {
    setRoomState(matchId, "timeout");
    connect()
      .then(({ socket }) => {
        socket.leaveMatch(matchId).catch(() => {});
      })
      .catch(() => {});
    listenerCleanups.current[matchId]?.();
    delete listenerCleanups.current[matchId];
  };

  const handleRetry = (matchId: string) => {
    setRoomState(matchId, "idle");
    handleJoin(matchId);
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 0",
          gap: 10,
          color: "var(--muted)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--coral)",
            display: "inline-block",
            animation: "pulse-dot 1.4s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Scanning for rooms…
        </span>
      </div>
    );
  }

  const othersRooms = rooms.filter((r) => r.hostUserId !== myUserId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          {othersRooms.length} open{" "}
          {othersRooms.length === 1 ? "room" : "rooms"}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setLoading(true);
            fetchRooms();
          }}
          style={{ fontSize: 11 }}
        >
          ↺ Refresh
        </button>
      </div>

      {error && (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            color: "var(--coral)",
            padding: "8px 10px",
            border: "1px solid rgba(255,85,64,0.2)",
            borderRadius: 3,
          }}
        >
          {error}
        </div>
      )}

      {othersRooms.length === 0 && !error ? (
        <div
          style={{
            textAlign: "center",
            padding: "32px 0",
            color: "var(--muted)",
            fontFamily: "var(--font-display)",
            fontSize: 11,
            letterSpacing: 1,
          }}
        >
          <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>○</div>
          No open rooms right now
          <br />
          <span style={{ opacity: 0.5, fontSize: 10 }}>
            Create one or check back soon
          </span>
        </div>
      ) : (
        othersRooms.map((room) => {
          const displayName =
            room.hostUsername ||
            (room.hostUserId
              ? room.hostUserId.slice(0, 8).toUpperCase()
              : "Unknown");
          const rs = roomStates[room.matchId] ?? "idle";
          const debounceEnd = debounceEnds[room.matchId] ?? 0;
          const isDebounced = Date.now() < debounceEnd;
          const isWaiting = rs === "waiting";
          const isDeclined = rs === "declined";
          const isTimeout = rs === "timeout";
          const showRetry = isDeclined || isTimeout;

          // Derive time left from createdAt (server always sets expiresAt = createdAt + 900s)
          const roomExpiresAt = room.createdAt + 900_000;
          const timeLeft = Math.max(
            0,
            Math.round((roomExpiresAt - Date.now()) / 1000),
          );

          const borderColor =
            isDeclined || isTimeout
              ? "rgba(255,85,64,0.25)"
              : isWaiting
                ? "rgba(139,124,246,0.28)"
                : "var(--rim)";

          const bgColor =
            isDeclined || isTimeout
              ? "rgba(255,85,64,0.03)"
              : isWaiting
                ? "rgba(139,124,246,0.04)"
                : "rgba(255,255,255,0.02)";

          return (
            <div
              key={room.matchId}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "12px 13px",
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: 4,
                gap: 10,
                transition: "all 0.2s ease",
              }}
            >
              {/* Main row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 14,
                      fontWeight: 900,
                      letterSpacing: 0.3,
                      color: "var(--soft)",
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {displayName}
                    <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                      's room
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 10,
                      color:
                        isDeclined || isTimeout
                          ? "var(--coral)"
                          : isWaiting
                            ? "#8B7CF6"
                            : "var(--muted)",
                      marginTop: 3,
                      letterSpacing: 0.3,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      transition: "color 0.3s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background:
                          isDeclined || isTimeout
                            ? "var(--coral)"
                            : isWaiting
                              ? "#8B7CF6"
                              : "rgba(139,124,246,0.6)",
                        display: "inline-block",
                        flexShrink: 0,
                        animation: isWaiting
                          ? "pulse-dot 1.4s ease-in-out infinite"
                          : "none",
                      }}
                    />
                    {isDeclined
                      ? "Not this time"
                      : isTimeout
                        ? "Host didn't respond"
                        : isWaiting
                          ? "Waiting…"
                          : "Open · Waiting for a challenger"}
                  </div>
                </div>

                {/* Right side: TimeRing + action button */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  {/* TimeRing — show for all idle rooms with valid createdAt */}
                  {!isWaiting && !showRetry && room.createdAt > 0 && (
                    <TimeRing seconds={timeLeft} total={900} />
                  )}

                  {!isWaiting &&
                    (showRetry ? (
                      <RetryCountdownButton
                        endsAt={debounceEnd}
                        onClick={() => handleRetry(room.matchId)}
                        label="↩ Retry"
                      />
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleJoin(room.matchId)}
                        style={{
                          fontSize: 11,
                          padding: "7px 14px",
                          flexShrink: 0,
                        }}
                      >
                        Join
                      </button>
                    ))}
                </div>
              </div>

              {/* Declined / timeout inline notice */}
              {showRetry && (
                <div
                  style={{
                    background: "rgba(255,85,64,0.06)",
                    border: "1px solid rgba(255,85,64,0.18)",
                    borderRadius: 3,
                    padding: "7px 10px",
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    color: "var(--coral)",
                    letterSpacing: 0.3,
                    animation: "slideIn 0.2s ease",
                  }}
                >
                  {isDebounced
                    ? "Give them a moment before trying again."
                    : isTimeout
                      ? "No answer. Feel free to knock again."
                      : "They passed. You can try again anytime."}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

//  JoinCodeTab

const CODE_DEBOUNCE_MS = 15_000;

function JoinCodeTab({ onJoin }: { onJoin: Props["onJoin"] }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "joining" | "waiting" | "declined" | "timeout" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [debounceEndsAt, setDebounceEndsAt] = useState(0);
  const joinedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (debounceEndsAt === 0) return;
    const id = setInterval(() => {
      if (Date.now() >= debounceEndsAt) {
        setDebounceEndsAt(0);
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, [debounceEndsAt]);

  const isDebounced = Date.now() < debounceEndsAt;

  const doAttachAndKnock = async (matchId: string) => {
    const { session, socket } = await connect();

    attachMatchListener(
      socket,
      session.user_id!,
      onJoin,
      matchId,
      undefined,
      () => {
        setStatus("declined");
        setDebounceEndsAt(Date.now() + CODE_DEBOUNCE_MS);
      },
      () => {
        setStatus("error");
        setErrorMsg("Room expired.");
      },
    );

    await socket.joinMatch(matchId);

    const username =
      localStorage.getItem("xo_username") ?? session.user_id!.slice(0, 8);
    socket.sendMatchState(
      matchId,
      2,
      new TextEncoder().encode(
        JSON.stringify({ knock: true, knockerName: username }),
      ),
    );
    setStatus("waiting");
  };

  const handleJoin = async () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 4) {
      setErrorMsg("Enter a valid room code");
      setStatus("error");
      return;
    }
    setStatus("joining");
    setErrorMsg("");

    try {
      const { session } = await connect();
      const result = await joinByCode(session, clean);

      // FIX: narrow the discriminated union before accessing .error
      if (!result.ok) {
        setStatus("error");

        const err = result.error;

        setErrorMsg(
          err === "not_found"
            ? "Room not found. Double-check the code."
            : err === "full"
              ? "That room is already full."
              : "Something went wrong. Try again.",
        );

        return;
      }

      joinedMatchRef.current = result.matchId;
      await doAttachAndKnock(result.matchId);
    } catch {
      setStatus("error");
      setErrorMsg("Connection error. Check your network and try again.");
    }
  };

  const handleTimeout = () => {
    setStatus("timeout");
    if (joinedMatchRef.current) {
      connect()
        .then(({ socket }) => {
          socket.leaveMatch(joinedMatchRef.current!).catch(() => {});
        })
        .catch(() => {});
    }
  };

  const handleRetry = async () => {
    if (!joinedMatchRef.current || isDebounced) return;
    setStatus("joining");
    try {
      await doAttachAndKnock(joinedMatchRef.current);
    } catch {
      setStatus("error");
      setErrorMsg("Connection error. Try again.");
    }
  };

  const isWaiting = status === "waiting";
  const isDeclined = status === "declined";
  const isTimeout = status === "timeout";
  const showRetryPanel = isDeclined || isTimeout;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        Enter room code
      </div>

      <input
        type="text"
        maxLength={8}
        placeholder="e.g. XK92A1"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          if (status === "error") setStatus("idle");
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && status === "idle" && handleJoin()
        }
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: 7,
          textAlign: "center",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${status === "error" ? "rgba(255,85,64,0.45)" : showRetryPanel ? "rgba(255,85,64,0.25)" : "var(--rim)"}`,
          borderRadius: 4,
          padding: "14px 12px",
          color: "var(--soft)",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          textTransform: "uppercase",
          transition: "border-color 0.2s ease, opacity 0.2s ease",
          opacity: isWaiting || showRetryPanel ? 0.55 : 1,
        }}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={isWaiting || showRetryPanel}
      />

      {errorMsg && (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            color: "var(--coral)",
            padding: "9px 12px",
            border: "1px solid rgba(255,85,64,0.22)",
            borderRadius: 3,
            background: "rgba(255,85,64,0.05)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Waiting indicator */}
      {isWaiting && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(139,124,246,0.05)",
            border: "1px solid rgba(139,124,246,0.2)",
            borderRadius: 3,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#8B7CF6",
              display: "inline-block",
              flexShrink: 0,
              animation: "pulse-dot 1.4s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "#8B7CF6",
            }}
          >
            Knock sent — host deciding
          </span>
        </div>
      )}

      {/* Declined / timeout panel */}
      {showRetryPanel && (
        <div
          style={{
            background: "rgba(255,85,64,0.05)",
            border: "1px solid rgba(255,85,64,0.22)",
            borderLeft: "3px solid rgba(255,85,64,0.45)",
            borderRadius: 4,
            padding: "13px 13px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            animation: "slideIn 0.2s ease",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 12,
              color: "var(--coral)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "rgba(255,85,64,0.12)",
                border: "1px solid rgba(255,85,64,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                flexShrink: 0,
              }}
            >
              {isTimeout ? "⏱" : "✕"}
            </span>
            {isTimeout ? "No answer from host" : "Host passed on this one"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              color: "var(--muted)",
              letterSpacing: 0.3,
            }}
          >
            {isDebounced
              ? "Wait a moment before knocking again."
              : isTimeout
                ? "They may be busy. You can try again."
                : "They passed. You're welcome to try again."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <RetryCountdownButton
              endsAt={debounceEndsAt}
              onClick={handleRetry}
              label="↩ Knock Again"
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStatus("idle");
                setCode("");
                joinedMatchRef.current = null;
              }}
              style={{ fontSize: 12, padding: "0 13px", flexShrink: 0 }}
            >
              New code
            </button>
          </div>
        </div>
      )}

      {/* Primary join button */}
      {!isWaiting && !showRetryPanel && (
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={handleJoin}
          disabled={status === "joining" || code.length < 4}
        >
          {status === "joining" ? "Joining…" : "Join Room"}
        </button>
      )}

      {status === "idle" && (
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            color: "var(--muted)",
            letterSpacing: 0.4,
            lineHeight: 1.7,
            textAlign: "center",
            margin: 0,
          }}
        >
          Ask your opponent to share their room code.
          <br />
          Codes expire when the host closes the room.
        </p>
      )}
    </div>
  );
}

//  Main Screen

export default function RoomScreen({ onBack, onJoin }: Props) {
  const [tab, setTab] = useState<Tab>("create");
  const [restoredRoom, setRestoredRoom] = useState<{
    matchId: string;
    roomCode: string;
    expiresAt?: number;
  } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("xo_active_room");
    if (stored) {
      try {
        const { matchId, roomCode, expiresAt } = JSON.parse(stored);
        setRestoredRoom({ matchId, roomCode, expiresAt });
        setTab("create");
      } catch {
        localStorage.removeItem("xo_active_room");
      }
    }
  }, []);

  return (
    <div
      className="screen"
      role="main"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes pulse-dot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.65); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <span
        className="bg-glyph pulse"
        style={{ fontSize: 200, right: -30, top: -20 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph"
        style={{ fontSize: 150, left: -20, bottom: 80, animationDelay: "2s" }}
        aria-hidden
      >
        O
      </span>

      <header className="topbar" style={{ flexShrink: 0 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ←
        </button>
        <div className="topbar-logo">
          XO<span className="topbar-logo-accent">.</span>
        </div>
        <span className="pill pill-teal">
          <span className="dot dot-teal" />
          Online
        </span>
      </header>

      <section
        style={{
          padding: "20px var(--pad) 0",
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
        className="fade-up-1"
      >
        <span className="t-label">Room system</span>
        <h1 className="t-head-lg" style={{ marginTop: 6 }}>
          Create &amp;
          <br />
          Share
        </h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          Host a public room, invite with a code, or browse open games.
        </p>
        <div
          style={{
            marginTop: 10,
            padding: "8px 11px",
            background: "rgba(255,85,64,0.05)",
            border: "1px solid rgba(255,85,64,0.18)",
            borderLeft: "3px solid rgba(255,85,64,0.35)",
            borderRadius: 3,
            fontFamily: "var(--font-display)",
            fontSize: 10,
            color: "var(--coral)",
            letterSpacing: 0.4,
            lineHeight: 1.6,
            opacity: 0.85,
          }}
        >
          ⚠ Leaving this screen will close any room you've created. This will be
          improved soon.
        </div>
      </section>

      <div className="prog-bar" style={{ margin: "18px 0 0", flexShrink: 0 }} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling:
            "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          position: "relative",
          zIndex: 1,
          padding: "14px var(--pad) 32px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <TabBar active={tab} onChange={setTab} />
        {tab === "create" && (
          <CreateTab onJoin={onJoin} restoredRoom={restoredRoom} />
        )}
        {tab === "browse" && <BrowseTab onJoin={onJoin} />}
        {tab === "code" && <JoinCodeTab onJoin={onJoin} />}
      </div>

      <footer style={{ padding: "14px var(--pad)", flexShrink: 0 }}>
        <div className="prog-bar" style={{ marginBottom: 14 }} />
        <button
          type="button"
          className="btn btn-ghost btn-full"
          onClick={onBack}
        >
          ← Back
        </button>
      </footer>
    </div>
  );
}
