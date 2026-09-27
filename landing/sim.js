// Spike Shield demo pages: one simulation engine, one scenario per page (body[data-step]).
// Everything is fake and runs in the browser: no backend, no real visitors. For the pitch only.
(function () {
  var BREAK = 24;          // the app breaks at about this many people at once (what the check finds)
  var THRESHOLD = 20;      // the threshold the check suggests
  var TICK_MS = 500;
  var NAMES = ["mia", "leo", "ava", "noah", "zoe", "eli", "ivy", "max", "ana", "kai", "lia", "ben", "nora", "sam", "eva", "tom", "ida", "jun", "ola", "rei"];
  var DOMAINS = ["gmail.com", "proton.me", "outlook.com", "icloud.com", "hey.com"];

  var S = {};
  var timers = [];
  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ["appPill", "checkBtn", "checkProgress", "scoreBox", "scoreRing", "scoreNum", "scoreTitle", "scoreSub", "findings", "checkHint", "calls",
    "installPill", "installBtn", "shieldPill", "shieldToggle", "threshold", "thrFrom", "shieldHint",
    "clock", "sActive", "sQueued", "sErr", "sErrBox", "sEmails", "chart", "presets", "hHealth", "hErr", "hP95",
    "visitor", "vTitle", "vBody", "vNote", "emails", "emailCount", "notices", "noticeCount", "replayBtn", "caption"
  ].forEach(function (id) { el[id] = $(id); });

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function fmtClock(t) { var s = Math.floor(t); var m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function later(ms, fn) { var id = setTimeout(fn, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function email() { return pick(NAMES) + Math.floor(10 + Math.random() * 89) + "@" + pick(DOMAINS); }

  function freshState() {
    return { target: 20, visitors: 20, installed: false, shieldOn: false, threshold: 30, errors: 0, p95: 180,
      emails: [], notices: [], t: 0, history: [], silent: false };
  }

  // ---------- model ----------
  function step() {
    S.t += TICK_MS / 1000;
    var diff = S.target - S.visitors;
    S.visitors += diff * (diff > 0 ? 0.12 : 0.07);
    if (Math.abs(diff) < 1) S.visitors = S.target;
    var v = Math.round(S.visitors);
    var protectedNow = S.shieldOn && S.installed;
    var active = protectedNow ? Math.min(v, S.threshold) : v;
    var queued = protectedNow ? Math.max(0, v - S.threshold) : 0;

    var over = Math.max(0, active - BREAK);
    var errTarget = over === 0 ? (active > BREAK * 0.8 ? 2 : 0) : Math.min(100, Math.round(20 + (over / BREAK) * 60));
    S.errors += (errTarget - S.errors) * 0.35;
    var p95Target = over === 0 ? 180 + active * 12 : Math.min(12000, 1500 + over * 90);
    S.p95 += (p95Target - S.p95) * 0.3;

    if (queued > 0 && S.emails.length < 60 && Math.random() < 0.45) {
      var e = email();
      if (S.emails.indexOf(e) < 0) { S.emails.push(e); if (!S.silent) renderEmail(e, true); }
    }
    var pending = S.emails.length - S.notices.length;
    if (pending > 0 && queued < S.emails.length - S.notices.length && Math.random() < 0.6) {
      var who = S.emails[S.notices.length];
      S.notices.push(who); if (!S.silent) renderNotice(who, true);
    }
    S.history.push({ active: active, queued: queued, err: Math.round(S.errors), thr: protectedNow ? S.threshold : null });
    if (S.history.length > 180) S.history.shift();
    return { v: v, active: active, queued: queued };
  }
  function tick() { var r = step(); render(r.v, r.active, r.queued); }
  function warm(n) { S.silent = true; var r; for (var i = 0; i < n; i++) r = step(); S.silent = false; return r; }

  // ---------- render ----------
  function setText(node, text) { if (node) node.textContent = text; }
  function render(v, active, queued) {
    var err = Math.round(S.errors);
    setText(el.clock, fmtClock(S.t));
    setText(el.sActive, active); setText(el.sQueued, queued); setText(el.sErr, err + "%");
    if (el.sErrBox) el.sErrBox.className = "stat" + (err > 5 ? " bad" : "");
    setText(el.sEmails, S.emails.length);
    setText(el.hErr, err + "%"); setText(el.hP95, fmtMs(S.p95));
    var health = err > 40 ? "Down" : err > 5 ? "Degraded" : "Healthy";
    setText(el.hHealth, health);
    if (el.appPill) {
      el.appPill.className = "pill " + (health === "Down" ? "bad" : health === "Degraded" ? "warn" : v > 60 ? "ok" : "off");
      el.appPill.innerHTML = "<i></i>" + (v > 60 ? "Spike: " + v + " visitors" : "Quiet: " + v + " visitors") + " · " + health;
    }
    if (el.visitor) {
      if (S.shieldOn && S.installed && queued > 0) {
        el.visitor.className = "waiting on";
        el.vTitle.textContent = "This app is very popular right now";
        el.vBody.innerHTML = "You're number <b class=\"num\">" + queued + "</b> in line. Leave your email and we'll tell you when you're in.";
        el.vNote.textContent = "Visitor #" + v + " · the database never hears from them";
      } else if (err > 5) {
        el.visitor.className = "waiting err";
        el.vTitle.textContent = "Something went wrong";
        el.vBody.textContent = "The app could not load its data. Please try again later.";
        el.vNote.textContent = "Visitor #" + v + " · Supabase " + (err > 40 ? "is down" : "is struggling") + ", " + err + "% of requests fail";
      } else {
        el.visitor.className = "waiting ok";
        el.vTitle.textContent = "Idea Roaster";
        el.vBody.textContent = "Feed loads in " + fmtMs(S.p95) + ".";
        el.vNote.textContent = "Visitor #" + v + " · in the app";
      }
    }
    drawChart();
  }

  function drawChart() {
    var c = el.chart; if (!c) return;
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var ctx = c.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    var padL = 34, padR = 10, padT = 12, padB = 18, n = 180, maxY = 100;
    S.history.forEach(function (p) { maxY = Math.max(maxY, p.active + p.queued, p.thr || 0); });
    maxY = Math.ceil(maxY * 1.15 / 50) * 50;
    var x = function (i) { return padL + (i / (n - 1)) * (w - padL - padR); };
    var y = function (val) { return h - padB - (val / maxY) * (h - padT - padB); };
    var off = n - S.history.length;
    ctx.font = "11px 'Instrument Sans', sans-serif"; ctx.fillStyle = css("--ink-2"); ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (f) { var val = Math.round(maxY * f), yy = y(val); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(String(val), padL - 6, yy + 4); });
    ctx.textAlign = "left"; ctx.fillText("last 90 s", padL, h - 4);
    if (!S.history.length) return;
    ctx.beginPath();
    S.history.forEach(function (p, i) { var xx = x(off + i); i ? ctx.lineTo(xx, y(p.active + p.queued)) : ctx.moveTo(xx, y(p.active + p.queued)); });
    for (var i = S.history.length - 1; i >= 0; i--) ctx.lineTo(x(off + i), y(S.history[i].active));
    ctx.closePath(); ctx.fillStyle = css("--queue-soft"); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x(off), y(0));
    S.history.forEach(function (p, i) { ctx.lineTo(x(off + i), y(p.active)); });
    ctx.lineTo(x(n - 1), y(0)); ctx.closePath(); ctx.fillStyle = css("--admit-soft"); ctx.fill();
    ctx.beginPath(); S.history.forEach(function (p, i) { var xx = x(off + i); i ? ctx.lineTo(xx, y(p.active)) : ctx.moveTo(xx, y(p.active)); });
    ctx.lineWidth = 2; ctx.strokeStyle = css("--admit"); ctx.stroke();
    ctx.beginPath(); S.history.forEach(function (p, i) { var xx = x(off + i); i ? ctx.lineTo(xx, y(p.active + p.queued)) : ctx.moveTo(xx, y(p.active + p.queued)); });
    ctx.lineWidth = 1.5; ctx.strokeStyle = css("--queue"); ctx.stroke();
    ctx.beginPath(); S.history.forEach(function (p, i) { var xx = x(off + i), yy = y((p.err / 100) * maxY); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.lineWidth = 1.5; ctx.strokeStyle = css("--down"); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); var any = false;
    S.history.forEach(function (p, i) { if (p.thr == null) return; var xx = x(off + i); any ? ctx.lineTo(xx, y(p.thr)) : ctx.moveTo(xx, y(p.thr)); any = true; });
    if (any) { ctx.lineWidth = 1.5; ctx.strokeStyle = css("--ink-2"); ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
  }

  function renderEmail(addr, fresh) {
    if (!el.emails) return;
    var empty = el.emails.querySelector(".empty"); if (empty) el.emails.innerHTML = "";
    var row = document.createElement("div"); row.className = "row" + (fresh ? " new" : "");
    row.innerHTML = "<span class=\"mono\">" + addr + "</span><span class=\"muted num\">" + fmtClock(S.t) + "</span>";
    el.emails.prepend(row); setText(el.emailCount, S.emails.length);
    if (fresh) setTimeout(function () { row.className = "row"; }, 1500);
  }
  function renderNotice(who, fresh) {
    if (!el.notices) return;
    var empty = el.notices.querySelector(".empty"); if (empty) el.notices.innerHTML = "";
    var row = document.createElement("div"); row.className = "row" + (fresh ? " new" : "");
    row.innerHTML = "<span>You're in: <span class=\"mono\">" + who + "</span></span><span class=\"muted num\">" + fmtClock(S.t) + "</span>";
    el.notices.prepend(row); setText(el.noticeCount, S.notices.length);
    if (fresh) setTimeout(function () { row.className = "row"; }, 1500);
  }

  // ---------- controls ----------
  function setTarget(t) {
    S.target = t;
    if (el.presets) Array.prototype.forEach.call(el.presets.querySelectorAll(".preset"), function (b) { b.className = "preset" + (Number(b.dataset.target) === t ? " on" : ""); });
  }
  if (el.presets) el.presets.addEventListener("click", function (e) { var b = e.target.closest(".preset"); if (b) setTarget(Number(b.dataset.target)); });

  function runCheck(done) {
    if (!el.checkBtn) return;
    el.checkBtn.disabled = true;
    if (el.checkProgress) el.checkProgress.hidden = false;
    if (el.scoreBox) el.scoreBox.hidden = true;
    if (el.findings) el.findings.hidden = true;
    if (el.calls) el.calls.hidden = true;
    var bar = el.checkProgress ? el.checkProgress.querySelector("i") : null, p = 0;
    setText(el.checkHint, "Replaying visitors against the app: 10 → 300 over 60 seconds…");
    var iv = setInterval(function () {
      p += 8; if (bar) bar.style.width = Math.min(100, p) + "%";
      if (p < 100) return;
      clearInterval(iv);
      if (el.checkProgress) el.checkProgress.hidden = true;
      el.checkBtn.disabled = false; el.checkBtn.textContent = "Re-check";
      var protectedNow = S.shieldOn && S.installed, score = protectedNow ? 91 : 31;
      if (el.scoreBox) el.scoreBox.hidden = false;
      if (el.findings) el.findings.hidden = protectedNow;
      if (el.calls) el.calls.hidden = false;
      if (el.scoreRing) { el.scoreRing.style.setProperty("--pct", score); el.scoreRing.style.setProperty("--ring", protectedNow ? "var(--admit)" : "var(--down)"); }
      setText(el.scoreNum, score);
      if (protectedNow) {
        setText(el.scoreTitle, "Protected: 300 visitors, 0 failed requests");
        setText(el.scoreSub, "Above " + S.threshold + " people the Shield queues visitors, so the database never sees the spike.");
        setText(el.checkHint, "The code smells are still there, but the app stays up. The fix prompts remain available.");
      } else {
        setText(el.scoreTitle, "Breaks at about " + BREAK + " people at the same time");
        setText(el.scoreSub, "The feed query fails first: 5xx and timeouts above " + BREAK + " visitors at once.");
        setText(el.checkHint, "Every finding comes with a prompt for your AI coding tool. The Shield's threshold is pre-filled from this breaking point.");
        if (el.threshold) { el.threshold.value = THRESHOLD; S.threshold = THRESHOLD; if (el.thrFrom) el.thrFrom.hidden = false; }
      }
      if (done) done();
    }, 110);
  }
  if (el.checkBtn) el.checkBtn.addEventListener("click", function () { runCheck(); });
  if (el.findings) el.findings.addEventListener("click", function (e) {
    var a = e.target.closest("[data-fix]"); if (!a) return; e.preventDefault();
    setCaption("Fix prompt for <b>fix/" + a.dataset.fix + "</b>: \"" + a.dataset.prompt + "\"");
  });

  function install() {
    S.installed = true;
    if (el.installPill) { el.installPill.className = "pill ok"; el.installPill.innerHTML = "<i></i>Installed"; }
    if (el.installBtn) { el.installBtn.textContent = "Applied"; el.installBtn.disabled = true; }
    setText(el.shieldHint, "Script installed. Turn the Shield on; the threshold comes from the check.");
  }
  if (el.installBtn) el.installBtn.addEventListener("click", install);

  function setShield(on) {
    if (on && !S.installed) { setCaption("Apply the install prompt first: without the script in the app, the Shield has nothing to protect."); return; }
    S.shieldOn = on;
    if (el.shieldToggle) el.shieldToggle.setAttribute("aria-checked", on ? "true" : "false");
    if (el.shieldPill) { el.shieldPill.className = "pill " + (on ? "ok" : "off"); el.shieldPill.innerHTML = "<i></i>" + (on ? "On · threshold " + S.threshold : "Off"); }
  }
  if (el.shieldToggle) el.shieldToggle.addEventListener("click", function () { setShield(el.shieldToggle.getAttribute("aria-checked") !== "true"); });
  if (el.threshold) el.threshold.addEventListener("input", function () {
    S.threshold = Math.max(1, Number(el.threshold.value) || 1);
    if (el.thrFrom) el.thrFrom.hidden = true;
    if (S.shieldOn && el.shieldPill) el.shieldPill.innerHTML = "<i></i>On · threshold " + S.threshold;
  });
  function setCaption(html) { if (el.caption) el.caption.innerHTML = html; }

  // ---------- scenarios, one per page ----------
  function spikeHistory(n) { S.target = 300; S.visitors = 300; S.errors = 95; S.p95 = 9000; warm(n); }
  var SCENARIOS = {
    1: function () { later(700, function () { runCheck(); }); },
    2: function () { setTarget(20); warm(40); later(2500, function () { setTarget(300); setCaption("<b>Launch.</b> 300 visitors hit the app. Watch the failed requests climb and what a visitor sees."); }); },
    3: function () {
      spikeHistory(50);
      if (el.threshold) { el.threshold.value = THRESHOLD; S.threshold = THRESHOLD; if (el.thrFrom) el.thrFrom.hidden = false; }
      later(2500, function () { install(); setCaption("<b>Prompt applied.</b> The app now loads shield.js and waits for it before rendering. Now turn the Shield on."); });
      later(5500, function () { setShield(true); setCaption("<b>Shield on</b> with threshold " + THRESHOLD + " from the check. Visitors above it go to the waiting page. Next page: what happens to the errors."); });
    },
    4: function () {
      spikeHistory(30); S.installed = true; S.threshold = THRESHOLD; S.shieldOn = true;
      if (el.shieldPill) { el.shieldPill.className = "pill ok"; el.shieldPill.innerHTML = "<i></i>On · threshold " + THRESHOLD; }
      if (el.installPill) { el.installPill.className = "pill ok"; el.installPill.innerHTML = "<i></i>Installed"; }
      warm(24); S.emails.slice().reverse().forEach(function (e) { renderEmail(e, false); });
    },
    5: function () {
      spikeHistory(20); S.installed = true; S.threshold = THRESHOLD; S.shieldOn = true;
      if (el.shieldPill) { el.shieldPill.className = "pill ok"; el.shieldPill.innerHTML = "<i></i>On · threshold " + THRESHOLD; }
      warm(60); S.emails.slice().reverse().forEach(function (e) { renderEmail(e, false); });
      later(3000, function () { setTarget(20); setCaption("<b>Back to quiet.</b> The line drains and the people who left an email get \"you're in\"."); });
    },
    6: function () {
      S.installed = true; S.threshold = THRESHOLD; S.shieldOn = true; setTarget(20); warm(40);
      if (el.shieldPill) { el.shieldPill.className = "pill ok"; el.shieldPill.innerHTML = "<i></i>On · threshold " + THRESHOLD; }
      if (el.threshold) el.threshold.value = THRESHOLD;
      later(700, function () { setTarget(300); runCheck(function () { setTarget(20); }); });
    }
  };

  var stepNo = Number(document.body.dataset.step || 1);
  var ticker = null;
  function start() {
    clearTimers(); if (ticker) clearInterval(ticker);
    S = freshState();
    if (el.emails) { el.emails.innerHTML = "<span class=\"empty\">Nobody in line yet.</span>"; setText(el.emailCount, "0"); }
    if (el.notices) { el.notices.innerHTML = "<span class=\"empty\">Sent when a slot frees up for someone who left an email.</span>"; setText(el.noticeCount, "0"); }
    if (el.checkBtn) { el.checkBtn.textContent = "Run check"; el.checkBtn.disabled = false; }
    if (el.scoreBox) el.scoreBox.hidden = true; if (el.findings) el.findings.hidden = true; if (el.calls) el.calls.hidden = true;
    if (el.installPill) { el.installPill.className = "pill off"; el.installPill.innerHTML = "<i></i>Not installed"; }
    if (el.installBtn) { el.installBtn.textContent = "Apply prompt"; el.installBtn.disabled = false; }
    if (el.shieldToggle) el.shieldToggle.setAttribute("aria-checked", "false");
    if (el.shieldPill) { el.shieldPill.className = "pill off"; el.shieldPill.innerHTML = "<i></i>Off"; }
    if (el.thrFrom) el.thrFrom.hidden = true;
    if (el.caption) el.caption.innerHTML = el.caption.dataset.initial || "";
    setTarget(20); warm(20);
    (SCENARIOS[stepNo] || SCENARIOS[1])();
    if (el.shieldToggle) el.shieldToggle.setAttribute("aria-checked", S.shieldOn ? "true" : "false");
    render(Math.round(S.visitors), S.shieldOn ? Math.min(Math.round(S.visitors), S.threshold) : Math.round(S.visitors), S.shieldOn ? Math.max(0, Math.round(S.visitors) - S.threshold) : 0);
    ticker = setInterval(tick, TICK_MS);
  }
  if (el.replayBtn) el.replayBtn.addEventListener("click", start);
  window.addEventListener("resize", drawChart);
  if (window.matchMedia) { var mq = window.matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", drawChart); }
  if (el.caption) el.caption.dataset.initial = el.caption.innerHTML;
  start();
})();
