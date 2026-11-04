var DT_Times = 0;
var clockTimer = null;
var dataTimer = null;

// Diagnostics must never interrupt the task they are reporting on.
function runRefreshStep(name, action) {
  try {
    action();
  } catch (error) {
    try {
      var element = document.getElementById("runtimeStatus");
      if (element) {
        var detail = "Error [" + name + "]: " +
          String(error && error.message ? error.message : error);
        element.textContent = detail.slice(0, 80);
        element.title = detail;
      }
    } catch (ignored) {}
  }
}

function validateWeatherItem(data) {
  if (!data || !data.main || typeof data.main.temp !== "number" ||
      typeof data.main.feels_like !== "number" || !data.weather || !data.weather[0] ||
      typeof data.weather[0].icon !== "string" || typeof data.weather[0].description !== "string" ||
      typeof data.weather[0].id !== "number" || typeof data.dt !== "number") {
    throw new Error("Invalid weather item");
  }
}

function refreshActualWeather() {
  clockNetwork.weather("weather", _apiParams, refreshTime, function (data) {
    validateWeatherItem(data);
    if (!data.sys || typeof data.sys.sunrise !== "number" || typeof data.sys.sunset !== "number" ||
        !data.coord || typeof data.coord.lat !== "number" || typeof data.name !== "string") {
      throw new Error("Invalid current weather");
    }
  }, processActualWeather);
}

function refreshForecastWeather() {
  clockNetwork.weather("forecast", _apiParams, refreshTime, function (data) {
    if (!data || !data.city || !data.city.coord || typeof data.city.coord.lat !== "number" ||
        !data.list || data.list.length < forecastCount) throw new Error("Invalid forecast");
    for (var i = 0; i < forecastCount; i++) validateWeatherItem(data.list[i]);
  }, processForecastWeather);
}

function refresTT() {
  window.clearTimeout(clockTimer);
  clockTimer = window.setTimeout(refresTT, 15 * 1000);
  runRefreshStep("clock", function () {
    var now = momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times));
    document.getElementById("lastUpdate").innerHTML = now.format("HH:mm");
  });
  runRefreshStep("date", function () {
    document.getElementById("date").innerHTML =
      momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times)).format("YY-MM-DD");
  });
  runRefreshStep("calendar", updateCalendar);
  runRefreshStep("night", setNightMode);
}

function refreshData() {
  window.clearTimeout(dataTimer);
  dataTimer = window.setTimeout(refreshData, 60 * 1000);
  runRefreshStep("time-sync", function () { clockNetwork.syncTime(); });
  runRefreshStep("weather", refreshActualWeather);
  runRefreshStep("forecast", refreshForecastWeather);
}

var sunTimesHtml = "";
function updateCalendar() {
  var now = momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times));
  if (sun) sun.innerHTML = now.format("第WW周") + "&nbsp;&nbsp;" + sunTimesHtml + now.format("dddd");
}

function processForecastWeather(data) {
  dataTimeZone = data.city.timezone;
  for (var i = 0; i < forecastCount; i++) {
    var forecast = data.list[i];
    var feelsLike = tempType == "feelsLike";
    forecastsCells[i].temp.innerHTML =
      (feelsLike ? Math.round(forecast.main.feels_like) : Math.round(forecast.main.temp)) + unitsSymbolHtml;
    forecastsCells[i].icon.className = getIconClassName(forecast.weather[0], new Date(forecast.dt * 1000));
    forecastsCells[i].desc.innerHTML = forecast.weather[0].description;
    forecastsCells[i].time.innerHTML = momentWithCorrectUtcOffset(new Date(forecast.dt * 1000)).format(timeFormat);
    forecastsCells[i].temp.className = feelsLike ? "colTemp feelsLike" : "colTemp";
    forecastsCells[i].icon.style.transform = null;
    forecastsCells[i].icon.style.webkitTransform = null;
  }
  setMoonIconsRotation(data.city.coord.lat);
}

