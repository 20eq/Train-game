/**
 * Track geometry: control points in, a drivable path out.
 *
 * A path is a Catmull-Rom curve sampled into a dense polyline with a cumulative
 * length table, so anything that moves along the rails only needs a scalar
 * `s` (distance from the start) and we can ask where that lands.
 */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

function crValue(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** Densify control points into a smooth polyline. */
export function catmullRom(points, perSegment = 16) {
  if (points.length < 2) throw new Error('a path needs at least two points');
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      out.push({ x: crValue(p0.x, p1.x, p2.x, p3.x, t), y: crValue(p0.y, p1.y, p2.y, p3.y, t) });
    }
  }
  out.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return out;
}

export function buildPath(control, perSegment = 16) {
  const pts = catmullRom(control, perSegment);
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Position, heading and curvature at distance `s`. */
export function sample(path, s) {
  const { pts, cum, length } = path;
  const d = clamp(s, 0, length);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  const u = (d - cum[lo]) / span;
  const a = pts[lo];
  const b = pts[hi];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), angle };
}

/** Nearest point on the path to (x, y) — used to place stations on the track. */
export function project(path, x, y) {
  const { pts, cum } = path;
  let best = { s: 0, dist: Infinity, x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = clamp(t, 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(px - x, py - y);
    if (dist < best.dist) best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, dist, x: px, y: py };
  }
  return best;
}

/** A point `lateral` units to the side of the track (positive = left of travel). */
export function offsetPoint(path, s, lateral) {
  const p = sample(path, s);
  const nx = Math.cos(p.angle + Math.PI / 2);
  const ny = Math.sin(p.angle + Math.PI / 2);
  return { x: p.x + nx * lateral, y: p.y + ny * lateral, angle: p.angle };
}

/** Distance along the path between two trains, or null if they are not ordered. */
export function spacing(path, behind, ahead) {
  return ahead - behind;
}
