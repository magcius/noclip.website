/*
 * LocoRoco GameImage (?). Describes the file extents in the main DATA.BIN file.
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readString } from "../../util.js";

// Constants
const GIMG_MAGIC = "GIMG";
const GIMG_UNKS = new Uint8Array([0x00, 0x00, 0x80, 0x3f]);
const GIMG_FORMAT_SIZE = 4; // Size of uint32 in bytes

class GimgHeader {
  public numFiles: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4, false);

    if (magic !== GIMG_MAGIC) {
      throw new Error("GIMG Header magic incorrect.");
    }

    // Check GIMG_UNKS
    for (let i = 0; i < GIMG_UNKS.length; i++) {
      if (view.getUint8(offset + 4 + i) !== GIMG_UNKS[i]) {
        throw new Error("GIMG Header unknowns incorrect.");
      }
    }

    this.numFiles = view.getUint32(offset + 8, true);
  }
}

export class GimgFile {
  public name: string | null = null;
  public nameOffset: number;
  public startOffsetLow: number;
  public nameHash: number;
  public size: number;
  public startOffset: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();

    this.nameOffset = view.getUint32(offset, true);
    this.startOffsetLow = view.getUint32(offset + 4, true);
    this.nameHash = view.getUint32(offset + 8, true);
    this.size = view.getUint32(offset + 12, true);
    this.startOffset = this.startOffsetLow * 2048;
  }
}

/**
 * Reads a GIMG file and returns a list of GimgFile objects
 * @param buffer ArrayBufferSlice containing the GIMG data
 * @returns Array of GimgFile objects
 */
export function readGimg(buffer: ArrayBufferSlice): GimgFile[] {
  const startPos = 0;
  let offset = startPos;

  // Read the GIMG header
  const gimgHeader = new GimgHeader(buffer, offset);
  offset += 8 + GIMG_FORMAT_SIZE; // Magic (4) + UNKS (4) + numFiles (4)

  // Read file records
  const files: GimgFile[] = [];
  for (let i = 0; i < gimgHeader.numFiles; i++) {
    files.push(new GimgFile(buffer, offset));
    offset += 16; // Each file record is 16 bytes (4 uint32s)
  }

  // Read names
  const names: { [offset: number]: string } = {};
  for (let n = 0; n < gimgHeader.numFiles; n++) {
    const nameOffset = offset - startPos;
    const name = readString(buffer, offset);
    names[nameOffset] = name;

    // Move offset past the null-terminated string
    offset += name.length + 1; // +1 for null terminator
  }

  // Convert name offsets to actual names and check hashes
  for (const file of files) {
    file.name = names[file.nameOffset];

    if (!file.name) {
      throw new Error(`Name not found for offset ${file.nameOffset}`);
    }
  }

  return files;
}
