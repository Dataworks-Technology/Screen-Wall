// The windows on the displays: creating them, keeping them alive, and moving
// them when displays come and go. Nothing outside this file touches a window;
// the control server uses the functions exported at the bottom.
const { app, BrowserWindow, screen, session } = require("electron");
const { cfg, log, save, controlUrls } = require("./config");
const { validateUrl, matchDisplays, backoffMs, httpError } = require("./lib");

// SCREEN_WALL_WINDOWED=1 opens small ordinary windows instead of taking over displays, for development.
const WINDOWED = !!process.env.SCREEN_WALL_WINDOWED;
const PROBE_EVERY_MS = 10000;
const HANG_MS = 15000;
const STUCK_MS = 90000;
const POINTER_IDLE_MS = 3000;
const FROZEN_PROBES = 3; // a live video showing no new frames for this many probes in a row is reloaded

// Run inside every frame of a page: for each live video (a WebRTC or camera
// stream that is meant to be playing), how many frames it has shown so far,
// plus what is needed to tell why it stopped (see "When a feed freezes" in the README).
// ponytail: does not see videos inside shadow DOM or drawn onto a canvas; walk shadow roots if a feed needs it.
const LIVE_VIDEOS = `[...document.querySelectorAll("video")]
  .filter((v) => v.srcObject && !v.paused && !v.ended && v.offsetWidth)
  .map((v) => {
    const quality = v.getVideoPlaybackQuality();
    const track = v.srcObject.getVideoTracks()[0];
    return {
      frames: quality.totalVideoFrames,
      dropped: quality.droppedVideoFrames,
      size: v.videoWidth + "x" + v.videoHeight,
      trackMuted: track ? track.muted : null, // true = nothing is arriving from the sender
      trackState: track ? track.readyState : "none",
      fullscreen: !!document.fullscreenElement,
    };
  })`;

const runtime = new Map(); // screen key -> { win, bounds, loaded, loadStarted, status, attempt, retryTimer, probing }
const connected = new Set(); // keys of screens whose display is plugged in
let quitting = false;
let syncTimer = null;
let pointerHidden = true;
let identifyUntil = 0;

function rt(key) {
  if (!runtime.has(key))
    runtime.set(key, {
      win: null,
      bounds: null,
      loaded: undefined,
      loadStarted: 0,
      status: "off",
      attempt: 0,
      retryTimer: null,
      probing: false,
    });
  return runtime.get(key);
}

function destroyWindow(r) {
  clearTimeout(r.retryTimer);
  r.retryTimer = null;
  const win = r.win;
  r.win = null;
  r.loaded = undefined;
  r.probing = false;
  r.pointerCss = null;
  r.status = "off";
  if (win && !win.isDestroyed()) win.destroy();
}

// The mouse pointer is hidden so it never sits on a picture going to air, and
// comes back while the mouse is moving so a page's own buttons can be used.
function hidePointer(r, hide) {
  if (!r.win || r.win.isDestroyed()) return;
  const wc = r.win.webContents;
  if (hide && !r.pointerCss)
    r.pointerCss = wc
      .insertCSS("* { cursor: none !important; }")
      .catch(() => null);
  if (!hide && r.pointerCss) {
    r.pointerCss.then(
      (css) =>
        css && !wc.isDestroyed() && wc.removeInsertedCSS(css).catch(() => {}),
    );
    r.pointerCss = null;
  }
}

// Windows lifts the taskbar above even an always-on-top window whenever the
// taskbar is used or flashes, and leaves it there. Put the pages back on top
// every couple of seconds, except while the identify names are up.
function keepOnTop() {
  if (WINDOWED || Date.now() < identifyUntil) return;
  for (const r of runtime.values()) {
    if (!r.win || r.win.isDestroyed()) continue;
    r.win.setAlwaysOnTop(true, "screen-saver");
    r.win.moveTop(); // does not take the keyboard
  }
}

