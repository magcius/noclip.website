
import ArrayBufferSlice from "../../ArrayBufferSlice";
import * as BYML from "../../byml";
import * as Yaz0 from './Yaz0_NoWASM';
import { openSync, readSync, closeSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { assertExists, hexzero, assert, hexdump, readString } from "../../util";
import { Endianness } from "../../endian";

// Standalone tool designed for node to extract data.

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/zww_raw`;
const pathBaseOut = `../../../data/j3d/ww`;

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
    'extab', 'extabindex', '.ctors', '.dtors', '.rodata', '.data', '.sdata', '.sdata2',
    '.bss', '.sbss', '.sbss2',
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

    let sectionName: string;
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

        if (sectionName === undefined)
            continue;

        const [addrStr, sizeStr, vaddrStr, unk2Str, symbolName, filename] = line.split(/\s+/);
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

function pushSymbolEntry(datas: SymbolData[], entry: SymbolMapEntry, data: ArrayBufferSlice): ArrayBufferSlice {
    console.log(entry.filename, entry.symbolName, hexzero(entry.addr, 8), entry.size);
    datas.push({ Filename: entry.filename, SymbolName: entry.symbolName, Data: data });
    return data;
}

function getSymbolDataREL(relFile: RelFile, mapFile: SymbolMap, entry: SymbolMapEntry): ArrayBufferSlice {
    const sectionIdx = mapFile.sectionNames.indexOf(entry.sectionName);
    assert(sectionIdx >= 0);
    const offs = relFile.offs[sectionIdx] + entry.addr;
    const data = relFile.buffer.subarray(offs, entry.size);
    return data;
}

function getSymbolDataDOL(dolFile: DolFile, mapFile: SymbolMap, entry: SymbolMapEntry): ArrayBufferSlice {
    const sectionTypeIdx = sectionTypeStringToIdx(entry.sectionName);
    const offs = dolFile.offs[sectionTypeIdx] + entry.addr;
    const data = fetchDataFragmentSync(dolFile.filename, offs, entry.size);
    return data;
}

function extractSymbol(datas: SymbolData[], dolHeader: DolFile, mapFile: SymbolMap, symFile: string, symName: string): void {
    const entry = assertExists(mapFile.entries.find((e) => e.filename === symFile && e.symbolName === symName));
    const data = getSymbolDataDOL(dolHeader, mapFile, entry);
    pushSymbolEntry(datas, entry, data);
}

interface DolFile {
    filename: string;
    offs: Uint32Array;
    addr: Uint32Array;
    size: Uint32Array;
}

function parseDolFile(filename: string): DolFile {
    const buffer = fetchDataFragmentSync(filename, 0x00, 0xE4);
    const offs = buffer.createTypedArray(Uint32Array, 0x00, 18, Endianness.BIG_ENDIAN);
    const addr = buffer.createTypedArray(Uint32Array, 0x48, 18, Endianness.BIG_ENDIAN);
    const size = buffer.createTypedArray(Uint32Array, 0x90, 18, Endianness.BIG_ENDIAN);
    return { filename, offs, addr, size };
}

// We don't do a full relocation, we just hardcode the pointer to the .data section.
interface RelFile {
    buffer: ArrayBufferSlice;
    offs: number[];
    size: number[];
}

function parseRelFile(filename: string): RelFile {
    let buffer = fetchDataSync(filename);
    if (readString(buffer, 0x00, 0x04) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);

    const view = buffer.createDataView();
    const sectionTableCount = view.getUint32(0x0C);
    let sectionTableOffs = view.getUint32(0x10);

    const offs: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < sectionTableCount; i++) {
        // Skip section 0.
        if (i !== 0) {
            const sectionOffs = view.getUint32(sectionTableOffs + 0x00);
            const sectionSize = view.getUint32(sectionTableOffs + 0x04);
            offs.push(sectionOffs);
            size.push(sectionSize);
        }
        sectionTableOffs += 0x08;
    }

    return { buffer, offs, size };
}

function extractExtra() {
    const dolHeader = parseDolFile(`${pathBaseIn}/main.dol`);
    const framework = parseMapFile(`${pathBaseIn}/maps/framework.map`);
    const datas: SymbolData[] = [];

    // d_flower.o
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Txq_bessou_hanaTEX`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_pos3`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_color3`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_texCoord3`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_QbsafDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_QbsfwDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_pos`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_color`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_texCoord`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_OhanaDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Ohana_gutDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_pos2`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_color2`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_texCoord2`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Ohana_highDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_Ohana_high_gutDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_matDL3`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_matDL`);
    extractSymbol(datas, dolHeader, framework, `d_flower.o`, `l_matDL2`);

    // d_tree.o
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_color');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_vtxDescList$4669');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_pos');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_color');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_texCoord');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_matDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Oba_swood_noneDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Oba_swood_a_cuttDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Oba_swood_a_cutuDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Oba_swood_a_hapaDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Oba_swood_a_mikiDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Txa_kage_32TEX');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'g_dTree_Oba_kage_32DL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'g_dTree_shadowMatDL');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'g_dTree_shadowPos');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'g_dTree_shadowTexCoord');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_shadowColor$4656');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_shadowVtxAttrFmtList$4655');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_shadowVtxDescList$4654');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, dolHeader, framework, 'd_tree.o', 'l_vtxAttrFmtList$4670');
    
    // d_grass.o
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_color');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_K_kusa_00TEX');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_matDL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Oba_kusa_a_cutDL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Oba_kusa_aDL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_pos');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_texCoord');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Txa_ob_kusa_aTEX');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_00DL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_01DL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_color');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_matDL');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_pos');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_Vmori_texCoord');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_vtxAttrFmtList$4529');
    extractSymbol(datas, dolHeader, framework, 'd_grass.o', 'l_vtxDescList$4528');

    // d_stage.o
    extractSymbol(datas, dolHeader, framework, `d_stage.o`, `l_objectName`); // Maps actor names to ID and Subtype

    // d_dylink.o
    extractSymbol(datas, dolHeader, framework, `c_dylink.o`, `DynamicNameTable`); // Maps IDs to pointers to REL names in the string table
    extractSymbol(datas, dolHeader, framework, `c_dylink.o`, `@stringBase0`); // List of Null-terminated REL names. Indexed by DynamicNameTable

    // d_kankyo_data.o
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_time_attribute`);
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_time_attribute_boss`);
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_envr_default`);
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_field_data`);
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_pselect_default`);
    extractSymbol(datas, dolHeader, framework, `d_kankyo_data.o`, `l_vr_box_data`);

    // d_a_sea.o
    extractSymbol(datas, dolHeader, framework, `d_a_sea.o`, `wi_prm_ocean`);

    const crg1 = {
        SymbolData: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/extra.crg1_arc`, Buffer.from(data));
}

async function extractProfiles() {
    const datas: ArrayBufferSlice[] = [];

    function iterProfileSymbols(m: SymbolMap, callback: (mapFile: SymbolMap, e: SymbolMapEntry) => void): void {
        for (let i = 0; i < m.entries.length; i++) {
            if (m.entries[i].symbolName.startsWith('g_profile_'))
                callback(m, m.entries[i]);
        }
    }

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

    // Grab DOL profiles.
    const dolHeader = parseDolFile(`${pathBaseIn}/main.dol`);
    const framework = parseMapFile(`${pathBaseIn}/maps/framework.map`);
    iterProfileSymbols(framework, (mapFile, entry) => {
        processProfile(getSymbolDataDOL(dolHeader, mapFile, entry), false);
    });

    // Grab REL profiles.
    const rels = readdirSync(`${pathBaseIn}/rels`);
    for (let i = 0; i < rels.length; i++) {
        const relFilename = `${pathBaseIn}/rels/${rels[i]}`;
        const mapFilename = `${pathBaseIn}/maps/${rels[i].replace('.rel', '.map')}`;
        const rel = parseRelFile(relFilename);
        const map = parseMapFile(mapFilename);
        iterProfileSymbols(map, (mapFile, entry) => {
            processProfile(getSymbolDataREL(rel, mapFile, entry), true);
        });
    }

    const crg1 = {
        Profiles: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/f_pc_profiles.crg1_arc`, Buffer.from(data));
}

function main() {
    extractExtra();
    extractProfiles();
}

main();
