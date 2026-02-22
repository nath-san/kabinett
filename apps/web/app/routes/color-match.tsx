import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/color-match";

export function meta() {
  return [
    { title: "Farg-match — Kabinett" },
    { name: "description", content: "Matcha en farg i kameran med konstverk." },
  ];
}

type MatchItem = {
  id: number;
  title_sv: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
};

function parseArtist(json: string | null): string {
  if (!json) return "Okand konstnar";
  try { return JSON.parse(json)[0]?.name || "Okand konstnar"; } catch { return "Okand konstnar"; }
}

function iiif(url: string, size: number) {
  return url.replace("http://", "https://") + `full/${size},/0/default.jpg`;
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "");
  const bigint = parseInt(cleaned, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  );
}

export default function ColorMatch() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [color, setColor] = useState<{ r: number; g: number; b: number; hex: string } | null>(null);

  useEffect(() => {
    let active = true;
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (!active) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("");
      } catch {
        setStatus("Kameran kunde inte starta. Välj en farg nedan.");
      }
    }
    initCamera();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const palette = useMemo(
    () => ["#C4553A", "#D4CDC3", "#1A2A3A", "#3A1A1A", "#2D3A2D", "#E8987F"],
    []
  );

  async function fetchMatches(r: number, g: number, b: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/color-search?r=${r}&g=${g}&b=${b}&limit=20`);
      const data = await res.json();
      setMatches(data || []);
    } catch {
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }

  function captureColor() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const size = 50;
    const sx = Math.max(0, Math.floor(width / 2 - size / 2));
    const sy = Math.max(0, Math.floor(height / 2 - size / 2));
    const imageData = ctx.getImageData(sx, sy, size, size).data;

    let r = 0;
    let g = 0;
    let b = 0;
    const count = imageData.length / 4;
    for (let i = 0; i < imageData.length; i += 4) {
      r += imageData[i] || 0;
      g += imageData[i + 1] || 0;
      b += imageData[i + 2] || 0;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);

    const hex = rgbToHex(r, g, b);
    setColor({ r, g, b, hex });
    void fetchMatches(r, g, b);
  }

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      <div style={{ maxWidth: "60rem", margin: "0 auto", padding: "1.5rem" }}>
        <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: "2rem", color: "#3D3831" }}>
          Farg-match
        </h1>
        <p style={{ marginTop: "0.35rem", color: "#8C8478" }}>
          Rikta kameran mot en nyans och hitta konst som matchar.
        </p>

        <div style={{ marginTop: "1.5rem", position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "#1A1815" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "auto", display: "block" }} />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "7rem",
              height: "7rem",
              transform: "translate(-50%, -50%)",
              borderRadius: "999px",
              border: "2px solid rgba(245,240,232,0.8)",
              boxShadow: "0 0 0 999px rgba(0,0,0,0.2)",
              pointerEvents: "none",
            }}
          />
          {status && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#F5F0E8",
                padding: "2rem",
                textAlign: "center",
                background: "rgba(26,24,21,0.75)",
              }}
            >
              {status}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={captureColor}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "999px",
              border: "none",
              background: "#3D3831",
              color: "#FAF7F2",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Matcha farg
          </button>
          {color && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ width: "1.5rem", height: "1.5rem", borderRadius: "999px", background: color.hex, border: "1px solid #D4CDC3" }} />
              <span style={{ fontSize: "0.8rem", color: "#8C8478", fontFamily: "monospace" }}>{color.hex}</span>
            </div>
          )}
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <p style={{ fontSize: "0.85rem", color: "#8C8478" }}>Eller valj en palett:</p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            {palette.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => {
                  const rgb = hexToRgb(hex);
                  setColor({ ...rgb, hex });
                  void fetchMatches(rgb.r, rgb.g, rgb.b);
                }}
                aria-label={`Valj ${hex}`}
                style={{
                  width: "2.25rem",
                  height: "2.25rem",
                  borderRadius: "999px",
                  border: "1px solid rgba(26,24,21,0.2)",
                  background: hex,
                  cursor: "pointer",
                }}
              />
            ))}
            <input
              type="color"
              aria-label="Valj egen farg"
              onChange={(event) => {
                const hex = event.target.value;
                const rgb = hexToRgb(hex);
                setColor({ ...rgb, hex });
                void fetchMatches(rgb.r, rgb.g, rgb.b);
              }}
              style={{ width: "2.5rem", height: "2.25rem", border: "none", background: "none", padding: 0 }}
            />
          </div>
        </div>

        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, color: "#3D3831" }}>Matchar</h2>
          {loading && <p style={{ color: "#8C8478" }}>Letar efter nyanser…</p>}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "1rem",
              marginTop: "1rem",
            }}
          >
            {matches.map((item) => (
              <a
                key={item.id}
                href={`/artwork/${item.id}`}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  background: "#fff",
                  borderRadius: "0.85rem",
                  overflow: "hidden",
                  border: "1px solid rgba(212,205,195,0.3)",
                }}
              >
                <div style={{ aspectRatio: "3/4", backgroundColor: item.dominant_color || "#D4CDC3" }}>
                  <img
                    src={iiif(item.iiif_url, 400)}
                    alt={item.title_sv || ""}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <div style={{ padding: "0.65rem" }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, margin: 0, color: "#3D3831" }}>
                    {item.title_sv || "Utan titel"}
                  </p>
                  <p style={{ fontSize: "0.7rem", marginTop: "0.2rem", color: "#8C8478" }}>
                    {parseArtist(item.artists)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