function watchPointer() {
  let last = screen.getCursorScreenPoint();
  let moved = 0;
  setInterval(() => {
    const now = screen.getCursorScreenPoint();
    if (now.x !== last.x || now.y !== last.y) moved = Date.now();
    last = now;
    const hide = Date.now() - moved > POINTER_IDLE_MS;
    if (hide === pointerHidden) return;
    pointerHidden = hide;
    for (const r of runtime.values()) hidePointer(r, hide);
  }, 250);
}

function load(s, r) {
  clearTimeout(r.retryTimer);
  r.retryTimer = null;
  r.loaded = s.url;
  r.loadStarted = Date.now();
  r.frames = null;
  r.still = 0;
  r.status = s.url ? "loading" : "black";
  // Failures arrive through did-fail-load, which schedules the retry.
  r.win.loadURL(s.url || "about:blank").catch(() => {});
}

// Pages fail for boring reasons (venue internet drops, a feed restarts), so
// keep trying for ever rather than leave an error on a screen.
function retry(s, r, why) {
  r.status = why;
  if (r.retryTimer || !s.url) return;
  const wait = backoffMs(r.attempt++);
  log(`${s.key} ${why}; retrying in ${wait / 1000}s`);
  r.retryTimer = setTimeout(() => {
    r.retryTimer = null;
    if (r.win && !r.win.isDestroyed()) load(s, r);
  }, wait);
}

