type Props = {
  x: number | null;
  y: number | null;
  penDown: boolean;
  color: string;
  size: number;
};

export default function FingerCursor({ x, y, penDown, color, size }: Props) {
  if (x == null || y == null) return null;
  const diameter = Math.max(14, Math.min(36, size + 8));
  const style = {
    transform: `translate(${x}px, ${y}px)`,
    width: diameter,
    height: diameter,
    margin: `${-diameter / 2}px 0 0 ${-diameter / 2}px`,
    borderColor: color,
    background: penDown ? color : 'rgba(255,255,255,0.08)',
    boxShadow: penDown ? `0 0 18px ${color}` : 'none',
  } as const;
  return <div className={`finger-cursor${penDown ? ' is-down' : ''}`} style={style} />;
}
