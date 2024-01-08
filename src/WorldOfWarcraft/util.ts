import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher.js";
import { rust } from '../rustlib.js';
import { WowSheepfileEntry, WowSheepfileManager } from "../../rust/pkg";
import { MapArray } from "./scenes.js";

const SHEEP_PATH = `WorldOfWarcraft/sheep0`;

class Sheepfile {
    private sheepfile: WowSheepfileManager;

    public async load(dataFetcher: DataFetcher) {
      const sheepfileData = await dataFetcher.fetchData(`${SHEEP_PATH}/index.shp`);
      this.sheepfile = rust.WowSheepfileManager.new(sheepfileData.createTypedArray(Uint8Array));
    }

    async fetchDataRange(dataFetcher: DataFetcher, datafileName: string, start: number, size: number): Promise<NamedArrayBufferSlice> {
      return await dataFetcher.fetchData(`${SHEEP_PATH}/${datafileName}`, {
        rangeStart: start,
        rangeSize: size,
      });
    }

    async loadEntry(dataFetcher: DataFetcher, entry: WowSheepfileEntry): Promise<Uint8Array> {
      let data = await this.fetchDataRange(dataFetcher, entry.datafile_name, entry.start_bytes, entry.size_bytes);
      entry.free();
      return data.createTypedArray(Uint8Array);
    }

    public async loadFileId(dataFetcher: DataFetcher, fileId: number): Promise<Uint8Array | undefined> {
      const entry = this.sheepfile.get_file_id(fileId);
      if (entry === undefined) {
        return undefined;
      }
      return this.loadEntry(dataFetcher, entry);
    }

    public async loadFileName(dataFetcher: DataFetcher, fileName: string): Promise<Uint8Array | undefined> {
      const entry = this.sheepfile.get_file_name(fileName);
      if (entry === undefined) {
        return undefined;
      }
      return this.loadEntry(dataFetcher, entry);
    }

    public getFileDataId(fileName: string): number | undefined {
      // FIXME: not sure why this doesn't hash correctly, hardcode it for now
      if (fileName === 'WORLD\\AZEROTH\\REDRIDGE\\PASSIVEDOODADS\\DOCKPIECES\\REDRIDGEDOCKPLANK02.BLP') {
        return 190086;
      }
      const entry = this.sheepfile.get_file_name(fileName);
      if (entry === undefined) {
        return undefined;
      }
      return entry.file_id;
    }
}

let _sheepfile: Sheepfile | undefined = undefined;
export async function initSheepfile(dataFetcher: DataFetcher): Promise<undefined> {
  if (!_sheepfile) {
    _sheepfile = new Sheepfile();
    await _sheepfile.load(dataFetcher);
  }
}

export function getFileDataId(fileName: string): number {
  if (fileName === '') {
    throw new Error(`must provide valid filename`);
  }
  const result = _sheepfile!.getFileDataId(fileName);
  if (result === undefined) {
    throw new Error(`failed to find FileDataId for fileName ${fileName}`);
  } else {
    return result;
  }
}

export type Constructor<T> = (data: Uint8Array) => T;

export async function fetchFileByID<T>(fileId: number, dataFetcher: DataFetcher, constructor: Constructor<T>): Promise<T> {
  const buf = await fetchDataByFileID(fileId, dataFetcher);
  const result = constructor(buf);
  return result;
}

export async function fetchDataByFileID(fileId: number, dataFetcher: DataFetcher): Promise<Uint8Array> {
  // WOTLK extraction is from build 3.4.3.52237
  // Vanilla extraction is from build 1.5.1.53495
  const data = await _sheepfile?.loadFileId(dataFetcher, fileId);
  if (!data) {
    throw new Error(`no data for fileId ${fileId}`)
  }
  return data;
}
