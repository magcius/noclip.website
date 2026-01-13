// Panda3D Multifile format parser

import type ArrayBufferSlice from "../../ArrayBufferSlice";

const MAGIC = new Uint8Array([0x70, 0x6d, 0x66, 0x00, 0x0a, 0x0d]); // "pmf\0\n\r"

export interface MultifileVersion {
  major: number;
  minor: number;
}

export const MultifileAttributes = {
  Deleted: 1 << 0,
  IndexInvalid: 1 << 1,
  DataInvalid: 1 << 2,
  Compressed: 1 << 3,
  Encrypted: 1 << 4,
  Signature: 1 << 5,
  Text: 1 << 6,
} as const;

export interface MultifileHeader {
  version: MultifileVersion;
  scale: number;
  timestamp: number;
}

export interface MultifileEntry {
  offset: number;
  length: number;
  attributes: number;
  origLength: number;
  timestamp: number;
  name: string;
}

export interface Multifile {
  header: MultifileHeader;
  entries: MultifileEntry[];
}

function compareVersions(a: MultifileVersion, b: MultifileVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

function versionGte(a: MultifileVersion, b: MultifileVersion): boolean {
  return compareVersions(a, b) >= 0;
}

function versionLte(a: MultifileVersion, b: MultifileVersion): boolean {
  return compareVersions(a, b) <= 0;
}

function decodeMultifileString(buffer: Uint8Array): string {
  // Multifile strings are XOR-obfuscated with 255
  const decoded = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    decoded[i] = (255 - buffer[i]) & 0xff;
  }
  return new TextDecoder("utf-8").decode(decoded);
}

export function readMultifile(data: ArrayBufferSlice): Multifile {
  const view = data.createDataView();
  let offset = 0;

  // Read and validate magic
  const magic = data.createTypedArray(Uint8Array, offset, MAGIC.length);
  offset += MAGIC.length;
  for (let i = 0; i < MAGIC.length; i++) {
    if (magic[i] !== MAGIC[i]) {
      throw new Error(
        `Invalid multifile magic: ${Array.from(magic)
          .map((b) => b.toString(16))
          .join(" ")}`,
      );
    }
  }

  // Read version
  const major = view.getUint16(offset, true);
  offset += 2;
  const minor = view.getUint16(offset, true);
  offset += 2;
  const version: MultifileVersion = { major, minor };

  // Validate version (1.0 <= version <= 1.1)
  if (
    !versionGte(version, { major: 1, minor: 0 }) ||
    !versionLte(version, { major: 1, minor: 1 })
  ) {
    throw new Error(`Unsupported multifile version: ${major}.${minor}`);
  }

  // Read scale
  const scale = view.getUint32(offset, true);
  offset += 4;

  // Read timestamp (only for version >= 1.1)
  let timestamp = 0;
  if (versionGte(version, { major: 1, minor: 1 })) {
    timestamp = view.getUint32(offset, true);
    offset += 4;
  }

  const header: MultifileHeader = { version, scale, timestamp };

  // Read entries
  const entries: MultifileEntry[] = [];
  while (true) {
    const nextOffset = view.getUint32(offset, true);
    offset += 4;
    if (nextOffset === 0) {
      break;
    }

    // Read entry
    const entryOffset = view.getUint32(offset, true) * scale;
    offset += 4;
    const entryLength = view.getUint32(offset, true);
    offset += 4;
    const attributes = view.getUint16(offset, true);
    offset += 2;

    // Read orig_length if compressed or encrypted
    let origLength: number;
    if (
      attributes &
      (MultifileAttributes.Compressed | MultifileAttributes.Encrypted)
    ) {
      origLength = view.getUint32(offset, true);
      offset += 4;
    } else {
      origLength = entryLength;
    }

    // Read timestamp (only for version >= 1.1)
    let entryTimestamp = 0;
    if (versionGte(version, { major: 1, minor: 1 })) {
      entryTimestamp = view.getUint32(offset, true);
      offset += 4;
    }

    // Read name (length-prefixed, XOR-encoded)
    const nameLength = view.getUint16(offset, true);
    offset += 2;
    const nameBuffer = data.createTypedArray(Uint8Array, offset, nameLength);
    offset += nameLength;
    const name = decodeMultifileString(nameBuffer);

    entries.push({
      offset: entryOffset,
      length: entryLength,
      attributes,
      origLength,
      timestamp: entryTimestamp,
      name,
    });

    // Seek to next entry
    offset = nextOffset;
  }

  return { header, entries };
}
