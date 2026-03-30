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

  // Shared handler: once any flow (matchmaking OR room) has a match ready,
  // stash the state and navigate to the game screen.
  const handleMatchFound = (
    matchId: string,
    opponentName: string,
    iAmX: boolean,
  ) => {
    setMatchState({ matchId, opponentName, iAmX });
    setScreen("game");
  };

  //  Landing
  if (screen === "landing") {
    return (
      <LandingScreen
        isOffline={isOffline}
        onStart={() => setScreen("home")}
        onPlayLocal={() => setScreen("local-game")}
      />
    );
  }

  //  Home
  if (screen === "home") {
    return (
      <HomeScreen
        isOffline={isOffline}
        onPlay={() => setScreen("modes")}
        onLocalGame={() => setScreen("local-game")}
        onProfile={() => setScreen("profile")}
        onLeaderboard={() => setScreen("leaderboard")}
      />
    );
  }

  //  Modes
  if (screen === "modes") {
    return (
      <ModesScreen
        isOffline={isOffline}
        onBack={() => setScreen("home")}
        onMatchmaking={() => setScreen("matchmaking")}
        onLocal={() => setScreen("local-game")}
        onAI={() => console.log("ai — coming soon")}
        onShare={() => setScreen("room")}
      />
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

  //  Room screen (Create & Share / Browse / Join by code)
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
