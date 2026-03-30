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

/**
 * Attach a one-shot match data handler that fires onJoin once both players
 * are present in the state broadcast, then removes itself.
 *
 * KEY FIX: we use a ref-based approach so we never clobber an existing
 * onmatchdata listener that may be set by OnlineGameScreen after navigation.
 * The listener removes itself after the first successful two-player state.
 */
function waitForOpponent(
  socket: ReturnType<typeof import("../../services/nakamaClient").getSocket>,
  myUserId: string,
  onJoin: Props["onJoin"],
  matchId: string,
) {
  const prev = socket.onmatchdata;

  socket.onmatchdata = (data) => {
    try {
      const state = JSON.parse(new TextDecoder().decode(data.data)) as {
        players?: { userId: string; username: string; symbol: string }[];
      };

      if (state.players && state.players.length === 2) {
        // Restore previous listener before navigating away
        socket.onmatchdata = prev ?? null;

        const me = state.players.find((p) => p.userId === myUserId);
        const opponent = state.players.find((p) => p.userId !== myUserId);
        onJoin(matchId, opponent?.username ?? "Opponent", me?.symbol === "X");
        return;
      }
    } catch {
      // not a state message — pass through to previous listener
    }

    // Not a two-player state yet — forward to previous listener if any
    if (prev) prev(data);
  };
}

//  Tab bar

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

//  Create tab

