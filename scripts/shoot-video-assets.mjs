#!/usr/bin/env node
/**
 * 重新截取视频用的产品图（默认南京通勤场景），输出到 video/assets/
 * 用法：node scripts/shoot-video-assets.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://127.0.0.1:8901/';
const CHROME = process.env.CHROME_PATH ||
  '/public/home/wangji1/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const out = (f) => path.join(root, 'video/assets', f);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function settle(p, ms = 12000) {
  await p.waitForFunction(() => window.__commute && window.__commute.state.days.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(ms);
}

// 1) 桌面：hero / week / map / 整页（晴天）
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(p);
  await (await p.$('#hero')).screenshot({ path: out('hero.png') });
  await (await p.$('.week')).screenshot({ path: out('week.png') });
  await (await p.$('.map-shell')).screenshot({ path: out('map.png') });
  await (await p.$('.why')).screenshot({ path: out('why.png') }).catch(() => {});

  // 注入暴雨 + 事故，模拟当天 07:30
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('[data-scenario="rain"]');
  await p.waitForTimeout(1500);
  await p.click('[data-scenario="crash"]');
  await p.waitForTimeout(3500);
  await p.evaluate(() => window.scrollTo(0, 0)); // 点按钮会滚动，截图前回到顶部
  await p.waitForTimeout(600);
  const info = await p.evaluate(() => {
    const d = window.__commute.state.days[window.__commute.state.selected];
    return { tag: document.querySelector('#heroTag').textContent, depart: d.depart, arrive: d.arrive, delta: d.deltaMin, dur: Math.round(d.durationMin), conf: Math.round(d.confidence * 100), risk: d.risk, notif: document.querySelector('#notifTitle').textContent + ' | ' + document.querySelector('#notifBody').textContent };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: out('app-storm.png') });
  await (await p.$('.map-shell')).screenshot({ path: out('map-storm.png') });
  await (await p.$('.why')).screenshot({ path: out('why-storm.png') }).catch(() => {});
  await (await p.$('#hero')).screenshot({ path: out('hero-storm.png') });
  await (await p.$('.console')).screenshot({ path: out('console.png') }).catch(() => {});
  await ctx.close();
}

// 2) 手机：地图（带路线）
{
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(p, 6000);
  // 手机图：注入事故 + 打开路况图层，让 TMC 红黄绿出现在画面里（演示注入已标注）
  await p.click('[data-scenario="crash"]').catch(() => {});
  await p.waitForTimeout(3000);
  await p.evaluate(() => {
    ['#notifWrap', '.map-card-float', '.topbar'].forEach((s) => {
      const el = document.querySelector(s); if (el) el.style.display = 'none';
    });
    const shell = document.querySelector('.map-shell'); shell.style.height = '900px';
    document.querySelector('#map').style.height = '900px';
    window.MapView.resize();
  });
  await p.waitForTimeout(1200); // 等 map.resize() 完成，否则 zoom 会被重置
  console.log('map view', await p.evaluate(() => {
    const m = window.MapView.getMap();
    const sc = window.__commute.state.scenario;
    const mid = [(sc.home.coord[0] + sc.work.coord[0]) / 2, (sc.home.coord[1] + sc.work.coord[1]) / 2];
    m.setZoomAndCenter(12.05, [mid[0], mid[1]]);
    const c = m.getCenter();
    return { zoom: m.getZoom(), center: [c.lng.toFixed(4), c.lat.toFixed(4)] };
  }));
  await p.waitForTimeout(3500);
  await (await p.$('.map-shell')).screenshot({ path: out('map-phone.png') });
  await ctx.close();
}

await browser.close();
console.log('已更新 video/assets/*.png');
