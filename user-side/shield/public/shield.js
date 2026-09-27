/*
 * Spike Shield script. Served by the Shield service at http://localhost:8090/shield.js (our CDN in the
 * real product). Install in the customer's app, in <head>, before the app's own script:
 *
 *   <script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>
 *
 * A normal script (no async or defer): the Vite bundle is a module script, which the browser runs
 * later, so this always runs first. The app waits for window.SpikeShield.ready before rendering.
 *
 * 1. Asks the admit service whether this visitor can enter (POST /shield/admit).
 * 2. Admitted: lets the app start, then sends a heartbeat every 10 seconds.
 * 3. Queued: shows a full-screen waiting page with the position and an email form, retries
 *    every 5 seconds, and lets the app start once admitted.
 * 4. On pagehide: tells the service the visitor left (POST /shield/leave), so the slot frees at once.
 * 5. Service unreachable or slower than 2 seconds: lets the app start (fail open).
 *
 * The app's own code never runs for a queued visitor, so its database never sees them.
 */
(function () {
  var tag = document.currentScript;
  var site = (tag && tag.getAttribute("data-site")) || "";
  var api = ((tag && tag.getAttribute("data-api")) || "").replace(/\/+$/, "");

  var ADMIT_TIMEOUT_MS = 2000;
  var HEARTBEAT_MS = 10000;
  var RETRY_MS = 5000;

  var KEY = "spike_shield_session";
  var sessionId = null;
  try {
    sessionId = localStorage.getItem(KEY);
    if (!sessionId) {
      sessionId = newId();
      localStorage.setItem(KEY, sessionId);
    }
  } catch (e) {
    sessionId = newId(); // storage blocked: still works, just a new session per load
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var release;
  var ready = new Promise(function (resolve) { release = resolve; });
  window.SpikeShield = { ready: ready, sessionId: sessionId, site: site };

  // Fail open if the script has no config or the browser lacks fetch.
  if (!api || !site || typeof fetch !== "function" || typeof AbortController !== "function") {
    release();
    return;
  }

  function admit() {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ADMIT_TIMEOUT_MS);
    return fetch(api + "/shield/admit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: site, sessionId: sessionId }),
      signal: ctrl.signal,
    })
      .then(function (r) {
        if (!r.ok) throw new Error("admit " + r.status);
        return r.json();
      })
      .then(function (res) {
        if (!res || (res.status !== "admitted" && res.status !== "queued")) throw new Error("bad answer");
        return res;
      })
      .catch(function () { return { status: "admitted" }; }) // fail open
      .finally(function () { clearTimeout(timer); });
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    hideWaitingPage();
    release();
    setInterval(admit, HEARTBEAT_MS); // heartbeat keeps the slot
  }

  function check() {
    admit().then(function (res) {
      if (res.status === "admitted") return start();
      showWaitingPage(res.position);
      setTimeout(check, RETRY_MS);
    });
  }

  // Leaving frees the slot at once instead of after 30 seconds.
  // A plain string is sent as text/plain, which needs no CORS preflight.
  window.addEventListener("pagehide", function () {
    navigator.sendBeacon(api + "/shield/leave", JSON.stringify({ siteId: site, sessionId: sessionId }));
  });

  // Waiting page: inline styles only, no requests except our API.
  var page;
  function showWaitingPage(position) {
    if (!page) {
      page = document.createElement("div");
      page.id = "spike-shield";
      page.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
        "justify-content:center;background:#fff;color:#1a1a1a;font-family:system-ui,sans-serif;" +
        "line-height:1.5;text-align:center";
      page.innerHTML =
        '<div style="max-width:360px;padding:24px">' +
        '<h1 style="font-size:22px;margin:0 0 12px">This app is very popular right now</h1>' +
        '<p style="margin:0 0 8px">You\'re number <strong id="ss-pos"></strong> in line. This page will let you in automatically.</p>' +
        '<form id="ss-form" style="margin-top:16px">' +
        '<p style="margin:0 0 8px">Or leave your email and we\'ll tell you when you\'re in.</p>' +
        '<input id="ss-email" type="email" required placeholder="you@example.com" ' +
        'style="padding:8px;width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;font-size:15px">' +
        '<button type="submit" style="margin-top:8px;padding:8px 16px;border:0;border-radius:6px;' +
        'background:#1a1a1a;color:#fff;font-size:15px;cursor:pointer">Notify me</button>' +
        '<p style="font-size:12px;color:#666;margin:8px 0 0">We only use your email to tell you when you can get in.</p>' +
        "</form></div>";
      (document.body || document.documentElement).appendChild(page);
      page.querySelector("#ss-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var email = page.querySelector("#ss-email").value;
        fetch(api + "/shield/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId: site, sessionId: sessionId, email: email }),
        }).catch(function () {});
        page.querySelector("#ss-form").innerHTML =
          '<p style="margin-top:16px">Thanks! We\'ll email you when you\'re in.</p>';
      });
    }
    page.querySelector("#ss-pos").textContent = position == null ? "…" : String(position);
  }

  function hideWaitingPage() {
    if (page) {
      page.remove();
      page = null;
    }
  }

  check();
})();
