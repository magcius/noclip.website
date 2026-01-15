#!/usr/bin/env npx tsx
// CLI test harness for Toontown BAM and DNA parsing
// Usage: npx tsx src/Toontown/tools/cli.ts [model_path]
// Example: npx tsx src/Toontown/tools/cli.ts phase_4/models/minigames/icecreamdrop.bam
// Example: npx tsx src/Toontown/tools/cli.ts phase_4/dna/storage.dna

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { BAMFile } from "../bam";
import { type DNAFile, parseDNA } from "../dna";

if (typeof DOMParser === "undefined") {
  (globalThis as any).DOMParser = XmldomParser;
}

// Usage: npx tsx src/Toontown/tools/cli.ts [model_path] [data_path]
// Example: npx tsx src/Toontown/tools/cli.ts phase_4/models/props/anvil-mod.bam Toontown_1.0.6.9
const dataArg = process.argv[3] || "Toontown";
const DATA_PATH = path.join(__dirname, "../../../data", dataArg);

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

function loadFileAsString(manifest: Manifest, name: string): string {
  const data = loadFile(manifest, name);
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(data.createTypedArray(Uint8Array));
}

function countNodes(nodes: DNAFile["root"], counts: Map<string, number>): void {
  for (const node of nodes) {
    counts.set(node.type, (counts.get(node.type) || 0) + 1);
    if ("children" in node && node.children) {
      countNodes(node.children, counts);
    }
    if (node.type === "flat_building" && node.walls) {
      counts.set("wall", (counts.get("wall") || 0) + node.walls.length);
      for (const wall of node.walls) {
        if (wall.windows)
          counts.set("windows", (counts.get("windows") || 0) + 1);
        if (wall.cornice)
          counts.set("cornice", (counts.get("cornice") || 0) + 1);
      }
    }
  }
}

function handleBAM(data: ArrayBufferSlice): void {
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
}

function handleDNA(content: string): void {
  console.log(`\nParsing DNA file...`);

  const dnaFile = parseDNA(content);

  console.log(`\nParsing complete!`);
  console.log(`Suit points: ${dnaFile.suitPoints.length}`);
  console.log(`Model declarations: ${dnaFile.models.length}`);
  console.log(`Stored textures: ${dnaFile.storedTextures.length}`);
  console.log(`Stored fonts: ${dnaFile.storedFonts.length}`);
  console.log(`Root nodes: ${dnaFile.root.length}`);

  // Count node types
  const nodeCounts = new Map<string, number>();
  countNodes(dnaFile.root, nodeCounts);

  if (nodeCounts.size > 0) {
    console.log(`\nNode types:`);
    for (const [type, count] of [...nodeCounts.entries()].sort()) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // Print model details
  if (dnaFile.models.length > 0) {
    console.log(`\nModel declarations:`);
    for (const model of dnaFile.models) {
      console.log(
        `  ${model.type}: ${model.path} (${model.nodes.length} nodes)`,
      );
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const filePath = args[0] || "phase_4/models/minigames/icecreamdrop.bam";

  console.log(`Loading manifest...`);
  const manifest = loadManifest();
  console.log(`Manifest loaded with ${Object.keys(manifest).length} files`);

  console.log(`\nLoading file: ${filePath}`);

  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".dna") {
      const content = loadFileAsString(manifest, filePath);
      console.log(`File loaded: ${content.length} characters`);
      handleDNA(content);
    } else if (ext === ".bam") {
      const data = loadFile(manifest, filePath);
      console.log(`File loaded: ${data.byteLength} bytes`);
      handleBAM(data);
    } else {
      // Default to BAM for unknown extensions
      const data = loadFile(manifest, filePath);
      console.log(`File loaded: ${data.byteLength} bytes`);
      handleBAM(data);
    }
  } catch (error) {
    console.error(`\nError:`, error);
    process.exit(1);
  }
}

main();
