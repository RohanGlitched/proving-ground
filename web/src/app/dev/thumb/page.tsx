"use client";
// Dev-only: renders a library object's studio thumbnail for pre-rendering (scripts call window.__thumb).
import { useEffect } from "react";
import { thumbnail } from "@/three/thumbs";
import { objectUrl } from "@/lib/client/api";

export default function DevThumb() {
  useEffect(() => {
    (window as unknown as { __thumb: (id: string, size: number) => Promise<string> }).__thumb = (id, size) => thumbnail(objectUrl(id, "visual.glb"), size);
    document.body.dataset.ready = "1";
  }, []);
  return <p>thumb renderer</p>;
}
