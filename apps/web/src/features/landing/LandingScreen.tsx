import { useEffect, useRef, useState, useCallback } from "react";
import { connect, setupUser } from "../../services/nakamaClient";
import {
  randomSuggestions,
  generateUsername,
} from "../../utils/usernameGenerator";
import type { Session } from "@heroiclabs/nakama-js";

//  Types
type Phase =
  | "connecting" // booting, talking to Nakama
  | "new_user" // first time — show name picker
  | "saving" // user hit confirm, waiting for server
  | "done"; // redirect (existing or just saved)

// Subcomponents

function LoadingScreen() {
  return (
    <div className="loading-screen">
      {/* background glyphs */}
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

        <div
          className="t-label mt-16"
          style={{ display: "block", marginBottom: 12 }}
        >
          Connecting<span className="blink">...</span>
        </div>

        <div className="loading-bar-wrap" style={{ margin: "0 auto" }}>
          <div className="loading-bar-fill" />
        </div>
      </div>
    </div>
  );
}

interface DeviceTagProps {
  deviceId: string;
}

function DeviceTag({ deviceId }: DeviceTagProps) {
  // Show only the first 8 chars normally; reveal full on hover/tap
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

// Main component
interface LandingScreenProps {
  onStart: () => void;
}

export default function LandingScreen({ onStart }: LandingScreenProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [, setUsername] = useState("");
  const [inputVal, setInputVal] = useState(""); // controlled input
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const onStartRef = useRef(onStart);

  // ── Keep onStartRef in sync ──
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  // ── Initialise ──
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const res = await connect();
        if (cancelled) return;

        setDeviceId(res.deviceId);
        sessionRef.current = res.session;

        if (res.username) {
          // Returning user — skip screen
          localStorage.setItem("xo_username", res.username);
          setPhase("done");
          onStartRef.current();
        } else {
          // New user — generate a suggested name and show picker
          const generated = generateUsername();
          setUsername(generated);
          setInputVal(generated);
          setSuggestions(randomSuggestions(4));
          setPhase("new_user");
        }
      } catch (err) {
        console.warn("Initial connect failed, retrying...", err);

        // 🔁 retry once silently
        try {
          const retry = await connect();

          if (cancelled) return;

          setDeviceId(retry.deviceId);
          sessionRef.current = retry.session;

          if (retry.username) {
            localStorage.setItem("xo_username", retry.username);
            setPhase("done");
            onStartRef.current();
            return;
          }
        } catch (retryErr) {
          console.warn("Retry also failed", retryErr);
        }

        // fallback → still usable UI
        const generated = generateUsername();
        setUsername(generated);
        setInputVal(generated);
        setSuggestions(randomSuggestions(4));

        // ❌ REMOVE scary error
        setError(""); // 👈 key change

        setPhase("new_user");
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []); // intentionally empty — runs once

  const reroll = useCallback(() => {
    const next = generateUsername();
    setUsername(next);
    setInputVal(next);
    setSuggestions(randomSuggestions(4));
    setError("");
  }, []);

  const pickSuggestion = useCallback((name: string) => {
    setUsername(name);
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

  // ── Render: loading ──
  if (phase === "connecting") {
    return <LoadingScreen />;
  }

  // ── Render: returning user redirecting (flicker-free) ──
  if (phase === "done") {
    return null;
  }

  // ── Render: new user name picker ──
  const charCount = inputVal.length;
  const isSaving = phase === "saving";
  const canConfirm = !isSaving && charCount >= 3;
  const progress = Math.min((charCount / 16) * 100, 100);

  return (
    <div className="screen" role="main">
      {/* Background glyphs */}
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

      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-logo">
          XO<span className="topbar-logo-accent">.</span>
        </div>
      </header>

      {/* Hero section */}
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

      {/* Input section */}
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
          style={{
            display: "flex",
            alignItems: "center",
            minHeight: "48px",
          }}
        >
          {inputVal}
        </h2>

        {/* Inline progress bar — fills as you type */}
        <div className="prog-bar" style={{ marginTop: 6 }}>
          <div className="prog-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>

      {/* Suggestion chips */}
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

      {/* Error message */}
      {error && (
        <div
          className="error-msg fade-up"
          style={{ margin: "16px var(--pad) 0" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* CTA footer */}
      <footer
        style={{ padding: "0 var(--pad)", position: "relative", zIndex: 1 }}
        className="fade-up-4"
      >
        {/* Session progress hint */}
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
              <span className="blink">▪</span>
              Saving callsign
            </>
          ) : (
            "Confirm callsign →"
          )}
        </button>
      </footer>

      {/* Device ID — tasteful footer identifier */}
      <div className="fade-up-5">
        <DeviceTag deviceId={deviceId} />
      </div>
    </div>
  );
}
