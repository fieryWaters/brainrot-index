// Writes extension/build-info.json with the current short git commit and whether the working tree has
// uncommitted changes. The extension attaches this to feedback so each report names the code it came from.
// The file is git-ignored; run this before loading the extension (npm test runs it first).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_DIR } from "./browser.mjs";

function git(...gitArguments) {
  return execFileSync("git", gitArguments, { cwd: EXTENSION_DIR, encoding: "utf8" }).trim();
}

const buildInfo = {
  commit: git("rev-parse", "--short", "HEAD"),
  dirty: git("status", "--porcelain") !== "",
};
fs.writeFileSync(path.join(EXTENSION_DIR, "build-info.json"), JSON.stringify(buildInfo) + "\n");
console.log("extension/build-info.json: " + JSON.stringify(buildInfo));
