/**
 * Approximate arc length of a simple SVG path `d` string (M/L/C/Z only —
 * the full command set sketchLoaderPaths.ts's data actually uses).
 *
 * The web version normalizes every path to a 0-1 range via the `pathLength`
 * SVG attribute, so a single strokeDasharray/strokeDashoffset of "1" works
 * for any path. react-native-svg doesn't implement `pathLength` at all, so
 * this stands in for it: compute each path's real length once, then drive
 * strokeDashoffset in that path's own units instead of a normalized 0-1.
 */

interface Point { x: number; y: number }

function parseD(d: string): Array<{ cmd: string; nums: number[] }> {
  const chunks = d.match(/[MLCZ][^MLCZ]*/g) ?? [];
  return chunks.map((chunk) => ({
    cmd: chunk[0],
    nums: (chunk.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number),
  }));
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
  };
}

const CURVE_SAMPLES = 24;

export function estimatePathLength(d: string): number {
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let length = 0;
  for (const { cmd, nums } of parseD(d)) {
    if (cmd === 'M') {
      cur = { x: nums[0], y: nums[1] };
      start = cur;
    } else if (cmd === 'L') {
      const next = { x: nums[0], y: nums[1] };
      length += Math.hypot(next.x - cur.x, next.y - cur.y);
      cur = next;
    } else if (cmd === 'C') {
      const p1 = { x: nums[0], y: nums[1] };
      const p2 = { x: nums[2], y: nums[3] };
      const p3 = { x: nums[4], y: nums[5] };
      let prev = cur;
      for (let s = 1; s <= CURVE_SAMPLES; s++) {
        const pt = cubicPoint(cur, p1, p2, p3, s / CURVE_SAMPLES);
        length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
        prev = pt;
      }
      cur = p3;
    } else if (cmd === 'Z') {
      length += Math.hypot(start.x - cur.x, start.y - cur.y);
      cur = start;
    }
  }
  return length;
}
