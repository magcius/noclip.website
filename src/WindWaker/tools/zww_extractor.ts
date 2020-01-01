
import ArrayBufferSlice from "../../ArrayBufferSlice";
import * as BYML from "../../byml";
import { openSync, readSync, closeSync, readFileSync, writeFileSync } from "fs";
import { assertExists, hexzero, assert } from "../../util";
import { Endianness } from "../../endian";

// Standalone tool designed for node to extract data.

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/zww_raw`;
const pathBaseOut = `../../../data/j3d/ww`;

interface SymbolMapEntry {
    sectionTypeIdx: number;
    addr: number;
    size: number;
    vaddr: number;
    symbolName: string;
    filename: string;
}

interface SymbolMap {
    entries: SymbolMapEntry[];
}

const sectionNames = [
    '.text', '.text1', '.text2', '.text3', '.text4', '.text5', '.text6',
    'extab', 'extabindex', '.ctors', '.dtors', '.rodata', '.data', '.sdata', '.sdata2',
    '.bss', '.sbss', '.sbss2',
]

function sectionTypeStringToIdx(sectionName: string): number {
    const idx = sectionNames.indexOf(sectionName);
    assert(idx >= 0);
    return idx;
}

function parseMapFile(filename: string): SymbolMap {
    const S = readFileSync(filename, { encoding: 'utf8' });
    const lines = S.split('\n');
    const entries: SymbolMapEntry[] = [];
    let sectionTypeIdx: number = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.endsWith(' section layout')) {
            // Switch the section.
            const sectionName = line.split(' ')[0];
            sectionTypeIdx = sectionTypeStringToIdx(sectionName);
        }

        const [addrStr, sizeStr, vaddrStr, unk2Str, symbolName, filename] = line.split(/\s+/);
        if (unk2Str === undefined || unk2Str.startsWith('...'))
            continue;

        const addr = parseInt(addrStr, 16);
        const size = parseInt(sizeStr, 16);
        const vaddr = parseInt(vaddrStr, 16);
        entries.push({ sectionTypeIdx, addr, size, vaddr, symbolName, filename });
    }
    return { entries };
}

interface SymbolData {
    Filename: string;
    SymbolName: string;
    Data: ArrayBufferSlice;
}

function extractSymbol(datas: SymbolData[], dolHeader: DolHeader, map: SymbolMap, symFile: string, symName: string): void {
    const entry = assertExists(map.entries.find((e) => e.filename === symFile && e.symbolName === symName));
    const offs = dolHeader.offs[entry.sectionTypeIdx] + entry.addr;
    const data = fetchDataFragmentSync(dolHeader.filename, offs, entry.size);
    console.log(entry.filename, entry.symbolName, hexzero(dolHeader.offs[entry.sectionTypeIdx], 8), hexzero(entry.addr, 8), hexzero(offs, 8), entry.size);
    datas.push({ Filename: entry.filename, SymbolName: entry.symbolName, Data: data });
}

interface DolHeader {
    filename: string;
    offs: Uint32Array;
    addr: Uint32Array;
    size: Uint32Array;
}

function parseDolFile(filename: string): DolHeader {
    const buffer = fetchDataFragmentSync(filename, 0x00, 0xE4);
    const offs = buffer.createTypedArray(Uint32Array, 0x00, 18, Endianness.BIG_ENDIAN);
    const addr = buffer.createTypedArray(Uint32Array, 0x48, 18, Endianness.BIG_ENDIAN);
    const size = buffer.createTypedArray(Uint32Array, 0x90, 18, Endianness.BIG_ENDIAN);
    return { filename, offs, addr, size };
}

function main() {
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

    const crg1 = {
        SymbolData: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/extra.crg1_arc`, Buffer.from(data));
}

main();
