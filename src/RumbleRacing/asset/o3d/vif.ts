import { VifUnpackFormat, VifCmd } from "../../../Common/PS2/VIF";

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
  type: VifUnpackFormat;
  v4_32: V4_32Entry[];
  v3_32: V3_32Entry[];
  v2_32: V2_32Entry[];
  v4_8: V4_8Entry[];
}

export interface VifCommand {
  kind: VifCmd;
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
  unpackFormat: VifUnpackFormat;
  addTopsToAddress: boolean;
  performUnpackWriteMasking: boolean;
}

function getUnpackInfo(command: number, immediate: number): UnpackInfo {
  const unpackFormat = command & VifCmd.UNPACK_PARAM;

  return {
    address: (immediate & 0x03ff) * 16,
    unpackFormat,
    addTopsToAddress: ((immediate >> 15) & 0x1) === 1,
    performUnpackWriteMasking: (command & 0x10) !== 0,
  };
}

export function parseVif(payload: Uint8Array): VifCommand[] {
  if (payload.length < 8)
    throw new Error("ELDA payload too small for VIF data");
  const data = payload.slice(8);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
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

    const cmd: VifCommand = {
      kind: VifCmd.NOP,
      opcode: command,
      num,
      immediate,
    };

    switch (command as VifCmd) {
      case VifCmd.NOP:
        break;

      case VifCmd.STCYCL:
        cmd.kind = VifCmd.STCYCL;
        cmd.cycle = immediate;
        break;

      case VifCmd.FLUSHE:
        cmd.kind = VifCmd.FLUSHE;
        break;

      case VifCmd.MSCNT:
        cmd.kind = VifCmd.MSCNT;
        break;

      case VifCmd.STMASK:
        cmd.kind = VifCmd.STMASK;
        if (idx + 4 > dataLen) throw new Error("unexpected EOF reading MASK");
        cmd.mask = view.getUint32(idx, true);
        idx += 4;
        break;

      case VifCmd.STROW:
        cmd.kind = VifCmd.STROW;
        if (idx + 16 > dataLen) throw new Error("unexpected EOF reading STROW");
        cmd.strow = [
          view.getUint32(idx, true),
          view.getUint32(idx + 4, true),
          view.getUint32(idx + 8, true),
          view.getUint32(idx + 12, true),
        ];
        idx += 16;
        break;

      case VifCmd.DIRECT: {
        cmd.kind = VifCmd.DIRECT;
        if (immediate === 0)
          throw new Error("DIRECT immediate=0 is not implemented");
        const quadCount = immediate;
        const neededBytes = quadCount * 16;
        if (idx + neededBytes > dataLen)
          throw new Error("unexpected EOF reading DIRECT");
        const quads: Uint8Array[] = [];
        for (let i = 0; i < quadCount; i++) {
          quads.push(data.slice(idx, idx + 16));
          idx += 16;
        }
        cmd.direct = quads;
        break;
      }

      default:
        if ((command & VifCmd.UNPACK_MASK) === VifCmd.UNPACK_MASK) {
          cmd.kind = VifCmd.UNPACK_MASK;
          const info = getUnpackInfo(command, immediate);
          const count = num;
          const unpack: UnpackData = {
            type: info.unpackFormat,
            v4_32: [],
            v3_32: [],
            v2_32: [],
            v4_8: [],
          };

          switch (info.unpackFormat) {
            case VifUnpackFormat.V4_32: {
              const needed = count * 16;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V4_32");
              for (let i = 0; i < count; i++) {
                const entryOffset = idx;
                unpack.v4_32.push({
                  v1: view.getUint32(idx, true),
                  v2: view.getUint32(idx + 4, true),
                  v3: view.getUint32(idx + 8, true),
                  v4: view.getUint32(idx + 12, true),
                  offset: entryOffset,
                });
                idx += 16;
              }
              break;
            }
            case VifUnpackFormat.V3_32: {
              const needed = count * 12;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V3_32");
              for (let i = 0; i < count; i++) {
                const v1 = view.getFloat32(idx, true);
                const v2 = view.getFloat32(idx + 4, true);
                const v3 = view.getFloat32(idx + 8, true);
                const raw3 = view.getUint32(idx + 8, true);
                idx += 12;
                unpack.v3_32.push({
                  v1,
                  v2,
                  v3,
                  adcBitSet: (raw3 & 0b1) === 0b1,
                });
              }
              break;
            }
            case VifUnpackFormat.V2_32: {
              const needed = count * 8;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V2_32");
              for (let i = 0; i < count; i++) {
                const v1 = view.getFloat32(idx, true);
                const v2 = view.getFloat32(idx + 4, true);
                idx += 8;
                unpack.v2_32.push({ v1, v2 });
              }
              break;
            }
            case VifUnpackFormat.V4_8: {
              const needed = count * 4;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V4_8");
              for (let i = 0; i < count; i++) {
                const b0 = data[idx],
                  b1 = data[idx + 1],
                  b2 = data[idx + 2],
                  b3 = data[idx + 3];
                idx += 4;
                unpack.v4_8.push({
                  v1: b0,
                  v2: b1,
                  v3: b2,
                  v4: b3,
                  adcBitSet: (b2 & 0b1) === 0b1,
                });
              }
              break;
            }
          }

          cmd.unpack = unpack;
        } else {
          throw new Error(
            `unhandled VIF command 0x${command.toString(16).padStart(2, "0")} at offset ${idx - 4}`,
          );
        }
    }

    commands.push(cmd);
  }

  return commands;
}
