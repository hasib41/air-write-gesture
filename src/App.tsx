import { useCallback, useEffect, useRef, useState } from 'react';
import { useHandTracking, type OnFrame } from './hooks/useHandTracking';
import { drawHand } from './utils/drawLandmarks';
import {
  classifyPose,
  GestureLatch,
  PINCH_DOWN,
  PINCH_UP,
  summarize,
  INDEX_FINGERTIP,
  MIDDLE_FINGERTIP,
} from './utils/gestures';
import {
  createStroke,
  drawStroke,
  erasePartial,
  type Stroke,
} from './strokes';
import FingerCursor from './components/FingerCursor';
import Toolbar, { PALETTE, STROKE_SIZES, type StrokeSize } from './components/Toolbar';
import { recognizeInk, type OcrStatus } from './utils/ocr';
import './App.css';

// Landmark smoothing (low-pass). Higher = follows finger more closely.
const SMOOTHING = 0.55;
// Ignore points closer than this to the previous one — keeps stroke
// point count down without visibly missing motion.
const MIN_SEGMENT_PX = 1.5;
// Radius around fingertip that counts as "touching" a stroke during erase.
const ERASE_RADIUS_PX = 36;
// Frames a pose must be held before one-shot gestures fire (~230ms at 60fps).
const GESTURE_HOLD_FRAMES = 14;
// Stroke sizes are authored at 1280px canvas width; scale linearly.
const REFERENCE_WIDTH = 1280;

type Action =
  | { type: 'add'; stroke: Stroke }
  | { type: 'erase'; removed: Stroke[]; added: Stroke[] };

