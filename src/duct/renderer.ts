import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { DUCT_LENGTH_OVER_RADIUS, advanceVisualPhase } from "../math";
import type { ModalSolution } from "../types";
import { createBerlinTexture } from "./berlin";

// These counts give the highest mode at least 8–10 samples per visible lobe
// while remaining fluid under software WebGL and on high-DPI mobile screens.
const SHELL_RADIAL_SEGMENTS = 96;
// The shell is not deformed: its axial coordinate interpolates exactly across
// one quad strip and the shader supplies all traveling-wave detail.
const SHELL_LENGTH_SEGMENTS = 1;
const DISK_RADIAL_SEGMENTS = 96;
const DISK_ANGULAR_SEGMENTS = 128;
const MAX_PIXEL_RATIO = 2;
const MAX_DRAWING_BUFFER_PIXELS = 2_500_000;
// Keep the analytic window at 0 <= x <= 3 while giving the rendered duct the
// long, slender silhouette used by the reference view.
const VISUAL_DUCT_LENGTH = 4.8;
const VISUAL_DUCT_RADIUS = 0.78;
// View the duct from downstream (+x), where the traveling wave is headed.
// Mirroring both axial X and transverse Z preserves the established oblique
// screen composition while moving the visible opening to the far end.
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(7.4, 3, 4.6);
const FRONT_CAMERA_POSITION = new THREE.Vector3(5.7, 0, 0);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const NEAR_DISK_X = -VISUAL_DUCT_LENGTH / 2 + 0.014;
const FAR_DISK_X = VISUAL_DUCT_LENGTH / 2 - 0.014;

export interface DuctRendererOptions {
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
}

interface PressureUniforms {
  readonly [name: string]: THREE.IUniform;
  readonly uBerlin: THREE.IUniform<THREE.DataTexture>;
  readonly uPhase: THREE.IUniform<number>;
  readonly uM: THREE.IUniform<number>;
  readonly uAxialNumber: THREE.IUniform<number>;
  readonly uRegime: THREE.IUniform<number>;
  readonly uWallRadial: THREE.IUniform<number>;
}

interface GeometryBundle {
  readonly group: THREE.Group;
  readonly shellGeometry: THREE.CylinderGeometry;
  readonly diskGeometry: THREE.BufferGeometry;
  readonly shellMaterial: THREE.ShaderMaterial;
  readonly nearDiskMaterial: THREE.ShaderMaterial;
  readonly farDiskMaterial: THREE.ShaderMaterial;
  readonly outlineMaterial: THREE.MeshBasicMaterial;
  readonly rimGeometry: THREE.TorusGeometry;
  readonly radialAttribute: THREE.BufferAttribute;
}

/** Retained Three.js visualization of an undeformed, open cylindrical duct. */
export class DuctRenderer {
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  private readonly controls: OrbitControls;
  private readonly uniforms: PressureUniforms;
  private readonly geometry: GeometryBundle;
  private readonly berlinTexture: THREE.DataTexture;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onContextLostCallback: (() => void) | undefined;
  private readonly onContextRestoredCallback: (() => void) | undefined;

