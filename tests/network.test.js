const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser(storage = {}) {
  let now = 1793710000000;
  let id = 0;
  const timers = new Map();
  const scripts = [];
  const requests = [];
  const elements = {};
  const body = {
    appendChild(script) { scripts.push(script); script.parentNode = body; },
    removeChild(script) { scripts.splice(scripts.indexOf(script), 1); script.parentNode = null; }
  };
  function XHR() { requests.push(this); }
  XHR.prototype.open = function () {};
  XHR.prototype.send = function () {};
  XHR.prototype.abort = function () { this.aborted = true; };
  class FakeDate extends Date { constructor(value) { super(value === undefined ? now : value); } }
  const context = vm.createContext({
    Date: FakeDate, console, XMLHttpRequest: XHR, DT_Times: 0,
    location: { search: '' },
    document: {
      body, createElement: () => ({}),
      getElementById: id => elements[id] || (elements[id] = { style: {}, addEventListener() {} }),
      documentElement: { style: {} }
    },
    momentWithCorrectUtcOffset: () => ({ format: () => '11-03 20:00' }),
    setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; } },
    addEventListener() {}
  });
  context.window = context;
  vm.runInContext(fs.readFileSync('network.js', 'utf8'), context);
  return {
    context, scripts, requests, elements, storage,
    advance(ms) {
      now += ms;
      for (const [key, timer] of Array.from(timers)) {
        if (timer.at <= now) { timers.delete(key); timer.fn(); }
      }
    },
    reply(script, data) { const name = script.src.match(/callback=([^&]+)/)[1]; context[name](data); },
    now: () => now
  };
}

const interval = 30 * 60 * 1000;
function loadClock(b) {
  vm.runInContext(fs.readFileSync('vendor/moment/moment-with-locales.js', 'utf8'), b.context);
  vm.runInContext(fs.readFileSync('script.js', 'utf8'), b.context);
}

test('calendar errors cannot stop the clock or later refresh steps, and recovery is automatic', () => {
  const b = browser(); loadClock(b);
  let nightCalls = 0;
  b.context.updateCalendar = () => { throw Error('calendar failed'); };
  b.context.setNightMode = () => nightCalls++;
  b.context.refreshClock();
  const first = b.elements.lastUpdate.innerHTML;
  assert.match(b.elements.runtimeStatus.textContent, /calendar.*calendar failed/);
  b.advance(60000);
  assert.notEqual(b.elements.lastUpdate.innerHTML, first);
  assert.equal(nightCalls, 2);
  let recovered = 0;
  b.context.updateCalendar = () => recovered++;
  b.advance(15000);
  assert.equal(recovered, 1);
});

test('time and weather exceptions do not stop forecast or future refresh cycles', () => {
  const b = browser(); loadClock(b);
  let forecasts = 0;
  b.context.clockNetwork.syncTime = () => { throw Error('sync failed'); };
  b.context.refreshActualWeather = () => { throw Error('weather failed'); };
  b.context.refreshForecastWeather = () => forecasts++;
  b.context.refreshData();
  assert.equal(forecasts, 1);
  b.advance(60000);
  assert.equal(forecasts, 2);
});

test('failed XHR construction releases the busy flag for a later retry', () => {
  const b = browser();
  const XHR = b.context.XMLHttpRequest;
  b.context.XMLHttpRequest = function () { throw Error('unavailable'); };
  b.context.clockNetwork.syncTime();
  assert.match(b.elements.networkStatus.textContent, /失败/);
  b.context.XMLHttpRequest = XHR;
  b.advance(interval);
  b.context.clockNetwork.syncTime();
  assert.equal(b.requests.length, 1);
});

test('failed script creation releases weather busy state for a later retry', () => {
  const b = browser();
  b.context.document.createElement = () => { throw Error('unavailable'); };
  request(b, 'weather');
  assert.match(b.elements.networkStatus.textContent, /无法发起请求/);
  b.context.document.createElement = () => ({});
  b.advance(interval); request(b, 'weather');
  assert.equal(b.scripts.length, 1);
});

