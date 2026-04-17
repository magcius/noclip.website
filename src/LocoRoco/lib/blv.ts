/*
 * LocoRoco BLV (Binary Level) File Parser.
 *
 * petton-svn, 2026.
 */

export enum GameVersion {
  Gold = "Gold",
  Prototype = "Prototype",
}

export { PalettePixelFormat, TextureFormat } from "./texture_format.js";
import { PalettePixelFormat, TextureFormat } from "./texture_format.js";
import { Color, colorNewFromRGBA, colorFromRGBA, colorLerp } from "../../Color.js";
export type { Color } from "../../Color.js";

// Utility functions
function decodeCompressedPointer(pointer: number): number {
  if (pointer === 0) {
    return 0;
  } else if (pointer > 0x3fffffc) {
    // Not currently supported or used in-game.
    throw new Error("Pointer has non-zero segment");
  } else if ((pointer & 2) !== 0) {
    // Investigate code at 0x08804000 + 0x612bc
    throw new Error("Found sub-level ptr (?). Code unused?");
  } else if ((pointer & 1) === 0) {
    // Already linked.
    throw new Error("Found pre-linked ptr");
  } else {
    // Pointer needs to be linked.
    //
    // When locoroco loads the pointers, it adds the level memory base address to
    // every pointer and clears the low bit.
    //
    // These are the only pointers that are actually used.
    return pointer & ~1;
  }
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

// Parsing function type
type ParseFn<T> = (ctx: Context, parseArgs?: any) => T;

// Globally unique placeholder for objects currently being parsed
const PARSING_PLACEHOLDER: unique symbol = Symbol("PARSING_PLACEHOLDER");

// Object with type for tracking parsed objects
interface ObjectWithType {
  obj: any;
  parseFn: ParseFn<any>;
  parseArgs: any;
}

// Stream wrapper for reading binary data
export class BinaryStream {
  private view: DataView;
  private offset: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  tell(): number {
    return this.offset;
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt16(): number {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readInt32(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    const value = new Uint8Array(this.view.buffer, this.offset, length);
    this.offset += length;
    return value;
  }
}

/**
 * Context for reading a BLV file. Tracks all objects and wraps reading data from the input stream.
 */
class Context {
  public gameVersion: GameVersion;
  public stream: BinaryStream;
  private offsetToObjectWithType: Map<number, ObjectWithType> = new Map();
  private offsetsOfAllObjects: Set<number>;
  private offsetsOfAllPointers: Set<number>;
  private offsetOfEndOfData: number;
  private nextReadIsStartOfObject: boolean = false;
  private currentObjectStartPtr: number = -1;

  /**
   * @param gameVersion Either GameVersion.Gold or GameVersion.Prototype
   * @param stream Binary stream to read from
   * @param offsetsOfAllPointers Offsets of all pointers in the BLV (from linker data at end of file)
   * @param offsetsOfAllObjects Offsets of all objects (values at each pointer offset)
   * @param offsetOfEndOfData End of the BLV data section, in bytes
   */
  constructor(
    gameVersion: GameVersion,
    stream: BinaryStream,
    offsetsOfAllPointers: Set<number>,
    offsetsOfAllObjects: Set<number>,
    offsetOfEndOfData: number,
  ) {
    this.gameVersion = gameVersion;
    this.stream = stream;
    this.offsetsOfAllObjects = offsetsOfAllObjects;
    this.offsetsOfAllPointers = offsetsOfAllPointers;
    this.offsetOfEndOfData = offsetOfEndOfData;
  }

  calculateDistToStartOfNextObject(ptr: number): number {
    if (ptr % 4 !== 0) {
      throw new Error(`Misaligned calculateDistToStartOfNextObject at ${ptr}`);
    }

    let d = 4;
    while (
      !this.offsetsOfAllObjects.has(ptr + d) &&
      ptr + d < this.offsetOfEndOfData
    ) {
      d += 4;
    }
    return d;
  }

  /**
   * Validates a data read of the given length.
   * Checks alignment, pointer conflicts, and object boundary conflicts.
   */
  private validateDataRead(numBytes: number): void {
    if (numBytes <= 0) {
      return;
    }

    const startOffset = this.stream.tell();

    if (numBytes % 4 === 0 && startOffset % 4 !== 0) {
      throw new Error(`Misaligned read at ${startOffset}`);
    }

    const alignedLength = (numBytes + 3) & ~3;
    for (
      let checkOffset = startOffset;
      checkOffset < startOffset + alignedLength;
      checkOffset += 4
    ) {
      if (checkOffset % 4 !== 0) continue;

      if (this.offsetsOfAllPointers.has(checkOffset)) {
        throw new Error(
          `Attempted to decode a pointer as data at ${checkOffset}`,
        );
      }

      if (this.nextReadIsStartOfObject) {
        this.nextReadIsStartOfObject = false;
      } else if (this.offsetsOfAllObjects.has(checkOffset)) {
        throw new Error(
          `Attempted to decode data through the start of another object ${checkOffset}`,
        );
      }
    }
  }

  readUint8(): number {
    return this.stream.readUint8();
  }

  readUint8Constant(expected: number): void {
    assertEqual(this.stream.readUint8(), expected);
  }

  readUint16(): number {
    this.validateDataRead(2);
    return this.stream.readUint16();
  }

  readUint16Constant(expected: number): void {
    assertEqual(this.stream.readUint16(), expected);
  }

  readInt16(): number {
    this.validateDataRead(2);
    return this.stream.readInt16();
  }

  readUint32(): number {
    this.validateDataRead(4);
    return this.stream.readUint32();
  }

  readUint32Constant(expected: number): void {
    assertEqual(this.readUint32(), expected);
  }

  readInt32(): number {
    this.validateDataRead(4);
    return this.stream.readInt32();
  }

  readFloat32(): number {
    this.validateDataRead(4);
    return this.stream.readFloat32();
  }

  readBytes(length: number): Uint8Array {
    this.validateDataRead(length);
    return this.stream.readBytes(length);
  }

  readPointer(): number {
    const currentOffset = this.stream.tell();

    if (this.nextReadIsStartOfObject) {
      this.nextReadIsStartOfObject = false;
    } else if (this.offsetsOfAllObjects.has(currentOffset)) {
      throw new Error(
        `Attempted to decode a pointer through the start of another object ${currentOffset}`,
      );
    }

    const ptr = decodeCompressedPointer(this.stream.readUint32());
    if (ptr === 0) return 0;

    if (!this.offsetsOfAllPointers.has(currentOffset)) {
      throw new Error(
        `Attempted to decode data as a pointer at ${currentOffset}`,
      );
    }

    return ptr;
  }

  readObjectAt<T>(ptr: number, parseFn: ParseFn<T>, parseArgs?: any): T {
    const existing = this.offsetToObjectWithType.get(ptr);
    if (existing) {
      if (existing.obj === PARSING_PLACEHOLDER) {
        throw new Error(
          `Circular reference detected at ${ptr} - use recordSelfReferentialObject for self-referential objects`,
        );
      }
      if (existing.parseFn !== parseFn) {
        throw new Error(
          `Attempted to decode an object with a different decoder at ${ptr}`,
        );
      }
      return existing.obj as T;
    }

    // Put placeholder in the map
    const entry: ObjectWithType = {
      obj: PARSING_PLACEHOLDER,
      parseFn,
      parseArgs,
    };
    this.offsetToObjectWithType.set(ptr, entry);

    // Enter the new object
    let prevStart = this.currentObjectStartPtr;
    const currentOffset = this.stream.tell();
    this.stream.seek(ptr);
    this.nextReadIsStartOfObject = true;
    this.currentObjectStartPtr = ptr;

    // Parse it
    const result = parseFn(this, parseArgs);

    // Validate result
    if (result === undefined) {
      throw new Error(`Parsing function returned undefined at ${ptr}`);
    }

    // Check if recordSelfReferentialObject was called
    if (entry.obj === PARSING_PLACEHOLDER) {
      // No self-referential object was recorded, just store the result
      entry.obj = result;
    } else {
      // Self-referential object was recorded, verify it matches
      if (entry.obj !== result) {
        throw new Error(
          `Parsing function returned different object than was recorded with recordSelfReferentialObject at ${ptr}`,
        );
      }
    }

    // Leave this object
    this.currentObjectStartPtr = prevStart;
    this.nextReadIsStartOfObject = false;
    this.stream.seek(currentOffset);

    return result;
  }

  /**
   * For self-referential objects (circular references), call this at the START of your parsing
   * function, BEFORE reading any data that may reach a self-reference, to register the partially
   * constructed object. The parsing function MUST then return this same object.
   */
  recordSelfReferentialObject<T>(obj: T): void {
    const entry = this.offsetToObjectWithType.get(this.currentObjectStartPtr);
    if (!entry) {
      throw new Error(
        `recordSelfReferentialObject called but no entry at ${this.currentObjectStartPtr}`,
      );
    }
    if (entry.obj !== PARSING_PLACEHOLDER) {
      throw new Error(
        `recordSelfReferentialObject called but placeholder already replaced at ${this.currentObjectStartPtr}`,
      );
    }
    entry.obj = obj;
  }

  readPointerToObject<T>(parseFn: ParseFn<T>, parseArgs?: any): T {
    const ptr = this.readPointer();
    if (ptr === 0)
      throw new Error(
        `Null pointer detected where null objects not allowed ${this.stream.tell()}`,
      );
    return this.readObjectAt(ptr, parseFn, parseArgs);
  }

  readPointerToObjectMaybeNull<T>(
    parseFn: ParseFn<T>,
    parseArgs?: any,
  ): T | null {
    const ptr = this.readPointer();
    if (ptr === 0) return null;
    return this.readObjectAt(ptr, parseFn, parseArgs);
  }

  readArrayAt<T>(
    ptr: number,
    size: number,
    parseFn: ParseFn<T>,
    elementSize: number,
    parseArgs?: any,
    arrayIdxArg?: string,
  ): T[] {
    if (size === 0) {
      return [];
    }

    const result: T[] = [];
    for (let i = 0; i < size; i++) {
      const args = parseArgs ? { ...parseArgs } : {};
      if (arrayIdxArg !== undefined) {
        args[arrayIdxArg] = i;
      }
      result.push(this.readObjectAt(ptr + elementSize * i, parseFn, args));
    }

    return result;
  }

  readPtrToArray<T>(
    size: number,
    parseFn: ParseFn<T>,
    elementSize: number,
    parseArgs?: any,
    arrayIdxArg?: string,
  ): T[] {
    const ptr = this.readPointer();
    if (ptr === 0) {
      return [];
    }
    return this.readArrayAt(
      ptr,
      size,
      parseFn,
      elementSize,
      parseArgs,
      arrayIdxArg,
    );
  }

  readSizeThenArray<T>(
    parseFn: ParseFn<T>,
    elementSize: number,
    parseArgs?: any,
    arrayIdxArg?: string,
  ): T[] {
    const size = this.readUint32();
    return this.readPtrToArray(
      size,
      parseFn,
      elementSize,
      parseArgs,
      arrayIdxArg,
    );
  }
}

// Basic types
export function parseString(ctx: Context): string {
  const parts: Uint8Array[] = [];
  while (true) {
    const v = ctx.readBytes(4);
    parts.push(v);
    if (v.indexOf(0) !== -1) {
      break;
    }
  }

  const totalLength = parts.reduce((sum, arr) => sum + arr.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  // Find null terminator
  let end = combined.indexOf(0);
  if (end === -1) end = combined.length;

  const decoder = new TextDecoder("utf-8");
  return decoder.decode(combined.subarray(0, end));
}

export class Vec2 {
  public static readonly SIZE_IN_BYTES = 8;
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  static parse(ctx: Context): Vec2 {
    const x = ctx.readFloat32();
    const y = ctx.readFloat32();
    return new Vec2(x, y);
  }
}

export class Vec3 {
  public static readonly SIZE_IN_BYTES = 12;
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  static parse(ctx: Context): Vec3 {
    const x = ctx.readFloat32();
    const y = ctx.readFloat32();
    const z = ctx.readFloat32();
    return new Vec3(x, y, z);
  }
}

const COLOR_SIZE_IN_BYTES = 4;

function parseColor(ctx: Context): Color {
  const r = ctx.readUint8();
  const g = ctx.readUint8();
  const b = ctx.readUint8();
  const a = ctx.readUint8();
  return colorNewFromRGBA(r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
}

export class Int16Pair {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(
    readonly value1: number,
    readonly value2: number,
  ) {}

  static parse(ctx: Context): Int16Pair {
    const value1 = ctx.readInt16();
    const value2 = ctx.readInt16();
    return new Int16Pair(value1, value2);
  }
}

export function parseInt16Array(
  ctx: Context,
  parseArgs?: { size: number },
): number[] {
  const size = parseArgs!.size;
  const values: number[] = [];
  for (let i = 0; i < size; i++) {
    values.push(ctx.readInt16());
  }
  if (size % 2 !== 0) {
    // Padding should be zero
    ctx.readUint16Constant(0);
  }
  return values;
}

export function parseUint16Array(
  ctx: Context,
  parseArgs?: { size: number },
): number[] {
  const size = parseArgs!.size;
  const values: number[] = [];
  for (let i = 0; i < size; i++) {
    values.push(ctx.readUint16());
  }
  if (size % 2 !== 0) {
    // Padding should be zero
    ctx.readUint16Constant(0);
  }
  return values;
}

export function parseBool(ctx: Context): boolean {
  const v = ctx.readUint32();
  if (v === 0) return false;
  if (v === 1) return true;
  throw new Error(`parseBool got ${v}`);
}

export function parseInt32(ctx: Context): number {
  return ctx.readInt32();
}

export function parseFloat32(ctx: Context): number {
  return ctx.readFloat32();
}

export class RotRect {
  public static readonly SIZE_IN_BYTES = 20;
  constructor(
    readonly x1: number,
    readonly y1: number,
    readonly x2: number,
    readonly y2: number,
    readonly width: number,
  ) {}

  static parse(ctx: Context): RotRect {
    const x1 = ctx.readFloat32();
    const y1 = ctx.readFloat32();
    const x2 = ctx.readFloat32();
    const y2 = ctx.readFloat32();
    const width = ctx.readFloat32();
    return new RotRect(x1, y1, x2, y2, width);
  }
}

export type SignalIdentifier = number

export class InputSignalId {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly unk0: SignalIdentifier) {}

  static parse(ctx: Context): InputSignalId {
    const unk0 = ctx.readUint32();
    return new InputSignalId(unk0);
  }
}

export class StringPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly value: string) {}

  static parse(ctx: Context): StringPtr {
    const value = ctx.readPointerToObject(parseString);
    return new StringPtr(value);
  }
}

export function parsePropFFTerminatedIntList(ctx: Context): SignalIdentifier[] {
  const values: number[] = [];
  while (true) {
    const v = ctx.readUint32();
    if (v === 0xffffffff) {
      break;
    }
    values.push(v);
  }
  return values;
}

export function parsePropBinaryData(ctx: Context): Uint8Array {
  const guessedSize = ctx.calculateDistToStartOfNextObject(ctx.stream.tell());
  return ctx.readBytes(guessedSize);
}

export class Box {
  public static readonly SIZE_IN_BYTES = 24;
  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxY: number,
    readonly maxZ: number,
  ) {}

  static parse(ctx: Context): Box {
    const minX = ctx.readFloat32();
    const minY = ctx.readFloat32();
    const minZ = ctx.readFloat32();
    const maxX = ctx.readFloat32();
    const maxY = ctx.readFloat32();
    const maxZ = ctx.readFloat32();
    return new Box(minX, minY, minZ, maxX, maxY, maxZ);
  }
}

export class InSignalPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly unk0: SignalIdentifier[] | null) {}

  static parse(ctx: Context): InSignalPtr {
    const unk0 = ctx.readPointerToObjectMaybeNull(parsePropFFTerminatedIntList);
    return new InSignalPtr(unk0);
  }
}

