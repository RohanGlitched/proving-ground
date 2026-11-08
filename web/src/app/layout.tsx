import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://proving-ground-snowy.vercel.app"),
  title: {
    default: "Proving Ground: make anything, watch a real robot deal with it",
    template: "%s · Proving Ground",
  },
  description:
    "Turn a photo or a sentence into a physical object with Aholo Lux3D, then watch Unitree's published G1 walking controller deal with it in a live physics world in your browser.",
  openGraph: {
    title: "Proving Ground",
    description: "Make anything with Lux3D. Watch a real robot brain deal with it.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#E3E2DD",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
