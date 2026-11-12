// Works out the next Screen Wall version for the release workflow.
//   node release.js [auto|patch|minor|major]   prints the next version
//   node release.js notes                       prints the changes since the last release
// Releases are tagged v<version>.
const { execFileSync } = require("node:child_process");

const PREFIX = "v";

// Conventional commits say how big a change is:
// a "!" or BREAKING CHANGE is major, a feat is minor, anything else is a patch.
function bumpFromCommits(log) {
  if (/^[a-z]+(\([^)]*\))?!:/m.test(log) || /^BREAKING[ -]CHANGE:/m.test(log))
    return "major";
  if (/^feat(\([^)]*\))?:/m.test(log)) return "minor";
  return "patch";
}

function nextVersion(last, type, log) {
  if (!last) return "1.0.0"; // first release
  if (type === "auto") type = bumpFromCommits(log);
  const [major, minor, patch] = last.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown release type: ${type}`);
}

function main() {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const lastTag = git("tag", "--list", `${PREFIX}*`, "--sort=-v:refname")
    .split("\n")
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const range = lastTag ? [`${lastTag}..HEAD`] : [];
  const changes = (format) =>
    git("log", "--no-merges", `--format=${format}`, ...range);

  const mode = process.argv[2] || "auto";
  if (mode === "notes") return console.log(changes("- %s"));
  const log = changes("%s%n%b");
  if (lastTag && !log) {
    console.error(`Nothing in Screen Wall has changed since ${lastTag}`);
    process.exit(1);
  }
  console.log(nextVersion(lastTag && lastTag.slice(PREFIX.length), mode, log));
}

if (require.main === module) main();

module.exports = { bumpFromCommits, nextVersion };