// A single named output port on a reference/animsaisei or junction object.
// propertyName is like "eout_xxx"; signalIds are indices into the containing SubRoot's signalList.
export class OutSignal {
  constructor(
    readonly propertyName: string,
    readonly signalIds: SignalIdentifier[],
  ) {}

  static parse(ctx: Context): OutSignal {
    const propertyName = ctx.readPointerToObject(parseString);
    const signalIds = ctx.readPointerToObject(parsePropFFTerminatedIntList);
    return new OutSignal(propertyName, signalIds);
  }
}

// Parses a null-pointer-terminated list of OutSignal pointers (typeId 38, used for "out_signals").
export function parseOutSignalPtrList(ctx: Context): OutSignal[] {
  const values: OutSignal[] = [];
  while (true) {
    const v = ctx.readPointerToObjectMaybeNull(OutSignal.parse);
    if (v === null) break;
    values.push(v);
  }
  return values;
}

export class VariableName1 {
  constructor(readonly unk0: number) {}

  static parse(ctx: Context): VariableName1 {
    const unk0 = ctx.readUint32();
    return new VariableName1(unk0);
  }
}

export class VariableName {
  public static readonly SIZE_IN_BYTES = 8;
  constructor(
    readonly unk0: number,
    readonly unk1: VariableName1,
  ) {}

  static parse(ctx: Context): VariableName {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readPointerToObject(VariableName1.parse);
    return new VariableName(unk0, unk1);
  }
}

// Polygon types
export class PolygonComponent {
  public static readonly SIZE_IN_BYTES = 32;
  public indices: Int16Pair[] = [];
  // Friction values:
  // -10000 => Not slippery, default slipperiness
  // -0.090 => Super slippery launcher (used in yama03 before a big launch)
  // -0.055 => Very slippery launcher (used in yama03 at a big launch)
  //  0.000 => A bit slippery (used in falling tunnels)
  //  0.600 => Very sticky, used for snow
  public friction: number = 0;
  // Surface types:
  // 0 => Regular
  // 1 => Sticky, Locoroco will bite it and hang on upside down
  public surfaceType: number = 0;
  // Zero or 1. Found occurrence of [1] under a squishy area in st_snow01.clv
  public unk4: number = 0;
  public unk5: number = 0;
  public unk6: number = 0;
  public onCollisionSignals: SignalIdentifier[] | null = null;

  private static readonly VALID_SURFACE_TYPES = new Set([0, 1, 2, 3, 10]);
  private static readonly VALID_UNK4_VALUES = new Set([0, 1]);

  static parse(ctx: Context): PolygonComponent {
    const result = new PolygonComponent();
    result.indices = ctx.readSizeThenArray(
      Int16Pair.parse,
      Int16Pair.SIZE_IN_BYTES,
    );
    result.friction = ctx.readFloat32();
    result.surfaceType = ctx.readUint32();
    if (!PolygonComponent.VALID_SURFACE_TYPES.has(result.surfaceType)) {
      throw new Error(`Unexpected surface type: ${result.surfaceType}`);
    }
    result.unk4 = ctx.readUint32();
    if (!PolygonComponent.VALID_UNK4_VALUES.has(result.unk4)) {
      throw new Error(`Unexpected unk4: ${result.unk4}`);
    }
    result.unk5 = ctx.readFloat32();
    result.unk6 = ctx.readInt32();
    result.onCollisionSignals = ctx.readPointerToObjectMaybeNull(
      parsePropFFTerminatedIntList,
    );
    return result;
  }
}

export class Polygon {
  public static readonly SIZE_IN_BYTES = 16;
  public points: Vec2[] = [];
  public components: PolygonComponent[] = [];

