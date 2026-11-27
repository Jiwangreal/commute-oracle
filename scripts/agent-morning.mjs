#!/usr/bin/env node
/**
 * Agent 侧「夜间巡航」示例：
 *   1) 优先调用 amap-gui（高德 CLI / Skill）做路线预演与地图视角设置
 *   2) 图形环境不可用时，自动回落到高德 Web 服务 API
 *   3) 汇总一份晨间简报，写入 data/morning-brief.json
 *
 * 用法：node scripts/agent-morning.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
new Function('window', fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8'))(win);
const CFG = win.APP_CONFIG;
const s = CFG.scenario;
const KEY = process.env.AMAP_KEY || CFG.amapKey;

const run = (cmd, args, timeout = 60000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err || '') });
  });
});

async function rest(pathname, params) {
  const url = new URL(CFG.api.base + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', KEY);
  const res = await fetch(url);
  const json = await res.json();
  if (String(json.status) !== '1') throw new Error(json.info || json.infocode);
  return json;
}

function parseGui(out) {
  try {
    const json = JSON.parse(out);
    return json && json.success ? json.data : null;
  } catch {
    return null;
  }
}

console.log('┌─ 通勤先知 · 夜间巡航 ─────────────────────────');
console.log('│ ' + new Date().toLocaleString('zh-CN'));
console.log('│ ' + s.home.name + '  →  ' + s.work.name);

let guiRoute = null;
let guiState = null;
const st = await run('amap-gui', ['status'], 15000);
const status = st.ok ? parseGui(st.out) : null;

if (status && status.status === 'running') {
  console.log('│ amap-gui: running (port ' + status.port + ')');
  const r = await run('amap-gui', [
    'route', '--from', s.home.name, '--to', s.work.name,
    '--type', 'driving', '--policy', 'fastest'
  ]);
  guiRoute = r.ok ? parseGui(r.out) : null;
  if (guiRoute) {
    console.log('│ CLI 预演: ' + (guiRoute.summary.distance / 1000).toFixed(1) + ' km / '
      + Math.round(guiRoute.summary.time / 60) + ' 分钟');
    await run('amap-gui', ['mapState', '--action', 'set',
      '--center', s.home.coord.join(','), '--zoom', '12', '--style', 'dark']);
    guiState = 'dark / zoom 12';
  }
} else {
  console.log('│ amap-gui: 未运行（无图形环境），回落 REST');
}

const [weatherHome, weatherLive, trafficMid, driving, transit] = await Promise.all([
  rest(CFG.api.weather, { city: s.home.adcode, extensions: 'all' }),
  rest(CFG.api.weather, { city: s.home.adcode, extensions: 'base' }),
  rest(CFG.api.trafficCircle, {
    location: [(s.home.coord[0] + s.work.coord[0]) / 2, (s.home.coord[1] + s.work.coord[1]) / 2].join(','),
    radius: 3000, extensions: 'base', level: 6
  }),
  rest(CFG.api.driving, {
    origin: s.home.coord.join(','), destination: s.work.coord.join(','),
    strategy: 32, alternative_route: 2, show_fields: 'cost,tmcs,navi'
  }),
  rest(CFG.api.transit, {
    origin: s.home.coord.join(','), destination: s.work.coord.join(','),
    city1: s.citycode, city2: s.citycode, show_fields: 'cost'
  })
]);

const live = weatherLive.lives?.[0];
const casts = weatherHome.forecasts?.[0]?.casts || [];
const path0 = driving.route.paths[0];
const tr = transit.route.transits?.[0];

const brief = {
  generatedAt: new Date().toISOString(),
  corridor: { from: s.home.name, to: s.work.name },
  gui: { used: !!(status && status.status === 'running'), route: guiRoute ? guiRoute.summary : null, mapState: guiState },
  weather: live ? { weather: live.weather, temperature: live.temperature, wind: live.winddirection + live.windpower } : null,
  forecast: casts.map((c) => ({ date: c.date, day: c.dayweather, high: c.daytemp, low: c.nighttemp })),
  traffic: trafficMid.trafficinfo?.evaluation || null,
  driving: {
    distance: Number(path0.distance),
    minutes: Math.round(Number(path0.cost.duration) / 60),
    alternatives: driving.route.paths.map((p) => ({
      distance: Number(p.distance),
      minutes: Math.round(Number(p.cost.duration) / 60)
    }))
  },
  transit: tr ? {
    minutes: Math.round(Number(tr.cost.duration) / 60),
    fee: tr.cost.transit_fee,
    line: tr.segments?.[0]?.bus?.buslines?.[0]?.name || ''
  } : null
};

console.log('│ 实况: ' + (brief.weather ? brief.weather.weather + ' ' + brief.weather.temperature + '°' : '—'));
console.log('│ 走廊: ' + (brief.traffic ? brief.traffic.description : '—'));
console.log('│ 驾车: ' + (brief.driving.distance / 1000).toFixed(1) + ' km / ' + brief.driving.minutes + ' 分钟'
  + '（备选 ' + (brief.driving.alternatives.length - 1) + ' 条）');
console.log('│ 地铁: ' + (brief.transit ? brief.transit.minutes + ' 分钟 / ¥' + brief.transit.fee : '—'));
console.log('└──────────────────────────────────────────────');

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/morning-brief.json'), JSON.stringify(brief, null, 2));
console.log('已写入 data/morning-brief.json');
