// Three.js scene engine: renderer, camera, controls, bloom, labels, stars, ground, camera flights.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createGroundMaterial, sharedUniforms } from './materials.js';
import { easeInOut } from '../util.js';

export class Engine {
  constructor(container) {
    this.container = container;
    this.frameHandlers = new Set();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.bloomEnabled = true;

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('debug') }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x03050b, 1);
    container.appendChild(renderer.domElement);

    const labels = (this.labelRenderer = new CSS2DRenderer());
    labels.domElement.className = 'label-layer';
    container.appendChild(labels.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(0x03050b, 0.0016);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
    this.camera.position.set(140, 110, 160);

    const controls = (this.controls = new OrbitControls(this.camera, renderer.domElement));
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 3;
    controls.maxDistance = 2500;
    controls.autoRotateSpeed = 0.35;
    controls.screenSpacePanning = true;
    controls.addEventListener('start', () => this.cancelFlight());

    // Lights
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0d18, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0.6, 1, 0.35);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6a5cff, 0.6);
    rim.position.set(-0.7, 0.4, -0.8);
    scene.add(rim);

    // Ground
    this.groundMat = createGroundMaterial();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.renderOrder = -1;
    scene.add(ground);

    this.#addStars();

    // Post-processing
    const composer = (this.composer = new EffectComposer(renderer));
    composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.32);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());

    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(container);
    this.resize();

    this.flight = null;
    this.scan = null;
    renderer.setAnimationLoop(() => this.#tick());
  }

  #addStars() {
    const N = 3500;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 1800 + Math.random() * 1500;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), Math.abs(r * u) * 0.9 + 40, r * s * Math.sin(th)], i * 3);
      c.setHSL(0.58 + Math.random() * 0.15, 0.6, 0.55 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, m);
    this.scene.add(this.stars);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.labelRenderer.setSize(w, h);
  }

  onFrame(fn) {
    this.frameHandlers.add(fn);
    return () => this.frameHandlers.delete(fn);
  }

  setWorldScale(size) {
    this.groundMat.uniforms.uCell.value = Math.max(1, Math.round(size / 40));
    this.groundMat.uniforms.uFade.value = size * 3.2;
    this.scene.fog.density = 0.55 / Math.max(size * 2.6, 100);
  }

  /** Smoothly flies the camera to a target. */
  flyTo(target, position, duration = 1.1) {
    this.flight = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: position.clone(),
      toTarget: target.clone(),
    };
  }

  /** Focuses on a point so that an object of the given radius fills the frame. */
  focus(center, radius, duration) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.45;
    dir.normalize();
    const dist = Math.max(radius / Math.sin((this.camera.fov * Math.PI) / 360), 14) * 1.25;
    this.flyTo(center, center.clone().add(dir.multiplyScalar(dist)), duration);
  }

  cancelFlight() {
    this.flight = null;
  }

  /** Starts the X-ray scan ring. */
  pulseScan(maxRadius, duration = 2.4, intensity = 1) {
    this.scan = { t: 0, maxRadius, duration, intensity };
  }

  setBloom(on) {
    this.bloomEnabled = on;
  }

  #tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const time = this.timer.getElapsed();
    sharedUniforms.uTime.value = time;

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const k = easeInOut(Math.min(f.t, 1));
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      if (f.t >= 1) this.flight = null;
    }

    if (this.scan) {
      const s = this.scan;
      s.t += dt / s.duration;
      sharedUniforms.uScanR.value = s.t * s.maxRadius;
      sharedUniforms.uScanW.value = Math.max(3, s.maxRadius * 0.05);
      sharedUniforms.uScanI.value = s.intensity * (1 - Math.pow(s.t, 3));
      if (s.t >= 1) {
        this.scan = null;
        sharedUniforms.uScanI.value = 0;
      }
    }

    for (const fn of this.frameHandlers) fn(dt, time);
    this.controls.update(dt);
    this.stars.rotation.y += dt * 0.002;

    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
