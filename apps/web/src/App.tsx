import { useState, useEffect } from "react";
import LandingScreen from "./features/landing/LandingScreen";
import HomeScreen from "./features/home/HomeScreen";
import ModesScreen from "./features/modes/ModesScreen";
import MatchmakingScreen from "./features/matchmaking/MatchmakingScreen";
import LocalGameScreen from "./features/game/LocalGame";
import OnlineGameScreen from "./features/game/OnlineGameScreen";

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
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Screen routing ──────────────────────────────────────────────────────────

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
        onBack={() => setScreen("modes")}
      />
    );
  }

  // ── Online game ─────────────────────────────────────────────────────────────
  // matchState is always set by MatchmakingScreen before we arrive here,
  // but we guard defensively in case of a stale navigation.
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

  // Fallback: stale "game" route with no match state → bounce to modes
  if (screen === "game" && !matchState) {
    setScreen("modes");
  }

  return null;
}