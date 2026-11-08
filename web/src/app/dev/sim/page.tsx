"use client";
// Dev-only sim test page: minimal three.js view of the G1 + the dev-sample chair (Lux3D part split).
// Buttons drive the sim worker through src/sim/client.ts. The real arena UI lives elsewhere.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createSim, type SimClient, type TrialSummary, type SceneSpec } from "@/sim/client";
import { glbToParts } from "@/sim/assets";

const CHAIR_URL = "/dev/chair-parts.glb";

export default function SimDevPage() {
  const mount = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimClient | null>(null);
  const sceneRef = useRef<SceneSpec | null>(null);
  const planLine = useRef<THREE.Line | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [hud, setHud] = useState("loading");
  const [trials, setTrials] = useState<TrialSummary | null>(null);
  const add = (s: string) => setLog((l) => [s, ...l].slice(0, 30));

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15181c);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.05, 100);
    camera.position.set(-2.5, 2.2, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(1.5, 0.6, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(3, 6, 2);
    scene.add(sun);
    const grid = new THREE.GridHelper(20, 40, 0x445566, 0x2a3138);
    scene.add(grid);
    // everything sim-side lives in a Z-up group
    const world = new THREE.Group();
    world.rotation.x = -Math.PI / 2;
    scene.add(world);

    const sim = createSim();
    simRef.current = sim;
    const robotMeshes: THREE.Mesh[] = [];
    const objectGroups: THREE.Group[] = [];
    let disposed = false;
    const goalMark = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.01, 32), new THREE.MeshBasicMaterial({ color: 0x33cc77, transparent: true, opacity: 0.4 }));
    goalMark.rotation.x = Math.PI / 2;
    world.add(goalMark);

    (async () => {
      const t0 = performance.now();
      const info = await sim.ready;
      add(`worker ready in ${info.loadMs.toFixed(0)} ms (shared=${!!info.shared})`);
      const stl = new STLLoader();
      await Promise.all(info.robotVisuals.map(async (v) => {
        const geo = stl.parse(await (await fetch(`/g1/meshes/${v.mesh}`)).arrayBuffer());
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(v.rgba[0], v.rgba[1], v.rgba[2]), roughness: 0.6 }));
        robotMeshes[v.geomId] = m;
        world.add(m);
      }));
      const buf = await (await fetch(CHAIR_URL)).arrayBuffer();
      const asset = await glbToParts(new Uint8Array(buf));
      add(`chair: ${asset.parts.length} parts, ${asset.mass.toFixed(2)} kg, ${asset.bboxMeters.size.map((s) => s.toFixed(2)).join(" x ")} m`);
      const gltf = await new GLTFLoader().parseAsync(buf.slice(0), "");
      const g = new THREE.Group();
      const vis = gltf.scene;
      vis.rotation.x = Math.PI / 2; // Lux3D Y-up -> sim Z-up
      g.add(vis);
      world.add(g);
      objectGroups.push(g);
      const spec: SceneSpec = { objects: [{ id: "chair", name: "chair", parts: asset.parts, x: 1.5, y: 0, yaw: 0 }], goal: { x: 4, y: 0 } };
      sceneRef.current = spec;
      const r = await sim.setScene(spec);
      add(`scene compiled in ${r.compileMs.toFixed(0)} ms; total ${(performance.now() - t0).toFixed(0)} ms`);
      setHud("ready");
    })().catch((e) => add(`ERROR ${e?.message ?? e}`));

    sim.onContact((c) => add(`t=${c.t.toFixed(2)} touched ${c.entityName} with ${c.robotBody}`));
    sim.onStatus((s, t) => add(`status ${s} at ${t.toFixed(2)} s`));
    let rtf = 0;
    sim.onPerf((p) => { rtf = p.realTimeFactor; });

    let raf = 0;
    const tmpQ = new THREE.Quaternion();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const f = sim.latest();
      if (f) {
        const P = f.poses;
        for (let i = 0; i < f.layout.robotGeoms; i++) {
          const m = robotMeshes[i];
          if (!m) continue;
          m.position.set(P[7 * i], P[7 * i + 1], P[7 * i + 2]);
          m.quaternion.set(P[7 * i + 4], P[7 * i + 5], P[7 * i + 6], P[7 * i + 3]);
        }
        for (let k = 0; k < f.layout.objects.length; k++) {
          const g = objectGroups[k];
          if (!g) continue;
          const o = 7 * (f.layout.robotGeoms + k);
          g.position.set(P[o], P[o + 1], P[o + 2]);
          g.quaternion.copy(tmpQ.set(P[o + 4], P[o + 5], P[o + 6], P[o + 3]));
        }
        goalMark.position.set(f.header.goal.x, f.header.goal.y, 0.005);
        const h = f.header;
        setHud(`t=${h.simTime.toFixed(2)} s  ${h.status}  pelvis ${h.robotPelvis.map((v) => v.toFixed(2)).join(", ")}  cmd vx ${h.cmd.vx.toFixed(2)} yaw ${h.cmd.yaw.toFixed(2)}  rtf ${rtf.toFixed(1)}x  contacts ${h.contactCount}${h.lastContact ? ` (last ${h.lastContact.id})` : ""}`);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);
    const planTimer = setInterval(async () => {
      if (disposed) return;
      const p = await sim.getPlan().catch(() => null);
      if (planLine.current) { world.remove(planLine.current); planLine.current.geometry.dispose(); planLine.current = null; }
      if (p && p.length >= 4) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector3(p[i], p[i + 1], 0.02));
        planLine.current = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffcc33 }));
        world.add(planLine.current);
      }
    }, 500);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(planTimer);
      window.removeEventListener("resize", onResize);
      sim.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const walk = async (mode: "blind" | "planner") => {
    const sim = simRef.current!;
    await sim.reset();
    await sim.setMode(mode);
    await sim.play();
  };
  const runTrials = async (mode: "blind" | "planner") => {
    const sim = simRef.current!;
    if (!sceneRef.current) return;
    setTrials(null);
    const t = performance.now();
    const s = await sim.runTrials({ scene: sceneRef.current, n: 10, seed: 7, mode, maxSeconds: 20 }, (done, n, r) => add(`trial ${done}/${n}: ${r.result} at ${r.time.toFixed(1)} s${r.firstContactObject ? `, touched ${r.firstContactObject}` : ""}`));
    add(`${mode} trials: pass ${(s.passRate * 100).toFixed(0)}% in ${((performance.now() - t) / 1000).toFixed(1)} s wall (${s.simSeconds.toFixed(0)} s sim)`);
    setTrials(s);
  };
  const btn = "px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-100 border border-neutral-600";
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-200">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <span className="mr-2 font-mono text-xs text-neutral-400">/dev/sim</span>
        <button className={btn} onClick={() => walk("blind")}>Walk blind</button>
        <button className={btn} onClick={() => walk("planner")}>Walk planner</button>
        <button className={btn} onClick={() => simRef.current?.pause()}>Pause</button>
        <button className={btn} onClick={() => simRef.current?.play()}>Play</button>
        <button className={btn} onClick={() => simRef.current?.reset()}>Reset</button>
        <button className={btn} onClick={() => simRef.current?.push(150, Math.PI / 2)}>Push 150 N</button>
        <button className={btn} onClick={() => runTrials("blind")}>10 trials blind</button>
        <button className={btn} onClick={() => runTrials("planner")}>10 trials planner</button>
      </div>
      <div className="px-2 pb-1 font-mono text-xs text-neutral-300" data-testid="hud">{hud}</div>
      <div className="relative flex min-h-0 flex-1">
        <div ref={mount} className="min-w-0 flex-1" />
        <div className="w-96 overflow-auto border-l border-neutral-800 p-2 font-mono text-xs" data-testid="log">
          {trials && <div className="mb-2 text-emerald-300">pass {(trials.passRate * 100).toFixed(0)}%, falls {trials.falls}, timeouts {trials.timeouts}</div>}
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
