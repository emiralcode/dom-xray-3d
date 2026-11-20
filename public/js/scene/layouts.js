// Two layouts that place the DOM tree into 3D boxes:
//  - "city":   Squarified treemap. Area = subtree size, height = nesting depth (code-city).
//  - "layers": Real page layout (getBoundingClientRect). Every DOM level is one floor.
// Output: [cx, y0, cz, sx, sy, sz] per node (Float32Array, 6 * n).

export const FLOOR = 1.0;
export const LAYER_FLOOR = 0.55;

function worst(row, sum, side) {
  let max = 0;
  let min = Infinity;
  for (const a of row) { if (a > max) max = a; if (a < min) min = a; }
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/** Squarified treemap: weights → rectangles [x, y, w, h]. */
export function squarify(weights, x, y, w, h) {
  const order = weights.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const total = order.reduce((s, [v]) => s + v, 0) || 1;
  const scale = (w * h) / total;
  const out = new Array(weights.length);
  let row = [];
  let rowIdx = [];
  let rowSum = 0;

  const flush = () => {
    if (!row.length) return;
    if (w >= h) {
      const cw = rowSum / h;
      let oy = y;
      for (let k = 0; k < row.length; k++) {
        const rh = row[k] / cw;
        out[rowIdx[k]] = [x, oy, cw, rh];
        oy += rh;
      }
      x += cw; w -= cw;
    } else {
      const rh = rowSum / w;
      let ox = x;
      for (let k = 0; k < row.length; k++) {
        const cw = row[k] / rh;
        out[rowIdx[k]] = [ox, y, cw, rh];
        ox += cw;
      }
      y += rh; h -= rh;
    }
    row = []; rowIdx = []; rowSum = 0;
  };

  for (const [v, i] of order) {
    const a = v * scale;
    const side = Math.min(w, h);
    if (!row.length || worst([...row, a], rowSum + a, side) <= worst(row, rowSum, side)) {
      row.push(a); rowIdx.push(i); rowSum += a;
    } else {
      flush();
      row.push(a); rowIdx.push(i); rowSum += a;
    }
  }
  flush();
  return out;
}

export function worldSizeFor(model) {
  return Math.min(Math.max(Math.sqrt(model.nodes.length) * 2.3, 34), 280);
}

function leafHeight(node) {
  let content = (node.x || 0) / 60;
  if (node.t === 'img' || node.t === 'video' || node.t === 'canvas' || node.t === 'iframe') {
    const [, , w, h] = node.r;
    content += (w * h) / 25000;
  }
  return FLOOR * (0.9 + Math.min(7, Math.log2(1 + content) * 1.3));
}

export function layoutCity(model) {
  const { nodes, children, desc } = model;
  const n = nodes.length;
  const out = new Float32Array(n * 6);
  const size = worldSizeFor(model);

  const place = (i, x, z, w, d) => {
    const gap = Math.min(Math.min(w, d) * 0.045, 0.45);
    const bx = x + gap, bz = z + gap, bw = Math.max(w - gap * 2, 0.02), bd = Math.max(d - gap * 2, 0.02);
    const kids = children[i];
    const node = nodes[i];
    const h = kids.length ? FLOOR * 0.82 : leafHeight(node);
    out.set([bx + bw / 2, node.d * FLOOR, bz + bd / 2, bw, h, bd], i * 6);
    if (!kids.length) return;
    const pad = Math.min(Math.max(Math.min(bw, bd) * 0.055, 0.04), 1.4);
    const iw = bw - pad * 2, id = bd - pad * 2;
    if (iw <= 0.01 || id <= 0.01) {
      // Out of room: stack the subtree vertically (it rises like a skyscraper).
      for (const k of kids) placeStacked(k, bx + bw / 2, bz + bd / 2, bw * 0.8, bd * 0.8);
      return;
    }
    const rects = squarify(kids.map((k) => desc[k] + 1), bx + pad, bz + pad, iw, id);
    kids.forEach((k, j) => {
      const [rx, rz, rw, rd] = rects[j];
      place(k, rx, rz, rw, rd);
    });
  };
  const placeStacked = (i, cx, cz, w, d) => {
    const node = nodes[i];
    out.set([cx, node.d * FLOOR, cz, w, FLOOR * 0.82, d], i * 6);
    for (const k of children[i]) placeStacked(k, cx, cz, w * 0.92, d * 0.92);
  };

  if (n) place(0, -size / 2, -size / 2, size, size);
  return { boxes: out, size };
}

export function layoutLayers(model) {
  const { nodes } = model;
  const n = nodes.length;
  const out = new Float32Array(n * 6);
  const vw = model.raw.viewport?.width || 1440;
  const [dw, dh] = model.raw.dom.docSize || [vw, 900];
  const W = Math.max(vw, Math.min(dw, vw * 3));
  const H = Math.max(Math.min(dh, 40000), 300);
  const target = worldSizeFor(model) * 1.1;
  const s = target / Math.sqrt(W * H);

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    let [x, y, w, h] = node.r;
    // Clip anything overflowing the page
    const x2 = Math.min(x + w, W), y2 = Math.min(y + h, H);
    x = Math.max(x, 0); y = Math.max(y, 0);
    w = x2 - x; h = y2 - y;
    if (w <= 0 || h <= 0 || node.h) {
      out.set([0, node.d * LAYER_FLOOR, 0, 0, 0, 0], i * 6);
      continue;
    }
    const inset = Math.min(0.08, Math.min(w, h) * s * 0.05);
    out.set([
      (x + w / 2 - W / 2) * s,
      node.d * LAYER_FLOOR,
      (y + h / 2 - H / 2) * s,
      Math.max(w * s - inset * 2, 0.01),
      LAYER_FLOOR * 0.8,
      Math.max(h * s - inset * 2, 0.01),
    ], i * 6);
  }
  return { boxes: out, size: Math.max(W, H) * s };
}
