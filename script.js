// ES5 only: the old Kindle browser has no fetch, Promise or arrow functions.

// Settings from config.js (declared here so a missing setting is undefined, not an error).
var api_params, api_appId, api_lang, api_units, api_locParams, rotation, night_mode, refreshTime, utcOffset, tempType, cityNameDB;

var urlParams = parseUrlParams(location.search);
utcOffset = getUrlParameter("utcOffset") || utcOffset;
tempType = getUrlParameter("tempType") || tempType;
if (!refreshTime) refreshTime = 30 * 60 * 1000;

var DT_Times = 0;          // server time minus device time, set by clockNetwork.syncTime
var dataTimeZone = null;   // city UTC offset in seconds, from the weather data
var sunriseHour = 6;
var sunsetHour = 18;
var apiParams = null;
var unitsSymbol = "";
var timeFormat = "HH:mm";
var forecastCount = 5;
var forcedRotation = false;

var clockTimer = null;
var dataTimer = null;

var page = null;
var cleaner = null;
var icon = null;
var temp = null;
var city = null;
var sun = null;
var forecastCells = [];

var currentWeather = null;  // last rendered weather data, for redrawing icons
var currentForecast = null; // last rendered forecast data, for redrawing icons
var sunrise = null;         // "HH:mm", null until weather data arrives
var sunset = null;
var sunHtml = null;
var nightClass = null;

// Diagnostics must never interrupt the task they are reporting on.
function runRefreshStep(name, action) {
  try {
    action();
  } catch (error) {
    try {
      var element = document.getElementById("runtimeStatus");
      if (element) {
        var detail = "Error [" + name + "]: " + String(error && error.message ? error.message : error);
        element.textContent = detail.slice(0, 80);
        element.title = detail;
      }
    } catch (ignored) {}
  }
}

function parseUrlParams(search) {
  var params = {};
  search.replace(/[?&]+([^=&#]+)=([^&#]*)/g, function (all, key, value) {
    params[key] = decodeURIComponent(value.replace(/\+/g, " "));
  });
  return params;
}

function getUrlParameter(name) {
  return urlParams.hasOwnProperty(name) ? urlParams[name] : null;
}

function now() {
  return momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times));
}

function momentWithCorrectUtcOffset(dateTime) {
  if (typeof utcOffset === "undefined" || utcOffset === null || utcOffset === "") {
    // OpenWeather returns seconds east of UTC; Moment accepts minutes.
    // Fall back to UTC+8 until weather (or its cache) is available.
    var offsetMinutes = typeof dataTimeZone === "number" && isFinite(dataTimeZone) ? dataTimeZone / 60 : 480;
    return moment(dateTime).utcOffset(offsetMinutes);
  } else if (utcOffset === "local") {
    return moment(dateTime);
  } else {
    return moment(dateTime).utcOffset(utcOffset, false);
  }
}

// ---- Clock ----

function refreshClock() {
  window.clearTimeout(clockTimer);
  clockTimer = window.setTimeout(refreshClock, 15 * 1000);
  runRefreshStep("clock", function () {
    document.getElementById("lastUpdate").innerHTML = now().format(timeFormat);
  });
  runRefreshStep("date", function () {
    document.getElementById("date").innerHTML = now().format("YY-MM-DD");
  });
  runRefreshStep("calendar", updateCalendar);
  runRefreshStep("night", setNightMode);
}

function updateCalendar() {
  var time = now();
  var sunTimes = sunrise === null ? "" :
    sunrise + iconImage(weatherIcons.sunrise) + "&nbsp;&nbsp;&nbsp;" +
    sunset + iconImage(weatherIcons.sunset) + "&nbsp;&nbsp;";
  var html = time.format("第WW周") + "&nbsp;&nbsp;" + sunTimes + time.format("dddd");
  // Only rewrite on change, so the sunrise/sunset images are not re-created every tick.
  if (sun && html !== sunHtml) {
    sun.innerHTML = html;
    sunHtml = html;
  }
}

