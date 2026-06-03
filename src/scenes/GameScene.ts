import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { tilt } from '../input/tilt';
import { playBounce, playWall, playPass, playGameOver, playPerfectPass, playNearMiss, playMilestone, updateFallSound, muteFallSound } from '../audio/sfx';
import { startMusic, stopMusic, setMusicIntensity, intensityFromScore } from '../audio/music';
import { vibrate } from '../input/haptics';
import { lerpColor, brighten } from '../util/color';

export class GameScene extends Phaser.Scene {
  private ball!: Phaser.GameObjects.Arc;
  private leftLine!: Phaser.GameObjects.Rectangle;
  private rightLine!: Phaser.GameObjects.Rectangle;

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
  private warningActive = false;
  private warningTween: Phaser.Tweens.Tween | null = null;
  private bounceCount = 0;
  private perfectStreak = 0;
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
    this.warningActive = false;
    this.bounceCount = 0;
    this.perfectStreak = 0;
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

    this.scoreText = this.add.text(GAME.WIDTH / 2, 100, '0', {
      fontSize: '120px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5);

    this.physics.world.setBoundsCollision(true, true, false, false);
    this.createBall();
    this.randomizeGapCenter();
    this.createLines();
    this.updateBallColor(); // 初期の穴比率に応じた色を反映

    // BGM 開始
    this.musicIntensity = 0;
    setMusicIntensity(0);
    startMusic();
    this.events.once('shutdown', () => stopMusic());
    this.setupInput();
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
    this.ballGlow = this.addGlow(this.ball, GAME.GLOW_BALL_BASE, brighten(GAME.BALL_COLOR_START, GAME.GLOW_BALL_BRIGHTEN));
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
  private addGlow(obj: Phaser.GameObjects.Shape, strength: number, color?: number): Phaser.FX.Glow | null {
    try {
      const fx = obj.postFX;
      if (!fx) return null;
      return fx.addGlow(color, strength, 0, false, 0.1, 16);
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

    // 新ラインのグロー参照を保持（呼吸アニメ用、古い参照は破棄）
    this.lineGlows = [];
    const gl = this.addGlow(this.leftLine, GAME.GLOW_LINE);
    const gr = this.addGlow(this.rightLine, GAME.GLOW_LINE);
    if (gl) this.lineGlows.push(gl);
    if (gr) this.lineGlows.push(gr);

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

    this.trailTimer += delta;
    if (this.trailTimer >= GAME.TRAIL_INTERVAL_MS) {
      this.trailTimer = 0;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > GAME.TRAIL_MIN_SPEED) {
        this.spawnTrailDot();
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

    const isNearMiss = clearance <= GAME.NEAR_MISS_CLEARANCE_PX;
    const isPerfect = this.bounceCount === 0;
    // ボール色の進行度 t (0=初期色、1=完全に終端色) が閾値以上で終端色ボーナス発動
    const isAtEndColor = this.ballColorT() >= GAME.END_COLOR_BONUS_THRESHOLD;

    // 連続パーフェクトの計数を先に更新（コンボボーナスの算出で使う）
    if (isPerfect) {
      this.perfectStreak += 1;
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

    const oldLeft = this.leftLine;
    const oldRight = this.rightLine;

    this.tweens.add({
      targets: [oldLeft, oldRight],
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        oldLeft.destroy();
        oldRight.destroy();
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
        this.tweens.add({
          targets: [this.leftLine, this.rightLine],
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
      targets: [this.leftLine, this.rightLine],
      alpha: 0.35,
      duration: GAME.WARNING_PULSE_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.leftLine.setFillStyle(0xff4830);
    this.rightLine.setFillStyle(0xff4830);
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
      fontSize: '150px',
      color: '#ffe070',
      fontStyle: 'bold',
      padding: { top: 10, bottom: 8 },
    }).setOrigin(0.5).setDepth(992).setAlpha(0).setScale(0.3);
    const sub = this.add.text(GAME.WIDTH / 2, labelY, 'MILESTONE', {
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
      fontSize: '88px',
      color: '#ffd700',
      fontStyle: 'bold',
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
    for (let i = 0; i < GAME.BOUNCE_PARTICLE_COUNT; i++) {
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
    for (let i = 0; i < count; i++) {
      const baseAngle = (i / count) * Math.PI * 2;
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
    muteFallSound();
    stopMusic();
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

    this.cameras.main.shake(GAME.SHAKE_GAMEOVER_DURATION_MS, GAME.SHAKE_GAMEOVER_INTENSITY);
    playGameOver();
    vibrate([0, 60, 30, 120]);

    this.time.delayedCall(700, () => {
      this.scene.start('Result', { score: this.score });
    });
  }
}
