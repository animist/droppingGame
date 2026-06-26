/**
 * シェーダ合成用パーティクルプール（shaderモード専用）。
 *
 * Phaser の ParticleEmitter（GPUバッチ矩形）を使う代わりに、JS側で固定長プールを更新し、
 * 状態を uniform 配列（vec4 parts[N] = x,y,radius,alpha / vec3 partCol[N]）として
 * シーンシェーダへ供給する。シェーダ側は全画面1ループで各粒をアルファ合成する。
 *
 * 設計メモ:
 *  - 全画面ループのコストは「画面ピクセル数 × 粒数」。N は MAX_PARTICLES で上限を切り、
 *    シェーダ側は partCount で break、alpha≈0 は continue で早期スキップする。
 *  - parts/colors の Float32Array は uniform.value にそのまま渡し、in-place 更新する。
 *    Phaser は毎レンダーで uniform.value を読むので、再代入不要（partCount だけ毎フレーム設定）。
 *  - 寿命を超えた粒・count より後ろのバッファ末尾はシェーダが読まない（break）。
 */

// 同時表示の粒数上限。backgroundShader.ts の GLSL 配列長とこの値は連動する
// （FRAG テンプレートにこの定数を埋め込んでいるので、ここを変えれば両方変わる）。
export const MAX_PARTICLES = 48;

export interface EmitOptions {
  speedMin: number;
  speedMax: number;
  angleMinDeg: number; // 画面座標系（y下）。0=右, -90=上, 正=時計回り（Phaser準拠）
  angleMaxDeg: number;
  radiusStart: number; // 表示半径(px) 開始
  radiusEnd: number;   // 表示半径(px) 終了
  alphaStart: number;
  alphaEnd: number;
  lifeMs: number;
  gravity?: number;    // px/s^2（y下方向が正）
  color: number | (() => number); // 0xRRGGBB（関数なら粒ごとに評価）
}

/** 速度を明示する派生（ambient の moveTo を線形速度で近似）。 */
export type DirectedOptions = Pick<
  EmitOptions,
  'radiusStart' | 'radiusEnd' | 'alphaStart' | 'alphaEnd' | 'lifeMs' | 'gravity' | 'color'
>;

interface P {
  active: boolean;
  x: number; y: number;
  vx: number; vy: number;
  gravity: number;
  age: number; life: number; // ms
  r0: number; r1: number;    // 半径(px) 開始/終了
  a0: number; a1: number;    // alpha 開始/終了
  r: number; g: number; b: number; // 0..1
}

export class ShaderParticles {
  /** uniform vec4 parts[N] の実体（x, y, radius, alpha）。in-place 更新。 */
  readonly parts: Float32Array;
  /** uniform vec3 partCol[N] の実体（r, g, b）。in-place 更新。 */
  readonly colors: Float32Array;
  /** 直近 writeBuffers() で詰めたアクティブ粒数。 */
  count = 0;

  private pool: P[] = [];
  private cursor = 0;

  constructor() {
    this.parts = new Float32Array(MAX_PARTICLES * 4);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0, gravity: 0,
        age: 0, life: 1, r0: 1, r1: 1, a0: 1, a1: 0, r: 1, g: 1, b: 1,
      });
    }
  }

  // 空きスロット優先。満杯なら最も寿命の近い粒を再利用（最古を上書き）。
  private acquire(): P {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = (this.cursor + i) % MAX_PARTICLES;
      if (!this.pool[idx].active) {
        this.cursor = (idx + 1) % MAX_PARTICLES;
        return this.pool[idx];
      }
    }
    let best = 0;
    let bestRem = Infinity;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const rem = this.pool[i].life - this.pool[i].age;
      if (rem < bestRem) { bestRem = rem; best = i; }
    }
    return this.pool[best];
  }

  private setColor(p: P, color: number | (() => number)): void {
    const c = typeof color === 'function' ? color() : color;
    p.r = ((c >> 16) & 255) / 255;
    p.g = ((c >> 8) & 255) / 255;
    p.b = (c & 255) / 255;
  }

  /** 1粒を speed/angle から生成。 */
  spawnAt(x: number, y: number, opt: EmitOptions): void {
    const p = this.acquire();
    const ang = (opt.angleMinDeg + Math.random() * (opt.angleMaxDeg - opt.angleMinDeg)) * Math.PI / 180;
    const sp = opt.speedMin + Math.random() * (opt.speedMax - opt.speedMin);
    p.active = true;
    p.x = x; p.y = y;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp;
    p.gravity = opt.gravity ?? 0;
    p.age = 0; p.life = opt.lifeMs;
    p.r0 = opt.radiusStart; p.r1 = opt.radiusEnd;
    p.a0 = opt.alphaStart; p.a1 = opt.alphaEnd;
    this.setColor(p, opt.color);
  }

  /** count 個を同一地点から放射（explode 相当）。 */
  explode(count: number, x: number, y: number, opt: EmitOptions): void {
    for (let i = 0; i < count; i++) this.spawnAt(x, y, opt);
  }

  /** 速度を明示して1粒生成（ambient の moveTo 近似）。 */
  spawnDirected(x: number, y: number, vx: number, vy: number, opt: DirectedOptions): void {
    const p = this.acquire();
    p.active = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.gravity = opt.gravity ?? 0;
    p.age = 0; p.life = opt.lifeMs;
    p.r0 = opt.radiusStart; p.r1 = opt.radiusEnd;
    p.a0 = opt.alphaStart; p.a1 = opt.alphaEnd;
    this.setColor(p, opt.color);
  }

  /** dtMs 進める（位置・重力・寿命）。フリーズ中は呼び出し側で呼ばない＝停止。 */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dtMs;
      if (p.age >= p.life) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** アクティブ粒を parts/colors の先頭へ詰め、count を返す（シェーダはここまでを読む）。 */
  writeBuffers(): number {
    let n = 0;
    for (const p of this.pool) {
      if (!p.active || n >= MAX_PARTICLES) continue;
      const t = p.age / p.life; // 0..1
      const o4 = n * 4;
      const o3 = n * 3;
      this.parts[o4] = p.x;
      this.parts[o4 + 1] = p.y;
      this.parts[o4 + 2] = p.r0 + (p.r1 - p.r0) * t;
      this.parts[o4 + 3] = p.a0 + (p.a1 - p.a0) * t;
      this.colors[o3] = p.r;
      this.colors[o3 + 1] = p.g;
      this.colors[o3 + 2] = p.b;
      n++;
    }
    this.count = n;
    return n;
  }
}