test('render failures are distinguished from invalid data and remain retryable', () => {
  const b = browser(); loadClock(b);
  request(b, 'weather', () => { throw Error('DOM failed'); });
  b.reply(b.scripts[0], { valid: true });
  assert.match(b.elements.networkStatus.textContent, /Render error/);
  assert.match(b.elements.runtimeStatus.textContent, /weather-render.*DOM failed/);
  b.advance(interval); request(b, 'weather');
  b.reply(b.scripts[0], { valid: true });
  assert.match(b.elements.networkStatus.textContent, /已更新/);
});

function request(b, type, render = () => {}) {
  b.context.clockNetwork.weather(type, 'q=Nantong', interval, data => {
    if (!data || !data.valid) throw Error('invalid');
  }, render);
}

test('concurrent JSONP responses are isolated and repeated requests are deduplicated', () => {
  const b = browser(); const received = [];
  request(b, 'weather', data => received.push(data.value));
  request(b, 'forecast', data => received.push(data.value));
  request(b, 'weather');
  assert.equal(b.scripts.length, 2);
  const [weather, forecast] = b.scripts;
  b.reply(forecast, { valid: true, value: 'forecast' });
  b.reply(weather, { valid: true, value: 'weather' });
  assert.deepEqual(received, ['forecast', 'weather']);
  assert.equal(b.scripts.length, 0);
});

test('successful cache survives page reload and expires after the refresh interval', () => {
  const first = browser();
  request(first, 'weather'); first.reply(first.scripts[0], { valid: true });
  const second = browser(first.storage); let rendered = 0;
  request(second, 'weather', () => rendered++);
  assert.equal(rendered, 1); assert.equal(second.scripts.length, 0);
  second.advance(interval); request(second, 'weather');
  assert.equal(second.scripts.length, 1);
});

// OpenWeather errors (401 bad key, 429 rate limit, 404 unknown city) arrive as an HTTP
// error status, which a <script> tag reports as a failed load.
test('API errors keep old data and persist exponential backoff across reloads', () => {
  const b = browser(); request(b, 'weather'); b.reply(b.scripts[0], { valid: true });
  b.advance(interval); request(b, 'weather'); b.scripts[0].onerror();
  let saved = JSON.parse(Object.values(b.storage)[0]);
  assert.equal(saved.data.valid, true); assert.equal(saved.next - b.now(), interval);
  b.advance(interval); request(b, 'weather'); b.scripts[0].onerror();
  saved = JSON.parse(Object.values(b.storage)[0]);
  assert.equal(saved.next - b.now(), 2 * interval);
  const next = browser(b.storage); request(next, 'weather');
  assert.equal(next.scripts.length, 0);
  assert.match(next.elements.networkStatus.textContent, /连接失败（网络、Key 或城市名有误）/);
});

test('without data on screen, failures retry after 1, 2, 4 minutes up to the refresh interval', () => {
  const b = browser();
  const waits = [];
  for (let i = 0; i < 7; i++) {
    request(b, 'weather'); b.scripts[0].onerror();
    waits.push(JSON.parse(Object.values(b.storage)[0]).next - b.now());
    b.advance(waits[i]);
  }
  const minute = 60 * 1000;
  assert.deepEqual(waits, [minute, 2 * minute, 4 * minute, 8 * minute, 16 * minute, interval, interval]);
  request(b, 'weather'); b.reply(b.scripts[0], { valid: true });
  assert.equal(JSON.parse(Object.values(b.storage)[0]).next - b.now(), interval);
});

test('a request that timed out is retried at the next once-a-minute check, not the one after', () => {
  const b = browser();
  request(b, 'weather'); b.advance(15000); // timed out, retry due 60 s after the timeout
  assert.equal(b.scripts.length, 0);
  b.advance(45000); request(b, 'weather'); // the page's next check, 60 s after the first request
  assert.equal(b.scripts.length, 1);
});

