import { useEffect, useState } from "react";
import { connect, getProfile } from "../../services/nakamaClient";

type Props = {
  isOffline: boolean;
  onPlay: () => void;
  onLocalGame: () => void;
  onProfile: () => void;
  onLeaderboard: () => void;
};

type Profile = {
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  winStreak: number;
  bestStreak: number;
  username: string;
};

const cardBgStyle = (
  widthPct: string,
  right: number,
  bottom: number,
): React.CSSProperties => ({
  position: "absolute",
  right,
  bottom,
  width: widthPct,
  height: "auto",
  opacity: 0.12,
  pointerEvents: "none",
  maskImage: "linear-gradient(to right, transparent 0%, black 35%)",
  WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 35%)",
});

function StatCell({
  value,
  label,
  align = "left",
}: {
  value: number | string;
  label: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <div className="stat-cell" style={{ textAlign: align }}>
      <div className="t-stat">{value}</div>
      <div className="t-label" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

export default function HomeScreen({
  isOffline,
  onPlay,
  onLocalGame,
  onProfile,
  onLeaderboard,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOffline) {
      setUsername(localStorage.getItem("xo_username") || "Guest");
      setLoading(false);
      return;
    }
    const init = async () => {
      try {
        const { session } = await connect();
        const profileData = await getProfile(session);
        setProfile(profileData as Profile | null);
        setDeviceId(localStorage.getItem("xo_device_id") || "");
        setUsername((profileData as Profile | null)?.username || "Guest");
      } catch {
        setUsername(localStorage.getItem("xo_username") || "Guest");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [isOffline]);

  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const draws = profile?.draws ?? 0;
  const winStreak = profile?.winStreak ?? 0;
  const rating = profile?.rating ?? "-";
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  return (
    <div className="screen" role="main">
      <span
        className="bg-glyph pulse"
        style={{ fontSize: 220, right: -30, top: -20 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph"
        style={{ fontSize: 160, left: -20, bottom: 80, animationDelay: "2s" }}
        aria-hidden
      >
        O
      </span>

      {/* topbar */}
      <header className="topbar">
        <div className="topbar-logo">
          XO<span className="topbar-logo-accent">.</span>
        </div>
        {isOffline ? (
          <span
            className="pill"
            style={{
              borderColor: "var(--coral)",
              color: "var(--coral)",
              fontSize: 9,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--coral)",
                marginRight: 5,
              }}
            />
            Offline
          </span>
        ) : (
          <span className="pill pill-teal">
            <span className="dot dot-teal" />
            Online
          </span>
        )}
      </header>

      {/* hero */}
      <section
        style={{
          padding: "24px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-1"
      >
        <span className="t-label">Operator</span>
        <h1 className="t-head-lg" style={{ marginTop: 8 }}>
          {loading ? (
            <span className="blink" style={{ color: "var(--muted)" }}>
              ▪▪▪
            </span>
          ) : (
            username
          )}
        </h1>
        <div className="flex items-center gap-8" style={{ marginTop: 10 }}>
          {isOffline ? (
            <span className="t-label" style={{ color: "var(--muted)" }}>
              Stats unavailable offline
            </span>
          ) : (
            <>
              <span className="t-label">Rating</span>
              <span
                className="t-coord"
                style={{
                  color: "var(--coral)",
                  fontSize: 12,
                  letterSpacing: 1,
                }}
              >
                {loading ? "—" : rating}
              </span>
              {winStreak > 1 && (
                <span className="pill pill-coral" style={{ marginLeft: 4 }}>
                  🔥 {winStreak} streak
                </span>
              )}
            </>
          )}
        </div>
      </section>

      {/* win rate — online only */}
      {!isOffline && (
        <div
          style={{
            padding: "16px var(--pad) 0",
            position: "relative",
            zIndex: 1,
          }}
          className="fade-up-2"
        >
          <div
            className="flex justify-between items-center"
            style={{ marginBottom: 6 }}
          >
            <span className="t-label">Win rate</span>
            <span className="t-coord" style={{ color: "var(--coral)" }}>
              {loading ? "—" : `${winRate}%`}
            </span>
          </div>
          <div className="prog-bar">
            <div
              className="prog-fill"
              style={{
                width: loading ? "0%" : `${winRate}%`,
                transition: "width 0.6s steps(10)",
              }}
            />
          </div>
        </div>
      )}

      {/* stats — online only */}
      {!isOffline && (
        <section
          style={{
            padding: "16px var(--pad) 0",
            position: "relative",
            zIndex: 1,
          }}
          className="fade-up-3"
        >
          <span
            className="t-label"
            style={{ display: "block", marginBottom: 10 }}
          >
            Quick stats
          </span>
          <div className="stat-grid-3">
            <StatCell value={loading ? "—" : wins} label="Wins" align="left" />
            <div className="stat-div" />
            <StatCell
              value={loading ? "—" : losses}
              label="Losses"
              align="center"
            />
            <div className="stat-div" />
            <StatCell
              value={loading ? "—" : draws}
              label="Draws"
              align="right"
            />
          </div>
          <div
            className="stat-grid"
            style={{ marginTop: 3, borderTop: "none" }}
          >
            <StatCell
              value={loading ? "—" : winStreak}
              label="Current streak"
              align="left"
            />
            <div className="stat-div" />
            <StatCell
              value={loading ? "—" : (profile?.bestStreak ?? 0)}
              label="Best streak"
              align="right"
            />
          </div>
        </section>
      )}

      <div
        style={{
          padding: "20px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-4"
      >
        <span className="t-label">Actions</span>
      </div>

      {/* PLAY card — online shows matchmaking, offline shows local */}
      <div
        style={{
          padding: "10px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-4"
      >
        {isOffline ? (
          <button
            className="mode-card"
            onClick={onLocalGame}
            type="button"
            style={{
              width: "100%",
              textAlign: "left",
              display: "block",
              minHeight: 116,
              overflow: "hidden",
            }}
          >
            <div
              className="mode-card-bar"
              style={{
                background:
                  "linear-gradient(to bottom, var(--amber), var(--amber-dim))",
              }}
            />
            <span className="mode-card-coord">01 / LOCAL</span>
            <img
              src="public/spartan.svg"
              aria-hidden
              style={cardBgStyle("78%", -10, -14)}
            />
            <span
              className="t-cardnum"
              style={{ position: "relative", zIndex: 1 }}
            >
              ⚔
            </span>
            <div
              className="t-head"
              style={{
                marginTop: 4,
                fontSize: 26,
                position: "relative",
                zIndex: 1,
              }}
            >
              Local Duel
            </div>
            <p
              className="t-body"
              style={{ marginTop: 4, position: "relative", zIndex: 1 }}
            >
              Pass &amp; Play · Same screen
            </p>
          </button>
        ) : (
          <button
            className="mode-card"
            onClick={onPlay}
            type="button"
            style={{
              width: "100%",
              textAlign: "left",
              display: "block",
              minHeight: 116,
              overflow: "hidden",
            }}
          >
            <div className="mode-card-bar" />
            <span className="mode-card-coord">01 / MATCH</span>
            <img
              src="public/world-map.svg"
              aria-hidden
              style={cardBgStyle("78%", -10, -14)}
            />
            <div
              className="t-head"
              style={{
                marginTop: 4,
                fontSize: 26,
                position: "relative",
                zIndex: 1,
              }}
            >
              Start
            </div>
            <p
              className="t-body"
              style={{ marginTop: 4, position: "relative", zIndex: 1 }}
            >
              Pass &amp; Play · Worldwide · Share Code
            </p>
          </button>
        )}
      </div>

      {/* Profile + Leaderboard — dimmed offline */}
      <section
        style={{
          padding: "8px var(--pad) 0",
          display: "flex",
          gap: 8,
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-5"
      >
        <button
          className="mode-card"
          onClick={isOffline ? undefined : onProfile}
          type="button"
          disabled={isOffline}
          style={{
            flex: 1,
            textAlign: "left",
            padding: "18px 16px",
            minHeight: 120,
            overflow: "hidden",
            opacity: isOffline ? 0.38 : 1,
            cursor: isOffline ? "not-allowed" : "pointer",
          }}
        >
          <div
            className="mode-card-bar"
            style={{
              background:
                "linear-gradient(to bottom, var(--amber), var(--amber-dim))",
            }}
          />
          <span
            className="mode-card-coord"
            style={{ fontSize: 9, top: 10, right: 10 }}
          >
            02
          </span>
          <img
            src="public/fingerprint.svg"
            aria-hidden
            style={cardBgStyle("70%", -4, -8)}
          />
          <div
            className="t-head"
            style={{
              fontSize: 20,
              marginTop: 28,
              position: "relative",
              zIndex: 1,
            }}
          >
            Profile
          </div>
          <p
            className="t-body"
            style={{
              marginTop: 3,
              fontSize: 11,
              position: "relative",
              zIndex: 1,
            }}
          >
            Stats &amp; history
          </p>
        </button>

        <button
          className="mode-card"
          onClick={isOffline ? undefined : onLeaderboard}
          type="button"
          disabled={isOffline}
          style={{
            flex: 1,
            textAlign: "left",
            padding: "18px 16px",
            minHeight: 120,
            overflow: "hidden",
            opacity: isOffline ? 0.38 : 1,
            cursor: isOffline ? "not-allowed" : "pointer",
          }}
        >
          <div
            className="mode-card-bar"
            style={{
              background:
                "linear-gradient(to bottom, var(--teal), var(--teal-dim))",
            }}
          />
          <span
            className="mode-card-coord"
            style={{ fontSize: 9, top: 10, right: 10 }}
          >
            03
          </span>
          <img
            src="public/crown.svg"
            aria-hidden
            style={cardBgStyle("65%", -8, -8)}
          />
          <div
            className="t-head"
            style={{
              fontSize: 20,
              marginTop: 28,
              position: "relative",
              zIndex: 1,
            }}
          >
            Ranks
          </div>
          <p
            className="t-body"
            style={{
              marginTop: 3,
              fontSize: 11,
              position: "relative",
              zIndex: 1,
            }}
          >
            Global leaderboard
          </p>
        </button>
      </section>

      <div style={{ flex: 1 }} />

      <div className="fade-up-6">
        <div className="device-tag">
          <span className="device-tag-label">Device</span>
          <span className="device-tag-value">
            {deviceId ? deviceId.slice(0, 8).toUpperCase() + "···" : "--------"}
          </span>
        </div>
      </div>
    </div>
  );
}
