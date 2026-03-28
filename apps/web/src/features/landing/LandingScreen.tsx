import { useEffect, useRef, useState, useCallback } from "react";
import { connect, setupUser } from "../../services/nakamaClient";
import {
  randomSuggestions,
  generateUsername,
} from "../../utils/usernameGenerator";
import type { Session } from "@heroiclabs/nakama-js";

type Phase = "connecting" | "new_user" | "saving" | "done";

// Returning user = has both a stored device id and username
function hasStoredSession(): boolean {
  return !!(
    localStorage.getItem("xo_device_id") && localStorage.getItem("xo_username")
  );
}

interface Props {
  isOffline: boolean;
  onStart: () => void;
  onPlayLocal: () => void;
}

function LoadingScreen({
  isOffline,
  onPlayLocal,
}: {
  isOffline: boolean;
  onPlayLocal: () => void;
}) {
  return (
    <div className="loading-screen">
      <span
        className="bg-glyph pulse"
        style={{ fontSize: 220, right: -30, top: -20 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph pulse"
        style={{ fontSize: 160, left: -20, bottom: 60, animationDelay: "2s" }}
        aria-hidden
      >
        O
      </span>

      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div className="loading-logo">
          XO<span className="loading-logo-accent">.</span>
        </div>

        {isOffline ? (
          <>
            <div
              className="t-label mt-16"
              style={{
                display: "block",
                marginBottom: 16,
                color: "var(--coral)",
              }}
            >
              No connection detected
            </div>
            <p
              className="t-body"
              style={{ marginBottom: 20, color: "var(--soft)" }}
            >
              Online features unavailable.
            </p>
            <button
              className="btn btn-primary"
              onClick={onPlayLocal}
              type="button"
            >
              Play Local →
            </button>
          </>
        ) : (
          <>
            <div
              className="t-label mt-16"
              style={{ display: "block", marginBottom: 12 }}
            >
              Connecting<span className="blink">...</span>
            </div>
            <div className="loading-bar-wrap" style={{ margin: "0 auto" }}>
              <div className="loading-bar-fill" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DeviceTag({ deviceId }: { deviceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const short = deviceId ? deviceId.slice(0, 8).toUpperCase() : "--------";
  const full = deviceId ? deviceId.toUpperCase() : "";

  return (
    <div className="device-tag" title="Your device identifier">
      <span className="device-tag-label">Device</span>
      <span
        className="device-tag-value"
        onClick={() => setExpanded((v) => !v)}
        title={full}
        style={{ cursor: "pointer" }}
      >
        {expanded ? full : `${short}···`}
      </span>
      {expanded && (
        <span
          className="t-coord"
          style={{ marginLeft: "auto", flexShrink: 0, cursor: "pointer" }}
          onClick={() => {
            navigator.clipboard?.writeText(deviceId).catch(() => {});
            setExpanded(false);
          }}
        >
          copy
        </span>
      )}
    </div>
  );
}

export default function LandingScreen({
  isOffline,
  onStart,
  onPlayLocal,
}: Props) {
  const [phase, setPhase] = useState<Phase>(
    hasStoredSession() ? "done" : "connecting",
  );
  const initialUsername = generateUsername();
  const [inputVal, setInputVal] = useState(initialUsername);
  const [suggestions, setSuggestions] = useState(randomSuggestions(4));
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const onStartRef = useRef(onStart);

  const prepareNewUser = () => {
    const generated = generateUsername();
    const suggestions = randomSuggestions(4);
    setInputVal(generated);
    setSuggestions(suggestions);
    setError("");
    setPhase("new_user");
  };

  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  useEffect(() => {
    if (phase === "done") {
      onStartRef.current();
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "connecting") return;
    let cancelled = false;
    const run = async () => {
      if (isOffline) {
        if (cancelled) return;
        prepareNewUser();
        return;
      }
      try {
        const res = await connect();
        if (cancelled) return;
        setDeviceId(res.deviceId);
        sessionRef.current = res.session;
        if (res.username) {
          localStorage.setItem("xo_username", res.username);
          setPhase("done");
        } else {
          prepareNewUser();
        }
      } catch (err) {
        console.warn("Connect failed, retrying...", err);
        try {
          const retry = await connect();
          if (cancelled) return;
          setDeviceId(retry.deviceId);
          sessionRef.current = retry.session;
          if (retry.username) {
            localStorage.setItem("xo_username", retry.username);
            setPhase("done");
            return;
          }
        } catch (retryErr) {
          console.warn("Retry failed", retryErr);
        }
        prepareNewUser();
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [phase, isOffline]);

  const reroll = useCallback(() => {
    const next = generateUsername();
    setInputVal(next);
    setSuggestions(randomSuggestions(4));
    setError("");
  }, []);

  const pickSuggestion = useCallback((name: string) => {
    setInputVal(name);
    setError("");
  }, []);

  const handleConfirm = async () => {
    const trimmed = inputVal.trim();
    if (!trimmed) {
      setError("Callsign cannot be empty.");
      return;
    }
    if (trimmed.length < 3) {
      setError("Callsign must be at least 3 characters.");
      return;
    }

    // Offline: just save locally and go
    if (isOffline) {
      localStorage.setItem("xo_username", trimmed);
      onPlayLocal();
      return;
    }

    if (!sessionRef.current) {
      setError("Not connected — please wait or reload.");
      return;
    }

    setPhase("saving");
    setError("");
    try {
      const finalName = await setupUser(sessionRef.current, trimmed);
      localStorage.setItem("xo_username", finalName);
      setPhase("done");
      onStartRef.current();
    } catch (err) {
      console.error("Setup error:", err);
      setError("Failed to save callsign. Please try again.");
      setPhase("new_user");
    }
  };

  if (phase === "connecting")
    return <LoadingScreen isOffline={isOffline} onPlayLocal={onPlayLocal} />;
  if (phase === "done") return null;

  const charCount = inputVal.length;
  const isSaving = phase === "saving";
  const canConfirm = !isSaving && charCount >= 3;
  const progress = Math.min((charCount / 16) * 100, 100);

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
        style={{ fontSize: 160, left: -20, bottom: 80 }}
        aria-hidden
      >
        O
      </span>

      <header className="topbar">
        <div className="topbar-logo">
          XO<span className="topbar-logo-accent">.</span>
        </div>
        {isOffline && (
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
        )}
      </header>

      <section
        style={{
          padding: "24px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-1"
      >
        <span className="t-label">Player identification</span>
        <div style={{ marginTop: 12 }}>
          <span className="t-display" style={{ display: "block" }}>
            X0.
          </span>
          <h1 className="t-head" style={{ marginTop: 4 }}>
            Pick your
            <br />
            callsign
          </h1>
        </div>
        <p className="t-body" style={{ marginTop: 10 }}>
          Your handle is how other players know you.
          <br />
          Pick something memorable.
        </p>
      </section>

      <section
        style={{
          padding: "16px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-2"
      >
        <span
          className="t-label"
          style={{ display: "block", marginBottom: 10 }}
        >
          Callsign
        </span>
        <h2
          className="field"
          style={{ display: "flex", alignItems: "center", minHeight: "48px" }}
        >
          {inputVal}
        </h2>
        <div className="prog-bar" style={{ marginTop: 6 }}>
          <div className="prog-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section
        style={{
          padding: "16px var(--pad) 0",
          position: "relative",
          zIndex: 1,
        }}
        className="fade-up-3"
      >
        <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
          {suggestions.map((name) => (
            <button
              key={name}
              className="name-chip"
              onClick={() => pickSuggestion(name)}
              disabled={isSaving}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={reroll}
          disabled={isSaving}
          type="button"
          style={{ marginTop: 12 }}
        >
          ↻ Reroll
        </button>
      </section>

      {error && (
        <div
          className="error-msg fade-up"
          style={{ margin: "16px var(--pad) 0" }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <footer
        style={{ padding: "0 var(--pad)", position: "relative", zIndex: 1 }}
        className="fade-up-4"
      >
        <div className="prog-bar" style={{ marginBottom: 16 }}>
          <div className="prog-fill" style={{ width: "20%" }} />
        </div>
        <button
          className="btn btn-primary btn-full"
          onClick={handleConfirm}
          disabled={!canConfirm}
          type="button"
          aria-busy={isSaving}
        >
          {isSaving ? (
            <>
              <span className="blink">▪</span> Saving callsign
            </>
          ) : isOffline ? (
            "Play Local →"
          ) : (
            "Confirm callsign →"
          )}
        </button>
        {isOffline && (
          <p
            className="t-label"
            style={{
              textAlign: "center",
              marginTop: 10,
              color: "var(--muted)",
            }}
          >
            Online features unavailable in offline mode
          </p>
        )}
      </footer>

      <div className="fade-up-5">
        <DeviceTag deviceId={deviceId} />
      </div>
    </div>
  );
}
