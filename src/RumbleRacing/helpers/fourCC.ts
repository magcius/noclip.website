import ArrayBufferSlice from "../../ArrayBufferSlice";

export function readFourCC(data: ArrayBufferSlice, offset: number): string {
  const view = data.createDataView();
  return String.fromCharCode(
    view.getUint8(offset + 3),
    view.getUint8(offset + 2),
    view.getUint8(offset + 1),
    view.getUint8(offset + 0),
  );
}
