#!/usr/bin/env node
/**
 * 生成构建期快照：直接调用高德 Web 服务 API，把原始返回落到
 *   assets/js/snapshot.js        （页面降级时用，file:// 也能加载）
 *   data/fallback-snapshot.json  （留档，方便评委核对真实返回）
 *
 * 用法：node scripts/snapshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
new Function('window', fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8'))(win);
const CFG = win.APP_CONFIG;
const KEY = process.env.AMAP_KEY || CFG.amapKey;

async function get(pathname, params, name) {
  const url = new URL(CFG.api.base + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', KEY);
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': 'commute-oracle/1.0' } });
  const json = await res.json();
  if (String(json.status) !== '1') {
    throw new Error(`${name} 失败: ${json.info || json.infocode}`);
  }
  console.log(`  ✓ ${name}  ${Date.now() - t0}ms`);
  return json;
}

const s = CFG.scenario;
const origin = s.home.coord.join(',');
const dest = s.work.coord.join(',');

console.log('采集高德真实数据…');
const [home, work] = await Promise.all([
  get(CFG.api.weather, { city: s.home.adcode, extensions: 'all' }, '天气·家'),
  get(CFG.api.weather, { city: s.work.adcode, extensions: 'all' }, '天气·公司')
]);

const mid = [(s.home.coord[0] + s.work.coord[0]) / 2, (s.home.coord[1] + s.work.coord[1]) / 2];
const corridor = [
  { name: '家', coord: s.home.coord, radius: 2200 },
  { name: '走廊', coord: mid, radius: 3000 },
  { name: '公司', coord: s.work.coord, radius: 2000 }
];
const traffic = [];
for (const p of corridor) {
  try {
    traffic.push(await get(CFG.api.trafficCircle, {
      location: p.coord.join(','), radius: p.radius, extensions: 'base', level: 6
    }, '路况·' + p.name));
  } catch (e) {
    console.warn(`  ! 路况·${p.name} 跳过：${e.message}`);
    traffic.push(null);
  }
}

const driving = await get(CFG.api.driving, {
  origin, destination: dest, strategy: 32, alternative_route: 2,
  show_fields: 'cost,tmcs,navi,polyline'
}, '驾车路径规划');

const transit = await get(CFG.api.transit, {
  origin, destination: dest, city1: s.citycode, city2: s.citycode,
  show_fields: 'cost,polyline'
}, '公交路径规划');

const snapshot = {
  generatedAt: new Date().toISOString(),
  scenario: { home: s.home, work: s.work },
  weather: { home, work },
  traffic,
  driving,
  transit
};

const jsonPath = path.join(root, 'data/fallback-snapshot.json');
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));

const jsPath = path.join(root, 'assets/js/snapshot.js');
fs.writeFileSync(jsPath,
  '/* 由 scripts/snapshot.mjs 生成，数据来自高德开放平台 Web 服务 API */\n' +
  'window.FALLBACK_SNAPSHOT = ' + JSON.stringify(snapshot) + ';\n'
);

console.log('已写入:');
console.log('  ' + path.relative(root, jsonPath));
console.log('  ' + path.relative(root, jsPath));
