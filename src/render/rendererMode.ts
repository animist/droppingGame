/**
 * 描画モードの切替。
 * - 'classic': 既存の Phaser GameObject ベース描画（パララックス/シェード/カメラ背景色）
 * - 'shader' : 手続きシェーダ描画（Phase1=背景、以降プレイフィールドへ拡張予定）
 *
 * シェーダは WebGL 必須。Canvas フォールバック時は呼び出し側で classic に落とす。
 * このブランチ(feature/shader-renderer)では既定を 'shader' にしている。
 */
export type RendererMode = 'classic' | 'shader';

let mode: RendererMode = 'shader';

export function getRendererMode(): RendererMode {
  return mode;
}

export function setRendererMode(m: RendererMode): void {
  mode = m;
}
