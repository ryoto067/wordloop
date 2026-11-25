// public/icons/icon.svg から PNG アイコンを書き出す: node scripts/make-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const dir = new URL("../public/icons/", import.meta.url);
const svg = await readFile(new URL("icon.svg", dir));
const BG = "#0b0b0d";

async function plain(size, name) {
  await writeFile(new URL(name, dir), await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer());
}

// maskable: 中央 80% の安全領域にマークを収め、周囲は背景色で埋める
async function maskable(size, name) {
  const inner = Math.round(size * 0.8);
  const mark = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  const out = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
  await writeFile(new URL(name, dir), out);
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await plain(180, "apple-touch-icon.png");
await maskable(512, "icon-maskable-512.png");
console.log("icons written");
