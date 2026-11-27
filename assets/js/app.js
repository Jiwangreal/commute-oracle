/* HappyDriver — 交互与渲染 */
(function (global) {
  'use strict';

  const U = global.U;
  const CFG = global.APP_CONFIG;
  const P = global.Predict;
  const Data = global.Data;
  const $ = U.$;
  const $$ = U.$$;

  const LS_KEY = 'happydriver-scenario';
  const LS_KEY_OLD = 'commute-oracle-scenario';

  const state = {
    scenario: null,
    data: null,
    days: [],
    selected: 1,
    activeRoute: 'main',
    showTransit: false,
    injections: {},
    demoNow: null,
    notifOn: false,
    logs: [],
    source: 'live',
    loading: true,
    morningSimulated: false
  };

  /* ------------------------------------------------------------------ 启动 */
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    state.scenario = loadScenario();
    bind();
    renderSkeleton();
    renderStatus();

    MapView.init().then(() => {
      if (state.days.length) renderMap();
    }).catch((e) => {
      const el = document.getElementById('map');
      if (el) el.innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#6d7891;font-size:12px;text-align:center;padding:24px">地图加载失败：' + U.escapeHtml(e.message) + '<br>请检查网络或高德 Key 配额</div>';
    });

    Data.setLogger(pushLog);
    await reload(true);
    maybeAutoBrief();

    setInterval(() => {
      if (document.visibilityState === 'visible' && state.source === 'live' && !state.demoNow) {
        reload(false, true);
      }
    }, 20 * 60 * 1000);

    window.addEventListener('resize', () => MapView.resize());
  }

  /* ------------------------------------------------------------------ 配置 */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadScenario() {
    const base = clone(CFG.scenario);
    const saved = U.storageGet(LS_KEY, null) || U.storageGet(LS_KEY_OLD, null);
    if (!saved) return base;
    return {
      ...base,
      ...saved,
      home: { ...base.home, ...(saved.home || {}) },
      work: { ...base.work, ...(saved.work || {}) }
    };
  }

  function saveScenario() {
    U.storageSet(LS_KEY, {
      home: state.scenario.home,
      work: state.scenario.work,
      usualDepart: state.scenario.usualDepart,
      targetArrive: state.scenario.targetArrive,
      bufferMin: state.scenario.bufferMin
    });
  }

  /* ------------------------------------------------------------------ 数据 */
  async function reload(initial, silent) {
    if (!initial) state.loading = true;
    if (!silent) renderStatus();
    try {
      state.data = await Data.fetchAll(state.scenario);
      state.source = 'live';
      if (!silent) toast('已更新实时数据 · ' + U.monthDay(new Date()) + ' ' + hhmm(new Date()));
    } catch (err) {
      console.warn('[live failed]', err);
      if (global.FALLBACK_SNAPSHOT) {
        try {
          state.data = Data.fromSnapshot(global.FALLBACK_SNAPSHOT);
          state.source = 'snapshot';
          if (!silent) toast('实时接口不可用，已切到构建期快照（数据仍来自高德）');
        } catch (e2) {
          state.data = null;
          toast('数据加载失败：' + (err.message || err));
        }
      } else {
        state.data = null;
        toast('数据加载失败：' + (err.message || err));
      }
    }
    state.loading = false;
    rebuild(initial);
  }

  function applyInjection(wx, inj) {
    if (!inj) return wx;
    const w = { ...wx };
    if (inj.rain) {
      w.day = '暴雨';
      w.night = '大雨';
      w.high = Math.round(wx.high + 2);
      w.low = Math.round(wx.low + 3);
      w.wind = '东北';
      w.power = '4-5';
      w.source = 'injected';
    } else if (inj.clear) {
      w.day = '晴';
      w.night = '晴';
      w.source = 'injected';
    }
    return w;
  }

  function rebuild(resetSelection) {
    if (!state.data || !state.data.routes || !state.data.routes.length) {
      renderAll();
      return;
    }
    const weatherByKey = {};
    Object.keys(state.data.weatherByKey).forEach((k) => {
      weatherByKey[k] = applyInjection(state.data.weatherByKey[k], state.injections[k]);
    });

    const now = state.demoNow || new Date();
    const days = P.buildDays({
      now,
      calibNow: new Date(),
      routes: state.data.routes,
      traffic: state.data.traffic,
      weatherByKey,
      injections: state.injections,
      scenario: state.scenario
    });
    state.days = days;

    if (resetSelection || state.selected == null || state.selected >= days.length) {
      state.selected = pickDefault(days);
    }
    if (state.selected < 0) state.selected = 0;
    if (!state.days[state.selected] || state.days[state.selected].past) {
      const alt = pickDefault(days);
      if (alt !== -1) state.selected = alt;
    }
    renderAll();
  }

  function pickDefault(days) {
    // 通勤产品优先看下一个工作日；周末默认跳过
    const workday = days.findIndex((d) => !d.past && !d.isWeekend);
    if (workday !== -1) return workday;
    const idx = days.findIndex((d) => !d.past);
    return idx === -1 ? 0 : idx;
  }

  function day() {
    return state.days[state.selected] || state.days[0];
  }

  function hhmm(d) {
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  }

  /* ------------------------------------------------------------------ 渲染 */
  function renderSkeleton() {
    $('#heroDepart').textContent = '--:--';
    $('#heroLine').textContent = '正在读取天气与路况…';
    $('#heroChips').innerHTML = '<span class="pill">连接高德开放平台…</span>';
    $('#weekStrip').innerHTML = Array.from({ length: 7 }).map(() =>
      '<div class="day"><span class="day-name skeleton" style="width:30px">··</span><span class="day-ico skeleton" style="width:22px;height:22px">·</span><span class="day-time skeleton" style="width:52px">--:--</span></div>'
    ).join('');
    $('#stack').innerHTML = '';
    $('#stackLegend').innerHTML = '';
    $('#evidence').innerHTML = '';
    $('#routes').innerHTML = '';
    $('#altList').innerHTML = '';
  }

  function renderAll() {
    renderStatus();
    renderHero();
    renderWeek();
    renderMap();
    renderWhy();
    renderAlts();
    renderConsole();
    renderLog();
    renderTopRoute();
  }

  function renderStatus() {
    const pill = $('#livePill');
    if (!pill) return;
    const b = pill.querySelector('b');
    const t = $('#liveTime');
    pill.classList.toggle('is-snapshot', state.source === 'snapshot' && !state.demoNow);
    pill.classList.toggle('is-demo', !!state.demoNow);
    if (state.demoNow) {
      b.textContent = 'DEMO';
      t.textContent = '07:30';
    } else if (state.source === 'snapshot') {
      b.textContent = '快照';
      t.textContent = state.data ? U.monthDay(new Date(state.data.fetchedAt)) + ' ' + hhmm(new Date(state.data.fetchedAt)) : '--:--';
    } else {
      b.textContent = 'LIVE';
      t.textContent = state.data ? hhmm(new Date(state.data.fetchedAt)) : '--:--';
    }
  }

  function renderTopRoute() {
    $('#topHome').textContent = state.scenario.home.short || state.scenario.home.name;
    $('#topWork').textContent = state.scenario.work.short || state.scenario.work.name;
  }

  function heroTag(d) {
    let label = '';
    if (d.offset === 0) label = '今天';
    else if (d.offset === 1) label = d.isWeekend ? d.weekday : '明早';
    else if (d.offset === 2) label = '后天';
    return (label ? label + ' · ' : '') + d.weekday + ' · ' + U.monthDay(d.date);
  }

  function renderHero() {
    const d = day();
    if (!d) {
      $('#heroDepart').textContent = '--:--';
      return;
    }
    const wx = d.weather;
    $('#heroTag').textContent = heroTag(d);
    $('#heroWeather').textContent = d.weatherEmoji + ' ' + wx.day + ' ' + wx.high + '° / ' + wx.low + '°';

    const src = $('#heroSrc');
    if (wx.source === 'injected') {
      src.textContent = '演示注入';
      src.className = 'src-badge warn';
    } else if (wx.source === 'extrapolated') {
      src.textContent = '趋势外推';
      src.className = 'src-badge warn';
    } else {
      src.textContent = d.offset <= 3 ? '高德预报' : '预报 + 外推';
      src.className = 'src-badge';
    }

    $('#heroDepart').textContent = d.past ? '—' : d.depart;

    const line = $('#heroLine');
    if (d.past) {
      line.innerHTML = '今天的通勤已结束，这是当时的建议 · <b>点「明早」看下一次</b>';
    } else if (!d.feasible) {
      line.innerHTML = '最早 <b>' + d.depart + '</b> 出发，预计 <b class="late">' + d.arrive + '</b> 到，晚 ' + Math.round(d.lateMin) + ' 分钟';
    } else if (d.deltaMin > 0) {
      line.innerHTML = '比平时早 <b>' + d.deltaMin + ' 分钟</b>，预计 <b>' + d.arrive + '</b> 到达公司';
    } else if (d.deltaMin < 0) {
      line.innerHTML = '可以晚 <b>' + Math.abs(d.deltaMin) + ' 分钟</b> 出门，预计 <b>' + d.arrive + '</b> 到达公司';
    } else {
      line.innerHTML = '按平时时间走，预计 <b>' + d.arrive + '</b> 到达公司';
    }

    const chips = [];
    const riskText = d.riskLevel === 'high' ? '高' : (d.riskLevel === 'mid' ? '中' : '低');
    chips.push('<span class="pill risk-' + d.riskLevel + '">' + riskText + '风险 · ' + d.risk + '</span>');
    chips.push('<span class="pill">⏱ 路上 <b>' + U.fmtDuration(d.durationMin) + '</b></span>');
    const wExtra = Math.round(d.breakdown.weather);
    if (wExtra > 0) chips.push('<span class="pill">' + d.weatherEmoji + ' 天气 <b>+' + wExtra + ' 分</b></span>');
    const inc = Math.round(d.breakdown.incident);
    if (inc > 0) chips.push('<span class="pill risk-high">🚧 事故 <b>+' + inc + ' 分</b></span>');
    if (state.injections[d.key] && state.injections[d.key].metro) {
      chips.push('<span class="pill risk-high">🚇 地铁故障</span>');
    }
    if (d.offset >= 4) chips.push('<span class="pill">🌱 长期趋势 · 把握较低</span>');
    if (state.days[1] && state.days[1].isWeekend && state.selected !== 1) {
      chips.push('<span class="pill">🗓 明天周末，已跳到工作日</span>');
    }
    $('#heroChips').innerHTML = chips.join('');

    const simBtn = $('#btnSimMorning');
    if (simBtn) {
      const label = d.offset === 1 ? '模拟明早 07:30' : '模拟当天 07:30';
      simBtn.innerHTML = '<span class="pulse-dot"></span>' + label;
    }

    const pct = Math.round(d.confidence * 100);
    $('#confRing').style.setProperty('--p', pct);
    $('#confVal').innerHTML = pct + '<em>%</em>';

    // 环的长度表示把握，颜色也表示把握（风险另有红色 chip，不混用）
    const confColor = pct >= 80 ? '#7ee0a8' : (pct >= 65 ? '#ffc46e' : '#ff8b96');
    $('#confRing').style.background = 'conic-gradient(' + confColor + ' ' + pct + '%, rgba(255,255,255,.14) 0)';
  }

  function renderWeek() {
    const strip = $('#weekStrip');
    if (!state.days.length) return;
    strip.innerHTML = state.days.map((d, i) => {
      const active = i === state.selected;
      const past = d.past;
      const inj = state.injections[d.key] || {};
      const injected = inj.rain || inj.clear || inj.crash || inj.metro;
      const metaBits = [];
      if (d.weather.source === 'extrapolated') metaBits.push('外推');
      if (injected) metaBits.push('注入');
      metaBits.push(Math.round(d.durationMin) + ' 分钟');
      return '<button class="day' + (active ? ' is-active' : '') + (past ? ' is-past' : '') + '" data-day="' + i + '" role="tab" aria-selected="' + active + '" title="' + U.escapeHtml(d.weekday + ' ' + U.monthDay(d.date) + ' · ' + d.weather.day) + '">'
        + '<span class="day-top"><span class="day-name">' + (d.offset === 0 ? '今天' : (d.offset === 1 ? (d.isWeekend ? d.weekday : '明早') : (d.offset === 2 ? '后天' : d.weekday))) + '</span>'
        + '<span class="day-date">' + U.monthDay(d.date) + '</span></span>'
        + '<span class="day-ico">' + d.weatherEmoji + '</span>'
        + '<span class="day-time">' + (past ? '已过' : d.depart) + '</span>'
        + '<span class="day-meta">' + metaBits.join(' · ') + '</span>'
        + '<span class="day-risk ' + d.riskLevel + '"></span>'
        + '</button>';
    }).join('');

    const srcNote = state.source === 'snapshot' ? '快照数据' : '实时数据';
    const skipped = state.days[1] && state.days[1].isWeekend && state.selected !== 1;
    $('#weekSub').textContent = '基于高德天气 + 走廊交通态势 + 历史曲线（' + srcNote + '）· '
      + (skipped ? '明天周末，已跳到下个工作日 · ' : '') + '点一天看细节';
  }

  function predictedDuration(route, d) {
    if (!state.data || !state.data.routes.length) return 0;
    return route.durationMin * (d.durationMin / Math.max(1, state.data.routes[0].durationMin));
  }

  function transitPrediction(d) {
    const t = state.data && state.data.transit;
    if (!t) return null;
    const inj = state.injections[d.key] || {};
    const weatherAdj = 1 + (d.weatherFactor - 1) * 0.35;
    return {
      durationMin: t.durationMin * weatherAdj + (inj.metro ? 18 : 0) + (inj.crash ? 3 : 0),
      down: !!inj.metro,
      fee: t.fee,
      lines: t.lines,
      path: t.path,
      walkM: t.walkM
    };
  }

  function activeRouteObj() {
    if (!state.data) return null;
    if (state.showTransit && state.data.transit) return { id: 'transit', name: '地铁方案', transit: true };
    return state.data.routes.find((r) => r.id === state.activeRoute) || state.data.routes[0];
  }

  function renderMap() {
    const d = day();
    if (!d || !state.data) return;
    const r = activeRouteObj();
    const pred = r && r.transit ? (transitPrediction(d) || {}).durationMin : (r ? predictedDuration(r, d) : 0);
    const activeId = state.showTransit ? 'transit' : (r ? r.id : 'main');

    MapView.draw({
      routes: state.data.routes,
      activeId: activeId,
      home: state.scenario.home,
      work: state.scenario.work,
      transit: state.data.transit,
      showTransit: state.showTransit,
      incident: (state.injections[d.key] && state.injections[d.key].crash) ? CFG.injections.crash : null
    });

    $('#mapFloat').innerHTML = '<b>' + U.escapeHtml(r ? (r.transit ? '地铁方案' : r.name) : '最快路线') + '</b><span>' + Math.round(pred) + ' 分钟 · ' + d.arrive + ' 到</span>';
    $('#mapSub').textContent = state.showTransit
      ? '地铁方案 · 高德公交路径规划 v5 · 雨天通常比驾车更稳'
      : '高德实时路况（红黄绿）· 耗时按 ' + d.weekday + ' 预测';

    renderRoutes(d);
  }

  function renderRoutes(d) {
    if (!state.data) return;
    const items = [];
    state.data.routes.forEach((r) => {
      const pred = predictedDuration(r, d);
      const extra = pred - predictedDuration(state.data.routes[0], d);
      const active = !state.showTransit && r.id === state.activeRoute;
      const tag = r.index === 0 ? '<span class="tagline green">推荐</span>' : (extra > 1 ? '<span class="tagline warn">+' + Math.round(extra) + ' 分</span>' : '');
      items.push(routeItem({
        id: r.id,
        active,
        name: r.name,
        tag,
        sub: (r.distance / 1000).toFixed(1) + ' km · ' + r.steps + ' 段 · ' + r.lights + ' 个红绿灯',
        minutes: pred,
        late: d.departMin + pred + state.scenario.bufferMin > d.targetMin
      }));
    });

    const t = transitPrediction(d);
    if (t) {
      const lineName = (t.lines[0] && t.lines[0].name) || '地铁';
      items.push(routeItem({
        id: 'transit',
        active: state.showTransit,
        name: '地铁方案',
        tag: t.down ? '<span class="tagline warn">故障</span>' : '<span class="tagline">雨天更稳</span>',
        sub: lineName.replace(/\(.*\)/, '') + ' · ¥' + t.fee.toFixed(0) + ' · 步行 ' + t.walkM + ' m',
        minutes: t.durationMin,
        late: t.down
      }));
    }

    $('#routes').innerHTML = items.join('');
    $$('#routes .route-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-route');
        if (id === 'transit') {
          state.showTransit = true;
        } else {
          state.showTransit = false;
          state.activeRoute = id;
        }
        renderMap();
      });
    });
  }

  function routeItem(o) {
    return '<button class="route-item' + (o.active ? ' is-active' : '') + '" data-route="' + o.id + '">'
      + '<span class="route-radio"></span>'
      + '<span class="route-main"><span class="route-name">' + U.escapeHtml(o.name) + o.tag + '</span>'
      + '<span class="route-sub">' + U.escapeHtml(o.sub) + '</span></span>'
      + '<span class="route-time' + (o.late ? ' late' : '') + '">' + Math.round(o.minutes) + '<small>分钟</small></span>'
      + '</button>';
  }

  function renderWhy() {
    const d = day();
    if (!d) return;
    const b = d.breakdown;
    const total = Math.max(1, b.free + b.peak + b.weather + b.incident);
    const seg = [
      ['free', b.free],
      ['peak', b.peak],
      ['weather', b.weather],
      ['incident', b.incident]
    ].filter((s) => s[1] > 0.4);

    $('#stack').innerHTML = seg.map(([k, v]) =>
      '<i class="s-' + k + '" style="width:' + (v / total * 100).toFixed(1) + '%"></i>'
    ).join('');

    $('#stackLegend').innerHTML = [
      ['free', '自由流', b.free],
      ['peak', '早高峰', b.peak],
      ['weather', '天气', b.weather],
      ['incident', '突发', b.incident]
    ].filter(([, , v]) => v > 0.4).map(([k, label, v]) =>
      '<span><i class="s-' + k + '" style="background:' + ({ free: '#2f6bff', peak: '#f5a524', weather: '#8b5cf6', incident: '#ff5a6a' }[k]) + '"></i>' +
      label + (k === 'free' ? ' ' : ' +') + Math.round(v) + ' 分</span>'
    ).join('');

    const slack = Math.round(d.targetMin - d.arriveMin);
    const slackText = slack > 0 ? '留 ' + slack + ' 分钟余量' : (slack === 0 ? '刚好赶上' : '还是会晚 ' + (-slack) + ' 分钟');
    const weatherPart = Math.round(b.weather);
    let line;
    if (!d.feasible) {
      line = d.weekday + ' ' + d.depart + ' 走，路上约 ' + Math.round(d.durationMin) + ' 分钟，仍会晚 ' + Math.round(d.lateMin) + ' 分钟。建议改乘地铁，或和公司打声招呼。';
    } else if (weatherPart > 2) {
      line = d.weekday + ' ' + d.depart + ' 出发，路上约 ' + Math.round(d.durationMin) + ' 分钟。其中' + d.weather.day + '让行程多花 ' + weatherPart + ' 分钟；按这个点走，' + d.arrive + ' 到，' + slackText + '。';
    } else {
      line = d.weekday + ' ' + d.depart + ' 出发，路上约 ' + Math.round(d.durationMin) + ' 分钟。早高峰是主要成本（+' + Math.round(b.peak) + ' 分钟），天气影响不大；' + d.arrive + ' 到，' + slackText + '。';
    }
    $('#whyLine').textContent = line;

    const ev = [];
    ev.push(evidence('🌦️', '天气', weatherTag(d.weather.source),
      wxLine(d)));

    const tr = state.data ? state.data.traffic : null;
    ev.push(evidence('🚦', '路况', '高德交通态势',
      tr ? ('走廊实时' + tr.statusText + '，拥堵占比 ' + (tr.ratio * 100).toFixed(1) + '%。' + truncate(tr.description, 46)) : '暂无实时路况'));

    ev.push(evidence('📈', '历史', '走廊曲线',
      d.weekday + '早高峰系数 ' + d.factors.idx.toFixed(2) + '；平时 ' + U.fromMin(U.toMin(state.scenario.usualDepart)) + ' 出发预计 ' +
      d.usual.arrive + ' 到' + (d.usual.lateMin > 0 ? '，晚 ' + Math.round(d.usual.lateMin) + ' 分钟' : '，刚好赶上')));

    const inj = state.injections[d.key];
    if (inj && inj.crash) {
      ev.push(evidence('🚧', '突发', '演示注入', '天元中路百家湖段事故，预计消散前多花 ' + Math.round(d.breakdown.incident) + ' 分钟。'));
    }
    if (inj && inj.metro) {
      ev.push(evidence('🚇', '备选', '演示注入', '地铁 1 号线天元路区段信号故障，地铁方案 +18 分钟，建议仍以驾车为主。'));
    }
    $('#evidence').innerHTML = ev.join('');
  }

  function wxLine(d) {
    const w = d.weather;
    const extra = Math.round(d.breakdown.weather);
    const base = w.day + ' ' + w.high + '°/' + w.low + '°，' + w.wind + '风 ' + w.power + ' 级';
    if (w.source === 'extrapolated') return base + '（趋势外推，把握较低）';
    if (extra > 1) return base + '，预计让通勤多花 ' + extra + ' 分钟。';
    return base + '，对通勤影响很小。';
  }

  function weatherTag(src) {
    if (src === 'injected') return '演示注入';
    if (src === 'extrapolated') return '趋势外推';
    return '高德天气';
  }

  function evidence(icon, title, src, text) {
    return '<div class="ev"><span class="ev-ico">' + icon + '</span><div>'
      + '<div class="ev-b">' + title + '<span class="ev-src">' + src + '</span></div>'
      + '<div class="ev-p">' + U.escapeHtml(text) + '</div></div></div>';
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function renderAlts() {
    const d = day();
    if (!d || !state.data) return;
    const rows = [];
    state.data.routes.slice(1).forEach((r) => {
      const pred = predictedDuration(r, d);
      const diff = pred - predictedDuration(state.data.routes[0], d);
      rows.push('<div class="alt"><span class="alt-ico">🛣️</span><div class="alt-b"><b>' + U.escapeHtml(r.name) + '</b>'
        + '<span>' + (r.distance / 1000).toFixed(1) + ' km · ' + (diff > 0.5 ? '比主线多 ' + Math.round(diff) + ' 分钟' : '和主线差不多') + '</span></div>'
        + '<span class="alt-time">' + Math.round(pred) + '<small>分钟</small></span></div>');
    });

    const t = transitPrediction(d);
    if (t) {
      const lines = (t.lines || []).map((l) => l.name.replace(/\(.*\)/, '')).join(' → ') || '地铁';
      rows.push('<div class="alt"><span class="alt-ico">🚇</span><div class="alt-b"><b>' + (t.down ? '地铁（信号故障）' : '地铁方案') + '</b>'
        + '<span>' + U.escapeHtml(lines) + ' · ¥' + t.fee.toFixed(0) + ' · 步行 ' + t.walkM + ' m</span></div>'
        + '<span class="alt-time' + (t.down ? ' late' : '') + '">' + Math.round(t.durationMin) + '<small>分钟</small></span></div>');
    }
    if (!rows.length) rows.push('<div class="alt"><span class="alt-ico">🤔</span><div class="alt-b"><b>暂无备选</b><span>接口没有返回第二条路线</span></div></div>');
    $('#altList').innerHTML = rows.join('');
  }

  function renderConsole() {
    const d = day();
    const inj = (d && state.injections[d.key]) || {};
    $$('.scenario').forEach((b) => {
      const k = b.getAttribute('data-scenario');
      const on = (k === 'rain' && inj.rain) || (k === 'clear' && inj.clear) || (k === 'crash' && inj.crash) || (k === 'metro' && inj.metro);
      b.classList.toggle('is-on', !!on);
    });
    const bits = [];
    if (state.demoNow) bits.push('时间旅行 ' + hhmm(state.demoNow));
    if (state.source === 'snapshot') bits.push('快照数据');
    else bits.push('真实接口');
    if (inj.rain) bits.push('暴雨');
    if (inj.clear) bits.push('转晴');
    if (inj.crash) bits.push('事故');
    if (inj.metro) bits.push('地铁故障');
    const note = $('#demoNote');
    if (note) note.textContent = bits.join(' · ');
  }

  function pushLog(entry) {
    const now = new Date();
    state.logs.unshift({
      time: hhmm(now) + ':' + U.pad2(now.getSeconds()),
      name: entry.name,
      ok: entry.ok,
      ms: entry.ms,
      info: entry.info,
      raw: entry.raw,
      api: entry.api
    });
    if (state.logs.length > 40) state.logs.length = 40;
    renderLog();
  }

  function renderLog() {
    const list = $('#logList');
    if (!list) return;
    $('#apiCount').textContent = state.logs.length + ' 次';
    list.innerHTML = state.logs.map((l, i) =>
      '<div class="log-row" data-log="' + i + '" title="' + U.escapeHtml(l.info || '') + '">'
      + '<span>' + l.time + '</span>'
      + '<span class="api">' + U.escapeHtml(l.name) + '</span>'
      + '<span class="sum">' + U.escapeHtml(l.ok ? 'OK · ' + (l.info || '成功') : '失败 · ' + (l.info || '')) + '</span>'
      + '<span class="ms ' + (l.ok ? '' : 'err') + '">' + l.ms + 'ms</span>'
      + '</div>'
    ).join('') + '<pre id="logRaw" style="display:none;margin:8px 0 0;padding:10px;border-radius:10px;background:#0f1730;color:#c9d6f5;font-size:10px;line-height:1.55;overflow:auto;max-height:240px"></pre>';

    $$('#logList .log-row').forEach((row) => {
      row.addEventListener('click', () => {
        const l = state.logs[Number(row.getAttribute('data-log'))];
        const pre = $('#logRaw');
        if (!pre) return;
        pre.style.display = 'block';
        pre.textContent = l.raw
          ? '// ' + l.api + '\n' + JSON.stringify(l.raw, null, 2).slice(0, 4000)
          : '// ' + l.api + '\n' + (l.info || 'no data');
      });
    });
  }

  /* ------------------------------------------------------------------ 事件 */
  function bind() {
    $('#weekStrip').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-day]');
      if (!btn) return;
      state.selected = Number(btn.getAttribute('data-day'));
      state.showTransit = false;
      state.activeRoute = 'main';
      renderAll();
    });

    $('#btnNav').addEventListener('click', () => {
      const s = state.scenario;
      const url = 'https://uri.amap.com/navigation?from=' + s.home.coord.join(',') + ',' + encodeURIComponent(s.home.name)
        + '&to=' + s.work.coord.join(',') + ',' + encodeURIComponent(s.work.name)
        + '&mode=car&policy=1&src=happydriver&coordinate=gaode&callnative=1';
      window.open(url, '_blank', 'noopener');
      toast('已唤起高德导航（URI API）');
    });

    $('#btnAlt').addEventListener('click', () => {
      if (!state.data || !state.data.routes.length) return;
      state.showTransit = false;
      const i = state.data.routes.findIndex((r) => r.id === state.activeRoute);
      state.activeRoute = state.data.routes[(i + 1) % state.data.routes.length].id;
      renderMap();
      toast('已切换到：' + (state.data.routes.find((r) => r.id === state.activeRoute) || {}).name);
    });

    $('#btnSimMorning').addEventListener('click', simulateMorning);

    $('#btnRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.style.transform = 'rotate(360deg)';
      btn.style.transition = 'transform .6s';
      await reload(false, false);
      setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 650);
    });

    $('#btnTraffic').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      MapView.setTraffic(on);
    });

    $('#btnSettings').addEventListener('click', openSettings);
    $('#settingsModal').addEventListener('click', (e) => {
      if (e.target.matches('[data-close]')) closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSettings();
    });

    $('#btnSave').addEventListener('click', saveSettings);
    $('#btnRestore').addEventListener('click', () => {
      U.storageSet(LS_KEY, null);
      state.scenario = clone(CFG.scenario);
      fillSettings();
      toast('已恢复示例通勤，点保存生效');
    });

    $$('.scenario').forEach((b) => b.addEventListener('click', () => toggleScenario(b.getAttribute('data-scenario'))));
    $('#btnReset').addEventListener('click', resetDemo);

    $('#notifSwitch').addEventListener('change', async (e) => {
      if (!e.target.checked) { state.notifOn = false; return; }
      if (!('Notification' in window)) {
        toast('这个浏览器不支持系统通知');
        e.target.checked = false;
        return;
      }
      let perm = 'denied';
      try { perm = await Notification.requestPermission(); } catch (e) { /* file:// 等非安全上下文 */ }
      if (perm === 'granted') {
        state.notifOn = true;
        toast('系统通知已开启 · 点「模拟明早 07:30」试试');
      } else {
        state.notifOn = false;
        e.target.checked = false;
        toast('通知权限被拒绝，站内播报仍然可用');
      }
    });

    $('#notif').addEventListener('click', () => {
      hideNotification();
      $('#hero').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#hero').animate(
        [{ boxShadow: '0 0 0 0 rgba(126,224,168,0)' }, { boxShadow: '0 0 0 6px rgba(126,224,168,.35)' }, { boxShadow: '0 0 0 0 rgba(126,224,168,0)' }],
        { duration: 1200 }
      );
    });
  }

  /* ------------------------------------------------------------------ 演示 */
  function todayKey() {
    return state.days[state.selected] ? state.days[state.selected].key : U.dateKey(new Date());
  }

  function toggleScenario(kind) {
    const key = todayKey();
    const inj = { ...(state.injections[key] || {}) };
    if (kind === 'rain') { inj.rain = !inj.rain; if (inj.rain) inj.clear = false; }
    if (kind === 'clear') { inj.clear = !inj.clear; if (inj.clear) inj.rain = false; }
    if (kind === 'crash') inj.crash = !inj.crash;
    if (kind === 'metro') inj.metro = !inj.metro;

    if (Object.keys(inj).some((k) => inj[k])) state.injections[key] = inj;
    else delete state.injections[key];

    rebuild(false);

    const d = day();
    if (d && ((kind === 'rain' && inj.rain) || (kind === 'crash' && inj.crash))) {
      const bits = [];
      if (inj.rain) bits.push('暴雨');
      if (inj.crash) bits.push('天元中路事故');
      const early = d.deltaMin > 0 ? '比平时早 ' + d.deltaMin + ' 分钟' : '按这个点走不用提前';
      showNotification('建议 ' + d.depart + ' 出发', bits.join(' + ') + '，' + early + '，预计 ' + d.arrive + ' 到。', 11000);
    } else if (kind === 'metro' && inj.metro) {
      toast('地铁故障已注入：公交方案 +18 分钟，推荐仍以驾车为主');
    } else if (kind === 'clear' && inj.clear) {
      toast('已撤销天气影响，看看基线');
    } else {
      toast('已撤销：' + ({ rain: '暴雨', crash: '事故', metro: '地铁故障', clear: '转晴' }[kind] || kind));
    }
    renderAll();
  }

  function simulateMorning() {
    const d = day() || state.days[1] || state.days[0];
    if (!d) return;
    const date = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate(), 7, 30);
    state.demoNow = date;
    state.morningSimulated = true;
    state.selected = 0;
    rebuild(true);
    const nd = day();
    const bits = [];
    if (state.injections[nd.key] && state.injections[nd.key].rain) bits.push('暴雨');
    if (state.injections[nd.key] && state.injections[nd.key].crash) bits.push('天元中路事故');
    const reason = bits.length ? bits.join(' + ') + '，' : (nd.weatherFactor > 1.05 ? nd.weather.day + '，' : '');
    const early = nd.deltaMin > 0 ? '比平时早 ' + nd.deltaMin + ' 分钟' : '可以按平时时间走';
    showNotification('今天建议 ' + nd.depart + ' 出发', reason + '预计 ' + nd.arrive + ' 到，' + early + '。', 14000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('已时间旅行到 ' + U.monthDay(date) + ' 07:30 · 播报已弹出');
  }

  function resetDemo() {
    state.injections = {};
    state.demoNow = null;
    state.morningSimulated = false;
    state.showTransit = false;
    state.activeRoute = 'main';
    rebuild(true);
    renderConsole();
    hideNotification();
    toast('演示已重置');
  }

  /* 早上 6–10 点打开页面：自动补一条当日播报（每天一次） */
  function maybeAutoBrief() {
    if (state.demoNow) return;
    const h = new Date().getHours();
    if (h < 6 || h > 10) return;
    const d = state.days[0];
    if (!d || d.past) return;
    const key = 'happydriver-last-brief';
    if (U.storageGet(key, null) === U.dateKey(new Date())) return;
    U.storageSet(key, U.dateKey(new Date()));
    const early = d.deltaMin > 0 ? '比平时早 ' + d.deltaMin + ' 分钟' : '按平时时间走';
    showNotification('今天建议 ' + d.depart + ' 出发', d.weatherEmoji + ' ' + d.weather.day + '，预计 ' + d.arrive + ' 到，' + early + '。', 12000);
  }

  /* ------------------------------------------------------------------ 通知 */
  let notifTimer = null;

  function showNotification(title, body, ttl) {
    const wrap = $('#notifWrap');
    $('#notifTitle').textContent = title;
    $('#notifBody').textContent = body;
    $('#notifTime').textContent = '现在';
    wrap.querySelector('.notif').classList.add('show');
    clearTimeout(notifTimer);
    notifTimer = setTimeout(hideNotification, ttl || 9000);

    if (state.notifOn && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('HappyDriver', { body: title + ' · ' + body, tag: 'happydriver', lang: 'zh-CN' });
        n.onclick = () => { window.focus(); hideNotification(); };
      } catch (e) { /* ignore */ }
    }
  }

  function hideNotification() {
    const n = $('#notifWrap .notif');
    if (n) n.classList.remove('show');
    clearTimeout(notifTimer);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ------------------------------------------------------------------ 设置 */
  function openSettings() {
    fillSettings();
    $('#formMsg').textContent = '';
    $('#settingsModal').hidden = false;
    setTimeout(() => $('#inHome').focus(), 40);
  }

  function closeSettings() {
    $('#settingsModal').hidden = true;
  }

  function fillSettings() {
    const s = state.scenario;
    $('#inHome').value = s.home.address || s.home.name;
    $('#inWork').value = s.work.address || s.work.name;
    $('#inDepart').value = s.usualDepart;
    $('#inArrive').value = s.targetArrive;
    $('#inBuffer').value = s.bufferMin;
  }

  async function saveSettings() {
    const home = $('#inHome').value.trim();
    const work = $('#inWork').value.trim();
    const depart = $('#inDepart').value;
    const arrive = $('#inArrive').value;
    const buffer = Number($('#inBuffer').value);
    const msg = $('#formMsg');

    if (!home || !work) { msg.textContent = '家和公司都要填一下'; return; }
    if (!depart || !arrive) { msg.textContent = '出发和到达时间要填一下'; return; }
    if (U.toMin(arrive) <= U.toMin(depart)) { msg.textContent = '到达时间要晚于出发时间'; return; }
    if (!isFinite(buffer) || buffer < 0 || buffer > 30) { msg.textContent = '缓冲时间填 0–30 分钟'; return; }

    const btn = $('#btnSave');
    btn.disabled = true;
    btn.textContent = '解析地址…';
    try {
      const [h, w] = await Promise.all([Data.geocode(home, APP_CONFIG.scenario.city), Data.geocode(work, APP_CONFIG.scenario.city)]);
      state.scenario.home = { ...state.scenario.home, name: h.name, short: shortName(home), address: home, coord: h.coord, adcode: h.adcode };
      state.scenario.work = { ...state.scenario.work, name: w.name, short: shortName(work), address: work, coord: w.coord, adcode: w.adcode };
      state.scenario.usualDepart = depart;
      state.scenario.targetArrive = arrive;
      state.scenario.bufferMin = buffer;
      saveScenario();
      closeSettings();
      renderSkeleton();
      await reload(true);
      toast('已保存 · 正在用新地址重算');
    } catch (e) {
      msg.textContent = '地址解析失败：' + (e.message || e);
    } finally {
      btn.disabled = false;
      btn.textContent = '保存并重算';
    }
  }

  function shortName(s) {
    const v = String(s || '').replace(/^北京市?/, '').trim();
    const m = v.match(/([^号区县市]{2,8}(?:中心|大厦|广场|地铁站|车站|小区|家园|公寓|公园|园区))$/);
    if (m) return m[1].replace(/(地铁站|车站)$/, '');
    return v.replace(/(地铁站|车站)$/, '').slice(0, 8);
  }

  global.__commute = { state, reload, rebuild, simulateMorning };
})(window);
