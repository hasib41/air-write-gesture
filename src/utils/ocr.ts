export type OcrStatus = 'idle' | 'loading' | 'recognizing' | 'error';

// Tesseract.js is heavy (~4MB with language data) — keep it out of the
// initial bundle and load it on first recognize.
type RecognizeFn = (image: HTMLCanvasElement, lang: string) => Promise<{ data: { text: string } }>;
let recognizer: RecognizeFn | null = null;

async function loadTesseract(): Promise<RecognizeFn> {
  if (recognizer) return recognizer;
  const mod = await import('tesseract.js');
  recognizer = (image, lang) => mod.recognize(image, lang);
  return recognizer;
}

// Render the ink canvas onto a white background as dark ink — Tesseract
// trained on printed text, so inversion dramatically improves accuracy.
function prepareForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  // Stamp the ink as black. Using 'difference' then recoloring is
  // overkill — just draw the source tinted dark via a temp pass.
  const tmp = document.createElement('canvas');
  tmp.width = source.width;
  tmp.height = source.height;
  const tctx = tmp.getContext('2d');
  if (!tctx) return out;
  tctx.drawImage(source, 0, 0);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = '#000000';
  tctx.fillRect(0, 0, tmp.width, tmp.height);

  ctx.drawImage(tmp, 0, 0);
  return out;
}

export async function recognizeInk(
  inkCanvas: HTMLCanvasElement,
  onStatus: (s: OcrStatus) => void,
): Promise<string> {
  try {
    onStatus('loading');
    const recognize = await loadTesseract();
    onStatus('recognizing');
    const prepared = prepareForOcr(inkCanvas);
    const result = await recognize(prepared, 'eng');
    onStatus('idle');
    return result.data.text.trim();
  } catch (err) {
    console.error('OCR failed', err);
    onStatus('error');
    return '';
  }
}
