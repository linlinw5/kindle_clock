// ES5 only: the Kindle browser does not support fetch/Promise.
var clockNetwork = (function () {
  var sequence = 0;
  var states = {};
  var messages = {};
  var timeout = 15000;

  function read(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* Private mode/full storage. */ }
  }

  function status(name, message) {
    messages[name] = message;
    try {
      var element = document.getElementById("networkStatus");
      if (element) {
        var lines = [];
        for (var key in messages) {
          if (messages.hasOwnProperty(key)) lines.push(messages[key]);
        }
        element.textContent = lines.join(" · ");
      }
    } catch (ignored) { /* A diagnostic display failure must not lock a request. */ }
  }

  function jsonp(url, callback) {
    var name = "clockJsonp" + (++sequence);
    var script = document.createElement("script");
    var finished = false;
    var timer;
    function finish(error, data) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      script.onerror = script.onload = null;
      if (script.parentNode) script.parentNode.removeChild(script);
      // Ignore a late response after timeout, without leaking callbacks forever.
      window[name] = function () {};
      window.setTimeout(function () { try { delete window[name]; } catch (e) { window[name] = undefined; } }, 60000);
      callback(error, data);
    }
    window[name] = function (data) { finish(null, data); };
    script.onerror = function () { finish("连接失败（网络或服务拒绝请求）"); };
    script.onload = function () { finish("响应没有有效回调"); };
    script.src = url + "&callback=" + name;
    timer = window.setTimeout(function () { finish("请求超时"); }, timeout);
    try { document.body.appendChild(script); } catch (e) { finish("无法发起请求"); }
  }

  function weather(type, params, interval, validate, render) {
    var key = "kindle-weather-v2:" + type + ":" + params;
    var state = states[key];
    var label = type === "weather" ? "天气" : "预报";
    var now = new Date().getTime();
    interval = Math.max(10 * 60 * 1000, Number(interval) || 30 * 60 * 1000);
    if (!state) {
      state = states[key] = read(key) || {};
      state.busy = false;
      if (state.data) {
        try { validate(state.data); render(state.data); }
        catch (e) { state.data = null; state.next = 0; }
      }
    }
    function show(message) {
      var stamp = "";
      try { stamp = state.updated ? momentWithCorrectUtcOffset(new Date(state.updated)).format("MM-DD HH:mm") : ""; }
      catch (ignored) {}
      status(type, label + "：" + message + (stamp ? "（上次 " + stamp + "）" : ""));
    }
    // A manually changed device clock must not suppress requests indefinitely.
    if (state.next > now + 6 * 60 * 60 * 1000) state.next = 0;
    if (state.busy) return;
    if (state.next > now) {
      show(state.error || (state.data ? "缓存" : "等待重试"));
      return;
    }
    state.busy = true;
    show(state.data ? "更新中，保留旧数据" : "连接中");
    function receive(error, data) {
      state.busy = false;
      if (!error) {
        if (data && data.cod && String(data.cod) !== "200") {
          error = "API " + data.cod + (String(data.cod) === "429" ? " 限流" : String(data.cod) === "401" ? " 密钥无效" : " 请求失败");
        } else {
          try { validate(data); } catch (e) { error = "天气数据不完整"; }
          if (!error) {
            try { render(data); } catch (e) {
              error = "Render error";
              if (typeof runRefreshStep === "function") {
                runRefreshStep(type + "-render", function () { throw e; });
              }
            }
          }
        }
      }
      var received = new Date().getTime();
      if (error) {
        state.failures = (state.failures || 0) + 1;
        state.next = received + Math.min(6 * 60 * 60 * 1000, interval * Math.pow(2, Math.min(state.failures - 1, 6)));
        state.error = error + "，稍后重试";
        show(state.error);
      } else {
        state.data = data;
        state.updated = received;
        state.next = received + interval;
        state.failures = 0;
        state.error = null;
        show("已更新");
      }
      write(key, state);
    }
    try { jsonp("https://api.openweathermap.org/data/2.5/" + type + "?" + params, receive); }
    catch (e) { receive("无法发起请求"); }
  }

  var timeBusy = false;
  var nextSync = 0;
  function syncTime() {
    var now = new Date().getTime();
    if (timeBusy || now < nextSync) return;
    timeBusy = true;
    var xhr;
    var finished = false;
    var timer;
    function finish(error) {
      if (finished) return;
      finished = true;
      timeBusy = false;
      window.clearTimeout(timer);
      nextSync = new Date().getTime() + (error ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000);
      status("time", error ? "校时：失败，继续使用设备时间及已有校正" : "校时：正常");
    }
    try {
      xhr = new XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || finished) return;
        try {
          var end = new Date().getTime();
          var match = xhr.status === 200 && xhr.responseText.match(/time="(\d+)"/);
          if (!match) { finish(true); return; }
          var serverTime = Number(match[1]) / 1000;
          if (!isFinite(serverTime) || serverTime < 1577836800000 || serverTime > 4102444800000) { finish(true); return; }
          DT_Times = serverTime - (now + end) / 2;
          finish(false);
        } catch (e) { finish(true); }
      };
      xhr.onerror = function () { finish(true); };
      timer = window.setTimeout(function () {
        finish(true);
        try { xhr.abort(); } catch (ignored) {}
      }, timeout);
      status("time", "校时：连接中");
      xhr.open("GET", "https://time.gov/widget/dhtml/at_nist_use_only.cgi?disablecache=" + now, true);
      xhr.send();
    } catch (e) { finish(true); }
  }

  return { weather: weather, syncTime: syncTime };
})();
