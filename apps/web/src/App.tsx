import { useState, useEffect } from "react";
import LandingScreen from "./features/landing/LandingScreen";
import HomeScreen from "./features/home/HomeScreen";
import ModesScreen from "./features/modes/ModesScreen";
import MatchmakingScreen from "./features/matchmaking/MatchmakingScreen";
import LocalGameScreen from "./features/game/LocalGame";

type Screen =
  | "landing"
  | "home"
  | "modes"
  | "matchmaking"
  | "game"
  | "local-game";

interface MatchState {
  matchId: string;
  opponentName: string;
  iAmX: boolean;
}

// Set to true to force-test offline UI without killing your network
const DEBUG_FORCE_OFFLINE = false;

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

  if (screen === "landing") {
    return (
      <LandingScreen
        isOffline={isOffline}
        onStart={() => setScreen("home")}
        onPlayLocal={() => setScreen("local-game")}
      />
    );
  }

  if (screen === "home") {
    return (
      <HomeScreen
        isOffline={isOffline}
        onPlay={() => setScreen("modes")}
        onLocalGame={() => setScreen("local-game")}
        onProfile={() => console.log("go profile")}
        onLeaderboard={() => console.log("go leaderboard")}
      />
    );
  }

  if (screen === "modes") {
    return (
      <ModesScreen
        isOffline={isOffline}
        onBack={() => setScreen("home")}
        onMatchmaking={() => setScreen("matchmaking")}
        onLocal={() => setScreen("local-game")}
        onAI={() => console.log("ai")}
        onShare={() => console.log("share")}
      />
    );
  }

  if (screen === "matchmaking") {
    return (
      <MatchmakingScreen
        onMatchFound={(matchId, opponentName, iAmX) => {
          setMatchState({ matchId, opponentName, iAmX });
          setScreen("game");
        }}
        onCancel={() => setScreen("modes")}
      />
    );
  }

  if (screen === "local-game") {
    return (
      <LocalGameScreen
        onBack={() => setScreen(screen === "local-game" ? "modes" : "modes")}
      />
    );
  }

  if (screen === "game" && matchState) {
    return (
      <div className="screen">
        <div style={{ padding: "var(--pad)" }}>
          <h1 className="t-head-lg">Game</h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            Match ID: <code>{matchState.matchId}</code>
          </p>
          <p className="t-body" style={{ marginTop: 4 }}>
            Opponent: <strong>{matchState.opponentName}</strong>
          </p>
          <p className="t-body" style={{ marginTop: 4 }}>
            You play as: <strong>{matchState.iAmX ? "X" : "O"}</strong>
          </p>
          <button
            className="btn btn-ghost btn-full"
            style={{ marginTop: 24 }}
            onClick={() => setScreen("modes")}
            type="button"
          >
            ← Back to modes
          </button>
        </div>
      </div>
    );
  }

  return null;
}