function CreateTab({ onJoin }: { onJoin: Props["onJoin"] }) {
  const [isPublic, setIsPublic] = useState(true);
  const [status, setStatus] = useState<
    "idle" | "creating" | "waiting" | "error"
  >("idle");
  const [roomCode, setRoomCode] = useState("");
  const [matchId, setMatchId] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleCreate = async () => {
    setStatus("creating");
    setErrorMsg("");
    try {
      const { session, socket } = await connect();
      const result = await createRoom(session, isPublic);

      setRoomCode(result.roomCode);
      setMatchId(result.matchId);
      setStatus("waiting");

      // Set up listener BEFORE joining so we don't miss the broadcast
      waitForOpponent(socket, session.user_id!, onJoin, result.matchId);

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

  //  Waiting state
  if (status === "waiting") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          alignItems: "center",
        }}
      >
        {/* Code card */}
        <div
          style={{
            width: "100%",
            background: "rgba(139,124,246,0.07)",
            border: "1px solid rgba(139,124,246,0.25)",
            borderLeft: "3px solid rgba(139,124,246,0.6)",
            borderRadius: 4,
            padding: "18px 16px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#8B7CF6",
              marginBottom: 10,
            }}
          >
            ▸ Room created · {isPublic ? "Public" : "Private"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: 8,
              color: "var(--soft)",
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            {roomCode}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              color: "var(--muted)",
              letterSpacing: 1,
            }}
          >
            Share this code · Expires when match ends
          </div>
        </div>

        {/* Waiting indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--muted)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#8B7CF6",
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
            Waiting for opponent…
          </span>
        </div>

        {/* Copy code only (copy link removed per request) */}
        <button
          type="button"
          className="btn btn-ghost btn-full"
          onClick={handleCopy}
          style={{ fontSize: 12 }}
        >
          {copied ? "✓ Copied" : "Copy Code"}
        </button>
      </div>
    );
  }

  //  Idle / error state
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Visibility toggle */}
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--rim)",
          borderRadius: 4,
          padding: "14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
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
              desc: "Listed in room browser · Anyone can join",
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
              gap: 12,
              padding: "12px 12px",
              background:
                isPublic === opt.value
                  ? `rgba(${opt.rgb},0.07)`
                  : "transparent",
              border: `1px solid ${
                isPublic === opt.value ? `rgba(${opt.rgb},0.35)` : "var(--rim)"
              }`,
              borderRadius: 3,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                flexShrink: 0,
                marginTop: 1,
                border: `2px solid ${isPublic === opt.value ? opt.color : "var(--muted)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isPublic === opt.value && (
                <div
                  style={{
                    width: 8,
                    height: 8,
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
                  marginTop: 3,
                  letterSpacing: 0.5,
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
            padding: "10px 12px",
            border: "1px solid rgba(255,85,64,0.25)",
            borderRadius: 3,
            background: "rgba(255,85,64,0.06)",
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

//  Browse tab

function BrowseTab({ onJoin }: { onJoin: Props["onJoin"] }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [myUserId, setMyUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchRooms = useCallback(async () => {
    try {
      const { session } = await connect();
      setMyUserId(session.user_id ?? "");
      // listPublicRooms calls the xo_list_public_rooms RPC which:
      //   1. Hard-filters to label === "waiting_public" server-side
      //   2. Returns hostUserId + hostUsername from room_index storage
      const list = await listPublicRooms(session);
      setRooms(list);
      setError("");
    } catch {
      setError("Could not load rooms. Tap refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const id = setInterval(fetchRooms, 5000);
    return () => clearInterval(id);
  }, [fetchRooms]);

  const handleJoin = async (matchId: string) => {
    setJoiningId(matchId);
    try {
      const { session, socket } = await connect();
      waitForOpponent(socket, session.user_id!, onJoin, matchId);
      await socket.joinMatch(matchId);
    } catch {
      setError("Failed to join. The room may have just been taken.");
      setJoiningId(null);
      fetchRooms();
    }
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
            width: 8,
            height: 8,
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

  // Server already filters private rooms. Filter own room client-side too
  // (hostUserId is now populated from room_index, so this actually works).
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
          <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 12 }}>○</div>
          No open rooms right now
          <br />
          <span style={{ opacity: 0.6 }}>Create one or check back soon</span>
        </div>
      ) : (
        othersRooms.map((room) => {
          const isOwn = room.hostUserId === myUserId;
          // Prefer username, fall back to first 8 chars of userId, then "Unknown"
          const displayName =
            room.hostUsername ||
            (room.hostUserId
              ? room.hostUserId.slice(0, 8).toUpperCase()
              : "Unknown");

          return (
            <div
              key={room.matchId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--rim)",
                borderRadius: 4,
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* "PLAYERNAME's room" — primary identifier */}
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 14,
                    fontWeight: 900,
                    letterSpacing: 0.5,
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

                {/* Slot indicator + waiting label */}
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    color: "var(--muted)",
                    marginTop: 4,
                    letterSpacing: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--coral)",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {/* Show filled slots out of 2 */}
                  {room.size} / 2 · Waiting for opponent
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => !isOwn && handleJoin(room.matchId)}
                disabled={joiningId !== null || isOwn}
                style={{ fontSize: 11, padding: "8px 16px", flexShrink: 0 }}
              >
                {isOwn
                  ? "Your room"
                  : joiningId === room.matchId
                    ? "Joining…"
                    : "Join"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

//  Join by code tab

function JoinCodeTab({ onJoin }: { onJoin: Props["onJoin"] }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "joining" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

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
      const { session, socket } = await connect();
      const result = await joinByCode(session, clean);

      if (!result.ok) {
        setStatus("error");
        setErrorMsg(
          result.error === "not_found"
            ? "Room not found. Check the code and try again."
            : result.error === "full"
              ? "That room is already full."
              : "Something went wrong. Try again.",
        );
        return;
      }

      // Set listener BEFORE joinMatch
      waitForOpponent(socket, session.user_id!, onJoin, result.matchId);
      await socket.joinMatch(result.matchId);
    } catch {
      setStatus("error");
      setErrorMsg("Connection error. Check your network and try again.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
        onKeyDown={(e) => e.key === "Enter" && handleJoin()}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 8,
          textAlign: "center",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${status === "error" ? "rgba(255,85,64,0.5)" : "var(--rim)"}`,
          borderRadius: 4,
          padding: "16px 12px",
          color: "var(--soft)",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          textTransform: "uppercase",
        }}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />

      {errorMsg && (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            color: "var(--coral)",
            padding: "10px 12px",
            border: "1px solid rgba(255,85,64,0.25)",
            borderRadius: 3,
            background: "rgba(255,85,64,0.06)",
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-full"
        onClick={handleJoin}
        disabled={status === "joining" || code.length < 4}
      >
        {status === "joining" ? "Joining…" : "Join Room"}
      </button>

      <p
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 10,
          color: "var(--muted)",
          letterSpacing: 0.5,
          lineHeight: 1.7,
          textAlign: "center",
          margin: 0,
        }}
      >
        Ask your opponent to share their room code.
        <br />
        Codes expire when the match ends.
      </p>
    </div>
  );
}

//  Main screen

export default function RoomScreen({ onBack, onJoin }: Props) {
  const [tab, setTab] = useState<Tab>("create");

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
          50%      { opacity: 0.4; transform: scale(0.7); }
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

      {/* Topbar */}
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

      {/* Header */}
      <section
        style={{
          padding: "24px var(--pad) 0",
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
        className="fade-up-1"
      >
        <span className="t-label">Room system</span>
        <h1 className="t-head-lg" style={{ marginTop: 8 }}>
          Create &amp;
          <br />
          Share
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          Host a public room, invite with a code, or browse open games.
        </p>
      </section>

      <div className="prog-bar" style={{ margin: "20px 0 0", flexShrink: 0 }} />

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling:
            "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          position: "relative",
          zIndex: 1,
          padding: "16px var(--pad) 32px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <TabBar active={tab} onChange={setTab} />

        {tab === "create" && <CreateTab onJoin={onJoin} />}
        {tab === "browse" && <BrowseTab onJoin={onJoin} />}
        {tab === "code" && <JoinCodeTab onJoin={onJoin} />}
      </div>

      {/* Footer */}
      <footer style={{ padding: "16px var(--pad)", flexShrink: 0 }}>
        <div className="prog-bar" style={{ marginBottom: 16 }} />
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
