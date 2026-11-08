"use client";
// One WebGL scene showing many library objects on a measured shelf (filled once /api/library exists).
export function LibraryShelf() {
  return (
    <div className="mx-auto mt-8 max-w-[1400px] px-4 sm:px-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="sheet aspect-[3/4] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
