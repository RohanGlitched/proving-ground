"use client";
import { useEffect, useRef, useState } from "react";
import { objectUrl } from "@/lib/client/api";

/** Lazy studio thumbnail of a library object, rendered on our shared offscreen renderer. */
export function Thumb({ id, alt, className = "" }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (ents) => {
        if (!ents.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // a pre-rendered thumbnail when one exists, else render it here from the GLB
        const pre = new Image();
        pre.onload = () => alive && setSrc(pre.src);
        pre.onerror = () =>
          import("@/three/thumbs")
            .then(({ thumbnail }) => thumbnail(objectUrl(id, "visual.glb")))
            .then((s) => alive && setSrc(s))
            .catch(() => alive && setFailed(true));
        pre.src = objectUrl(id, "thumb.webp");
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id]);
  return (
    <div ref={ref} className={`relative overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#fff,#e9e8e3)] ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-contain" draggable={false} />
      ) : (
        <div className={`absolute inset-0 grid place-items-center text-[12px] text-ink-3 ${failed ? "" : "animate-pulse"}`}>{failed ? "No preview" : ""}</div>
      )}
    </div>
  );
}
