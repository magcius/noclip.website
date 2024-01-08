#!/usr/bin/env tsx

import { DataFetcher } from '../../DataFetcher';
import { align, assert, assertExists, decodeString, fallbackUndefined, hexzero, hexzero0x, readString } from '../../util';
import * as path from 'path';
import { inflateSync } from 'zlib';
import { existsSync, writeFileSync, promises as fs } from 'fs';
import ArrayBufferSlice from '../../ArrayBufferSlice';

const patchServer = `http://us.patch.battle.net:1119`;
const product = `wow_classic`;
const region = `us`;

const cachePath = `../../../data/WorldOfWarcraft/wowtool_cache`;

async function fetchDataFragment(path: string, byteOffset: number, byteLength: number): Promise<ArrayBufferSlice> {
    const fd = await fs.open(path, 'r');
    const b = Buffer.alloc(byteLength);
    await fd.read(b, 0, byteLength, byteOffset);
    await fd.close();
    return new ArrayBufferSlice(b.buffer);
}

async function fetchData(path: string): Promise<ArrayBufferSlice> {
    const b = await fs.readFile(path);
    return new ArrayBufferSlice(b.buffer);
}

class CDNHost {
    constructor(public host: string, public path: string) {}

    public makeURL(key: string, extraPath: string = ''): string {
        return `http://${this.host}/${this.path}${extraPath}/${key.slice(0, 2)}/${key.slice(2, 4)}/${key}`;
    }
}

class CDNCache {
    constructor(public dataFetcher: DataFetcher, public cachePath: string) {}

    public async ensureData(host: CDNHost, directory: string, key: string): string {
        const filePath = path.join(this.cachePath, directory, key);
        if (!existsSync(filePath)) {
            const url = host.makeURL(key, directory);
            const buffer = await this.dataFetcher.fetchURL(url);
            await fs.mkdir(path.join(this.cachePath, directory), { recursive: true });
            await fs.writeFile(filePath, buffer.createTypedArray(Uint8Array));
        }
        return filePath;
    }

    public async fetchData(host: CDNHost, directory: string, key: string) {
        const filePath = await this.ensureData(host, directory, key);
        return fetchData(filePath);
    }

    public async fetchArchivePartial(host: CDNHost, archive: TASCArchiveIndex, file: TASCArchiveFileEntry) {
        const directory = `/data`;

        const archiveFilename = archive.key;
        if (existsSync(archiveFilename))
            return fetchDataFragment(archiveFilename, file.dataOffset, file.dataSize);

        const archiveDirectory = `${archive.key}.cache`;
        const filename = `${file.dataOffset}`;
        const filePath = path.join(this.cachePath, directory, archiveDirectory, filename);
        if (existsSync(filename))
            return fs.readFile(filePath);

        const url = host.makeURL(archive.key, '/data');
        const buffer = await this.dataFetcher.fetchURL(url, { rangeStart: file.dataOffset, rangeSize: file.dataSize });
        await fs.mkdir(path.join(this.cachePath, directory, archiveDirectory), { recursive: true });
        await fs.writeFile(filePath, buffer.createTypedArray(Uint8Array));
        return buffer;
    }
}

class TASCManifest {
    constructor(
        public readonly fields: [string, string][],
        public readonly rows: string[][],
        public readonly sequenceNo: number,
    ) {}

