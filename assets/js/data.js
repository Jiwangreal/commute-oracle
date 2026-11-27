/* HappyDriver — 高德开放平台数据层
 * 真实调用：天气、交通态势、驾车/公交路径规划、地理编码
 * 失败时回落到构建期快照（window.FALLBACK_SNAPSHOT）
 */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG;
  const U = global.U;
  const api = CFG.api;

  let logger = null;
  function setLogger(fn) { logger = fn; }

  function log(entry) {
    if (typeof logger === 'function') logger(entry);
  }

  async function request(path, params, name) {
    const url = new URL(api.base + path);
    Object.keys(params).forEach((k) => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        url.searchParams.set(k, params[k]);
      }
    });
    url.searchParams.set('key', CFG.amapKey);

    const t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const res = await fetch(url.toString(), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      const json = await res.json();
      const ms = Math.round(((global.performance && performance.now) ? performance.now() : Date.now()) - t0);
      const ok = String(json.status) === '1';
      log({ name, ok, ms, info: json.info || json.infocode || '', raw: json, api: path });
      if (!ok) throw new Error(name + ' 失败：' + (json.info || json.infocode || '未知错误'));
      return json;
    } catch (err) {
      const ms = Math.round(((global.performance && performance.now) ? performance.now() : Date.now()) - t0);
      log({ name, ok: false, ms, info: String(err.message || err), raw: null, api: path });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------- 天气 ---------- */
  async function fetchWeather(adcode) {
    return request(api.weather, { city: adcode, extensions: 'all' }, '天气 · ' + adcode);
  }

  function weatherDays(raw) {
    const out = [];
    const fc = raw && raw.forecasts && raw.forecasts[0];
    if (!fc) return out;
    fc.casts.forEach((c) => {
      out.push({
        key: c.date,
        day: c.dayweather,
        night: c.nightweather,
        high: Number(c.daytemp),
        low: Number(c.nighttemp),
        wind: c.daywind,
        power: c.daypower,
        source: 'forecast'
      });
    });
    return out;
  }

  function mergeWeather(homeRaw, workRaw) {
    const home = weatherDays(homeRaw);
    const work = weatherDays(workRaw);
    const byKey = {};
    const use = home.length ? home : work;
    use.forEach((d, i) => {
      const w = work[i] && work[i].key === d.key ? work[i] : d;
      // 取两地中更“差”的天气作为通勤影响（下雨/下雪优先）
      const pick = global.Predict.weatherFactor(w.day) > global.Predict.weatherFactor(d.day) ? w : d;
      byKey[d.key] = {
        key: d.key,
        day: pick.day,
        night: pick.night,
        high: Math.max(d.high, w.high),
        low: Math.min(d.low, w.low),
        wind: pick.wind,
        power: pick.power,
        source: 'forecast'
      };
    });

    // 预报只有 4 天，第 5–7 天做确定性外推，UI 明确标注
    const todayKey = U.dateKey(U.startOfDay(new Date()));
    const firstKey = Object.keys(byKey).sort()[0];
    if (firstKey && firstKey !== todayKey) {
      // 预报从明天开始（少数城市/时段），今天沿用第一天的值
      byKey[todayKey] = { ...byKey[firstKey], key: todayKey, source: 'forecast' };
    }
    const keys = Object.keys(byKey).sort();
    if (keys.length) {
      const last = byKey[keys[keys.length - 1]];
      const today = U.startOfDay(new Date());
      const cycle = ['多云', '晴', '阴', '多云', '晴'];
      for (let i = 4; i < 7; i++) {
        const d = U.addDays(today, i);
        const key = U.dateKey(d);
        if (byKey[key]) continue;
        byKey[key] = {
          key,
          day: cycle[i % cycle.length],
          night: '多云',
          high: Math.round(last.high + [0, 1, -1][i % 3]),
          low: Math.round(last.low + [0, 1, 0][i % 3]),
          wind: last.wind,
          power: last.power,
          source: 'extrapolated'
        };
      }
    }

    const fc0 = homeRaw && homeRaw.forecasts && homeRaw.forecasts[0];
    const c0 = fc0 && fc0.casts && fc0.casts[0];
    const live = (homeRaw && homeRaw.lives && homeRaw.lives[0]) || (c0 ? {
      weather: c0.dayweather,
      temperature: c0.daytemp,
      winddirection: c0.daywind,
      windpower: c0.daypower,
      reporttime: fc0.reporttime
    } : null);
    return { byKey, live: live || null };
  }

  /* ---------- 交通态势 ---------- */
  async function fetchTraffic(point) {
    return request(api.trafficCircle, {
      location: point.coord.join(','),
      radius: point.radius || 2000,
      extensions: 'base',
      level: 6
    }, '路况 · ' + point.name);
  }

  function trafficFactor(raws) {
    const pct = (v) => {
      const n = parseFloat(String(v == null ? '0' : v));
      return isFinite(n) ? n : 0;
    };
    const points = raws.map((r, i) => {
      const info = (r && r.trafficinfo) || {};
      const ev = info.evaluation || {};
      const congested = pct(ev.congested);
      const blocked = pct(ev.blocked);
      return {
        name: ['家', '走廊', '公司'][i] || ('点' + i),
        ratio: U.clamp((congested + blocked) / 100, 0, 1),
        status: ev.status || '0',
        statusText: ev.description || '未知',
        description: info.description || ''
      };
    });
    const ratio = points.reduce((s, p) => s + p.ratio, 0) / Math.max(1, points.length);
    const worst = points.slice().sort((a, b) => Number(b.status) - Number(a.status))[0] || points[0];
    const descs = Array.from(new Set(points.map((p) => p.description).filter(Boolean)));
    return {
      points,
      ratio,
      statusText: worst ? worst.statusText : '未知',
      description: descs.join('；')
    };
  }

  /* ---------- 路线 ---------- */
  function parsePolyline(v) {
    // 高德公交接口的 polyline 可能是字符串，也可能是 { polyline: '...' }
    const str = v && typeof v === 'object' ? (v.polyline || '') : (v || '');
    return String(str).split(';').filter(Boolean).map((s) => {
      const [lng, lat] = s.split(',').map(Number);
      return [lng, lat];
    }).filter((p) => isFinite(p[0]) && isFinite(p[1]));
  }

  function parsePath(p) {
    const segments = [];
    const path = [];
    (p.steps || []).forEach((step) => {
      const tmcs = step.tmcs || [];
      if (tmcs.length) {
        tmcs.forEach((tmc) => {
          const pts = String(tmc.tmc_polyline || '').split(';').filter(Boolean).map((s) => {
            const [lng, lat] = s.split(',').map(Number);
            return [lng, lat];
          });
          if (pts.length > 1) segments.push({ status: tmc.tmc_status || '未知', path: pts });
        });
      }
      const pts = parsePolyline(step.polyline);
      pts.forEach((pt) => path.push(pt));
    });
    return { segments, path };
  }

  function normalizeDriving(raw) {
    const paths = (raw.route && raw.route.paths) || [];
    return paths.map((p, i) => {
      const parsed = parsePath(p);
      const tmcs = [];
      (p.steps || []).forEach((s) => (s.tmcs || []).forEach((t) => tmcs.push(t)));
      const statusCount = {};
      tmcs.forEach((t) => { statusCount[t.tmc_status] = (statusCount[t.tmc_status] || 0) + 1; });
      return {
        id: i === 0 ? 'main' : 'alt' + i,
        index: i,
        name: i === 0 ? '最快路线' : (i === 1 ? '备选 · 少拥堵' : '备选 · 距离优先'),
        distance: Number(p.distance) || 0,
        durationMin: (Number(p.cost && p.cost.duration) || 0) / 60,
        lights: Number(p.cost && p.cost.traffic_lights) || 0,
        tolls: Number(p.cost && p.cost.tolls) || 0,
        restriction: Number(p.restriction) || 0,
        steps: (p.steps || []).length,
        segments: parsed.segments,
        path: parsed.path,
        statusCount,
        raw: p
      };
    });
  }

  function normalizeTransit(raw) {
    const tr = raw.route && raw.route.transits && raw.route.transits[0];
    if (!tr) return null;
    const lines = [];
    const path = [];
    (tr.segments || []).forEach((seg) => {
      if (seg.bus && seg.bus.buslines) {
        seg.bus.buslines.forEach((bl) => {
          const via = (bl.via_stops || []).map((s) => s.name);
          const pl = parsePolyline(bl.polyline);
          pl.forEach((pt) => path.push(pt));
          lines.push({
            type: bl.type,
            name: bl.name,
            from: bl.departure_stop && bl.departure_stop.name,
            to: bl.arrival_stop && bl.arrival_stop.name,
            via,
            durationMin: (Number(bl.cost && bl.cost.duration) || 0) / 60,
            polyline: pl
          });
        });
      }
      if (seg.walking && seg.walking.steps) {
        seg.walking.steps.forEach((st) => {
          parsePolyline(st.polyline).forEach((pt) => path.push(pt));
        });
      }
    });
    return {
      durationMin: (Number(tr.cost && tr.cost.duration) || 0) / 60,
      distance: Number(tr.distance) || 0,
      walkM: Number(tr.walking_distance) || 0,
      fee: Number(tr.cost && tr.cost.transit_fee) || 0,
      lines,
      path,
      down: false,
      raw: tr
    };
  }

  /* ---------- 汇总 ---------- */
  async function fetchAll(scenario) {
    const homeAd = scenario.home.adcode;
    const workAd = scenario.work.adcode;
    const origin = scenario.home.coord.join(',');
    const dest = scenario.work.coord.join(',');

    const [wHome, wWork] = await Promise.all([
      fetchWeather(homeAd),
      fetchWeather(workAd)
    ]);
    const weather = mergeWeather(wHome, wWork);

    // 走廊采样点：家 / 中点 / 公司（用户改地址后自动跟随）
    const mid = [
      (scenario.home.coord[0] + scenario.work.coord[0]) / 2,
      (scenario.home.coord[1] + scenario.work.coord[1]) / 2
    ];
    const corridor = [
      { name: '家', coord: scenario.home.coord, radius: 2200 },
      { name: '走廊', coord: mid, radius: 3000 },
      { name: '公司', coord: scenario.work.coord, radius: 2000 }
    ];
    const trafficRaw = await Promise.all(corridor.map(fetchTraffic));
    const traffic = trafficFactor(trafficRaw);

    const drivingRaw = await request(api.driving, {
      origin,
      destination: dest,
      strategy: 32,
      alternative_route: 2,
      show_fields: 'cost,tmcs,navi,polyline'
    }, '驾车路径规划');

    let transit = null;
    try {
      const transitRaw = await request(api.transit, {
        origin,
        destination: dest,
        city1: scenario.citycode || '010',
        city2: scenario.citycode || '010',
        show_fields: 'cost,polyline'
      }, '公交路径规划');
      transit = normalizeTransit(transitRaw);
    } catch (e) {
      transit = null;
    }

    return {
      source: 'live',
      fetchedAt: Date.now(),
      weatherByKey: weather.byKey,
      liveWeather: weather.live,
      traffic,
      routes: normalizeDriving(drivingRaw),
      transit
    };
  }

  function fromSnapshot(snap) {
    if (!snap) throw new Error('没有可用的快照');
    const weather = mergeWeather(snap.weather.home, snap.weather.work);
    return {
      source: 'snapshot',
      fetchedAt: snap.generatedAt ? new Date(snap.generatedAt).getTime() : Date.now(),
      weatherByKey: weather.byKey,
      liveWeather: weather.live,
      traffic: trafficFactor(snap.traffic),
      routes: normalizeDriving(snap.driving),
      transit: normalizeTransit(snap.transit)
    };
  }

  async function geocode(address, city) {
    const raw = await request(api.geocode, { address, city: city || '北京' }, '地理编码');
    const g = raw.geocodes && raw.geocodes[0];
    if (!g) throw new Error('没找到这个地址，换个更具体的？');
    const [lng, lat] = g.location.split(',').map(Number);
    return { coord: [lng, lat], name: g.formatted_address || address, adcode: g.adcode };
  }

  global.Data = {
    setLogger, fetchAll, fromSnapshot, geocode, normalizeDriving, normalizeTransit
  };
})(window);
