# 引き継ぎ文書: シェーダ描画リライト（feature/shader-renderer）

## 1. 概要 / ゴール
Phaser 3 製モバイルゲーム「dropping」のグラフィック描画を、Phaser GameObject ベース（classic）から **手続きシェーダ描画（shader）** に書き換える作業ブランチ。

- **不変**: 物理・入力・ゲームロジック・コライダーは一切変更しない（描画層のみ差し替え）。
- **フォールバック**: WebGL 非対応時・`getRendererMode()==='classic'` 時は従来描画に落とす。
- **重点**: モバイル（Android Chrome 主軸 / iOS も対応）の実機パフォーマンス。

現在の既定は `mode='shader'`（このブランチのみ）、`bloom=false`。

## 2. ブランチ状態
- ブランチ: `feature/shader-renderer`（`main` から派生）
- 最新コミット: `fff461c`（**ローカルのみ。リモート未 push**）
- ワークツリー: clean、`tsc` 通過済み

直近コミット履歴:

| commit | 内容 |
|---|---|
| `fff461c` | perf: ブルーム既定OFF＋軽量化（モバイル負荷対策） |
| `b8a6fd5` | feat: Phase 3 ブルーム(PostFX)追加（高ティア・shader時のみ、トグル付き） |
| `c13ec3e` | feat: Phase 2b ライン/マーカー/グローを SDF でシェーダ描画 |
| `55e5c7f` | feat: Phase 2 ボールを SDF でシェーダ描画＋背景トーン調整 |
| `df74e4d` | feat: 手続き背景シェーダ導入（Phase 0+1, classic フォールバック付き） |

## 3. アーキテクチャ上の重要決定
1. **1枚の不透明シェーダに全合成**: Phaser の Shader GameObject はアルファ合成が不定（`setBlendMode` は NOOP）。そのため透明オーバーレイ方式を採らず、**背景 → トレイル → グロー → ボール本体 → ハイライト → ライン/マーカー** を 1 枚の不透明シェーダ（depth `-20`）内で正しい順に合成する。
2. **シェーダの上は従来通り Phaser オブジェクト**: パーティクル・文字・ビネット・傾きインジケーターはシェーダの手前に重ねる。
3. **scrollFactor は既定(1,1)のまま**: ニアミスのカメラズーム時に背景＋ボールがライン/パーティクルと一緒に拡縮するよう、あえて固定しない。
4. **単一 gap uniform で十分**: スクロール遷移時 `this.leftLine` が「退場する旧ライン → 入場する新ライン」を順に指すため、2 ライン分のトラッキングは不要。
5. **bloom は opt-in**: 全画面マルチパスでモバイルが重くなるため既定 OFF。SDF 加算グローが常時効くので OFF でも発光感は残る。

## 4. 主要ファイル
- **src/render/rendererMode.ts** — `RendererMode`（'classic'|'shader'）と bloom トグル。`getRendererMode/setRendererMode`、`isBloomEnabled/setBloomEnabled`。
- **src/render/backgroundShader.ts** — シーンシェーダ本体（GLSL FRAG + `addShaderBackground(scene, depth)`）。`PlayfieldState` / `GapState` / `ShaderBackground` を export。uniform 群: `time/resolution`(自動)、`progress`、`ball(4f=x,y,r,rot)`、`ballScale(2f)`、`ballColor/ballGlowColor(3f)`、`ballGlowStr(1f)`、`ballVel(2f)`、`gap(4f=leftEdge,rightEdge,y,alpha)`、`gapColor(3f)`、`lineGlowStr(1f)`、**`partCount(1i)`/`parts(4fv[N]=x,y,radius,alpha)`/`partCol(3fv[N])`**（パーティクル）、**`zoneCool(3f)`/`zoneHot(3f)`**（バイオームの基調色/終端色。`setBiome(cool,hot)` で供給。背景は `mix(zoneCool, zoneHot, progress)`）。
- **src/render/shaderParticles.ts** — シェーダ合成用パーティクルプール（`ShaderParticles`、`MAX_PARTICLES=48`）。JS側で固定長プールを `update(dt)`→`writeBuffers()` し、`parts/colors` の Float32Array を uniform.value として in-place 更新（partCount のみ毎フレーム setUniform）。`explode()`（通過/バウンス/破裂）と `spawnDirected()`（ambient の moveTo を線形速度で近似）。
- **src/scenes/GameScene.ts** — 統合先。`shaderBg` を生成し、`update()` で毎フレーム `setPlayfield()/setGap()/setProgress()` を呼ぶ。shader 時は ball/highlight/glow/line/marker/parallax/trail の Phaser 描画を hide または return。
- **src/scenes/TitleScene.ts** — iOS の傾き許可対応（canvas ネイティブリスナーで `enableTilt()` を同期呼び出し）。
- **src/util/wakelock.ts** — 傾き操作時の画面スリープ抑止。
- **src/config/balance.ts** — TILT_IND_*、LINE_OSCILLATION_*、GAP_JITTER_PX、LINE_SEGMENT_MIN_WIDTH、GAP_CENTER_MIN_SHIFT_PX、BREATHER_*（息継ぎ）等を追加。
- **src/config/quality.ts** — ティア推定（high/low, glow gate）。bloom は `getQuality().glow` でゲート。

