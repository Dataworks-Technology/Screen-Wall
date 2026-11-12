// Pure logic, kept out of main.js so it can be tested without Electron.

// An error the control server reports to the caller with this HTTP status.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
const badRequest = (message) => httpError(400, message);

// The control API takes URLs from the LAN, so only web pages are allowed:
// no file:, javascript:, chrome: and so on. A bare host gets https://.
function validateUrl(input) {
  if (typeof input !== "string" || input.length > 2000)
    throw badRequest("URL must be a string of at most 2000 characters");
  let text = input.trim();
  if (!text) throw badRequest("URL is empty");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw badRequest("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw badRequest("Only http and https URLs are allowed");
  return url.href;
}

const sameBounds = (a, b) =>
  !!a &&
  !!b &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

// Pairs saved screens with the displays connected right now. Display ids can
// change after a replug or reboot (USB adaptors especially), so fall back to
// the display's position, then to its monitor name when that is unambiguous.
// Returns Map<saved screen, display>.
function matchDisplays(saved, displays) {
  const matched = new Map();
  const taken = new Set();
  const pair = (screen, display) => {
    matched.set(screen, display);
    taken.add(display);
  };
  const freeScreens = () => saved.filter((s) => !matched.has(s));
  const freeDisplays = () => displays.filter((d) => !taken.has(d));

  for (const s of freeScreens()) {
    const d = freeDisplays().find((d) => d.id === s.id);
    if (d) pair(s, d);
  }
  for (const s of freeScreens()) {
    const d = freeDisplays().find((d) => sameBounds(d.bounds, s.bounds));
    if (d) pair(s, d);
  }
  for (const s of freeScreens()) {
    if (!s.label) continue;
    const screens = freeScreens().filter((o) => o.label === s.label);
    const candidates = freeDisplays().filter((d) => d.label === s.label);
    if (screens.length === 1 && candidates.length === 1) pair(s, candidates[0]);
  }
  return matched;
}

// A token someone chose for themselves: long enough not to be guessed in a
// hurry, and plain characters only so it can be typed on any keyboard.
function validateToken(input) {
  const token = typeof input === "string" ? input.trim() : "";
  if (!/^[\x21-\x7e]{8,64}$/.test(token))
    throw badRequest(
      "The token must be 8 to 64 letters, numbers or symbols, with no spaces",
    );
  return token;
}

// Is this request from a browser on the laptop itself? Those need no token, so
// the token can always be looked up there. Both tests matter: the connection
// must come from one of the machine's own addresses, and the browser must have
// asked for the machine by address (or "localhost"), not by a domain name. The
// second stops a hostile website that points its own domain at this machine
// from borrowing the laptop's trust.
function isLocalRequest(remoteAddress, hostHeader, ownAddresses) {
  const own = new Set(["127.0.0.1", "::1", ...ownAddresses]);
  const from = String(remoteAddress || "").replace(/^::ffff:/, "");
  const host = String(hostHeader || "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  return own.has(from) && (host === "localhost" || own.has(host));
}

// 2s, 4s, 8s, 16s, then every 30s for as long as it takes.
const backoffMs = (attempt) =>
  Math.min(30000, 2000 * 2 ** Math.min(attempt, 10));

// Is version a newer than version b? "1.0.0" is newer than "1.0.0-build.15":
// pull request builds carry a -build suffix and every release beats them.
function isNewer(a, b) {
  const parse = (v) => {
    const [core, suffix] = String(v).split("-");
    return { parts: core.split(".").map(Number), suffix };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++)
    if ((x.parts[i] || 0) !== (y.parts[i] || 0))
      return (x.parts[i] || 0) > (y.parts[i] || 0);
  return !x.suffix && !!y.suffix;
}

module.exports = {
  isNewer,
  validateUrl,
  matchDisplays,
  backoffMs,
  httpError,
  isLocalRequest,
  validateToken,
};