  static parse(ctx: Context): Polygon {
    const result = new Polygon();
    result.points = ctx.readSizeThenArray(Vec2.parse, Vec2.SIZE_IN_BYTES);
    result.components = ctx.readSizeThenArray(
      PolygonComponent.parse,
      PolygonComponent.SIZE_IN_BYTES,
    );
    return result;
  }
}

// Buffer/Texture types
export class BufferMipData {
  constructor(readonly data: Uint8Array) {}

  static parse(
    ctx: Context,
    parseArgs?: { dataLength: number },
  ): BufferMipData {
    const data = ctx.readBytes(parseArgs!.dataLength);
    return new BufferMipData(data);
  }
}

export class BufferMipDataPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly data: BufferMipData) {}

  static parse(
    ctx: Context,
    parseArgs?: {
      textureFormat: TextureFormat;
      width: number;
      height: number;
      mipMapLevel: number;
    },
  ): BufferMipDataPtr {
    const { textureFormat, width, height, mipMapLevel } = parseArgs!;
    const dataLength = textureFormat.calcDataSize(
      width >> mipMapLevel,
      height >> mipMapLevel,
    );
    const data = ctx.readPointerToObject(BufferMipData.parse, { dataLength });
    return new BufferMipDataPtr(data);
  }
}

export class BufferPalette {
  constructor(readonly rawValues: number[]) {}

  static parse(
    ctx: Context,
    parseArgs?: { textureFormat: TextureFormat },
  ): BufferPalette {
    const textureFormat = parseArgs!.textureFormat;
    if (textureFormat.paletteSize === null) {
      throw new Error(
        "BufferPalette instantiated for texture format without palette!",
      );
    }

    const numColors = textureFormat.calcNumPaletteColours();
    const colorSize = textureFormat.paletteColorSize();
    const rawValues: number[] = [];
    for (let i = 0; i < numColors; i++) {
      if (colorSize === 2) {
        rawValues.push(ctx.readUint16());
      } else {
        rawValues.push(ctx.readUint32());
      }
    }
    return new BufferPalette(rawValues);
  }
}

export class Buffer {
  constructor(
    readonly fileOffset: number,
    readonly sourceFilename: string,
    readonly width: number,
    readonly height: number,
    readonly formatIdx: number,
    readonly textureFormat: TextureFormat,
    readonly palette: BufferPalette | null,
    readonly mips: BufferMipDataPtr[],
  ) {}

  static parse(ctx: Context): Buffer {
    const fileOffset = ctx.stream.tell();
    const sourceFilename = ctx.readPointerToObject(parseString);

    ctx.readUint32Constant(0);
    const width = ctx.readUint16();
    const height = ctx.readUint16();
    const formatIdx = ctx.readUint8();
    const numberOfMips = ctx.readUint8();
    ctx.readUint8Constant(0);
    ctx.readUint8Constant(0);

    let textureFormat: TextureFormat;
    if (formatIdx === 4) {
      textureFormat = new TextureFormat(
        256,
        PalettePixelFormat.RGBA8888,
        8,
        16,
        8,
      );
    } else if (formatIdx === 1) {
      textureFormat = new TextureFormat(
        16,
        PalettePixelFormat.RGBA8888,
        4,
        32,
        8,
      );
    } else if (formatIdx === 3) {
      textureFormat = new TextureFormat(
        16,
        PalettePixelFormat.RGB5650,
        4,
        32,
        8,
      );
    } else if (formatIdx === 7) {
      textureFormat = new TextureFormat(
        null,
        PalettePixelFormat.RGBA8888,
        32,
        4,
        8,
      );
    } else {
      throw new Error(`Unknown texture format: ${formatIdx}`);
    }

    const palette = ctx.readPointerToObjectMaybeNull(BufferPalette.parse, {
      textureFormat,
    });

    if (textureFormat.paletteSize === null && palette !== null) {
      throw new Error("Had a palette, but did not expect to!");
    }

    const mips = ctx.readPtrToArray(
      numberOfMips,
      BufferMipDataPtr.parse,
      BufferMipDataPtr.SIZE_IN_BYTES,
      { textureFormat, width, height },
      "mipMapLevel",
    );

    return new Buffer(
      fileOffset,
      sourceFilename,
      width,
      height,
      formatIdx,
      textureFormat,
      palette,
      mips,
    );
  }
}

// textureMode: 0x10200 = repeat, 0x10203 = clamp
export class File {
  constructor(
    readonly name: string,
    readonly fileType: number,
    readonly textureMode: number,
    readonly unk5: number,
    readonly unk6: number,
    readonly uScaling: number,
    readonly vScaling: number,
    readonly buffer: Buffer,
  ) {}

  static parse(ctx: Context): File {
    const name = ctx.readPointerToObject(parseString);
    const fileType = ctx.readUint32();
    ctx.readUint32Constant(0);
    const textureMode = ctx.readUint32();
    if (textureMode !== 0x10200 && textureMode !== 0x10203) {
      throw new Error(
        `File "${name}": unknown textureMode 0x${textureMode.toString(16)}`,
      );
    }
    const unk5 = ctx.readUint32();
    const unk6 = ctx.readFloat32();
    const uScaling = ctx.readFloat32();
    const vScaling = ctx.readFloat32();
    const buffer = ctx.readPointerToObject(Buffer.parse);
    return new File(
      name,
      fileType,
      textureMode,
      unk5,
      unk6,
      uScaling,
      vScaling,
      buffer,
    );
  }
}

export class Material {
  // Material type values:
  // 0 -> Regular texture
  // 1 -> Perhaps for animated textures
  // 2 -> Switch textures
  // 3 -> Only used for switch texture (sk_switch.tga)
  // 4 -> UI textures
  // 6 -> Menu shaders (continueTitleMenuShader, menuTitleMenuShader)
  constructor(
    readonly name: string,
    readonly materialType: number,
    readonly color: Color,
    readonly file: File | null,
  ) {}

  static parse(ctx: Context): Material {
    const name = ctx.readPointerToObject(parseString);
    const materialType = ctx.readUint32();
    const color = parseColor(ctx);
    const file = ctx.readPointerToObjectMaybeNull(File.parse);
    return new Material(name, materialType, color, file);
  }
}

export class MaterialPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly material: Material) {}

  static parse(ctx: Context): MaterialPtr {
    const material = ctx.readPointerToObject(Material.parse);
    return new MaterialPtr(material);
  }
}

// Mesh vertex types
export class MeshVertexA {
  public static readonly SIZE_IN_BYTES = 16;
  // UV coordinates - supposedly signed according to pspsdk
  // See: https://github.com/pspdev/pspsdk/blob/master/src/gu/pspgu.h
  constructor(
    readonly u: number,
    readonly v: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  static parse(ctx: Context): MeshVertexA {
    const u = ctx.readUint16();
    const v = ctx.readUint16();
    const x = ctx.readFloat32();
    const y = ctx.readFloat32();
    const z = ctx.readFloat32();
    return new MeshVertexA(u, v, x, y, z);
  }
}

export class MeshVertexB {
  public static readonly SIZE_IN_BYTES = 20;
  // Vertex color - probably A8R8G8B8 format
  constructor(
    readonly u: number,
    readonly v: number,
    readonly r: number,
    readonly g: number,
    readonly b: number,
    readonly a: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  static parse(ctx: Context): MeshVertexB {
    const u = ctx.readUint16();
    const v = ctx.readUint16();
    const r = ctx.readUint8();
    const g = ctx.readUint8();
    const b = ctx.readUint8();
    const a = ctx.readUint8();
    const x = ctx.readFloat32();
    const y = ctx.readFloat32();
    const z = ctx.readFloat32();
    return new MeshVertexB(u, v, r, g, b, a, x, y, z);
  }
}

export class VertexBuffer {
  public static readonly SIZE_IN_BYTES = 8;
  public type: number = 0;
  public size: number = 0;
  public data: (MeshVertexA | MeshVertexB)[] = [];

  static parse(ctx: Context): VertexBuffer {
    const result = new VertexBuffer();
    result.type = ctx.readUint16();
    result.size = ctx.readUint16();
    if (result.type === 0) {
      result.data = ctx.readPtrToArray(
        result.size,
        MeshVertexA.parse,
        MeshVertexA.SIZE_IN_BYTES,
      );
    } else if (result.type === 1) {
      result.data = ctx.readPtrToArray(
        result.size,
        MeshVertexB.parse,
        MeshVertexB.SIZE_IN_BYTES,
      );
    } else {
      throw new Error(`Unknown vertex buffer type: ${result.type}`);
    }
    return result;
  }
}

// Int16ArraySizedPtr
export function parseInt16ArraySizedPtr(ctx: Context): number[] {
  const size = ctx.readUint32();
  return ctx.readPointerToObject(parseInt16Array, { size });
}

// Collision mesh types
export class CollisionMeshComponent {
  public static readonly SIZE_IN_BYTES = 20;
  constructor(
    readonly unk0: number,
    readonly material: Material,
    readonly tristrips: number[][],
  ) {}

  static parse(ctx: Context): CollisionMeshComponent {
    const unk0 = ctx.readUint32();
    ctx.readUint32Constant(0);
    const material = ctx.readPointerToObject(Material.parse);
    const tristrips = ctx.readSizeThenArray(parseInt16ArraySizedPtr, 8);
    return new CollisionMeshComponent(unk0, material, tristrips);
  }
}

export class PropCollisionMesh6 {
  constructor(
    readonly unk0: number,
    readonly unk1: number,
  ) {}

  static parse(ctx: Context): PropCollisionMesh6 {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    return new PropCollisionMesh6(unk0, unk1);
  }
}

export class Vec2List {
  constructor(readonly vects: Vec2[]) {}

