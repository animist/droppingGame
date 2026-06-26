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

// ブルーム（PostFX）。全画面マルチパスで負荷が大きく、ティア推定が「高」でも実機(モバイル)が
// 耐えられないことがあるため既定OFF。capable端末では setBloomEnabled(true) で opt-in。
// （SDFの加算グローは常時効くのでOFFでも発光感は残る）
let bloom = false;

export function isBloomEnabled(): boolean {
  return bloom;
}

export function setBloomEnabled(b: boolean): void {
  bloom = b;
}
