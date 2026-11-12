// The control page and its small JSON API, served over the LAN.
const { app, powerMonitor, screen } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  LOG_FILE,
  ALL_ADDRESSES,
  cfg,
  log,
  newToken,
  save,
  addresses,
  bindHost,
  controlUrls,
} = require("./config");
const { execFile } = require("node:child_process");
const {
  httpError,
  isLocalRequest,
  validateToken,
  receivedBytes,
} = require("./lib");
const screens = require("./screens");
const updater = require("./updater");

const UI = fs.readFileSync(path.join(__dirname, "ui.html"));

function reply(res, status, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 10000) {
        reject(httpError(413, "Request too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!body || typeof body !== "object") throw new Error();
        resolve(body);
      } catch {
        reject(httpError(400, "Body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

const digest = (text) =>
  crypto.createHash("sha256").update(String(text)).digest();
const tokenOk = (given) =>
  crypto.timingSafeEqual(digest(given || ""), digest(cfg.token));

function state() {
  return {
    host: os.hostname(),
    version: app.getVersion(),
    recent: cfg.recent,
    names: cfg.names,
    update: updater.info,
    downloadMbps,
    screens: screens.list(),
    token: cfg.openAccess ? null : cfg.token, // shown so it can be passed to another device
    network: {
      port: cfg.port,
      chosen: cfg.host, // what the settings ask for
      listening: bound, // what is in force; differs if the chosen address has gone
      addresses: addresses(),
    },
  };
}

// How fast the whole laptop is downloading, in megabits a second: everything
// on it, not only Screen Wall. null until measured, and on anything but Windows.
let downloadMbps = null;
let lastReceived = null;
function measureDownload() {
  if (process.platform !== "win32") return;
  execFile("netstat", ["-e"], { windowsHide: true }, (error, output) => {
    const bytes = error ? null : receivedBytes(output);
    const now = Date.now();
    const before = lastReceived;
    lastReceived = bytes === null ? null : { bytes, at: now };
    // The counter starts again from nothing now and then; skip that reading.
    downloadMbps =
      before && lastReceived && bytes >= before.bytes
        ? ((bytes - before.bytes) * 8) / (now - before.at) / 1000
        : null;
  });
}

// What is needed to see why a laptop is slow without sitting in front of it.
// Goes at the top of the downloaded log.
async function diagnostics() {
  app.getAppMetrics(); // start the clock: the next call reports CPU use since this one
  const rates = await screens.frameRates(); // takes two seconds
  const gpu = await app.getGPUInfo("basic").catch(() => ({}));
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    system: `${os.type()} ${os.release()}`,
    processor: `${os.cpus()[0].model.trim()} x${os.cpus().length}`,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    onBattery: powerMonitor.isOnBatteryPower(),
    laptopDownloadMbps: downloadMbps,
    graphics: app.getGPUFeatureStatus(), // "software" or "disabled" here means no graphics acceleration
    graphicsCards: gpu.gpuDevice,
    displays: screen.getAllDisplays().map((d) => ({
      label: d.label,
      pixels: `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}`,
      scale: d.scaleFactor,
      hz: d.displayFrequency,
      internal: d.internal,
    })),
    screens: rates,
    processes: app.getAppMetrics().map((p) => ({
      type: p.name || p.type,
      cpuPercent: Math.round(p.cpu.percentCPUUsage * 10) / 10, // over the two seconds just measured
      memoryMB: Math.round(p.memory.workingSetSize / 1024),
    })),
  };
}

// POST /api/<name> with a JSON body.
const actions = {
  screen: (body) => screens.update(body.key, body),
  reload: (body) => screens.reload(body.key),
  forget: (body) => screens.forget(body.key),
  identify: () => screens.identify(),
  // Looks for a newer version; with install: true, installs it.
  update: (body) => (body.install ? updater.install() : updater.check()),
  pointer: (body) => screens.pointer(body.key, body),
  // Removes one page from the history, or all of them.
  history(body) {
    cfg.recent = body.all ? [] : cfg.recent.filter((u) => u !== body.url);
    for (const url of Object.keys(cfg.names))
      if (!cfg.recent.includes(url)) delete cfg.names[url];
    save();
  },
  // Names a page in the history, so it can be found without reading its address. An empty name removes it.
  name(body) {
    if (!cfg.recent.includes(body.url))
      throw httpError(404, "That page is not in the history");
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 60);
    if (name) cfg.names[body.url] = name;
    else delete cfg.names[body.url];
    save();
  },
  // Replaces the access token, with one typed in or a freshly generated one.
  // Every other device is asked for the new token the next time it does anything.
  token(body) {
    cfg.token = body.generate ? newToken() : validateToken(body.token);
    save();
  },
  // Chooses which of this machine's addresses the control page listens on.
  listen(body) {
    const known = addresses().some((a) => a.address === body.host);
    if (body.host !== ALL_ADDRESSES && !known)
      throw httpError(400, "This machine does not have that address");
    cfg.host = body.host;
    save();
    setTimeout(rebind, 300); // after this reply has gone out
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/")
      return reply(res, 200, UI, "text/html; charset=utf-8");
    if (!pathname.startsWith("/api/")) throw httpError(404, "Not found");
    const local = isLocalRequest(
      req.socket.remoteAddress,
      req.headers.host,
      addresses().map((a) => a.address),
    );
    if (!cfg.openAccess && !local && !tokenOk(req.headers["x-token"]))
      throw httpError(401, "Token required");
    if (req.method === "GET" && pathname === "/api/state")
      return reply(res, 200, state());
    if (req.method === "GET" && pathname === "/api/log")
      return reply(
        res,
        200,
        `${JSON.stringify(await diagnostics(), null, 2)}\n\n${await fs.promises.readFile(LOG_FILE, "utf8").catch(() => "")}`,
        "text/plain; charset=utf-8",
      );
    if (req.method === "GET" && pathname === "/api/snapshot")
      return reply(
        res,
        200,
        await screens.snapshot(searchParams.get("key")),
        "image/jpeg",
      );
    const name = pathname.slice("/api/".length);
    if (req.method !== "POST" || !Object.hasOwn(actions, name))
      throw httpError(404, "Not found");
    // Requiring JSON stops another website quietly posting here from a browser on the LAN.
    if (!/^application\/json\b/i.test(req.headers["content-type"] || ""))
      throw httpError(415, "Send application/json");
    await actions[name](await readJson(req));
    reply(res, 200, state());
  } catch (e) {
    if (!e.status) log("request failed:", e.stack || e.message);
    reply(res, e.status || 500, {
      error: e.status ? e.message : "Internal error",
    });
  }
});

let bound = null; // the address being listened on

function listen() {
  bound = bindHost();
  server.listen(cfg.port, bound);
}

function rebind() {
  server.close(listen);
  server.closeAllConnections();
}

function start() {
  listen();
  // Addresses come and go (DHCP, cables); follow them without a restart.
  setInterval(() => {
    if (server.listening && bound !== bindHost()) rebind();
    measureDownload();
  }, 10000);
}
server.on("listening", () => log("control page:", controlUrls().join(" ")));
server.on("error", (e) => {
  log(`control server: ${e.message}; trying again in 5s`);
  setTimeout(listen, 5000);
});

module.exports = { start };
