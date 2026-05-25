import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { enableTilt } from '../input/tilt';
import { unlockAudio } from '../audio/sfx';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;

    this.createDemoBall();

    // 全画面タップゾーン（SOUND TEST ボタン以外の領域がここで受け付けられる）
    const bgZone = this.add.rectangle(cx, cy, GAME.WIDTH, GAME.HEIGHT)
      .setInteractive()
      .setDepth(-2);

    this.add.text(cx, cy - 240, 'DROPPING', {
      fontSize: '110px',
      color: '#aaaaff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    const highScore = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
    this.add.text(cx, cy - 20, `BEST  ${highScore}`, {
      fontSize: '48px',
      color: '#ffeb70',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 100, '端末を傾ける / 横スワイプで操作', {
      fontSize: '30px',
      color: '#cccccc',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5);

    const tapBtn = this.add.text(cx, cy + 240, 'TAP TO START', {
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

    bgZone.on('pointerdown', () => {
      unlockAudio();
      enableTilt().finally(() => {
        this.scene.start('Game');
      });
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
