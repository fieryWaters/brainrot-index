// Packs extension/ into brainrot-index-extension-<version>.zip, the file uploaded to the Chrome Web
// Store and offered on the site for Load unpacked. The version is the one in manifest.json; this
// script never changes it.
//
//   node scripts/package-extension.mjs [--out <dir>] [--all-addresses]
//
// The zip holds the extension's own files only: no dotfiles and no Markdown. It gets a fresh
// build-info.json naming the commit (GIT_COMMIT when set, as in the Docker build, otherwise asked of
// git), which the extension attaches to feedback.
//
// The manifest in the zip grants only the public site, https://brainrotindex.com. The development
// addresses (localhost, 127.0.0.1 and the private address) are left out, so the published extension
// does not run on every page a person opens on localhost. --all-addresses keeps them, for testing a
// packed copy against a development server.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXTENSION_DIR = path.resolve(SCRIPTS_DIR, "..", "extension");
const PUBLIC_SITE_PATTERN = "https://brainrotindex.com/*";

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1];
}

function gitAnswer(...gitArguments) {
  return execFileSync("git", gitArguments, { cwd: EXTENSION_DIR, encoding: "utf8" }).trim();
}

function buildInfo() {
  if (process.env.GIT_COMMIT) {
    return { commit: process.env.GIT_COMMIT, dirty: false };
  }
  return {
    commit: gitAnswer("rev-parse", "--short", "HEAD"),
    dirty: gitAnswer("status", "--porcelain", "--", ".") !== "",
  };
}

function publicManifest(manifest) {
  const onlyPublicSite = (patterns) => patterns.filter((pattern) => pattern === PUBLIC_SITE_PATTERN);
  return {
    ...manifest,
    host_permissions: onlyPublicSite(manifest.host_permissions),
    content_scripts: manifest.content_scripts.map((contentScript) => {
      const isSiteScript = contentScript.matches.includes(PUBLIC_SITE_PATTERN);
      if (isSiteScript) {
        return { ...contentScript, matches: onlyPublicSite(contentScript.matches) };
      }
      return contentScript;
    }),
  };
}

// Every file of the extension, as paths relative to extension/, skipping dotfiles, Markdown and
// any build-info.json left by stamp-build-info.mjs.
function extensionFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(EXTENSION_DIR, directory), { withFileTypes: true })) {
    const relativePath = path.join(directory, entry.name);
    if (entry.name.startsWith(".") || entry.name.endsWith(".md") || relativePath === "build-info.json") {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...extensionFiles(relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

// -- A minimal zip writer: deflated entries, a central directory, no extra fields. --

const crcTable = [];
for (let byteValue = 0; byteValue < 256; byteValue++) {
  let crc = byteValue;
  for (let bit = 0; bit < 8; bit++) {
    if (crc & 1) {
      crc = 0xedb88320 ^ (crc >>> 1);
    } else {
      crc = crc >>> 1;
    }
  }
  crcTable.push(crc >>> 0);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Every entry is dated 1980-01-01, the earliest zip date, so the same files always make the same zip.
const ZIP_DATE = (0 << 9) | (1 << 5) | 1;
const ZIP_TIME = 0;
const DEFLATE = 8;

function zipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(DEFLATE, 8);
    localHeader.writeUInt16LE(ZIP_TIME, 10);
    localHeader.writeUInt16LE(ZIP_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(DEFLATE, 10);
    centralHeader.writeUInt16LE(ZIP_TIME, 12);
    centralHeader.writeUInt16LE(ZIP_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBytes, compressed);
    centralParts.push(centralHeader, nameBytes);
    offset = offset + localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

// -- Pack --

const outputDir = path.resolve(optionValue("--out", path.resolve(SCRIPTS_DIR, "..", "dist")));
const keepAllAddresses = process.argv.includes("--all-addresses");

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
let packedManifest = manifest;
if (!keepAllAddresses) {
  packedManifest = publicManifest(manifest);
}

const entries = [];
for (const relativePath of extensionFiles("")) {
  let data = fs.readFileSync(path.join(EXTENSION_DIR, relativePath));
  if (relativePath === "manifest.json") {
    data = Buffer.from(JSON.stringify(packedManifest, null, 2) + "\n");
  }
  entries.push({ name: relativePath.split(path.sep).join("/"), data: data });
}
entries.push({ name: "build-info.json", data: Buffer.from(JSON.stringify(buildInfo()) + "\n") });

fs.mkdirSync(outputDir, { recursive: true });
const zipPath = path.join(outputDir, `brainrot-index-extension-${manifest.version}.zip`);
fs.writeFileSync(zipPath, zipArchive(entries));
console.log(`${zipPath} (${entries.length} files)`);
