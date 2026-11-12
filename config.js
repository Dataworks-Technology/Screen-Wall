// Settings and the fault log, both kept in the app's data folder.
const { app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// SCREEN_WALL_DATA points the app at a different settings folder (testing, or two walls on one machine).
if (process.env.SCREEN_WALL_DATA)
  app.setPath("userData", path.resolve(process.env.SCREEN_WALL_DATA));

const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");
const LOG_FILE = path.join(app.getPath("userData"), "screen-wall.log");

// The one settings object, shared by reference; change it in place and call save().
// token: what the control page must present. One is generated on first start.
// openAccess: true turns the token check off, for a network you fully trust.
// host: the address the control page listens on; ALL_ADDRESSES means every one.
// recent: every page that has been shown; names: the names given to some of them, by address.
// screens[].url: null = leave the display alone, "" = black, otherwise the page to show.
const ALL_ADDRESSES = "0.0.0.0";
const cfg = {
  port: 8080,
  host: ALL_ADDRESSES,
  token: "",
  openAccess: false,
  nextKey: 1,
  recent: [],
  names: {},
  screens: [],
};

// ponytail: the log is never rotated; it only gets a line per fault, add rotation if it grows.
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}`;
  console.log(line);
  fs.appendFile(LOG_FILE, line + "\n", () => {});
}

// Ten characters with no look-alikes (0/o, 1/l/i), so it can be read off the laptop and typed on a phone.
function newToken() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 10 },
    () => alphabet[crypto.randomInt(alphabet.length)],
  ).join("");
}

// Write to a temp file then rename, so a power cut can't leave half a config.
function save() {
  try {
    const tmp = CONFIG_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) {
    log("could not save config:", e.message);
  }
}

// Reads the saved settings into cfg. Returns true on the very first run.
function load() {
  let text = null;
  try {
    text = fs.readFileSync(CONFIG_FILE, "utf8");
  } catch {
    // first run: no file yet
  }
  if (text !== null) {
    try {
      const saved = JSON.parse(text);
      Object.assign(cfg, saved, {
        screens: Array.isArray(saved.screens) ? saved.screens : [],
        recent: Array.isArray(saved.recent) ? saved.recent : [],
        names: { ...saved.names },
      });
    } catch (e) {
      const kept = `${CONFIG_FILE}.bad-${Date.now()}`;
      fs.renameSync(CONFIG_FILE, kept);
      log(
        "config unreadable, starting fresh; old file kept at",
        kept,
        e.message,
      );
    }
  }
  if (!cfg.token) {
    cfg.token = newToken();
    save();
  }
  return text === null;
}

// This machine's IPv4 addresses, with the name of the network adaptor each belongs to.
function addresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || [])
      if (a.family === "IPv4" && !a.internal)
        found.push({ name, address: a.address });
  }
  return found;
}

// The address to listen on right now. A chosen address that this machine no
// longer has (adaptor unplugged, new DHCP lease) falls back to all of them, so
// the control page can never be configured out of reach.
function bindHost() {
  return addresses().some((a) => a.address === cfg.host)
    ? cfg.host
    : ALL_ADDRESSES;
}

// Where other devices can reach the control page.
function controlUrls() {
  const host = bindHost();
  const hosts =
    host === ALL_ADDRESSES ? addresses().map((a) => a.address) : [host];
  return (hosts.length ? hosts : ["localhost"]).map(
    (h) => `http://${h}:${cfg.port}`,
  );
}

// Where the laptop itself can reach it.
function localUrl() {
  const host = bindHost();
  return `http://${host === ALL_ADDRESSES ? "localhost" : host}:${cfg.port}`;
}

module.exports = {
  LOG_FILE,
  ALL_ADDRESSES,
  cfg,
  log,
  newToken,
  load,
  save,
  addresses,
  bindHost,
  controlUrls,
  localUrl,
};
