
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import * as BYML from "../../byml.js";
import * as Yaz0 from '../../Common/Compression/Yaz0.js';
import { openSync, readSync, closeSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { assertExists, hexzero, assert, readString } from "../../util.js";
import { Endianness } from "../../endian.js";

// Standalone tool designed for node to extract data.

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/ztp_raw`;
const pathBaseOut = `../../../data/j3d/ztp`;

interface SymbolMapEntry {
    sectionName: string;
    addr: number;
    size: number;
    vaddr: number;
    symbolName: string;
    filename: string;
}

interface SymbolMap {
    sectionNames: string[];
    entries: SymbolMapEntry[];
}

const sectionNames = [
    '.text', '.text1', '.text2', '.text3', '.text4', '.text5', '.text6',
    '.extab', '.extabindex', '.ctors', '.dtors', '.rodata', '.data', '.sdata', '.sdata2',
    '.bss', '.sbss', '.sbss2', '.stack',
];

// TODO(jstpierre): This is a bit junk.
function sectionTypeStringToIdx(sectionName: string): number {
    const idx = sectionNames.indexOf(sectionName);
    assert(idx >= 0);
    return idx;
}

function parseMapFile(filename: string): SymbolMap {
    const S = readFileSync(filename, { encoding: 'utf8' });
    const lines = S.split('\n');
    const entries: SymbolMapEntry[] = [];

    const sectionNames: string[] = [];

    let sectionName: string | null = null;
    let i = 0;

    for (; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.endsWith(' section layout')) {
            // Switch the section.
            sectionName = line.split(' ')[0];
            continue;
        }

        // Done with the symbol tables.
        if (line === 'Memory map:')
            break;

        if (line.startsWith('>>>'))
            continue;

        if (sectionName === null)
            continue;

        const [addrStr, sizeStr, vaddrStr, fileOffset, unk2Str, symbolName, filename] = line.split(/\s+/);
        if (symbolName === undefined)
            continue;

        if (unk2Str === undefined || unk2Str.startsWith('...'))
            continue;

        const addr = parseInt(addrStr, 16);
        const size = parseInt(sizeStr, 16);
        const vaddr = parseInt(vaddrStr, 16);
        entries.push({ sectionName, addr, size, vaddr, symbolName, filename });
    }

    // Memory map.
    for (; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line.startsWith('.'))
            continue;

        const [sectionName, addrStr, sizeStr, offsStr] = line.split(/\s+/);
        if (offsStr === undefined) {
            // Stripped section, like .debug_*
            continue;
        }

        const addr = parseInt(addrStr, 16);
        const size = parseInt(sizeStr, 16);
        const offs = parseInt(offsStr, 16);

        if (size === 0)
            continue;

        sectionNames.push(sectionName);
    }

    return { entries, sectionNames };
}

interface SymbolData {
    Filename: string;
    SymbolName: string;
    Data: ArrayBufferSlice;
}

function basename(filename: string): string {
    return filename.split('/').pop()!;
}

class DOL {
    public name: string;
    public map: SymbolMap;

    private filename: string;
    private offs: Uint32Array;
    private addr: Uint32Array;
    private size: Uint32Array;

    constructor(dolFilename: string, mapFilename: string) {
        this.map = parseMapFile(mapFilename);
        this.name = basename(dolFilename);

        const buffer = fetchDataFragmentSync(dolFilename, 0x00, 0xE4);
        this.offs = buffer.createTypedArray(Uint32Array, 0x00, 18, Endianness.BIG_ENDIAN);
        this.addr = buffer.createTypedArray(Uint32Array, 0x48, 18, Endianness.BIG_ENDIAN);
        this.size = buffer.createTypedArray(Uint32Array, 0x90, 18, Endianness.BIG_ENDIAN);
        this.filename = dolFilename;
    }

    public getSymbolData(entry: SymbolMapEntry): ArrayBufferSlice {
        const sectionTypeIdx = sectionTypeStringToIdx(entry.sectionName);
        const offs = this.offs[sectionTypeIdx] + entry.addr;
        const data = fetchDataFragmentSync(this.filename, offs, entry.size);
        return data;
    }
}

// We don't do a full relocation, we just hardcode the pointer to the .data section.
class REL {
    public name: string;
    public map: SymbolMap;

    private buffer: ArrayBufferSlice;
    private offs: number[] = [];
    private size: number[] = [];

    constructor(relFilename: string, mapFilename: string) {
        this.map = parseMapFile(mapFilename);
        this.name = basename(relFilename);

        let buffer = fetchDataSync(relFilename);
        if (readString(buffer, 0x00, 0x04) === 'Yaz0')
            buffer = Yaz0.decompressSW(buffer);

        this.buffer = buffer;

        const view = buffer.createDataView();
        const sectionTableCount = view.getUint32(0x0C);
        let sectionTableOffs = view.getUint32(0x10);

        for (let i = 0; i < sectionTableCount; i++) {
            // Skip section 0.
            if (i !== 0) {
                const sectionOffs = view.getUint32(sectionTableOffs + 0x00);
                const sectionSize = view.getUint32(sectionTableOffs + 0x04);
                this.offs.push(sectionOffs);
                this.size.push(sectionSize);
            }
            sectionTableOffs += 0x08;
        }

        this.map = parseMapFile(mapFilename);
    }

    public getSymbolData(entry: SymbolMapEntry): ArrayBufferSlice {
        const sectionIdx = this.map.sectionNames.indexOf(entry.sectionName);
        /* if (!(sectionIdx >= 0)) {
            console.log(`Error Rel Section: ${this.name} ${entry.sectionName} ${sectionIdx}`);
        } */

        console.log(`Rel Section: ${this.name} ${entry.sectionName} ${sectionIdx}`);

        assert(sectionIdx >= 0);
        const offs = this.offs[sectionIdx] + entry.addr;
        const data = this.buffer.subarray(offs, entry.size);
        return data;
    }
}

type Binary = DOL | REL;

function extractExtra(binaries: Binary[]) {
    const datas: SymbolData[] = [];

    function pushSymbolEntry(datas: SymbolData[], entry: SymbolMapEntry, data: ArrayBufferSlice): ArrayBufferSlice {
        console.log(entry.filename, entry.symbolName, hexzero(entry.addr, 8), entry.size);
        datas.push({ Filename: entry.filename, SymbolName: entry.symbolName, Data: data });
        return data;
    }

    function extractSymbol(datas: SymbolData[], binary: Binary, symFile: string, symName: string): void {
        const entry = assertExists(binary.map.entries.find((e) => e.filename === symFile && e.symbolName === symName), `${symFile} / ${symName}`);
        const data = binary.getSymbolData(entry);
        pushSymbolEntry(datas, entry, data);
    }

    function findBinary(name: string): Binary {
        return assertExists(binaries.find((binary) => binary.name === name));
    }

    const framework = findBinary('main.dol');

    // main.dol : d_stage.o
    extractSymbol(datas, framework, `d_stage.o`, `l_objectName`); // Maps actor names to ID and Subtype

    // main.dol : d_dylink.o
    extractSymbol(datas, framework, `c_dylink.o`, `DynamicNameTable`); // Maps IDs to pointers to REL names in the string table
    extractSymbol(datas, framework, `c_dylink.o`, `@stringBase0`); // List of Null-terminated REL names. Indexed by DynamicNameTable

    // main.dol : d_kankyo_data.o
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_time_attribute`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_time_attribute_boss`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_envr_default`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_field_data`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_pselect_default`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_vr_box_data`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_maple_col`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_darkworld_tbl`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_kydata_BloomInf_tbl`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_light_size_tbl`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `l_light_size_tbl_tw`);
    extractSymbol(datas, framework, `d_kankyo_data.o`, `S_xfog_table_data`);

    // main.dol : d_drawlist.o
    extractSymbol(datas, framework, `d_drawlist.o`, `l_matDL`);
    extractSymbol(datas, framework, `d_drawlist.o`, `l_frontZMat`);
    extractSymbol(datas, framework, `d_drawlist.o`, `l_frontNoZSubMat`);

    const crg1 = {
        SymbolData: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/extra.crg1_arc`, Buffer.from(data));
}