// ---- Weather data ----

function validateWeatherItem(data) {
  if (!data || !data.main || typeof data.main.temp !== "number" ||
      typeof data.main.feels_like !== "number" || !data.weather || !data.weather[0] ||
      typeof data.weather[0].icon !== "string" || typeof data.weather[0].description !== "string" ||
      typeof data.weather[0].id !== "number" || typeof data.dt !== "number") {
    throw new Error("Invalid weather item");
  }
}

function refreshActualWeather() {
  clockNetwork.weather("weather", apiParams, refreshTime, function (data) {
    validateWeatherItem(data);
    if (!data.sys || typeof data.sys.sunrise !== "number" || typeof data.sys.sunset !== "number" ||
        !data.coord || typeof data.coord.lat !== "number" || typeof data.name !== "string") {
      throw new Error("Invalid current weather");
    }
  }, processActualWeather);
}

function refreshForecastWeather() {
  clockNetwork.weather("forecast", apiParams, refreshTime, function (data) {
    if (!data || !data.city || !data.city.coord || typeof data.city.coord.lat !== "number" ||
        !data.list || data.list.length < forecastCount) throw new Error("Invalid forecast");
    for (var i = 0; i < forecastCount; i++) validateWeatherItem(data.list[i]);
  }, processForecastWeather);
}

function refreshData() {
  window.clearTimeout(dataTimer);
  dataTimer = window.setTimeout(refreshData, 60 * 1000);
  runRefreshStep("weather", refreshActualWeather);
  runRefreshStep("forecast", refreshForecastWeather);
  runRefreshStep("time-sync", function () { clockNetwork.syncTime(); });
}

function shownTemp(main) {
  return Math.round(tempType == "feelsLike" ? main.feels_like : main.temp) + unitsSymbol;
}

function processActualWeather(data) {
  dataTimeZone = data.timezone;
  currentWeather = data;
  var feelsLike = tempType == "feelsLike";

  document.getElementById("date").innerHTML = now().format("YY-MM-DD");
  city.textContent = cityNameDB[data.name] || data.name; // 有对应的城市中文名就显示中文名
  temp.textContent = data.weather[0].description + shownTemp(data.main);
  temp.className = feelsLike ? "feelsLike" : "";

  var rise = momentWithCorrectUtcOffset(new Date(data.sys.sunrise * 1000));
  var set = momentWithCorrectUtcOffset(new Date(data.sys.sunset * 1000));
  sunriseHour = rise.hour();
  sunsetHour = set.hour();
  sunrise = rise.format(timeFormat);
  sunset = set.format(timeFormat);

  document.getElementById("lastUpdate").innerHTML = now().format(timeFormat);
  setNightMode();
  renderIcons();
}

function processForecastWeather(data) {
  dataTimeZone = data.city.timezone;
  currentForecast = data;
  var feelsLike = tempType == "feelsLike";
  for (var i = 0; i < forecastCount; i++) {
    var forecast = data.list[i];
    var cell = forecastCells[i];
    cell.time.innerHTML = momentWithCorrectUtcOffset(new Date(forecast.dt * 1000)).format(timeFormat);
    cell.temp.innerHTML = shownTemp(forecast.main);
    cell.temp.className = feelsLike ? "colTemp feelsLike" : "colTemp";
    cell.desc.textContent = forecast.weather[0].description;
  }
  renderIcons();
}

// ---- Icons ----
// Weather icons are PNGs pre-rendered by tools/build_images.py (images/icons.js
// holds the map), in a day set and a night set matching the page colours.

function iconSrc(code) {
  return "images/icons/" + (isNightMode() ? "night" : "day") + "/" + code + ".png";
}

function iconImage(code) {
  return "<img class='wicon' src='" + iconSrc(code) + "' alt='' />";
}

