// Writes the extension's toolbar icons (16, 48 and 128 pixels): a solid purple square with a white
// bar across the middle. Run once with `node make-icons.mjs`; the PNG files are committed.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { EXTENSION_DIR } from "./browser.mjs";

const BACKGROUND_COLOR = [92, 52, 168];
const BAR_COLOR = [255, 255, 255];

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

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function makeIconPng(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB

  const barTop = Math.round(size * 0.42);
  const barBottom = Math.round(size * 0.58);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter type: none
    for (let x = 0; x < size; x++) {
      if (y >= barTop && y < barBottom) {
        row.push(...BAR_COLOR);
      } else {
        row.push(...BACKGROUND_COLOR);
      }
    }
    rows.push(Buffer.from(row));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconsDir = path.join(EXTENSION_DIR, "icons");
fs.mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), makeIconPng(size));
}
