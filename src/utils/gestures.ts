import type { HandLandmarks, Landmark } from '../types';

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

export type Gesture =
  | 'none'
  | 'draw' // pinch thumb+index
  | 'erase' // pinch thumb+middle
  | 'fist'
  | 'thumbs_up'
  | 'open_palm'
  | 'peace';

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2d(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// A finger is "extended" when its tip is farther from the wrist than its
// PIP joint — orientation-invariant and survives a rotated hand.
function isFingerExtended(
  landmarks: HandLandmarks,
  tipIdx: number,
  pipIdx: number,
): boolean {
  const wrist = landmarks[WRIST];
  return dist(landmarks[tipIdx], wrist) > dist(landmarks[pipIdx], wrist) * 1.1;
}

// Thumb extension is measured across the hand: thumb tip should be far
// from the index MCP (knuckle), relative to hand size.
function isThumbExtended(landmarks: HandLandmarks, handSize: number): boolean {
  return dist(landmarks[THUMB_TIP], landmarks[INDEX_MCP]) > handSize * 0.55;
}

export type HandSummary = {
  handSize: number;
  fingers: {
    thumb: boolean;
    index: boolean;
    middle: boolean;
    ring: boolean;
    pinky: boolean;
  };
  pinchIndex: number; // thumb-index ratio, smaller = tighter
  pinchMiddle: number; // thumb-middle ratio
};

export function summarize(landmarks: HandLandmarks | undefined): HandSummary | null {
  if (!landmarks || landmarks.length < 21) return null;
  const handSize = dist(landmarks[WRIST], landmarks[MIDDLE_MCP]) || 1;
  return {
    handSize,
    fingers: {
      thumb: isThumbExtended(landmarks, handSize),
      index: isFingerExtended(landmarks, INDEX_TIP, INDEX_PIP),
      middle: isFingerExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP),
      ring: isFingerExtended(landmarks, RING_TIP, RING_PIP),
      pinky: isFingerExtended(landmarks, PINKY_TIP, PINKY_PIP),
    },
    pinchIndex: dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / handSize,
    pinchMiddle: dist(landmarks[THUMB_TIP], landmarks[MIDDLE_TIP]) / handSize,
  };
}

// Thresholds. Pinch uses hysteresis (caller tracks prior state).
export const PINCH_DOWN = 0.45;
export const PINCH_UP = 0.65;

// Classify a static pose. Pinches (draw/erase) are handled separately in
// the frame loop with hysteresis to keep ink continuous.
export function classifyPose(sum: HandSummary): Gesture {
  const { fingers } = sum;
  const upCount =
    Number(fingers.thumb) +
    Number(fingers.index) +
    Number(fingers.middle) +
    Number(fingers.ring) +
    Number(fingers.pinky);

  if (upCount === 0) return 'fist';
  if (
    fingers.thumb &&
    !fingers.index &&
    !fingers.middle &&
    !fingers.ring &&
    !fingers.pinky
  ) {
    return 'thumbs_up';
  }
  if (
    !fingers.thumb &&
    fingers.index &&
    fingers.middle &&
    !fingers.ring &&
    !fingers.pinky
  ) {
    return 'peace';
  }
  if (upCount >= 4) return 'open_palm';
  return 'none';
}

export function fingertipOf(landmarks: HandLandmarks | undefined, idx = INDEX_TIP): Landmark | null {
  if (!landmarks || landmarks.length < 21) return null;
  return landmarks[idx];
}

export const MIDDLE_FINGERTIP = MIDDLE_TIP;
export const INDEX_FINGERTIP = INDEX_TIP;

// Returns 1–4 for the canonical "count" poses (fingers extended starting
// from the index), else 0. Thumb must be down so we don't collide with
// thumbs_up. Poses must be bottom-up (no gaps) so a relaxed hand with
// random fingers partly up doesn't trigger.
export function sizeSelector(sum: HandSummary): number {
  const f = sum.fingers;
  if (f.thumb) return 0;
  if (f.index && !f.middle && !f.ring && !f.pinky) return 1;
  if (f.index && f.middle && !f.ring && !f.pinky) return 2;
  if (f.index && f.middle && f.ring && !f.pinky) return 3;
  if (f.index && f.middle && f.ring && f.pinky) return 4;
  return 0;
}

// Hold-to-fire latch for an integer count (0 = no pose). Requires the
// same non-zero count for `holdFrames` frames, then fires once; won't
// re-fire until the count changes or drops to 0.
export class CountLatch {
  private lastCount = 0;
  private frames = 0;
  private fired = 0;

  constructor(private readonly holdFrames: number) {}

  // Returns the count that just fired, or 0 if nothing fired this tick.
  tick(count: number): number {
    if (count === 0) {
      this.lastCount = 0;
      this.frames = 0;
      this.fired = 0;
      return 0;
    }
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.frames = 1;
      this.fired = 0;
      return 0;
    }
    this.frames++;
    if (this.frames >= this.holdFrames && this.fired !== count) {
      this.fired = count;
      return count;
    }
    return 0;
  }
}

// Hold-to-fire latch. Requires a pose to be held for `holdFrames` frames
// before firing once; won't re-fire until the pose is released.
export class GestureLatch {
  private matchCount = 0;
  private armed = true;

  constructor(
    private readonly target: Gesture,
    private readonly holdFrames: number,
  ) {}

  // Returns true on the single frame the gesture fires.
  tick(current: Gesture): boolean {
    if (current !== this.target) {
      this.matchCount = 0;
      this.armed = true;
      return false;
    }
    this.matchCount++;
    if (this.armed && this.matchCount >= this.holdFrames) {
      this.armed = false;
      return true;
    }
    return false;
  }
}

// 2D distance helper exported for callers (e.g. fingertip distance in canvas coords).
export { dist2d };