async function loadBinaries(): Promise<Binary[]> {
    const binaries: Binary[] = [];

    // Parse DOL.
    binaries.push(new DOL(`${pathBaseIn}/main.dol`, `${pathBaseIn}/map/Final/Release/frameworkF.map`));

    // Parse RELs.
    const rels = readdirSync(`${pathBaseIn}/rel/Final/Release`);
    for (let i = 0; i < rels.length; i++) {
        const relFilename = `${pathBaseIn}/rel/Final/Release/${rels[i]}`;
        const mapFilename = `${pathBaseIn}/map/Final/Release/${rels[i].replace('.rel', '.map')}`;
        binaries.push(new REL(relFilename, mapFilename));
    }

    return binaries;
}

function extractProfiles(binaries: Binary[]) {
    const datas: ArrayBufferSlice[] = [];

    function processProfile(data: ArrayBufferSlice, rel: boolean): void {
        const view = data.createDataView();

        if (rel) {
            // sanity check
            const layer = view.getUint32(0x00);
            assert(layer === 0xFFFFFFFD);
        }

        const pcName = view.getUint16(0x08);
        datas[pcName] = data;
    }

    for (const binary of binaries) {
        const m = binary.map;
        for (let i = 0; i < m.entries.length; i++)
            if (m.entries[i].symbolName.startsWith('g_profile_'))
                processProfile(binary.getSymbolData(m.entries[i]), binary instanceof REL);
    }

    const crg1 = {
        Profiles: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/f_pc_profiles.crg1_arc`, Buffer.from(data));
}

async function main() {
    const binaries = await loadBinaries();
    extractExtra(binaries);
    extractProfiles(binaries);
}

main();
