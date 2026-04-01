import { useState, useEffect } from "react";

import LandingScreen from "./features/landing/LandingScreen";
import HomeScreen from "./features/home/HomeScreen";
import ModesScreen from "./features/modes/ModesScreen";
import MatchmakingScreen from "./features/matchmaking/MatchmakingScreen";
import RoomScreen from "./features/rooms/RoomScreen";
import LocalGameScreen from "./features/game/LocalGame";
import OnlineGameScreen from "./features/game/OnlineGameScreen";
import ProfileScreen from "./features/profile/ProfileScreen";
import MatchHistoryScreen from "./features/profile/MatchHistoryScreen";
import LeaderboardScreen from "./features/leaderboard/LeaderboardScreen";

type Screen =
  | "landing"
  | "home"
  | "modes"
  | "matchmaking"
  | "room"
  | "game"
  | "local-game"
  | "profile"
  | "matchHistory"
  | "leaderboard";

interface MatchState {
  matchId: string;
  opponentName: string;
  iAmX: boolean;
}

const DEBUG_FORCE_OFFLINE = false;

function InstallBanner() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("xo_install_dismissed") === "1",
  );

  if (isStandalone || (!isIOS && !isAndroid) || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem("xo_install_dismissed", "1");
    setDismissed(true);
  };

  return (
    <>
      {/* Dark backdrop — click anywhere to dismiss */}
      <div
        onClick={dismiss}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 998,
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* Banner card */}
      <div
        style={{
          position: "fixed",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          width: "calc(100% - 48px)",
          maxWidth: 340,
          zIndex: 999,
          background: "rgba(14,14,14,0.98)",
          border: "1px solid rgba(139,124,246,0.4)",
          borderTop: "3px solid rgba(139,124,246,0.8)",
          borderRadius: 8,
          boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "#8B7CF6",
            }}
          >
            Install XO
          </div>
          <button
            type="button"
            onClick={dismiss}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "var(--muted)",
              fontSize: 12,
              cursor: "pointer",
              padding: "3px 8px",
              lineHeight: 1.4,
              fontFamily: "var(--font-display)",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: 0.4,
              lineHeight: 1.8,
              marginBottom: 14,
            }}
          >
            {isIOS ? (
              <>
                <div style={{ marginBottom: 8, color: "var(--soft)" }}>
                  Add to your home screen for the full app experience — no App
                  Store needed.
                </div>
                <div>
                  1. Tap the <span style={{ color: "#8B7CF6" }}>Share</span>{" "}
                  button in Safari
                </div>
                <div>
                  2. Scroll down and tap{" "}
                  <span style={{ color: "#8B7CF6" }}>Add to Home Screen</span>
                </div>
                <div>
                  3. Tap <span style={{ color: "#8B7CF6" }}>Add</span> to
                  confirm
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 8, color: "var(--soft)" }}>
                  Install as an app — plays fullscreen, no browser chrome.
                </div>
                <div>
                  1. Tap the <span style={{ color: "#8B7CF6" }}>⋮ menu</span> in
                  Chrome
                </div>
                <div>
                  2. Tap{" "}
                  <span style={{ color: "#8B7CF6" }}>Add to Home Screen</span>
                </div>
                <div>
                  3. Tap <span style={{ color: "#8B7CF6" }}>Add</span> to
                  confirm
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={dismiss}
            style={{
              width: "100%",
              padding: "10px",
              background: "rgba(139,124,246,0.12)",
              border: "1px solid rgba(139,124,246,0.3)",
              borderRadius: 4,
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: "#8B7CF6",
              cursor: "pointer",
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [isOffline, setIsOffline] = useState(
    DEBUG_FORCE_OFFLINE || !navigator.onLine,
  );

  useEffect(() => {
    if (DEBUG_FORCE_OFFLINE) return;
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleMatchFound = (
    matchId: string,
    opponentName: string,
    iAmX: boolean,
  ) => {
    setMatchState({ matchId, opponentName, iAmX });
    setScreen("game");
  };

  const banner = <InstallBanner />;

  //  Landing
  if (screen === "landing") {
    return (
      <>
        <LandingScreen
          isOffline={isOffline}
          onStart={() => setScreen("home")}
          onPlayLocal={() => setScreen("local-game")}
        />
        {banner}
      </>
    );
  }

  //  Home
  if (screen === "home") {
    return (
      <>
        <HomeScreen
          isOffline={isOffline}
          onPlay={() => setScreen("modes")}
          onLocalGame={() => setScreen("local-game")}
          onProfile={() => setScreen("profile")}
          onLeaderboard={() => setScreen("leaderboard")}
        />
        {banner}
      </>
    );
  }

  //  Modes
  if (screen === "modes") {
    return (
      <>
        <ModesScreen
          isOffline={isOffline}
          onBack={() => setScreen("home")}
          onMatchmaking={() => setScreen("matchmaking")}
          onLocal={() => setScreen("local-game")}
          onAI={() => console.log("ai — coming soon")}
          onShare={() => setScreen("room")}
        />
        {banner}
      </>
    );
  }

  //  Auto matchmaking
  if (screen === "matchmaking") {
    return (
      <MatchmakingScreen
        onMatchFound={handleMatchFound}
        onCancel={() => setScreen("modes")}
      />
    );
  }

  //  Room screen
  if (screen === "room") {
    return (
      <RoomScreen onBack={() => setScreen("modes")} onJoin={handleMatchFound} />
    );
  }

  //  Local game
  if (screen === "local-game") {
    return <LocalGameScreen onBack={() => setScreen("modes")} />;
  }

  //  Online game
  if (screen === "game" && matchState) {
    return (
      <OnlineGameScreen
        matchId={matchState.matchId}
        opponentName={matchState.opponentName}
        iAmX={matchState.iAmX}
        onBack={() => {
          setMatchState(null);
          setScreen("modes");
        }}
      />
    );
  }

  if (screen === "game" && !matchState) {
    setScreen("modes");
    return null;
  }

  //  Profile
  if (screen === "profile") {
    return (
      <ProfileScreen
        onBack={() => setScreen("home")}
        onMatchHistory={() => setScreen("matchHistory")}
      />
    );
  }

  //  Match history
  if (screen === "matchHistory") {
    return <MatchHistoryScreen onBack={() => setScreen("profile")} />;
  }

  //  Leaderboard
  if (screen === "leaderboard") {
    return <LeaderboardScreen onBack={() => setScreen("home")} />;
  }

  return null;
}
