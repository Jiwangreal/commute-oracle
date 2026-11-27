/* HappyDriver — 可解释的轻量预测模型
 *
 * T_pred(d,t) = T_free × scale × K_time(weekday,t) × K_weather(d) × liveAdj + ΔI(d,t)
 * 目标是给出「几点走 + 为什么 + 多大把握」，而不是假装能预知事故。
 */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG;
  const { clamp, piecewise, toMin, fromMin, dateKey, weekdayCN } = global.U;

  function weatherFactor(text) {
    const s = String(text || '');
    for (const [kw, f] of CFG.weatherFactors) {
      if (s.indexOf(kw) >= 0) return f;
    }
    return 1.0;
  }

  function weatherSeverity(f) {
    return clamp((f - 1) / 0.5, 0, 1);
  }

  function weatherEmoji(text) {
    const s = String(text || '');
    if (/暴雨|大暴雨|特大暴雨/.test(s)) return '🌧️';
    if (/雷/.test(s)) return '⛈️';
    if (/大雨|中雨|小雨|阵雨|雨/.test(s)) return '🌧️';
    if (/雪/.test(s)) return '🌨️';
    if (/雾|霾|沙|尘/.test(s)) return '🌫️';
    if (/阴/.test(s)) return '☁️';
    if (/多云/.test(s)) return '⛅';
    return '☀️';
  }

  function timeIndex(date, minutes) {
    const jsDay = date.getDay(); // 0 Sun … 6 Sat
    let v = piecewise(CFG.timeIndex, minutes);
    const weekend = jsDay === 0 || jsDay === 6;
    if (weekend) v = 1 + (v - 1) * CFG.weekendDamping;
    if (jsDay === 5) v *= CFG.fridayBoost;
    return v;
  }

  function incidentMinutes(inj, key, t) {
    const dayInj = inj && inj[key];
    if (!dayInj || !dayInj.crash) return 0;
    const c = CFG.injections.crash;
    const d = t - c.startMin;
    if (d <= -20 || d >= c.decayMin) return 0;
    return c.extraMin * clamp(1 - Math.max(0, d) / c.decayMin, 0.08, 1);
  }

  function riskOf({ idx, wf, incident, slack }) {
    const base = (idx - 1) * 22;
    const weather = weatherSeverity(wf) * 45;
    const inc = incident * 1.3;
    const tight = slack < 6 ? (6 - Math.max(0, slack)) * 1.8 : 0;
    return clamp(Math.round(base + weather + inc + tight), 0, 100);
  }

  function riskLevel(risk) {
    if (risk >= 65) return 'high';
    if (risk >= 40) return 'mid';
    return 'low';
  }

  function confidenceOf(offset, weatherSource, incident) {
    const base = [0.92, 0.86, 0.79, 0.72, 0.60, 0.56, 0.52][clamp(offset, 0, 6)];
    let c = base;
    if (weatherSource === 'extrapolated') c -= 0.06;
    if (incident > 0) c -= 0.05;
    return clamp(c, 0.35, 0.95);
  }

  /**
   * @param {Object} o
   * @param {Date}   o.now
   * @param {Array}  o.routes       至少一条，routes[0] 为主路线
   * @param {Object} o.traffic      {ratio:0..1, statusText, description}
   * @param {Object} o.weatherByKey { 'YYYY-MM-DD': {day, night, high, low, wind, power, source} }
   * @param {Object} o.injections   { 'YYYY-MM-DD': {rain:bool, crash:bool, metro:bool} }
   * @param {Object} o.scenario
   */
  function buildDays(o) {
    const scenario = o.scenario;
    const now = o.now;
    const calib = o.calibNow || now;
    const usual = toMin(scenario.usualDepart);
    const target = toMin(scenario.targetArrive);
    const buffer = Number(scenario.bufferMin) || 0;
    const main = o.routes && o.routes[0];
    if (!main) return [];

    const km = Math.max(1, main.distance / 1000);
    const tFree = (km / CFG.freeFlowSpeed) * 60;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const calibMin = calib.getHours() * 60 + calib.getMinutes();
    const idxNow = timeIndex(calib, calibMin);
    const liveRatio = clamp(main.durationMin / Math.max(1, tFree * idxNow), 0.6, 1.8);
    // 用当前真实耗时校准「自由流 × 历史曲线」，避免模型与高德实测脱节
    const scale = clamp(0.55 * liveRatio + 0.45, 0.88, 1.24);
    const trafficAdj = clamp(1 + ((o.traffic ? o.traffic.ratio : 0.15) - 0.15) * 0.22, 0.94, 1.06);

    // 演示基准日：把「明天」指定成某个星期；指定后 7 天从「明天」开始排，不再包含今天
    const sw = scenario.startWeekday;
    const sim = !(sw === null || sw === undefined || sw === '' || !isFinite(Number(sw)));
    const shift = sim ? ((Number(sw) - (now.getDay() + 1)) % 7 + 7) % 7 : 0;
    const baseOffset = sim ? 1 + shift : 0;

    const days = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + baseOffset + offset);
      const key = dateKey(date);
      const wx = (o.weatherByKey && o.weatherByKey[key]) || {
        day: '晴', night: '晴', high: 20, low: 10, wind: '—', power: '1-3', source: 'extrapolated'
      };
      const wf = weatherFactor(wx.day);
      const liveAdj = offset <= 1 ? trafficAdj : 1;
      const free = tFree * scale * liveAdj;

      const evaluate = (t) => {
        const idx = timeIndex(date, t);
        const incident = incidentMinutes(o.injections, key, t);
        const duration = free * idx * wf + incident;
        const arrive = t + duration + buffer;
        return { t, idx, incident, duration, arrive, late: Math.max(0, arrive - target) };
      };

      const earliest = usual - 120;
      const latest = usual + 45;
      let best = null;
      let earliestCandidate = null;
      for (let t = earliest; t <= latest; t += 5) {
        const cand = evaluate(t);
        if (!earliestCandidate || cand.arrive < earliestCandidate.arrive) earliestCandidate = cand;
        if (cand.arrive <= target) best = cand; // 保留最晚的可行时刻
      }
      const chosen = best || earliestCandidate;
      const usualPlan = evaluate(usual);

      const slack = target - chosen.arrive;
      const risk = riskOf({ idx: chosen.idx, wf, incident: chosen.incident, slack });
      const freePart = free;
      const peakPart = free * (chosen.idx - 1);
      const weatherPart = free * chosen.idx * (wf - 1);
      const incidentPart = chosen.incident;

      const past = !sim && offset === 0 && nowMin > usual + 30;

      days.push({
        offset,
        date,
        isToday: !sim && offset === 0,
        isTomorrow: sim ? offset === 0 : offset === 1,
        simulated: sim,
        key,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        weekday: weekdayCN(date.getDay()),
        weather: wx,
        weatherFactor: wf,
        weatherEmoji: weatherEmoji(wx.day),
        departMin: chosen.t,
        depart: fromMin(chosen.t),
        durationMin: chosen.duration,
        arriveMin: chosen.arrive,
        arrive: fromMin(chosen.arrive),
        targetMin: target,
        deltaMin: usual - chosen.t,
        feasible: !!best,
        lateMin: best ? 0 : chosen.late,
        risk,
        riskLevel: riskLevel(risk),
        confidence: confidenceOf(offset, wx.source, chosen.incident),
        breakdown: {
          free: freePart,
          peak: peakPart,
          weather: weatherPart,
          incident: incidentPart
        },
        factors: {
          idx: chosen.idx,
          tFree,
          scale,
          liveAdj,
          trafficAdj,
          incident: chosen.incident
        },
        usual: {
          depart: fromMin(usual),
          durationMin: usualPlan.duration,
          arrive: fromMin(usualPlan.arrive),
          lateMin: usualPlan.late,
          feasible: usualPlan.arrive <= target
        },
        past
      });
    }
    return days;
  }

  global.Predict = {
    weatherFactor, weatherSeverity, weatherEmoji, timeIndex,
    riskLevel, confidenceOf, buildDays
  };
})(window);
