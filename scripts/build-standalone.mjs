#!/usr/bin/env node
/**
 * 打包成「一个 HTML 文件」：把 CSS / JS / 快照全部内联，方便直接上传或离线演示。
 * 用法：node scripts/build-standalone.mjs
 * 产物：dist/commute-oracle.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

// 内联样式
html = html.replace(
  /<link rel="stylesheet" href="assets\/css\/app\.css">/,
  '<style>\n' + read('assets/css/app.css') + '\n</style>'
);

// 按顺序内联脚本
html = html.replace(/<script src="(assets\/js\/[^"]+)"><\/script>/g, (_, src) =>
  '<script>\n/* ' + src + ' */\n' + read(src) + '\n</script>'
);

html = html.replace('<head>', '<head>\n<!-- 单文件构建：由 scripts/build-standalone.mjs 生成；高德 JS API 仍从 CDN 加载 -->');

const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'commute-oracle.html');
fs.writeFileSync(file, html);

const kb = (fs.statSync(file).size / 1024).toFixed(0);
console.log('已生成 dist/commute-oracle.html (' + kb + ' KB)');
