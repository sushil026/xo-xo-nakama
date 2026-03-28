import { useState } from "react";
import LandingScreen from "./features/landing/LandingScreen";
import HomeScreen from "./features/home/HomeScreen";
import ModesScreen from "./features/modes/ModesScreen";

type Screen = "landing" | "home" | "modes" | "matchmaking" | "game";

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");

  if (screen === "landing") {
    return <LandingScreen onStart={() => setScreen("home")} />;
  }

  if (screen === "home") {
    return (
      <HomeScreen
        onPlay={() => setScreen("modes")}
        onProfile={() => console.log("go profile")}
        onLeaderboard={() => console.log("go leaderboard")}
      />
    );
  }

  if (screen === "modes") {
    return (
      <ModesScreen
        onBack={() => setScreen("home")}
        onMatchmaking={() => console.log("matchmaking")}
        onLocal={() => console.log("local")}
        onAI={() => console.log("ai")}
        onShare={() => console.log("share")}
      />
    );
  }

  return null;
}
