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

// 各チャンネルを倍率で持ち上げて明るくする（色相を保ちつつ明度UP）。
// factor=1 で元の色、>1 で明るく。さらに白へ少しブレンドして発光感を出す。
export function brighten(color: number, factor: number, whiteMix = 0.15): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const sr = Math.min(255, r * factor);
  const sg = Math.min(255, g * factor);
  const sb = Math.min(255, b * factor);
  const wr = Math.round(sr + (255 - sr) * whiteMix);
  const wg = Math.round(sg + (255 - sg) * whiteMix);
  const wb = Math.round(sb + (255 - sb) * whiteMix);
  return (wr << 16) | (wg << 8) | wb;
}