  static parse(ctx: Context): Vec2List {
    const vects = ctx.readSizeThenArray(Vec2.parse, Vec2.SIZE_IN_BYTES);
    return new Vec2List(vects);
  }
}

export class PropCollisionMesh {
  constructor(
    public unk0: number,
    public unk2: CollisionMeshComponent,
    public vertices: VertexBuffer,
    public unk5: Polygon,
    public unk6: PropCollisionMesh6,
  ) {}

  protected static parseBase(ctx: Context) {
    const unk0 = ctx.readUint32();
    ctx.readUint32Constant(0);
    const unk2 = ctx.readPointerToObject(CollisionMeshComponent.parse);
    const vertices = VertexBuffer.parse(ctx);
    const unk5 = ctx.readPointerToObject(Polygon.parse);
    const unk6 = ctx.readPointerToObject(PropCollisionMesh6.parse);
    return { unk0, unk2, vertices, unk5, unk6 };
  }

  static parse(ctx: Context): PropCollisionMesh {
    const { unk0, unk2, vertices, unk5, unk6 } =
      PropCollisionMesh.parseBase(ctx);
    return new PropCollisionMesh(unk0, unk2, vertices, unk5, unk6);
  }
}

export class PropCollisionMesh47 extends PropCollisionMesh {
  static override parse(ctx: Context): PropCollisionMesh47 {
    const { unk0, unk2, vertices, unk5, unk6 } =
      PropCollisionMesh.parseBase(ctx);
    return new PropCollisionMesh47(unk0, unk2, vertices, unk5, unk6);
  }
}

export class PropCollisionMesh48 extends PropCollisionMesh {
  constructor(
    unk0: number,
    unk2: CollisionMeshComponent,
    vertices: VertexBuffer,
    unk5: Polygon,
    unk6: PropCollisionMesh6,
    public unk7: Vec2List,
  ) {
    super(unk0, unk2, vertices, unk5, unk6);
  }

  static override parse(ctx: Context): PropCollisionMesh48 {
    const { unk0, unk2, vertices, unk5, unk6 } =
      PropCollisionMesh.parseBase(ctx);
    const unk7 = ctx.readPointerToObject(Vec2List.parse);
    return new PropCollisionMesh48(unk0, unk2, vertices, unk5, unk6, unk7);
  }
}

// Mesh types
export class MeshComponent {
  public static readonly SIZE_IN_BYTES = 20;
  constructor(
    readonly unk0: number,
    readonly unk1: number,
    readonly material: Material,
    readonly vertices: VertexBuffer[],
  ) {}

  static parse(ctx: Context): MeshComponent {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    const material = ctx.readPointerToObject(Material.parse);
    const vertices = ctx.readSizeThenArray(
      VertexBuffer.parse,
      VertexBuffer.SIZE_IN_BYTES,
    );
    return new MeshComponent(unk0, unk1, material, vertices);
  }
}

export class Mesh {
  public unk0: number = 0;
  public meshComponents: MeshComponent[] = [];

  static parse(ctx: Context): Mesh {
    const result = new Mesh();
    result.unk0 = ctx.readUint16();
    const size = ctx.readUint16();
    ctx.readUint32Constant(0);
    result.meshComponents = ctx.readPtrToArray(
      size,
      MeshComponent.parse,
      MeshComponent.SIZE_IN_BYTES,
    );
    return result;
  }
}

export class MeshPtr {
  constructor(readonly mesh: Mesh | null) {}

  static parse(ctx: Context): MeshPtr {
    const mesh = ctx.readPointerToObjectMaybeNull(Mesh.parse);
    return new MeshPtr(mesh);
  }
}

// Spring types
export class PropSpring7 {
  public offset: number = 0;
  public dataHere: Uint8Array = new Uint8Array(0);
  public distToStartOfNextObject: number = 0;

  static parse(ctx: Context): PropSpring7 {
    const result = new PropSpring7();
    result.offset = ctx.stream.tell();
    result.distToStartOfNextObject = ctx.calculateDistToStartOfNextObject(
      result.offset,
    );
    if (result.distToStartOfNextObject > 2 * 1024 * 1024) {
      result.dataHere = ctx.readBytes(16);
    } else {
      result.dataHere = ctx.readBytes(result.distToStartOfNextObject);
    }
    return result;
  }
}

export class PropSpring8 {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly unk0: number) {}

  static parse(ctx: Context): PropSpring8 {
    const unk0 = ctx.readUint32();
    return new PropSpring8(unk0);
  }
}

export class PropSpring12 {
  public static readonly SIZE_IN_BYTES = 16;
  constructor(
    readonly unk0: number,
    readonly unk1: number,
    readonly unk2: number,
    readonly unk3: number,
  ) {}

  static parse(ctx: Context): PropSpring12 {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    const unk2 = ctx.readUint32();
    const unk3 = ctx.readUint32();
    return new PropSpring12(unk0, unk1, unk2, unk3);
  }
}

export class PropSpring14 {
  public static readonly SIZE_IN_BYTES = 16;
  constructor(
    readonly unk0: number,
    readonly unk1: number,
    readonly unk2: number,
    readonly unk3: number,
  ) {}

  static parse(ctx: Context): PropSpring14 {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    const unk2 = ctx.readUint32();
    const unk3 = ctx.readUint32();
    return new PropSpring14(unk0, unk1, unk2, unk3);
  }
}

export class PropSpring {
  public static readonly SIZE_IN_BYTES = 60;
  constructor(
    readonly unk0a: number,
    readonly unk0b: number,
    readonly unk2: CollisionMeshComponent[],
    readonly unk3a: number,
    readonly unk3b: number,
    readonly unk4: MeshVertexA[],
    readonly unk5: Polygon,
    readonly unk6: number[],
    readonly unk7: PropSpring7,
    readonly unk8: PropSpring8[],
    readonly unk10: number[],
    readonly unk12: PropSpring12[],
    readonly unk14: PropSpring14[],
  ) {}

  static parse(ctx: Context): PropSpring {
    const unk0a = ctx.readUint16();
    const unk0b = ctx.readUint16();
    ctx.readUint32Constant(0);
    const unk2 = ctx.readPtrToArray(
      unk0b,
      CollisionMeshComponent.parse,
      CollisionMeshComponent.SIZE_IN_BYTES,
    );
    const unk3a = ctx.readUint16();
    const unk3b = ctx.readUint16();
    const unk4 = ctx.readPtrToArray(
      unk3b,
      MeshVertexA.parse,
      MeshVertexA.SIZE_IN_BYTES,
    );
    const unk5 = ctx.readPointerToObject(Polygon.parse);
    const unk6 = ctx.readPointerToObject(parseInt16Array, { size: unk3b });
    const unk7 = ctx.readPointerToObject(PropSpring7.parse);
    const unk8 = ctx.readPtrToArray(
      unk3b,
      PropSpring8.parse,
      PropSpring8.SIZE_IN_BYTES,
    );
    const unk10Size = ctx.readUint32();
    const unk10 = ctx.readPointerToObject(parseInt16Array, { size: unk10Size });
    const unk12 = ctx.readSizeThenArray(
      PropSpring12.parse,
      PropSpring12.SIZE_IN_BYTES,
    );
    const unk14 = ctx.readSizeThenArray(
      PropSpring14.parse,
      PropSpring14.SIZE_IN_BYTES,
    );
    return new PropSpring(
      unk0a,
      unk0b,
      unk2,
      unk3a,
      unk3b,
      unk4,
      unk5,
      unk6,
      unk7,
      unk8,
      unk10,
      unk12,
      unk14,
    );
  }
}

// PropVertex - note: references LocoObject which is defined later, uses forward reference
export class PropVertex {
  public static readonly SIZE_IN_BYTES = 16;
  constructor(
    readonly unk0: LocoObject,
    readonly unk1: number,
    readonly unk2: number,
    readonly unk3: Vec2,
  ) {}

  static parse(ctx: Context): PropVertex {
    const unk0 = ctx.readPointerToObject(LocoObject.parse);
    const unk1 = ctx.readUint32();
    const unk2 = ctx.readUint32();
    const unk3 = ctx.readPointerToObject(Vec2.parse);
    return new PropVertex(unk0, unk1, unk2, unk3);
  }
}

// Tabtable types
export class PropTabtable2020 {
  constructor(
    readonly unk0: number,
    readonly unk1: number,
    readonly unk2: number,
    readonly unk3: number,
    readonly unk4: number,
    readonly unk5: number,
    readonly unk6: number,
    readonly unk7: number | null,
    readonly unk8: string,
    readonly unk9: string,
  ) {}

  static parse(ctx: Context): PropTabtable2020 {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    const unk2 = ctx.readUint32();
    const unk3 = ctx.readUint32();
    const unk4 = ctx.readUint32();
    const unk5 = ctx.readUint32();
    const unk6 = ctx.readUint32();
    let unk7: number | null;
    if (ctx.gameVersion === GameVersion.Prototype) {
      unk7 = null;
    } else {
      unk7 = ctx.readUint32();
    }
    const unk8 = ctx.readPointerToObject(parseString);
    const unk9 = ctx.readPointerToObject(parseString);
    return new PropTabtable2020(
      unk0,
      unk1,
      unk2,
      unk3,
      unk4,
      unk5,
      unk6,
      unk7,
      unk8,
      unk9,
    );
  }
}

export class PropTabtable202 {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly unk0: PropTabtable2020) {}

  static parse(ctx: Context): PropTabtable202 {
    const unk0 = ctx.readPointerToObject(PropTabtable2020.parse);
    return new PropTabtable202(unk0);
  }
}

export class PropTabtable20 {
  constructor(
    readonly unk0: number,
    readonly unk2: PropTabtable202[],
    readonly unk3: Material,
  ) {}

  static parse(ctx: Context): PropTabtable20 {
    const unk0 = ctx.readUint32();
    const unk2 = ctx.readSizeThenArray(
      PropTabtable202.parse,
      PropTabtable202.SIZE_IN_BYTES,
    );
    const unk3 = ctx.readPointerToObject(Material.parse);
    return new PropTabtable20(unk0, unk2, unk3);
  }
}

