"use client";
export function GauntletPreview() {
  return (
    <div className="mt-8 grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="sheet h-56 animate-pulse" />
      ))}
    </div>
  );
}
