export interface HEAD {
  size: number;
  allocBytes: number;
  totalTextures: number;
  clheIterations: number;
  zthesCount: number;
  headPointerCount: number;
  ztheFilePointers: number[];
}

export function parseHEAD(buf: Uint8Array): HEAD {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const size = view.getUint32(4, true);
  const alloc = view.getUint16(8, true);
  const totalTextures = view.getUint16(10, true);
  const clheIterations = buf[12];
  const zthesCount = buf[13];
  const headPointerCount = buf[14];

  const pointers = buf.slice(16);
  const pointersView = new DataView(
    pointers.buffer,
    pointers.byteOffset,
    pointers.byteLength,
  );
  const ptrs: number[] = [];
  for (let i = 0; i + 4 <= pointers.length; i += 4) {
    ptrs.push(pointersView.getUint32(i, true));
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
