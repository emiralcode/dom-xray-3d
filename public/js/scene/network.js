// Ağ uzayı: her alan adı (site) bir gezegen, her kaynak o gezegenin yörüngesinde bir uydu.
// Uydu boyutu = transfer boyutu (küp kök ölçek). Siteler arası çizgiler = "kim kimi yükledi" grafiği.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createFlowMaterial, createOrbMaterial } from './materials.js';
import { RES_TYPES, esc, fmtBytes } from '../util.js';

const TYPE_COLORS = Object.fromEntries(Object.entries(RES_TYPES).map(([k, v]) => [k, new THREE.Color(v.color)]));
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class Network {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    engine.scene.add(this.group);
    this.orbMat = createOrbMaterial();
    this.flowMat = createFlowMaterial();
    this.labels = [];
    this.showLabels = true;
    this.state = { hover: null, selected: null, hiddenTypes: new Set() };
    this.replayT = null;
    this.time = 0;
    engine.onFrame((dt, t) => this.#update(dt, t));
  }

  build(model, cityBounds) {
    this.dispose();
    this.model = model;
    const { resources, sites } = model;
    const coreName = model.raw.site;
    let coreIdx = sites.findIndex((s) => s.name === coreName);
    if (coreIdx < 0) coreIdx = 0;
    this.coreIdx = coreIdx;

    const size = cityBounds.size;
    const corePos = new THREE.Vector3(0, cityBounds.height + Math.max(16, size * 0.32), 0);
    this.corePos = corePos;
    const maxSite = Math.max(1, ...sites.map((s) => s.bytes));
    const maxRes = Math.max(1, ...resources.map((r) => r.bytes));

    // Gezegenler
    const D = size * 1.0 + 40;
    let j = 0;
    const others = sites.length - 1;
    this.planets = sites.map((s, i) => {
      const r = 1.4 + 5.5 * Math.cbrt(s.bytes / maxSite);
      let pos;
      if (i === coreIdx) pos = corePos.clone();
      else {
        const f = (j + 0.5) / Math.max(others, 1);
        const th = j * GOLDEN * 1.0 + 0.6;
        const phi = 0.22 + f * 0.8;
        const rr = D * (1 + (j % 3) * 0.08);
        pos = new THREE.Vector3(Math.cos(th) * Math.cos(phi) * rr, corePos.y * 0.35 + Math.sin(phi) * rr * 0.75, Math.sin(th) * Math.cos(phi) * rr);
        j++;
      }
      const k = s.resources.length;
      const shell = (i === coreIdx ? Math.max(r, 3.2) : r) + 2 + Math.sqrt(k) * 0.65;
      const axis = new THREE.Vector3((Math.random() - 0.5) * 0.7, 1, (Math.random() - 0.5) * 0.7).normalize();
      const domType = Object.entries(s.byType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
      return { site: s, idx: i, pos, radius: i === coreIdx ? Math.max(r, 3.2) : r, shell, axis, speed: 0.08 + 0.35 / Math.sqrt(k + 1), domType, appear: 0 };
    });

    // Uydular
    this.siteOf = new Int32Array(resources.length);
    this.sats = [];
    sites.forEach((s, si) => {
      const k = s.resources.length;
      s.resources.forEach((r, ri) => {
        const y = 1 - (2 * (ri + 0.5)) / k;
        const rad = Math.sqrt(1 - y * y);
        const th = ri * GOLDEN;
        const dir = new THREE.Vector3(rad * Math.cos(th), y * 0.75, rad * Math.sin(th)).normalize();
        const jitter = 1 + ((ri * 7919) % 13) / 60;
        this.siteOf[r.idx] = si;
        this.sats[r.idx] = { r, site: si, dir, dist: this.planets[si].shell * jitter, radius: 0.22 + 2.4 * Math.cbrt(r.bytes / maxRes), appear: 0 };
      });
    });

    const N = resources.length;
    this.satPos = new Float32Array(N * 3);
    this.satScale = new Float32Array(N);

    // Uydu mesh'i
    this.satGeo = new THREE.IcosahedronGeometry(1, 1);
    this.satTint = new Float32Array(N * 3);
    this.satGlow = new Float32Array(N);
    this.satGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.satTint, 3));
    this.satGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.satGlow, 1));
    this.satMesh = new THREE.InstancedMesh(this.satGeo, this.orbMat, Math.max(N, 1));
    this.satMesh.count = N;
    this.satMesh.frustumCulled = false;
    this.satMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.satMesh);

    // Gezegen mesh'i
    const P = this.planets.length;
    this.planetGeo = new THREE.SphereGeometry(1, 36, 18);
    this.planetTint = new Float32Array(P * 3);
    this.planetGlow = new Float32Array(P);
    this.planetGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.planetTint, 3));
    this.planetGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.planetGlow, 1));
    this.planetMesh = new THREE.InstancedMesh(this.planetGeo, this.orbMat, Math.max(P, 1));
    this.planetMesh.count = P;
    this.planetMesh.frustumCulled = false;
    this.group.add(this.planetMesh);

    // Çekirdek (doküman) için tel kafes
    this.coreWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(this.planets[coreIdx]?.radius * 1.45 || 4, 1),
      new THREE.MeshBasicMaterial({ color: 0x7fb2ff, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.coreWire.position.copy(corePos);
    this.group.add(this.coreWire);

    this.#buildRings();
    this.#buildLinks(cityBounds);
    this.#buildLabels();
    this.#buildChain();
    this.applyStyles();
    this.#update(0, 0);
    return this.bounds();
  }

  bounds() {
    let r = 0;
    for (const p of this.planets || []) r = Math.max(r, p.pos.length() + p.shell);
    return { radius: r, core: this.corePos };
  }

  #buildRings() {
    const pts = [];
    const SEG = 64;
    for (const p of this.planets) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.axis);
      for (let s = 0; s < SEG; s++) {
        for (const a of [s, s + 1]) {
          const th = (a / SEG) * Math.PI * 2;
          _v.set(Math.cos(th) * p.shell, 0, Math.sin(th) * p.shell).applyQuaternion(q).add(p.pos);
          pts.push(_v.x, _v.y, _v.z);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rings = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5d8cff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.rings);
  }

  #buildLinks(cityBounds) {
    const { resources } = this.model;
    const links = new Map();
    for (const r of resources) {
      const to = this.siteOf[r.idx];
      const from = r.parent >= 0 ? this.siteOf[r.parent] : this.coreIdx;
      if (from === to) continue;
      const key = `${from}>${to}`;
      const l = links.get(key) || { from, to, count: 0, types: {} };
      l.count++;
      l.types[r.type] = (l.types[r.type] || 0) + 1;
      links.set(key, l);
    }
    this.links = [...links.values()];

    const pos = [], t = [], col = [], seed = [], speed = [];
    const SEG = 48;
    const addCurve = (a, b, lift, color, s, sp) => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += lift;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const p = curve.getPoints(SEG);
      for (let i = 0; i < SEG; i++) {
        pos.push(p[i].x, p[i].y, p[i].z, p[i + 1].x, p[i + 1].y, p[i + 1].z);
        t.push(i / SEG, (i + 1) / SEG);
        col.push(color.r, color.g, color.b, color.r, color.g, color.b);
        seed.push(s, s);
        speed.push(sp, sp);
      }
    };
    for (const l of this.links) {
      const a = this.planets[l.from].pos;
      const b = this.planets[l.to].pos;
      const dom = Object.entries(l.types).sort((x, y) => y[1] - x[1])[0][0];
      addCurve(a, b, a.distanceTo(b) * 0.18, TYPE_COLORS[dom], Math.random(), 0.6 + Math.min(2.5, Math.log2(1 + l.count) * 0.5));
    }
    // Doküman çekirdeğinden şehre inen ışın
    addCurve(this.corePos, new THREE.Vector3(0, cityBounds.height, 0), 0, new THREE.Color(0x9fc2ff), 0, 1.6);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
    this.flow = new THREE.LineSegments(g, this.flowMat);
    this.flow.frustumCulled = false;
    this.group.add(this.flow);
  }

  #buildLabels() {
    const show = this.planets
      .filter((p) => p.idx === this.coreIdx || p.site.thirdParty)
      .sort((a, b) => (a.idx === this.coreIdx ? -1 : b.idx === this.coreIdx ? 1 : b.site.bytes - a.site.bytes))
      .slice(0, 15);
    for (const p of show) {
      const el = document.createElement('div');
      const core = p.idx === this.coreIdx;
      el.className = `lbl lbl-site${core ? ' lbl-core' : ''}`;
      el.innerHTML = `${core ? '<b>◉</b> ' : ''}${esc(p.site.name)}<small>${p.site.resources.length} istek · ${fmtBytes(p.site.bytes)}</small>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onLabelClick?.(p.idx); });
      const obj = new CSS2DObject(el);
      obj.position.copy(p.pos).add(new THREE.Vector3(0, p.radius + 1.6, 0));
      obj.userData.planet = p.idx;
      this.group.add(obj);
      this.labels.push(obj);
    }
    this.setLabelsVisible(this.showLabels);
  }

  #buildChain() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    g.setDrawRange(0, 0);
    this.chain = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.chain.frustumCulled = false;
    this.group.add(this.chain);
    this.chainIdx = [];
  }

  /* ------------------------------ Kare ------------------------------ */

  #update(dt, time) {
    if (!this.model) return;
    this.time = time;
    const { hiddenTypes } = this.state;
    const arr = this.satMesh.instanceMatrix.array;
    const k = 1 - Math.exp(-dt * 5);
    const planetAppear = new Float32Array(this.planets.length);
    const core = this.corePos;

    for (const p of this.planets) p._q = _q.clone().setFromAxisAngle(p.axis, time * p.speed);

    for (let i = 0; i < this.sats.length; i++) {
      const s = this.sats[i];
      const r = s.r;
      const want = !hiddenTypes.has(r.type) && (this.replayT == null || r.start <= this.replayT) ? 1 : 0;
      s.appear += (want - s.appear) * (dt === 0 ? 1 : k);
      if (Math.abs(want - s.appear) < 0.001) s.appear = want;
      const p = this.planets[s.site];
      _v.copy(s.dir).applyQuaternion(p._q).multiplyScalar(s.dist).add(p.pos);
      // Yeni yüklenen kaynak doküman çekirdeğinden fırlar
      const e = 1 - Math.pow(1 - s.appear, 3);
      const x = core.x + (_v.x - core.x) * e, y = core.y + (_v.y - core.y) * e, z = core.z + (_v.z - core.z) * e;
      const sc = s.radius * s.appear;
      this.satPos[i * 3] = x; this.satPos[i * 3 + 1] = y; this.satPos[i * 3 + 2] = z;
      this.satScale[i] = sc;
      const m = i * 16;
      arr[m] = sc; arr[m + 1] = 0; arr[m + 2] = 0; arr[m + 3] = 0;
      arr[m + 4] = 0; arr[m + 5] = sc; arr[m + 6] = 0; arr[m + 7] = 0;
      arr[m + 8] = 0; arr[m + 9] = 0; arr[m + 10] = sc; arr[m + 11] = 0;
      arr[m + 12] = x; arr[m + 13] = y; arr[m + 14] = z; arr[m + 15] = 1;
      if (want && planetAppear[s.site] < 1) planetAppear[s.site] = 1;
    }
    this.satMesh.instanceMatrix.needsUpdate = true;

    const parr = this.planetMesh.instanceMatrix.array;
    for (const p of this.planets) {
      const want = p.idx === this.coreIdx ? 1 : planetAppear[p.idx];
      p.appear += (want - p.appear) * (dt === 0 ? 1 : k);
      const sc = p.radius * p.appear;
      const m = p.idx * 16;
      parr.set([sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, p.pos.x, p.pos.y, p.pos.z, 1], m);
    }
    this.planetMesh.instanceMatrix.needsUpdate = true;
    for (const obj of this.labels) obj.element.style.opacity = this.planets[obj.userData.planet].appear.toFixed(2);

    this.coreWire.rotation.y = time * 0.25;
    this.coreWire.rotation.x = time * 0.11;

    // Başlatıcı zinciri
    if (this.chainIdx.length) {
      const a = this.chain.geometry.attributes.position.array;
      let c = 0;
      for (const idx of this.chainIdx) { a[c++] = this.satPos[idx * 3]; a[c++] = this.satPos[idx * 3 + 1]; a[c++] = this.satPos[idx * 3 + 2]; }
      a[c++] = core.x; a[c++] = core.y; a[c++] = core.z;
      this.chain.geometry.setDrawRange(0, c / 3);
      this.chain.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ---------------------------- Vurgulama ---------------------------- */

  setState(patch) {
    Object.assign(this.state, patch);
    this.applyStyles();
  }

  applyStyles() {
    if (!this.model) return;
    const { hover, selected } = this.state;
    const selSite = selected?.kind === 'site' ? selected.idx : selected?.kind === 'resource' ? this.siteOf[selected.idx] : -1;
    for (let i = 0; i < this.sats.length; i++) {
      const r = this.sats[i].r;
      _c.copy(TYPE_COLORS[r.type] || TYPE_COLORS.other);
      let g = r.failed ? 0.4 : 1;
      let f = r.failed ? 0.45 : 1;
      if (selSite >= 0 && this.sats[i].site !== selSite) { f *= 0.35; g *= 0.4; }
      if (this.chainIdx.includes(i)) { g = 2.6; f = 1.2; }
      if (selected?.kind === 'resource' && selected.idx === i) { _c.lerp(new THREE.Color(1, 1, 1), 0.4); g = 5; f = 1.4; }
      else if (hover?.kind === 'resource' && hover.idx === i) { g = 3.5; f = 1.3; }
      this.satTint.set([_c.r * f, _c.g * f, _c.b * f], i * 3);
      this.satGlow[i] = g;
    }
    this.satGeo.attributes.aTint.needsUpdate = true;
    this.satGeo.attributes.aGlow.needsUpdate = true;

    for (const p of this.planets) {
      if (p.idx === this.coreIdx) _c.set(0x8fb8ff);
      else _c.copy(TYPE_COLORS[p.domType]).lerp(new THREE.Color(0x9aa6c0), 0.35);
      let g = p.idx === this.coreIdx ? 1.6 : 0.9;
      if (selSite === p.idx) g = 3.2;
      else if (hover?.kind === 'site' && hover.idx === p.idx) g = 2.6;
      this.planetTint.set([_c.r, _c.g, _c.b], p.idx * 3);
      this.planetGlow[p.idx] = g;
    }
    this.planetGeo.attributes.aTint.needsUpdate = true;
    this.planetGeo.attributes.aGlow.needsUpdate = true;
  }

  /** Seçili kaynağın başlatıcı zincirini (initiator) çizer. */
  setChain(resIdx) {
    this.chainIdx = [];
    if (resIdx != null && resIdx >= 0) {
      const seen = new Set();
      for (let i = resIdx; i >= 0 && !seen.has(i) && this.chainIdx.length < 60; i = this.model.resources[i].parent) {
        seen.add(i);
        this.chainIdx.push(i);
      }
    }
    if (!this.chainIdx.length) this.chain.geometry.setDrawRange(0, 0);
    this.applyStyles();
  }

  setReplay(t) {
    this.replayT = t;
  }

  /* ------------------------------ Seçim ------------------------------ */

  pick(ray) {
    if (!this.model || !this.group.visible) return null;
    let best = null;
    const o = ray.origin, d = ray.direction;
    const test = (cx, cy, cz, r, hit) => {
      if (r <= 0.01) return;
      const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z;
      const tca = lx * d.x + ly * d.y + lz * d.z;
      if (tca < 0) return;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      const rr = (r * 1.15) ** 2;
      if (d2 > rr) return;
      const t = tca - Math.sqrt(rr - d2);
      if (!best || t < best.distance) best = { ...hit, distance: t };
    };
    for (let i = 0; i < this.sats.length; i++) {
      test(this.satPos[i * 3], this.satPos[i * 3 + 1], this.satPos[i * 3 + 2], Math.max(this.satScale[i], this.satScale[i] > 0 ? 0.45 : 0), { kind: 'resource', idx: i });
    }
    for (const p of this.planets) test(p.pos.x, p.pos.y, p.pos.z, p.radius * p.appear, { kind: 'site', idx: p.idx });
    return best;
  }

  focusOf(hit) {
    if (hit.kind === 'site') {
      const p = this.planets[hit.idx];
      return { center: p.pos.clone(), radius: p.shell + 2 };
    }
    const i = hit.idx;
    return { center: new THREE.Vector3(this.satPos[i * 3], this.satPos[i * 3 + 1], this.satPos[i * 3 + 2]), radius: Math.max(this.sats[i].radius * 3, 3) };
  }

  setLabelsVisible(v) {
    this.showLabels = v;
    for (const obj of this.labels) obj.visible = v && this.group.visible;
  }

  setVisible(v) {
    this.group.visible = v;
    this.setLabelsVisible(this.showLabels);
  }

  dispose() {
    for (const obj of this.labels) obj.element.remove();
    this.labels = [];
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose();
      if (child.material && child.material !== this.orbMat && child.material !== this.flowMat) child.material.dispose();
    }
    this.model = null;
    this.chainIdx = [];
  }
}