export class PropTabtable2 {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly unk0: PropTabtable20) {}

  static parse(ctx: Context): PropTabtable2 {
    const unk0 = ctx.readPointerToObject(PropTabtable20.parse);
    return new PropTabtable2(unk0);
  }
}

export class PropTabtable {
  constructor(
    readonly unk0: number,
    readonly unk2: PropTabtable2[],
  ) {}

  static parse(ctx: Context): PropTabtable {
    const unk0 = ctx.readUint32();
    const unk2 = ctx.readSizeThenArray(
      PropTabtable2.parse,
      PropTabtable2.SIZE_IN_BYTES,
    );
    return new PropTabtable(unk0, unk2);
  }
}

// Animation types
export class AnimationTrackData {
  public data: Uint8Array = new Uint8Array(0);
  public elementCount: number = 0;
  public elementSizeInBits: number = 0;

  static parse(
    ctx: Context,
    parseArgs?: { elementCount: number; elementSizeInBits: number },
  ): AnimationTrackData {
    const result = new AnimationTrackData();
    const { elementCount, elementSizeInBits } = parseArgs!;
    const dataBlockSizeInBytes =
      Math.ceil((elementSizeInBits * elementCount) / 32) * 4;
    result.data = ctx.readBytes(dataBlockSizeInBytes);
    result.elementCount = elementCount;
    result.elementSizeInBits = elementSizeInBits;
    return result;
  }
}

function lerp(s: number, l: number, e: number): number {
  return s + (e * l) / 65535;
}

// Base class for animation tracks - uses helper function for base parsing
export abstract class AnimationTrack {
  constructor(
    public startTime: number,
    public endTime: number,
    public duration: number,
    public elementDuration: number,
    public unk5: number,
    public data: any[],
  ) {}

  protected static parseBase(ctx: Context) {
    ctx.readUint32Constant(0);
    const startTime = ctx.readFloat32();
    const endTime = ctx.readFloat32();
    const duration = ctx.readFloat32();
    const elementDuration = ctx.readFloat32();
    const unk5 = ctx.readUint32();
    return { startTime, endTime, duration, elementDuration, unk5 };
  }

  public sampleFrame(t: number): { frameIndex: number; frac: number } {
    const localT = Math.max(0, Math.min(t - this.startTime, this.duration));
    if (this.elementDuration <= 0 || this.data.length === 0)
      return { frameIndex: 0, frac: 0 };
    const rawFrame = localT / this.elementDuration;
    const frameIndex = Math.min(Math.floor(rawFrame), this.data.length - 1);
    const frac = rawFrame - Math.floor(rawFrame);
    return { frameIndex, frac };
  }

  public abstract sample(t: number): any;
}

export class AnimationTrackBool extends AnimationTrack {
  static parse(ctx: Context): AnimationTrackBool {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);

    const elementCount = ctx.readUint32();
    const rawData = ctx.readPointerToObject(AnimationTrackData.parse, {
      elementCount,
      elementSizeInBits: 1,
    });

    const data: boolean[] = [];
    for (let i = 0; i < rawData.elementCount; i++) {
      const byte_idx = (i >> 3) ^ 3;
      const shift = 7 - (i & 7);
      const v = (rawData.data[byte_idx] >> shift) & 1;
      data.push(v !== 0);
    }
    return new AnimationTrackBool(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
    );
  }

  public sample(t: number): boolean {
    if (this.data.length === 0) return true;
    const { frameIndex } = this.sampleFrame(t);
    return this.data[frameIndex] as boolean;
  }
}

export class AnimationTrackFloat extends AnimationTrack {
  static parse(ctx: Context): AnimationTrackFloat {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);

    const count = ctx.readUint32();
    const rawData = ctx.readPointerToObject(parseUint16Array, { size: count });
    const s = ctx.readFloat32();
    const e = ctx.readFloat32();
    const data = rawData.map((l) => lerp(s, l, e));
    return new AnimationTrackFloat(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
    );
  }

  public sample(t: number): number {
    if (this.data.length === 0) return 0;
    const { frameIndex, frac } = this.sampleFrame(t);
    const a = this.data[frameIndex] as number;
    const b = this.data[
      Math.min(frameIndex + 1, this.data.length - 1)
    ] as number;
    return a + (b - a) * frac;
  }
}

export class AnimationTrackAngle extends AnimationTrack {
  static parse(ctx: Context): AnimationTrackAngle {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);

    const count = ctx.readUint32();
    const rawData = ctx.readPointerToObject(parseUint16Array, { size: count });
    const s = ctx.readFloat32();
    const e = ctx.readFloat32();
    const data = rawData.map((l) => lerp(s, l, e));
    return new AnimationTrackAngle(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
    );
  }

  public sample(t: number): number {
    if (this.data.length === 0) return 0;
    const { frameIndex, frac } = this.sampleFrame(t);
    const a = this.data[frameIndex] as number;
    const b = this.data[
      Math.min(frameIndex + 1, this.data.length - 1)
    ] as number;
    const TAU = Math.PI * 2;
    let diff = (b - a) % TAU;
    if (diff > Math.PI) diff -= TAU;
    else if (diff < -Math.PI) diff += TAU;
    return a + diff * frac;
  }
}

export class AnimationTrackVec3 extends AnimationTrack {
  static parse(ctx: Context): AnimationTrackVec3 {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);

    const count = ctx.readUint32();
    const rawData = ctx.readPointerToObject(parseUint16Array, {
      size: count * 3,
    });
    const s1 = ctx.readFloat32();
    const s2 = ctx.readFloat32();
    const s3 = ctx.readFloat32();
    const e1 = ctx.readFloat32();
    const e2 = ctx.readFloat32();
    const e3 = ctx.readFloat32();

    const data: Vec3[] = [];
    for (let i = 0; i < count * 3; i += 3) {
      const x = lerp(s1, rawData[i], e1);
      const y = lerp(s2, rawData[i + 1], e2);
      const z = lerp(s3, rawData[i + 2], e3);
      data.push(new Vec3(x, y, z));
    }
    return new AnimationTrackVec3(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
    );
  }

  public sample(t: number): Vec3 {
    if (this.data.length === 0) return new Vec3(0, 0, 0);
    const { frameIndex, frac } = this.sampleFrame(t);
    const a = this.data[frameIndex] as Vec3;
    const b = this.data[Math.min(frameIndex + 1, this.data.length - 1)] as Vec3;
    return new Vec3(
      a.x + (b.x - a.x) * frac,
      a.y + (b.y - a.y) * frac,
      a.z + (b.z - a.z) * frac,
    );
  }
}

export class AnimationTrackMaterialColor extends AnimationTrack {
  constructor(
    startTime: number,
    endTime: number,
    duration: number,
    elementDuration: number,
    unk5: number,
    data: any[],
    public material: Material,
  ) {
    super(startTime, endTime, duration, elementDuration, unk5, data);
  }

  static parse(ctx: Context): AnimationTrackMaterialColor {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);
    const data = ctx.readSizeThenArray(parseColor, COLOR_SIZE_IN_BYTES);
    const material = ctx.readPointerToObject(Material.parse);
    return new AnimationTrackMaterialColor(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
      material,
    );
  }

  public sampleInto(dst: Color, t: number): void {
    if (this.data.length === 0) {
      colorFromRGBA(dst, 1, 1, 1, 1);
      return;
    }
    const { frameIndex, frac } = this.sampleFrame(t);
    const a = this.data[frameIndex] as Color;
    const b = this.data[
      Math.min(frameIndex + 1, this.data.length - 1)
    ] as Color;
    colorLerp(dst, a, b, frac);
  }

  public sample(t: number): Color {
    const dst = colorNewFromRGBA(0, 0, 0, 0);
    this.sampleInto(dst, t);
    return dst;
  }
}

export class BufferPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly buffer: Buffer) {}

  static parse(ctx: Context): BufferPtr {
    const buffer = ctx.readPointerToObject(Buffer.parse);
    return new BufferPtr(buffer);
  }
}

// Type 0: Probably switches the buffer used for this file
export class AnimationTrackFileSwitch extends AnimationTrack {
  constructor(
    startTime: number,
    endTime: number,
    duration: number,
    elementDuration: number,
    unk5: number,
    data: any[],
    public file: File,
  ) {
    super(startTime, endTime, duration, elementDuration, unk5, data);
  }

  static parse(ctx: Context): AnimationTrackFileSwitch {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);
    const data = ctx.readSizeThenArray(
      BufferPtr.parse,
      BufferPtr.SIZE_IN_BYTES,
    );
    const file = ctx.readPointerToObject(File.parse);
    return new AnimationTrackFileSwitch(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
      file,
    );
  }

  public sample(t: number): BufferPtr | null {
    if (this.data.length === 0) return null;
    const { frameIndex } = this.sampleFrame(t);
    return this.data[frameIndex] as BufferPtr;
  }
}

// Type 3/4: Probably updates the UV coordinates for the texture.
// Type 3 lerps the X coordinate between two values, Type 4 lerps the Y coordinate.
export class AnimationTrackFileUVScroll extends AnimationTrack {
  constructor(
    startTime: number,
    endTime: number,
    duration: number,
    elementDuration: number,
    unk5: number,
    data: any[],
    public file: File,
  ) {
    super(startTime, endTime, duration, elementDuration, unk5, data);
  }

  static parse(ctx: Context): AnimationTrackFileUVScroll {
    const { startTime, endTime, duration, elementDuration, unk5 } =
      AnimationTrack.parseBase(ctx);
    const count = ctx.readUint32();
    const rawData = ctx.readPointerToObject(parseUint16Array, { size: count });
    const s = ctx.readFloat32();
    const e = ctx.readFloat32();
    const data = rawData.map((l) => lerp(s, l, e));
    const file = ctx.readPointerToObject(File.parse);
    return new AnimationTrackFileUVScroll(
      startTime,
      endTime,
      duration,
      elementDuration,
      unk5,
      data,
      file,
    );
  }

