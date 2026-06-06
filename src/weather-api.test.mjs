/**
 * weather-api 골든셋 — 캐시 키·정규화·WMO 라벨
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeatherForecastKey,
  buildGeocodeKey,
  weatherCodeLabel,
  weatherCodeIcon,
  formatTemperature,
  normalizeForecast,
} from './weather-api.js';

describe('buildWeatherForecastKey', () => {
  it('includes lat lon unit', () => {
    assert.equal(buildWeatherForecastKey(37.5665, 126.978, 'c'), 'wx:forecast:37.5665:126.9780:c');
    assert.equal(buildWeatherForecastKey(37.5665, 126.978, 'f'), 'wx:forecast:37.5665:126.9780:f');
  });
});

describe('buildGeocodeKey', () => {
  it('lowercases trimmed query', () => {
    assert.equal(buildGeocodeKey('  Seoul '), 'wx:geo:seoul');
  });
});

describe('weatherCodeLabel', () => {
  it('maps known WMO codes', () => {
    assert.equal(weatherCodeLabel(0), '맑음');
    assert.equal(weatherCodeLabel(61), '비(약함)');
    assert.equal(weatherCodeLabel(95), '뇌우');
  });

  it('returns fallback for unknown', () => {
    assert.equal(weatherCodeLabel(999), '알 수 없음');
  });
});

describe('weatherCodeIcon', () => {
  it('returns emoji for known code', () => {
    assert.equal(weatherCodeIcon(0), '☀️');
    assert.equal(weatherCodeIcon(3), '☁️');
  });
});

describe('formatTemperature', () => {
  it('formats celsius and fahrenheit', () => {
    assert.equal(formatTemperature(22.4, 'c'), '22°C');
    assert.equal(formatTemperature(72, 'f'), '72°F');
    assert.equal(formatTemperature(null, 'c'), '—');
  });
});

describe('normalizeForecast', () => {
  it('extracts current and daily arrays', () => {
    const raw = {
      timezone: 'Asia/Seoul',
      current: { temperature_2m: 18.2, weather_code: 1, wind_speed_10m: 3.5 },
      daily: {
        time: ['2026-06-05', '2026-06-06'],
        weather_code: [1, 3],
        temperature_2m_max: [22, 20],
        temperature_2m_min: [14, 13],
      },
    };
    const out = normalizeForecast(raw, 'c');
    assert.equal(out.unit, 'c');
    assert.equal(out.current.temp, 18.2);
    assert.equal(out.current.code, 1);
    assert.equal(out.daily.length, 2);
    assert.equal(out.daily[0].max, 22);
    assert.equal(out.daily[1].code, 3);
  });
});