## 5. GLSL モバイル要点（再発防止メモ）
過去に黒画面を多数引き起こした地雷。修正済みだが踏まないこと:
- **precision は highp**（`#ifdef GL_FRAGMENT_PRECISION_HIGH`）。mediump の 16bit は Inf/NaN→黒画面。
- **hash は precision 耐性版（Hoskins）** を使用。mediump で Inf/NaN にならないよう。
- **smoothstep は必ず edge0 < edge1**。逆だと一部ドライバで NaN→黒。
- **組み込み名と変数名を衝突させない**（例: `dot` という変数を作らない → コンパイルエラー）。
- **0 除算は max() でガード**。
- **fwidth は使わない**（WebGL1 で拡張未有効）。AA は固定ピクセル幅の smoothstep で解析的に。
- 座標: `vec2 P = vec2(fragCoord.x, resolution.y - fragCoord.y)` で Phaser ワールド（y 下）と一致。`fragCoord` は y 上（下端 0）。
- vec uniform は `{x,y,z,w}` オブジェクトで設定（`setUniform('name.value', {...})`）。

## 6. 動作確認環境（現在停止中）
- 確認は Vite dev サーバー + cloudflared quick tunnel で実機（Android/iOS）。
- 前セッションの dev サーバー・トンネルは停止済み。**再開時は新しい URL が発行される**。

## 7. 未完了・要確認の選択肢（未承認・着手前に要確認）
- `feature/shader-renderer` の **リモート push / main マージ**（現状ローカルのみ）。
- FPS 適応型 bloom。
- ~~パーティクルのシェーダ化~~ → **実装済み（uniform配列ループ方式 / N=48）**。burst/bounce/ambient/death をプール化しシェーダで合成（trail は従来どおりFRAGのカプセルで描画）。要実機確認（特に低スペック端末の負荷とノッチ/解像度での見え方）。
- classic↔shader 切替 UI。

### 補足: パーティクルのシェーダ化（実装メモ）
- 全画面1ループで合成するため**コスト＝画面ピクセル数×粒数**。`partCount` で早期 break、`alpha<0.004` で continue。粒0の通常時はループ即 break でほぼ無コスト。
- 更新は `GameScene.update()` の `if(this.shaderBg)` ブロック末尾。**生delta駆動**（classic同様タイムダイレーション非依存）、ニアミス凍結は `if(this.frozen) return` で自動停止、ゲームオーバー/スクロール中は継続。
- emit は `emitBurst/emitBounceBurst/emitAmbient/explodeBall` が `this.shaderBg` で分岐（無ければ従来エミッタ）。
- classic との差異: ambient(旧depth -1=ボール背面) も含め全粒がボール/ラインの**前面**に合成される（ambient は球縁から散る微粒なので実害ほぼ無し）。気になればFRAGでボール前にambient層を分離可能。
- 自動確認の限界: ヘッドレスPreviewは canvas が 0×0 レイアウト＋screenshot タイムアウトで**ビジュアル確認不可**。tsc/Vite変換/WebGL初期化エラー無し・フォールバック無しまでは確認済み。最終確認は cloudflared 実機で。
