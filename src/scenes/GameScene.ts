import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { FONT_FAMILY } from '../config/ui';
import { tilt } from '../input/tilt';
import { playBounce, playWall, playPass, playGameOver, playPerfectPass, playNearMiss, playMilestone, playBestBeaten, setMusicMuffled, updateFallSound, muteFallSound } from '../audio/sfx';
import { startMusic, stopMusic, tapeStopMusic, setMusicIntensity, intensityFromScore } from '../audio/music';
import { vibrate } from '../input/haptics';
import { lerpColor, brighten } from '../util/color';
import { addBackgroundShade, addWarningVignette } from '../util/bgShade';
import { getQuality } from '../config/quality';

export class GameScene extends Phaser.Scene {
  private ball!: Phaser.GameObjects.Arc;
  private ballHighlight!: Phaser.GameObjects.Arc;  // 球体感を出す左上ハイライト
  private leftLine!: Phaser.GameObjects.Rectangle;
  private rightLine!: Phaser.GameObjects.Rectangle;
  private leftMarker!: Phaser.GameObjects.Arc;     // 隙間の左端を示す発光点
  private rightMarker!: Phaser.GameObjects.Arc;    // 隙間の右端を示す発光点

  private gapWidth = GAME.GAP_INITIAL;
  private gapCenterX = GAME.WIDTH / 2;
  private ballDiameter = GAME.BALL_INITIAL_DIAMETER;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private hasPassedGap = false;
  private isGameOver = false;
  private isScrolling = false;
  private pointerLastX: number | null = null;
  private bgProgress = 0;
  private trailTimer = 0;
  private ambientTimer = 0;            // 常時パーティクルの生成タイマー
  private warningActive = false;
  private warningTween: Phaser.Tweens.Tween | null = null;
  private warnVignette: Phaser.GameObjects.Image | null = null;   // 警告中に脈動する赤ビネット
  private warnVignetteTween: Phaser.Tweens.Tween | null = null;
  private guideTexts: Phaser.GameObjects.Text[] = [];             // 初回プレイの操作ガイド
  private bounceCount = 0;
  private perfectStreak = 0;
  private perfectCount = 0;          // このプレイでのPERFECT総数（リザルト内訳用）
  private maxPerfectStreak = 0;      // PERFECT最大連続数（リザルト内訳用）
  private nearMissCount = 0;         // CLOSE（ニアミス通過）総数（リザルト内訳用）
  private prevBest = 0;              // プレイ開始時点の自己ベスト（ベスト超え演出用）
  private bestBeaten = false;        // ベスト超え演出を発動済みか
  private gammaRest = 0;        // 持ち方の傾き癖を吸収するための中立値
  private gammaCalibrated = false;
  private ballGlow: Phaser.FX.Glow | null = null;
  private ballGlowBase = GAME.GLOW_BALL_BASE;  // 色の進行度で決まるグロー基準強度（揺らぎ前）
  private lineGlows: Phaser.FX.Glow[] = [];
  private parallaxDots: { obj: Phaser.GameObjects.Arc; speed: number; ratio: number }[] = [];
  private musicIntensity = 0;
  private scrollProxy = { y: 0 };       // ライン上昇に同期する仮想スクロール位置
  private scrollPrevY = 0;
  private parallaxScrolling = false;
  private nextMilestoneIdx = 0;         // 次に到達すべきマイルストーンのインデックス
  private frozen = false;               // ニアミスのストップモーション中フラグ
  // ニアミスのピボット固定ズーム状態
  private nmActive = false;
  private nmElapsed = 0;
  private nmPivotX = 0;
  private nmPivotY = 0;
  private nmText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Game');
  }

  create() {
    this.gapWidth = GAME.GAP_INITIAL;
    this.gapCenterX = GAME.WIDTH / 2;
    this.ballDiameter = GAME.BALL_INITIAL_DIAMETER;
    this.score = 0;
    this.hasPassedGap = false;
    this.isGameOver = false;
    this.isScrolling = false;
    this.pointerLastX = null;
    this.bgProgress = 0;
    this.trailTimer = 0;
    this.ambientTimer = 0;
    this.warningActive = false;
    this.warningTween = null;
    this.warnVignette = null;
    this.warnVignetteTween = null;
    this.guideTexts = [];
    this.bounceCount = 0;
    this.perfectStreak = 0;
    this.perfectCount = 0;
    this.maxPerfectStreak = 0;
    this.nearMissCount = 0;
    this.bestBeaten = false;
    try {
      this.prevBest = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
    } catch {
      this.prevBest = 0;
    }
    this.gammaRest = 0;
    this.gammaCalibrated = false;
    this.ballGlow = null;
    this.lineGlows = [];
    this.parallaxScrolling = false;
    this.nextMilestoneIdx = 0;
    this.frozen = false;
    this.nmActive = false;
    this.nmText = null;
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    if (this.physics.world) this.physics.world.timeScale = 1;
    // 200ms 後に傾きセンサーの現在値を「中立」として記録（端末を構える角度の癖を吸収）
    this.time.delayedCall(200, () => {
      if (tilt.enabled) this.gammaRest = tilt.value;
      this.gammaCalibrated = true;
    });
    this.cameras.main.setBackgroundColor(GAME.BG_COLOR_START);

    this.createParallax();
    // パララックス(-10)の手前・ゲームプレイ要素の奥に敷き、ドットごと薄く沈めて奥行きを出す
    addBackgroundShade(this, -9);
    // 警告用の赤ビネット（alpha 0 で常駐、警告中だけ脈動）
    this.warnVignette = addWarningVignette(this, 930);

    this.scoreText = this.add.text(GAME.WIDTH / 2, 100, '0', {
      fontFamily: FONT_FAMILY,
      fontSize: '120px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5);

    this.physics.world.setBoundsCollision(true, true, false, false);
    this.createBall();
    this.randomizeGapCenter();
    this.createLines();
    this.updateBallColor(); // 初期の穴比率に応じた色を反映

    // BGM 開始（前回の警告こもりが残らないようフィルタを開いておく）
    this.musicIntensity = 0;
    setMusicIntensity(0);
    setMusicMuffled(false);
    startMusic();
    this.events.once('shutdown', () => stopMusic());
    this.setupInput();

    // 初回プレイ（累計プレイ回数 0）のときだけ操作ガイドを表示
    let playCount = 1;
    try {
      playCount = Number(localStorage.getItem(STORAGE_KEYS.PLAY_COUNT) ?? 0);
    } catch {
      playCount = 1; // localStorage 不可なら毎回出さない側に倒す
    }
    if (playCount === 0) this.createFirstPlayGuide();
  }

  // 初回プレイの操作ガイド（最初の通過 or ゲームオーバーで消える）
  private createFirstPlayGuide() {
    const cx = GAME.WIDTH / 2;
    const y = 760;
    const style = (size: string, color = '#ffffff') => ({
      fontFamily: FONT_FAMILY,
      fontSize: size,
      color,
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    });
    const left = this.add.text(cx - 250, y, '←', style('48px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const right = this.add.text(cx + 250, y, '→', style('48px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const msg = this.add.text(cx, y, 'スワイプ / かたむけ', style('34px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const sub = this.add.text(cx, y + 64, 'たまを すきまに とおそう', style('28px', '#aaaadd')).setOrigin(0.5).setDepth(970).setAlpha(0.85);
    this.guideTexts = [left, right, msg, sub];

    this.tweens.add({
      targets: left, x: '-=24', duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: right, x: '+=24', duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private dismissGuide() {
    if (!this.guideTexts.length) return;
    const texts = this.guideTexts;
    this.guideTexts = [];
    for (const t of texts) this.tweens.killTweensOf(t);
    this.tweens.add({
      targets: texts,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => texts.forEach((t) => t.destroy()),
    });
  }

  private createBall() {
    const radius = this.ballDiameter / 2;
    this.ball = this.add.circle(GAME.WIDTH / 2, GAME.BALL_START_Y, radius, GAME.BALL_COLOR);
    this.physics.add.existing(this.ball);
    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);
    body.setBounce(GAME.WALL_BOUNCE, GAME.BOUNCE);
    body.setDragX(GAME.DRAG_X);
    body.setCollideWorldBounds(true);
    body.setMaxVelocity(GAME.MAX_VELOCITY, GAME.MAX_VELOCITY);
    body.onWorldBounds = true;
    this.physics.world.on('worldbounds', this.onWallBounce, this);
    this.ballGlow = this.addGlow(
      this.ball,
      GAME.GLOW_BALL_BASE,
      brighten(GAME.BALL_COLOR_START, GAME.GLOW_BALL_BRIGHTEN),
      GAME.GLOW_BALL_DISTANCE,
      GAME.GLOW_BALL_QUALITY,
    );
    // 左上の白ハイライト（ボール直後に生成して常にボールの上へ重ねる）。位置・大きさは update で追従
    this.ballHighlight = this.add.circle(
      this.ball.x - radius * 0.35, this.ball.y - radius * 0.35,
      Math.max(2, radius * 0.28), 0xffffff, 0.3,
    );
  }

  // ハイライトをボールの現在位置・変形（スクワッシュ／ストレッチ含む）に追従させる
  private syncBallHighlight() {
    if (!this.ballHighlight || !this.ball) return;
    const r = this.ballDiameter / 2;
    // オフセットは「光源が左上」の世界座標固定。大きさだけ平均スケールでならす
    const meanScale = (this.ball.scaleX + this.ball.scaleY) / 2;
    this.ballHighlight.setPosition(
      this.ball.x - r * 0.35 * meanScale,
      this.ball.y - r * 0.35 * meanScale,
    );
    this.ballHighlight.setRadius(Math.max(2, r * 0.28));
    this.ballHighlight.setRotation(this.ball.rotation);
    this.ballHighlight.setScale(this.ball.scaleX, this.ball.scaleY);
  }

  // 移動速度に応じてボールを進行方向に伸ばす（速いほど細長く）。
  // スクワッシュ等の tween 中はそちらを優先する。
  private applyVelocityStretch(body: Phaser.Physics.Arcade.Body) {
    if (this.tweens.isTweening(this.ball)) return;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > GAME.STRETCH_MIN_SPEED) {
      const t = Math.min(
        1,
        (speed - GAME.STRETCH_MIN_SPEED) / (GAME.STRETCH_MAX_SPEED - GAME.STRETCH_MIN_SPEED),
      );
      const s = GAME.STRETCH_MAX * t;
      // 回転＝進行方向。ローカルX軸（scaleX）が進行方向に対応する
      this.ball.setRotation(Math.atan2(body.velocity.y, body.velocity.x));
      this.ball.setScale(1 + s, 1 - s * 0.6);
    } else {
      this.ball.setRotation(0);
      this.ball.setScale(1);
    }
  }

  // 背景の3層パララックス（奥行き感のあるドット群）
  // ratio: ライン上昇スクロールに連動する際の追従率（近景=1.0でライン速度に一致、遠景ほど小さく＝視差）
  private createParallax() {
    this.parallaxDots = [];
    const layers = [
      { count: GAME.PARALLAX_FAR_COUNT, size: 2, alpha: 0.12, speed: 14, color: 0x8888aa, ratio: 0.25 },
      { count: GAME.PARALLAX_MID_COUNT, size: 3, alpha: 0.20, speed: 32, color: 0xaaaacc, ratio: 0.55 },
      { count: GAME.PARALLAX_NEAR_COUNT, size: 5, alpha: 0.28, speed: 60, color: 0xccccee, ratio: 1.0 },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.count; i++) {
        const dot = this.add.circle(
          Phaser.Math.Between(0, GAME.WIDTH),
          Phaser.Math.Between(0, GAME.HEIGHT),
          L.size, L.color, L.alpha,
        ).setDepth(-10);
        this.parallaxDots.push({ obj: dot, speed: L.speed, ratio: L.ratio });
      }
    }
  }

  private updateParallax(delta: number) {
    const dt = delta / 1000;
    // ライン上昇に同期した追加スクロール量（px、上方向）
    let scrollDelta = 0;
    if (this.parallaxScrolling) {
      scrollDelta = this.scrollPrevY - this.scrollProxy.y;
      this.scrollPrevY = this.scrollProxy.y;
    }
    for (const p of this.parallaxDots) {
      // 常時のゆるやかな上方向ドリフト + ライン同期スクロール（層ごとの視差を保つ）
      p.obj.y -= p.speed * GAME.PARALLAX_DRIFT_SPEED * dt;
      if (scrollDelta !== 0) p.obj.y -= scrollDelta * p.ratio;
      // 画面外に出たら反対側へ循環
      if (p.obj.y < -8) {
        p.obj.y += GAME.HEIGHT + 16;
        p.obj.x = Phaser.Math.Between(0, GAME.WIDTH);
      } else if (p.obj.y > GAME.HEIGHT + 8) {
        p.obj.y -= GAME.HEIGHT + 16;
        p.obj.x = Phaser.Math.Between(0, GAME.WIDTH);
      }
    }
  }

  // WebGL の Glow FX を安全に追加（Canvasレンダラーでは無視）。失敗してもゲームは続行。
  // distance/quality でぼかし具合を調整できる（ボールは大きく柔らかく、ラインはシャープに）
  private addGlow(
    obj: Phaser.GameObjects.Shape,
    strength: number,
    color?: number,
    distance = GAME.GLOW_DISTANCE,
    quality = GAME.GLOW_QUALITY,
  ): Phaser.FX.Glow | null {
    // low ティアでは glow を完全に無効化（postFXの全画面パスが最大のボトルネック）
    if (!getQuality().glow) return null;
    try {
      const fx = obj.postFX;
      if (!fx) return null;
      return fx.addGlow(color, strength, 0, false, quality, distance);
    } catch {
      return null;
    }
  }

  private createLines() {
    const gapHalf = this.gapWidth / 2;
    const leftSegWidth = this.gapCenterX - gapHalf;
    const rightSegWidth = GAME.WIDTH - (this.gapCenterX + gapHalf);
    const y = GAME.LINE_Y;

    this.leftLine = this.add.rectangle(
      leftSegWidth / 2, y,
      leftSegWidth, GAME.LINE_HEIGHT,
      GAME.LINE_COLOR,
    );
    this.rightLine = this.add.rectangle(
      this.gapCenterX + gapHalf + rightSegWidth / 2, y,
      rightSegWidth, GAME.LINE_HEIGHT,
      GAME.LINE_COLOR,
    );

    this.physics.add.existing(this.leftLine, true);
    this.physics.add.existing(this.rightLine, true);

    // 隙間の端を示す発光マーカー（端の視認性UP）。位置は oscillateLines で追従
    this.leftMarker = this.add.circle(
      leftSegWidth, y, GAME.GAP_MARKER_RADIUS, GAME.GAP_MARKER_COLOR,
    );
    this.rightMarker = this.add.circle(
      this.gapCenterX + gapHalf, y, GAME.GAP_MARKER_RADIUS, GAME.GAP_MARKER_COLOR,
    );

    // 新ラインのグロー参照を保持（呼吸アニメ用、古い参照は破棄）
    this.lineGlows = [];
    const gl = this.addGlow(this.leftLine, GAME.GLOW_LINE);
    const gr = this.addGlow(this.rightLine, GAME.GLOW_LINE);
    const gml = this.addGlow(this.leftMarker, GAME.GLOW_LINE);
    const gmr = this.addGlow(this.rightMarker, GAME.GLOW_LINE);
    if (gl) this.lineGlows.push(gl);
    if (gr) this.lineGlows.push(gr);
    if (gml) this.lineGlows.push(gml);
    if (gmr) this.lineGlows.push(gmr);

    this.physics.add.collider(this.ball, this.leftLine, () => this.onBounce());
    this.physics.add.collider(this.ball, this.rightLine, () => this.onBounce());
  }

  private oscillateLines(time: number) {
    if (!this.leftLine || !this.rightLine) return;
    const t = time * 0.001;
    const amp = GAME.LINE_OSCILLATION_AMPLITUDE_PX;
    const leftOsc = Math.sin(t * GAME.LINE_OSC_FREQ_LEFT) * amp;
    const rightOsc = Math.sin(t * GAME.LINE_OSC_FREQ_RIGHT + GAME.LINE_OSC_PHASE_RIGHT) * amp;

    const baseLeft = this.gapCenterX - this.gapWidth / 2;
    const baseRight = GAME.WIDTH - (this.gapCenterX + this.gapWidth / 2);
    const newLeft = Math.max(1, baseLeft + leftOsc);
    const newRight = Math.max(1, baseRight + rightOsc);

    this.leftLine.setSize(newLeft, GAME.LINE_HEIGHT);
    this.leftLine.x = newLeft / 2;
    this.rightLine.setSize(newRight, GAME.LINE_HEIGHT);
    this.rightLine.x = GAME.WIDTH - newRight / 2;

    // 端マーカーをラインの内側端に追従させる（yは登場アニメ中のライン位置に合わせる）
    this.leftMarker?.setPosition(newLeft, this.leftLine.y);
    this.rightMarker?.setPosition(GAME.WIDTH - newRight, this.rightLine.y);

    (this.leftLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
    (this.rightLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
  }

  private randomizeGapCenter() {
    const gapHalf = this.gapWidth / 2;
    const min = gapHalf + GAME.LINE_SEGMENT_MIN_WIDTH;
    const max = GAME.WIDTH - gapHalf - GAME.LINE_SEGMENT_MIN_WIDTH;
    this.gapCenterX = Phaser.Math.Between(Math.ceil(min), Math.floor(max));
  }

  private onBounce() {
    if (this.isGameOver || this.isScrolling) return;

    this.bounceCount += 1;
    this.perfectStreak = 0;
    this.ballDiameter += GAME.BALL_GROWTH_PER_BOUNCE;
    const radius = this.ballDiameter / 2;
    this.ball.setRadius(radius);
    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);

    this.squashBall();
    this.emitBounceBurst(this.ball.x, this.ball.y + this.ballDiameter / 2);
    this.updateBallColor();
    this.updateBgColor();
    this.checkWarning();
    playBounce(this.ballDiameter, this.ballPan());

    const sizeRatio = this.ballDiameter / GAME.BALL_INITIAL_DIAMETER;
    this.cameras.main.shake(
      GAME.SHAKE_BASE_DURATION_MS,
      GAME.SHAKE_BASE_INTENSITY * sizeRatio,
    );
    vibrate(Math.min(40, 10 + sizeRatio * 4));

    if (this.ballDiameter > this.gapWidth) {
      this.triggerGameOver();
    }
  }

  private onWallBounce(body: Phaser.Physics.Arcade.Body) {
    if (this.isGameOver || this.isScrolling) return;
    if (body.gameObject !== this.ball) return;
    if (body.blocked.left || body.blocked.right) {
      playWall(this.ballPan());
    }
  }

  // ボールのx位置 → ステレオパン (-1〜+1)
  private ballPan(): number {
    const t = (this.ball.x / GAME.WIDTH) * 2 - 1; // -1..+1
    return Math.max(-1, Math.min(1, t)) * GAME.AUDIO_PAN_STRENGTH;
  }

  // 成功の瞬間に一瞬スローモーション（time scale を下げて実時間で戻す）
  private triggerTimeDilation() {
    const scale = GAME.TIME_DILATION_SCALE;
    this.time.timeScale = scale;
    this.tweens.timeScale = scale;
    if (this.physics.world) this.physics.world.timeScale = 1 / scale; // arcadeは逆数で遅くなる

    // 復帰は実時間で行う（スロー自体に引きずられないよう window.setTimeout を使用）
    window.setTimeout(() => {
      if (!this.scene.isActive()) return;
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
      if (this.physics.world) this.physics.world.timeScale = 1;
    }, GAME.TIME_DILATION_HOLD_MS + GAME.TIME_DILATION_RECOVER_MS);
  }

  private squashBall() {
    this.tweens.killTweensOf(this.ball);
    // スクワッシュは水平ライン基準の変形なので、ストレッチの回転を戻してから行う
    this.ball.setRotation(0);
    this.ball.setScale(GAME.SQUASH_SCALE_X, GAME.SQUASH_SCALE_Y);
    this.tweens.chain({
      targets: this.ball,
      tweens: [
        {
          scaleX: GAME.EXPAND_SCALE,
          scaleY: GAME.EXPAND_SCALE,
          duration: GAME.SQUASH_DURATION_MS,
          ease: 'Quad.easeOut',
        },
        {
          scaleX: 1,
          scaleY: 1,
          duration: GAME.SETTLE_DURATION_MS,
          ease: 'Quad.easeInOut',
        },
      ],
    });
  }

  private setupInput() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isScrolling) return;
      this.pointerLastX = pointer.worldX;
    });
    this.input.on('pointerup', () => {
      this.pointerLastX = null;
    });
    this.input.on('pointerupoutside', () => {
      this.pointerLastX = null;
    });
  }

  update(_time: number, delta: number) {
    // ニアミスのピボット固定ズームは凍結中も毎フレーム駆動する（カメラだけ動かす）
    if (this.nmActive) this.updateNearMissZoom(delta);

    // ニアミスのストップモーション中は世界の演出を停止（カメラ以外は止まって見える）
    if (this.frozen) {
      muteFallSound();
      return;
    }

    const body = this.ball.body as Phaser.Physics.Arcade.Body | null;
    if (body && body.enable && !this.isGameOver) {
      updateFallSound(
        body.velocity.y,
        GAME.FALL_SOUND_MAX_VELOCITY,
        GAME.FALL_SOUND_MAX_GAIN,
        this.perfectStreak * GAME.FALL_STREAK_PITCH_CENTS,
      );
    } else {
      muteFallSound();
    }

    // パララックスは演出なので常に更新（スクロール中・ゲームオーバー後も動かす）
    this.updateParallax(delta);

    // ハイライトはスクロール復帰tween中もボールに追従させる
    this.syncBallHighlight();

    // グロー強度を sin で揺らがせて「呼吸する発光」にする
    if (this.ballGlow) {
      const pulse = Math.sin(_time * 0.001 * GAME.GLOW_PULSE_FREQ) * GAME.GLOW_PULSE_AMP;
      this.ballGlow.outerStrength = Math.max(0, this.ballGlowBase + pulse);
    }
    // ラインはより遅く・小さく呼吸（基準より控えめでゼロにはならない）
    if (this.lineGlows.length) {
      const linePulse = Math.sin(_time * 0.001 * GAME.GLOW_LINE_PULSE_FREQ) * GAME.GLOW_LINE_PULSE_AMP;
      for (const g of this.lineGlows) {
        g.outerStrength = GAME.GLOW_LINE + linePulse;
      }
    }

    if (this.isGameOver || this.isScrolling || !body) return;

    this.oscillateLines(_time);

    const pointer = this.input.activePointer;

    if (pointer.isDown && this.pointerLastX !== null) {
      const dx = pointer.worldX - this.pointerLastX;
      if (Math.abs(dx) > GAME.SWIPE_DEAD_ZONE_PX) {
        body.velocity.x += dx * GAME.SWIPE_IMPULSE_FACTOR;
      }
      this.pointerLastX = pointer.worldX;
    } else if (!pointer.isDown) {
      this.pointerLastX = null;
    }

    if (tilt.enabled && this.gammaCalibrated) {
      const tiltX = tilt.value - this.gammaRest;
      if (Math.abs(tiltX) > GAME.TILT_DEAD_ZONE_DEG) {
        body.velocity.x += tiltX * GAME.TILT_FACTOR * (delta / 1000);
      }
    }

    this.applyVelocityStretch(body);

    const q = getQuality();
    if (q.trailEnabled) {
      this.trailTimer += delta;
      if (this.trailTimer >= q.trailIntervalMs) {
        this.trailTimer = 0;
        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        if (speed > GAME.TRAIL_MIN_SPEED) {
          this.spawnTrailDot();
        }
      }
    }

    // 常時パーティクル: 移動中はきらめく粒を撒く（コンボ中は数が増え金色が混ざる）
    this.ambientTimer += delta;
    if (this.ambientTimer >= GAME.AMBIENT_INTERVAL_MS) {
      this.ambientTimer = 0;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > GAME.AMBIENT_MIN_SPEED) {
        this.emitAmbient(body);
      }
    }

    if (!this.hasPassedGap && this.ball.y > GAME.LINE_Y + GAME.LINE_HEIGHT) {
      // 実際の（伸縮後の）ライン位置で判定
      const leftInnerX = this.leftLine.x + this.leftLine.width / 2;
      const rightInnerX = this.rightLine.x - this.rightLine.width / 2;
      if (this.ball.x > leftInnerX && this.ball.x < rightInnerX) {
        // ボール端から左右ライン端までの余白（ニアミス判定用）
        const radius = this.ballDiameter / 2;
        const leftMargin = (this.ball.x - leftInnerX) - radius;
        const rightMargin = (rightInnerX - this.ball.x) - radius;
        const clearance = Math.min(leftMargin, rightMargin);
        // ギリギリだった側のライン端をフォーカス点に
        const focusEdgeX = leftMargin < rightMargin ? leftInnerX : rightInnerX;
        const focusX = (this.ball.x + focusEdgeX) / 2;
        this.onPassThroughGap(clearance, focusX);
        return;
      }
    }

    if (this.ball.y > GAME.HEIGHT + 200 || this.ball.x < -200 || this.ball.x > GAME.WIDTH + 200) {
      this.triggerGameOver();
    }
  }

  private onPassThroughGap(clearance = Infinity, focusX = GAME.WIDTH / 2) {
    this.hasPassedGap = true;
    this.isScrolling = true;
    this.dismissGuide();

    const isNearMiss = clearance <= GAME.NEAR_MISS_CLEARANCE_PX;
    const isPerfect = this.bounceCount === 0;
    // ボール色の進行度 t (0=初期色、1=完全に終端色) が閾値以上で終端色ボーナス発動
    const isAtEndColor = this.ballColorT() >= GAME.END_COLOR_BONUS_THRESHOLD;

    // 連続パーフェクトの計数を先に更新（コンボボーナスの算出で使う）
    if (isPerfect) {
      this.perfectStreak += 1;
      this.perfectCount += 1;
      this.maxPerfectStreak = Math.max(this.maxPerfectStreak, this.perfectStreak);
    }
    if (isNearMiss) {
      this.nearMissCount += 1;
    }

    let points = isPerfect ? 1 + GAME.NO_BOUNCE_BONUS : 1;
    // コンボボーナス: PERFECT が 2 回以上連続した時、コンボ回数を加算
    // (例: streak=2 → +2、streak=3 → +3 ...)
    if (isPerfect && this.perfectStreak >= 2) {
      points += this.perfectStreak;
    }
    if (isAtEndColor) {
      // 終端色での通過は別途加算。PERFECT 時は更に倍。
      points += isPerfect ? GAME.END_COLOR_BONUS * 2 : GAME.END_COLOR_BONUS;
    }
    if (isNearMiss) {
      // ギリギリ通過（CLOSE）のボーナス
      points += GAME.NEAR_MISS_BONUS;
    }
    const prevScore = this.score;
    this.score += points;
    this.scoreText.setText(this.score.toString());

    // BGM の盛り上がりをスコアに連動
    const newIntensity = intensityFromScore(this.score);
    if (newIntensity !== this.musicIntensity) {
      this.musicIntensity = newIntensity;
      setMusicIntensity(newIntensity);
    }

    // マイルストーン到達チェック（1回の通過で複数跨いだ場合は最高位を採用）
    this.checkMilestones(prevScore, this.score);

    // 自己ベスト超えチェック（初回プレイ=ベスト0のときは Result の NEW BEST に任せる）
    if (!this.bestBeaten && this.prevBest > 0 && this.score > this.prevBest) {
      this.triggerBestBeaten();
    }

    this.stopWarning();
    this.popScore();
    this.flashScreen();
    const particleCount = isPerfect
      ? GAME.PARTICLE_COUNT + GAME.PERFECT_PARTICLE_COUNT
      : GAME.PARTICLE_COUNT;
    this.emitBurst(this.ball.x, GAME.LINE_Y, particleCount);
    this.spawnScorePopup(this.ball.x, GAME.LINE_Y, points, isPerfect, isAtEndColor);
    // ニアミス時は専用のストップモーション演出を使うので通常のスローは省く
    if (!isNearMiss) this.triggerTimeDilation();
    const pan = this.ballPan();
    if (isPerfect) {
      this.spawnPerfectText(this.perfectStreak);
      playPerfectPass(this.perfectStreak * GAME.FALL_STREAK_PITCH_CENTS, pan);
      vibrate([0, 40, 30, 40, 30, 60]);
    } else {
      playPass(pan);
      vibrate([0, 25, 40, 25]);
    }

    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    // ベロシティストレッチの変形をリセット（スクロール中は等速で見せる）
    this.ball.setRotation(0).setScale(1);

    const oldLeft = this.leftLine;
    const oldRight = this.rightLine;
    const oldMarkerL = this.leftMarker;
    const oldMarkerR = this.rightMarker;

    this.tweens.add({
      targets: [oldLeft, oldRight, oldMarkerL, oldMarkerR],
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        oldLeft.destroy();
        oldRight.destroy();
        oldMarkerL.destroy();
        oldMarkerR.destroy();
      },
    });

    // 背景パララックスをラインと同じ動き（時間・イージング）でスクロールアウトさせる。
    // tweens.timeScale 経由でタイムダイレーションのスローにも自動同期する。
    this.scrollProxy.y = GAME.LINE_Y;
    this.scrollPrevY = GAME.LINE_Y;
    this.parallaxScrolling = true;
    this.tweens.add({
      targets: this.scrollProxy,
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.parallaxScrolling = false;
      },
    });

    this.tweens.add({
      targets: this.ball,
      y: GAME.BALL_START_Y,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.gapWidth = Math.max(
          this.ballDiameter + GAME.GAP_MIN_MARGIN,
          this.gapWidth - GAME.GAP_REDUCTION,
        );
        this.updateBgColor();
        this.updateBallColor(); // 穴が縮んで比率が変わったのでボール色も更新

        if (this.ballDiameter > this.gapWidth) {
          body.enable = true;
          this.triggerGameOver();
          return;
        }

        this.randomizeGapCenter();
        this.createLines();

        this.leftLine.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.rightLine.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.leftMarker.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.rightMarker.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.tweens.add({
          targets: [this.leftLine, this.rightLine, this.leftMarker, this.rightMarker],
          y: GAME.LINE_Y,
          duration: GAME.LINE_ENTER_DURATION_MS,
          ease: 'Back.easeOut',
          onComplete: () => {
            body.setVelocity(0, 0);
            body.enable = true;
            this.bounceCount = 0;
            this.checkWarning();
            this.hasPassedGap = false;
            this.isScrolling = false;
          },
        });
      },
    });

    // ニアミス時はここで全体をストップモーション + 強ズーム（スクロールtween生成後に凍結）
    if (isNearMiss) {
      this.triggerNearMiss(focusX, GAME.LINE_Y, pan);
    }
  }

  private popScore() {
    this.tweens.killTweensOf(this.scoreText);
    this.scoreText.setScale(GAME.SCORE_POP_SCALE).setAlpha(0.95);
    this.tweens.add({
      targets: this.scoreText,
      scale: 1,
      alpha: 0.5,
      duration: GAME.SCORE_POP_DURATION_MS * 2,
      ease: 'Quad.easeOut',
    });
  }

  private flashScreen() {
    const flash = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2,
      GAME.WIDTH, GAME.HEIGHT,
      0xffffff, GAME.FLASH_ALPHA,
    ).setDepth(1000);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: GAME.FLASH_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  // 落下中のきらめき。ボールの縁から粒を散らし、進行と逆方向+ランダムに漂わせて消す。
  // PERFECTコンボ1につき粒が+1個（上限あり）、コンボ中は金色の粒が混ざる。
  private emitAmbient(body: Phaser.Physics.Arcade.Body) {
    const extra = Math.min(this.perfectStreak, GAME.AMBIENT_STREAK_MAX);
    const n = Math.max(1, Math.round((1 + extra) * getQuality().particleScale));
    const r = this.ballDiameter / 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const px = this.ball.x + Math.cos(ang) * r * 0.8;
      const py = this.ball.y + Math.sin(ang) * r * 0.8;
      const gold = this.perfectStreak > 0 && Math.random() < GAME.AMBIENT_GOLD_RATIO;
      const color = gold ? 0xffd700 : this.ball.fillColor;
      const size = Phaser.Math.Between(GAME.AMBIENT_SIZE_MIN, GAME.AMBIENT_SIZE_MAX);
      const p = this.add.circle(px, py, size, color, 0.85).setDepth(this.ball.depth - 1);
      const driftX = (Math.random() - 0.5) * GAME.AMBIENT_DRIFT_PX - body.velocity.x * 0.04;
      const driftY = (Math.random() - 0.5) * GAME.AMBIENT_DRIFT_PX - body.velocity.y * 0.06;
      this.tweens.add({
        targets: p,
        x: px + driftX,
        y: py + driftY,
        alpha: 0,
        scale: 0.2,
        duration: GAME.AMBIENT_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private spawnTrailDot() {
    const radius = this.ballDiameter / 2;
    const dot = this.add.circle(
      this.ball.x, this.ball.y, radius,
      this.ball.fillColor, GAME.TRAIL_ALPHA,
    ).setDepth(this.ball.depth - 1);
    this.tweens.add({
      targets: dot,
      alpha: 0,
      scale: 0.3,
      duration: GAME.TRAIL_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => dot.destroy(),
    });
  }

  private checkWarning() {
    const ratio = this.ballDiameter / this.gapWidth;
    if (ratio >= GAME.WARNING_THRESHOLD) {
      this.startWarning();
    } else {
      this.stopWarning();
    }
  }

  private startWarning() {
    if (this.warningActive) return;
    this.warningActive = true;
    this.warningTween = this.tweens.add({
      targets: [this.leftLine, this.rightLine, this.leftMarker, this.rightMarker],
      alpha: 0.35,
      duration: GAME.WARNING_PULSE_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.leftLine.setFillStyle(0xff4830);
    this.rightLine.setFillStyle(0xff4830);
    this.leftMarker?.setFillStyle(0xff4830);
    this.rightMarker?.setFillStyle(0xff4830);

    // 画面周辺の赤ビネットを脈動させ、BGMをこもらせて緊張感を立体化する
    if (this.warnVignette) {
      this.warnVignetteTween = this.tweens.add({
        targets: this.warnVignette,
        alpha: GAME.WARNING_VIGNETTE_ALPHA,
        duration: GAME.WARNING_PULSE_DURATION_MS,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    setMusicMuffled(true);
  }

  private stopWarning() {
    if (!this.warningActive) return;
    this.warningActive = false;
    if (this.warningTween) {
      this.warningTween.stop();
      this.warningTween = null;
    }
    this.leftLine?.setAlpha(1);
    this.rightLine?.setAlpha(1);
    this.leftLine?.setFillStyle(GAME.LINE_COLOR);
    this.rightLine?.setFillStyle(GAME.LINE_COLOR);
    this.leftMarker?.setAlpha(1);
    this.rightMarker?.setAlpha(1);
    this.leftMarker?.setFillStyle(GAME.GAP_MARKER_COLOR);
    this.rightMarker?.setFillStyle(GAME.GAP_MARKER_COLOR);
    if (this.warnVignetteTween) {
      this.warnVignetteTween.stop();
      this.warnVignetteTween = null;
    }
    this.warnVignette?.setAlpha(0);
    setMusicMuffled(false);
  }

  // ボール色の進行度 t (0=開始色、1=終端色)。「ボール直径 / 穴幅」の比率で決まる
  private ballColorT(): number {
    const ratio = this.ballDiameter / this.gapWidth;
    const t = (ratio - GAME.BALL_COLOR_RATIO_START) / (GAME.BALL_COLOR_RATIO_END - GAME.BALL_COLOR_RATIO_START);
    return Math.max(0, Math.min(1, t));
  }

  private updateBallColor() {
    const t = this.ballColorT();
    const c = lerpColor(GAME.BALL_COLOR_START, GAME.BALL_COLOR_END, t);
    this.ball.setFillStyle(c);
    // 終端色に近づくほどグロー基準を強くし、色はボール色を明るくした同系色にする
    // （実際の強度は update() で sin 揺らぎを乗せる）
    this.ballGlowBase = GAME.GLOW_BALL_BASE + (GAME.GLOW_BALL_MAX - GAME.GLOW_BALL_BASE) * t;
    if (this.ballGlow) {
      this.ballGlow.color = brighten(c, GAME.GLOW_BALL_BRIGHTEN);
    }
  }

  private updateBgColor() {
    const ratio = this.gapWidth / this.ballDiameter;
    const targetT = this.bgProgressFromRatio(ratio);
    const proxy = { t: this.bgProgress };
    this.tweens.add({
      targets: proxy,
      t: targetT,
      duration: 600,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.bgProgress = proxy.t;
        const c = lerpColor(GAME.BG_COLOR_START, GAME.BG_COLOR_END, proxy.t);
        this.cameras.main.setBackgroundColor(c);
      },
    });
  }

  // 隙間幅/ボール直径 の比率 → 補間係数 t (0=START 色, 1=END 色)
  // 区分線形補間で 4つの breakpoint をつなぐ
  private bgProgressFromRatio(ratio: number): number {
    const r0 = GAME.BG_GAP_RATIO_START;
    const r1 = GAME.BG_GAP_RATIO_25;
    const r2 = GAME.BG_GAP_RATIO_50;
    const r3 = GAME.BG_GAP_RATIO_END;
    if (ratio >= r0) return 0;
    if (ratio >= r1) return ((r0 - ratio) / (r0 - r1)) * 0.25;
    if (ratio >= r2) return 0.25 + ((r1 - ratio) / (r1 - r2)) * 0.25;
    if (ratio >= r3) return 0.5 + ((r2 - ratio) / (r2 - r3)) * 0.5;
    return 1;
  }

  private spawnScorePopup(x: number, y: number, points: number, special: boolean, isAtEndColor = false) {
    // 終端色ボーナスは色とサイズで一段格上にする
    let fontSize: string;
    let color: string;
    if (isAtEndColor && special) {
      fontSize = '108px';
      color = '#ff70a0'; // ピンク寄りの赤紫: 究極ボーナス
    } else if (isAtEndColor) {
      fontSize = '88px';
      color = '#ff5040'; // 終端色っぽい赤
    } else if (special) {
      fontSize = '88px';
      color = '#ffd700'; // PERFECT 金
    } else {
      fontSize = '64px';
      color = '#ffeb70'; // 通常 黄
    }
    const text = this.add.text(x, y, `+${points}`, {
      fontFamily: FONT_FAMILY,
      fontSize,
      color,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(950);
    this.tweens.add({
      targets: text,
      y: y - GAME.SCORE_POPUP_RISE_PX,
      alpha: 0,
      duration: GAME.SCORE_POPUP_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  // ニアミス: ボール位置を画面上で固定したまま、その点を中心にズームイン→保持→ズームアウト
  private triggerNearMiss(focusX: number, focusY: number, pan: number) {
    playNearMiss(pan);
    vibrate([0, 25, 30, 60]);

    // CLOSE! テキスト（凍結中も見えるよう即座に表示状態で生成）。ボーナス点も併記
    const label = GAME.NEAR_MISS_BONUS > 0 ? `CLOSE!  +${GAME.NEAR_MISS_BONUS}` : 'CLOSE!';
    this.nmText = this.add.text(focusX, focusY - 70, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '40px',
      color: '#70d6ff',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(958).setAlpha(1).setScale(1);

    // ズームの中心（ピボット）= ボールの現在位置。ここが画面上で動かない
    this.nmPivotX = this.ball.x;
    this.nmPivotY = this.ball.y;
    this.nmElapsed = 0;
    this.nmActive = true;

    // 世界を停止（カメラズームだけ update で動かす）
    this.frozen = true;
    this.physics.world.pause();
    this.tweens.pauseAll();
  }

  // 毎フレーム呼ばれ、ピボットを画面上で固定したままズーム倍率を時間で変化させる
  private updateNearMissZoom(delta: number) {
    this.nmElapsed += delta;
    const IN = GAME.NEAR_MISS_ZOOM_IN_MS;
    const HOLD = GAME.NEAR_MISS_HOLD_MS;
    const OUT = GAME.NEAR_MISS_ZOOM_OUT_MS;
    const Z = GAME.NEAR_MISS_ZOOM;
    const t = this.nmElapsed;

    let z: number;
    if (t < IN) {
      const p = t / IN;
      z = 1 + (Z - 1) * (1 - (1 - p) * (1 - p)); // easeOut
    } else if (t < IN + HOLD) {
      z = Z;
    } else if (t < IN + HOLD + OUT) {
      const p = (t - IN - HOLD) / OUT;
      z = Z + (1 - Z) * (p * p); // easeIn で 1 へ
    } else {
      this.applyPivotZoom(1);
      this.endNearMiss();
      return;
    }
    this.applyPivotZoom(z);
  }

  // ピボット (nmPivotX/Y) の画面位置を保ったままズーム倍率 z を適用
  // 導出: screen = (world - scroll - mid) * z + mid を pivot で固定すると
  //       scroll = (pivot - mid) * (1 - 1/z)
  private applyPivotZoom(z: number) {
    const cam = this.cameras.main;
    cam.setZoom(z);
    const sx = (this.nmPivotX - GAME.WIDTH / 2) * (1 - 1 / z);
    const sy = (this.nmPivotY - GAME.HEIGHT / 2) * (1 - 1 / z);
    cam.setScroll(sx, sy);
  }

  private endNearMiss() {
    this.nmActive = false;
    this.frozen = false;
    const cam = this.cameras.main;
    cam.setZoom(1);
    cam.setScroll(0, 0);
    this.physics.world.resume();
    this.tweens.resumeAll();
    if (this.nmText) {
      const text = this.nmText;
      this.nmText = null;
      this.tweens.add({
        targets: text,
        alpha: 0,
        scale: 1.3,
        duration: 220,
        ease: 'Quad.easeIn',
        onComplete: () => text.destroy(),
      });
    }
  }

  // 自己ベスト超え演出（1プレイ1回。以後スコアHUDが金色のままになる）
  private triggerBestBeaten() {
    this.bestBeaten = true;
    playBestBeaten();
    vibrate([0, 30, 30, 60]);
    this.scoreText.setColor('#ffd700');

    const text = this.add.text(GAME.WIDTH / 2, 195, 'NEW BEST!', {
      fontFamily: FONT_FAMILY,
      fontSize: '44px',
      color: '#ffd700',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(955).setAlpha(0).setScale(0.5);
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.1, duration: 220, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 120, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.15, duration: 500, delay: 900, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  // マイルストーン到達演出（prev→now でしきい値を跨いだら発動）
  private checkMilestones(prevScore: number, nowScore: number) {
    let reached: number | null = null;
    while (
      this.nextMilestoneIdx < GAME.MILESTONES.length &&
      nowScore >= GAME.MILESTONES[this.nextMilestoneIdx]
    ) {
      reached = GAME.MILESTONES[this.nextMilestoneIdx];
      this.nextMilestoneIdx += 1;
    }
    if (reached !== null && prevScore < reached) {
      this.triggerMilestone(reached);
    }
  }

  private triggerMilestone(value: number) {
    playMilestone();
    vibrate([0, 50, 40, 50, 40, 80]);
    // 画面全体の彩度フラッシュ（淡い金色）
    const flash = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, 0xffe070, 0.25,
    ).setDepth(990);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 400, ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
    // 上部（スコアHUDの上）に配置。数字を上、その下に "MILESTONE"
    const valueY = 250;
    const labelY = 360;
    const text = this.add.text(GAME.WIDTH / 2, valueY, `${value}`, {
      fontFamily: FONT_FAMILY,
      fontSize: '150px',
      color: '#ffe070',
      fontStyle: '800',
      padding: { top: 10, bottom: 8 },
    }).setOrigin(0.5).setDepth(992).setAlpha(0).setScale(0.3);
    const sub = this.add.text(GAME.WIDTH / 2, labelY, 'MILESTONE', {
      fontFamily: FONT_FAMILY,
      fontSize: '46px',
      color: '#ffffff',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(992).setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 200, yoyo: true, hold: GAME.MILESTONE_TEXT_MS - 600, onComplete: () => sub.destroy() });
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.15, duration: 250, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 150, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.3, duration: GAME.MILESTONE_TEXT_MS - 400, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  private spawnPerfectText(streak: number) {
    const label = streak > 1 ? `PERFECT!×${streak}` : 'PERFECT!';
    const text = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 80, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '88px',
      color: '#ffd700',
      fontStyle: '800',
      padding: { top: 8, bottom: 6 },
    }).setOrigin(0.5).setDepth(960).setAlpha(0).setScale(0.4);
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.2, duration: 180, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 120, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.4, duration: GAME.PERFECT_TEXT_DURATION_MS - 300, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  private emitBounceBurst(x: number, y: number) {
    const n = Math.max(1, Math.round(GAME.BOUNCE_PARTICLE_COUNT * getQuality().particleScale));
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7;
      const speed = Phaser.Math.FloatBetween(
        GAME.BOUNCE_PARTICLE_SPEED_MIN,
        GAME.BOUNCE_PARTICLE_SPEED_MAX,
      );
      const size = Phaser.Math.Between(2, 4);
      const p = this.add.circle(x, y, size, this.ball.fillColor)
        .setDepth(850)
        .setAlpha(0.9);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.45,
        y: y + Math.sin(angle) * speed * 0.45,
        alpha: 0,
        scale: 0.3,
        duration: GAME.BOUNCE_PARTICLE_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private emitBurst(x: number, y: number, count: number) {
    const n = Math.max(1, Math.round(count * getQuality().particleScale));
    for (let i = 0; i < n; i++) {
      const baseAngle = (i / n) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.6;
      const speed = Phaser.Math.FloatBetween(GAME.PARTICLE_SPEED_MIN, GAME.PARTICLE_SPEED_MAX);
      const size = Phaser.Math.Between(3, 6);
      const p = this.add.circle(x, y, size, GAME.BALL_COLOR).setDepth(900);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.7,
        y: y + Math.sin(angle) * speed * 0.7,
        alpha: 0,
        scale: 0.2,
        duration: GAME.PARTICLE_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    // タイムダイレーションが残っていたら通常速度へ戻す
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    if (this.physics.world) this.physics.world.timeScale = 1;
    this.frozen = false;
    this.nmActive = false;
    if (this.nmText) { this.nmText.destroy(); this.nmText = null; }
    this.physics.world.resume(); // 万一フリーズ中なら解除
    this.cameras.main.setZoom(1); // ニアミスズームが残っていたら戻す
    this.cameras.main.setScroll(0, 0);

    this.stopWarning();
    this.dismissGuide();
    muteFallSound();
    tapeStopMusic(); // BGMはピッチが落ちながら止まる（テープストップ）
    const body = this.ball.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.setVelocity(0, 0);
      body.enable = false;
    }

    try {
      const prevBest = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
      if (this.score > prevBest) {
        localStorage.setItem(STORAGE_KEYS.HIGH_SCORE, this.score.toString());
      }
      const playCount = Number(localStorage.getItem(STORAGE_KEYS.PLAY_COUNT) ?? 0) + 1;
      localStorage.setItem(STORAGE_KEYS.PLAY_COUNT, playCount.toString());
    } catch {
      // localStorage may be unavailable (private mode, etc.) — skip persistence
    }

    // --- 死の演出 ---
    // 1) ボールが破裂して飛び散る
    this.explodeBall();

    // 2) 背景の彩度が抜ける（暗幕をかぶせて世界から色味を奪う）
    const desat = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT,
      0x0a0a12, GAME.DEATH_DESAT_ALPHA,
    ).setDepth(940).setAlpha(0);
    this.tweens.add({
      targets: desat, alpha: 1, duration: 450, ease: 'Quad.easeOut',
    });

    // 3) なぜ死んだかの比較表示: 隙間の位置にボール直径のゴーストを重ねて
    //    「ボールが隙間より大きい」ことを見せる（サイズ起因の死のみ）
    if (this.ballDiameter > this.gapWidth) {
      const ghost = this.add.circle(
        this.gapCenterX, GAME.LINE_Y, this.ballDiameter / 2, 0xff4830, 0.28,
      ).setStrokeStyle(3, 0xff7060, 0.9).setDepth(945).setAlpha(0);
      // ラベル全幅（約360px）が画面内に収まるよう中央へ寄せる
      const labelX = Phaser.Math.Clamp(this.gapCenterX, 200, GAME.WIDTH - 200);
      const label = this.add.text(
        labelX, GAME.LINE_Y - this.ballDiameter / 2 - 64,
        `BALL ${Math.round(this.ballDiameter)}  >  GAP ${Math.round(this.gapWidth)}`,
        {
          fontFamily: FONT_FAMILY,
          fontSize: '36px',
          color: '#ff9080',
          fontStyle: 'bold',
          padding: { top: 6, bottom: 4 },
        },
      ).setOrigin(0.5).setDepth(946).setAlpha(0);
      this.tweens.add({
        targets: [ghost, label], alpha: 1, duration: 350, delay: 250, ease: 'Quad.easeOut',
      });
    }

    // 4) 一瞬のスローモーション（破裂・暗転の tween をゆっくり見せ、実時間で復帰）
    this.tweens.timeScale = GAME.DEATH_SLOWMO_SCALE;
    window.setTimeout(() => {
      if (this.scene.isActive()) this.tweens.timeScale = 1;
    }, GAME.DEATH_SLOWMO_MS);

    this.cameras.main.shake(GAME.SHAKE_GAMEOVER_DURATION_MS, GAME.SHAKE_GAMEOVER_INTENSITY);
    playGameOver();
    vibrate([0, 60, 30, 120]);

    this.time.delayedCall(GAME.DEATH_RESULT_DELAY_MS, () => {
      this.scene.start('Result', {
        score: this.score,
        perfects: this.perfectCount,
        maxStreak: this.maxPerfectStreak,
        closes: this.nearMissCount,
      });
    });
  }

  // ボールの破裂: 本体を隠し、ボール色の破片を放射状に飛ばす（少し落下感を付ける）
  private explodeBall() {
    const x = this.ball.x;
    const y = this.ball.y;
    const color = this.ball.fillColor;
    this.tweens.killTweensOf(this.ball);
    this.ball.setVisible(false);
    this.ballHighlight.setVisible(false);

    const n = Math.max(8, Math.round(GAME.DEATH_PARTICLE_COUNT * getQuality().particleScale));
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const speed = Phaser.Math.FloatBetween(
        GAME.DEATH_PARTICLE_SPEED_MIN,
        GAME.DEATH_PARTICLE_SPEED_MAX,
      );
      const size = Phaser.Math.Between(3, 8);
      const c = Math.random() < 0.25 ? 0xffffff : color;
      const p = this.add.circle(x, y, size, c).setDepth(900);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.6,
        y: y + Math.sin(angle) * speed * 0.6 + 60,
        alpha: 0,
        scale: 0.2,
        duration: GAME.DEATH_PARTICLE_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }
}