  public sample(t: number): number {
    if (this.data.length === 0) return 0;
    const { frameIndex, frac } = this.sampleFrame(t);
    const a = this.data[frameIndex] as number;
    const b = this.data[
      Math.min(frameIndex + 1, this.data.length - 1)
    ] as number;
    return a + (b - a) * frac;
  }
}

export class AnimationUnk100 {
  constructor(
    readonly unk0: number,
    readonly unk1: number,
    readonly unk2: number,
    readonly unk3: number,
    readonly unk4: number,
    readonly unk5: number,
  ) {}

  static parse(ctx: Context): AnimationUnk100 {
    const unk0 = ctx.readUint32();
    const unk1 = ctx.readUint32();
    const unk2 = ctx.readUint32();
    const unk3 = ctx.readUint32();
    const unk4 = ctx.readUint32();
    const unk5 = ctx.readUint32();
    return new AnimationUnk100(unk0, unk1, unk2, unk3, unk4, unk5);
  }
}

export class AnimationUnk102 {
  constructor(readonly unk1: number) {}

  static parse(ctx: Context): AnimationUnk102 {
    ctx.readUint32Constant(0);
    const unk1 = ctx.readUint32();
    return new AnimationUnk102(unk1);
  }
}

export class AnimationUnk10 {
  constructor(
    readonly unk0: AnimationUnk100,
    readonly unk2: AnimationUnk102,
  ) {}

  static parse(ctx: Context): AnimationUnk10 {
    const unk0 = ctx.readPointerToObject(AnimationUnk100.parse);
    ctx.readUint32Constant(0);
    const unk2 = ctx.readPointerToObject(AnimationUnk102.parse);
    return new AnimationUnk10(unk0, unk2);
  }
}

export const enum AnimationTrackFileType {
  BufferSwitch = 0,
  UScroll = 3,
  VScroll = 4,
}

export class AnimationTrackFilePtr {
  public static readonly SIZE_IN_BYTES = 12;
  constructor(
    readonly track: AnimationTrackFileSwitch | AnimationTrackFileUVScroll,
    readonly fileType: AnimationTrackFileType,
  ) {}

  static parse(ctx: Context): AnimationTrackFilePtr {
    ctx.readUint32Constant(1);

    const fileType = ctx.readUint32() as AnimationTrackFileType;
    let track: AnimationTrackFileSwitch | AnimationTrackFileUVScroll;
    if (fileType === AnimationTrackFileType.BufferSwitch) {
      track = ctx.readPointerToObject(AnimationTrackFileSwitch.parse);
    } else if (fileType === AnimationTrackFileType.UScroll || fileType === AnimationTrackFileType.VScroll) {
      track = ctx.readPointerToObject(AnimationTrackFileUVScroll.parse);
    } else {
      throw new Error(`Unexpected AnimationTrackFilePtr fileType: ${fileType}`);
    }
    return new AnimationTrackFilePtr(track, fileType);
  }
}

export class AnimationTrackMaterialColorPtr {
  public static readonly SIZE_IN_BYTES = 12;
  constructor(readonly track: AnimationTrackMaterialColor) {}

  static parse(ctx: Context): AnimationTrackMaterialColorPtr {
    ctx.readUint32Constant(1);
    ctx.readUint32Constant(0);
    const track = ctx.readPointerToObject(AnimationTrackMaterialColor.parse);
    return new AnimationTrackMaterialColorPtr(track);
  }
}

export const enum PropTypeId {
  Bool = 1,
  Int = 7,
  Float = 9,
  StringPtr = 14,
  Vec2 = 15,
  Vec3 = 16,
  BinaryData = 18,
  Tabtable = 19,
  SubRoot = 20,
  InputSignal = 23,
  FFTerminatedIntList = 24,
  Polygon = 26,
  Mesh = 28,
  Box = 32,
  RotRect = 36,
  InSignalPtr = 37,
  OutSignalPtrList = 38,
  Spring = 42,
  MaterialPtr = 43,
  Vertex = 44,
  Angle = 45,
  VariableName = 46,
  CollisionMesh47 = 47,
  CollisionMesh48 = 48,
}

// Forward declarations for circular references
export class ObjectProperty {
  constructor(
    readonly name: string,
    readonly typeId: PropTypeId,
    readonly valueCount: number,
    readonly value: any,
  ) {}

  formatValue(): string {
    if (Array.isArray(this.value)) {
      return `[${(this.value as any[]).map((v: any) => ObjectProperty.formatSingleValue(v, this.typeId)).join(", ")}]`;
    }
    return ObjectProperty.formatSingleValue(this.value, this.typeId);
  }

  private static formatSingleValue(val: any, typeId: PropTypeId): string {
    if (val === null || val === undefined) return "null";
    switch (typeId) {
      case PropTypeId.Bool:
        return val ? "true" : "false";
      case PropTypeId.Int:
        return String(val);
      case PropTypeId.Float:
        return (val as number).toFixed(4);
      case PropTypeId.StringPtr:
        return `"${val.value}"`;
      case PropTypeId.Vec2:
        return `(${(val as Vec2).x.toFixed(3)}, ${(val as Vec2).y.toFixed(3)})`;
      case PropTypeId.Vec3:
        return `(${(val as Vec3).x.toFixed(3)}, ${(val as Vec3).y.toFixed(3)}, ${(val as Vec3).z.toFixed(3)})`;
      case PropTypeId.BinaryData:
        return `(${(val as Uint8Array).length} bytes)`;
      case PropTypeId.InputSignal:
        return `0x${val.unk0.toString(16)}`;
      case PropTypeId.FFTerminatedIntList:
        return val.toString();
      case PropTypeId.Box: {
        const b = val as Box;
        return `(${b.minX.toFixed(1)},${b.minY.toFixed(1)},${b.minZ.toFixed(1)})→(${b.maxX.toFixed(1)},${b.maxY.toFixed(1)},${b.maxZ.toFixed(1)})`;
      }
      case PropTypeId.RotRect: {
        const r = val as RotRect;
        return `(${r.x1.toFixed(1)},${r.y1.toFixed(1)})→(${r.x2.toFixed(1)},${r.y2.toFixed(1)}) w=${r.width.toFixed(1)}`;
      }
      case PropTypeId.InSignalPtr:
        return val.unk0 ? `[${(val.unk0 as number[]).join(", ")}]` : "null";
      case PropTypeId.MaterialPtr:
        return (val as MaterialPtr).material?.name || "(unnamed)";
      case PropTypeId.Angle:
        return `${(val as number).toFixed(4)} rad`;
      case PropTypeId.VariableName:
        return `unk0=0x${val.unk0.toString(16)}`; 
      case PropTypeId.OutSignalPtrList:
        return (val as OutSignal).propertyName;
      default:
        return "(complex)";
    }
  }

  static parse(ctx: Context): ObjectProperty {
    const name = ctx.readPointerToObject(parseString);
    const typeId = ctx.readUint32() as PropTypeId;
    const valueCount = ctx.readUint32();

    let value: any;
    if (valueCount === 0) {
      if (typeId === PropTypeId.OutSignalPtrList) {
        // OutSignalPtrList is a null-terminated pointer list; the pointer always exists even
        // when the list is logically empty (valueCount 0), so we must still read it.
        value = ctx.readPointerToObject(parseOutSignalPtrList);
      } else {
        value = [];
      }
    } else {
      const typeInfo = objectPropertyTypeIds[typeId];
      if (typeInfo) {
        if (valueCount === 1) {
          value = ctx.readPointerToObject(typeInfo.parse);
        } else {
          const sizeInBytes = typeInfo.SIZE_IN_BYTES;
          if (sizeInBytes === undefined || sizeInBytes <= 0) {
            throw new Error(`Type ${typeId} does not support arrays`);
          }
          value = ctx.readPtrToArray(valueCount, typeInfo.parse, sizeInBytes);
        }
      } else {
        throw new Error(`Unknown object property type: ${typeId}`);
      }
    }
    return new ObjectProperty(name, typeId, valueCount, value);
  }
}

// AnimatedProperty classes
export class AnimatedPropertyList {
  public properties: AnimatedProperty[] = [];
  public totalSizeInBytes: number = 0;

  static parse(
    ctx: Context,
    parseArgs?: { object: LocoObject },
  ): AnimatedPropertyList {
    const result = new AnimatedPropertyList();
    const start = ctx.stream.tell();
    const numProperties = ctx.readUint32();
    result.properties = [];
    for (let i = 0; i < numProperties; i++) {
      const prop = AnimatedProperty.parse(ctx, { object: parseArgs!.object });
      result.properties.push(prop);
    }
    result.totalSizeInBytes = ctx.stream.tell() - start;
    return result;
  }
}

export class AnimatedProperty {
  public propertyIndex: number = 0;
  public data: AnimationTrack | null = null;
  public propertyName: string = "";

  static parse(
    ctx: Context,
    parseArgs?: { object: LocoObject },
  ): AnimatedProperty {
    const result = new AnimatedProperty();
    const propertyIndex = ctx.readUint32();
    const object = parseArgs!.object;
    const prop = object.properties[propertyIndex];
    result.propertyIndex = propertyIndex;
    result.propertyName = prop.name;
    const trackType = objectPropertyAnimatorsTypeIds[prop.typeId];
    if (trackType) {
      result.data = ctx.readPointerToObject(trackType);
    }
    return result;
  }
}

export class AnimationPart {
  public startTime: number = 0;
  public endTime: number = 0;
  public elementDuration: number = 0;
  public ptrPropertyTracks: number = 0;
  public fileAnimationTracks: AnimationTrackFilePtr[] = [];
  public colorAnimationTracks: AnimationTrackMaterialColorPtr[] = [];

