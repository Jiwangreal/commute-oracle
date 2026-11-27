/* 通勤先知 — 小工具 */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');

  function toMin(hhmm) {
    if (typeof hhmm === 'number') return hhmm;
    if (!hhmm) return 0;
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function fromMin(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function fmtDuration(min) {
    const m = Math.max(0, Math.round(min));
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h + ' 小时' + (r ? ' ' + r + ' 分' : '');
  }

  function fmtDurationShort(min) {
    const m = Math.max(0, Math.round(min));
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h' + pad2(m % 60);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function weekdayCN(jsDay) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][jsDay];
  }

  function monthDay(d) {
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function offsetLabel(offset) {
    if (offset === 0) return '今天';
    if (offset === 1) return '明早';
    if (offset === 2) return '后天';
    return weekdayCN(addDays(new Date(), offset).getDay());
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function piecewise(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        return lerp(y0, y1, (x - x0) / (x1 - x0 || 1));
      }
    }
    return points[points.length - 1][1];
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function el(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function storageGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 30) return '刚刚';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    return Math.round(s / 86400) + ' 天前';
  }

  function maskKey(key) {
    if (!key || key.length < 10) return key || '';
    return key.slice(0, 6) + '…' + key.slice(-4);
  }

  function normDate(v) {
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  global.U = {
    $, $$, pad2, toMin, fromMin, fmtDuration, fmtDurationShort,
    dateKey, parseDateKey, addDays, startOfDay, weekdayCN, monthDay,
    offsetLabel, clamp, lerp, piecewise, escapeHtml, el,
    storageGet, storageSet, timeAgo, maskKey, normDate
  };
})(window);
