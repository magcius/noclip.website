import type ArrayBufferSlice from "../ArrayBufferSlice";
import { AssetVersion, DataStream, type DataStreamState } from "./common";
import {
  type BAMObject,
  dbgBool,
  dbgFields,
  dbgStr,
  formatDebugInfo,
  getBAMObjectFactory,
  PandaNode,
} from "./nodes";

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

interface UnparsedObject {
  typeName: string;
  data: ArrayBufferSlice;
}

export class BAMFile {
  private _objects: Map<number, BAMObject>;
  private _objectData: Map<number, UnparsedObject>;
  private _streamState: DataStreamState;
  private _debug: boolean;

  public header: BAMHeader;

  constructor(data: ArrayBufferSlice, options: BAMFileOptions = {}) {
    this._objects = new Map();
    this._objectData = new Map();
    this._debug = options.debug ?? false;

    const stream = new DataStream(data);
    this._streamState = stream.state;
    this.header = this._readHeader(stream);

    while (stream.remaining() > 0) {
      const datagram = this._readDatagram(stream);
      if (this.header.version.compare(new AssetVersion(6, 21)) >= 0) {
        const objectCode = datagram.readUint8();
        if (
          objectCode === BAMObjectCode.Push ||
          objectCode === BAMObjectCode.Adjunct
        ) {
          this._readObjectHeader(datagram);
        }
      } else {
        this._readObjectHeader(datagram);
      }
    }

    // Read the root object
    const root = this.getObject(1);
    if (root && this._debug) {
      console.log(
        `${root.constructor.name} #1 ${formatDebugInfo(root.getDebugInfo(), 0)}`,
      );
    }

    // Check if any objects remain unprocessed
    if (this._objectData.size > 0) {
      for (const [objectId, { typeName }] of this._objectData) {
        console.warn(`${typeName} #${objectId} was not processed`);
      }
      this._objectData.clear();
    }
  }

  getRoot(): PandaNode {
    const root = this.getTyped(1, PandaNode);
    if (!root) throw new Error("Root node not found");
    return root;
  }

  /** Find a node by name in the BAM file (searches entire subtree) */
  find(query: string): PandaNode | null {
    const root = this.getRoot();
    if (!root) return null;
    return root.find(query);
  }

  getObject(objectId: number): BAMObject | null {
    if (objectId === 0) return null;
    const obj = this._objects.get(objectId);
    if (obj) return obj;
    return this._readObject(objectId);
  }

  getTyped<T extends BAMObject>(
    objectId: number,
    clazz: new (...args: any[]) => T,
  ): T | null {
    if (objectId === 0) return null;
    const object = this.getObject(objectId);
    if (!object) throw new Error(`Object not found: ${objectId}`);
    if (!(object instanceof clazz)) {
      throw new Error(
        `Expected object of type ${clazz.name}, got ${object.constructor.name}`,
      );
    }
    return object;
  }

  getObjects(): IterableIterator<BAMObject> {
    return this._objects.values();
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

  private _readObjectHeader(data: DataStream) {
    const typeIndex = data.readTypeHandle();
    const objectId = data.readObjectId();
    if (typeIndex === 0) {
      return;
    }
    const typeName = this._streamState.typeRegistry.get(typeIndex);
    if (!typeName) {
      throw new Error(`Unknown type index ${typeIndex}`);
    }
    this._objectData.set(objectId, { typeName, data: data.subarray() });
  }

  private _readObject(objectId: number) {
    const result = this._objectData.get(objectId);
    if (!result) return null;
    const { typeName, data } = result;
    this._objectData.delete(objectId);
    const stream = new DataStream(data);
    stream.state = this._streamState;
    const factory = getBAMObjectFactory(typeName);
    if (!factory) {
      console.warn(`${typeName} #${objectId} (unhandled)`);
      return null;
    }
    const obj = new factory();
    // Add before loading to handle circular references
    this._objects.set(objectId, obj);
    obj.load(this, stream);
    if (stream.remaining() > 0) {
      console.warn(
        `${typeName} #${objectId} Unexpected data remaining: ${stream.remaining()}`,
      );
    }
    return obj;
  }
}
