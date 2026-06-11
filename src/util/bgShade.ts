import Phaser from 'phaser';
import { GAME } from '../config/balance';

// 背景に奥行きを出す共通シェード（縦グラデーション + 四隅ビネット）。
// テクスチャは初回に一度だけ低解像度Canvasで生成し、全シーンで使い回す
// （グラデーションなので拡大してもボケが目立たない）。
const KEY = 'bg-shade';
const TEX_W = 180;
const TEX_H = 320;

export function addBackgroundShade(scene: Phaser.Scene, depth = -9) {
  if (!scene.textures.exists(KEY)) {
    const canvas = scene.textures.createCanvas(KEY, TEX_W, TEX_H);
    if (!canvas) return null; // Canvas生成不可の環境ではシェードなしで続行
    const ctx = canvas.getContext();

    // 縦グラデ: 上端をほんのり明るく、下端に向かって暗く沈める
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.4, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // ビネット: 中心から四隅へ向かって暗く
    const vig = ctx.createRadialGradient(
      TEX_W / 2, TEX_H / 2, TEX_H * 0.32,
      TEX_W / 2, TEX_H / 2, TEX_H * 0.72,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    canvas.refresh();
  }

  return scene.add.image(GAME.WIDTH / 2, GAME.HEIGHT / 2, KEY)
    .setDisplaySize(GAME.WIDTH, GAME.HEIGHT)
    .setDepth(depth);
}

// 危険警告用の赤ビネット（画面周辺だけ赤く染まる）。alpha 0 で常駐させ、
// 警告中に GameScene 側で脈動させる。
const WARN_KEY = 'warn-vignette';

export function addWarningVignette(scene: Phaser.Scene, depth = 930) {
  if (!scene.textures.exists(WARN_KEY)) {
    const canvas = scene.textures.createCanvas(WARN_KEY, TEX_W, TEX_H);
    if (!canvas) return null;
    const ctx = canvas.getContext();
    const vig = ctx.createRadialGradient(
      TEX_W / 2, TEX_H / 2, TEX_H * 0.30,
      TEX_W / 2, TEX_H / 2, TEX_H * 0.70,
    );
    vig.addColorStop(0, 'rgba(255,40,30,0)');
    vig.addColorStop(1, 'rgba(255,40,30,0.6)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    canvas.refresh();
  }

  return scene.add.image(GAME.WIDTH / 2, GAME.HEIGHT / 2, WARN_KEY)
    .setDisplaySize(GAME.WIDTH, GAME.HEIGHT)
    .setDepth(depth)
    .setAlpha(0);
}