    public static parse(s: string): TASCManifest {
        const lines = s.split('\n');
        assert(lines.pop() === '');
        const fields = lines.shift()!.split('|').map((s => s.split('!'))) as [string, string][];
        const sequenceNo = parseInt(lines.shift()!.match(/## seqn = (\d+)/)![1]);
        const rows = lines.map((s) => s.split('|'));
        return new TASCManifest(fields, rows, sequenceNo);
    }

    public getFieldIndex(fieldName: string): number {
        return this.fields.findIndex((s) => fieldName === s[0]);
    }

    public getField(row: number, fieldName: string): string {
        return this.rows[row][this.getFieldIndex(fieldName)];
    }

    public findRow(fieldName: string, fieldValue: string): number {
        const fieldIndex = this.getFieldIndex(fieldName);
        return this.rows.findIndex((row) => row[fieldIndex] === fieldValue);
    }
}

function parseKeyValues(s: string): { [k: string]: string[] } {
    const ret = {};
    for (const line of s.split('\n')) {
        if (line === '' || line.startsWith('#'))
            continue;

        const [k, v] = line.split(' = ');
        ret[k] = v.split(' ');
    }
    return ret;
}

function decodeBLTE(buffer: ArrayBufferSlice): ArrayBufferSlice | null {
    const view = buffer.createDataView();
    const magic = readString(buffer, 0x00, 0x04);
    assert(magic === 'BLTE');

    let compressedOffs = view.getUint32(0x04);
    if (compressedOffs === 0)
        return null;

    const chunkCount = view.getUint32(0x08) & 0x00FFFFFF;
    let dataSize = 0;
    for (let i = 0; i < chunkCount; i++) {
        // const compressedSize = view.getUint32(0x08 + i * 0x18 + 0x00);
        const uncompressedSize = view.getUint32(0x0C + i * 0x18 + 0x04);
        // Checksum
        dataSize += uncompressedSize;
    }
    const decompressed = new Uint8Array(dataSize);

    let decompressedOffs = 0;
    for (let i = 0; i < chunkCount; i++) {
        const compressedSize = view.getUint32(0x0C + i * 0x18 + 0x00);
        const uncompressedSize = view.getUint32(0x0C + i * 0x18 + 0x04);

        const frameType = view.getUint8(compressedOffs + 0x00);
        if (frameType === 0x4E) { // 'N'
            decompressed.set(buffer.createTypedArray(Uint8Array, compressedOffs + 1, compressedSize - 1), decompressedOffs);
        } else if (frameType === 0x5A) { // 'Z'
            decompressed.set(inflateSync(buffer.createTypedArray(Uint8Array, compressedOffs + 1, compressedSize - 1)), decompressedOffs);
        } else {
            throw "whoops";
        }

        // Checksum
        compressedOffs += compressedSize;
        decompressedOffs += uncompressedSize;
    }

    return new ArrayBufferSlice(decompressed.buffer);
}

function readHexString(view: DataView, offset: number, length = 0x10): string {
    let S = ``;
    for (let i = 0; i < length; i++)
        S += hexzero(view.getUint8(offset + i), 2);
    return S;
}

class TASCEncodingFile {
    public CKeyToEKey = new Map<string, string>();

    public getEKeyForCKey(CKey: string): string {
        return assertExists(this.CKeyToEKey.get(CKey));
    }

    public static parse(buffer: ArrayBufferSlice): TASCEncodingFile {
        buffer = decodeBLTE(buffer)!;
        // writeFileSync(path.join(cachePath, `encoding.out`), Buffer.from(buffer.arrayBuffer));

        const magic = readString(buffer, 0x00, 0x02);
        assert(magic === 'EN');

        const view = buffer.createDataView();
        const version = view.getUint8(0x02);
        const hashSizeCKey = view.getUint8(0x03);
        const hashSizeEKey = view.getUint8(0x04);
        const pageSizeCKey = view.getUint16(0x05) * 1024;
        const pageSizeEKey = view.getUint16(0x07) * 1024;
        const pageCountCKey = view.getUint32(0x09);
        const pageCountEKey = view.getUint32(0x0D);
        assert(view.getUint8(0x11) === 0);

        const especPageSize = view.getUint32(0x12);

        const file = new TASCEncodingFile();

        // Skip past ESpec table and page file index, just read all the data directly
        // TODO(jstpierre): This could be much faster if you use the archive file

        const pageStartCKey = 0x16 + especPageSize + pageCountCKey * (hashSizeCKey + 0x10);
        for (let i = 0; i < pageCountCKey; i++) {
            let offs = pageStartCKey + pageSizeCKey * i;
            const pageEnd = offs + pageSizeCKey;

            while (offs < pageEnd) {
                const EKeyCount = view.getUint8(offs + 0x00);
                if (EKeyCount == 0)
                    break;

                const size = view.getUint32(offs + 0x02); // Technically this is a 40-bit size value. We chop off the first byte here... hope it doesn't matter!
                const CKey = readHexString(view, offs + 0x06);
                offs += 0x16;

                /*
                for (let j = 0; j < EKeyCount; j++) {
                    const EKey = readHexString(view, offs + 0x00);
                    file.encodingKeyMap.set(CKey, EKey);
                    offs += 0x10;
                }
                */

                const EKey = readHexString(view, offs + 0x00);
                file.CKeyToEKey.set(CKey, EKey);
                offs += 0x10 * EKeyCount;
            }
        }

        return file;
    }
}

interface TASCArchiveFileEntry {
    dataOffset: number;
    dataSize: number;
}

class TASCArchiveIndex {
    public entries = new Map<string, TASCArchiveFileEntry>();

    constructor(public readonly key: string) {}

    public static parse(key: string, buffer: ArrayBufferSlice): TASCArchiveIndex {
        const file = new TASCArchiveIndex(key);
        const view = buffer.createDataView();

        // read data footer
        const footerOffs = buffer.byteLength - 0x24;
        const version = view.getUint8(footerOffs + 0x10); assert(version === 1);
        const blockSizeKb = view.getUint8(footerOffs + 0x13); assert(blockSizeKb === 4);
        const offsetBytes = view.getUint8(footerOffs + 0x14); assert(offsetBytes === 4);
        const sizeBytes = view.getUint8(footerOffs + 0x15); assert(sizeBytes === 4);
        const keySizeBytes = view.getUint8(footerOffs + 0x16); assert(keySizeBytes === 0x10);
        const checksumSize = view.getUint8(footerOffs + 0x17); assert(checksumSize === 8);
        const numFiles = view.getUint32(footerOffs + 0x18, true);

        let offs = 0;
        const blockSize = blockSizeKb << 10;
        for (let i = 0; i < numFiles;) {
            const blockEnd = offs + blockSize - 0x18;
            while (offs < blockEnd) {
                const EKey = readHexString(view, offs + 0x00);
                if (EKey === '00000000000000000000000000000000')
                    break;
                const dataSize = view.getUint32(offs + 0x10);
                const dataOffset = view.getUint32(offs + 0x14);
                file.entries.set(EKey, { dataOffset, dataSize });
                offs += 0x18;
                i++;
            }

            offs = align(offs, blockSize);
        }

        return file;
    }

    public getFileForEKey(EKey: string): TASCArchiveFileEntry | null {
        return fallbackUndefined(this.entries.get(EKey), null);
    }
}

// TODO(jstpierre): It seems that the WoW root file is getting replaced with TVFS...
class WoWRootFile {
    public fileIDToCKey = new Map<number, string>();

    public getCKeyForFileID(fileID: number): string {
        return assertExists(this.fileIDToCKey.get(fileID));
    }

    public static parse(buffer: ArrayBufferSlice): WoWRootFile {
        buffer = decodeBLTE(buffer)!;
        const view = buffer.createDataView();
        // writeFileSync(path.join(cachePath, `root.out`), Buffer.from(buffer.arrayBuffer));

        const file = new WoWRootFile();

        let offs = 0;
        while (offs < buffer.byteLength) {
            const numFiles = view.getUint32(offs + 0x00, true);
            const contentFlags = view.getUint32(offs + 0x04, true);
            const localeFlags = view.getUint32(offs + 0x08, true);

            // TODO(jstpierre): Skip over blocks if contentFlags / localeFlags are off...
            const parseBlock = true;

            if (parseBlock) {
                let fileID = 0;
                const deltaTableOffs = offs + 0x0C;
                const keyHashTable = deltaTableOffs + numFiles * 0x04;
                for (let i = 0; i < numFiles; i++) {
                    const fileIDDelta = view.getUint32(deltaTableOffs + i * 0x04, true);
                    fileID += fileIDDelta;
                    const CKey = readHexString(view, keyHashTable + i * 0x18 + 0x00);
                    file.fileIDToCKey.set(fileID, CKey);
                    fileID++;
                }
            }

            offs += 0x0C + numFiles * 0x04 + numFiles * 0x18;
        }

        return file;
    }
}

class CDNFetcher {
    public hosts: CDNHost[];
    public cdnConfig: ReturnType<typeof parseKeyValues>;
    public buildConfig: ReturnType<typeof parseKeyValues>;
    public encoding: TASCEncodingFile;
    public archiveIndex: TASCArchiveIndex[] = [];
    public root: WoWRootFile;

    constructor(public cache: CDNCache, public versionsManifest: TASCManifest, public cdnsManifest: TASCManifest, public region: string) {
        const cdnRow = this.cdnsManifest.findRow(`Name`, this.region);
        const hosts = this.cdnsManifest.getField(cdnRow, `Hosts`).split(' ');
        const path = this.cdnsManifest.getField(cdnRow, `Path`);
        this.hosts = hosts.map((host) => new CDNHost(host, path));
    }

    private selectHost(): CDNHost {
        return this.hosts[0];
    }

    public async init() {
        const versionRow = this.versionsManifest.findRow(`Region`, this.region);
        const buildConfigKey = this.versionsManifest.getField(versionRow, `BuildConfig`);
        const cdnConfigKey = this.versionsManifest.getField(versionRow, `CDNConfig`);

        this.cdnConfig = parseKeyValues(decodeString(await this.cache.fetchData(this.selectHost(), '/config', cdnConfigKey)));
        this.buildConfig = parseKeyValues(decodeString(await this.cache.fetchData(this.selectHost(), '/config', buildConfigKey)));

        this.bootstrap();
    }

    public async fetchCKeyFromCDN(CKey: string) {
        return this.cache.fetchData(this.selectHost(), `/data`, this.encoding.getEKeyForCKey(CKey));
    }

    private findArchiveFile(EKey: string): [TASCArchiveIndex, TASCArchiveFileEntry] {
        for (const index of this.archiveIndex) {
            const file = index.getFileForEKey(EKey);
            if (file !== null)
                return [index, file];
        }
        throw "whoops";
    }

    public async fetchCKeyFromArchive(CKey: string) {
        const EKey = this.encoding.getEKeyForCKey(CKey);
        const [archive, file] = this.findArchiveFile(EKey);
        return this.cache.fetchArchivePartial(this.selectHost(), archive, file);
    }

    public async bootstrap() {
        this.encoding = TASCEncodingFile.parse(await this.cache.fetchData(this.selectHost(), `/data`, `${this.buildConfig['encoding'][1]}`));

        await Promise.all(this.cdnConfig['archives'].map(async (key) => {
            this.archiveIndex.push(TASCArchiveIndex.parse(key, await this.cache.fetchData(this.selectHost(), `/data`, `${key}.index`)));
        }));

        this.root = WoWRootFile.parse(await this.fetchCKeyFromCDN(this.buildConfig['root'][0]));
    }

    public fetchFileID(fileID: number) {
        const CKey = this.root.getCKeyForFileID(fileID);
        this.fetchCKeyFromArchive(CKey);
    }
}

async function main_fetch(fileID: number) {
    const dataFetcher = new DataFetcher();
    const cache = new CDNCache(dataFetcher, cachePath);

    const versions = TASCManifest.parse(decodeString(await dataFetcher.fetchURL(`${patchServer}/${product}/versions`)));
    const cdns = TASCManifest.parse(decodeString(await dataFetcher.fetchURL(`${patchServer}/${product}/cdns`)));

    const fetcher = new CDNFetcher(cache, versions, cdns, region);
    await fetcher.init();
    await fetcher.fetchFileID(fileID);
}

async function main_decompress(inPath: string, outPath: string) {
    const src = await fetchData(inPath);
    const dst = decodeBLTE(src);
    if (dst !== null)
        writeFileSync(outPath, Buffer.from(dst.arrayBuffer));
}

async function main() {
    const mode = process.argv[2];
    if (mode === 'fetch')
        return main_fetch(parseInt(process.argv[3]));
    else if (mode === 'decompress')
        return main_decompress(process.argv[3], process.argv[4]);
}

main();
