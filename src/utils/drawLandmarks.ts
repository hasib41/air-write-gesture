import type { HandLandmarks } from '../types';

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

type DrawOptions = {
  width: number;
  height: number;
  boneColor?: string;
  jointColor?: string;
};

export function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: HandLandmarks,
  { width, height, boneColor = '#22d3ee', jointColor = '#4ade80' }: DrawOptions,
): void {
  ctx.lineWidth = Math.max(2, Math.round(width / 400));
  ctx.strokeStyle = boneColor;
  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = landmarks[a];
    const p2 = landmarks[b];
    ctx.beginPath();
    ctx.moveTo(p1.x * width, p1.y * height);
    ctx.lineTo(p2.x * width, p2.y * height);
    ctx.stroke();
  }
  ctx.fillStyle = jointColor;
  const radius = Math.max(3, Math.round(width / 280));
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
