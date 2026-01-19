#!/usr/bin/env npx tsx
// Batch test for BAM and DNA parsing
// Usage: npx tsx src/Toontown/tools/cli-batch.ts [count] [data_path] [type]
// Example: npx tsx src/Toontown/tools/cli-batch.ts all Toontown_1.0.6.9 bam
// Example: npx tsx src/Toontown/tools/cli-batch.ts all Toontown dna

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { BAMFile } from "../BAMFile";
import { parseDNA } from "../dna";

if (typeof DOMParser === "undefined") {
  (globalThis as any).DOMParser = XmldomParser;
}

// Default to Toontown, but allow override via command line
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
  if (!entry) throw new Error(`File not found: ${name}`);

  const multifilePath = path.join(DATA_PATH, entry.file);
  const fd = fs.openSync(multifilePath, "r");
  const buffer = Buffer.alloc(entry.length);
  fs.readSync(fd, buffer, 0, entry.length, entry.offset);
  fs.closeSync(fd);

  let data: ArrayBufferLike;
  if (entry.compressed) {
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

function testBAM(manifest: Manifest, files: string[]): void {
  console.log(`Testing ${files.length} BAM files...\n`);

  let passed = 0;
  let failed = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const data = loadFile(manifest, file);
      new BAMFile(data);
      passed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAILED: ${file}`);
      console.log(`  ${msg}`);
      errors.push({ file, error: msg });
      failed++;
    }
  }

  console.log(`\n=== BAM Summary ===`);
  console.log(`Passed: ${passed}/${files.length}`);
  console.log(`Failed: ${failed}/${files.length}`);

  if (errors.length > 0) {
    console.log(`\nFailed files:`);
    for (const { file, error } of errors) {
      console.log(`  ${file}: ${error}`);
    }
  }
}

function testDNA(manifest: Manifest, files: string[]): void {
  console.log(`Testing ${files.length} DNA files...\n`);

  let passed = 0;
  let failed = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const content = loadFileAsString(manifest, file);
      parseDNA(content);
      passed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAILED: ${file}`);
      console.log(`  ${msg}`);
      errors.push({ file, error: msg });
      failed++;
    }
  }

  console.log(`\n=== DNA Summary ===`);
  console.log(`Passed: ${passed}/${files.length}`);
  console.log(`Failed: ${failed}/${files.length}`);

  if (errors.length > 0) {
    console.log(`\nFailed files:`);
    for (const { file, error } of errors) {
      console.log(`  ${file}: ${error}`);
    }
  }
}

function main() {
  console.log(`Using data path: ${DATA_PATH}\n`);
  const manifest = loadManifest();

  // Get file type filter
  const typeArg = process.argv[4] || "both";
  const countArg = process.argv[2] || "all";

  if (typeArg === "dna" || typeArg === "both") {
    const dnaFiles = Object.keys(manifest).filter(
      (f) => f.endsWith(".dna") || f.endsWith(".xml"),
    );
    console.log(`Found ${dnaFiles.length} DNA files`);

    const testCount =
      countArg === "all" ? dnaFiles.length : parseInt(countArg, 10);
    const toTest =
      countArg === "all"
        ? dnaFiles.sort()
        : dnaFiles.sort(() => Math.random() - 0.5).slice(0, testCount);

    testDNA(manifest, toTest);
    console.log();
  }

  if (typeArg === "bam" || typeArg === "both") {
    const bamFiles = Object.keys(manifest).filter((f) => f.endsWith(".bam"));
    console.log(`Found ${bamFiles.length} BAM files`);

    const testCount =
      countArg === "all" ? bamFiles.length : parseInt(countArg, 10);
    const toTest =
      countArg === "all"
        ? bamFiles.sort()
        : bamFiles.sort(() => Math.random() - 0.5).slice(0, testCount);

    testBAM(manifest, toTest);
  }
}

main();
