# Air Writer

Draw on a mirrored webcam feed with your bare hand. Point your index finger at the screen, pinch thumb and index to ink a stroke, release to lift the pen.

Built with React, TypeScript, Vite, and [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker).

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (requires `localhost` or HTTPS for webcam access) and allow camera permission.

## Interactions

- **Pinch thumb + index** — pen down, draws while the pinch is held
- **Release pinch** — pen up, move the cursor without drawing
- **Toolbar** — pick ink color, stroke size, save as PNG, or clear the canvas

## How it works

- `useHandTracking` boots MediaPipe's `HandLandmarker` against the webcam and drives a `requestAnimationFrame` loop.
- Each frame produces 21 hand landmarks. The index fingertip (landmark 8) becomes the cursor.
- `penState.ts` computes the normalized thumb-to-index distance and applies hysteresis so jitter near the threshold doesn't chop strokes.
- Drawing is done imperatively against a persistent `<canvas>` layered over the video, so React re-renders stay limited to cursor position and toolbar state.
- Strokes are smoothed with an exponential moving average on the fingertip coordinates, and line width scales with video resolution.

## Project structure

```
src/
  App.tsx                    drawing loop wiring
  hooks/useHandTracking.ts   camera + MediaPipe lifecycle
  utils/penState.ts          pinch ratio + pen-down hysteresis
  utils/drawLandmarks.ts     skeleton overlay renderer
  components/Toolbar.tsx     color, size, save, clear controls
  components/FingerCursor.tsx  viewport-space cursor dot
```
