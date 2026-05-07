/*
 * LocoRoco STPM (Stage Parameter) file parser.
 * Contains level configuration data including background colors.
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readString } from "../../util.js";

export interface StpmLevel {
  unkFloats: number[];
  levelName: string;
  worldId: number;
  worldLevelId: number;
  themeId: number;
  unk4a: number;
  unk4b: number;
  backgroundMusic: string;
  unk5: number;
  unk6: number;
  unk7: number;
  unk8: number;
  unkStrings: string[];
  unkStringTags: number[];
  backgroundColor: number; // RGBA as 32-bit integer (ABGR format)
}

export interface Stpm {
  version: number;
  numLevels: number;
  stringSize: number;
  levelSize: number;
  levels: StpmLevel[];
}

function readNullTerminatedString(
  buffer: ArrayBufferSlice,
  offset: number,
  maxLength: number,
): string {
  const view = buffer.createDataView();
  let length = 0;
  while (length < maxLength && view.getUint8(offset + length) !== 0) {
    length++;
  }
  return readString(buffer, offset, length);
}

function parseLevel(buffer: ArrayBufferSlice, offset: number): StpmLevel {
  const view = buffer.createDataView();
  let pos = offset;

  // 30 floats (120 bytes)
  const unkFloats: number[] = [];
  for (let i = 0; i < 30; i++) {
    unkFloats.push(view.getFloat32(pos, true));
    pos += 4;
  }

  // 32 byte level name string
  const levelName = readNullTerminatedString(buffer, pos, 32);
  pos += 32;

  // world_id (2 bytes), world_level_id (2 bytes), theme_id (4 bytes), unk4a (1 byte), unk4b (1 byte)
  const worldId = view.getUint16(pos, true);
  pos += 2;
  const worldLevelId = view.getUint16(pos, true);
  pos += 2;
  const themeId = view.getUint32(pos, true);
  pos += 4;
  const unk4a = view.getUint8(pos);
  pos += 1;
  const unk4b = view.getUint8(pos);
  pos += 1;

  // 28 byte background_music string
  const backgroundMusic = readNullTerminatedString(buffer, pos, 28);
  pos += 28;

  // unk5 (1 byte), unk6 (1 byte), unk7 (float, 4 bytes), unk8 (float, 4 bytes)
  const unk5 = view.getUint8(pos);
  pos += 1;
  const unk6 = view.getUint8(pos);
  pos += 1;
  const unk7 = view.getFloat32(pos, true);
  pos += 4;
  const unk8 = view.getFloat32(pos, true);
  pos += 4;

  // 50 strings of 20 bytes each
  const unkStrings: string[] = [];
  for (let i = 0; i < 50; i++) {
    unkStrings.push(readNullTerminatedString(buffer, pos, 20));
    pos += 20;
  }

  // 50 bytes for unk_string_tags
  const unkStringTags: number[] = [];
  for (let i = 0; i < 50; i++) {
    unkStringTags.push(view.getUint8(pos));
    pos += 1;
  }

  // 2 bytes padding
  const padding = view.getUint16(pos, true);
  pos += 2;
  if (padding !== 0) {
    console.warn(`STPM: Expected padding to be 0, got ${padding}`);
  }

  // 4 bytes background_color
  const backgroundColor = view.getUint32(pos, true);
  pos += 4;

  // Verify we read exactly 1256 bytes
  const bytesRead = pos - offset;
  if (bytesRead !== 1256) {
    throw new Error(
      `STPM: Level record should be 1256 bytes, read ${bytesRead}`,
    );
  }

  return {
    unkFloats,
    levelName,
    worldId,
    worldLevelId,
    themeId,
    unk4a,
    unk4b,
    backgroundMusic,
    unk5,
    unk6,
    unk7,
    unk8,
    unkStrings,
    unkStringTags,
    backgroundColor,
  };
}

export function readStpm(buffer: ArrayBufferSlice): Stpm {
  const view = buffer.createDataView();
  let pos = 0;

  // Magic (4 bytes)
  const magic = readString(buffer, pos, 4);
  pos += 4;
  if (magic !== "STPM") {
    throw new Error(`STPM: Invalid magic "${magic}", expected "STPM"`);
  }

  // Version (float, 4 bytes)
  const version = view.getFloat32(pos, true);
  pos += 4;
  if (Math.abs(version - 1.01) > 1e-6) {
    throw new Error(`STPM: Unexpected version ${version}, expected 1.01`);
  }

  // num_levels (4 bytes)
  const numLevels = view.getUint32(pos, true);
  pos += 4;

  // string_size (4 bytes)
  const stringSize = view.getUint32(pos, true);
  pos += 4;
  if (stringSize !== 20) {
    throw new Error(`STPM: Unexpected string_size ${stringSize}, expected 20`);
  }

  // level_size (4 bytes)
  const levelSize = view.getUint32(pos, true);
  pos += 4;
  if (levelSize !== 1256) {
    throw new Error(`STPM: Unexpected level_size ${levelSize}, expected 1256`);
  }

  // Parse levels
  const levels: StpmLevel[] = [];
  for (let i = 0; i < numLevels; i++) {
    levels.push(parseLevel(buffer, pos));
    pos += levelSize;
  }

  return {
    version,
    numLevels,
    stringSize,
    levelSize,
    levels,
  };
}

/**
 * Convert STPM background color (ABGR format) to RGBA values (0-1 range).
 */
export function stpmColorToRGBA(
  color: number,
): [number, number, number, number] {
  const r = (color & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = ((color >> 16) & 0xff) / 255;
  const a = ((color >> 24) & 0xff) / 255;
  return [r, g, b, a];
}

/**
 * Find a level by name in the STPM data.
 * The levelName parameter should be the base name without extension (e.g., "st0_a").
 */
export function findLevelByName(
  stpm: Stpm,
  levelName: string,
): StpmLevel | null {
  // Try exact match first
  for (const level of stpm.levels) {
    if (level.levelName === levelName) {
      return level;
    }
  }
  // Try case-insensitive match
  const lowerName = levelName.toLowerCase();
  for (const level of stpm.levels) {
    if (level.levelName.toLowerCase() === lowerName) {
      return level;
    }
  }
  return null;
}
