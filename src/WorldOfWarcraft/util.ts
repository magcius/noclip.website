import { WowSheepfileEntry, WowSheepfileManager } from "../../rust/pkg/index.js";
import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher.js";
import { rust } from '../rustlib.js';

const SHEEP_PATH = `WorldOfWarcraft/sheep0`;

/**
 * Sheepfiles are custom packages of native WoW files built by `polymorph`
 * (https://github.com/wgreenberg/polymorph). They're basically just an
 * archive of appended WoW binary files with an index that contains metadata
 * about each file's fileId and name hash (https://wowdev.wiki/TACT#hashpath).
 * Our archive was built from these build/cdn config files:
 *   `wow_classic` - `ac0b091d8852985a2ce03e416fbf1cf1`/`172046dd2cee54d02df17e21b2a2f321` on 4/5/2024
 *   `wow_classic_era` - `c3d0cb83d013aa4e62de4df87021d77a`/`cce2d13c2533262be62f016e8775841a` on 4/5/2024
 * polymorph built the archive first from all files in `wow_classic`, then
 * overlaid any files in `wow_classic_era`, preferring `wow_classic`'s in the
 * case of duplicates. This gives us a kind of hybrid of the WOTLK Classic
 * state of the game plus some unreleased goodies still present in
 * Vanilla.
 * 
 * If at some point we want to ship the state of Eastern Kingdoms/Kalimdor
 * pre-WOTLK, we could make a separate sheepfile just from `wow_classic_era`.
 */
export class Sheepfile {
    private sheepfile: WowSheepfileManager;
    private hardcodedFileIds: Map<string, number> = new Map();

    public async load(dataFetcher: DataFetcher) {
      const sheepfileData = await dataFetcher.fetchData(`${SHEEP_PATH}/index.shp`);
      this.sheepfile = rust.WowSheepfileManager.new(sheepfileData.createTypedArray(Uint8Array));

      // not sure why these don't hash correctly, hardcode them for now
      this.hardcodedFileIds.set('WORLD\\AZEROTH\\REDRIDGE\\PASSIVEDOODADS\\DOCKPIECES\\REDRIDGEDOCKPLANK02.BLP', 190086);
      this.hardcodedFileIds.set("Environments\\Stars\\HellfireSkyBox.m2", 130525);
    }

    async fetchDataRange(dataFetcher: DataFetcher, datafileName: string, start: number, size: number): Promise<NamedArrayBufferSlice> {
      return await dataFetcher.fetchData(`${SHEEP_PATH}/${datafileName}`, {
        rangeStart: start,
        rangeSize: size,
      });
    }

    public async loadEntry(dataFetcher: DataFetcher, entry: WowSheepfileEntry): Promise<Uint8Array> {
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
      const hardcodedResult = this.hardcodedFileIds.get(fileName);
      if (hardcodedResult !== undefined) {
        return hardcodedResult;
      }
      const entry = this.sheepfile.get_file_name(fileName);
      if (entry === undefined) {
        return undefined;
      }
      return entry.file_id;
    }

    public destroy(): void {
      this.sheepfile.free();
    }
}
