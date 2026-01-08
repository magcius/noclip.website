#!/usr/bin/env npx tsx
// Batch test for BAM parsing
// Usage: npx tsx src/Toontown/tools/cli-batch.ts [count] [data_path]
// Example: npx tsx src/Toontown/tools/cli-batch.ts all ToontownLegacy

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { BAMFile } from "../bam";

// Default to Toontown, but allow override via command line
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

function main() {
	console.log(`Using data path: ${DATA_PATH}`);
	const manifest = loadManifest();
	const bamFiles = Object.keys(manifest).filter((f) => f.endsWith(".bam"));
	console.log(`Found ${bamFiles.length} BAM files`);

	// Shuffle and take first N (or "all")
	const countArg = process.argv[2] || "50";
	const testCount = countArg === "all" ? bamFiles.length : parseInt(countArg);
	const toTest =
		countArg === "all"
			? bamFiles.sort()
			: bamFiles.sort(() => Math.random() - 0.5).slice(0, testCount);

	let passed = 0;
	let failed = 0;
	const errors: Array<{ file: string; error: string }> = [];

	for (const file of toTest) {
		try {
			const data = loadFile(manifest, file);
			const bam = new BAMFile(data);
			const count = [...bam.getObjects()].length;
			// console.log(`OK: ${file} (${count} objects)`);
			passed++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`FAILED: ${file}`);
			console.log(`  ${msg}`);
			errors.push({ file, error: msg });
			failed++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`Passed: ${passed}/${toTest.length}`);
	console.log(`Failed: ${failed}/${toTest.length}`);

	if (errors.length > 0) {
		console.log(`\nFailed files:`);
		for (const { file, error } of errors) {
			console.log(`  ${file}: ${error}`);
		}
	}
}

main();
