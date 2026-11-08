"use client";
import { useEffect, useRef, useState } from "react";
import { objectUrl } from "@/lib/client/api";

/**
 * Studio thumbnail of a library object. The pre-rendered thumb.webp loads like any image; objects
 * without one are rendered here from the GLB on our shared offscreen renderer once they come near
 * the viewport. Until a picture arrives the tile shows the object's bounding box at its real
 * proportions, so it is never blank.
 */
export function Thumb({
  id,
  alt,
  className = "",
  size,
  eager = false,
}: {
  id: string;
  alt: string;
  className?: string;
  /** x, y (height), z in metres: draws the placeholder box at the object's proportions */
  size?: [number, number, number];
  /** load the pre-rendered image straight away instead of when it nears the viewport */
  eager?: boolean;
}) {
  const [rendered, setRendered] = useState<string | null>(null);
  const [preFailed, setPreFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // an image that finished (or failed) before hydration never fires its events: read its state once
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) setLoaded(true);
    else if (img.currentSrc) setPreFailed(true);
  }, [id]);

  // no pre-rendered thumbnail: render one from the GLB when the tile is near the viewport
  useEffect(() => {
    if (!preFailed) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const url = objectUrl(id, "visual.glb");
    const io = new IntersectionObserver(
      (ents) => {
        if (!ents.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // fetch the GLB now (in parallel with other tiles); the renderer then draws tiles one by one
        import("@/three/thumbs")
          .then(async ({ thumbnail }) => {
            const { loadVisual } = await import("@/three/arenaView");
            loadVisual(url).catch(() => undefined);
            return thumbnail(url);
          })
          .then((s) => alive && setRendered(s))
          .catch(() => alive && setFailed(true));
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id, preFailed]);

  const showing = (loaded && !preFailed) || !!rendered;
  return (
    <div ref={ref} className={`relative overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#fff,#e9e8e3)] ${className}`}>
      <BoxSilhouette size={size} busy={!failed && !showing} className={`transition-opacity duration-300 ${showing ? "opacity-0" : "opacity-100"}`} />
      {!preFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          key={id}
          src={objectUrl(id, "thumb.webp")}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setPreFailed(true)}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          draggable={false}
        />
      )}
      {rendered && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={rendered} alt={alt} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      )}
      {failed && !showing && <div className="data absolute inset-x-0 bottom-2 text-center text-[11px] text-ink-3">No preview</div>}
    </div>
  );
}

/** The object's bounding box in a drawing-sheet isometric, sized to its real proportions. */
function BoxSilhouette({ size, busy, className = "" }: { size?: [number, number, number]; busy: boolean; className?: string }) {
  const [sx, sy, sz] = size && size.every((v) => v > 0) ? size : [1, 1, 1];
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  // isometric: x to the right-down, z to the left-down, y up
  const P = (x: number, y: number, z: number) => [(x - z) * c, (x + z) * s - y] as const;
  const pts = {
    a: P(0, 0, 0), b: P(sx, 0, 0), c: P(sx, 0, sz), d: P(0, 0, sz),
    e: P(0, sy, 0), f: P(sx, sy, 0), g: P(sx, sy, sz), h: P(0, sy, sz),
  };
  const all = Object.values(pts);
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const k = 56 / Math.max(maxX - minX, maxY - minY);
  const ox = 50 - ((minX + maxX) / 2) * k, oy = 50 - ((minY + maxY) / 2) * k;
  const xy = (p: readonly [number, number]) => `${(ox + p[0] * k).toFixed(2)},${(oy + p[1] * k).toFixed(2)}`;
  const line = (p: readonly [number, number], q: readonly [number, number], dashed = false) => (
    <line
      x1={ox + p[0] * k} y1={oy + p[1] * k} x2={ox + q[0] * k} y2={oy + q[1] * k}
      strokeDasharray={dashed ? "1.6 1.6" : undefined}
      opacity={dashed ? 0.45 : 1}
      vectorEffect="non-scaling-stroke"
    />
  );
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`absolute inset-0 h-full w-full ${busy ? "animate-pulse" : ""} ${className}`}>
      {/* floor shadow */}
      <polygon points={[pts.a, pts.b, pts.c, pts.d].map(xy).join(" ")} fill="rgba(20,20,22,0.06)" />
      <g fill="none" stroke="rgba(20,20,22,0.32)" strokeWidth={1} strokeLinecap="round">
        {/* hidden edges behind the box */}
        {line(pts.a, pts.b, true)}
        {line(pts.a, pts.d, true)}
        {line(pts.a, pts.e, true)}
        {/* visible edges */}
        {line(pts.b, pts.c)}
        {line(pts.c, pts.d)}
        {line(pts.b, pts.f)}
        {line(pts.c, pts.g)}
        {line(pts.d, pts.h)}
        {line(pts.e, pts.f)}
        {line(pts.f, pts.g)}
        {line(pts.g, pts.h)}
        {line(pts.h, pts.e)}
      </g>
    </svg>
  );
}
