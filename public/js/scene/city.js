// DOM city: every element is one InstancedMesh instance (a box). Handles layout transitions,
// the rise animation, highlighting and fast ray–box (AABB) picking.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createBoxMaterial } from './materials.js';
import { layoutCity, layoutLayers } from './layouts.js';
import { DOM_CATEGORIES, clamp, easeInOut, esc } from '../util.js';
import { nodeLabel } from '../model.js';

const CAT_COLORS = Object.fromEntries(Object.entries(DOM_CATEGORIES).map(([k, v]) => [k, new THREE.Color(v.color)]));
const WHITE = new THREE.Color(1, 1, 1);

export class City {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    engine.scene.add(this.group);
    this.material = createBoxMaterial();
    this.geometry = null;
    this.mesh = null;
    this.labels = [];
    this.state = { hover: -1, selected: -1, path: null, match: null, hiddenCats: new Set(), showHidden: true };
    this.showLabels = true;
    engine.onFrame((dt) => this.#update(dt));
  }

  build(model) {
    this.dispose();
    this.model = model;
    const n = model.nodes.length;
    this.n = n;
    this.layouts = { city: layoutCity(model), layers: layoutLayers(model) };
    this.layoutName = 'city';
    this.current = new Float32Array(this.layouts.city.boxes);
    this.from = new Float32Array(n * 6);
    this.target = this.layouts.city.boxes;
    this.trans = 1; // transition progress (1 = finished)
    this.rise = 0; // intro animation
    this.seed = new Float32Array(n).map(() => Math.random());

    this.tint = new Float32Array(n * 3);
    this.glow = new Float32Array(n);
    this.geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.tint, 3));
    this.geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.glow, 1));

    const mesh = (this.mesh = new THREE.InstancedMesh(this.geometry, this.material, n));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);

    this.#buildLabels();
    this.applyStyles();
    this.#writeMatrices();
    return this.bounds();
  }

  /* ------------------------------ Layout ------------------------------ */

  setLayout(name) {
    if (!this.model || name === this.layoutName) return;
    this.layoutName = name;
    this.from.set(this.current);
    this.target = this.layouts[name].boxes;
    this.trans = 0;
  }

  bounds() {
    if (!this.model) return { size: 60, height: 10, center: new THREE.Vector3() };
    const L = this.layouts[this.layoutName];
    const b = L.boxes;
    let maxY = 0;
    for (let i = 0; i < this.n; i++) maxY = Math.max(maxY, b[i * 6 + 1] + b[i * 6 + 4]);
    return { size: L.size, height: maxY, center: new THREE.Vector3(0, maxY * 0.3, 0) };
  }

  /** World-space center and radius of a node (in the target layout). */
  nodeBox(i) {
    const b = this.target;
    const o = i * 6;
    const center = new THREE.Vector3(b[o], b[o + 1] + b[o + 4] / 2, b[o + 2]);
    const radius = Math.max(b[o + 3], b[o + 5], b[o + 4]) * 0.75 + 4;
    return { center, radius, top: new THREE.Vector3(b[o], b[o + 1] + b[o + 4], b[o + 2]) };
  }

  #update(dt) {
    if (!this.mesh) return;
    let dirty = false;
    if (this.rise < 1.6) {
      this.rise += dt * 0.75;
      dirty = true;
    }
    if (this.trans < 1) {
      this.trans = Math.min(1, this.trans + dt * 0.8);
      const n6 = this.n * 6;
      const nodes = this.model.nodes;
      for (let i = 0; i < this.n; i++) {
        const k = easeInOut(clamp(this.trans * 1.35 - nodes[i].d * 0.012 - this.seed[i] * 0.08, 0, 1));
        const o = i * 6;
        for (let j = 0; j < 6; j++) this.current[o + j] = this.from[o + j] + (this.target[o + j] - this.from[o + j]) * k;
      }
      if (this.trans >= 1) this.current.set(this.target.subarray(0, n6));
      dirty = true;
      this.#positionLabels();
    }
    if (dirty) this.#writeMatrices();
  }

  #writeMatrices() {
    const arr = this.mesh.instanceMatrix.array;
    const b = this.current;
    const nodes = this.model.nodes;
    const rising = this.rise < 1.6;
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      let sy = b[o + 4];
      if (rising) {
        const k = clamp((this.rise * 1.6 - nodes[i].d * 0.045 - this.seed[i] * 0.15) / 0.5, 0, 1);
        sy *= 1 - Math.pow(1 - k, 3);
      }
      const hiddenCat = this.state.hiddenCats.has(nodes[i].cat) || (!this.state.showHidden && nodes[i].h);
      const s = hiddenCat ? 0 : 1;
      const m = i * 16;
      arr[m] = b[o + 3] * s; arr[m + 1] = 0; arr[m + 2] = 0; arr[m + 3] = 0;
      arr[m + 4] = 0; arr[m + 5] = sy * s; arr[m + 6] = 0; arr[m + 7] = 0;
      arr[m + 8] = 0; arr[m + 9] = 0; arr[m + 10] = b[o + 5] * s; arr[m + 11] = 0;
      arr[m + 12] = b[o]; arr[m + 13] = b[o + 1]; arr[m + 14] = b[o + 2]; arr[m + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------------------- Highlighting ---------------------------- */

  setState(patch) {
    const prevCats = this.state.hiddenCats;
    const prevHidden = this.state.showHidden;
    Object.assign(this.state, patch);
    this.applyStyles();
    if (this.state.hiddenCats !== prevCats || this.state.showHidden !== prevHidden) this.#writeMatrices();
  }

  applyStyles() {
    if (!this.mesh) return;
    const { nodes } = this.model;
    const { hover, selected, path, match } = this.state;
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      const node = nodes[i];
      c.copy(CAT_COLORS[node.cat]);
      let f = 1;
      let g = 1;
      if (node.h) { f = 0.35; g = 0.35; }
      if (match) {
        if (match[i]) { f = 1.25; g = 2.4; } else { f *= 0.12; g = 0.08; }
      }
      if (path && path.has(i)) { g = Math.max(g, 2.2); f = Math.max(f, 1); }
      if (i === selected) { c.lerp(WHITE, 0.45); g = 4.5; f = 1.4; }
      else if (i === hover) { c.lerp(WHITE, 0.25); g = 3.2; f = 1.3; }
      this.tint[i * 3] = c.r * f;
      this.tint[i * 3 + 1] = c.g * f;
      this.tint[i * 3 + 2] = c.b * f;
      this.glow[i] = g;
    }
    this.geometry.attributes.aTint.needsUpdate = true;
    this.geometry.attributes.aGlow.needsUpdate = true;
  }

  /* ------------------------------ Picking ------------------------------ */

  /** Finds the nearest visible box hit by the ray (slab method). */
  pick(ray) {
    if (!this.mesh) return null;
    const b = this.current;
    const { nodes } = this.model;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const ix = 1 / ray.direction.x, iy = 1 / ray.direction.y, iz = 1 / ray.direction.z;
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      const hx = b[o + 3] / 2, hz = b[o + 5] / 2, hy = b[o + 4];
      if (hx === 0 || hy === 0) continue;
      const node = nodes[i];
      if (this.state.hiddenCats.has(node.cat) || (!this.state.showHidden && node.h)) continue;
      let t1 = (b[o] - hx - ox) * ix, t2 = (b[o] + hx - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (b[o + 1] - oy) * iy; t2 = (b[o + 1] + hy - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b[o + 2] - hz - oz) * iz; t2 = (b[o + 2] + hz - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= Math.max(tmin, 0) && tmin < bestT) {
        bestT = tmin;
        best = i;
      }
    }
    return best >= 0 ? { kind: 'node', idx: best, distance: bestT } : null;
  }

  /* ------------------------------- Labels ------------------------------- */

  #buildLabels() {
    const { nodes, desc, children } = this.model;
    const n = this.n;
    const minDesc = Math.max(8, n * 0.03);
    const candidates = [];
    for (let i = 1; i < n; i++) {
      if (nodes[i].d <= 5 && desc[i] >= minDesc && !nodes[i].h) candidates.push(i);
    }
    candidates.sort((a, b) => desc[b] - desc[a]);
    const chosen = [];
    for (const i of candidates) {
      // Skip single-child wrapper chains: parent already chosen and nearly the same size.
      const p = nodes[i].p;
      if (chosen.includes(p) && desc[i] > desc[p] * 0.75) continue;
      if (children[i].length === 1 && desc[children[i][0]] > desc[i] * 0.9 && !nodes[i].i) continue;
      chosen.push(i);
      if (chosen.length >= 9) break;
    }
    for (const i of chosen) {
      const el = document.createElement('div');
      el.className = 'lbl lbl-node';
      el.innerHTML = `<span class="lbl-dot" style="background:${DOM_CATEGORIES[nodes[i].cat].color}"></span>${esc(nodeLabel(nodes[i]))}<small>${desc[i] + 1}</small>`;
      const obj = new CSS2DObject(el);
      obj.userData.idx = i;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onLabelClick?.(i); });
      this.group.add(obj);
      this.labels.push(obj);
    }
    this.#positionLabels();
    this.setLabelsVisible(this.showLabels);
  }

  #positionLabels() {
    const b = this.current;
    for (const obj of this.labels) {
      const o = obj.userData.idx * 6;
      obj.position.set(b[o], b[o + 1] + b[o + 4] + 0.8, b[o + 2]);
      obj.visible = this.showLabels && this.group.visible && b[o + 3] > 0;
    }
  }

  setLabelsVisible(v) {
    this.showLabels = v;
    for (const obj of this.labels) obj.visible = v && this.group.visible;
    if (v) this.#positionLabels();
  }

  setVisible(v) {
    this.group.visible = v;
    this.setLabelsVisible(this.showLabels);
  }

  dispose() {
    for (const obj of this.labels) { obj.element.remove(); this.group.remove(obj); }
    this.labels = [];
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.model = null;
  }
}
