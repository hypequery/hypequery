// Clawd, the mascot on Claude Code's welcome screen. The terminal draws it with
// quadrant block characters; these are the same pixels as crisp SVG rects.
// Each terminal pixel is twice as tall as it is wide, hence the 2-unit rows.
const PIXELS: [row: number, from: number, to: number][] = [
  [0, 3, 14],
  [1, 3, 4],
  [1, 6, 11],
  [1, 13, 14],
  [2, 1, 16],
  [3, 3, 14],
  [4, 4, 4],
  [4, 6, 6],
  [4, 11, 11],
  [4, 13, 13],
];

export function Clawd({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="1 0 16 10" className={className} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      {PIXELS.map(([row, from, to]) => (
        <rect key={`${row}-${from}`} x={from} y={row * 2} width={to - from + 1} height={2} />
      ))}
    </svg>
  );
}
