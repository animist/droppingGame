/**
 * 描画品質ティア。端末性能に応じて演出の重さを切り替える。
 * - high: 全演出ON（glow、密なトレイル、多めのパーティクル）
 * - low : glow OFF、トレイル間引き、パーティクル削減、内部解像度キャップ
 *
 * 判定は段階的に拡張する想定:
 *   1) 静的推定（このファイル、起動前に粗く決める）  ← 今ここ
 *   2) FPS実測でタイトル中に補正                      ← 後で
 *   3) 手動トグル                                      ← 後で
 */

export type QualityTier = 'high' | 'low';

export interface QualityProfile {
  tier: QualityTier;
  glow: boolean;             // postFX グローを使うか
  trailIntervalMs: number;   // トレイル生成間隔（大きいほど軽い）
  trailEnabled: boolean;
  particleScale: number;     // パーティクル数の倍率（0〜1）
}

const PROFILES: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    glow: true,
    trailIntervalMs: 30,
    trailEnabled: true,
    particleScale: 1,
  },
  low: {
    tier: 'low',
    glow: false,
    trailIntervalMs: 60,
    trailEnabled: true,
    particleScale: 0.5,
  },
};

/**
 * 起動前の静的推定。GPUフィルレートは直接測れないため、
 * devicePixelRatio / deviceMemory / コア数から粗く推定する。
 * 確実性は低いので、後段のFPS実測で上書きされる前提。
 */
export function estimateTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const dpr = window.devicePixelRatio || 1;
  const mem = nav.deviceMemory ?? 4;          // GB（Chrome系のみ。不明は4と仮定）
  const cores = nav.hardwareConcurrency ?? 4;

  let score = 0;
  // 高密度画面は描画ピクセルが増えてフィルレートを圧迫 → 減点
  if (dpr >= 3) score -= 2;
  else if (dpr >= 2) score -= 1;
  // メモリ・コア数は弱い指標だが補助的に
  if (mem <= 2) score -= 2;
  else if (mem <= 3) score -= 1;
  else if (mem >= 6) score += 1;
  if (cores <= 4) score -= 1;
  else if (cores >= 8) score += 1;

  return score <= -2 ? 'low' : 'high';
}

let current: QualityProfile = PROFILES.high;

export function initQuality(): QualityProfile {
  current = PROFILES[estimateTier()];
  return current;
}

export function getQuality(): QualityProfile {
  return current;
}

export function setTier(tier: QualityTier): QualityProfile {
  current = PROFILES[tier];
  return current;
}
