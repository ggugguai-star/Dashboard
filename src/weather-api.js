/**
 * weather-api.js — Open-Meteo 날씨 API (순수 fetch, DOM 없음)
 */

export const DEFAULT_WEATHER_TTL_MS = 600_000;
export const DEFAULT_GEOCODE_TTL_MS = 300_000;

/** @param {number|string} lat @param {number|string} lon @param {'c'|'f'} [unit] */
export function buildWeatherForecastKey(lat, lon, unit = 'c') {
  const la = Number(lat);
  const lo = Number(lon);
  const u = unit === 'f' ? 'f' : 'c';
  return `wx:forecast:${la.toFixed(4)}:${lo.toFixed(4)}:${u}`;
}

/** @param {string} name */
export function buildGeocodeKey(name) {
  return `wx:geo:${String(name || '').trim().toLowerCase()}`;
}

const WMO_LABELS = {
  0: '맑음',
  1: '대체로 맑음',
  2: '부분적으로 흐림',
  3: '흐림',
  45: '안개',
  48: '짙은 안개',
  51: '이슬비(약함)',
  53: '이슬비',
  55: '이슬비(강함)',
  56: '어는 이슬비(약함)',
  57: '어는 이슬비(강함)',
  61: '비(약함)',
  63: '비',
  65: '비(강함)',
  66: '어는 비(약함)',
  67: '어는 비(강함)',
  71: '눈(약함)',
  73: '눈',
  75: '눈(강함)',
  77: '싸락눈',
  80: '소나기(약함)',
  81: '소나기',
  82: '소나기(강함)',
  85: '눈 소나기(약함)',
  86: '눈 소나기(강함)',
  95: '뇌우',
  96: '뇌우·우박',
  99: '뇌우·우박(강함)',
};

const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  56: '🌧️', 57: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  66: '🌧️', 67: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️',
  77: '🌨️',
  80: '🌦️', 81: '🌦️', 82: '⛈️',
  85: '🌨️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

/** @param {number} code WMO weather_code */
export function weatherCodeLabel(code) {
  const n = Number(code);
  if (Number.isNaN(n)) return '—';
  return WMO_LABELS[n] || '알 수 없음';
}

/** @param {number} code */
export function weatherCodeIcon(code) {
  const n = Number(code);
  if (Number.isNaN(n)) return '🌡️';
  return WMO_ICONS[n] || '🌡️';
}

/** @param {number|null|undefined} temp @param {'c'|'f'} unit */
export function formatTemperature(temp, unit = 'c') {
  if (temp == null || Number.isNaN(Number(temp))) return '—';
  const n = Math.round(Number(temp));
  return unit === 'f' ? `${n}°F` : `${n}°C`;
}

/**
 * Open-Meteo forecast JSON → 정규화 객체
 * @param {object} data
 * @param {'c'|'f'} [unit]
 */
export function normalizeForecast(data, unit = 'c') {
  const u = unit === 'f' ? 'f' : 'c';
  const current = data?.current || {};
  const daily = data?.daily || {};
  const times = daily.time || [];
  const days = [];
  for (let i = 0; i < times.length; i += 1) {
    days.push({
      date: times[i],
      code: daily.weather_code?.[i],
      max: daily.temperature_2m_max?.[i],
      min: daily.temperature_2m_min?.[i],
    });
  }
  return {
    unit: u,
    current: {
      temp: current.temperature_2m,
      code: current.weather_code,
      wind: current.wind_speed_10m,
    },
    daily: days,
    timezone: data?.timezone || '',
  };
}

/**
 * @param {string} name
 * @returns {Promise<{places:object[]}|{error:string}>}
 */
export async function geocodeLocation(name) {
  try {
    const q = String(name || '').trim();
    if (!q) return { error: '위치 이름을 입력하세요' };
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=ko`;
    const res = await fetch(url);
    if (!res.ok) return { error: `지오코딩 실패 (${res.status})` };
    const data = await res.json();
    const places = (data.results || []).map((p) => ({
      name: p.name,
      lat: p.latitude,
      lon: p.longitude,
      country: p.country || '',
      admin1: p.admin1 || '',
      label: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
    }));
    if (places.length === 0) return { error: '검색 결과가 없습니다' };
    return { places };
  } catch (e) {
    return { error: e?.message || '네트워크 오류' };
  }
}

/**
 * @param {{ latitude: number, longitude: number, unit?: 'c'|'f' }} opts
 * @returns {Promise<object>}
 */
export async function fetchWeatherForecast({ latitude, longitude, unit = 'c' }) {
  try {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return { error: '유효하지 않은 좌표' };
    }
    const tempUnit = unit === 'f' ? 'fahrenheit' : 'celsius';
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '5',
      temperature_unit: tempUnit,
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const res = await fetch(url);
    if (!res.ok) return { error: `예보 조회 실패 (${res.status})` };
    const data = await res.json();
    return normalizeForecast(data, unit);
  } catch (e) {
    return { error: e?.message || '네트워크 오류' };
  }
}
