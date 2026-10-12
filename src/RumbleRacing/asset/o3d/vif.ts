import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { VifUnpackFormat, VifCmd } from "../../../Common/PS2/VIF";

export type V4_32Entry = {
  v1: number;
  v2: number;
  v3: number;
  v4: number;
  offset: number;
};

export type V3_32Entry = {
  adcBitSet: boolean;
  v1: number;
  v2: number;
  v3: number;
};

export type V2_32Entry = {
  v1: number;
  v2: number;
};

export type V4_8Entry = {
  v1: number;
  v2: number;
  v3: number;
  v4: number;
  adcBitSet: boolean;
};

export type V4_32 = {
  type: VifUnpackFormat.V4_32;
  data: V4_32Entry[];
};

export type V3_32 = {
  type: VifUnpackFormat.V3_32;
  data: V3_32Entry[];
};

export type V2_32 = {
  type: VifUnpackFormat.V2_32;
  data: V2_32Entry[];
};
export type V4_8 = {
  type: VifUnpackFormat.V4_8;
  data: V4_8Entry[];
};

export type UnpackData = V4_32 | V3_32 | V2_32 | V4_8;

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

export function parseVif(payload: ArrayBufferSlice): UnpackData[] {
  if (payload.byteLength < 8)
    throw new Error("ELDA payload too small for VIF data");
  const data = payload.subarray(8);
  const view = data.createDataView();
  const totalUnpacks: UnpackData[] = [];
  let idx = 0;
  const dataLen = data.byteLength;

  while (idx < dataLen) {
    if (idx + 4 > dataLen) break;

    const command = view.getUint8(idx + 3);
    const num = view.getUint8(idx + 2);
    const immediate = view.getUint16(idx + 0, true);
    idx += 4;

    switch (command as VifCmd) {
      case VifCmd.NOP:
      case VifCmd.STCYCL:
      case VifCmd.FLUSHE:
      case VifCmd.MSCNT:
        break;

      case VifCmd.STMASK:
        idx += 4;
        break;

      case VifCmd.STROW:
        idx += 16;
        break;

      case VifCmd.DIRECT: {
        if (immediate === 0)
          throw new Error("DIRECT immediate=0 is not implemented");
        const quadCount = immediate;
        const neededBytes = quadCount * 16;
        if (idx + neededBytes > dataLen)
          throw new Error("unexpected EOF reading DIRECT");
        for (let i = 0; i < quadCount; i++) {
          idx += 16;
        }
        break;
      }

      default:
        if ((command & VifCmd.UNPACK_MASK) === VifCmd.UNPACK_MASK) {
          const info = getUnpackInfo(command, immediate);
          const count = num;

          switch (info.unpackFormat) {
            case VifUnpackFormat.V4_32: {
              const needed = count * 16;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V4_32");
              const unpack: V4_32 = {
                type: VifUnpackFormat.V4_32,
                data: [],
              };
              for (let i = 0; i < count; i++) {
                const entryOffset = idx;
                unpack.data.push({
                  v1: view.getUint32(idx, true),
                  v2: view.getUint32(idx + 4, true),
                  v3: view.getUint32(idx + 8, true),
                  v4: view.getUint32(idx + 12, true),
                  offset: entryOffset,
                });
                idx += 16;
              }
              totalUnpacks.push(unpack);
              break;
            }
            case VifUnpackFormat.V3_32: {
              const needed = count * 12;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V3_32");
              const unpack: V3_32 = {
                type: VifUnpackFormat.V3_32,
                data: [],
              };
              for (let i = 0; i < count; i++) {
                const v1 = view.getFloat32(idx, true);
                const v2 = view.getFloat32(idx + 4, true);
                const v3 = view.getFloat32(idx + 8, true);
                const raw3 = view.getUint32(idx + 8, true);
                idx += 12;
                unpack.data.push({
                  v1,
                  v2,
                  v3,
                  adcBitSet: (raw3 & 0b1) === 0b1,
                });
              }
              totalUnpacks.push(unpack);
              break;
            }
            case VifUnpackFormat.V2_32: {
              const needed = count * 8;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V2_32");
              const unpack: V2_32 = {
                type: VifUnpackFormat.V2_32,
                data: [],
              };
              for (let i = 0; i < count; i++) {
                const v1 = view.getFloat32(idx, true);
                const v2 = view.getFloat32(idx + 4, true);
                idx += 8;
                unpack.data.push({ v1, v2 });
              }
              totalUnpacks.push(unpack);
              break;
            }
            case VifUnpackFormat.V4_8: {
              const needed = count * 4;
              if (idx + needed > dataLen)
                throw new Error("unexpected EOF reading V4_8");
              const unpack: V4_8 = {
                type: VifUnpackFormat.V4_8,
                data: [],
              };
              for (let i = 0; i < count; i++) {
                const b0 = view.getUint8(idx),
                  b1 = view.getUint8(idx + 1),
                  b2 = view.getUint8(idx + 2),
                  b3 = view.getUint8(idx + 3);
                idx += 4;
                unpack.data.push({
                  v1: b0,
                  v2: b1,
                  v3: b2,
                  v4: b3,
                  adcBitSet: (b2 & 0b1) === 0b1,
                });
              }
              totalUnpacks.push(unpack);
              break;
            }
            default: {
              throw new Error(
                `Unexpected VIF unpack format: ${info.unpackFormat}`,
              );
            }
          }
        } else {
          throw new Error(
            `unhandled VIF command 0x${command.toString(16).padStart(2, "0")} at offset ${idx - 4}`,
          );
        }
    }
  }

  return totalUnpacks;
}
