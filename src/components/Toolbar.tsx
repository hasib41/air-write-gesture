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
};

export default function Toolbar({
  color,
  size,
  onColorChange,
  onSizeChange,
  onClear,
  onSave,
}: Props) {
  return (
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
      <div className="toolbar-group toolbar-end">
        <button type="button" className="btn-ghost" onClick={onSave}>
          Save PNG
        </button>
        <button type="button" className="btn-ghost btn-danger" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
