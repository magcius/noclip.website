/*
 * LocoRoco Extractor.
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { iso9660GetDataFilename } from "./iso9960.js";
import { assertExists } from "../../util.js";
import { decompressGprsFile } from "../lib/gprs.js";
import { readGarc } from "../lib/garc.js";
import { readGimg } from "../lib/gimg.js";

const pathBaseIn = `../../../data/LocoRoco_raw`;
const pathBaseOut = `../../../data/LocoRoco`;

function compressWithLzma(data: Buffer): Buffer {
  const tempIn = `/tmp/lzma_input_${process.pid}`;
  const tempOut = `${tempIn}.lzma`;

  writeFileSync(tempIn, data);
  execSync(`lzma -9 -f "${tempIn}"`, { stdio: "pipe" });
  const result = readFileSync(tempOut);
  unlinkSync(tempOut);

  return result;
}

function findFirstArchiveData(isoFilename: string) {
  const checkedFilenames: string[] = [];
  for (const firstArchiveName of [
    "first_eu.arc",
    "first.arc",
    "first_as.arc",
    "first_us.arc",
  ]) {
    const filename = `PSP_GAME/USRDIR/data/` + firstArchiveName;
    const data = iso9660GetDataFilename(isoFilename, filename);
    if (data !== null) return data;
    checkedFilenames.push(filename);
  }
  throw new Error(
    "Could not find first archive. Searched [" +
      checkedFilenames.join(", ") +
      "]",
  );
}

function main() {
  const isoFilename = `${pathBaseIn}/LocoRoco [UCUS98662].iso`;

  // Load the 'first archive'. This is kind of a bootloader for the game and is just enough
  // to get the language selection screen up and not much else. It also contains a file called
  // 'sector.bin' which we need to decode 'DATA.BIN'.
  const firstArchiveData = findFirstArchiveData(isoFilename);
  console.log("Located first archive.");

  const firstArchiveDataDecompressed = decompressGprsFile(firstArchiveData);
  console.log(
    `Decompressed first archive from ${firstArchiveData.byteLength} bytes to ${firstArchiveDataDecompressed.byteLength} bytes`,
  );

  const firstArchive = readGarc(
    new ArrayBufferSlice(firstArchiveDataDecompressed),
  );
  console.log(
    `Successfully parsed first archive. Found ${firstArchive.map.size} files`,
  );

  // We need the [sector.bin] file from the first archive to interpret the DATA.BIN file.
  // There's not much else in this archive except a bunch of language flag textures and some UI layouts.
  const sectorBin = firstArchive.getFile("sector_usa.bin");
  const mainDataFiles = readGimg(sectorBin.data);
  console.log(
    `Successfully loaded sector.bin. Found ${mainDataFiles.length} files`,
  );

  // Load the main data file now.
  const mainDataFilename = "PSP_GAME/USRDIR/data/DATA.BIN";
  const mainData = assertExists(
    iso9660GetDataFilename(isoFilename, mainDataFilename),
    "Could not find main data. Searched " + mainDataFilename,
  );

  // Extract every file in the main data bin.
  const outputDir = `${pathBaseOut}/DATA.BIN`;

  // Create output directory if it doesn't exist
  mkdirSync(outputDir, { recursive: true });

  console.log(`Extracting ${mainDataFiles.length} files from DATA.BIN...`);

  let totalOriginal = 0;
  let totalOutput = 0;

  // Extract each file
  for (const file of mainDataFiles) {
    if (!file.name) {
      console.warn(`Skipping file with no name at offset ${file.startOffset}`);
      continue;
    }

    // Extract file data from mainData
    const fileData = mainData.slice(
      file.startOffset,
      file.startOffset + file.size,
    );
    const fileBuffer = Buffer.from(fileData.copyToBuffer());

    // For .clv and .arc files: decompress GPRS, recompress with LZMA
    if (file.name.endsWith(".clv") || file.name.endsWith(".arc")) {
      const decompressed = decompressGprsFile(fileData);
      const decompressedBuffer = Buffer.from(decompressed);
      const lzmaCompressed = compressWithLzma(decompressedBuffer);

      const outputPath = `${outputDir}/${file.name}.lzma`;
      writeFileSync(outputPath, lzmaCompressed);

      totalOriginal += file.size;
      totalOutput += lzmaCompressed.length;

      const ratio = ((lzmaCompressed.length / file.size) * 100).toFixed(1);
      console.log(
        `Extracted, recompressed with lzma: ${file.name}.lzma (${file.size} -> ${lzmaCompressed.length} bytes, ${ratio}%)`,
      );
    } else {
      // Other files: save as-is
      const outputPath = `${outputDir}/${file.name}`;
      writeFileSync(outputPath, fileBuffer);
      console.log(`Extracted: ${file.name} (${file.size} bytes)`);
    }
  }

  console.log(
    `\nExtraction complete. ${mainDataFiles.length} files extracted to ${outputDir}`,
  );
  if (totalOriginal > 0) {
    console.log(
      `CLV/ARC files: ${totalOriginal.toLocaleString()} -> ${totalOutput.toLocaleString()} bytes (${((totalOutput / totalOriginal) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Saved: ${(totalOriginal - totalOutput).toLocaleString()} bytes`,
    );
  }
}

main();
