import Phaser from 'phaser';
import { GAME } from '../config/balance';
import { FONT_FAMILY } from '../config/ui';
import {
  unlockAudio,
  playGameOver,
  playGameOverA,
  playGameOverB,
  playGameOverC,
  playGameOverD,
  playGameOverE,
  playResultMelody,
} from '../audio/sfx';

type Candidate = { label: string; play: () => void };

export class SoundTestScene extends Phaser.Scene {
  constructor() {
    super('SoundTest');
  }

  create() {
    const cx = GAME.WIDTH / 2;

    this.cameras.main.setBackgroundColor(0x1a1a2e);

    this.add.text(cx, 90, 'SOUND TEST', {
      fontFamily: FONT_FAMILY,
      fontSize: '64px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, 170, 'GAME OVER 候補', {
      fontFamily: FONT_FAMILY,
      fontSize: '32px',
      color: '#aaaaff',
    }).setOrigin(0.5);

    const candidates: Candidate[] = [
      { label: 'A: 8bit 死亡風',         play: playGameOverA },
      { label: 'B: マイナーアルペジオ',  play: playGameOverB },
      { label: 'C: ワーン下降グリス',    play: playGameOverC },
      { label: 'D: 重低音の鐘',          play: playGameOverD },
      { label: 'E: 不協和2音重ね',       play: playGameOverE },
      { label: '現: GAME OVER (C×3)', play: playGameOver },
      { label: '現: RESULT (A→B)',     play: playResultMelody },
    ];

    let y = 290;
    for (const c of candidates) {
      const btn = this.add.text(cx, y, c.label, {
        fontFamily: FONT_FAMILY,
        fontSize: '40px',
        color: '#ffffff',
        backgroundColor: '#2a2a4a',
        padding: { left: 28, right: 28, top: 14, bottom: 14 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        unlockAudio();
        c.play();
        // 押下フィードバック
        this.tweens.killTweensOf(btn);
        btn.setScale(1.06);
        this.tweens.add({
          targets: btn,
          scale: 1,
          duration: 180,
          ease: 'Quad.easeOut',
        });
      });

      y += 100;
    }

    const backBtn = this.add.text(cx, GAME.HEIGHT - 100, '← TITLE に戻る', {
      fontFamily: FONT_FAMILY,
      fontSize: '36px',
      color: '#cccccc',
      backgroundColor: '#3a3a4a',
      padding: { left: 24, right: 24, top: 10, bottom: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      this.scene.start('Title');
    });
  }
}
