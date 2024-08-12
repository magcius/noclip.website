import { WowSheepfileEntry, WowSheepfileManager } from "../../rust/pkg/index.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher.js";
import { rust } from '../rustlib.js';

const SHEEP_PATH = `WorldOfWarcraft/sheep0`;

class FileRequest {
    constructor(public datafileName: string, public start: number, public end: number) {
    }

    public copy(): FileRequest {
        return new FileRequest(this.datafileName, this.start, this.end);
    }
}

class UserRequest {
    public promise: Promise<ArrayBufferSlice>;
    public resolve: (buffer: ArrayBufferSlice) => void;
    public reject: (reason?: any) => void;

    constructor(public fileRequest: FileRequest) {
        this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    }
}

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
    private userRequest: UserRequest[] = [];
    private updateId: number | null = null;

    constructor(private dataFetcher: DataFetcher) {
        // not sure why these don't hash correctly, hardcode them for now
        this.hardcodedFileIds.set('WORLD\\AZEROTH\\REDRIDGE\\PASSIVEDOODADS\\DOCKPIECES\\REDRIDGEDOCKPLANK02.BLP', 190086);
        this.hardcodedFileIds.set("Environments\\Stars\\HellfireSkyBox.m2", 130525);
    }

    public async load() {
        const sheepfileData = await this.dataFetcher.fetchData(`${SHEEP_PATH}/index.shp`);
        this.sheepfile = rust.WowSheepfileManager.new(sheepfileData.createTypedArray(Uint8Array));
    }

    private async makeRequests() {
        // coalesce individual data file requests
        const userRequest = this.userRequest;
        this.userRequest = [];
        const dataRequest: FileRequest[] = [];
        const origRequest: UserRequest[][] = [];

        userRequest.sort((ua, ub) => {
            const a = ua.fileRequest, b = ub.fileRequest;

            const cmp = a.datafileName.localeCompare(b.datafileName);
            if (cmp !== 0)
                return cmp;

            return a.start - b.start;
        });

        // coalesce into request ranges
        for (let i = 0; i < userRequest.length; i++) {
            const u = userRequest[i], r = u.fileRequest;
            const last = dataRequest[dataRequest.length - 1];

            if (last !== undefined && last.datafileName === r.datafileName && last.end === r.start) {
                // reuse existing range
                last.end = r.end;
                origRequest[origRequest.length - 1].push(u);
            } else {
                // new request
                dataRequest.push(r.copy());
                origRequest.push([u]);
            }
        }

        for (let i = 0; i < dataRequest.length; i++) {
            const r = dataRequest[i];
            const rangeStart = r.start, rangeSize = r.end - r.start;
            this.dataFetcher.fetchData(r.datafileName, { rangeStart, rangeSize }).then((buffer) => {
                const o = origRequest[i];
                for (let j = 0; j < o.length; j++) {
                    const u = o[j], ur = u.fileRequest, start = ur.start - r.start, size = ur.end - ur.start;
                    u.resolve(buffer.subarray(start, size));
                }
            }).catch((reason) => {
                const o = origRequest[i];
                for (let j = 0; j < o.length; j++) {
                    const u = o[j];
                    u.reject(reason);
                }
            });
        }
    }

    private sched(): void {
        if (this.updateId === null)
            this.updateId = requestAnimationFrame(() => this.pump());
    }

    private pump(): void {
        if (this.userRequest.length !== 0)
            this.makeRequests();

        this.updateId = null;
        this.sched();
    }

    public async fetchDataRange(datafileName: string, start: number, size: number): Promise<ArrayBufferSlice> {
        const path = `${SHEEP_PATH}/${datafileName}`;
        const userRequest = new UserRequest(new FileRequest(path, start, start + size));
        this.userRequest.push(userRequest);
        this.sched();
        return userRequest.promise;
    }

    private async loadEntry(entry: WowSheepfileEntry): Promise<Uint8Array> {
        let data = await this.fetchDataRange(entry.datafile_name, entry.start_bytes, entry.size_bytes);
        entry.free();
        return data.createTypedArray(Uint8Array);
    }

    public async loadFileId(fileId: number): Promise<Uint8Array | undefined> {
        const entry = this.sheepfile.get_file_id(fileId);
        return entry !== undefined ? this.loadEntry(entry) : undefined;
    }

    public getFileDataId(fileName: string): number | undefined {
        const hardcodedResult = this.hardcodedFileIds.get(fileName);
        if (hardcodedResult !== undefined)
            return hardcodedResult;
        const entry = this.sheepfile.get_file_name(fileName);
        if (entry === undefined)
            return undefined;
        return entry.file_id;
    }

    public destroy(): void {
        this.sheepfile.free();
    }
}
