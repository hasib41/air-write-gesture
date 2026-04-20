import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type HandTrackingStatus =
  | 'idle'
  | 'loading model'
  | 'requesting camera'
  | 'running'
  | `error: ${string}`;

export type FrameContext = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  timestamp: number;
};

export type OnFrame = (result: HandLandmarkerResult, ctx: FrameContext) => void;

type Options = {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  numHands?: number;
  onFrame?: OnFrame;
};

export function useHandTracking({ videoRef, canvasRef, numHands = 1, onFrame }: Options) {
  const [status, setStatus] = useState<HandTrackingStatus>('idle');
  const onFrameRef = useRef<OnFrame | undefined>(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let cancelled = false;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let rafId = 0;

    async function start() {
      try {
        setStatus('loading model');
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands,
        });
        if (cancelled) return;

        setStatus('requesting camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) throw new Error('video element missing');
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        setStatus('running');
        let lastVideoTime = -1;
        const loop = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (video.readyState >= 2 && landmarker && canvas) {
            const t = performance.now();
            if (video.currentTime !== lastVideoTime) {
              lastVideoTime = video.currentTime;
              const result = landmarker.detectForVideo(video, t);
              onFrameRef.current?.(result, { video, canvas, timestamp: t });
            }
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.error('hand tracking failed', err);
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatus(`error: ${msg}`);
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (landmarker) landmarker.close();
    };
  }, [videoRef, canvasRef, numHands]);

  return { status };
}