// Gap the active pinch must win by before the other pinch is ruled out.
// Keeps thumb+index and thumb+middle from triggering together.
const PINCH_DOMINANCE = 0.12;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Off-screen canvas holds all completed strokes baked in — one drawImage
  // per frame is cheaper than re-rendering every stroke from scratch.
  const committedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  if (committedCanvasRef.current === null) {
    committedCanvasRef.current = document.createElement('canvas');
  }

  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const undoStackRef = useRef<Action[]>([]);
  const redoStackRef = useRef<Action[]>([]);

  const penDownRef = useRef(false);
  const eraseDownRef = useRef(false);
  const smoothedRef = useRef<{ x: number; y: number } | null>(null);
  const palettePinchedRef = useRef(false);

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

  const [drawCursor, setDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const [paletteCursor, setPaletteCursor] = useState<{ x: number; y: number } | null>(null);
  const [eraserRing, setEraserRing] = useState<{ x: number; y: number; d: number } | null>(
    null,
  );
  const [penDown, setPenDown] = useState(false);
  const [erasing, setErasing] = useState(false);
  // Bump when history changes so React re-renders undo/redo buttons.
  const [historyTick, setHistoryTick] = useState(0);

  const [recognizedText, setRecognizedText] = useState('');
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');

  const undoLatchRef = useRef(new GestureLatch('fist', GESTURE_HOLD_FRAMES));
  const saveLatchRef = useRef(new GestureLatch('thumbs_up', GESTURE_HOLD_FRAMES));

  const redrawCommitted = useCallback(() => {
    const committed = committedCanvasRef.current;
    if (!committed) return;
    const ctx = committed.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, committed.width, committed.height);
    const scale = committed.width / REFERENCE_WIDTH;
    for (const s of strokesRef.current) drawStroke(ctx, s, s.size * scale);
  }, []);

  const bakeStroke = useCallback((stroke: Stroke) => {
    const committed = committedCanvasRef.current;
    if (!committed) return;
    const ctx = committed.getContext('2d');
    if (!ctx) return;
    const scale = committed.width / REFERENCE_WIDTH;
    drawStroke(ctx, stroke, stroke.size * scale);
  }, []);

  const paintInk = useCallback(() => {
    const ink = inkCanvasRef.current;
    const committed = committedCanvasRef.current;
    if (!ink || !committed) return;
    const ctx = ink.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.drawImage(committed, 0, 0);
    const cur = currentStrokeRef.current;
    if (cur) {
      const scale = ink.width / REFERENCE_WIDTH;
      drawStroke(ctx, cur, cur.size * scale);
    }
  }, []);

  const handleUndo = useCallback(() => {
    const action = undoStackRef.current.pop();
    if (!action) return;
    if (action.type === 'add') {
      strokesRef.current = strokesRef.current.filter((s) => s.id !== action.stroke.id);
    } else {
      // Reverse the erase: drop the split children, restore the originals.
      const addedIds = new Set(action.added.map((s) => s.id));
      strokesRef.current = [
        ...strokesRef.current.filter((s) => !addedIds.has(s.id)),
        ...action.removed,
      ];
    }
    redoStackRef.current.push(action);
    redrawCommitted();
    paintInk();
    setHistoryTick((t) => t + 1);
  }, [redrawCommitted, paintInk]);

  const handleRedo = useCallback(() => {
    const action = redoStackRef.current.pop();
    if (!action) return;
    if (action.type === 'add') {
      strokesRef.current = [...strokesRef.current, action.stroke];
    } else {
      const removedIds = new Set(action.removed.map((s) => s.id));
      strokesRef.current = [
        ...strokesRef.current.filter((s) => !removedIds.has(s.id)),
        ...action.added,
      ];
    }
    undoStackRef.current.push(action);
    redrawCommitted();
    paintInk();
    setHistoryTick((t) => t + 1);
  }, [redrawCommitted, paintInk]);

  const handleClear = useCallback(() => {
    if (strokesRef.current.length === 0 && !currentStrokeRef.current) return;
    // Treat a clear as one big erase with no added children.
    const snapshot = strokesRef.current;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    undoStackRef.current.push({ type: 'erase', removed: snapshot, added: [] });
    redoStackRef.current = [];
    redrawCommitted();
    paintInk();
    setHistoryTick((t) => t + 1);
  }, [redrawCommitted, paintInk]);

  const handleSave = useCallback(() => {
    const c = inkCanvasRef.current;
    if (!c || c.width === 0) return;
    const a = document.createElement('a');
    a.download = `air-writer-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }, []);

  const handleRecognize = useCallback(async () => {
    const c = inkCanvasRef.current;
    if (!c || c.width === 0) return;
    const text = await recognizeInk(c, setOcrStatus);
    setRecognizedText(text || '(nothing recognized)');
  }, []);

  // Save handler via ref so keyboard listener stays stable without
  // re-binding on every render.
  const saveRef = useRef(handleSave);
  useEffect(() => {
    saveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (k === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  const handleFrame: OnFrame = useCallback(
    (result, { video, canvas, timestamp }) => {
      const skCtx = canvas.getContext('2d');
      const inkCanvas = inkCanvasRef.current;
      const committed = committedCanvasRef.current;
      if (!skCtx || !inkCanvas || !committed) return;

      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      if (inkCanvas.width === 0 && video.videoWidth > 0) {
        inkCanvas.width = video.videoWidth;
        inkCanvas.height = video.videoHeight;
        committed.width = video.videoWidth;
        committed.height = video.videoHeight;
        redrawCommitted();
      }

      skCtx.clearRect(0, 0, canvas.width, canvas.height);
      const hands = result.landmarks ?? [];

      // Identify the drawing hand as the rightmost on screen (after the
      // CSS mirror, that's the user's right hand for most people). The
      // other hand, if present, becomes the palette hand.
      let drawIdx = -1;
      let paletteIdx = -1;
      if (hands.length === 1) {
        drawIdx = 0;
      } else if (hands.length >= 2) {
        // Larger x = further right on camera = further left on mirrored screen.
        // We actually want the hand on the right side of the mirrored view,
        // which corresponds to the *smaller* raw x.
        drawIdx = hands[0][INDEX_FINGERTIP].x < hands[1][INDEX_FINGERTIP].x ? 0 : 1;
        paletteIdx = drawIdx === 0 ? 1 : 0;
      }

      // Render skeletons — drawing hand highlighted, palette hand muted.
      if (drawIdx !== -1) {
        drawHand(skCtx, hands[drawIdx], {
          width: canvas.width,
          height: canvas.height,
          boneColor: colorRef.current,
          jointColor: '#4ade80',
        });
      }
      if (paletteIdx !== -1) {
        drawHand(skCtx, hands[paletteIdx], {
          width: canvas.width,
          height: canvas.height,
          boneColor: '#64748b',
          jointColor: '#94a3b8',
        });
      }

      // --- Drawing hand ---
      if (drawIdx === -1) {
        smoothedRef.current = null;
        penDownRef.current = false;
        eraseDownRef.current = false;
        setDrawCursor(null);
        setPenDown(false);
        setErasing(false);
        setEraserRing(null);
      } else {
        const sum = summarize(hands[drawIdx]);
        if (sum) {
          // Decide pinch mode with hysteresis + dominance gap. Either
          // pinch must be clearly tighter than the other before it can
          // start — stops thumb+index and thumb+middle from overlapping
          // and flipping modes frame by frame.
          const prevDraw = penDownRef.current;
          const prevErase = eraseDownRef.current;
          const indexTight = sum.pinchIndex < PINCH_DOWN;
          const middleTight = sum.pinchMiddle < PINCH_DOWN;
          const indexDominant = sum.pinchIndex < sum.pinchMiddle - PINCH_DOMINANCE;
          const middleDominant = sum.pinchMiddle < sum.pinchIndex - PINCH_DOMINANCE;

          let drawDown = prevDraw;
          let eraseDown = prevErase;
          if (prevDraw) {
            if (sum.pinchIndex > PINCH_UP) drawDown = false;
          } else if (prevErase) {
            if (sum.pinchMiddle > PINCH_UP) eraseDown = false;
          } else {
            if (indexTight && indexDominant) drawDown = true;
            else if (middleTight && middleDominant) eraseDown = true;
          }

          // Reset smoothing when the active fingertip switches so the
          // cursor snaps to the new landmark instead of sliding through
          // the air between them.
          const activeKind: 'idle' | 'draw' | 'erase' = drawDown
            ? 'draw'
            : eraseDown
              ? 'erase'
              : 'idle';
          const prevKind: 'idle' | 'draw' | 'erase' = prevDraw
            ? 'draw'
            : prevErase
              ? 'erase'
              : 'idle';
          if (activeKind !== prevKind) smoothedRef.current = null;

          const tipLm =
            activeKind === 'erase'
              ? hands[drawIdx][MIDDLE_FINGERTIP]
              : hands[drawIdx][INDEX_FINGERTIP];

          const rawX = tipLm.x * inkCanvas.width;
          const rawY = tipLm.y * inkCanvas.height;
          const prev = smoothedRef.current;
          const sx = prev ? prev.x + SMOOTHING * (rawX - prev.x) : rawX;
          const sy = prev ? prev.y + SMOOTHING * (rawY - prev.y) : rawY;
          smoothedRef.current = { x: sx, y: sy };

          // --- Stroke lifecycle ---
          if (drawDown) {
            let stroke = currentStrokeRef.current;
            if (!stroke) {
              stroke = createStroke(colorRef.current, sizeRef.current);
              currentStrokeRef.current = stroke;
            }
            const lastPt = stroke.points[stroke.points.length - 1];
            const dx = lastPt ? sx - lastPt.x : Infinity;
            const dy = lastPt ? sy - lastPt.y : Infinity;
            if (!lastPt || dx * dx + dy * dy >= MIN_SEGMENT_PX * MIN_SEGMENT_PX) {
              stroke.points.push({ x: sx, y: sy, t: timestamp });
              paintInk();
            }
          } else if (currentStrokeRef.current) {
            // Pen just lifted — commit the stroke.
            const finished = currentStrokeRef.current;
            if (finished.points.length > 0) {
              strokesRef.current = [...strokesRef.current, finished];
              bakeStroke(finished);
              undoStackRef.current.push({ type: 'add', stroke: finished });
              redoStackRef.current = [];
              setHistoryTick((t) => t + 1);
            }
            currentStrokeRef.current = null;
            paintInk();
          }

          // --- Erase (partial — splits strokes where the radius bites) ---
          if (eraseDown) {
            const scale = inkCanvas.width / REFERENCE_WIDTH;
            const radius = ERASE_RADIUS_PX * scale;
            const { strokes: next, removed, added } = erasePartial(
              strokesRef.current,
              sx,
              sy,
              radius,
            );
            if (removed.length > 0) {
              strokesRef.current = next;
              undoStackRef.current.push({ type: 'erase', removed, added });
              redoStackRef.current = [];
              redrawCommitted();
              paintInk();
              setHistoryTick((t) => t + 1);
            }
          }

          penDownRef.current = drawDown;
          eraseDownRef.current = eraseDown;
          setPenDown(drawDown);
          setErasing(eraseDown);

          // --- One-shot pose gestures (only when not actively drawing) ---
          if (!drawDown && !eraseDown) {
            const pose = classifyPose(sum);
            if (undoLatchRef.current.tick(pose)) handleUndo();
            if (saveLatchRef.current.tick(pose)) saveRef.current();
          } else {
            // Reset latches so a fist→pinch→fist sequence re-arms them.
            undoLatchRef.current.tick('none');
            saveLatchRef.current.tick('none');
          }

          // --- Viewport cursor (mirror x because view is flipped) ---
          const stage = stageRef.current;
          if (stage) {
            const r = stage.getBoundingClientRect();
            const cx = r.left + (1 - tipLm.x) * r.width;
            const cy = r.top + tipLm.y * r.height;
            setDrawCursor({ x: cx, y: cy });
            if (eraseDown) {
              // Erase radius is authored in 1280-wide canvas px; convert to screen px.
              const screenDiameter = (2 * ERASE_RADIUS_PX * r.width) / REFERENCE_WIDTH;
              setEraserRing({ x: cx, y: cy, d: screenDiameter });
            } else {
              setEraserRing(null);
            }
          }
        }
      }

      // --- Palette hand ---
      if (paletteIdx === -1) {
        palettePinchedRef.current = false;
        setPaletteCursor(null);
      } else {
        const paletteHand = hands[paletteIdx];
        const sum = summarize(paletteHand);
        if (sum) {
          const tipLm = paletteHand[INDEX_FINGERTIP];

          // Vertical position picks stroke size live — higher = bigger.
          const normalizedY = Math.max(0, Math.min(1, tipLm.y));
          const sizeIdx = Math.min(
            STROKE_SIZES.length - 1,
            Math.floor((1 - normalizedY) * STROKE_SIZES.length),
          );
          const nextSize = STROKE_SIZES[sizeIdx];
          if (nextSize !== sizeRef.current) {
            sizeRef.current = nextSize;
            setSize(nextSize);
          }

          // Fresh pinch (thumb + index) cycles color — debounced so
          // holding a pinch doesn't sprint through the palette.
          const pinchedNow = sum.pinchIndex < PINCH_DOWN;
          if (pinchedNow && !palettePinchedRef.current) {
            const idx = PALETTE.findIndex((c) => c.value === colorRef.current);
            const next = PALETTE[(idx + 1) % PALETTE.length];
            colorRef.current = next.value;
            setColor(next.value);
          }
          palettePinchedRef.current = pinchedNow;

          const stage = stageRef.current;
          if (stage) {
            const r = stage.getBoundingClientRect();
            setPaletteCursor({
              x: r.left + (1 - tipLm.x) * r.width,
              y: r.top + tipLm.y * r.height,
            });
          }
        }
      }
    },
    [bakeStroke, handleUndo, paintInk, redrawCommitted],
  );

  const { status } = useHandTracking({
    videoRef,
    canvasRef: skeletonCanvasRef,
    numHands: 2,
    onFrame: handleFrame,
  });

  const statusTone: 'ok' | 'loading' | 'error' = status.startsWith('error')
    ? 'error'
    : status === 'running'
      ? 'ok'
      : 'loading';

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;
  // Reference historyTick so React re-runs this render path when history mutates.
  void historyTick;

  const cursorMode: 'draw' | 'erase' = erasing ? 'erase' : 'draw';

  return (
    <div className="app">
      <header className="app-header">
        <h1>Air Writer</h1>
        <p className="subtitle">
          Pinch thumb + index to draw. Pinch thumb + middle to erase. Hold a fist to undo,
          a thumbs-up to save. Use a second hand as a palette: height picks size, pinch cycles color.
        </p>
      </header>

      <div ref={stageRef} className="stage">
        <video ref={videoRef} playsInline muted className="video-feed" />
        <canvas ref={inkCanvasRef} className="ink-canvas" />
        <canvas ref={skeletonCanvasRef} className="overlay-canvas" />
        <div
          className={`status-pill status-pill--${statusTone}`}
          role="status"
          aria-live="polite"
        >
          <span className="status-dot" aria-hidden />
          <span>{status}</span>
        </div>
        {erasing && <div className="mode-badge mode-badge--erase">Erasing</div>}
      </div>

      <FingerCursor
        x={drawCursor?.x ?? null}
        y={drawCursor?.y ?? null}
        penDown={penDown || erasing}
        color={cursorMode === 'erase' ? '#fb7185' : color}
        size={size}
      />
      {paletteCursor && (
        <FingerCursor
          x={paletteCursor.x}
          y={paletteCursor.y}
          penDown={false}
          color="#94a3b8"
          size={10}
        />
      )}
      {eraserRing && (
        <div
          className="eraser-ring"
          style={{
            transform: `translate(${eraserRing.x}px, ${eraserRing.y}px)`,
            width: eraserRing.d,
            height: eraserRing.d,
            marginLeft: -eraserRing.d / 2,
            marginTop: -eraserRing.d / 2,
          }}
        />
      )}

      <Toolbar
        color={color}
        size={size}
        onColorChange={setColor}
        onSizeChange={setSize}
        onClear={handleClear}
        onSave={handleSave}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onRecognize={handleRecognize}
        ocrStatus={ocrStatus}
        recognizedText={recognizedText}
        onClearRecognized={() => setRecognizedText('')}
      />
    </div>
  );
}
