import { readUint32LE, readUint16LE, uint32ToFloat32 } from "../../helpers/bytes";

export type VifCommandKind = "NOP" | "DIRECT" | "STROW" | "MASK" | "MSCNT" | "FLUSHE" | "CYCLE" | "UNPACK";
export type UnpackType = "V2_32" | "V3_32" | "V4_32" | "V4_8" | "UNSUPPORTED";
export type UnpackExtendType = "ZERO" | "SIGNED";

export interface V4_32Entry {
  v1: number;
  v2: number;
  v3: number;
  v4: number;
  offset: number;
}

export interface V3_32Entry {
  adcBitSet: boolean;
  v1: number;
  v2: number;
  v3: number;
}

export interface V2_32Entry {
  v1: number;
  v2: number;
}

export interface V4_8Entry {
  v1: number;
  v2: number;
  v3: number;
  v4: number;
  adcBitSet: boolean;
}

export interface UnpackData {
  type: UnpackType;
  v4_32: V4_32Entry[];
  v3_32: V3_32Entry[];
  v2_32: V2_32Entry[];
  v4_8: V4_8Entry[];
}

export interface VifCommand {
  kind: VifCommandKind;
  opcode: number;
  num: number;
  immediate: number;
  cycle?: number;
  mask?: number;
  strow?: [number, number, number, number];
  direct?: Uint8Array[];
  unpack?: UnpackData;
}

interface UnpackInfo {
  address: number;
  extendType: UnpackExtendType;
  unpackType: UnpackType;
  addTopsToAddress: boolean;
  performUnpackWriteMasking: boolean;
}

function getUnpackInfo(command: number, immediate: number): UnpackInfo {
  let unpackType: UnpackType = "UNSUPPORTED";
  switch (command) {
    case 0x64: case 0x74: unpackType = "V2_32"; break;
    case 0x68: case 0x78: unpackType = "V3_32"; break;
    case 0x6c: case 0x7c: unpackType = "V4_32"; break;
    case 0x6e: case 0x7e: unpackType = "V4_8"; break;
  }
  const extendType: UnpackExtendType = ((immediate >> 14) & 0x1) === 1 ? "ZERO" : "SIGNED";
  return {
    address: (immediate & 0x03ff) * 16,
    extendType,
    unpackType,
    addTopsToAddress: ((immediate >> 15) & 0x1) === 1,
    performUnpackWriteMasking: (command & 0x10) !== 0,
  };
}

export function parseVif(payload: Uint8Array): VifCommand[] {
  if (payload.length < 8) throw new Error("ELDA payload too small for VIF data");
  const data = payload.slice(8);
  const commands: VifCommand[] = [];
  let idx = 0;
  const dataLen = data.length;

  while (idx < dataLen) {
    if (idx + 4 > dataLen) break;

    const b = data.slice(idx, idx + 4);
    const command = b[3];
    const num = b[2];
    const immediate = (b[1] << 8) | b[0];
    idx += 4;

    const cmd: VifCommand = { kind: "NOP", opcode: command, num, immediate };

    switch (command) {
      case 0x00:
        cmd.kind = "NOP";
        break;

      case 0x01:
        cmd.kind = "CYCLE";
        cmd.cycle = immediate;
        break;

      case 0x10:
        cmd.kind = "FLUSHE";
        break;

      case 0x17:
        cmd.kind = "MSCNT";
        break;

      case 0x20:
        cmd.kind = "MASK";
        if (idx + 4 > dataLen) throw new Error("unexpected EOF reading MASK");
        cmd.mask = readUint32LE(data, idx);
        idx += 4;
        break;

      case 0x30:
        cmd.kind = "STROW";
        if (idx + 16 > dataLen) throw new Error("unexpected EOF reading STROW");
        cmd.strow = [
          readUint32LE(data, idx),
          readUint32LE(data, idx + 4),
          readUint32LE(data, idx + 8),
          readUint32LE(data, idx + 12),
        ];
        idx += 16;
        break;

      case 0x50: {
        cmd.kind = "DIRECT";
        if (immediate === 0) throw new Error("DIRECT immediate=0 is not implemented");
        const quadCount = immediate;
        const neededBytes = quadCount * 16;
        if (idx + neededBytes > dataLen) throw new Error("unexpected EOF reading DIRECT");
        const quads: Uint8Array[] = [];
        for (let i = 0; i < quadCount; i++) {
          quads.push(data.slice(idx, idx + 16));
          idx += 16;
        }
        cmd.direct = quads;
        break;
      }

      default:
        if (command >= 0x60 && command <= 0x7f) {
          cmd.kind = "UNPACK";
          const info = getUnpackInfo(command, immediate);
          const count = num;
          const unpack: UnpackData = { type: info.unpackType, v4_32: [], v3_32: [], v2_32: [], v4_8: [] };

          switch (info.unpackType) {
            case "V4_32": {
              const needed = count * 16;
              if (idx + needed > dataLen) throw new Error("unexpected EOF reading V4_32");
              for (let i = 0; i < count; i++) {
                const entryOffset = idx;
                unpack.v4_32.push({
                  v1: readUint32LE(data, idx),
                  v2: readUint32LE(data, idx + 4),
                  v3: readUint32LE(data, idx + 8),
                  v4: readUint32LE(data, idx + 12),
                  offset: entryOffset,
                });
                idx += 16;
              }
              break;
            }
            case "V3_32": {
              const needed = count * 12;
              if (idx + needed > dataLen) throw new Error("unexpected EOF reading V3_32");
              for (let i = 0; i < count; i++) {
                const raw1 = readUint32LE(data, idx);
                const raw2 = readUint32LE(data, idx + 4);
                const raw3 = readUint32LE(data, idx + 8);
                idx += 12;
                unpack.v3_32.push({
                  v1: uint32ToFloat32(raw1),
                  v2: uint32ToFloat32(raw2),
                  v3: uint32ToFloat32(raw3),
                  adcBitSet: (raw3 & 0b1) === 0b1,
                });
              }
              break;
            }
            case "V2_32": {
              const needed = count * 8;
              if (idx + needed > dataLen) throw new Error("unexpected EOF reading V2_32");
              for (let i = 0; i < count; i++) {
                const raw1 = readUint32LE(data, idx);
                const raw2 = readUint32LE(data, idx + 4);
                idx += 8;
                unpack.v2_32.push({ v1: uint32ToFloat32(raw1), v2: uint32ToFloat32(raw2) });
              }
              break;
            }
            case "V4_8": {
              const needed = count * 4;
              if (idx + needed > dataLen) throw new Error("unexpected EOF reading V4_8");
              for (let i = 0; i < count; i++) {
                const b0 = data[idx], b1 = data[idx + 1], b2 = data[idx + 2], b3 = data[idx + 3];
                idx += 4;
                unpack.v4_8.push({ v1: b0, v2: b1, v3: b2, v4: b3, adcBitSet: (b2 & 0b1) === 0b1 });
              }
              break;
            }
          }

          cmd.unpack = unpack;
        } else {
          throw new Error(`unhandled VIF command 0x${command.toString(16).padStart(2, "0")} at offset ${idx - 4}`);
        }
    }

    commands.push(cmd);
  }

  return commands;
}
