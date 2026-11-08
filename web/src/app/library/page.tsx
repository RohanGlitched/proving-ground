import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";

export const metadata: Metadata = {
  title: "Library",
  description: "Every object made with Aholo Lux3D in Proving Ground: real-world size, parts, hulls and mass. Download any of them as a robot-ready pack.",
};

export default function LibraryPage() {
  return (
    <>
      <Nav />
      <main className="grain mx-auto max-w-[1400px] px-4 pb-10 pt-12 sm:px-6 md:pt-16">
        <h1 className="placard text-[39px] sm:text-[49px]">The library</h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-[1.7] text-ink-2">
          Every object anyone has made here with Lux3D, at the size Lux3D predicted. Open one to see its parts and hulls, put it in the arena, or
          download it as a pack for your own simulator.
        </p>
        <LibraryBrowser />
      </main>
      <Footer />
    </>
  );
}