function createWindow(s, r) {
  const win = new BrowserWindow({
    ...(WINDOWED
      ? { width: 640, height: 360 }
      : { ...s.bounds, frame: false, fullscreen: true }),
    backgroundColor: "#000000",
    skipTaskbar: true,
    title: `Screen Wall ${s.key}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (!WINDOWED) win.setAlwaysOnTop(true, "screen-saver"); // above the taskbar and notifications
  r.win = win;
  r.bounds = s.bounds;
  r.attempt = 0;
  const wc = win.webContents;
  const live = () => r.win === win; // ignore events from a window we already replaced

  wc.on("did-finish-load", () => {
    if (!live() || r.retryTimer) return;
    r.attempt = 0;
    r.status = s.url ? "ok" : "black";
  });
  wc.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
    if (live() && isMainFrame && code !== -3)
      retry(s, r, `failed: ${description || code}`); // -3 = superseded by a newer load
  });
  wc.on("did-navigate", (_e, _url, httpCode) => {
    if (live() && httpCode >= 500) retry(s, r, `server error ${httpCode}`);
  });
  wc.on("render-process-gone", (_e, details) => {
    if (live() && details.reason !== "clean-exit")
      retry(s, r, `crashed: ${details.reason}`);
  });
  wc.on("dom-ready", () => {
    if (!live()) return;
    r.pointerCss = null; // a new page starts without the style
    hidePointer(r, pointerHidden);
  });
  // A page that leaves its own full-screen mode must not take the window out of full screen with it.
  win.on("leave-html-full-screen", () => {
    if (live() && !WINDOWED && !win.isFullScreen()) win.setFullScreen(true);
  });
  win.on("closed", () => {
    if (!live()) return;
    // Closed behind our back (Alt+F4, display driver reset): put it back.
    destroyWindow(r);
    if (!quitting) scheduleSync();
  });
}

// Makes one screen's window match its settings.
function apply(s) {
  const r = rt(s.key);
  if (!connected.has(s.key) || s.url === null) return destroyWindow(r);
  // A display that moved or changed resolution gets a fresh window; resizing a
  // fullscreen window in place is unreliable across platforms.
  if (r.win && JSON.stringify(r.bounds) !== JSON.stringify(s.bounds))
    destroyWindow(r);
  if (!r.win) createWindow(s, r);
  r.win.webContents.setAudioMuted(s.muted !== false);
  if (r.loaded !== s.url) load(s, r);
}

// Pairs the saved screens with the displays connected now, then applies each.
function sync() {
  const displays = screen.getAllDisplays();
  const matched = matchDisplays(cfg.screens, displays);
  const taken = new Set(matched.values());
  for (const d of displays) {
    if (taken.has(d)) continue;
    const s = { key: `s${cfg.nextKey++}`, name: "", url: null, muted: true };
    cfg.screens.push(s);
    matched.set(s, d);
  }
  // Forget unplugged displays that were never given anything to show.
  for (const s of cfg.screens)
    if (!matched.has(s) && s.url === null) destroyWindow(rt(s.key));
  cfg.screens = cfg.screens.filter((s) => matched.has(s) || s.url !== null);

  connected.clear();
  for (const s of cfg.screens) {
    const d = matched.get(s);
    if (d) {
      connected.add(s.key);
      Object.assign(s, {
        id: d.id,
        label: d.label || "",
        bounds: d.bounds,
        internal: !!d.internal,
      });
    }
    apply(s);
  }
  save();
}

// Plugging in a display fires a burst of events; wait for them to settle.
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    try {
      sync();
    } catch (e) {
      log("sync failed:", e.stack || e.message);
    }
  }, 1000);
}

// A WebRTC feed can stop delivering pictures while its page carries on as if
// nothing happened, leaving a frozen frame on the screen. Reload the page when
// a live video has shown no new frame for several probes running.
function checkVideo(s, r, videos) {
  const before = r.frames;
  r.frames = videos.map((v) => v.frames);
  const frozen =
    before && before.length === videos.length
      ? videos.filter((v, i) => v.frames === before[i])
      : [];
  r.still = frozen.length ? r.still + 1 : 0;
  if (r.still < FROZEN_PROBES) return;
  log(
    `${s.key} video froze for ${(FROZEN_PROBES * PROBE_EVERY_MS) / 1000}s, reloading the page.`,
    JSON.stringify(frozen),
  );
  load(s, r);
}

function replaceWindow(s, r, why) {
  log(`${s.key} ${why}, replacing its window`);
  destroyWindow(r);
  apply(s);
}

// Chromium only notices a frozen page when someone sends it input, and nobody
// touches these screens. So ask each page to answer a trivial script, and if
// it stays silent replace its window. (Crashing the frozen renderer and
// reloading in place was tried: the reload never finished.)
function probe() {
  for (const s of cfg.screens) {
    const r = rt(s.key);
    const win = r.win;
    if (!win || win.isDestroyed()) continue;
    if (r.status === "loading" && Date.now() - r.loadStarted > STUCK_MS) {
      replaceWindow(s, r, `still loading after ${STUCK_MS / 1000}s`);
      continue;
    }
    if (r.probing || r.status !== "ok" || win.webContents.isLoading()) continue;
    r.probing = true;
    const timer = setTimeout(() => {
      if (r.win === win)
        replaceWindow(s, r, `did not answer for ${HANG_MS / 1000}s`);
    }, HANG_MS);
    const frames = win.webContents.mainFrame.framesInSubtree;
    Promise.all(
      frames.map((f) => f.executeJavaScript(LIVE_VIDEOS).catch(() => [])),
    )
      .then((videos) => {
        if (r.win === win && r.status === "ok") checkVideo(s, r, videos.flat());
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        r.probing = false;
      });
  }
}

// What a screen is called everywhere: the name it was given, else "Screen 3".
const titleOf = (s) => s.name || `Screen ${s.key.slice(1)}`;

function findScreen(key) {
  const s = cfg.screens.find((x) => x.key === key);
  if (!s) throw httpError(404, "No such screen");
  return s;
}

const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- What the rest of the app may call ------------------------------------

// Call once, when Electron is ready.
function start() {
  app.on("before-quit", () => (quitting = true));
  // A URL that is a file rather than a page would otherwise pop a Save dialog on the laptop.
  session.defaultSession.on("will-download", (e, _item, wc) => {
    e.preventDefault();
    for (const r of runtime.values())
      if (r.win && !r.win.isDestroyed() && r.win.webContents === wc)
        r.status = "not a web page";
  });
  screen.on("display-added", scheduleSync);
  screen.on("display-removed", scheduleSync);
  screen.on("display-metrics-changed", scheduleSync);
  sync();
  setInterval(probe, PROBE_EVERY_MS);
  watchPointer();
  setInterval(keepOnTop, 2000);
}

// Every known screen with its settings, whether its display is plugged in, and what it is doing.
function list() {
  return cfg.screens.map((s) => ({
    ...s,
    title: titleOf(s),
    connected: connected.has(s.key),
    status: rt(s.key).status,
  }));
}

// Changes any of a screen's url, muted and name.
function update(key, changes) {
  const s = findScreen(key);
  if ("url" in changes) {
    if (changes.url === null || changes.url === "") s.url = changes.url;
    else {
      s.url = validateUrl(changes.url);
      // A page already in the history keeps its place, so the list does not shuffle while it is being used.
      // ponytail: history is capped at 200 pages, newest first; raise it if that is ever too few.
      if (!cfg.recent.includes(s.url))
        cfg.recent = [s.url, ...cfg.recent].slice(0, 200);
    }
  }
  if ("muted" in changes) s.muted = !!changes.muted;
  if ("name" in changes) s.name = String(changes.name).trim().slice(0, 60);
  apply(s);
  save();
}

function reload(key) {
  const s = findScreen(key);
  const r = rt(s.key);
  r.attempt = 0;
  if (r.win) load(s, r);
}

// Drops the settings of a display that is no longer plugged in.
function forget(key) {
  const s = findScreen(key);
  if (connected.has(s.key))
    throw httpError(400, "That display is still connected");
  destroyWindow(rt(s.key));
  cfg.screens = cfg.screens.filter((x) => x !== s);
  save();
}

function windowOf(key) {
  const r = rt(findScreen(key).key);
  if (!r.win || r.win.isDestroyed())
    throw httpError(409, "That screen is not showing anything");
  return r;
}

// A small JPEG of what a screen is showing, for the remote view.
// Taken only when asked for, and never two at once for the same screen.
async function snapshot(key) {
  const r = windowOf(key);
  r.shot ||= r.win.webContents.capturePage().finally(() => (r.shot = null));
  const image = await r.shot;
  if (image.isEmpty()) throw httpError(503, "No picture available yet");
  return image.resize({ width: 960 }).toJPEG(70);
}

// Moves the mouse over a screen's page from the remote view, and optionally clicks.
// x and y are fractions of the page's width and height; leave: true moves the mouse away.
function pointer(key, { x, y, click, leave }) {
  const { win } = windowOf(key);
  const wc = win.webContents;
  if (leave) return wc.sendInputEvent({ type: "mouseLeave", x: 0, y: 0 });
  if (![x, y].every((n) => typeof n === "number" && n >= 0 && n <= 1))
    throw httpError(400, "x and y must be between 0 and 1");
  const [width, height] = win.getContentSize();
  const at = { x: Math.round(x * width), y: Math.round(y * height) };
  wc.sendInputEvent({ type: "mouseMove", ...at });
  if (!click) return;
  wc.sendInputEvent({
    type: "mouseDown",
    ...at,
    button: "left",
    clickCount: 1,
  });
  wc.sendInputEvent({ type: "mouseUp", ...at, button: "left", clickCount: 1 });
}

// Shows each display's name on the display itself, so you can tell the outputs apart.
function identify() {
  const control = controlUrls().join("  ");
  identifyUntil = Date.now() + 6000;
  for (const d of screen.getAllDisplays()) {
    const s = cfg.screens.find((x) => x.id === d.id);
    const title = s ? titleOf(s) : d.label || "?";
    const html = `<body style="margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#111;color:#fff;font-family:sans-serif">
      <div style="font-size:14vw;font-weight:700">${esc(title)}</div>
      <div style="font-size:3vw">${esc(d.label || "")} ${d.bounds.width}×${d.bounds.height}</div>
      <div style="font-size:2.5vw;opacity:.7;margin-top:3vh">${esc(control)}</div></body>`;
    const win = new BrowserWindow({
      ...d.bounds,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      backgroundColor: "#111111",
    });
    win.setAlwaysOnTop(true, "screen-saver", 1);
    win
      .loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))
      .catch(() => {});
    setTimeout(() => !win.isDestroyed() && win.destroy(), 6000);
  }
}

module.exports = {
  start,
  list,
  update,
  reload,
  forget,
  identify,
  snapshot,
  pointer,
};
