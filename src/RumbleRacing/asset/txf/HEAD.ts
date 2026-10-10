import ArrayBufferSlice from "../../../ArrayBufferSlice";

export interface HEAD {
  size: number;
  allocBytes: number;
  totalTextures: number;
  clheIterations: number;
  zthesCount: number;
  headPointerCount: number;
  ztheFilePointers: number[];
}

export function parseHEAD(buf: ArrayBufferSlice): HEAD {
  const view = buf.createDataView();
  const size = view.getUint32(4, true);
  const alloc = view.getUint16(8, true);
  const totalTextures = view.getUint16(10, true);
  const clheIterations = view.getUint8(12);
  const zthesCount = view.getUint8(13);
  const headPointerCount = view.getUint8(14);

  const ptrs: number[] = [];
  for (let i = 16; i + 4 <= buf.byteLength; i += 4) {
    ptrs.push(view.getUint32(i, true));
  }

  return {
    size,
    allocBytes: alloc,
    totalTextures,
    clheIterations,
    zthesCount,
    headPointerCount,
    ztheFilePointers: ptrs,
  };
}
