/* eslint-disable @typescript-eslint/no-unused-vars */
import React from "react";

type Props = {
  isOffline: boolean;
  onBack: () => void;
  onMatchmaking: () => void;
  onLocal: () => void;
  onAI: () => void;
  onShare: () => void;
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
  opacity: 0.13,
  pointerEvents: "none",
  maskImage: "linear-gradient(to right, transparent 0%, black 40%)",
  WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 40%)",
});

function CardGlyph({
  children,
  color = "var(--coral)",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: "uppercase",
        color,
        marginBottom: 10,
        opacity: 0.8,
      }}
    >
      {children}
    </div>
  );
}

export default function ModesScreen({
  isOffline,
  onBack,
  onMatchmaking,
  onLocal,
  onAI,
  onShare,
}: Props) {
  return (
    <div
      className="screen"
      role="main"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <span
        className="bg-glyph pulse"
        style={{ fontSize: 200, right: -30, top: -20 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph"
        style={{ fontSize: 150, left: -20, bottom: 80, animationDelay: "2s" }}
        aria-hidden
      >
        O
      </span>

      {/* TOPBAR */}
      <header className="topbar" style={{ flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} type="button">
          ←
        </button>
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

      {/* SUB-HEADER */}
      <section
        style={{
          padding: "24px var(--pad) 0",
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
        className="fade-up-1"
      >
        <span className="t-label">Mode select</span>
        <h1 className="t-head-lg" style={{ marginTop: 8 }}>
          Choose
          <br />
          engagement
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          {isOffline
            ? "Offline — only local play available."
            : "Select your battlefield. Each mode runs independently."}
        </p>
      </section>

      <div className="prog-bar" style={{ margin: "20px 0 0", flexShrink: 0 }} />

      {/* SCROLLABLE MIDDLE */}
      <div
        style={
          {
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            position: "relative",
            zIndex: 1,
          } as React.CSSProperties
        }
      >
        <section
          style={{
            padding: "16px var(--pad) 0",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
          className="fade-up-2"
        >
          {/* WORLDWIDE — disabled offline */}
          <button
            className="mode-card"
            onClick={isOffline ? undefined : onMatchmaking}
            type="button"
            disabled={isOffline}
            style={{
              minHeight: 116,
              textAlign: "left",
              overflow: "hidden",
              opacity: isOffline ? 0.35 : 1,
              cursor: isOffline ? "not-allowed" : "pointer",
            }}
          >
            <div className="mode-card-bar" />
            <span className="mode-card-coord">01 / LIVE</span>
            <img
              src="/radar.svg"
              aria-hidden
              style={cardBgStyle("78%", -10, -10)}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <CardGlyph color="var(--coral)">
                {isOffline ? "▸ Unavailable" : "▸ Live"}
              </CardGlyph>
              <div className="t-head" style={{ fontSize: 26 }}>
                Worldwide
              </div>
              <p className="t-body" style={{ marginTop: 6 }}>
                {isOffline
                  ? "Requires network connection"
                  : "Ranked · Live opponents · Global matchmaking"}
              </p>
            </div>
          </button>

          {/* Create & Share — active */}
          <button
            className="mode-card"
            onClick={onShare}
            type="button"
            style={{ minHeight: 116, textAlign: "left", overflow: "hidden" }}
          >
            <div
              className="mode-card-bar"
              style={{
                background: "linear-gradient(to bottom, #8B7CF6, #6b5cc4)",
              }}
            />
            <span className="mode-card-coord">02 / INVITE</span>
            <img
              src="/qr-code.svg"
              aria-hidden
              style={cardBgStyle("58%", -6, -10)}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <CardGlyph color="#8B7CF6">▸ Invite</CardGlyph>
              <div className="t-head" style={{ fontSize: 26 }}>
                Create &amp; Share
              </div>
              <p className="t-body" style={{ marginTop: 6 }}>
                Generate a code · Send a link · Play anywhere
              </p>
            </div>
          </button>

          {/* LOCAL DUEL — always active */}
          <button
            className="mode-card"
            onClick={onLocal}
            type="button"
            style={{ minHeight: 116, textAlign: "left", overflow: "hidden" }}
          >
            <div
              className="mode-card-bar"
              style={{
                background:
                  "linear-gradient(to bottom, var(--amber), var(--amber-dim))",
              }}
            />
            <span className="mode-card-coord">03 / LOCAL</span>
            <img
              src="/spartan.svg"
              aria-hidden
              style={cardBgStyle("72%", -6, -10)}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <CardGlyph color="var(--amber)">▸ Local</CardGlyph>
              <div className="t-head" style={{ fontSize: 26 }}>
                Local Duel
              </div>
              <p className="t-body" style={{ marginTop: 6 }}>
                Pass &amp; play · Same screen · Face to face
              </p>
            </div>
          </button>
        </section>

        {/* COMING SOON divider */}
        <div style={{ padding: "20px var(--pad) 0" }} className="fade-up-3">
          <div className="flex items-center gap-12">
            <div style={{ flex: 1, height: 1, background: "var(--rim)" }} />
            <span
              className="t-label"
              style={{ flexShrink: 0, color: "var(--muted)" }}
            >
              Coming soon
            </span>
            <div style={{ flex: 1, height: 1, background: "var(--rim)" }} />
          </div>
        </div>

        <section
          style={{
            padding: "12px var(--pad) 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
          className="fade-up-4"
        >
          <button
            className="mode-card"
            type="button"
            disabled
            style={{
              minHeight: 90,
              textAlign: "left",
              overflow: "hidden",
              opacity: 0.38,
              cursor: "not-allowed",
              width: "100%",
            }}
          >
            <div
              className="mode-card-bar"
              style={{
                background:
                  "linear-gradient(to bottom, var(--teal), var(--teal-dim))",
              }}
            />
            <span className="mode-card-coord">04 / AI</span>
            <img
              src="/ai-ckt.svg"
              aria-hidden
              style={cardBgStyle("62%", -8, -10)}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  className="pill"
                  style={{
                    borderColor: "var(--teal-border)",
                    color: "var(--teal)",
                    fontSize: 9,
                    padding: "3px 8px",
                    letterSpacing: 2,
                  }}
                >
                  ▪ Under construction
                </span>
              </div>
              <div className="t-head" style={{ fontSize: 22 }}>
                Neural AI
              </div>
              <p className="t-body" style={{ marginTop: 4, fontSize: 12 }}>
                Adaptive difficulty · Solo training · In development
              </p>
            </div>
          </button>
        </section>
      </div>

      {/* FOOTER */}
      <footer
        style={{ padding: "16px var(--pad)", flexShrink: 0 }}
        className="fade-up-5"
      >
        <div className="prog-bar" style={{ marginBottom: 16 }} />
        <button className="btn btn-ghost btn-full" onClick={onBack}>
          ← Back to base
        </button>
      </footer>
    </div>
  );
}
