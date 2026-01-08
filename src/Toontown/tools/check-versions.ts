#!/usr/bin/env npx tsx
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const DATA_BASE = path.join(__dirname, "../../data");

// BAM magic: pbj\0\n\r
const BAM_MAGIC = Buffer.from([0x70, 0x62, 0x6a, 0x00, 0x0a, 0x0d]);

function getMultifileBAMVersion(dataDir: string, bamPath: string): string | null {
  const manifestPath = path.join(dataDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entry = manifest[bamPath];
  if (!entry) return null;

  const multifilePath = path.join(dataDir, entry.file);
  const fd = fs.openSync(multifilePath, "r");

  let buffer: Buffer;
  if (entry.compressed) {
    const compressedBuffer = Buffer.alloc(Math.min(entry.length, 1024));
    fs.readSync(fd, compressedBuffer, 0, compressedBuffer.length, entry.offset);
    fs.closeSync(fd);
    try {
      const decompressed = zlib.inflateSync(compressedBuffer);
      buffer = decompressed.subarray(0, 14);
    } catch {
      return null;
    }
  } else {
    buffer = Buffer.alloc(14);
    fs.readSync(fd, buffer, 0, 14, entry.offset);
    fs.closeSync(fd);
  }

  if (!buffer.subarray(0, 6).equals(BAM_MAGIC)) {
    return null;
  }

  const versionMajor = buffer.readUInt16LE(10);
  const versionMinor = buffer.readUInt16LE(12);
  return `${versionMajor}.${versionMinor}`;
}

function findBAMFiles(dir: string): string[] {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return Object.keys(manifest).filter((f) => f.endsWith(".bam"));
}

// Get all Toontown directories
const dirs = fs
  .readdirSync(DATA_BASE)
  .filter((d) => d.startsWith("Toontown"))
  .sort();

console.log("BAM Versions by Toontown Version:\n");

for (const dir of dirs) {
  const dataDir = path.join(DATA_BASE, dir);
  const bamFiles = findBAMFiles(dataDir);

  if (bamFiles.length === 0) {
    console.log(`${dir}: No BAM files found`);
    continue;
  }

  const versions = new Set<string>();
  // Sample first 50 files to get version spread
  for (const bamFile of bamFiles.slice(0, 50)) {
    const version = getMultifileBAMVersion(dataDir, bamFile);
    if (version) {
      versions.add(version);
    }
  }

  const versionList = Array.from(versions).sort((a, b) => {
    const [aMaj, aMin] = a.split(".").map(Number);
    const [bMaj, bMin] = b.split(".").map(Number);
    return aMaj !== bMaj ? aMaj - bMaj : aMin - bMin;
  });

  console.log(`${dir}: BAM ${versionList.join(", ")} (${bamFiles.length} files)`);
}
