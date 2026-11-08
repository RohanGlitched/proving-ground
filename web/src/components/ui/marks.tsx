// The calibration target: the quartered black-and-yellow disc taped to crash-test dummies so
// high-speed cameras can track them. It is the product's mark and the goal flag's face.
export function Target({ size = 24, className = "", spin = false }: { size?: number; className?: string; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${className} ${spin ? "motion-safe:animate-[spin_6s_linear_infinite]" : ""}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="11" fill="#F5C400" />
      <path d="M12 1 A11 11 0 0 1 23 12 L12 12 Z" fill="#141517" />
      <path d="M12 23 A11 11 0 0 1 1 12 L12 12 Z" fill="#141517" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="#141517" strokeWidth="1.2" />
    </svg>
  );
}

export type StampTone = "pass" | "fault" | "ink" | "route";
const TONES: Record<StampTone, string> = {
  pass: "text-pass border-pass",
  fault: "text-fault border-fault",
  ink: "text-ink border-ink",
  route: "text-route border-route",
};

/** A rubber stamp. Real stamps are upper case; this is the one place we use it. */
export function Stamp({
  children,
  tone = "ink",
  rotate = -6,
  animate = false,
  className = "",
}: {
  children: React.ReactNode;
  tone?: StampTone;
  rotate?: number;
  animate?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-[4px] border-[2.5px] px-2 py-0.5 text-[13px] font-extrabold uppercase tracking-[0.08em] [font-stretch:115%] ${TONES[tone]} ${animate ? "stamp-in" : ""} ${className}`}
      style={{ transform: `rotate(${rotate}deg)`, ["--rot" as string]: `${rotate}deg`, mixBlendMode: "multiply" }}
    >
      {children}
    </span>
  );
}

/** a strip of measured ticks, like a ruler printed on a test fixture */
export function Ruler({ metres = 6, className = "" }: { metres?: number; className?: string }) {
  const ticks = [];
  for (let i = 0; i <= metres * 10; i++) {
    const major = i % 10 === 0;
    const mid = i % 5 === 0;
    ticks.push(
      <span
        key={i}
        className="absolute bottom-0 w-px bg-ink/50"
        style={{ left: `${(i / (metres * 10)) * 100}%`, height: major ? 12 : mid ? 7 : 4 }}
      />,
    );
  }
  return (
    <div className={`relative h-5 ${className}`} aria-hidden>
      {ticks}
      {Array.from({ length: metres + 1 }, (_, m) => (
        <span key={m} className="data absolute -top-1 -translate-x-1/2 text-[10px] text-ink-3" style={{ left: `${(m / metres) * 100}%` }}>
          {m} m
        </span>
      ))}
    </div>
  );
}
