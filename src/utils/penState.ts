import type { HandLandmarks, Landmark } from '../types';

const WRIST = 0;
const MIDDLE_MCP = 9;
const THUMB_TIP = 4;
const INDEX_TIP = 8;

function distance(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Normalized thumb-to-index distance — invariant to camera distance.
export function pinchRatioOf(landmarks: HandLandmarks | undefined): number | null {
  if (!landmarks || landmarks.length < 21) return null;
  const handSize = distance(landmarks[WRIST], landmarks[MIDDLE_MCP]) || 1;
  return distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / handSize;
}

export function fingertipOf(landmarks: HandLandmarks | undefined): Landmark | null {
  if (!landmarks || landmarks.length < 21) return null;
  return landmarks[INDEX_TIP];
}

// Hysteresis: use different thresholds for pen-down vs pen-up so small
// jitter near the boundary doesn't produce gaps in the stroke.
const DOWN_THRESHOLD = 0.45;
const UP_THRESHOLD = 0.65;

export function nextPenDown(current: boolean, ratio: number | null): boolean {
  if (ratio == null) return false;
  if (!current && ratio < DOWN_THRESHOLD) return true;
  if (current && ratio > UP_THRESHOLD) return false;
  return current;
}