// Clear nights show the moon phase, rotated to match the latitude.
function weatherIcon(weather, date, latitude) {
  var isNightItem = weather.icon.slice(-1) === "n";
  if (!isNightItem || weather.id !== 800) {
    return { code: weatherIcons[isNightItem ? "night" : "day"][weather.id], rotate: 0 };
  }
  var moons = weatherIcons.moon;
  var phase = moonPhase(date);
  var index = Math.floor(phase * moons.length) % moons.length;
  // Night mode draws the lit part in the page's dark colour, so use the opposite phase.
  if (isNightMode()) index = (index + moons.length / 2) % moons.length;
  return { code: moons[index], rotate: (latitude - 90) * (phase < 0.5 ? -1 : 1) };
}

function showIcon(img, weather, date, latitude) {
  var shown = weatherIcon(weather, date, latitude);
  if (shown.code) img.src = iconSrc(shown.code);
  else img.removeAttribute("src");
  var transform = shown.rotate ? "rotate(" + shown.rotate + "deg)" : "";
  img.style.transform = transform;
  img.style.webkitTransform = transform;
}

// Draws every icon from the last data; also used when night mode switches the image set.
function renderIcons() {
  if (currentWeather) {
    showIcon(icon, currentWeather.weather[0], new Date(currentWeather.dt * 1000), currentWeather.coord.lat);
  }
  if (currentForecast) {
    for (var i = 0; i < forecastCount; i++) {
      var forecast = currentForecast.list[i];
      showIcon(forecastCells[i].icon, forecast.weather[0], new Date(forecast.dt * 1000), currentForecast.city.coord.lat);
    }
  }
  updateCalendar();
}

function moonPhase(date) {
  var lunarCycle = 2551443; // seconds
  var newMoon = new Date(1970, 0, 7, 20, 35, 0);
  return (((date.getTime() - newMoon.getTime()) / 1000) % lunarCycle) / lunarCycle;
}

// ---- Night mode ----

function isNightMode() {
  var mode = getUrlParameter("night") || night_mode;
  if (mode === "on") return true;
  if (mode === "auto") return isNight(sunsetHour, sunriseHour);
  var found = mode && mode.match(/([0-9][0-9]?)-([0-9][0-9]?)/);
  return found ? isNight(found[1], found[2]) : false;
}

function isNight(f, t) {
  var from = parseInt(f, 10);
  var to = parseInt(t, 10);
  var hour = now().hour();
  return from > to ? (from <= hour || to > hour) : (from <= hour && to > hour);
}

function setNightMode() {
  var className = isNightMode() ? "night" : "";
  // Only touch the root class on change: rewriting it restyles the whole page.
  if (className === nightClass) return;
  nightClass = className;
  document.documentElement.className = className;
  renderIcons();
}

// ---- Settings ----

function setUnitsSymbol(params) {
  unitsSymbol = params.indexOf("units=metric") >= 0 ? "℃" : params.indexOf("units=imperial") >= 0 ? "℉" : "K";
}

function getApiParams() {
  var params = getUrlParameter("api_params") || api_params;
  if (!params) {
    var appId = getUrlParameter("appId") || api_appId;
    var lang = (getUrlParameter("lang") || api_lang || "").split(";")[0];
    var units = getUrlParameter("units") || api_units;
    var place = api_locParams;
    if (getUrlParameter("city")) {
      place = "q=" + encodeURIComponent(getUrlParameter("city"));
    } else if (getUrlParameter("lat") && getUrlParameter("lon")) {
      place = "lat=" + encodeURIComponent(getUrlParameter("lat")) + "&lon=" + encodeURIComponent(getUrlParameter("lon"));
    }
    if (!place || !appId) return null;
    params = place + "&appid=" + appId + (lang ? "&lang=" + lang : "") + (units ? "&units=" + units : "");
  }
  setUnitsSymbol(params);
  return params;
}

