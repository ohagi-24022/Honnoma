// Compose the approved layout with immutable screenshots and crisp, editable text.
const fs = require('node:fs');
const path = require('node:path');
const runtime = '/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { createCanvas, loadImage, GlobalFonts } = require(path.join(runtime, '@napi-rs/canvas'));
const sharp = require(path.join(runtime, 'sharp'));

const fontDir = '/System/Library/Fonts';
function registerFont(weight, alias) {
  const name = fs.readdirSync(fontDir).find((name) => name.normalize('NFC') === `ヒラギノ角ゴシック ${weight}.ttc`);
  if (!name || !GlobalFonts.registerFromPath(path.join(fontDir, name), alias)) throw new Error(`Font unavailable: ${weight}`);
}
registerFont('W7', 'HonnomaBold');
registerFont('W3', 'HonnomaRegular');

const slides = [
  { file: '01-bookshelf.png', source: 'bookshelf.jpg', title: ['あなたの本棚を、', 'すっきり。'], subtitle: ['所持巻・抜け巻・読書状況を', 'まとめて管理。'] },
  { file: '02-scan.png', source: 'scan.jpg', title: ['バーコードで、', 'かんたん登録。'], subtitle: ['ISBNを読み取って、', '本棚に追加。'] },
  { file: '03-series.png', source: 'series.jpg', title: ['抜けている巻が、', 'ひと目で。'], subtitle: ['シリーズごとに所持巻と', '読書状況を確認。'] },
  { file: '04-wishlist.png', source: 'wishlist.jpg', title: ['次に買う一冊を、', '忘れない。'], subtitle: ['欲しい本を、', '優先度と一緒に整理。'] },
  { file: '05-book-detail.png', source: 'book-detail.jpg', title: ['一冊の情報を、', 'まとめて確認。'], subtitle: ['表紙・作者・出版社・', '紹介文を確認。'] },
  { file: '06-rankings.png', source: 'rankings.jpg', title: ['みんなの本棚から、', '次の一冊へ。'], subtitle: ['欲しい・所持のランキングで', '作品を見つける。'] },
];
const outDir = path.join(__dirname, 'iphone-6.9');
fs.mkdirSync(outDir, { recursive: true });
const blue = '#0783ff';
const width = 1290, height = 2796;

function roundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
}

(async () => {
  for (const slide of slides) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width / 2, 1900, 180, width / 2, 1900, 1700);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(1, '#f2f8ff');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = blue; roundedRect(ctx, 96, 70, 132, 12, 6);
    ctx.textBaseline = 'top';
    ctx.font = '46px HonnomaBold'; ctx.fillText('本の間', 96, 116);
    let titleSize = 124;
    do { ctx.font = `${titleSize}px HonnomaBold`; if (slide.title.every((s) => ctx.measureText(s).width <= 1098)) break; titleSize--; } while (titleSize > 90);
    ctx.fillStyle = '#101010';
    slide.title.forEach((line, i) => ctx.fillText(line, 96, 204 + i * 145));
    ctx.font = '51px HonnomaRegular'; ctx.fillStyle = '#5c6066';
    slide.subtitle.forEach((line, i) => {
      if (ctx.measureText(line).width > 1098) throw new Error(`Subtitle overflow: ${slide.file}`);
      ctx.fillText(line, 100, 494 + i * 64);
    });

    const screenshot = await loadImage(path.join(__dirname, 'sources', slide.source));
    const screenshotWidth = 970;
    const screenshotHeight = Math.round(screenshotWidth * screenshot.height / screenshot.width);
    const x = 160, y = 650;
    if (y + screenshotHeight > height - 40) throw new Error(`Screenshot overflow: ${slide.file}`);
    ctx.shadowColor = 'rgba(4,91,183,0.10)'; ctx.shadowBlur = 55; ctx.shadowOffsetY = 9;
    ctx.fillStyle = '#ffffff'; roundedRect(ctx, x - 18, y - 18, screenshotWidth + 36, screenshotHeight + 36, 58);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // Paste the entire real screenshot. No masking, invented UI, or content corrections.
    const reference = createCanvas(screenshotWidth, screenshotHeight);
    reference.getContext('2d').drawImage(screenshot, 0, 0, screenshotWidth, screenshotHeight);
    const referencePixels = reference.getContext('2d').getImageData(0, 0, screenshotWidth, screenshotHeight);
    ctx.putImageData(referencePixels, x, y);
    const actual = ctx.getImageData(x, y, screenshotWidth, screenshotHeight).data;
    const expected = referencePixels.data;
    if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(`Screenshot content changed: ${slide.file}`);
    await sharp(await canvas.encode('png')).removeAlpha().png().toFile(path.join(outDir, slide.file));
    const info = await sharp(path.join(outDir, slide.file)).metadata();
    if (info.width !== width || info.height !== height || info.hasAlpha) throw new Error(`Invalid output: ${slide.file}`);
    console.log(`${slide.file}: ${width}x${height}, RGB, screenshot verified`);
  }

  const preview = createCanvas(1530, 2330);
  const ctx = preview.getContext('2d');
  ctx.fillStyle = '#eaf0f7'; ctx.fillRect(0, 0, preview.width, preview.height);
  ctx.font = '23px HonnomaBold'; ctx.textBaseline = 'top';
  for (let i = 0; i < slides.length; i++) {
    const x = 30 + (i % 3) * 500, y = 25 + Math.floor(i / 3) * 1150;
    ctx.fillStyle = '#364152'; ctx.fillText(`${i + 1}. ${['本棚', 'スキャン', '巻の管理', '欲しい', '本の詳細', 'ランキング'][i]}`, x, y);
    ctx.drawImage(await loadImage(path.join(outDir, slides[i].file)), x, y + 42, 470, 470 * height / width);
  }
  await sharp(await preview.encode('png')).removeAlpha().png().toFile(path.join(__dirname, '6枚のプレビュー.png'));
})();
