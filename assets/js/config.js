/* HappyDriver — 全局配置（前端公开配置，仅用于赛事演示） */
window.APP_CONFIG = {
  amapKey: '8a419b3cb914d55c5cee180d5eb7c379',

  /* 示例通勤：通州果园 → 国贸银泰中心，京通快速走廊 */
  scenario: {
    home: {
      name: '果园地铁站',
      short: '果园',
      address: '北京市通州区果园地铁站',
      coord: [116.646621, 39.893329],
      adcode: '110112',
      city: '北京'
    },
    work: {
      name: '北京银泰中心',
      short: '银泰中心',
      address: '北京市朝阳区建国门外大街2号银泰中心',
      coord: [116.459151, 39.907698],
      adcode: '110105',
      city: '北京'
    },
    usualDepart: '08:00',
    targetArrive: '09:00',
    bufferMin: 6,
    citycode: '010',
    mode: 'driving'
  },

  /* 走廊采样点：家 / 中途（四惠）/ 公司，用于交通态势 */
  corridor: [
    { name: '果园', coord: [116.646621, 39.893329], radius: 2200 },
    { name: '四惠', coord: [116.517, 39.905], radius: 2600 },
    { name: '国贸', coord: [116.459151, 39.907698], radius: 2000 }
  ],

  /* 走廊早高峰历史拥堵系数（星期 × 时刻），可由真实历史行程回归替换 */
  timeIndex: [
    [0, 0.90], [360, 0.95], [390, 1.05], [420, 1.30], [450, 1.95],
    [480, 2.65], [510, 2.95], [540, 2.55], [570, 2.05], [600, 1.60],
    [630, 1.40], [690, 1.20], [810, 1.05], [990, 1.15], [1050, 1.50],
    [1110, 1.35], [1200, 1.10], [1320, 1.00], [1440, 0.90]
  ],

  /* 周末拥堵约为工作日的 45% */
  weekendDamping: 0.45,
  fridayBoost: 1.05,

  /* 天气对行程时间的放大系数 */
  weatherFactors: [
    ['暴雨', 1.50], ['大暴雨', 1.60], ['特大暴雨', 1.65],
    ['大雪', 1.55], ['暴雪', 1.65], ['中雪', 1.45], ['小雪', 1.30], ['阵雪', 1.32],
    ['雷阵雨', 1.34], ['大雨', 1.35], ['中雨', 1.22], ['小雨', 1.12], ['阵雨', 1.14],
    ['雾', 1.30], ['霾', 1.24], ['浮尘', 1.15], ['扬沙', 1.18],
    ['大风', 1.06], ['阴', 1.04], ['多云', 1.02], ['晴', 1.00]
  ],

  /* 自由流速度（km/h），用于从距离反推自由流耗时 */
  freeFlowSpeed: 45,

  /* 演示注入事件 */
  injections: {
    crash: {
      id: 'crash',
      label: '京通快速 四惠段 事故',
      extraMin: 12,
      startMin: 7 * 60 + 40,
      decayMin: 110,
      coord: [116.517, 39.905],
      risk: 28
    },
    metro: {
      id: 'metro',
      label: '地铁八通线 信号故障',
      extraMin: 18,
      risk: 18
    }
  },

  api: {
    base: 'https://restapi.amap.com',
    weather: '/v3/weather/weatherInfo',
    geocode: '/v3/geocode/geo',
    regeo: '/v3/geocode/regeo',
    trafficCircle: '/v3/traffic/status/circle',
    driving: '/v5/direction/driving',
    transit: '/v5/direction/transit/integrated',
    staticmap: '/v3/staticmap'
  },

  demo: {
    morningMinute: 7 * 60 + 30,
    refreshInterval: 5 * 60 * 1000
  }
};
