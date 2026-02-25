import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/color-match";
import { buildImageUrl } from "../lib/images";
import { parseArtist } from "../lib/parsing";

export function meta() {
  return [
    { title: "Färg-match — Kabinett" },
    { name: "description", content: "Matcha en färg i kameran med konstverk." },
  ];
}

type MatchItem = {
  id: number;
  title_sv: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
};

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
        setStatus("Kameran kunde inte starta. Välj en färg nedan.");
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
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      <div className="max-w-[60rem] mx-auto p-6">
        <h1 className="font-serif text-[2rem] text-charcoal">
          Färg-match
        </h1>
        <p className="mt-[0.35rem] text-warm-gray">
          Rikta kameran mot en nyans och hitta konst som matchar.
        </p>

        <div className="mt-6 relative rounded-[1.25rem] overflow-hidden bg-ink">
          <video ref={videoRef} playsInline muted className="w-full h-auto block" />
          <div
            className="absolute top-1/2 left-1/2 w-28 h-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[rgba(245,240,232,0.8)] shadow-[0_0_0_999px_rgba(0,0,0,0.2)] pointer-events-none"
          />
          {status && (
            <div
              className="absolute inset-0 flex items-center justify-center text-[#F5F0E8] p-8 text-center bg-[rgba(26,24,21,0.75)]"
            >
              {status}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mt-4 items-center">
          <button
            type="button"
            onClick={captureColor}
            className="py-3 px-6 rounded-full border-0 bg-charcoal text-cream font-semibold cursor-pointer focus-ring"
          >
            Matcha färg
          </button>
          {color && (
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full border border-stone"
                style={{ background: color.hex }}
              />
              <span className="text-[0.8rem] text-warm-gray font-mono">{color.hex}</span>
            </div>
          )}
        </div>

        <div className="mt-6">
          <p className="text-[0.85rem] text-warm-gray">Eller välj en palett:</p>
          <div className="flex gap-[0.6rem] flex-wrap mt-[0.6rem]">
            {palette.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => {
                  const rgb = hexToRgb(hex);
                  setColor({ ...rgb, hex });
                  void fetchMatches(rgb.r, rgb.g, rgb.b);
                }}
                aria-label={`Välj ${hex}`}
                className="w-11 h-11 rounded-full border border-[rgba(26,24,21,0.2)] cursor-pointer focus-ring"
                style={{ background: hex }}
              />
            ))}
            <input
              type="color"
              aria-label="Välj egen färg"
              onChange={(event) => {
                const hex = event.target.value;
                const rgb = hexToRgb(hex);
                setColor({ ...rgb, hex });
                void fetchMatches(rgb.r, rgb.g, rgb.b);
              }}
              className="w-11 h-11 border-0 bg-transparent p-0 focus-ring"
            />
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-[1.2rem] font-semibold text-charcoal">Matchar</h2>
          {loading && <p className="text-warm-gray">Letar efter nyanser…</p>}
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 mt-4"
          >
            {matches.map((item) => (
              <a
                key={item.id}
                href={`/artwork/${item.id}`}
                className="no-underline text-inherit bg-white rounded-[0.85rem] overflow-hidden border border-[rgba(212,205,195,0.3)] focus-ring"
              >
                <div
                  className="aspect-[3/4]"
                  style={{ backgroundColor: item.dominant_color || "#D4CDC3" }}
                >
                  <img
                    src={buildImageUrl(item.iiif_url, 400)}
                    alt={`${item.title_sv || "Utan titel"} — ${parseArtist(item.artists)}`}
                    loading="lazy"
                    width={400}
                    height={533}
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-[0.65rem]">
                  <p className="text-[0.85rem] font-semibold m-0 text-charcoal">
                    {item.title_sv || "Utan titel"}
                  </p>
                  <p className="text-[0.7rem] mt-[0.2rem] text-warm-gray">
                    {parseArtist(item.artists)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
