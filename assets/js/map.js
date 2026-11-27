/* 通勤先知 — 高德 JS API 2.0 地图封装 */
(function (global) {
  'use strict';

  const U = global.U;
  const CFG = global.APP_CONFIG;

  let map = null;
  let trafficLayer = null;
  let overlays = [];
  let ready = null;
  let trafficOn = false;
  let lastData = null;

  const COLORS = {
    '畅通': '#2ecc71',
    '缓行': '#f5b942',
    '拥堵': '#ff5a5f',
    '严重拥堵': '#b23a48',
    '未知': '#c9d2e2'
  };

  function loadScript() {
    if (global.AMap) return Promise.resolve();
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + CFG.amapKey + '&plugin=AMap.TileLayer.Traffic';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('高德 JS API 加载失败'));
      document.head.appendChild(s);
    });
    return ready;
  }

  async function init() {
    await loadScript();
    const el = document.getElementById('map');
    if (!el) return null;
    map = new AMap.Map(el, {
      zoom: 11,
      center: [116.55, 39.9],
      resizeEnable: true,
      viewMode: '2D',
      mapStyle: 'amap://styles/whitesmoke',
      showLabel: true
    });
    trafficLayer = new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180, zIndex: 110 });
    trafficLayer.setMap(trafficOn ? map : null);
    return map;
  }

  function clear() {
    if (!map) return;
    if (overlays.length) {
      map.remove(overlays);
      overlays = [];
    }
  }

  function marker(coord, html, offsetY) {
    return new AMap.Marker({
      position: coord,
      content: html,
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, offsetY || 0),
      zIndex: 130
    });
  }

  function draw(data) {
    if (!map) return;
    lastData = data;
    clear();

    const { routes, activeId, home, work, transit, showTransit, incident } = data;
    const add = [];

    // 底图上的起终点
    add.push(marker(home.coord, '<div class="amap-pin home"><i></i>' + U.escapeHtml(home.short || home.name) + '</div>', 0));
    add.push(marker(work.coord, '<div class="amap-pin work"><i></i>' + U.escapeHtml(work.short || work.name) + '</div>', 0));

    if (showTransit && transit && transit.path && transit.path.length > 1) {
      add.push(new AMap.Polyline({
        path: transit.path,
        strokeColor: '#8b5cf6',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        strokeStyle: 'dashed',
        lineJoin: 'round',
        zIndex: 60
      }));
    } else if (routes && routes.length) {
      // 非选中路线先画（灰色）
      routes.forEach((r) => {
        if (r.id === activeId) return;
        if (!r.path || r.path.length < 2) return;
        add.push(new AMap.Polyline({
          path: r.path,
          strokeColor: '#aab4c8',
          strokeWeight: 4,
          strokeOpacity: 0.55,
          strokeStyle: 'dashed',
          lineJoin: 'round',
          zIndex: 50
        }));
      });

      const active = routes.find((r) => r.id === activeId) || routes[0];
      if (active && active.path && active.path.length > 1) {
        add.push(new AMap.Polyline({
          path: active.path,
          strokeColor: '#2f6bff',
          strokeWeight: 18,
          strokeOpacity: 0.14,
          lineJoin: 'round',
          zIndex: 55
        }));
        // 白色描边，让路线从路况图层里“浮”出来
        add.push(new AMap.Polyline({
          path: active.path,
          strokeColor: '#ffffff',
          strokeWeight: 13,
          strokeOpacity: 0.92,
          lineJoin: 'round',
          zIndex: 64
        }));
        if (active.segments && active.segments.length) {
          active.segments.forEach((seg) => {
            if (!seg.path || seg.path.length < 2) return;
            add.push(new AMap.Polyline({
              path: seg.path,
              strokeColor: COLORS[seg.status] || COLORS['未知'],
              strokeWeight: 7.5,
              strokeOpacity: 1,
              lineJoin: 'round',
              zIndex: 70
            }));
          });
        } else {
          add.push(new AMap.Polyline({
            path: active.path,
            strokeColor: '#2f6bff',
            strokeWeight: 7.5,
            strokeOpacity: 1,
            lineJoin: 'round',
            zIndex: 70
          }));
        }
      }
    }

    if (incident) {
      add.push(marker(incident.coord, '<div class="amap-pin incident"><i></i>' + U.escapeHtml(incident.label) + '</div>', 0));
    }

    overlays = add;
    map.add(add);
    setTimeout(() => {
      try {
        // 以路线为准取景，标记只作为参考，避免被长标签撑开
        const fitTargets = add.filter((o) => o instanceof AMap.Polyline);
        map.setFitView(fitTargets.length ? fitTargets : add, false, [56, 56, 56, 56]);
        if (map.getZoom() > 13.2) map.setZoom(13.2);
      } catch (e) { /* ignore */ }
    }, 60);
  }

  function setTraffic(on) {
    trafficOn = !!on;
    if (trafficLayer && map) trafficLayer.setMap(on ? map : null);
  }

  function resize() {
    if (map) setTimeout(() => map.resize(), 60);
  }

  global.MapView = { init, draw, setTraffic, resize, getMap: () => map, state: () => ({ lastData, trafficOn }) };
})(window);