// The language setting is "<OpenWeather lang>;<Moment locale if different>".
function momentLocale() {
  var lang = getUrlParameter("lang") || api_lang;
  if (typeof lang !== "string") return null;
  var langs = lang.split(";", 2);
  return langs.length > 1 ? langs[1] : langs[0];
}

// ---- Layout ----

function setRem() {
  // All sizes are in rem = 1% of the screen height (width when forced to landscape).
  document.documentElement.style.fontSize =
    (forcedRotation ? window.innerWidth : window.innerHeight) / 100 + "px";
}

function rotate() {
  var rot = getUrlParameter("rotation") || rotation;
  var width = window.innerWidth;
  var height = window.innerHeight;
  var isPortrait = height > width;
  var style = page.style;
  if (isPortrait && (rot === "ll" || rot === "lr")) {
    var left = rot === "ll";
    page.className = "landscape";
    forcedRotation = true;
    style.transform = style.webkitTransform = left ? "rotate(90deg)" : "rotate(-90deg)";
    style.transformOrigin = left ? "bottom left" : "bottom right";
    style.webkitTransformOrigin = left ? "bottom left" : "top left";
    style.position = "absolute";
    style.top = (left ? -width : height) + "px";
    style.height = width + "px";
    style.width = height + "px";
    return;
  }
  page.className = isPortrait ? "portrait" : "landscape";
  forcedRotation = false;
  style.position = style.top = style.height = style.width = "";
  if (rot === "up") {
    style.transform = style.webkitTransform = "rotate(180deg)";
    style.transformOrigin = style.webkitTransformOrigin = "50% 50% 0";
  } else {
    style.transform = style.webkitTransform = "";
    style.transformOrigin = style.webkitTransformOrigin = "";
  }
}

// Flashes the screen black/white to clear e-ink ghosting, then repeats hourly.
function clearScreen(times) {
  if (typeof times === "undefined") times = 5;
  if (times <= 0) {
    cleaner.style.display = "none";
    window.setTimeout(function () { clearScreen(); }, 60 * 60 * 1000);
    return;
  }
  cleaner.style.display = "block";
  cleaner.style.background = times % 2 === 0 ? "#ffffff" : "#000000";
  window.setTimeout(function () { clearScreen(times - 1); }, 500);
}

// ---- Start ----

window.addEventListener("load", function () {
  apiParams = getApiParams();
  if (apiParams === null) {
    window.location = "config.html";
    return;
  }

  moment.locale(momentLocale());
  page = document.getElementById("page");
  cleaner = document.getElementById("cleaner");
  icon = document.getElementById("icon");
  temp = document.getElementById("temp");
  city = document.getElementById("city");
  sun = document.getElementById("sun");
  for (var i = 0; i < forecastCount; i++) {
    forecastCells.push({
      time: document.getElementById("time" + (i + 1)),
      icon: document.getElementById("icon" + (i + 1)),
      temp: document.getElementById("temp" + (i + 1)),
      desc: document.getElementById("desc" + (i + 1))
    });
  }

  city.addEventListener("click", function (event) {
    event.preventDefault();
    window.location.href = "config.html" + window.location.search;
  });
  temp.addEventListener("click", function (event) {
    event.preventDefault();
    var href = window.location.href.replace(/[&?]tempType=[^&]*/, "");
    window.location.href = href + (href.indexOf("?") >= 0 ? "&" : "?") +
      "tempType=" + (tempType === "feelsLike" ? "actual" : "feelsLike");
  });

  city.textContent = "设置城市";
  runRefreshStep("rotation", rotate);
  runRefreshStep("layout", setRem);
  refreshClock();
  refreshData();

  // First screen clean at 04:00, then hourly.
  var cleanTime = new Date().setHours(4, 0, 0);
  var wait = cleanTime - new Date().getTime();
  window.setTimeout(function () { clearScreen(); }, wait < 0 ? wait + 24 * 60 * 60 * 1000 : wait);
});

window.addEventListener("resize", function () {
  rotate();
  setRem();
});
