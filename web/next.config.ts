import type { NextConfig } from "next";
import path from "node:path";

// SHARED FILE: edit in place, never overwrite (the UI, sim and pipeline all add settings here).
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
    // sim: @mujoco/mujoco has `await import('module')` in its Node-only branch; give browsers a stub
    resolveAlias: { module: { browser: "./src/sim/empty-module.ts" } },
  },
  outputFileTracingRoot: path.resolve(__dirname),
  // the GLB pipeline (api routes) loads these at runtime instead of bundling them
  serverExternalPackages: ["sharp", "meshoptimizer", "@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions"],
};

export default nextConfig;
