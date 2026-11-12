const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateUrl,
  matchDisplays,
  backoffMs,
  isLocalRequest,
  validateToken,
  isNewer,
  receivedBytes,
} = require("./lib");

test("validateUrl allows web pages only", () => {
  assert.equal(
    validateUrl("https://example.com/a?b=1"),
    "https://example.com/a?b=1",
  );
  assert.equal(validateUrl("  example.com/view "), "https://example.com/view");
  assert.equal(
    validateUrl("http://192.168.1.5:3000"),
    "http://192.168.1.5:3000/",
  );
  for (const bad of [
    "",
    "   ",
    "file:///C:/secrets.txt",
    "javascript:alert(1)",
    "chrome://gpu",
    "ftp://x.com",
    42,
    null,
    "a".repeat(2001),
  ]) {
    assert.throws(
      () => validateUrl(bad),
      { status: 400 },
      String(bad).slice(0, 30),
    );
  }
});

test("matchDisplays survives changed ids", () => {
  const b = (x) => ({ x, y: 0, width: 1920, height: 1080 });
  const saved = [
    { key: "s1", id: 1, label: "HDMI A", bounds: b(1920) },
    { key: "s2", id: 2, label: "HDMI B", bounds: b(3840) },
    { key: "s3", id: 3, label: "Projector", bounds: b(5760) },
    { key: "s4", id: 4, label: "Gone", bounds: b(9999) },
  ];
  const displays = [
    { id: 1, label: "HDMI A", bounds: b(0) }, // same id, moved
    { id: 20, label: "Renamed", bounds: b(3840) }, // new id, same position
    { id: 30, label: "Projector", bounds: b(7680) }, // new id and position, same name
    { id: 99, label: "Brand new", bounds: b(1920) },
  ];
  const m = matchDisplays(saved, displays);
  assert.equal(m.get(saved[0]), displays[0]);
  assert.equal(m.get(saved[1]), displays[1]);
  assert.equal(m.get(saved[2]), displays[2]);
  assert.equal(m.has(saved[3]), false);
  assert.equal(m.size, 3);
});

test("matchDisplays does not guess between identical monitor names", () => {
  const saved = [
    { id: 1, label: "Generic", bounds: { x: 0, y: 0, width: 1, height: 1 } },
  ];
  const displays = [
    { id: 7, label: "Generic", bounds: { x: 5, y: 0, width: 1, height: 1 } },
    { id: 8, label: "Generic", bounds: { x: 9, y: 0, width: 1, height: 1 } },
  ];
  assert.equal(matchDisplays(saved, displays).size, 0);
});

test("backoff grows then holds at 30s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 500].map(backoffMs),
    [2000, 4000, 8000, 16000, 30000, 30000],
  );
});

test("release version follows the commits", () => {
  const { nextVersion, bumpFromCommits } = require("./release");
  assert.equal(nextVersion(undefined, "auto", ""), "1.0.0");
  assert.equal(nextVersion("1.2.3", "patch", ""), "1.2.4");
  assert.equal(nextVersion("1.2.3", "minor", ""), "1.3.0");
  assert.equal(nextVersion("1.2.3", "major", ""), "2.0.0");
  assert.equal(
    nextVersion("1.9.9", "auto", "fix(screen-wall): retry\n\nbody"),
    "1.9.10",
  );
  assert.equal(
    nextVersion("1.2.3", "auto", "chore: tidy\nfeat(screen-wall): presets"),
    "1.3.0",
  );
  assert.equal(bumpFromCommits("feat(screen-wall)!: new config"), "major");
  assert.equal(
    bumpFromCommits("fix: x\n\nBREAKING CHANGE: config moved"),
    "major",
  );
  assert.equal(bumpFromCommits("docs: mention a feat: in passing"), "patch");
  assert.throws(() => nextVersion("1.0.0", "huge", ""));
});

test("only a browser on the laptop itself skips the token", () => {
  const own = ["192.168.1.50"];
  assert.equal(isLocalRequest("127.0.0.1", "localhost:8080", own), true);
  assert.equal(isLocalRequest("::1", "[::1]:8080", own), true);
  assert.equal(isLocalRequest("::ffff:127.0.0.1", "127.0.0.1:8080", own), true);
  assert.equal(isLocalRequest("192.168.1.50", "192.168.1.50:8080", own), true);
  // another device on the network
  assert.equal(isLocalRequest("192.168.1.77", "192.168.1.50:8080", own), false);
  // a website whose domain name points at this machine
  assert.equal(isLocalRequest("127.0.0.1", "evil.example:8080", own), false);
  assert.equal(isLocalRequest(undefined, undefined, own), false);
});

test("a chosen token must be typeable and not trivially short", () => {
  assert.equal(validateToken("  stage-left-2026 "), "stage-left-2026");
  for (const bad of [
    "short",
    "has a space in it",
    "",
    null,
    12345678,
    "x".repeat(65),
    "tøken-with-ø",
  ])
    assert.throws(() => validateToken(bad), { status: 400 }, String(bad));
});

test("a release is newer than the build it replaces", () => {
  assert.equal(isNewer("1.0.0", "1.0.0-build.15"), true);
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("1.10.0", "1.9.3"), true);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0-build.16", "1.0.0"), false);
  assert.equal(isNewer("0.9.9", "1.0.0-build.1"), false);
});

test("the laptop's received bytes are read from netstat -e", () => {
  const output = [
    "Interface Statistics",
    "",
    "                           Received            Sent",
    "",
    "Bytes                    3521846201       912004533",
    "Unicast packets             4182736         2210931",
  ].join("\r\n");
  assert.equal(receivedBytes(output), 3521846201);
  assert.equal(receivedBytes("nothing useful"), null);
});
