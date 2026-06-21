import { ImageResponse } from "next/og";

// The link-preview / "search engine link" image shown when clunoid.com is shared.
export const alt = "Clunoid — talk to Isaac, a super-intelligent AI that shows you anything.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1F1E1C",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 220,
            height: 220,
            borderRadius: 9999,
            background: "linear-gradient(135deg, #E0937A, #D97757)",
            boxShadow: "0 0 150px 24px rgba(217,119,87,0.5)",
          }}
        />
        <div style={{ marginTop: 56, fontSize: 110, fontWeight: 700, color: "#F4F2EC", letterSpacing: -2 }}>
          Clunoid
        </div>
        <div style={{ marginTop: 12, fontSize: 38, color: "#A6A199", maxWidth: 880, textAlign: "center" }}>
          Talk to Isaac — a super-intelligent AI that shows you anything.
        </div>
      </div>
    ),
    size
  );
}
