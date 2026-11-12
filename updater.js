// Finds newer releases of Screen Wall on GitHub and installs one when asked.
// Nothing here runs on its own: a show must never be interrupted by an update.
const { app } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { log } = require("./config");
const { httpError, isNewer } = require("./lib");

// SCREEN_WALL_UPDATE_API points the check at a stand-in server, for testing.
const API =
  process.env.SCREEN_WALL_UPDATE_API ||
  "https://api.github.com/repos/Dataworks-Technology/Screen-Wall";
const TAG = "v";

// What the control page shows. latest is null until a newer version has been found.
const info = { latest: null, checked: false };
let installer = null; // the release file for info.latest

function ask(url, accept) {
  return fetch(url, {
    headers: { Accept: accept, "User-Agent": "update-check" },
  }).catch(() => {
    throw httpError(502, "Could not reach GitHub from this laptop");
  });
}

// Looks for a release newer than the version running.
async function check() {
  // ponytail: reads the repository's newest 100 releases; follow the pages if it ever has more.
  const res = await ask(
    `${API}/releases?per_page=100`,
    "application/vnd.github+json",
  );
  if (!res.ok) throw httpError(502, `GitHub answered ${res.status}`);
  let best = app.getVersion();
  installer = null;
  for (const release of await res.json()) {
    if (release.draft || !String(release.tag_name).startsWith(TAG)) continue;
    const version = release.tag_name.slice(TAG.length);
    const file = release.assets.find((a) => a.name.endsWith(".exe"));
    if (file && isNewer(version, best)) [best, installer] = [version, file];
  }
  info.latest = installer ? best : null;
  info.checked = true;
}

// Downloads the newer release, checks it is the file GitHub published, and
// runs it. The installer replaces the app and starts the new version.
async function install() {
  if (!installer) await check();
  if (!installer) throw httpError(409, "There is no newer version to install");
  const expected = String(installer.digest || "");
  if (!expected.startsWith("sha256:"))
    throw httpError(
      502,
      "The release has no checksum, so it was not installed",
    );
  const res = await ask(installer.url, "application/octet-stream");
  if (!res.ok) throw httpError(502, `GitHub answered ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash("sha256").update(data).digest("hex");
  if (`sha256:${actual}` !== expected)
    throw httpError(502, "The download was damaged, so it was not installed");
  if (process.platform !== "win32" || !app.isPackaged)
    throw httpError(
      400,
      "The download is good, but only the installed Windows app can install it",
    );
  const file = path.join(app.getPath("temp"), path.basename(installer.name));
  fs.writeFileSync(file, data);
  log(`installing version ${info.latest} from ${file}`);
  // /S: no questions. --force-run: start the new version when done.
  spawn(file, ["--updated", "/S", "--force-run"], {
    detached: true,
    stdio: "ignore",
  }).unref();
  setTimeout(() => app.quit(), 1000); // after the reply to the control page has gone out
}

module.exports = { info, check, install };
