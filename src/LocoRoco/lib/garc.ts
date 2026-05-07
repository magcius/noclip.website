/*
 * LocoRoco GameArchive (?). A simple archive format.
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readString } from "../../util.js";

// Constants
const GARC_MAGIC = "GARC";
const GARC_UNKS = new Uint8Array([
  0x00, 0x00, 0x80, 0x3f, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
]);
// The 0x20 is the end offset. 0x803F10 is skipped and never read.
// I assume 0x803F is the version number, since that's a 32bit float 1.0f

const FILE_MAGIC = "FILE";
const FILE_RECORD_SIZE = 24;
const NAME_MAGIC = "NAME";
const DATA_MAGIC = "DATA";
const TERM_MAGIC = "TERM";

// Classes
class GarcHeader {
  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4);
    if (magic !== GARC_MAGIC) {
      throw new Error("GARC Header magic incorrect.");
    }

    // Check GARC_UNKS
    for (let i = 0; i < GARC_UNKS.length; i++) {
      if (view.getUint8(offset + 4 + i) !== GARC_UNKS[i]) {
        throw new Error("GARC Header unknowns incorrect.");
      }
    }
  }
}

class FileHeader {
  public endOffset: number;
  public numFiles: number;
  public size: number;
  public startOffset: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4);
    if (magic !== FILE_MAGIC) {
      throw new Error("FILE Header magic incorrect.");
    }

    this.endOffset = view.getUint32(offset + 4, true);
    this.numFiles = view.getUint32(offset + 8, true);
    this.size = view.getUint32(offset + 12, true);
    this.startOffset = view.getUint32(offset + 16, true);

    // Check for 12 bytes of zeros
    for (let i = 0; i < 12; i++) {
      if (view.getUint8(offset + 20 + i) !== 0) {
        throw new Error("FILE Header unknowns incorrect.");
      }
    }
  }
}

class FileRecord {
  public type: string;
  public size: number;
  public startOffset: number;
  public fileNameOffset: number;
  public nameHash: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();

    this.type = readString(buffer, offset, 4, false);
    if (this.type.charCodeAt(3) !== 0) {
      throw new Error("File type not null terminated.");
    }

    this.size = view.getUint32(offset + 4, true);
    this.startOffset = view.getUint32(offset + 8, true);
    this.fileNameOffset = view.getUint32(offset + 12, true);
    this.nameHash = view.getUint32(offset + 16, true);

    const maxInteger = view.getUint32(offset + 20, true);
    if (maxInteger !== 0xffffffff) {
      throw new Error("File Record missing max integer at end.");
    }
  }
}

class NameHeader {
  public endOffset: number;
  public numFiles: number;
  public size: number;
  public startOffset: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4);
    if (magic !== NAME_MAGIC) {
      throw new Error("NAME Header magic incorrect.");
    }

    this.endOffset = view.getUint32(offset + 4, true);
    this.numFiles = view.getUint32(offset + 8, true);
    this.size = view.getUint32(offset + 12, true);
    this.startOffset = view.getUint32(offset + 16, true);
  }
}

class DataHeader {
  public endOffset: number;
  public numFiles: number;
  public size: number;
  public startOffset: number;

  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4);
    if (magic !== DATA_MAGIC) {
      throw new Error("DATA Header magic incorrect.");
    }

    this.endOffset = view.getUint32(offset + 4, true);
    this.numFiles = view.getUint32(offset + 8, true);
    this.size = view.getUint32(offset + 12, true);
    this.startOffset = view.getUint32(offset + 16, true);

    // Check for 12 bytes of zeros
    for (let i = 0; i < 12; i++) {
      if (view.getUint8(offset + 20 + i) !== 0) {
        throw new Error("DATA Header unknowns incorrect.");
      }
    }
  }
}

class TermHeader {
  constructor(buffer: ArrayBufferSlice, offset: number) {
    const view = buffer.createDataView();
    const magic = readString(buffer, offset, 4);
    if (magic !== TERM_MAGIC) {
      throw new Error("TERM Header magic incorrect.");
    }

    // Check for 28 bytes of zeros
    for (let i = 0; i < 28; i++) {
      if (view.getUint8(offset + 4 + i) !== 0) {
        throw new Error("TERM Header unknowns incorrect.");
      }
    }
  }
}

class DataChunk {
  public start: number;
  public data: ArrayBufferSlice;

  constructor(
    startPos: number,
    buffer: ArrayBufferSlice,
    offset: number,
    header: FileHeader | NameHeader | DataHeader,
  ) {
    // Use end_offset and size from header to create the struct.
    if (offset - startPos !== header.endOffset - header.size) {
      throw new Error("Data chunk has incorrect size or end_offset.");
    }
    this.start = offset - startPos;
    this.data = buffer.subarray(offset, header.size);
  }
}

export class GarcFile {
  constructor(
    public type: string,
    public data: ArrayBufferSlice,
    public name: string,
  ) {}
}

export class Garc {
  public map: Map<string, GarcFile>;

  constructor(files: GarcFile[]) {
    this.map = new Map();
    for (const file of files) {
      if (this.map.has(file.name)) {
        throw new Error("Garc filename collision");
      }
      this.map.set(file.name, file);
    }
  }

  public getFile(name: string): GarcFile {
    const file = this.map.get(name);
    if (file === undefined) throw new Error(`File not found: ${name}`);
    return file;
  }
}

// Helper functions
function calculateAcceptableNameOffsets(chunk: DataChunk): Set<number> {
  const acceptableOffsets = new Set<number>();
  let justReadFile = true;

  const view = chunk.data.createDataView();
  for (let i = 0; i < chunk.data.byteLength; i++) {
    const d = view.getUint8(i);
    if (d === 0) {
      justReadFile = true;
    } else if (justReadFile) {
      acceptableOffsets.add(i + chunk.start);
      justReadFile = false;
    }
  }

  if (!justReadFile) {
    throw new Error("Name not terminated before end of name chunk");
  }

  return acceptableOffsets;
}

function convertChunksToFiles(
  fileHeader: FileHeader,
  fileChunk: DataChunk,
  nameChunk: DataChunk,
  dataChunk: DataChunk,
): GarcFile[] {
  const acceptableNameOffsets = calculateAcceptableNameOffsets(nameChunk);
  const nFiles = Math.floor(fileChunk.data.byteLength / FILE_RECORD_SIZE);

  if (nFiles !== fileHeader.numFiles) {
    throw new Error(
      "Number of files is incorrect for size of file chunk: " +
        fileHeader.numFiles +
        " " +
        nFiles,
    );
  }
  if (nFiles !== acceptableNameOffsets.size) {
    throw new Error("Number of files is incorrect for number of filenames");
  }

  const returnFiles: GarcFile[] = [];

  for (let i = 0; i < nFiles; i++) {
    const fileOffset = i * FILE_RECORD_SIZE;
    const file = new FileRecord(fileChunk.data, fileOffset);

    if (file.startOffset < dataChunk.start) {
      throw new Error("File data starts before beginning of data chunk");
    }
    if (
      file.startOffset + file.size >
      dataChunk.start + dataChunk.data.byteLength
    ) {
      throw new Error("File data ends after end of data chunk");
    }

    const dataStartOffset = file.startOffset - dataChunk.start;
    const data = dataChunk.data.subarray(dataStartOffset, file.size);

    if (!acceptableNameOffsets.has(file.fileNameOffset)) {
      throw new Error("File name offset does not point to valid name");
    } else {
      acceptableNameOffsets.delete(file.fileNameOffset);
    }

    // Read null-terminated string
    const nameOffset = file.fileNameOffset - nameChunk.start;
    let nameLength = 0;
    const nameView = nameChunk.data.createDataView();
    while (
      nameOffset + nameLength < nameChunk.data.byteLength &&
      nameView.getUint8(nameOffset + nameLength) !== 0
    ) {
      nameLength++;
    }
    const name = readString(nameChunk.data, nameOffset, nameLength);

    returnFiles.push(new GarcFile(file.type.substring(0, 3), data, name));
  }

  if (acceptableNameOffsets.size !== 0) {
    throw new Error("Not all name offsets were used");
  }

  return returnFiles;
}

export function readGarc(buffer: ArrayBufferSlice): Garc {
  const startPos = 0;
  let offset = startPos;

  const garcHeader = new GarcHeader(buffer, offset);
  offset += 4 + GARC_UNKS.length;

  const fileHeader = new FileHeader(buffer, offset);
  offset += 32; // 4 (magic) + 16 (header data) + 12 (zeros)
  const fileChunk = new DataChunk(startPos, buffer, offset, fileHeader);
  offset += fileHeader.size;

  const nameHeader = new NameHeader(buffer, offset);
  offset += 20; // 4 (magic) + 16 (header data)
  const nameChunk = new DataChunk(startPos, buffer, offset, nameHeader);
  offset += nameHeader.size;

  const dataHeader = new DataHeader(buffer, offset);
  offset += 32; // 4 (magic) + 16 (header data) + 12 (zeros)
  const dataChunk = new DataChunk(startPos, buffer, offset, dataHeader);
  offset += dataHeader.size;

  const termHeader = new TermHeader(buffer, offset);
  offset += 32; // 4 (magic) + 28 (zeros)

  if (
    fileHeader.numFiles !== nameHeader.numFiles ||
    fileHeader.numFiles !== dataHeader.numFiles
  ) {
    throw new Error(
      "Read GARC, but chunks did not all have the same number of files.",
    );
  }

  return new Garc(
    convertChunksToFiles(fileHeader, fileChunk, nameChunk, dataChunk),
  );
}