test('timeout and late response cannot overwrite a successful cached value', () => {
  const b = browser(); request(b, 'weather'); b.reply(b.scripts[0], { valid: true, value: 'old' });
  b.advance(interval); request(b, 'weather'); const script = b.scripts[0];
  b.advance(15000); b.reply(script, { valid: true, value: 'late' });
  assert.equal(JSON.parse(Object.values(b.storage)[0]).data.value, 'old');
  assert.match(b.elements.networkStatus.textContent, /超时/);
});

test('invalid API data and script errors are contained; unavailable storage is tolerated', () => {
  const b = browser();
  b.context.localStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  request(b, 'weather'); b.reply(b.scripts[0], { cod: 200 });
  assert.match(b.elements.networkStatus.textContent, /数据不完整/);
  request(b, 'forecast'); b.scripts[0].onerror();
  assert.match(b.elements.networkStatus.textContent, /连接失败/);
});

test('time synchronization converts microseconds and compensates half the round trip', () => {
  const b = browser(); const start = b.now();
  b.context.clockNetwork.syncTime(); b.advance(200);
  const xhr = b.requests[0]; xhr.status = 200; xhr.readyState = 4;
  xhr.responseText = '<timestamp time="' + ((start + 5100) * 1000) + '"/>';
  xhr.onreadystatechange(); assert.equal(b.context.DT_Times, 5000);
  b.context.clockNetwork.syncTime(); assert.equal(b.requests.length, 1);
  b.advance(6 * 60 * 60 * 1000); b.context.clockNetwork.syncTime();
  assert.equal(b.requests.length, 2);
});

test('time timeout retains correction and retries independently after 30 minutes', () => {
  const b = browser(); b.context.DT_Times = 123;
  b.context.clockNetwork.syncTime(); b.advance(15000);
  assert.equal(b.requests[0].aborted, true); assert.equal(b.context.DT_Times, 123);
  b.advance(interval); b.context.clockNetwork.syncTime(); assert.equal(b.requests.length, 2);
});

test('clock and calendar cross midnight even with no weather response', () => {
  const b = browser();
  vm.runInContext(fs.readFileSync('vendor/moment/moment-with-locales.js', 'utf8'), b.context);
  vm.runInContext(fs.readFileSync('script.js', 'utf8'), b.context);
  b.context.sun = b.elements.sun = {};
  b.context.DT_Times = Date.parse('2026-11-03T15:59:55Z') - b.now();
  b.context.refreshClock(); assert.equal(b.elements.date.innerHTML, '26-11-03');
  b.advance(15000);
  assert.equal(b.elements.date.innerHTML, '26-11-04');
  assert.equal(b.elements.lastUpdate.innerHTML, '00:00');
});

function loadImages(b) {
  vm.runInContext(fs.readFileSync('images/icons.js', 'utf8'), b.context);
}

function fakeImage() {
  return { style: {}, removeAttribute(k) { delete this[k]; } };
}

// Wires the page elements that processActualWeather/processForecastWeather use.
function loadPage(b) {
  loadClock(b); loadImages(b);
  const c = b.context;
  c.cityNameDB = {};
  c.city = {}; c.temp = {}; c.sun = {};
  c.icon = fakeImage();
  for (let i = 0; i < 5; i++) c.forecastCells.push({ time: {}, icon: fakeImage(), temp: {}, desc: {} });
  return c;
}

function item(id, icon, dt) {
  return { dt, main: { temp: 10, feels_like: 8 }, weather: [{ id, icon, description: 'x' }] };
}

// A clear night at the first quarter moon (phase ~0.25) and four ordinary forecasts.
const firstQuarter = Date.UTC(2026, 10, 17, 12) / 1000;
function weatherData() {
  const data = item(800, '01n', firstQuarter);
  data.coord = { lat: 30 }; data.name = 'Nantong'; data.timezone = 28800;
  data.sys = { sunrise: firstQuarter - 6 * 3600, sunset: firstQuarter + 4 * 3600 };
  return data;
}
function forecastData() {
  return { city: { coord: { lat: 30 }, timezone: 28800 }, list: [
    item(800, '01n', firstQuarter), item(500, '10d', firstQuarter), item(804, '04n', firstQuarter),
    item(999, '01d', firstQuarter), item(600, '13d', firstQuarter)
  ] };
}

