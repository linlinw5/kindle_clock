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
      querySelector: () => ({ style: {} }), getElementsByClassName: () => []
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

test('429 keeps old data and persists exponential backoff across reloads', () => {
  const b = browser(); request(b, 'weather'); b.reply(b.scripts[0], { valid: true });
  b.advance(interval); request(b, 'weather'); b.reply(b.scripts[0], { cod: 429 });
  let saved = JSON.parse(Object.values(b.storage)[0]);
  assert.equal(saved.data.valid, true); assert.equal(saved.next - b.now(), interval);
  b.advance(interval); request(b, 'weather'); b.reply(b.scripts[0], { cod: '429' });
  saved = JSON.parse(Object.values(b.storage)[0]);
  assert.equal(saved.next - b.now(), 2 * interval);
  const next = browser(b.storage); request(next, 'weather');
  assert.equal(next.scripts.length, 0);
  assert.match(next.elements.networkStatus.textContent, /429/);
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
  b.context.refresTT(); assert.equal(b.elements.date.innerHTML, '26-11-03');
  b.advance(15000);
  assert.equal(b.elements.date.innerHTML, '26-11-04');
  assert.equal(b.elements.lastUpdate.innerHTML, '00:00');
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
