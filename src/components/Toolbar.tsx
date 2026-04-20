import type { OcrStatus } from '../utils/ocr';

export type ToolColor = { id: string; value: string };

export const PALETTE: readonly ToolColor[] = [
  { id: 'cyan', value: '#22d3ee' },
  { id: 'emerald', value: '#4ade80' },
  { id: 'amber', value: '#fbbf24' },
  { id: 'rose', value: '#fb7185' },
  { id: 'white', value: '#f8fafc' },
];

export const STROKE_SIZES = [4, 8, 14, 22] as const;
export type StrokeSize = (typeof STROKE_SIZES)[number];

type Props = {
  color: string;
  size: StrokeSize;
  onColorChange: (color: string) => void;
  onSizeChange: (size: StrokeSize) => void;
  onClear: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRecognize: () => void;
  ocrStatus: OcrStatus;
  recognizedText: string;
  onClearRecognized: () => void;
};

export default function Toolbar({
  color,
  size,
  onColorChange,
  onSizeChange,
  onClear,
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onRecognize,
  ocrStatus,
  recognizedText,
  onClearRecognized,
}: Props) {
  const ocrLabel =
    ocrStatus === 'loading'
      ? 'Loading…'
      : ocrStatus === 'recognizing'
        ? 'Reading…'
        : ocrStatus === 'error'
          ? 'Retry'
          : 'Recognize';

  return (
    <div className="toolbar-wrap">
      <div className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Ink</span>
          {PALETTE.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Ink color ${c.id}`}
              className={`swatch${color === c.value ? ' is-on' : ''}`}
              style={{ background: c.value }}
              onClick={() => onColorChange(c.value)}
            />
          ))}
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">Size</span>
          {STROKE_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Stroke size ${s}`}
              className={`size-chip${size === s ? ' is-on' : ''}`}
              onClick={() => onSizeChange(s)}
            >
              <span className="size-dot" style={{ width: s, height: s, background: color }} />
            </button>
          ))}
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className="btn-ghost"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
        </div>

        <div className="toolbar-group toolbar-end">
          <button
            type="button"
            className="btn-ghost btn-accent"
            onClick={onRecognize}
            disabled={ocrStatus === 'loading' || ocrStatus === 'recognizing'}
          >
            {ocrLabel}
          </button>
          <button type="button" className="btn-ghost" onClick={onSave} title="Save (Ctrl+S)">
            Save PNG
          </button>
          <button type="button" className="btn-ghost btn-danger" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      {recognizedText && (
        <div className="recognized">
          <div className="recognized-head">
            <span className="recognized-label">Recognized</span>
            <button type="button" className="recognized-dismiss" onClick={onClearRecognized}>
              ×
            </button>
          </div>
          <p className="recognized-text">{recognizedText}</p>
        </div>
      )}
    </div>
  );
}
