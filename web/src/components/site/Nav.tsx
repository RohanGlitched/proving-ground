import Link from "next/link";
import { Target } from "@/components/ui/marks";

const LINKS = [
  { href: "/arena", label: "Arena" },
  { href: "/library", label: "Library" },
  { href: "/gauntlet", label: "Gauntlet" },
  { href: "/how", label: "How it works" },
];

export function Nav({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md ${dark ? "border-white/10 bg-cam/80 text-white" : "border-ink/10 bg-concrete/85 text-ink"}`}
    >
      <nav className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="flex items-center gap-2.5 font-bold [font-stretch:118%]">
          <Target size={22} />
          <span>Proving Ground</span>
        </Link>
        <ul className="ml-4 hidden items-center gap-5 text-[15px] md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link className={`${dark ? "text-white/75 hover:text-white" : "text-ink-2 hover:text-ink"} transition-colors`} href={l.href}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/arena?make=1"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-target px-4 text-[15px] font-semibold text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition-transform hover:-translate-y-px active:translate-y-0"
          >
            Make something
          </Link>
        </div>
      </nav>
      <ul className="flex gap-5 overflow-x-auto px-4 pb-2 text-[14px] md:hidden">
        {LINKS.map((l) => (
          <li key={l.href} className="shrink-0">
            <Link className={dark ? "text-white/75" : "text-ink-2"} href={l.href}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </header>
  );
}
