// favicon.svg から各サイズのラスター画像（PNG / ICO）を書き出すスクリプト。
//   node scripts/generate-icons.mjs
// 依存: sharp, png-to-ico（未導入なら `npm i -D sharp png-to-ico` か `--no-save` で）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

// ブラウザのタブ用（角丸・透明背景のまま）
const roundedSvg = readFileSync(join(publicDir, 'favicon.svg'));
// iOS / PWA 用（角丸を外し、暗色背景でフルブリードにする＝透明の角が出ない）
const squareSvg = Buffer.from(roundedSvg.toString().replace('rx="14"', 'rx="0"'));

const render = (svg, size) =>
  sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

// 1) favicon.ico（16/32/48 のマルチサイズ）
const icoPngs = await Promise.all([16, 32, 48].map((s) => render(roundedSvg, s)));
writeFileSync(join(publicDir, 'favicon.ico'), await pngToIco(icoPngs));

// 2) iOS ホーム画面用
writeFileSync(join(publicDir, 'apple-touch-icon.png'), await render(squareSvg, 180));

// 3) PWA マニフェスト用
writeFileSync(join(publicDir, 'icon-192.png'), await render(squareSvg, 192));
writeFileSync(join(publicDir, 'icon-512.png'), await render(squareSvg, 512));

console.log('Generated: favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png');