  private solution: ModalSolution | null = null;
  private phase = 0;
  private playing = false;
  private pageVisible = true;
  private contextLost = false;
  private destroyed = false;
  private rafId = 0;
  private previousFrameTime: number | null = null;
  private frameSequence = 0;
  private cameraPreset = "oblique";

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed) return;
    this.contextLost = true;
    this.previousFrameTime = null;
    this.cancelFrame();
    this.host.dataset.ductStatus = "context-lost";
    this.onContextLostCallback?.();
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed) return;
    this.contextLost = false;
    this.previousFrameTime = null;
    this.host.dataset.ductStatus = "ready";
    this.onContextRestoredCallback?.();
    this.requestFrame();
  };

  constructor(host: HTMLElement, options: DuctRendererOptions = {}) {
    this.host = host;
    this.onContextLostCallback = options.onContextLost;
    this.onContextRestoredCallback = options.onContextRestored;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.dataset.ductCanvas = "true";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.replaceChildren(this.renderer.domElement);

    this.berlinTexture = createBerlinTexture();
    this.uniforms = {
      uBerlin: { value: this.berlinTexture },
      uPhase: { value: 0 },
      uM: { value: 2 },
      uAxialNumber: { value: 0 },
      uRegime: { value: 0 },
      uWallRadial: { value: 1 }
    };
    this.geometry = createDuctGeometry(this.uniforms);
    this.scene.add(this.geometry.group);

    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.7;
    this.controls.maxDistance = 15;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.8;
    this.controls.target.copy(CAMERA_TARGET);
    this.controls.addEventListener("change", this.handleControlsChange);
    this.controls.update();

    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.handleContextRestored);
    this.resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(host);

    this.host.dataset.rendererReady = "true";
    this.host.dataset.ductStatus = "ready";
    this.host.dataset.frame = "0";
    this.host.dataset.phase = "0.000000";
    this.host.dataset.playing = "false";
    this.host.dataset.pageVisible = "true";
    this.host.dataset.cameraPreset = "oblique";
    this.host.dataset.geometryReady = "true";
    this.host.dataset.openEnds = "true";
    this.host.dataset.samplingPlane = "true";
    this.host.dataset.coloredSamplingPlaneCount = "2";
    this.host.dataset.pressureDeformation = "false";
    this.host.dataset.pressureRepresentation = "real-part-of-complex-mode";
    this.host.dataset.modalPhase = "m-theta-plus-kx-x-minus-omega-t";
    this.host.dataset.shellCoordinateSource = "baked-object-position";
    this.host.dataset.azimuthConvention = "atan-z-y";
    this.host.dataset.axialOrigin = "near-sampling-plane";
    this.host.dataset.guideOverlays = "false";
    this.host.dataset.openRimCount = "2";
    this.host.dataset.visualLength = `${VISUAL_DUCT_LENGTH}`;
    this.host.dataset.visualRadius = `${VISUAL_DUCT_RADIUS}`;
    this.host.dataset.cameraFullRotation = "true";
    this.updateCameraData();
    this.resize();
  }

  setSolution(solution: ModalSolution): void {
    if (this.destroyed) return;
    this.solution = solution;
    this.uniforms.uM.value = solution.mode.m;
    this.uniforms.uAxialNumber.value = solution.axialNumber;
    this.uniforms.uRegime.value = regimeCode(solution.regime);
    this.uniforms.uWallRadial.value = interpolateSamples(solution.radialSamples, 1);
    updateDiskRadialAttribute(this.geometry.radialAttribute, solution.radialSamples);
    this.host.dataset.mode = `${solution.mode.m},${solution.mode.n}`;
    this.host.dataset.omega = `${solution.omegaAOverC}`;
    this.host.dataset.chi = `${solution.chi}`;
    this.host.dataset.regime = solution.regime;
    this.host.dataset.axialNumber = `${solution.axialNumber}`;
    this.host.dataset.radialNodeCount = `${solution.radialNodeCount}`;
    this.host.dataset.azimuthalSectorCount = `${solution.azimuthalSectorCount}`;
    this.resetPhase();
  }

  setPlaying(playing: boolean): void {
    if (this.destroyed || playing === this.playing) return;
    this.playing = playing;
    // Start timing at the accepted user action, so the first visual cycle is
    // not shortened by shader compilation or a slow first animation frame.
    this.previousFrameTime = playing ? performance.now() : null;
    this.host.dataset.playing = `${playing}`;
    if (playing && this.pageVisible && !this.contextLost) this.requestFrame();
  }

  setPageVisible(visible: boolean): void {
    if (this.destroyed || visible === this.pageVisible) return;
    this.pageVisible = visible;
    this.previousFrameTime = null;
    this.host.dataset.pageVisible = `${visible}`;
    if (visible) this.requestFrame();
    else this.cancelFrame();
  }

  resetPhase(): void {
    if (this.destroyed) return;
    this.phase = 0;
    this.previousFrameTime = this.playing ? performance.now() : null;
    this.uniforms.uPhase.value = 0;
    this.host.dataset.phase = "0.000000";
    this.requestFrame();
  }

  resetView(): void {
    this.applyCameraPreset(DEFAULT_CAMERA_POSITION, "oblique");
  }

  frontView(): void {
    this.applyCameraPreset(FRONT_CAMERA_POSITION, "front");
  }

  handleKeyboard(event: KeyboardEvent): boolean {
    if (this.destroyed || event.altKey || event.ctrlKey || event.metaKey) return false;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft": this.rotateBy(0.1, 0); break;
      case "ArrowRight": this.rotateBy(-0.1, 0); break;
      case "ArrowUp": this.rotateBy(0, 0.075); break;
      case "ArrowDown": this.rotateBy(0, -0.075); break;
      case "+":
      case "=": this.zoomBy(0.88); break;
      case "-":
      case "_": this.zoomBy(1.14); break;
      case "f":
      case "F": this.frontView(); break;
      case "0":
      case "Home": this.resetView(); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
    return handled;
  }

  resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const requestedRatio = Math.max(1, window.devicePixelRatio || 1);
    const bufferRatio = Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height));
    const pixelRatio = Math.min(requestedRatio, MAX_PIXEL_RATIO, bufferRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.host.dataset.pixelRatio = pixelRatio.toFixed(3);
    this.host.dataset.drawingBufferPixels = `${
      this.renderer.domElement.width * this.renderer.domElement.height
    }`;
    this.requestFrame();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.geometry.shellGeometry.dispose();
    this.geometry.diskGeometry.dispose();
    this.geometry.shellMaterial.dispose();
    this.geometry.nearDiskMaterial.dispose();
    this.geometry.farDiskMaterial.dispose();
    this.geometry.outlineMaterial.dispose();
    this.geometry.rimGeometry.dispose();
    this.berlinTexture.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.host.dataset.rendererReady;
    this.host.dataset.ductStatus = "destroyed";
  }

  private applyCameraPreset(position: THREE.Vector3, preset: string): void {
    if (this.destroyed) return;
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(CAMERA_TARGET);
    this.camera.position.copy(position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(CAMERA_TARGET);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.cameraPreset = preset;
    this.updateCameraData();
    this.requestFrame();
  }

  private rotateBy(azimuth: number, polar: number): void {
    this.controls.rotateLeft(azimuth);
    this.controls.rotateUp(polar);
    this.controls.update();
    this.markCameraCustom();
    this.requestFrame();
  }

  private zoomBy(scale: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * scale,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    offset.setLength(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.markCameraCustom();
    this.requestFrame();
  }

  private readonly handleControlsChange = (): void => {
    this.markCameraCustom();
    this.requestFrame();
  };

  private markCameraCustom(): void {
    if (this.cameraPreset !== "setting") this.cameraPreset = "custom";
    this.updateCameraData();
  }

  private updateCameraData(): void {
    const { x, y, z } = this.camera.position;
    this.host.dataset.camera = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    this.host.dataset.cameraPreset = this.cameraPreset;
  }

  private readonly requestFrame = (): void => {
    if (this.destroyed || this.contextLost || !this.pageVisible || this.rafId !== 0) return;
    this.rafId = window.requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (time: number): void => {
    this.rafId = 0;
    if (this.destroyed || this.contextLost || !this.pageVisible) return;
    if (this.playing && this.solution) {
      if (this.previousFrameTime !== null) {
        // Visibility transitions clear the timestamp, so this clamp only
        // rejects exceptional active-tab stalls while preserving real time at
        // ordinary low frame rates (including software-rendered WebGL).
        const elapsed = Math.min(0.25, Math.max(0, (time - this.previousFrameTime) / 1000));
        this.phase = advanceVisualPhase(this.phase, elapsed, this.solution.omegaAOverC);
        this.uniforms.uPhase.value = this.phase;
        this.host.dataset.phase = this.phase.toFixed(6);
      }
      this.previousFrameTime = time;
    } else {
      this.previousFrameTime = null;
    }
    const cameraMoving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameSequence += 1;
    this.host.dataset.frame = `${this.frameSequence}`;
    this.host.dataset.geometryCount = `${this.renderer.info.memory.geometries}`;
    this.host.dataset.textureCount = `${this.renderer.info.memory.textures}`;
    this.host.dataset.programCount = `${this.renderer.info.programs?.length ?? 0}`;
    if (this.playing || cameraMoving) this.requestFrame();
  };

  private cancelFrame(): void {
    if (this.rafId === 0) return;
    window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}

function createDuctGeometry(uniforms: PressureUniforms): GeometryBundle {
  const group = new THREE.Group();
  group.name = "open-pressure-duct";

  // CylinderGeometry is axial in Y; rotate it so the mathematical x-axis is world X.
  const shellGeometry = new THREE.CylinderGeometry(
    VISUAL_DUCT_RADIUS,
    VISUAL_DUCT_RADIUS,
    VISUAL_DUCT_LENGTH,
    SHELL_RADIAL_SEGMENTS,
    SHELL_LENGTH_SEGMENTS,
    true
  );
  shellGeometry.rotateZ(Math.PI / 2);
  const shellMaterial = new THREE.ShaderMaterial({
    name: "duct-wall-pressure",
    uniforms,
    vertexShader: PRESSURE_VERTEX_SHADER,
    fragmentShader: SHELL_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    depthWrite: true
  });
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  shell.name = "pressure-at-rigid-wall";
  group.add(shell);

  const { geometry: diskGeometry, radialAttribute } = createRadialDiskGeometry();
  // Both sampling planes retain and share the same tessellation and radial
  // attribute. Their materials share the pressure uniforms and Berlin texture,
  // while keeping only the analytic axial coordinate as a per-plane uniform.
  const nearDiskMaterial = createDiskMaterial(uniforms, 0, "near-sampling-plane-pressure");
  const farDiskMaterial = createDiskMaterial(
    uniforms,
    DUCT_LENGTH_OVER_RADIUS,
    "far-sampling-plane-pressure"
  );
  const nearDisk = new THREE.Mesh(diskGeometry, nearDiskMaterial);
  nearDisk.name = "x-zero-sampling-plane";
  nearDisk.position.x = NEAR_DISK_X;
  nearDisk.scale.set(1, VISUAL_DUCT_RADIUS, VISUAL_DUCT_RADIUS);
  nearDisk.renderOrder = 2;
  const farDisk = new THREE.Mesh(diskGeometry, farDiskMaterial);
  farDisk.name = "x-length-sampling-plane";
  farDisk.position.x = FAR_DISK_X;
  farDisk.scale.set(1, VISUAL_DUCT_RADIUS, VISUAL_DUCT_RADIUS);
  farDisk.renderOrder = 2;
  group.add(nearDisk, farDisk);

  const rimGeometry = new THREE.TorusGeometry(
    VISUAL_DUCT_RADIUS + 0.003,
    0.005,
    6,
    SHELL_RADIAL_SEGMENTS
  );
  rimGeometry.rotateY(Math.PI / 2);
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xc6d3df,
    transparent: true,
    opacity: 0.48,
    toneMapped: false
  });
  const nearRim = new THREE.Mesh(rimGeometry, outlineMaterial);
  nearRim.position.x = -VISUAL_DUCT_LENGTH / 2;
  nearRim.name = "near-open-rim";
  const farRim = new THREE.Mesh(rimGeometry, outlineMaterial);
  farRim.position.x = VISUAL_DUCT_LENGTH / 2;
  farRim.name = "far-open-rim";
  group.add(nearRim, farRim);

  return {
    group,
    shellGeometry,
    diskGeometry,
    shellMaterial,
    nearDiskMaterial,
    farDiskMaterial,
    outlineMaterial,
    rimGeometry,
    radialAttribute
  };
}

function createDiskMaterial(
  uniforms: PressureUniforms,
  axialCoordinate: number,
  name: string
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      ...uniforms,
      uDiskAxialCoordinate: { value: axialCoordinate }
    },
    vertexShader: DISK_VERTEX_SHADER,
    fragmentShader: DISK_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

function createRadialDiskGeometry(): {
  readonly geometry: THREE.BufferGeometry;
  readonly radialAttribute: THREE.BufferAttribute;
} {
  const positions: number[] = [];
  const uv: number[] = [];
  const radial: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= DISK_RADIAL_SEGMENTS; ring += 1) {
    const rho = ring / DISK_RADIAL_SEGMENTS;
    for (let segment = 0; segment <= DISK_ANGULAR_SEGMENTS; segment += 1) {
      const theta = (segment / DISK_ANGULAR_SEGMENTS) * Math.PI * 2;
      positions.push(0, rho * Math.cos(theta), rho * Math.sin(theta));
      uv.push(rho, segment / DISK_ANGULAR_SEGMENTS);
      radial.push(1);
    }
  }
  const stride = DISK_ANGULAR_SEGMENTS + 1;
  for (let ring = 0; ring < DISK_RADIAL_SEGMENTS; ring += 1) {
    for (let segment = 0; segment < DISK_ANGULAR_SEGMENTS; segment += 1) {
      const a = ring * stride + segment;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const radialAttribute = new THREE.Float32BufferAttribute(radial, 1);
  geometry.setAttribute("radialFactor", radialAttribute);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.01);
  return { geometry, radialAttribute };
}

function updateDiskRadialAttribute(
  attribute: THREE.BufferAttribute,
  samples: readonly number[]
): void {
  const stride = DISK_ANGULAR_SEGMENTS + 1;
  for (let ring = 0; ring <= DISK_RADIAL_SEGMENTS; ring += 1) {
    const value = interpolateSamples(samples, ring / DISK_RADIAL_SEGMENTS);
    for (let segment = 0; segment <= DISK_ANGULAR_SEGMENTS; segment += 1) {
      attribute.setX(ring * stride + segment, value);
    }
  }
  attribute.needsUpdate = true;
}

function interpolateSamples(samples: readonly number[], rho: number): number {
  const position = THREE.MathUtils.clamp(rho, 0, 1) * (samples.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(samples.length - 1, lower + 1);
  return THREE.MathUtils.lerp(samples[lower] ?? 0, samples[upper] ?? 0, position - lower);
}

function regimeCode(regime: ModalSolution["regime"]): number {
  if (regime === "propagating") return 0;
  if (regime === "evanescent") return 2;
  return 1;
}

const PRESSURE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjectPosition;
  void main() {
    vUv = uv;
    // CylinderGeometry's +pi/2 Z rotation is baked into this attribute, so
    // object position already uses the duct convention: axial world X and
    // cross-sectional world YZ.
    vObjectPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISK_VERTEX_SHADER = /* glsl */ `
  attribute float radialFactor;
  varying float vRadialFactor;
  varying vec3 vObjectPosition;
  void main() {
    vRadialFactor = radialFactor;
    vObjectPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHARED_FRAGMENT_HEADER = /* glsl */ `
  uniform sampler2D uBerlin;
  uniform float uPhase;
  uniform float uM;
  uniform float uAxialNumber;
  uniform float uRegime;
  const float PI = 3.141592653589793;

  vec3 pressureColor(float pressure) {
    return texture2D(uBerlin, vec2(clamp(pressure * 0.5 + 0.5, 0.0, 1.0), 0.5)).rgb;
  }

  // Real part of exp(i (m theta + k_x x - omega t)). For an evanescent
  // mode k_x is imaginary, so the axial dependence becomes a real decay
  // multiplying the common azimuthal-temporal phase.
  float modalPhaseFactor(float theta, float axialCoordinate) {
    float phaseAngle = uM * theta - uPhase;
    if (uRegime < 0.5) {
      phaseAngle += uAxialNumber * axialCoordinate;
    }
    float decay = uRegime > 1.5
      ? exp(-uAxialNumber * axialCoordinate)
      : 1.0;
    return decay * cos(phaseAngle);
  }
`;

const SHELL_FRAGMENT_SHADER = /* glsl */ `
  ${SHARED_FRAGMENT_HEADER}
  uniform float uWallRadial;
  varying vec2 vUv;
  varying vec3 vObjectPosition;
  void main() {
    // Use the same world-YZ azimuth convention as both sampling disks. The
    // baked position runs from -visualLength/2 at analytic x=0 to
    // +visualLength/2 at analytic x=ductLength/radius.
    float theta = atan(vObjectPosition.z, vObjectPosition.y);
    float x = (vObjectPosition.x + ${(VISUAL_DUCT_LENGTH / 2).toFixed(1)})
      * ${(DUCT_LENGTH_OVER_RADIUS / VISUAL_DUCT_LENGTH).toFixed(6)};
    float pressure = uWallRadial * modalPhaseFactor(theta, x);
    vec3 color = pressureColor(pressure);
    float edgeFade = smoothstep(0.0, 0.035, min(vUv.y, 1.0 - vUv.y));
    gl_FragColor = vec4(color, 0.93 + 0.07 * edgeFade);
    #include <colorspace_fragment>
  }
`;

const DISK_FRAGMENT_SHADER = /* glsl */ `
  ${SHARED_FRAGMENT_HEADER}
  uniform float uDiskAxialCoordinate;
  varying float vRadialFactor;
  varying vec3 vObjectPosition;
  void main() {
    float theta = atan(vObjectPosition.z, vObjectPosition.y);
    float pressure = vRadialFactor * modalPhaseFactor(theta, uDiskAxialCoordinate);
    vec3 color = pressureColor(pressure);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;
