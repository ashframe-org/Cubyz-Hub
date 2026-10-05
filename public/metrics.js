(function () {
  "use strict";

  var W = 720;
  var H = 260;
  var PAD = { l: 44, r: 14, t: 16, b: 28 };
  var INNER_W = W - PAD.l - PAD.r;
  var INNER_H = H - PAD.t - PAD.b;

  var METRIC_META = {
    downloads: { label: "Downloads", color: "#6ea8fe" },
    newUsers: { label: "New users", color: "#4dd4ac" },
    activeUsers: { label: "Active users", color: "#c792ea" },
    uploads: { label: "Uploads", color: "#f7b955" },
    comments: { label: "Comments", color: "#ff8fab" },
    likes: { label: "Likes", color: "#ff6b6b" },
    forumThreads: { label: "Forum threads", color: "#8fd08f" },
    forumReplies: { label: "Forum replies", color: "#e0a458" },
  };

  var DATA = null;
  var range = "30";
  var metric = "downloads";

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function niceMax(n) {
    if (n <= 4) return Math.max(1, n);
    var mag = Math.pow(10, Math.floor(Math.log10(n)));
    var norm = n / mag;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  function monthLabel(ym) {
    var parts = String(ym || "").split("-");
    if (parts.length < 2) return ym;
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var idx = parseInt(parts[1], 10) - 1;
    return (names[idx] || parts[1]) + " '" + parts[0].slice(2);
  }

  function formatDay(iso) {
    var parts = String(iso || "").split("-");
    if (parts.length < 3) return iso;
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var idx = parseInt(parts[1], 10) - 1;
    return parseInt(parts[2], 10) + " " + (names[idx] || parts[1]) + " " + parts[0];
  }

  function clear(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function drawGrid(svg, max) {
    for (var i = 0; i <= 4; i++) {
      var value = (max / 4) * i;
      var y = PAD.t + INNER_H - (value / max) * INNER_H;
      svg.appendChild(svgEl("line", { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, class: "metrics-grid-line" }));
      var label = svgEl("text", { x: PAD.l - 6, y: y + 3, "text-anchor": "end", class: "metrics-axis-label" });
      label.textContent = formatNumber(Math.round(value));
      svg.appendChild(label);
    }
  }

  function xLabelEvery(n) {
    if (n <= 12) return 1;
    if (n <= 31) return 5;
    if (n <= 62) return 10;
    return 15;
  }

  function drawXLabels(svg, points, xOf) {
    var every = xLabelEvery(points.length);
    for (var i = 0; i < points.length; i++) {
      if (i % every !== 0 && i !== points.length - 1) continue;
      var t = svgEl("text", { x: xOf(i), y: H - 8, "text-anchor": "middle", class: "metrics-axis-label" });
      t.textContent = points[i].label;
      svg.appendChild(t);
    }
  }

  // ---- interactive hover tooltip ----
  function setHover(svg, points, xOf, linesFn) {
    if (!svg._hoverBound) {
      svg._hoverBound = true;
      svg.addEventListener("mousemove", function (e) { onHoverMove(svg, e); });
      svg.addEventListener("mouseleave", function () { onHoverLeave(svg); });
    }
    var guide = svgEl("line", { x1: 0, y1: PAD.t, x2: 0, y2: PAD.t + INNER_H, class: "metrics-guide" });
    guide.style.display = "none";
    svg.appendChild(guide);
    svg._hover = { points: points, xOf: xOf, linesFn: linesFn, guide: guide };
  }

  function onHoverMove(svg, e) {
    var cfg = svg._hover;
    if (!cfg || !cfg.points || !cfg.points.length) return;
    var rect = svg.getBoundingClientRect();
    var sx = (e.clientX - rect.left) / Math.max(1, rect.width) * W;
    var best = 0, bestD = Infinity;
    for (var i = 0; i < cfg.points.length; i++) {
      var d = Math.abs(cfg.xOf(i) - sx);
      if (d < bestD) { bestD = d; best = i; }
    }
    var gx = cfg.xOf(best);
    cfg.guide.setAttribute("x1", gx);
    cfg.guide.setAttribute("x2", gx);
    cfg.guide.style.display = "";

    var wrap = svg.parentElement;
    var tip = wrap && wrap.querySelector(".metrics-tooltip");
    if (!tip) return;
    var lines = cfg.linesFn(best) || [];
    tip.innerHTML = "";
    var title = document.createElement("div");
    title.className = "metrics-tooltip-title";
    title.textContent = cfg.points[best].label;
    tip.appendChild(title);
    lines.forEach(function (line) {
      var row = document.createElement("div");
      row.className = "metrics-tooltip-row";
      if (line.color) {
        var dot = document.createElement("span");
        dot.className = "metrics-tooltip-dot";
        dot.style.background = line.color;
        row.appendChild(dot);
      }
      var txt = document.createElement("span");
      txt.textContent = line.value;
      row.appendChild(txt);
      tip.appendChild(row);
    });
    tip.hidden = false;
    var wr = wrap.getBoundingClientRect();
    var x = e.clientX - wr.left + 14;
    var y = e.clientY - wr.top + 14;
    tip.style.left = Math.max(0, Math.min(x, wr.width - tip.offsetWidth - 4)) + "px";
    tip.style.top = Math.max(0, Math.min(y, wr.height - tip.offsetHeight - 4)) + "px";
  }

  function onHoverLeave(svg) {
    var cfg = svg._hover;
    if (cfg && cfg.guide) cfg.guide.style.display = "none";
    var wrap = svg.parentElement;
    var tip = wrap && wrap.querySelector(".metrics-tooltip");
    if (tip) tip.hidden = true;
  }

  // Line + area chart.
  function drawLineChart(svg, points, color) {
    clear(svg);
    var values = points.map(function (p) { return p.value; });
    var max = niceMax(Math.max.apply(null, values.concat([1])));
    var yOf = function (v) { return PAD.t + INNER_H - (v / max) * INNER_H; };
    var xOf = function (i) {
      return points.length === 1 ? PAD.l + INNER_W / 2 : PAD.l + (i / (points.length - 1)) * INNER_W;
    };

    drawGrid(svg, max);

    if (points.length) {
      var area = "M " + xOf(0) + " " + (PAD.t + INNER_H) + " ";
      var line = "";
      points.forEach(function (p, i) {
        var x = xOf(i);
        var y = yOf(p.value);
        area += "L " + x + " " + y + " ";
        line += (i === 0 ? "M " : "L ") + x + " " + y + " ";
      });
      area += "L " + xOf(points.length - 1) + " " + (PAD.t + INNER_H) + " Z";

      svg.appendChild(svgEl("path", { d: area, fill: color, class: "metrics-area" }));
      svg.appendChild(svgEl("path", { d: line, stroke: color, class: "metrics-line" }));

      if (points.length <= 31) {
        points.forEach(function (p, i) {
          var c = svgEl("circle", { cx: xOf(i), cy: yOf(p.value), r: 3, fill: color, class: "metrics-point" });
          c.appendChild(svgEl("title", {}, p.label + ": " + formatNumber(p.value)));
          svg.appendChild(c);
        });
      }
    }

    drawXLabels(svg, points, xOf);
    setHover(svg, points, xOf, function (i) {
      return [{ value: formatNumber(points[i].value), color: color }];
    });
  }

  // Bars (e.g. new users) with an optional overlaid line (e.g. active users).
  function drawBarLineChart(svg, points, barKey, lineKey, barColor, lineColor) {
    clear(svg);
    var barValues = points.map(function (p) { return p[barKey] || 0; });
    var lineValues = points.map(function (p) { return p[lineKey] || 0; });
    var max = niceMax(Math.max.apply(null, barValues.concat(lineValues).concat([1])));
    var yOf = function (v) { return PAD.t + INNER_H - (v / max) * INNER_H; };
    var step = INNER_W / Math.max(points.length, 1);
    var xCenter = function (i) { return PAD.l + step * i + step / 2; };

    drawGrid(svg, max);

    var barW = Math.max(2, step * 0.6);
    points.forEach(function (p, i) {
      var v = p[barKey] || 0;
      if (v <= 0) return;
      var y = yOf(v);
      var bar = svgEl("rect", {
        x: xCenter(i) - barW / 2,
        y: y,
        width: barW,
        height: PAD.t + INNER_H - y,
        rx: 2,
        fill: barColor,
        class: "metrics-bar",
      });
      bar.appendChild(svgEl("title", {}, p.label + ": " + formatNumber(v) + " new users"));
      svg.appendChild(bar);
    });

    var line = "";
    var hasLine = lineValues.some(function (v) { return v > 0; });
    if (hasLine) {
      points.forEach(function (p, i) {
        line += (i === 0 ? "M " : "L ") + xCenter(i) + " " + yOf(p[lineKey] || 0) + " ";
      });
      svg.appendChild(svgEl("path", { d: line, stroke: lineColor, class: "metrics-line" }));
    }

    drawXLabels(svg, points, xCenter);
    setHover(svg, points, xCenter, function (i) {
      return [
        { value: formatNumber(points[i].newUsers || 0) + " new users", color: barColor },
        { value: formatNumber(points[i].activeUsers || 0) + " active users", color: lineColor },
      ];
    });
  }

  function currentPoints() {
    if (range === "12m") {
      return DATA.monthly.map(function (m) {
        var point = { label: monthLabel(m.month) };
        Object.keys(METRIC_META).forEach(function (key) {
          point[key] = m[key] || 0;
        });
        return point;
      });
    }
    var count = range === "30" ? 30 : 90;
    return DATA.series.slice(-count).map(function (s) {
      return {
        label: s.day.slice(8, 10) + "/" + s.day.slice(5, 7),
        downloads: s.downloads,
        newUsers: s.newUsers,
        activeUsers: s.activeUsers,
        uploads: s.uploads,
        comments: s.comments,
        likes: s.likes,
        forumThreads: s.forumThreads,
        forumReplies: s.forumReplies,
      };
    });
  }

  function metricPoints(points, key) {
    return points.map(function (p) { return { label: p.label, value: p[key] || 0 }; });
  }

  function renderChart() {
    var svg = document.getElementById("metricsChart");
    if (!svg || !DATA) return;
    var points = currentPoints();
    var meta = METRIC_META[metric];
    drawLineChart(svg, metricPoints(points, metric), meta.color);
    document.getElementById("metricsChartTitle").textContent = meta.label;
    document.getElementById("metricsChartNote").textContent =
      meta.label + " per " + (range === "12m" ? "month" : "day") +
      " \u00b7 " + points.length + (range === "12m" ? " months" : " days") + " shown.";
  }

  function renderUsersChart() {
    var svg = document.getElementById("metricsUsersChart");
    if (!svg || !DATA) return;
    var points = currentPoints();
    drawBarLineChart(svg, points, "newUsers", "activeUsers", "#4dd4ac", "#c792ea");
  }

  function card(label, value, sub, extraClass) {
    var node = el("div", { class: "metric-card" + (extraClass ? " " + extraClass : "") });
    node.appendChild(el("span", { class: "metric-label" }, label));
    node.appendChild(el("span", { class: "metric-value" }, value));
    if (sub) node.appendChild(el("span", { class: "metric-sub" }, sub));
    return node;
  }

  function renderSummary() {
    var live = document.getElementById("metricsLive");
    var totals = document.getElementById("metricsTotals");
    if (!live || !totals || !DATA) return;
    live.innerHTML = "";
    totals.innerHTML = "";

    var last = DATA.series.length ? DATA.series[DATA.series.length - 1] : {};
    live.appendChild(card("Online now", formatNumber(DATA.online), "signed in in the last 5 min", "live"));
    live.appendChild(card("Active today", formatNumber(last.activeUsers), "unique signed-in users"));
    live.appendChild(card("Peak online today", formatNumber(last.peakOnline), "highest concurrent"));
    live.appendChild(card("Signups today", formatNumber(last.newUsers)));

    var t = DATA.totals;
    function group(title, cards) {
      var wrap = el("div", { class: "metric-group" });
      wrap.appendChild(el("h3", { class: "metric-group-title" }, title));
      var grid = el("div", { class: "metrics-totals" });
      cards.forEach(function (c) { grid.appendChild(c); });
      wrap.appendChild(grid);
      return wrap;
    }

    totals.appendChild(group("Totals", [
      card("Users", formatNumber(t.users)),
      card("Downloads", formatNumber(t.downloads)),
    ]));

    var details = document.createElement("details");
    details.className = "metrics-advanced";
    var summary = document.createElement("summary");
    summary.textContent = "Advanced metrics";
    details.appendChild(summary);
    details.appendChild(group("Content", [
      card("Addons", formatNumber(t.addons)),
      card("Mods", formatNumber(t.mods)),
      card("Models", formatNumber(t.models)),
      card("Servers", formatNumber(t.servers)),
    ]));
    details.appendChild(group("Community", [
      card("Comments", formatNumber(t.comments)),
      card("Forum threads", formatNumber(t.forumThreads)),
      card("Forum replies", formatNumber(t.forumReplies)),
    ]));
    totals.appendChild(details);
  }

  function wireControls() {
    var tabs = document.getElementById("metricsMetricTabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-metric]");
        if (!btn) return;
        metric = btn.dataset.metric;
        Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (b) {
          b.classList.toggle("active", b === btn);
        });
        renderChart();
      });
    }

    var ranges = document.querySelector(".metrics-range");
    if (ranges) {
      ranges.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-range]");
        if (!btn) return;
        range = btn.dataset.range;
        Array.prototype.forEach.call(ranges.querySelectorAll("button"), function (b) {
          b.classList.toggle("active", b === btn);
        });
        renderChart();
        renderUsersChart();
      });
    }
  }

  function showError(message) {
    var since = document.getElementById("metricsSince");
    if (since) since.textContent = message;
  }

  async function load() {
    try {
      var res = await fetch("/api/metrics", { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var json = await res.json();
      if (!json.ok) throw new Error("not ok");
      DATA = json;

      var since = document.getElementById("metricsSince");
      if (since) {
        if (json.trackingSince) {
          var days = Math.max(1, Math.floor((Date.now() - new Date(json.trackingSince + "T00:00:00Z").getTime()) / 86400000) + 1);
          since.textContent = "Tracking since " + formatDay(json.trackingSince) + " \u00b7 " + days + (days === 1 ? " day" : " days") + " of history";
        } else {
          since.textContent = "Tracking starts today \u2014 check back tomorrow for the first full day.";
        }
      }

      wireControls();
      renderSummary();
      renderChart();
      renderUsersChart();
    } catch (err) {
      console.error("Failed to load metrics:", err);
      showError("Couldn't load metrics right now.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
