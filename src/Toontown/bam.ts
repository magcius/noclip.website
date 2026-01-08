import type ArrayBufferSlice from "../ArrayBufferSlice";
import { AssetVersion, DataStream } from "./common";
import {
  type BAMObject,
  dbgBool,
  dbgStr,
  formatDebugInfo,
  getBAMObjectFactory,
  LegacyGeom,
  dbgFields,
} from "./nodes";
import type { DebugAccessor } from "./nodes/debug";

const BAM_MAGIC = [0x70, 0x62, 0x6a, 0x00, 0x0a, 0x0d]; // pbj\0\n\r

enum BAMObjectCode {
  Push = 0,
  Pop = 1,
  Adjunct = 2,
  Remove = 3,
  FileData = 4,
}

export type BAMHeader = {
  headerSize: number;
  version: AssetVersion;
  littleEndian: boolean;
  useDouble: boolean;
};

export interface BAMFileOptions {
  debug?: boolean;
}

export class BAMFile implements DebugAccessor {
  private _typeRegistry: Map<number, string>;
  private _objects: Map<number, BAMObject>;
  private _objectTypes: Map<number, string>;
  private _debug: boolean;

  public header: BAMHeader;

  constructor(data: ArrayBufferSlice, options: BAMFileOptions = {}) {
    this._typeRegistry = new Map();
    this._objects = new Map();
    this._objectTypes = new Map();
    this._debug = options.debug ?? false;

    // Reset the global PTA cache for legacy BAM files
    LegacyGeom.resetPtaCache();

    const stream = new DataStream(data);
    this.header = this._readHeader(stream);

    let nestingLevel = 0;
    while (stream.remaining() > 0) {
      const datagram = this._readDatagram(stream);
      let bamObject: BAMObject | undefined;
      if (this.header.version.compare(new AssetVersion(6, 21)) >= 0) {
        const objectCode = datagram.readUint8();
        if (
          objectCode === BAMObjectCode.Push ||
          objectCode === BAMObjectCode.Adjunct
        ) {
          bamObject = this._readObject(datagram, nestingLevel);
        }
        if (objectCode === BAMObjectCode.Push) {
          nestingLevel++;
        } else if (objectCode === BAMObjectCode.Pop) {
          nestingLevel--;
        }
      } else {
        bamObject = this._readObject(datagram, nestingLevel);
      }
      if (bamObject) {
        this._objects.set(bamObject.objectId, bamObject);
      }
    }

    if (this._debug) {
      for (const object of this._objects.values()) {
        const debugInfo = object.getDebugInfo();
        console.log(
          `${object.getTypeName()} #${object.objectId} ${formatDebugInfo(debugInfo, nestingLevel, this)}`,
        );
      }
    }
  }

  getObject(objectId: number): BAMObject | undefined {
    return this._objects.get(objectId);
  }

  getObjects(): IterableIterator<BAMObject> {
    return this._objects.values();
  }

  getTypeName(objectId: number): string | undefined {
    return this._objectTypes.get(objectId);
  }

  private _readHeader(data: DataStream): BAMHeader {
    const magic = Array.from(data.readUint8Array(BAM_MAGIC.length));
    if (!magic.every((byte, index) => byte === BAM_MAGIC[index])) {
      throw new Error(`Invalid BAM file magic: ${magic}`);
    }

    const headerSize = data.readUint32();
    const versionMajor = data.readUint16();
    const versionMinor = data.readUint16();
    const version = new AssetVersion(versionMajor, versionMinor);

    let expectedHeaderSize: number;
    if (version.compare(new AssetVersion(5, 0)) < 0) {
      expectedHeaderSize = 4;
    } else if (version.compare(new AssetVersion(6, 27)) < 0) {
      expectedHeaderSize = 5;
    } else {
      expectedHeaderSize = 6;
    }
    if (headerSize !== expectedHeaderSize) {
      throw new Error(
        `Invalid BAM file header size: ${headerSize} (expected ${expectedHeaderSize})`,
      );
    }

    let littleEndian = true;
    if (version.compare(new AssetVersion(5, 0)) >= 0) {
      const endiannessByte = data.readUint8();
      if (endiannessByte === 0) {
        littleEndian = false;
      } else if (endiannessByte !== 1) {
        throw new Error(`Invalid BAM file endianness byte: ${endiannessByte}`);
      }
    }

    let useDouble = false;
    if (version.compare(new AssetVersion(6, 27)) >= 0) {
      const useDoubleByte = data.readUint8();
      if (useDoubleByte === 1) {
        useDouble = true;
      } else if (useDoubleByte !== 0) {
        throw new Error(`Invalid BAM file useDouble byte: ${useDoubleByte}`);
      }
    }

    // Update stream state
    data.state.littleEndian = littleEndian;
    data.state.useDouble = useDouble;

    if (this._debug) {
      const debugInfo = dbgFields([
        ["version", dbgStr(version.toString())],
        ["endianness", dbgStr(littleEndian ? "little" : "big")],
        ["useDouble", dbgBool(useDouble)],
      ]);
      console.log(`BAM header ${formatDebugInfo(debugInfo)}\n`);
    }

    return {
      headerSize,
      version,
      littleEndian,
      useDouble,
    } satisfies BAMHeader;
  }

  private _readDatagram(data: DataStream): DataStream {
    const datagramSize = data.readUint32();
    if (datagramSize === 0xffffffff) {
      throw new Error("64-bit datagram unsupported");
    }
    return data.substream(datagramSize);
  }

  private _readTypeHandle(data: DataStream): number {
    const typeIndex = data.readUint16();
    if (!this._typeRegistry.has(typeIndex)) {
      const name = data.readString();
      this._typeRegistry.set(typeIndex, name);
      const parentCount = data.readUint8();
      for (let i = 0; i < parentCount; i++) {
        this._readTypeHandle(data);
      }
    }
    return typeIndex;
  }

  private _readObject(
    data: DataStream,
    nestingLevel: number,
  ): BAMObject | undefined {
    const typeIndex = this._readTypeHandle(data);
    const objectId = data.readObjectId();
    if (typeIndex === 0) {
      return;
    }
    const typeName = this._typeRegistry.get(typeIndex);
    if (!typeName) {
      throw new Error(`Unknown type index ${typeIndex}`);
    }
    this._objectTypes.set(objectId, typeName);
    const factory = getBAMObjectFactory(typeName);
    if (!factory) {
      const indent = "  ".repeat(nestingLevel);
      console.warn(`${indent}${typeName} #${objectId} (unhandled)`);
      return;
    }
    const obj = new factory(objectId, this, data);

    // if (this._debug) {
    //   const indent = "  ".repeat(nestingLevel);
    //   const debugInfo = obj.getDebugInfo();
    //   console.log(
    //     `${indent}${typeName} #${objectId} ${formatDebugInfo(debugInfo, nestingLevel, this)}`,
    //   );
    // }
    if (data.remaining() > 0) {
      const indent = "  ".repeat(nestingLevel);
      console.warn(
        `${indent}${typeName} #${objectId} Unexpected data remaining: ${data.remaining()}`,
      );
    }

    return obj;
  }
}