  private rootObject: LocoObject | null = null;
  public objectToAnimatedProperties: Map<LocoObject, AnimatedPropertyList> =
    new Map();

  static parse(ctx: Context): AnimationPart {
    const result = new AnimationPart();
    result.startTime = ctx.readFloat32();
    result.endTime = ctx.readFloat32();
    result.elementDuration = ctx.readFloat32();
    result.ptrPropertyTracks = ctx.readPointer();
    result.fileAnimationTracks = ctx.readSizeThenArray(
      AnimationTrackFilePtr.parse,
      AnimationTrackFilePtr.SIZE_IN_BYTES,
    );
    result.colorAnimationTracks = ctx.readSizeThenArray(
      AnimationTrackMaterialColorPtr.parse,
      AnimationTrackMaterialColorPtr.SIZE_IN_BYTES,
    );
    return result;
  }

  decodeTracks(ctx: Context, rootObject: LocoObject): void {
    if (this.rootObject !== null) {
      if (this.rootObject !== rootObject) {
        // This never happens on any of the Locoroco maps.
        throw new Error("AnimationPart used to decode two different objects.");
      }
      return;
    }

    this.rootObject = rootObject;
    this.objectToAnimatedProperties = new Map();
    if (this.ptrPropertyTracks === 0) {
      return;
    }

    const ptrTracksPerObjectLimit =
      this.ptrPropertyTracks +
      ctx.calculateDistToStartOfNextObject(this.ptrPropertyTracks);

    const dfs = (currentPtr: number, o: LocoObject): number => {
      const propertyList = ctx.readObjectAt(
        currentPtr,
        AnimatedPropertyList.parse,
        { object: o },
      );
      this.objectToAnimatedProperties.set(o, propertyList);
      currentPtr += propertyList.totalSizeInBytes;
      if (currentPtr > ptrTracksPerObjectLimit) {
        throw new Error("Read off the end of the animation.");
      }

      for (const c of o.children) {
        if ((c.object!.bitfield & 1) === 0) {
          currentPtr = dfs(currentPtr, c.object!);
        }
      }
      return currentPtr;
    };

    dfs(this.ptrPropertyTracks, rootObject);
  }

  public collectTracks(): AnimationTrack[] {
    const tracks: AnimationTrack[] = [];
    this.objectToAnimatedProperties.forEach((propList) => {
      for (const prop of propList.properties) {
        if (prop.data) tracks.push(prop.data);
      }
    });
    for (const ftp of this.fileAnimationTracks) {
      if (ftp.track) tracks.push(ftp.track);
    }
    for (const ctp of this.colorAnimationTracks) {
      if (ctp.track) tracks.push(ctp.track);
    }
    return tracks;
  }
}

export class AnimationNamedPart {
  constructor(
    readonly name: string,
    readonly part: AnimationPart,
  ) {}

  static parse(ctx: Context): AnimationNamedPart {
    const name = ctx.readPointerToObject(parseString);
    const part = AnimationPart.parse(ctx);
    return new AnimationNamedPart(name, part);
  }

  decodeTracks(ctx: Context, rootObject: LocoObject): void {
    this.part.decodeTracks(ctx, rootObject);
  }
}

export class Animation {
  constructor(
    public namedPart: AnimationNamedPart,
    public unk10: AnimationUnk10 | null,
  ) {}

  static parse(ctx: Context): Animation {
    const namedPart = AnimationNamedPart.parse(ctx);
    const unk9Ptr = ctx.readPointer();
    if (unk9Ptr !== 0) throw new Error("unk9 should be null");
    const unk10 = ctx.readPointerToObjectMaybeNull(AnimationUnk10.parse);
    return new Animation(namedPart, unk10);
  }
}

export class AnimationPtr {
  public static readonly SIZE_IN_BYTES = 4;
  public animation: Animation | null = null;

  static parse(ctx: Context): AnimationPtr {
    const result = new AnimationPtr();
    result.animation = ctx.readPointerToObjectMaybeNull(Animation.parse);
    return result;
  }
}

export class AnimationList {
  public animations: AnimationPtr[] = [];

  static parse(ctx: Context): AnimationList {
    const result = new AnimationList();
    result.animations = ctx.readSizeThenArray(
      AnimationPtr.parse,
      AnimationPtr.SIZE_IN_BYTES,
    );
    return result;
  }
}

// LocoObject helper classes
export class LocoObject5 {
  public values: number[] = [];

  static parse(ctx: Context): LocoObject5 {
    const result = new LocoObject5();
    result.values = [];
    for (let i = 0; i < 12; i++) {
      result.values.push(ctx.readFloat32());
    }
    return result;
  }
}

export class LocoObject10 {
  public unk0: number = 0;

  static parse(ctx: Context): LocoObject10 {
    const result = new LocoObject10();
    result.unk0 = ctx.readUint32();
    return result;
  }
}

export class ObjectPtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly object: LocoObject) {}

  static parse(ctx: Context): ObjectPtr {
    const object = ctx.readPointerToObject(LocoObject.parse);
    return new ObjectPtr(object);
  }
}

export class LocoObject {
  constructor(
    public objectType: string,
    public name: string,

    // Either -1 or -65533 (for specific object types)
    public unk3: number,

    // Some kind of bitfield:
    //   bitfield & 2 == 0: Properties ignored?
    //   bitfield & 1 == 0: Inherit animation from parent?
    public bitfield: number,
    public unk5: LocoObject5 | null,

    // All objects of the same type have the same handler hash.
    // Some different types share the same value.
    public objectTypeHandlerHash: number,

    // List of all property indexes for Mesh or SubRoot properties (for speed-up)
    public properties: ObjectProperty[] = [],
    public allMeshProperties: number[] = [],
    public children: ObjectPtr[] = [],
    public animation: AnimationNamedPart | null = null,
  ) {}

  static parse(ctx: Context): LocoObject {
    const objectType = ctx.readPointerToObject(parseString);
    const name = ctx.readPointerToObject(parseString);
    const unk3 = ctx.readInt32();

    if (objectType === "objectBundle") {
      assertEqual(unk3, 65534);
    } else {
      if (unk3 !== -65533) {
        assertEqual(unk3, -1);
      }
    }

    const bitfield = ctx.readUint32();
    const unk5 = ctx.readPointerToObjectMaybeNull(LocoObject5.parse);
    const objectTypeHandlerHash = ctx.readUint32();

    const result = new LocoObject(
      objectType,
      name,
      unk3,
      bitfield,
      unk5,
      objectTypeHandlerHash,
    );
    ctx.recordSelfReferentialObject(result);

    result.properties = ctx.readSizeThenArray(ObjectProperty.parse, 16);
    result.allMeshProperties = ctx.readSizeThenArray(parseInt32, 4);
    result.children = ctx.readSizeThenArray(ObjectPtr.parse, 4);
    result.animation = ctx.readPointerToObjectMaybeNull(
      AnimationNamedPart.parse,
    );

    if (result.animation !== null) {
      result.animation.decodeTracks(ctx, result);
    }

    for (const prop of result.properties)
      result.propertyMap.set(prop.name, prop.value);

    return result;
  }

  private propertyMap = new Map<string, any>();

  public getProperty(name: string): any {
    return this.propertyMap.get(name) ?? null;
  }
}

export class Signal {
  public static readonly SIZE_IN_BYTES = 20;
  constructor(
    readonly signalName1: string,
    readonly signalName2: string,
    readonly unk2: number,
    readonly object: LocoObject,
  ) {}

  static parse(ctx: Context): Signal {
    const signalName1 = ctx.readPointerToObject(parseString);
    const signalName2 = ctx.readPointerToObject(parseString);
    const unk2 = ctx.readUint32();
    ctx.readUint32Constant(0);
    const object = ctx.readPointerToObject(LocoObject.parse);
    return new Signal(signalName1, signalName2, unk2, object);
  }
}

export class SignalList {
  constructor(readonly signals: Signal[]) {}

  static parse(ctx: Context): SignalList {
    const signals = ctx.readSizeThenArray(Signal.parse, Signal.SIZE_IN_BYTES);
    return new SignalList(signals);
  }
}

export class LevelGrid {
  public box0: [number, number, number, number] = [0, 0, 0, 0];
  public minZ: number = 0;
  public maxZ: number = 0;
  public width: number = 0;
  public height: number = 0;
  public gridCellSize: number = 0;
  public meshGrid: MeshPtr[] = [];
  public box1: [number, number, number, number] = [0, 0, 0, 0];

  static parse(ctx: Context): LevelGrid {
    const result = new LevelGrid();
    result.box0 = [
      ctx.readFloat32(),
      ctx.readFloat32(),
      ctx.readFloat32(),
      ctx.readFloat32(),
    ];
    result.minZ = ctx.readFloat32();
    result.maxZ = ctx.readFloat32();
    result.width = ctx.readUint32();
    result.height = ctx.readUint32();
    result.gridCellSize = ctx.readFloat32();
    if (result.gridCellSize !== 400.0)
      throw new Error("Unexpected grid cell size");
    result.meshGrid = ctx.readPtrToArray(
      result.width * result.height,
      MeshPtr.parse,
      4,
    );
    result.box1 = [
      ctx.readFloat32(),
      ctx.readFloat32(),
      ctx.readFloat32(),
      ctx.readFloat32(),
    ];
    return result;
  }
}

export class LocalizedBufferVariant {
  public static readonly SIZE_IN_BYTES = 8;
  constructor(
    readonly languageCode: string,
    readonly buffer: Buffer,
  ) {}

  static parse(ctx: Context): LocalizedBufferVariant {
    const languageCodeRaw = ctx.readBytes(4);
    if (languageCodeRaw[2] !== 0 || languageCodeRaw[3] !== 0) {
      throw new Error("Language code padding not zero");
    }
    const languageCode =
      String.fromCharCode(languageCodeRaw[1]) +
      String.fromCharCode(languageCodeRaw[0]);
    const buffer = ctx.readPointerToObject(Buffer.parse);
    return new LocalizedBufferVariant(languageCode, buffer);
  }
}