function getIconClassName(weather, date) {
  var isNight = weather.icon.slice(-1) === "n";
  if (isNight && weather.id == 800) {
    var phase = getMoonPhaseFromDate(date);
    var icon = getMoonIconClasses(phase, isNightMode());
    return icon;
  }
  return "wi wi-owm-" + (isNight ? "night-" : "day-") + weather.id;
}

function setsUnitsSymbolFromApiUrl(url) {
  if (url.indexOf("units=metric") >= 0) {
    unitsSymbolHtml = "℃";
    return;
  }
  if (url.indexOf("units=imperial") >= 0) {
    unitsSymbolHtml = "℉";
    return;
  }
  unitsSymbolHtml = "K";
  return;
}

function getApiParams() {
  if (getUrlParameter("api_params")) {
    var url = getUrlParameter("api_params");
    setsUnitsSymbolFromApiUrl(url);
    return url;
  }

  if (api_params) {
    var url = api_params;
    setsUnitsSymbolFromApiUrl(url);
    return url;
  }

  var appId = getUrlParameter("appId") ? getUrlParameter("appId") : api_appId;
  lang = getUrlParameter("lang") ? getUrlParameter("lang") : api_lang;
  if (typeof lang === "string") {
    lang = lang.split(";", 1);
  }
  var units = getUrlParameter("units") ? getUrlParameter("units") : api_units;

  var locParams = api_locParams;
  if (getUrlParameter("city")) {
    locParams = "q=" + encodeURIComponent(getUrlParameter("city"));
  } else if (getUrlParameter("lat") && getUrlParameter("lon")) {
    locParams = "lat=" + encodeURIComponent(getUrlParameter("lat")) + "&lon=" + encodeURIComponent(getUrlParameter("lon"));
  }

  if (!locParams || !appId) {
    return null;
  }

  var url = "";
  if (locParams) {
    url += locParams;
  }
  if (appId) {
    url += "&appid=" + appId;
  }
  if (lang) {
    url += "&lang=" + lang;
  }
  if (units) {
    url += "&units=" + units;
  }

  setsUnitsSymbolFromApiUrl(url);
  return url;
}

function getUrlParameter(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  var regex = new RegExp("[\\?&]" + RegExp.escape(name) + "=([^&#]*)");
  var results = regex.exec(location.search);
  if (!results) return null;
  if (!results[1]) return "";
  return decodeURIComponent(results[1].replace(/\+/g, " "));
}

RegExp.escape = function (s) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
};

function processActualWeather(data) {
  dataTimeZone = data.timezone;
  var feelsLike = tempType == "feelsLike";
  icon.className = getIconClassName(data.weather[0], new Date(data.dt * 1000));
  icon.style.transform = null;
  icon.style.webkitTransform = null;

  tt = feelsLike ? Math.round(data.main.feels_like) : Math.round(data.main.temp);
  $date = document.getElementById("date");
  $date.innerHTML = momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times)).format("YY-MM-DD");
  city.innerHTML = cityNameDB[data.name] ? cityNameDB[data.name] : data.name; // 如果有对应的城市中文名就显示中文名
  temp = document.getElementById("temp");
  temp.innerText = data.weather[0].description + tt + unitsSymbolHtml;
  temp.className = feelsLike ? "feelsLike" : "";

  var sunrise = momentWithCorrectUtcOffset(new Date(data.sys.sunrise * 1000));
  var sunset = momentWithCorrectUtcOffset(new Date(data.sys.sunset * 1000));
  _sunriseHour = sunrise.hour();
  _sunsetHour = sunset.hour();

  lastUpdate = document.getElementById("lastUpdate");
  lastUpdate.innerHTML = momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times)).format(timeFormat);
  sunTimesHtml = sunrise.format(timeFormat) + "<i class='wi wi-sunrise'></i>&nbsp;&nbsp;&nbsp;" +
    sunset.format(timeFormat) + "<i class='wi wi-sunset'></i>&nbsp;&nbsp;";
  updateCalendar();
  setNightMode();
  setMoonIconsRotation(data.coord.lat);
}

