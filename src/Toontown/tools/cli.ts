#!/usr/bin/env npx tsx
// CLI test harness for Toontown BAM parsing
// Usage: npx tsx src/Toontown/tools/cli.ts [model_path]
// Example: npx tsx src/Toontown/tools/cli.ts phase_4/models/minigames/icecreamdrop.bam

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { BAMFile } from "../bam";

// Usage: npx tsx src/Toontown/tools/cli.ts [model_path] [data_path]
// Example: npx tsx src/Toontown/tools/cli.ts phase_4/models/props/anvil-mod.bam ToontownLegacy
const dataArg = process.argv[3] || "Toontown";
const DATA_PATH = path.join(__dirname, "../../data", dataArg);

interface ManifestEntry {
  file: string;
  offset: number;
  length: number;
  compressed: boolean;
}

type Manifest = Record<string, ManifestEntry>;

function loadManifest(): Manifest {
  const manifestPath = path.join(DATA_PATH, "manifest.json");
  const manifestData = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(manifestData);
}

function loadFile(manifest: Manifest, name: string): ArrayBufferSlice {
  const entry = manifest[name];
  if (!entry) {
    throw new Error(`File not found in manifest: ${name}`);
  }

  const multifilePath = path.join(DATA_PATH, entry.file);
  const fd = fs.openSync(multifilePath, "r");

  const buffer = Buffer.alloc(entry.length);
  fs.readSync(fd, buffer, 0, entry.length, entry.offset);
  fs.closeSync(fd);

  let data: ArrayBufferLike;
  if (entry.compressed) {
    // Panda3D uses zlib compression
    const decompressed = zlib.inflateSync(buffer);
    data = decompressed.buffer.slice(
      decompressed.byteOffset,
      decompressed.byteOffset + decompressed.byteLength,
    );
  } else {
    data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  }

  return new ArrayBufferSlice(data);
}

function main() {
  const args = process.argv.slice(2);
  const modelPath = args[0] || "phase_4/models/minigames/icecreamdrop.bam";

  console.log(`Loading manifest...`);
  const manifest = loadManifest();
  console.log(`Manifest loaded with ${Object.keys(manifest).length} files`);

  console.log(`\nLoading model: ${modelPath}`);
  try {
    const data = loadFile(manifest, modelPath);
    console.log(`File loaded: ${data.byteLength} bytes`);

    console.log(`\nParsing BAM file...`);
    const bamFile = new BAMFile(data, { debug: true });

    console.log(`\nParsing complete!`);
    console.log(`BAM version: ${bamFile.header.version}`);
    console.log(`Objects parsed: ${[...bamFile.getObjects()].length}`);

    // List object types
    const typeCounts = new Map<string, number>();
    for (const obj of bamFile.getObjects()) {
      const typeName = obj.constructor.name;
      typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
    }
    console.log(`\nObject types:`);
    for (const [type, count] of [...typeCounts.entries()].sort()) {
      console.log(`  ${type}: ${count}`);
    }
  } catch (error) {
    console.error(`\nError:`, error);
    process.exit(1);
  }
}

main();
