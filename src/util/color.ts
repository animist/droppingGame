export function lerpColor(c1: number, c2: number, t: number): number {
  const tc = Math.max(0, Math.min(1, t));
  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff;
  const g2 = (c2 >> 8) & 0xff;
  const b2 = c2 & 0xff;
  const r = Math.round(r1 + (r2 - r1) * tc);
  const g = Math.round(g1 + (g2 - g1) * tc);
  const b = Math.round(b1 + (b2 - b1) * tc);
  return (r << 16) | (g << 8) | b;
}
