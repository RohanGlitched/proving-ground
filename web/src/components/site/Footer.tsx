import Link from "next/link";
import { Target } from "@/components/ui/marks";

const REPO = "https://github.com/RohanGlitched/proving-ground";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-ink/15 bg-ink text-white">
      <div className="tape h-2" aria-hidden />
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-4">
          <div className="flex items-center gap-2.5 text-lg font-bold [font-stretch:118%]">
            <Target size={26} /> Proving Ground
          </div>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/70">
            Make anything with Aholo Lux3D, from a photo or a sentence, and watch Unitree&apos;s published G1 walking controller deal with it in a
            physics world that runs in your browser.
          </p>
          <p className="mt-6 text-[13px] text-white/50">
            Built by Rohan Borade for the Manycore Aholo Global 3D AI Hackathon, 2026.
          </p>
        </div>
        <div className="md:col-span-2">
          <h3 className="text-[13px] font-semibold text-white/50">Use it</h3>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li><Link href="/arena" className="hover:text-target">Arena</Link></li>
            <li><Link href="/arena?make=1" className="hover:text-target">Make something</Link></li>
            <li><Link href="/library" className="hover:text-target">Library</Link></li>
            <li><Link href="/gauntlet" className="hover:text-target">Gauntlet</Link></li>
          </ul>
        </div>
        <div className="md:col-span-2">
          <h3 className="text-[13px] font-semibold text-white/50">Understand it</h3>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li><Link href="/how" className="hover:text-target">How it works</Link></li>
            <li><Link href="/how#robot" className="hover:text-target">The robot controller</Link></li>
            <li><Link href="/how#lux3d" className="hover:text-target">The Lux3D pipeline</Link></li>
            <li><Link href="/how#limits" className="hover:text-target">Limits</Link></li>
          </ul>
        </div>
        <div className="md:col-span-4">
          <h3 className="text-[13px] font-semibold text-white/50">Credits</h3>
          <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-white/70">
            <li>3D generation, part-split, rigging and animation: Aholo Lux3D by Manycore Tech.</li>
            <li>Robot model and walking policy: Unitree Robotics, BSD-3-Clause (unitree_rl_gym).</li>
            <li>Physics: MuJoCo by Google DeepMind, Apache-2.0, compiled to WebAssembly.</li>
            <li>Rendering: three.js, MIT.</li>
            <li>
              Source: <a className="underline decoration-white/30 underline-offset-2 hover:text-target" href={REPO}>{REPO.replace("https://", "")}</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-white/45 sm:px-6">
          <span>No account needed. Objects you make join the public library.</span>
          <span className="ml-auto">Code: Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
