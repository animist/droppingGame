import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { FONT_FAMILY } from '../config/ui';
import { enableTilt } from '../input/tilt';
import { unlockAudio } from '../audio/sfx';
import { addBackgroundShade } from '../util/bgShade';
import { setDebugMode } from '../config/debug';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;

    // タイトルに入るたびにデバッグモードは解除（通常プレイから始める）
    setDebugMode(false);

    addBackgroundShade(this, -3);
    this.createDemoBall();

    // 背景。タップ受付は canvas のネイティブリスナー側で行う（iOS許可要求のジェスチャ維持のため）
    this.add.rectangle(cx, cy, GAME.WIDTH, GAME.HEIGHT).setDepth(-2);

    const title = this.add.text(cx, cy - 240, 'DROPPING', {
      fontFamily: FONT_FAMILY,
      fontSize: '110px',
      color: '#aaaaff',
      fontStyle: '800',
    }).setOrigin(0.5);

    // 隠しデバッグ起動用: タイトルロゴが何回タップされたかを表示する小さなインジケータ
    const debugHint = this.add.text(cx, cy - 160, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: '#ff6b6b',
    }).setOrigin(0.5).setAlpha(0.7);

    const highScore = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
    this.add.text(cx, cy - 20, `BEST  ${highScore}`, {
      fontFamily: FONT_FAMILY,
      fontSize: '48px',
      color: '#ffeb70',
    }).setOrigin(0.5);

    /*
    this.add.text(cx, cy + 100, '端末を傾ける / 横スワイプで操作', {
      fontSize: '30px',
      color: '#cccccc',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5);
    */

    const tapBtn = this.add.text(cx, cy + 240, 'TAP TO START', {
      fontFamily: FONT_FAMILY,
      fontSize: '56px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: tapBtn,
      alpha: 0.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    // iOS の DeviceOrientationEvent.requestPermission() は「タップのネイティブ
    // イベントハンドラ内で同期的に呼ぶ」ことが必須。Phaser の pointer イベントは
    // 次フレームで処理されジェスチャ文脈(transient activation)が外れて拒否される
    // ため、canvas に直接ネイティブリスナーを張って enableTilt() を同期呼び出しする。
    const canvas = this.game.canvas;
    let started = false;
    let debugTaps = 0;
    let lastTapTs = -1;
    const onTap = (ev: Event) => {
      if (started) return;
      // pointerup と touchend が同一タップで二重発火するのを間引く
      if (ev.timeStamp - lastTapTs < 60) return;
      lastTapTs = ev.timeStamp;

      // 隠しデバッグ: タイトルロゴを規定回数タップで debug ON。
      // タッチ座標をゲーム座標へ変換し、ロゴ矩形内なら「開始せず」カウントする。
      const p = ev as PointerEvent;
      const t = ev as TouchEvent;
      const cx2 = p.clientX !== undefined ? p.clientX : t.changedTouches?.[0]?.clientX;
      const cy2 = p.clientX !== undefined ? p.clientY : t.changedTouches?.[0]?.clientY;
      if (cx2 !== undefined && cy2 !== undefined) {
        const rect = canvas.getBoundingClientRect();
        const gx = ((cx2 - rect.left) / rect.width) * GAME.WIDTH;
        const gy = ((cy2 - rect.top) / rect.height) * GAME.HEIGHT;
        if (Phaser.Geom.Rectangle.Contains(title.getBounds(), gx, gy)) {
          debugTaps += 1;
          if (debugTaps < GAME.DEBUG_TAP_COUNT) {
            // あと少しになったら残りタップ数をうっすら表示（誤爆時は何も起きない）
            if (debugTaps >= GAME.DEBUG_TAP_COUNT - 4) {
              debugHint.setText(`DEBUG… ${GAME.DEBUG_TAP_COUNT - debugTaps}`);
            }
            return; // ロゴ連打中はゲーム開始しない
          }
          setDebugMode(true);
          debugHint.setText('DEBUG MODE');
        }
      }

      started = true;
      canvas.removeEventListener('pointerup', onTap);
      canvas.removeEventListener('touchend', onTap);
      unlockAudio();
      // ここは必ずネイティブイベントのコールスタック内なので許可ダイアログが出る
      enableTilt().finally(() => {
        this.scene.start('Game');
      });
    };
    // pointerup と touchend の両方を張り、最初の発火でどちらも解除して二重起動を防ぐ
    canvas.addEventListener('pointerup', onTap);
    canvas.addEventListener('touchend', onTap);
    // タップ前にシーンが終了した場合のリスナー後始末
    this.events.once('shutdown', () => {
      canvas.removeEventListener('pointerup', onTap);
      canvas.removeEventListener('touchend', onTap);
    });
  }

  private createDemoBall() {
    const ball = this.add.circle(
      GAME.WIDTH * 0.7, 150, 28, GAME.BALL_COLOR_START,
    ).setAlpha(0.18).setDepth(-1);

    this.tweens.add({
      targets: ball,
      y: GAME.HEIGHT - 180,
      duration: 950,
      yoyo: true,
      repeat: -1,
      ease: 'Quad.easeIn',
    });

    this.tweens.add({
      targets: ball,
      x: GAME.WIDTH * 0.3,
      duration: 3200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}
