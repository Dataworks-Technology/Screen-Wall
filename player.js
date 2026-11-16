// Plays a stream (SRT) on a screen with mpv, in its own full-screen window
// over that screen's black one, since Chromium cannot play SRT. One mpv per screen, restarted when
// the stream drops, freezes or never starts, for as long as it takes.
const { app, nativeImage } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { log } = require("./config");
const { backoffMs } = require("./lib");

// The installer carries its own mpv, renamed so a stray one can be told apart
// from any mpv of the user's. Elsewhere, the mpv on the PATH.
const BUNDLED = app.isPackaged && process.platform === "win32";
const EXE =
  process.env.SCREEN_WALL_PLAYER ||
  (BUNDLED
    ? path.join(process.resourcesPath, "player", "screen-wall-player.exe")
    : "mpv");
const STUCK_MS = 60000; // no picture position for this long: start again
const FROZEN_CHECKS = 3; // the picture not moving for this many checks: start again
const STEADY_MS = 60000; // a stream that played this long starts its retries from the beginning

const players = new Map(); // screen key -> { proc, url, muted, place, pipe, attempt, timer, started, pos, still, status, tail }

const isStream = (url) => /^srt:/i.test(url || "");
// The log can be downloaded from the control page; keep stream passwords out of it.
const hide = (text) => String(text).replace(/(passphrase=)[^&\s]*/gi, "$1***");

function pipeFor(key) {
  const name = `screen-wall-${process.pid}-${key}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${name}`
    : path.join(os.tmpdir(), `${name}.sock`);
}

