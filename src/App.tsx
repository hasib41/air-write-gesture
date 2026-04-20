import { useCallback, useEffect, useRef, useState } from 'react';
import { useHandTracking, type OnFrame } from './hooks/useHandTracking';
import { drawHand } from './utils/drawLandmarks';
import { fingertipOf, nextPenDown, pinchRatioOf } from './utils/penState';
import FingerCursor from './components/FingerCursor';
import Toolbar, { PALETTE, STROKE_SIZES, type StrokeSize } from './components/Toolbar';
import './App.css';

// Low-pass filter smooths landmark jitter. Higher = follows finger more
// closely; lower = smoother strokes.
const SMOOTHING = 0.55;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Drawing state kept in refs so the 60 fps frame callback avoids re-renders.
  const penDownRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedRef = useRef<{ x: number; y: number } | null>(null);

  const [color, setColor] = useState<string>(PALETTE[0].value);
  const [size, setSize] = useState<StrokeSize>(STROKE_SIZES[1]);
  const colorRef = useRef(color);
  const sizeRef = useRef<number>(size);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [penDown, setPenDown] = useState(false);

  const handleFrame: OnFrame = useCallback((result, { video, canvas }) => {
    const skCtx = canvas.getContext('2d');
    const inkCanvas = inkCanvasRef.current;
    if (!skCtx || !inkCanvas) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    // Ink canvas is sized once to the video's intrinsic resolution; resizing
    // would wipe the drawing, and CSS handles display scaling.
    if (inkCanvas.width === 0 && video.videoWidth > 0) {
      inkCanvas.width = video.videoWidth;
      inkCanvas.height = video.videoHeight;
    }

    skCtx.clearRect(0, 0, canvas.width, canvas.height);
    const hand = result.landmarks?.[0];
    if (hand) drawHand(skCtx, hand, { width: canvas.width, height: canvas.height });

    const tip = fingertipOf(hand);
    const ratio = pinchRatioOf(hand);
    const down = nextPenDown(penDownRef.current, ratio);

    if (!tip) {
      smoothedRef.current = null;
      lastPointRef.current = null;
      penDownRef.current = false;
      setCursor(null);
      setPenDown(false);
      return;
    }

    const rawX = tip.x * inkCanvas.width;
    const rawY = tip.y * inkCanvas.height;
    const prev = smoothedRef.current;
    const sx = prev ? prev.x + SMOOTHING * (rawX - prev.x) : rawX;
    const sy = prev ? prev.y + SMOOTHING * (rawY - prev.y) : rawY;
    smoothedRef.current = { x: sx, y: sy };

    if (down) {
      const inkCtx = inkCanvas.getContext('2d');
      if (inkCtx) {
        inkCtx.lineCap = 'round';
        inkCtx.lineJoin = 'round';
        inkCtx.strokeStyle = colorRef.current;
        // Scale stroke width to video resolution so it reads the same on
        // different cameras.
        inkCtx.lineWidth = sizeRef.current * (inkCanvas.width / 1280);
        const last = lastPointRef.current;
        if (last) {
          inkCtx.beginPath();
          inkCtx.moveTo(last.x, last.y);
          inkCtx.lineTo(sx, sy);
          inkCtx.stroke();
        } else {
          // First sample of a stroke — lay a dot so a quick tap is visible.
          inkCtx.beginPath();
          inkCtx.arc(sx, sy, inkCtx.lineWidth / 2, 0, Math.PI * 2);
          inkCtx.fillStyle = colorRef.current;
          inkCtx.fill();
        }
      }
      lastPointRef.current = { x: sx, y: sy };
    } else {
      lastPointRef.current = null;
    }

    penDownRef.current = down;
    setPenDown(down);

    const stage = stageRef.current;
    if (stage) {
      const r = stage.getBoundingClientRect();
      // View is mirrored (scaleX(-1)), so mirror x for the viewport cursor.
      setCursor({
        x: r.left + (1 - tip.x) * r.width,
        y: r.top + tip.y * r.height,
      });
    }
  }, []);

  const { status } = useHandTracking({
    videoRef,
    canvasRef: skeletonCanvasRef,
    numHands: 1,
    onFrame: handleFrame,
  });

  const handleClear = () => {
    const c = inkCanvasRef.current;
    if (!c) return;
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  const handleSave = () => {
    const c = inkCanvasRef.current;
    if (!c || c.width === 0) return;
    const a = document.createElement('a');
    a.download = `air-writer-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Air Writer</h1>
        <p className="subtitle">
          Pinch thumb + index to start inking, release to lift the pen. Open hand to move
          without drawing.
        </p>
      </header>

      <div ref={stageRef} className="stage">
        <video ref={videoRef} playsInline muted className="video-feed" />
        <canvas ref={inkCanvasRef} className="ink-canvas" />
        <canvas ref={skeletonCanvasRef} className="overlay-canvas" />
        <div className="status-pill">{status}</div>
      </div>

      <FingerCursor
        x={cursor?.x ?? null}
        y={cursor?.y ?? null}
        penDown={penDown}
        color={color}
        size={size}
      />

      <Toolbar
        color={color}
        size={size}
        onColorChange={setColor}
        onSizeChange={setSize}
        onClear={handleClear}
        onSave={handleSave}
      />
    </div>
  );
}