test('every OpenWeather id and moon phase has a PNG in both day and night sets', () => {
  const b = browser(); loadImages(b);
  const icons = b.context.weatherIcons;
  const codes = new Set([...Object.values(icons.day), ...Object.values(icons.night), ...icons.moon, icons.sunrise, icons.sunset]);
  assert.equal(icons.moon.length, 28);
  for (const id of [200, 300, 500, 600, 701, 800, 801, 804]) {
    assert.ok(icons.day[id] && icons.night[id], 'no icon for ' + id);
  }
  for (const code of codes) {
    assert.ok(fs.existsSync('images/icons/day/' + code + '.png'), code);
    assert.ok(fs.existsSync('images/icons/night/' + code + '.png'), code);
  }
});

test('clear nights show the rotated moon phase; unknown ids hide the icon', () => {
  const b = browser(); const c = loadPage(b);
  c.processActualWeather(weatherData());
  c.processForecastWeather(forecastData());
  const moons = c.weatherIcons.moon;
  const phase = c.moonPhase(new Date(firstQuarter * 1000));
  const index = Math.floor(phase * 28);
  assert.equal(c.icon.src, 'images/icons/day/' + moons[index] + '.png');
  assert.equal(c.icon.style.webkitTransform, 'rotate(60deg)'); // (30 - 90) * -1 in the first half
  assert.equal(c.forecastCells[1].icon.src, 'images/icons/day/' + c.weatherIcons.day[500] + '.png');
  assert.equal(c.forecastCells[1].icon.style.webkitTransform, '');
  assert.equal(c.forecastCells[2].icon.src, 'images/icons/day/' + c.weatherIcons.night[804] + '.png');
  assert.equal(c.forecastCells[3].icon.src, undefined);
  assert.ok(c.sun.innerHTML.indexOf('images/icons/day/' + c.weatherIcons.sunrise + '.png') >= 0);
});

test('switching to night mode redraws every icon from the night set with the opposite moon phase', () => {
  const b = browser(); const c = loadPage(b);
  c.processActualWeather(weatherData());
  c.processForecastWeather(forecastData());
  const index = Math.floor(c.moonPhase(new Date(firstQuarter * 1000)) * 28);
  c.night_mode = 'on';
  c.setNightMode();
  assert.equal(c.document.documentElement.className, 'night');
  assert.equal(c.icon.src, 'images/icons/night/' + c.weatherIcons.moon[(index + 14) % 28] + '.png');
  assert.equal(c.forecastCells[4].icon.src, 'images/icons/night/' + c.weatherIcons.day[600] + '.png');
  assert.ok(c.sun.innerHTML.indexOf('images/icons/night/' + c.weatherIcons.sunrise + '.png') >= 0);
});

test('automatic timezone follows city offset in seconds, including UTC and fractional hours', () => {
  const b = browser();
  vm.runInContext(fs.readFileSync('vendor/moment/moment-with-locales.js', 'utf8'), b.context);
  vm.runInContext(fs.readFileSync('script.js', 'utf8'), b.context);
  const instant = new Date('2026-11-03T02:00:00Z');
  function displayed() { return b.context.momentWithCorrectUtcOffset(instant).format('YYYY-MM-DD HH:mm'); }
  assert.equal(displayed(), '2026-11-03 10:00');
  b.context.dataTimeZone = -18000;
  assert.equal(displayed(), '2026-11-02 21:00');
  b.context.dataTimeZone = 0;
  assert.equal(displayed(), '2026-11-03 02:00');
  b.context.dataTimeZone = 19800;
  assert.equal(displayed(), '2026-11-03 07:30');
  b.context.utcOffset = '+09:00';
  assert.equal(displayed(), '2026-11-03 11:00');
  b.context.utcOffset = 'local';
  assert.equal(displayed(), b.context.moment(instant).format('YYYY-MM-DD HH:mm'));
  b.context.utcOffset = null;
  b.context.dataTimeZone = NaN;
  assert.equal(displayed(), '2026-11-03 10:00');
});