function run(key, p) {
  p.timer = null;
  p.started = Date.now();
  p.pos = null;
  p.still = 0;
  p.seen = 0; // when the player last reported a picture position
  p.status = "loading";
  p.tail = "";
  // ponytail: mpv's default buffering, not its low-latency profile; a steady
  // picture matters more here than a fraction of a second. Tune with the SRT
  // address's own latency= option.
  const proc = spawn(
    EXE,
    [
      "--no-config",
      ...p.place,
      "--ytdl=no",
      "--no-osc",
      "--osd-level=0",
      "--no-input-default-bindings",
      "--input-vo-keyboard=no",
      "--cursor-autohide=always",
      "--hwdec=auto-safe",
      "--term-osd=no",
      "--msg-level=all=warn",
      `--mute=${p.muted ? "yes" : "no"}`,
      `--input-ipc-server=${p.pipe}`,
      "--",
      p.url,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  p.proc = proc;
  proc.stderr.on("data", (d) => (p.tail = (p.tail + d).slice(-1500)));
  let ended = false;
  const end = (why) => {
    if (ended) return;
    ended = true;
    if (players.get(key) !== p || p.proc !== proc) return; // stopped on purpose
    p.proc = null;
    if (Date.now() - p.started > STEADY_MS) p.attempt = 0;
    const wait = backoffMs(p.attempt++);
    p.status = "no picture from the sender";
    log(
      `${key} stream ${why}; starting again in ${wait / 1000}s.`,
      hide(p.url),
      hide(p.tail.trim().split("\n").slice(-5).join(" | ")),
    );
    p.timer = setTimeout(() => run(key, p), wait);
  };
  proc.on("error", (e) => end(`player could not start (${e.message})`));
  proc.on("close", (code, signal) => end(`ended (${signal || code})`));
}

// Starts (or restarts) a stream on a screen; place is mpv's window options.
function play(key, { url, muted, place }) {
  stop(key);
  const p = { url, muted, place, pipe: pipeFor(key), attempt: 0 };
  players.set(key, p);
  run(key, p);
}

function stop(key) {
  const p = players.get(key);
  if (!p) return;
  players.delete(key);
  clearTimeout(p.timer);
  if (p.proc) p.proc.kill();
}

function stopAll() {
  for (const key of [...players.keys()]) stop(key);
}

// A player left behind by a crash would sit on a screen and lock its file
// against the next update. Clear any out before starting.
function clearLeftovers() {
  if (!BUNDLED) return;
  try {
    execFileSync("taskkill", ["/F", "/IM", "screen-wall-player.exe"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    // none running
  }
}

// Sends mpv one command over its control pipe; null if it does not answer.
// One at a time per player: mpv's Windows pipe can turn away a second client
// while it is still opening the next pipe instance.
function ask(key, command) {
  const p = players.get(key);
  if (!p || !p.proc) return Promise.resolve(null);
  return (p.queue = (p.queue || Promise.resolve()).then(() =>
    send(p, command),
  ));
}

function send(p, command) {
  return new Promise((done) => {
    const sock = net.connect(p.pipe);
    let text = "";
    const finish = (value) => {
      sock.destroy();
      done(value);
    };
    sock.setTimeout(3000, () => finish(null));
    sock.on("error", () => finish(null));
    sock.on("connect", () =>
      sock.write(JSON.stringify({ command, request_id: 1 }) + "\n"),
    );
    sock.on("data", (chunk) => {
      text += chunk;
      for (const line of text.split("\n")) {
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.request_id === 1)
          return finish(m.error === "success" ? (m.data ?? true) : null);
      }
    });
  });
}

const get = (key, name) => ask(key, ["get_property", name]);

// Called every probe: notes whether the picture is moving, and starts the
// stream again if it has frozen or never got going.
async function check(key) {
  const p = players.get(key);
  if (!p || !p.proc) return;
  const [pos, speed] = await Promise.all([
    get(key, "time-pos"),
    get(key, "cache-speed"),
  ]);
  if (players.get(key) !== p || !p.proc) return;
  p.mbps = typeof speed === "number" ? (speed * 8) / 1e6 : null;
  // No position: not playing yet, or one unanswered question. Only give up
  // after a whole minute without one, so a single hiccup never cuts a picture.
  if (pos === null) {
    if (!p.seen) p.status = "loading";
    if (Date.now() - (p.seen || p.started) > STUCK_MS) {
      log(`${key} stream showed nothing for ${STUCK_MS / 1000}s.`);
      p.proc.kill(); // the close handler starts it again
    }
    return;
  }
  p.seen = Date.now();
  p.status = "ok";
  p.still = pos === p.pos ? p.still + 1 : 0;
  p.pos = pos;
  if (p.still >= FROZEN_CHECKS) {
    log(`${key} stream picture froze.`, JSON.stringify(await reading(key)));
    p.proc.kill();
  }
}

function setMuted(key, muted) {
  const p = players.get(key);
  if (!p || p.muted === muted) return;
  p.muted = muted;
  ask(key, ["set_property", "mute", muted]);
}

const status = (key) => players.get(key)?.status ?? "loading";
const mbps = (key) => players.get(key)?.mbps ?? null;
const audible = (key) => {
  const p = players.get(key);
  return !!p && !p.muted && p.status === "ok";
};

// What the player knows about the stream, for the fault log's performance reading.
const READING = {
  fps: "estimated-vf-fps",
  size: "video-params/w",
  height: "video-params/h",
  codec: "video-codec",
  hardwareDecoder: "hwdec-current",
  droppedByDecoder: "decoder-frame-drop-count",
  droppedByDisplay: "frame-drop-count",
  bufferedSeconds: "demuxer-cache-duration",
  sound: "audio-codec-name",
  muted: "mute",
};
async function reading(key) {
  const names = Object.keys(READING);
  const values = await Promise.all(names.map((n) => get(key, READING[n])));
  const r = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  r.size = r.size && `${r.size}x${r.height}`;
  delete r.height;
  return { status: status(key), mbps: mbps(key), ...r };
}

// A picture of what the player is showing, for the remote view.
async function snapshot(key) {
  const file = path.join(os.tmpdir(), `screen-wall-${process.pid}-${key}.jpg`);
  const ok = await ask(key, ["screenshot-to-file", file, "video"]);
  return ok ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

module.exports = {
  isStream,
  play,
  stop,
  stopAll,
  clearLeftovers,
  check,
  setMuted,
  status,
  mbps,
  audible,
  reading,
  snapshot,
};
