import { useState } from "react";
import LandingScreen from "./features/landing/LandingScreen";
import GameScreen from "./features/game/GameScreen";

function App() {
  const [started, setStarted] = useState(false);
  if (!started) {
    return <LandingScreen onStart={() => setStarted(true)} />;
  }
  return <GameScreen />;
}

export default App;
