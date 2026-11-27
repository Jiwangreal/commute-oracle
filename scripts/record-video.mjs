#!/usr/bin/env node
/**
 * 录制 Motion 演示视频并合成旁白，输出 MP4。
 *
 * 依赖：
 *   - playwright-core + 本机 Chromium（默认取 ~/.cache/ms-playwright/chromium-1217）
 *   - ffmpeg（默认取 imageio-ffmpeg 的静态构建，可用 FFMPEG 覆盖）
 *   - video/narration/*.mp3 + video/timeline.json
 *
 * 用法：node scripts/record-video.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'video/timeline.json'), 'utf8'));

const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), '.cache/ms-playwright/chromium-1217/chrome-linux64/chrome');
const FFMPEG = process.env.FFMPEG
  || path.join(os.homedir(), '.local/lib/python3.8/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux64-v4.2.2');

for (const [name, p] of [['Chromium', CHROME], ['ffmpeg', FFMPEG]]) {
  if (!fs.existsSync(p)) {
    console.error(`找不到 ${name}: ${p}\n可以用环境变量 CHROME_PATH / FFMPEG 指定。`);
    process.exit(1);
  }
}

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exited ' + code))));
  });
}

const recDir = path.join(root, 'video/record');
fs.rmSync(recDir, { recursive: true, force: true });
fs.mkdirSync(recDir, { recursive: true });
const audioDir = path.join(root, 'video/audio');
fs.rmSync(audioDir, { recursive: true, force: true });
fs.mkdirSync(audioDir, { recursive: true });

const PORT = process.env.PORT || 8901;
const URL = `http://127.0.0.1:${PORT}/video/index.html`;

console.log('打开视频页…');
const t0 = Date.now();
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars']
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: recDir, size: { width: 1920, height: 1080 } }
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__startWall > 0, null, { timeout: 60000 });
const startWall = await page.evaluate(() => window.__startWall);
console.log('录制中，预计 ' + Math.round(timeline.total + 2) + ' 秒…');
await page.waitForFunction(() => window.__videoDone === true, null, { timeout: 300000 });
await page.waitForTimeout(800);
const videoPath = path.join(recDir, await (async () => {
  const p = await page.video().path();
  return path.basename(p);
})());
await context.close();
await browser.close();
console.log('录制完成: ' + videoPath);

/* ---------------- 构建旁白音轨 ---------------- */
const intro = Math.max(0, (startWall - t0) / 1000) + timeline.intro;
console.log('视频前导 ' + intro.toFixed(2) + 's，开始合成旁白…');

const list = [];
const silence = async (seconds, name) => {
  const f = path.join(audioDir, name + '.wav');
  await sh(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
    '-t', String(Math.max(0.01, seconds)), '-c:a', 'pcm_s16le', f]);
  return f;
};

list.push(await silence(intro, 'intro'));

for (let i = 0; i < timeline.scenes.length; i++) {
  const s = timeline.scenes[i];
  const clipWav = path.join(audioDir, s.audio + '.wav');
  await sh(FFMPEG, ['-y', '-i', path.join(root, 'video/narration', s.audio + '.mp3'),
    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clipWav]);
  list.push(await silence(timeline.lead, s.id + '-lead'));
  list.push(clipWav);
  const tail = s.duration - timeline.lead - s.audioDuration;
  list.push(await silence(tail, s.id + '-tail'));
}

const listFile = path.join(audioDir, 'list.txt');
fs.writeFileSync(listFile, list.map((f) => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'));
const narration = path.join(root, 'video/audio/narration.wav');
await sh(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', narration]);
console.log('旁白: ' + narration);

/* ---------------- 合成 MP4 ---------------- */
const outDir = path.join(root, 'delivery');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '02-演示视频-HappyDriver.mp4');
console.log('编码 MP4…');
await sh(FFMPEG, [
  '-y',
  '-i', videoPath,
  '-i', narration,
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-c:a', 'aac',
  '-b:a', '160k',
  '-movflags', '+faststart',
  '-shortest',
  out
]);

const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log('完成: ' + out + ' (' + size + ' MB)');
