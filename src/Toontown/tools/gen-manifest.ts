#!/usr/bin/env npx tsx
// Generates manifest.json from multifile archives
// Usage: npx tsx src/Toontown/tools/gen-manifest.ts <data_dir> [output_file]
// Example: npx tsx src/Toontown/tools/gen-manifest.ts data/Toontown manifest.json

import * as fs from "node:fs";
import * as path from "node:path";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { MultifileAttributes, readMultifile } from "../multifile";

interface ManifestEntry {
  file: string;
  offset: number;
  length: number;
  compressed: boolean;
}

type Manifest = Record<string, ManifestEntry>;

function loadMultifileBuffer(filePath: string): ArrayBufferSlice {
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new ArrayBufferSlice(arrayBuffer);
}

function generateManifest(dataDir: string): Manifest {
  // Find all .mf files in the directory
  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith(".mf"))
    .sort(); // Sort for consistent ordering

  const manifest: Manifest = {};

  for (const fileName of files) {
    const filePath = path.join(dataDir, fileName);
    console.log(`Processing ${fileName}...`);

    const data = loadMultifileBuffer(filePath);
    const multifile = readMultifile(data);

    for (const entry of multifile.entries) {
      if (manifest[entry.name]) {
        throw new Error(
          `Duplicate entry for file ${entry.name}: ${manifest[entry.name].file} & ${fileName}`,
        );
      }

      manifest[entry.name] = {
        file: fileName,
        offset: entry.offset,
        length: entry.length,
        compressed: (entry.attributes & MultifileAttributes.Compressed) !== 0,
      };
    }
  }

  return manifest;
}

function sortManifest(manifest: Manifest): Manifest {
  // Sort entries alphabetically by key (like Rust BTreeMap)
  const sortedKeys = Object.keys(manifest).sort();
  const sorted: Manifest = {};
  for (const key of sortedKeys) {
    sorted[key] = manifest[key];
  }
  return sorted;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: gen-manifest.ts <data_dir> [output_file]");
    console.error("Example: gen-manifest.ts data/Toontown manifest.json");
    process.exit(1);
  }

  const dataDir = args[0];
  const outputFile = args[1] || path.join(dataDir, "manifest.json");

  if (!fs.existsSync(dataDir)) {
    console.error(`Error: Directory not found: ${dataDir}`);
    process.exit(1);
  }

  console.log(`Generating manifest for ${dataDir}...`);
  const manifest = generateManifest(dataDir);
  const sorted = sortManifest(manifest);

  const json = JSON.stringify(sorted, null, 2);
  fs.writeFileSync(outputFile, json);

  console.log(`Wrote manifest with ${Object.keys(manifest).length} entries to ${outputFile}`);
}

main();
