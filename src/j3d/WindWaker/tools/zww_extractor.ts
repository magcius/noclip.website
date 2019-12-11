
import ArrayBufferSlice from "../../../ArrayBufferSlice";
import * as BYML from "../../../byml";
import { openSync, readSync, closeSync, readFileSync, writeFileSync } from "fs";
import { assertExists } from "../../../util";

// Standalone tool designed for node to extract data.

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../../data/zww_raw`;
const pathBaseOut = `../../../../data/j3d/ww`;

interface SymbolMapEntry {
    size: number;
    vaddr: number;
    symbolName: string;
    filename: string;
}

interface SymbolMap {
    entries: SymbolMapEntry[];
}

function parseMapFile(filename: string): SymbolMap {
    const S = readFileSync(filename, { encoding: 'utf8' });
    const lines = S.split('\n');
    const entries: SymbolMapEntry[] = [];
    for (let i = 4; i < lines.length; i++) {
        const line = lines[i].trim();
        const [unkStr, sizeStr, vaddrStr, unk2Str, symbolName, filename] = line.split(/\s+/);
        if (unk2Str === undefined || unk2Str.startsWith('...'))
            continue;

        const size = parseInt(sizeStr, 16);
        const vaddr = parseInt(vaddrStr, 16);
        entries.push({ size, vaddr, symbolName, filename });
    }
    return { entries };
}

interface SymbolData {
    Filename: string;
    SymbolName: string;
    Data: ArrayBufferSlice;
}

function extractSymbol(datas: SymbolData[], map: SymbolMap, symFile: string, symName: string, dolFilename: string = `${pathBaseIn}/main.dol`, dolBase: number = 0x3000): void {
    const entry = assertExists(map.entries.find((e) => e.filename === symFile && e.symbolName === symName));
    const offs = ((entry.vaddr) & 0x00FFFFFF) - dolBase;
    const data = fetchDataFragmentSync(dolFilename, offs, entry.size);
    console.log(entry.filename, entry.symbolName, entry.size);
    datas.push({ Filename: entry.filename, SymbolName: entry.symbolName, Data: data });
}

function main() {
    const framework = parseMapFile(`${pathBaseIn}/maps/framework.map`);
    const datas: SymbolData[] = [];

    // d_flower.o
    extractSymbol(datas, framework, `d_flower.o`, `l_Txq_bessou_hanaTEX`);
    extractSymbol(datas, framework, `d_flower.o`, `l_pos3`);
    extractSymbol(datas, framework, `d_flower.o`, `l_color3`);
    extractSymbol(datas, framework, `d_flower.o`, `l_texCoord3`);
    extractSymbol(datas, framework, `d_flower.o`, `l_QbsafDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_QbsfwDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
    extractSymbol(datas, framework, `d_flower.o`, `l_pos`);
    extractSymbol(datas, framework, `d_flower.o`, `l_color`);
    extractSymbol(datas, framework, `d_flower.o`, `l_texCoord`);
    extractSymbol(datas, framework, `d_flower.o`, `l_OhanaDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_Ohana_gutDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
    extractSymbol(datas, framework, `d_flower.o`, `l_pos2`);
    extractSymbol(datas, framework, `d_flower.o`, `l_color2`);
    extractSymbol(datas, framework, `d_flower.o`, `l_texCoord2`);
    extractSymbol(datas, framework, `d_flower.o`, `l_Ohana_highDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_Ohana_high_gutDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_matDL3`);
    extractSymbol(datas, framework, `d_flower.o`, `l_matDL`);
    extractSymbol(datas, framework, `d_flower.o`, `l_matDL2`);

    // d_tree.o
    extractSymbol(datas, framework, 'd_tree.o', 'l_color');
    extractSymbol(datas, framework, 'd_tree.o', 'l_vtxDescList$4669');
    extractSymbol(datas, framework, 'd_tree.o', 'l_pos');
    extractSymbol(datas, framework, 'd_tree.o', 'l_color');
    extractSymbol(datas, framework, 'd_tree.o', 'l_texCoord');
    extractSymbol(datas, framework, 'd_tree.o', 'l_matDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Oba_swood_noneDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Oba_swood_a_cuttDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Oba_swood_a_cutuDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Oba_swood_a_hapaDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Oba_swood_a_mikiDL');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Txa_kage_32TEX');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, framework, 'd_tree.o', 'g_dTree_Oba_kage_32DL');
    extractSymbol(datas, framework, 'd_tree.o', 'g_dTree_shadowMatDL');
    extractSymbol(datas, framework, 'd_tree.o', 'g_dTree_shadowPos');
    extractSymbol(datas, framework, 'd_tree.o', 'g_dTree_shadowTexCoord');
    extractSymbol(datas, framework, 'd_tree.o', 'l_shadowColor$4656');
    extractSymbol(datas, framework, 'd_tree.o', 'l_shadowVtxAttrFmtList$4655');
    extractSymbol(datas, framework, 'd_tree.o', 'l_shadowVtxDescList$4654');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, framework, 'd_tree.o', 'l_Txa_swood_aTEX');
    extractSymbol(datas, framework, 'd_tree.o', 'l_vtxAttrFmtList$4670');
    
    // d_grass.o
    extractSymbol(datas, framework, 'd_grass.o', 'l_color');
    extractSymbol(datas, framework, 'd_grass.o', 'l_K_kusa_00TEX');
    extractSymbol(datas, framework, 'd_grass.o', 'l_matDL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Oba_kusa_a_cutDL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Oba_kusa_aDL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_pos');
    extractSymbol(datas, framework, 'd_grass.o', 'l_texCoord');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Txa_ob_kusa_aTEX');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_00DL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_01DL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_color');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_matDL');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_pos');
    extractSymbol(datas, framework, 'd_grass.o', 'l_Vmori_texCoord');
    extractSymbol(datas, framework, 'd_grass.o', 'l_vtxAttrFmtList$4529');
    extractSymbol(datas, framework, 'd_grass.o', 'l_vtxDescList$4528');

    // d_stage.o
    extractSymbol(datas, framework, `d_stage.o`, `l_objectName`);

    const crg1 = {
        SymbolData: datas,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/extra.crg1_arc`, Buffer.from(data));
}

main();