export class FilePtr {
  public static readonly SIZE_IN_BYTES = 4;
  constructor(readonly file: File) {}

  static parse(ctx: Context): FilePtr {
    const file = ctx.readPointerToObject(File.parse);
    return new FilePtr(file);
  }
}

export class LocalizedBuffer {
  public static readonly SIZE_IN_BYTES = 12;

  constructor(
    public buffer: Buffer,
    public localizedBufferVariants: LocalizedBufferVariant[],
  ) {}

  static parse(ctx: Context): LocalizedBuffer {
    const buffer = ctx.readPointerToObject(Buffer.parse);
    const localizedBufferVariants = ctx.readSizeThenArray(
      LocalizedBufferVariant.parse,
      LocalizedBufferVariant.SIZE_IN_BYTES,
    );
    return new LocalizedBuffer(buffer, localizedBufferVariants);
  }
}

export class SubRoot {
  constructor(
    public object: LocoObject | null,
    public animations: AnimationList | null,
    public signalList: SignalList | null,
    public materials: MaterialPtr[],
    public files: FilePtr[],
    public buffers: BufferPtr[],
    public localizedBuffers: LocalizedBuffer[],
  ) {}

  static parse(ctx: Context): SubRoot {
    // Same header as RootObject below. Not sure why.
    ctx.readUint32Constant(34);
    ctx.readUint32Constant(2);

    const object = ctx.readPointerToObjectMaybeNull(LocoObject.parse);
    if (object !== null) {
      if (object.objectType !== "objectBundle") {
        throw new Error(`Expected objectBundle, got ${object.objectType}`);
      }
    }

    const animations = ctx.readPointerToObjectMaybeNull(AnimationList.parse);

    if (animations && object) {
      for (const a of animations.animations) {
        if (a.animation !== null) {
          a.animation.namedPart.decodeTracks(ctx, object);
        }
      }
    }

    const materials = ctx.readSizeThenArray(
      MaterialPtr.parse,
      MaterialPtr.SIZE_IN_BYTES,
    );
    const files = ctx.readSizeThenArray(FilePtr.parse, FilePtr.SIZE_IN_BYTES);
    const buffers = ctx.readSizeThenArray(
      BufferPtr.parse,
      BufferPtr.SIZE_IN_BYTES,
    );
    const localizedBuffers = ctx.readSizeThenArray(
      LocalizedBuffer.parse,
      LocalizedBuffer.SIZE_IN_BYTES,
    );
    const signalList = ctx.readPointerToObjectMaybeNull(SignalList.parse);
    return new SubRoot(
      object,
      animations,
      signalList,
      materials,
      files,
      buffers,
      localizedBuffers,
    );
  }
}

// Object property type IDs mapping - maps to parse functions and their SIZE_IN_BYTES
const objectPropertyTypeIds: Record<
  PropTypeId,
  { parse: ParseFn<any>; SIZE_IN_BYTES?: number }
> = {
  [PropTypeId.Bool]: { parse: parseBool, SIZE_IN_BYTES: 4 },
  [PropTypeId.Int]: { parse: parseInt32, SIZE_IN_BYTES: 4 },
  [PropTypeId.Float]: { parse: parseFloat32, SIZE_IN_BYTES: 4 },
  [PropTypeId.StringPtr]: {
    parse: StringPtr.parse,
    SIZE_IN_BYTES: StringPtr.SIZE_IN_BYTES,
  },
  [PropTypeId.Vec2]: { parse: Vec2.parse, SIZE_IN_BYTES: Vec2.SIZE_IN_BYTES },
  [PropTypeId.Vec3]: { parse: Vec3.parse, SIZE_IN_BYTES: Vec3.SIZE_IN_BYTES },
  [PropTypeId.BinaryData]: { parse: parsePropBinaryData },
  [PropTypeId.Tabtable]: { parse: PropTabtable.parse },
  [PropTypeId.SubRoot]: { parse: SubRoot.parse },
  [PropTypeId.InputSignal]: {
    parse: InputSignalId.parse,
    SIZE_IN_BYTES: InputSignalId.SIZE_IN_BYTES,
  },
  [PropTypeId.FFTerminatedIntList]: { parse: parsePropFFTerminatedIntList },
  [PropTypeId.Polygon]: {
    parse: Polygon.parse,
    SIZE_IN_BYTES: Polygon.SIZE_IN_BYTES,
  },
  [PropTypeId.Mesh]: { parse: Mesh.parse },
  [PropTypeId.Box]: { parse: Box.parse, SIZE_IN_BYTES: Box.SIZE_IN_BYTES },
  [PropTypeId.RotRect]: {
    parse: RotRect.parse,
    SIZE_IN_BYTES: RotRect.SIZE_IN_BYTES,
  },
  [PropTypeId.InSignalPtr]: {
    parse: InSignalPtr.parse,
    SIZE_IN_BYTES: InSignalPtr.SIZE_IN_BYTES,
  },
  [PropTypeId.OutSignalPtrList]: { parse: parseOutSignalPtrList },
  [PropTypeId.Spring]: {
    parse: PropSpring.parse,
    SIZE_IN_BYTES: PropSpring.SIZE_IN_BYTES,
  },
  [PropTypeId.MaterialPtr]: {
    parse: MaterialPtr.parse,
    SIZE_IN_BYTES: MaterialPtr.SIZE_IN_BYTES,
  },
  [PropTypeId.Vertex]: {
    parse: PropVertex.parse,
    SIZE_IN_BYTES: PropVertex.SIZE_IN_BYTES,
  },
  [PropTypeId.Angle]: { parse: parseFloat32, SIZE_IN_BYTES: 4 },
  [PropTypeId.VariableName]: {
    parse: VariableName.parse,
    SIZE_IN_BYTES: VariableName.SIZE_IN_BYTES,
  },
  [PropTypeId.CollisionMesh47]: { parse: PropCollisionMesh47.parse },
  [PropTypeId.CollisionMesh48]: { parse: PropCollisionMesh48.parse },
};

const objectPropertyAnimatorsTypeIds: Partial<
  Record<PropTypeId, ParseFn<AnimationTrack> | null>
> = {
  [PropTypeId.Bool]: AnimationTrackBool.parse,
  [PropTypeId.Int]: null,
  [PropTypeId.Float]: AnimationTrackFloat.parse,
  [PropTypeId.Vec3]: AnimationTrackVec3.parse,
  [PropTypeId.Angle]: AnimationTrackAngle.parse,
};

export class RootObject {
  constructor(
    public subRoot: SubRoot,
    public collision: Polygon | null,
    public levelGrid: LevelGrid | null,
  ) {}

  static parse(ctx: Context): RootObject {
    // Same header as SubRoot above. Not sure why.
    ctx.readUint32Constant(34);
    ctx.readUint32Constant(1);
    const subRoot = ctx.readPointerToObject(SubRoot.parse);
    const collision = ctx.readPointerToObjectMaybeNull(Polygon.parse);
    const levelGrid = ctx.readPointerToObjectMaybeNull(LevelGrid.parse);
    return new RootObject(subRoot, collision, levelGrid);
  }
}

// BLV Header
export interface BlvHeader {
  segment0DummyPointer: number;
  endOfSegmentList: number;
  rootObject: number;
  allPointers: number;
}

function readBlvHeader(stream: BinaryStream): BlvHeader {
  const segment0DummyPointer = stream.readUint32();
  const endOfSegmentList = stream.readUint32();
  const rootObject = decodeCompressedPointer(stream.readUint32());
  const allPointers = decodeCompressedPointer(stream.readUint32());
  return { segment0DummyPointer, endOfSegmentList, rootObject, allPointers };
}

// BlvFile result
export interface BlvFile {
  root: RootObject | SubRoot;
}

// Main parsing function
export function readBlvStream(
  gameVersion: GameVersion,
  stream: BinaryStream,
): BlvFile {
  const rootObjectPointerAddr = 8;
  const blvHeader = readBlvHeader(stream);

  // Validate all pointer values are as expected.
  stream.seek(blvHeader.allPointers);
  const offsetsOfAllPointers = new Set<number>([rootObjectPointerAddr]);
  const offsetsOfAllObjects = new Set<number>([blvHeader.rootObject]);

  while (true) {
    // Load pointer to pointer.
    const pointer = decodeCompressedPointer(stream.readUint32());
    if (pointer === 0) break;
    offsetsOfAllPointers.add(pointer);

    // Validate the actual pointer value
    const curPos = stream.tell();
    stream.seek(pointer);
    const rawPointerValue = stream.readUint32();
    const pointerDecompressed = decodeCompressedPointer(rawPointerValue);
    offsetsOfAllObjects.add(pointerDecompressed);
    stream.seek(curPos);
  }

  // Read level type to determine root type
  stream.seek(blvHeader.rootObject);
  assertEqual(stream.readUint32(), 34);
  const levelType = stream.readUint32();

  const offsetOfEndOfData = blvHeader.allPointers;
  const ctx = new Context(
    gameVersion,
    stream,
    offsetsOfAllPointers,
    offsetsOfAllObjects,
    offsetOfEndOfData,
  );

  stream.seek(rootObjectPointerAddr);

  let root: RootObject | SubRoot;
  if (levelType === 1) {
    root = ctx.readPointerToObject(RootObject.parse);
  } else if (levelType === 2) {
    root = ctx.readPointerToObject(SubRoot.parse);
  } else {
    throw new Error(`Unknown level type: ${levelType}`);
  }

  return { root };
}

export function readBlvBuffer(
  gameVersion: GameVersion,
  buffer: ArrayBuffer,
): BlvFile {
  return readBlvStream(gameVersion, new BinaryStream(buffer));
}
