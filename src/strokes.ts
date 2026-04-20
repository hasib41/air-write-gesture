export type StrokePoint = { x: number; y: number; t: number };

export type Stroke = {
  id: string;
  color: string;
  size: number;
  points: StrokePoint[];
};

export function createStroke(color: string, size: number): Stroke {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    color,
    size,
    points: [],
  };
}

function midpoint(a: StrokePoint, b: StrokePoint): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: StrokePoint, b: StrokePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Map velocity (px/ms) to a width multiplier in [0.55, 1.45].
// Slow strokes are thicker; fast strokes thin out — mimics ink pressure.
function widthFromVelocity(v: number): number {
  const raw = 1.5 - v * 0.25;
  return Math.max(0.55, Math.min(1.45, raw));
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  baseWidth: number,
): void {
  const { points, color } = stroke;
  if (points.length === 0) return;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, baseWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (points.length === 2) {
    ctx.lineWidth = baseWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    return;
  }

  // Quadratic smoothing: draw each segment from midpoint to midpoint,
  // using the raw point as the control. Each segment gets its own
  // lineWidth based on local velocity for variable-width ink.
  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];

    const m0 = i === 1 ? pPrev : midpoint(pPrev, pCurr);
    const m1 = midpoint(pCurr, pNext);

    const dt = Math.max(1, pCurr.t - pPrev.t);
    const v = distance(pPrev, pCurr) / dt;
    ctx.lineWidth = baseWidth * widthFromVelocity(v);

    ctx.beginPath();
    ctx.moveTo(m0.x, m0.y);
    ctx.quadraticCurveTo(pCurr.x, pCurr.y, m1.x, m1.y);
    ctx.stroke();
  }

  // Final straight segment from last midpoint to the last point.
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const m = midpoint(prev, last);
  ctx.lineWidth = baseWidth;
  ctx.beginPath();
  ctx.moveTo(m.x, m.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function renderAll(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  current: Stroke | null,
  canvasWidth: number,
  referenceWidth = 1280,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const scale = canvasWidth / referenceWidth;
  for (const s of strokes) drawStroke(ctx, s, s.size * scale);
  if (current) drawStroke(ctx, current, current.size * scale);
}

// Partial erase: for each stroke, drop the points within `radius` of
// (x, y) and re-emit the surviving runs as separate child strokes. A
// stroke that's only grazed comes out split in two; one fully inside
// the radius disappears entirely.
export function erasePartial(
  strokes: Stroke[],
  x: number,
  y: number,
  radius: number,
): { strokes: Stroke[]; removed: Stroke[]; added: Stroke[] } {
  const r2 = radius * radius;
  const out: Stroke[] = [];
  const removed: Stroke[] = [];
  const added: Stroke[] = [];

  for (const s of strokes) {
    const runs: StrokePoint[][] = [];
    let run: StrokePoint[] = [];
    let hit = false;

    for (const p of s.points) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r2) {
        hit = true;
        if (run.length > 0) {
          runs.push(run);
          run = [];
        }
      } else {
        run.push(p);
      }
    }
    if (run.length > 0) runs.push(run);

    if (!hit) {
      out.push(s);
      continue;
    }
    removed.push(s);
    for (const pts of runs) {
      if (pts.length === 0) continue;
      const child = createStroke(s.color, s.size);
      child.points = pts;
      out.push(child);
      added.push(child);
    }
  }

  return { strokes: out, removed, added };
}
