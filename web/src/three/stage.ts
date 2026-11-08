// The test hall: renderer, camera, lights and the measured floor. Y-up (three.js), metres.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type StageOptions = {
  canvas: HTMLCanvasElement;
  dark?: boolean;
  controls?: boolean;
  shadows?: boolean;
  floorSize?: number;
};

function floorMaterial(dark: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(dark ? "#1a1b1e" : "#d9d8d2") },
      uLine: { value: new THREE.Color(dark ? "#3a3c41" : "#b9b8b1") },
      uMajor: { value: new THREE.Color(dark ? "#5a5d63" : "#8f8e88") },
      uFade: { value: dark ? 14.0 : 18.0 },
    },
    vertexShader: `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uBase; uniform vec3 uLine; uniform vec3 uMajor; uniform float uFade;
      varying vec3 vW;
      float grid(vec2 p, float s, float w){
        vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s);
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        vec2 p = vW.xz;
        float minor = grid(p, 0.25, 0.6) * 0.35;
        float major = grid(p, 1.0, 1.0);
        float axis = (1.0 - min(abs(p.y) / fwidth(p.y) / 1.5, 1.0));
        vec3 c = uBase * (0.97 + 0.06 * hash(floor(p * 40.0)));
        c = mix(c, uLine, minor);
        c = mix(c, uMajor, major * 0.8);
        c = mix(c, vec3(0.96, 0.77, 0.0), axis * 0.55);
        float d = length(p);
        float fade = smoothstep(uFade, uFade * 0.45, d);
        gl_FragColor = vec4(c, fade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    extensions: { derivatives: true } as never,
  });
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls | null;
  readonly sun: THREE.DirectionalLight;
  readonly floor: THREE.Mesh;
  readonly shadowCatcher: THREE.Mesh;
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private running = false;
  private hooks = new Set<(dt: number, t: number) => void>();

  constructor(opts: StageOptions) {
    const { canvas, dark = true } = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = dark ? 1.05 : 1.0;
    this.renderer.shadowMap.enabled = opts.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const bg = new THREE.Color(dark ? "#0f1012" : "#e3e2dd");
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 9, 22);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
    this.camera.position.set(3.6, 2.3, 4.4);

    const hemi = new THREE.HemisphereLight(0xffffff, dark ? 0x1b1c20 : 0xbab9b2, dark ? 0.55 : 0.8);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, dark ? 2.2 : 2.6);
    this.sun.position.set(3.5, 7, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 6;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 20 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    const size = opts.floorSize ?? 40;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMaterial(dark));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = -2;
    this.scene.add(this.floor);
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShadowMaterial({ opacity: dark ? 0.5 : 0.22 }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.001;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = -1;
    this.scene.add(this.shadowCatcher);

    this.controls = opts.controls === false ? null : new OrbitControls(this.camera, canvas);
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.minDistance = 1.2;
      this.controls.maxDistance = 16;
      this.controls.target.set(0, 0.6, 0);
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(fn: (dt: number, t: number) => void) {
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      for (const h of this.hooks) h(dt, now / 1000);
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.ro.disconnect();
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
