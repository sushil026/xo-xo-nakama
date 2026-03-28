import { useEffect, useState } from "react";
import { connect, setupUser } from "../../services/nakamaClient";
import { generateUsername } from "../../utils/usernameGenerator";
import type { Session } from "@heroiclabs/nakama-js";

export default function LandingScreen({ onStart }: { onStart: () => void }) {
  const [username, setUsername] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await connect();

        setSession(res.session);

        if (!res.username) {
          setIsNewUser(true);
          setUsername(generateUsername());
        } else {
          localStorage.setItem("username", res.username);
          onStart();
        }
      } catch (err) {
        console.error("Init error:", err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [onStart]);

  const regenerate = () => {
    setUsername(generateUsername());
  };

  const confirmName = async () => {
    if (!session) return;

    try {
      await setupUser(session, username);
      onStart();
    } catch (err) {
      console.error("Setup error:", err);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1 className="pixel-title">TIC TAC TOE</h1>

      {isNewUser && (
        <>
          <p>Choose your name:</p>
          <h3>{username}</h3>

          <button onClick={regenerate}>
            🔄 New Name
          </button>

          <button onClick={confirmName}>
            ✅ Confirm & Start
          </button>
        </>
      )}
    </div>
  );
}