function getMoonPhase(year, month, day) {
  var lp = 2551443;
  var now = new Date(year, month - 1, day, 20, 35, 0);
  var new_moon = new Date(1970, 0, 7, 20, 35, 0);
  var phase = ((now.getTime() - new_moon.getTime()) / 1000) % lp;
  return phase / lp;
}

function getMoonPhaseFromDate(date) {
  var lp = 2551443;
  var new_moon = new Date(1970, 0, 7, 20, 35, 0);
  var phase = ((date.getTime() - new_moon.getTime()) / 1000) % lp;
  return phase / lp;
}

function getCurrentMoonPhase() {
  var now = new Date();
  return getMoonPhase(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function getMoonIconClasses(phase, isNightMode) {
  var iconInterval = 1 / moonIcons.length;
  var index = Math.floor(phase / iconInterval);
  return "wi " + moonIcons[index][isNightMode ? 1 : 0] + " moonIcon " + (phase < 0.5 ? "moonFirstHalf" : "moonSecondHalf");
}

function setMoonIconsRotation(latitude) {
  var rotation = latitude - 90;
  var elements = document.getElementsByClassName("moonIcon");

  for (var i = 0; i < elements.length; i++) {
    var direction = elements[i].className.indexOf("moonFirstHalf") !== -1 ? -1 : 1;
    var transform = "rotate(" + rotation * direction + "deg)";
    elements[i].style.transform = transform;
    elements[i].style.webkitTransform = transform;
  }
}

var cleaner = null;
var page = null;
var temp = null;
var icon = null;
var city = null;
var $date = null;
var lastUpdate = null;
var date = null;
var sun = null;
var lang = null;
var forecastsCells = null;
var forecastCount = 5;
var forcedRotation = false;
var unitsSymbolHtml = "";
var moonIcons = [
  ["wi-moon-alt-new", "wi-moon-alt-full"],
  ["wi-moon-alt-waxing-crescent-1", "wi-moon-alt-waning-gibbous-1"],
  ["wi-moon-alt-waxing-crescent-2", "wi-moon-alt-waning-gibbous-2"],
  ["wi-moon-alt-waxing-crescent-3", "wi-moon-alt-waning-gibbous-3"],
  ["wi-moon-alt-waxing-crescent-4", "wi-moon-alt-waning-gibbous-4"],
  ["wi-moon-alt-waxing-crescent-5", "wi-moon-alt-waning-gibbous-5"],
  ["wi-moon-alt-waxing-crescent-6", "wi-moon-alt-waning-gibbous-6"],
  ["wi-moon-alt-first-quarter", "wi-moon-alt-third-quarter"],
  ["wi-moon-alt-waxing-gibbous-1", "wi-moon-alt-waning-crescent-1"],
  ["wi-moon-alt-waxing-gibbous-2", "wi-moon-alt-waning-crescent-2"],
  ["wi-moon-alt-waxing-gibbous-3", "wi-moon-alt-waning-crescent-3"],
  ["wi-moon-alt-waxing-gibbous-4", "wi-moon-alt-waning-crescent-4"],
  ["wi-moon-alt-waxing-gibbous-5", "wi-moon-alt-waning-crescent-5"],
  ["wi-moon-alt-waxing-gibbous-6", "wi-moon-alt-waning-crescent-6"],
  ["wi-moon-alt-full", "wi-moon-alt-new"],
  ["wi-moon-alt-waning-gibbous-1", "wi-moon-alt-waxing-crescent-1"],
  ["wi-moon-alt-waning-gibbous-2", "wi-moon-alt-waxing-crescent-2"],
  ["wi-moon-alt-waning-gibbous-3", "wi-moon-alt-waxing-crescent-3"],
  ["wi-moon-alt-waning-gibbous-4", "wi-moon-alt-waxing-crescent-4"],
  ["wi-moon-alt-waning-gibbous-5", "wi-moon-alt-waxing-crescent-5"],
  ["wi-moon-alt-waning-gibbous-6", "wi-moon-alt-waxing-crescent-6"],
  ["wi-moon-alt-third-quarter", "wi-moon-alt-first-quarter"],
  ["wi-moon-alt-waning-crescent-1", "wi-moon-alt-waxing-gibbous-1"],
  ["wi-moon-alt-waning-crescent-2", "wi-moon-alt-waxing-gibbous-2"],
  ["wi-moon-alt-waning-crescent-3", "wi-moon-alt-waxing-gibbous-3"],
  ["wi-moon-alt-waning-crescent-4", "wi-moon-alt-waxing-gibbous-4"],
  ["wi-moon-alt-waning-crescent-5", "wi-moon-alt-waxing-gibbous-5"],
  ["wi-moon-alt-waning-crescent-6", "wi-moon-alt-waxing-gibbous-6"],
];
var timeFormat = "HH:mm";
var api_params, api_appId, api_lang, api_units, api_locParams, rotation, night_mode, refreshTime, utcOffset, tempType, cityNameDB;
utcOffset = getUrlParameter("utcOffset") ? getUrlParameter("utcOffset") : utcOffset;
tempType = getUrlParameter("tempType") ? getUrlParameter("tempType") : tempType;
var dataTimeZone = null;
var _sunsetHour = 18;
var _sunriseHour = 6;
var _apiParams = null;

if (!refreshTime) {
  refreshTime = 30 * 60 * 1000;
}

function rotate() {
  var rot = getUrlParameter("rotation") ? getUrlParameter("rotation") : rotation;
  var v = viewport();
  var isPortrait = v.height > v.width;
  if (isPortrait && rot === "ll") {
    page.className = "landscape";
    forcedRotation = true;
    page.style.transform = "rotate(90deg)";
    page.style.transformOrigin = "bottom left";
    page.style.webkitTransform = "rotate(90deg)";
    page.style.webkitTransformOrigin = "bottom left";
    page.style.position = "absolute";
    page.style.top = -v.width + "px";
    page.style.height = v.width + "px";
    page.style.width = v.height + "px";
  } else if (isPortrait && rot === "lr") {
    page.className = "landscape";
    forcedRotation = true;
    page.style.transform = "rotate(-90deg)";
    page.style.transformOrigin = "bottom right";
    page.style.webkitTransform = "rotate(-90deg)";
    page.style.webkitTransformOrigin = "top left";
    page.style.position = "absolute";
    page.style.top = v.height + "px";
    page.style.height = v.width + "px";
    page.style.width = v.height + "px";
  } else if (rot === "up") {
    page.className = isPortrait ? "portrait" : "landscape";
    forcedRotation = false;
    page.style.transform = "rotate(180deg)";
    page.style.transformOrigin = "50% 50% 0";
    page.style.webkitTransform = "rotate(180deg)";
    page.style.webkitTransformOrigin = "50% 50% 0";
  } else {
    page.className = isPortrait ? "portrait" : "landscape";
    forcedRotation = false;
    page.style.transform = "";
    page.style.transformOrigin = "";
    page.style.webkitTransform = "";
    page.style.webkitTransformOrigin = "";
    page.style.position = "";
    page.style.top = "";
    page.style.background = "";
    page.style.height = "";
    page.style.width = "";
  }
}

window.addEventListener("load", function () {
  _apiParams = getApiParams();
  if (_apiParams === null) {
    window.location = "config.html";
    return;
  }

  moment.locale(momentLocale());
  cleaner = document.getElementById("cleaner");
  page = document.getElementById("page");
  temp = document.getElementById("temp");
  icon = document.getElementById("icon");
  city = document.getElementById("city");
  city.addEventListener("click", function (event) {
    event.preventDefault();
    window.location.href = "config.html" + window.location.search;
    return false;
  });
  temp.addEventListener("click", function (event) {
    event.preventDefault();
    var newHref = window.location.href.replace(/[&?]tempType=[^&]*/, "");
    newHref = newHref + (newHref.indexOf("?") >= 0 ? "&" : "?") + "tempType=" + (tempType === "feelsLike" ? "actual" : "feelsLike");
    window.location.href = newHref;
    return false;
  });
  lastUpdate = document.getElementById("lastUpdate");
  sun = document.getElementById("sun");
  forecastsCells = [];
  for (var i = 0; i < forecastCount; i++) {
    forecastsCells.push({
      temp: document.getElementById("temp" + (i + 1)),
      icon: document.getElementById("icon" + (i + 1)),
      desc: document.getElementById("desc" + (i + 1)),
      time: document.getElementById("time" + (i + 1)),
    });
  }

  city.textContent = "设置城市";
  refresTT();
  refreshData();

  runRefreshStep("rotation", rotate);
  runRefreshStep("layout", function () { setRem("load"); });
  runRefreshStep("night", setNightMode);

  var now = new Date();
  var cleanTime = new Date().setHours(4, 0, 0);
  var diff = cleanTime - now;
  if (diff < 0) {
    diff += 86400000;
  }
  window.setTimeout("clearScreen()", diff);
});

window.addEventListener("resize", function () {
  rotate();
  setRem("resize");
});

function viewport() {
  var e = window,
    a = "inner";
  if (!("innerWidth" in window)) {
    a = "client";
    e = document.documentElement || document.body;
  }
  return { width: e[a + "Width"], height: e[a + "Height"] };
}

function setRem(prefix) {
  var v = viewport();
  var root = document.querySelector(":root");
  root.style.fontSize = (forcedRotation === false ? v.height : v.width) / 100 + "px";
}

function setNightMode() {
  var root = document.querySelector(":root");
  if (isNightMode()) {
    root.className = "night";
  } else {
    root.className = null;
  }
}

function isNightMode() {
  var mode = getUrlParameter("night") ? getUrlParameter("night") : night_mode;
  if (mode === "on") {
    return true;
  }
  if (mode === "auto") {
    return isNight(_sunsetHour, _sunriseHour);
  }
  var found = mode && mode.match(/([0-9][0-9]?)-([0-9][0-9]?)/);
  if (found) {
    return isNight(found[1], found[2]);
  }
  return false;
}

function isNight(f, t) {
  var from = parseInt(f);
  var to = parseInt(t);
  var now = momentWithCorrectUtcOffset(new Date(new Date().getTime() + DT_Times)).hour();
  if (from > to) {
    return from <= now || to > now;
  } else {
    return from <= now && to > now;
  }
}

function momentLocale() {
  var lang = getUrlParameter("lang") ? getUrlParameter("lang") : api_lang;
  if (typeof lang === "string") {
    var langs = lang.split(";", 2);
    return langs.length > 1 ? langs[1] : langs[0];
  } else {
    return null;
  }
}

function clearScreen(times) {
  if (typeof times == "undefined") {
    times = 5;
  }

  if (times <= 0) {
    cleaner.style.display = "none";
    window.setTimeout("clearScreen()", 3600000);
    return;
  }

  cleaner.style.display = "block";
  cleaner.style.background = times % 2 == 0 ? "#ffffff" : "#000000";
  window.setTimeout(function () {
    clearScreen(times - 1);
  }, 500);
}

function momentWithCorrectUtcOffset(dateTime) {
  if (typeof utcOffset === "undefined" || utcOffset === null || utcOffset === "") {
    // OpenWeather returns seconds east of UTC; Moment accepts minutes.
    // Keep the original UTC+8 fallback until weather (or its cache) is available.
    var offsetMinutes = typeof dataTimeZone === "number" && isFinite(dataTimeZone) ? dataTimeZone / 60 : 480;
    return moment(dateTime).utcOffset(offsetMinutes);
  } else if (utcOffset === "local") {
    return moment(dateTime);
  } else {
    return moment(dateTime).utcOffset(utcOffset, false);
  }
}
