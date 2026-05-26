// Offline pipeline that produces data/RagnarokOnline/
//
//   npx tsx src/RagnarokOnline/tools/extract.ts [mapId ...]
//   npx tsx src/RagnarokOnline/tools/extract.ts --only=extract,gen-maps
//   npx tsx src/RagnarokOnline/tools/extract.ts --extract-grf   (debug only)
//
// Stages (run in order; each gated by its inputs existing):
//   1. extract          : stages GRF + baked + legacy assets -> data/RagnarokOnline/
//   2. gen-maps         : rewrites src/RagnarokOnline/maps.ts (committed)
//   3. extract-emitters : per-map particle JSON from iRO effecttool .lub dump
//   4. extract-entities : per-map NPC/mob/warp JSON from Hercules scripts
//
// Required inputs (drop in place before running):
//
//   data/RagnarokOnline_raw/grf/data.grf
//     iRO Mar-11-2026 client GRF (~4.4 GiB, Event Horizon v0x300). Install
//     latest iRO; data.grf is at the install root.
//
//   data/RagnarokOnline_raw/grf/legacy/*.grf
//     kRO 2008/2009 snapshot GRFs. data.grf (v0x200, SAK) ships the 22
//     CLASSIC_MAPS' pre-renewal geometry; sdata.grf (v0x200) also contains
//     the two LEGACY_ONLY_MAPS (poring_c01/c02). data_hp.grf (v0x102) is
//     harmlessly skipped (parser doesn't handle v0x102; no map we use lives
//     there). Optional; missing -> classic/legacy scene entries aren't
//     generated.
//
//   data/RagnarokOnline_raw/iro_effecttool/
//     iRO effecttool .lub/.lua dump. Not in the GRF; copy from an iRO client
//     install's effecttool/ dir.
//
//   data/RagnarokOnline_raw/bin/lua-5.1-iro
//     Patched Lua 5.1 binary. iRO .lub files were precompiled with 32-bit
//     Lua, so a vanilla 64-bit lua refuses to load them ("bad header" on the
//     size_t width byte; "bad size" on the string length read). Build once:
//       curl -O https://www.lua.org/ftp/lua-5.1.5.tar.gz
//       tar xf lua-5.1.5.tar.gz && cd lua-5.1.5
//       patch -p0 < ../src/RagnarokOnline/tools/lua-5.1.5-iro.patch
//       make <platform>            # e.g. macosx, linux
//       mv src/lua data/RagnarokOnline_raw/bin/lua-5.1-iro
//     Also requires `iconv` on PATH for CP949 -> UTF-8 transcoding.
//
//   data/RagnarokOnline_raw/baked/gr2/, baked/gr2tex/
//     WoE Granny models pre-expanded offline (RO ships them Oodle0-compressed
//     with RAD-encoded textures only granny2.dll can decode). One-time build
//     on an x86 host with mingw + wine:
//       i686-w64-mingw32-gcc -O2 -o gr2_decompress.exe tools/gr2_decompress.c
//       i686-w64-mingw32-gcc -O2 -o gr2_texbake.exe   tools/gr2_texbake.c
//       # drop granny2.dll (lift from any iRO/kRO client install root)
//       # beside both .exes
//     For each WoE model (empelium90_0, [a|s|k]guardian90_{7,8,9},
//     guildflag90_1, treasurebox_2) and each shared clip
//     ({7,8,9}_{move,attack,damage}):
//       wine gr2_decompress.exe <src>.gr2 baked/gr2/<name>.gr2
//       wine gr2_texbake.exe   baked/gr2/<name>.gr2 baked/gr2tex/<name>
//     Optional; missing -> WoE props skipped.
//
//   ../Hercules
//     Sibling checkout of github.com/HerculesWS/Hercules. Optional; missing
//     -> entity manifests skipped.
//
// BGM mp3s aren't touched by any stage but the CDN needs them: copy from
// a client installation into data/RagnarokOnline/audio/bgm/ separately.
//
// Output: data/RagnarokOnline/ (gitignored; uploaded to CDN separately).
// Also overwrites src/RagnarokOnline/maps.ts (committed scene manifest).

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { inflateSync } from "zlib";
import * as path from "path";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { parseGND } from "../gnd.js";
import { parseRSM } from "../rsm.js";
import { parseRSW } from "../rsw.js";
import { parseSTR } from "../str.js";
import type { MapCategory } from "../mapcategory.js";

function toSlice(buf: Buffer): ArrayBufferSlice {
    return new ArrayBufferSlice(buf.buffer, buf.byteOffset, buf.byteLength);
}

const GRF_PATH = path.resolve("data/RagnarokOnline_raw/grf/data.grf");

const LEGACY_GRF_DIR = path.resolve("data/RagnarokOnline_raw/grf/legacy");
function legacyGrfPaths(): string[] {
    if (!existsSync(LEGACY_GRF_DIR)) return [];
    return readdirSync(LEGACY_GRF_DIR)
        .filter((f) => f.toLowerCase().endsWith(".grf"))
        .map((f) => path.join(LEGACY_GRF_DIR, f));
}

const CLASSIC_MAPS = new Set<string>([
    "alberta", "alde_gld", "aru_gld", "bat_c01", "bra_in01", "brasilis",
    "cmd_fild08", "ein_fild01", "gl_cas02", "iz_dun03", "izlude", "manuk",
    "moc_castle", "moc_fild20", "morocc", "prt_fild05", "prt_in", "ra_in01",
    "rachel", "spl_fild01", "splendide", "ve_fild02",
]);

const LEGACY_ONLY_MAPS = new Set<string>(["poring_c01", "poring_c02"]);

const HEADER_SIZE = 46;
const FILELIST_TYPE_FILE = 0x01;
const FILELIST_TYPE_ENCRYPT_MIXED = 0x02;
const FILELIST_TYPE_ENCRYPT_HEADER = 0x04;

interface GrfEntry {
    compressedSize: number;
    lengthAligned: number;
    realSize: number;
    type: number;
    offset: number;
}

class Grf {
    public readonly version: number;
    public readonly files: Map<string, GrfEntry> = new Map();
    private readonly fd: number;

    constructor(private readonly path: string) {
        this.fd = openSync(this.path, "r");

        const header = Buffer.alloc(HEADER_SIZE);
        readSync(this.fd, header, 0, HEADER_SIZE, 0);

        this.version = header.readUInt32LE(0x2A);

        const isV3 = this.version === 0x300 && header[35] === 0 && header[36] === 0 && header[37] === 0;
        const entryStride = isV3 ? 21 : 17;
        let fileTableOffset: number;
        let realFileCount: number;
        if (isV3) {
            fileTableOffset = Number(header.readBigUInt64LE(0x1E));
            realFileCount = header.readUInt32LE(0x26);
        } else {
            fileTableOffset = header.readUInt32LE(0x1E);
            const seed = header.readInt32LE(0x22);
            const rawCount = header.readInt32LE(0x26);
            realFileCount = rawCount - seed - 7;
        }

        const tablePrefixLen = isV3 ? 4 : 0;

        const tableHeader = Buffer.alloc(tablePrefixLen + 8);
        readSync(this.fd, tableHeader, 0, tableHeader.length, HEADER_SIZE + fileTableOffset);
        const packedSize = tableHeader.readUInt32LE(tablePrefixLen);
        const realSize = tableHeader.readUInt32LE(tablePrefixLen + 4);

        const packed = Buffer.alloc(packedSize);
        readSync(this.fd, packed, 0, packedSize, HEADER_SIZE + fileTableOffset + tableHeader.length);
        const raw = inflateSync(packed);
        if (raw.length !== realSize)
            throw new Error(`${this.path}: file table size mismatch (got ${raw.length}, expected ${realSize})`);

        const decoder = new TextDecoder("euc-kr");
        let p = 0;
        let parsed = 0;
        while (p < raw.length && parsed < realFileCount) {
            const start = p;
            while (p < raw.length && raw[p] !== 0) p++;
            if (p + 1 + entryStride > raw.length) break;
            const filename = decoder.decode(raw.slice(start, p)).toLowerCase();
            p++;
            const entry: GrfEntry = {
                compressedSize: raw.readUInt32LE(p),
                lengthAligned: raw.readUInt32LE(p + 4),
                realSize: raw.readUInt32LE(p + 8),
                type: raw[p + 12],
                offset: isV3 ? Number(raw.readBigUInt64LE(p + 13)) : raw.readUInt32LE(p + 13),
            };
            p += entryStride;
            parsed++;
            if (entry.type & FILELIST_TYPE_FILE)
                this.files.set(filename, entry);
        }
    }

    public close(): void {
        closeSync(this.fd);
    }

    public has(filename: string): boolean {
        return this.files.has(filename.toLowerCase());
    }

    public read(filename: string): Buffer | null {
        const entry = this.files.get(filename.toLowerCase());
        if (entry === undefined) return null;
        if (entry.type & (FILELIST_TYPE_ENCRYPT_MIXED | FILELIST_TYPE_ENCRYPT_HEADER))
            throw new Error(`${filename}: DES-encrypted entries not implemented (type=0x${entry.type.toString(16)})`);
        const buf = Buffer.alloc(entry.lengthAligned);
        readSync(this.fd, buf, 0, entry.lengthAligned, HEADER_SIZE + entry.offset);
        if (entry.realSize === entry.compressedSize)
            return buf.subarray(0, entry.realSize);
        return inflateSync(buf.subarray(0, entry.compressedSize));
    }
}

function openGrf(): Grf {
    if (!existsSync(GRF_PATH)) {
        console.error(`GRF not found: ${GRF_PATH}`);
        throw new Error("stage aborted");
    }
    const grf = new Grf(GRF_PATH);
    console.log(`  grf: v0x${grf.version.toString(16)}, ${grf.files.size} files`);
    return grf;
}

function runExtractGrf(): void {
    const grf = openGrf();
    const assetsRoot = path.resolve("data/RagnarokOnline_raw/assets");

    let copied = 0, errors = 0;
    for (const filename of grf.files.keys()) {
        const dst = path.join(assetsRoot, ...filename.split("\\"));
        let buf: Buffer | null = null;
        try {
            buf = grf.read(filename);
        } catch (e) {
            console.warn(`  read failed: ${filename}: ${(e as Error).message}`);
            errors++;
            continue;
        }
        if (buf === null) continue;
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, buf);
        copied++;
        if (copied % 10000 === 0) console.log(`  ${copied} files...`);
    }
    grf.close();
    console.log(`Extracted ${copied} files to ${assetsRoot}, ${errors} errors`);
}

const OUT_MAPS_DIR = path.resolve("data/RagnarokOnline/maps");
const OUT_TEXTURE_DIR = path.resolve("data/RagnarokOnline/textures");
const OUT_MODEL_DIR = path.resolve("data/RagnarokOnline/model");
const OUT_SPRITE_DIR = path.resolve("data/RagnarokOnline/sprite");
const OUT_EFFECT_DIR = path.resolve("data/RagnarokOnline/effects");
const OUT_MODEL3D_DIR = path.resolve("data/RagnarokOnline/model3d");

const MAP_EXTENSIONS = [".rsw", ".gnd", ".gat"];

const BAKED_GR2_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2/3dmob");
const BAKED_BONE_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2/3dmob_bone");
const BAKED_TEX_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2tex");
const WOE_GRANNY_MODELS = ["empelium90_0", "sguardian90_9", "aguardian90_8", "kguardian90_7", "guildflag90_1", "treasurebox_2"];

const GUARDIAN_BONE_CLIPS = ["7_move", "7_attack", "7_damage", "8_move", "8_attack", "8_damage", "9_move", "9_attack", "9_damage"];

const SPRITES_TO_EXTRACT = ["몬스터/poring", "이팩트/torch_01", "이팩트/particle1"];

const EFFECTS_TO_EXTRACT = ["gloria.str"];

const EFFECT_TEXTURES_TO_EXTRACT = ["alpha_down.tga", "ring_blue.tga"];

const WATER_DIR = "워터";
const WATER_FRAME_COUNT = 32;

function extractGrannyModels(): void {
    if (!existsSync(BAKED_GR2_DIR)) {
        console.warn(`  skip granny models (no baked dir): ${BAKED_GR2_DIR}`);
        return;
    }
    mkdirSync(OUT_MODEL3D_DIR, { recursive: true });
    let models = 0, texs = 0;
    for (const name of WOE_GRANNY_MODELS) {
        const gr2Src = path.join(BAKED_GR2_DIR, `${name}.gr2`);
        if (!existsSync(gr2Src)) {
            console.warn(`  skip (missing baked gr2): ${gr2Src}`);
            continue;
        }
        copyFileSync(gr2Src, path.join(OUT_MODEL3D_DIR, `${name}.gr2`));
        models++;

        const texRe = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.tex$`);
        for (const f of existsSync(BAKED_TEX_DIR) ? readdirSync(BAKED_TEX_DIR) : []) {
            if (texRe.test(f)) {
                copyFileSync(path.join(BAKED_TEX_DIR, f), path.join(OUT_MODEL3D_DIR, f));
                texs++;
            }
        }
    }
    let clips = 0;
    for (const clip of GUARDIAN_BONE_CLIPS) {
        const src = path.join(BAKED_BONE_DIR, `${clip}.gr2`);
        if (!existsSync(src)) {
            console.warn(`  skip (missing baked clip): ${src}`);
            continue;
        }
        copyFileSync(src, path.join(OUT_MODEL3D_DIR, `${clip}.gr2`));
        clips++;
    }
    console.log(`  granny models: ${models} gr2 + ${texs} textures + ${clips} action clips -> ${OUT_MODEL3D_DIR}`);
}

function readFromGrfs(grfs: Grf[], filename: string): Buffer | null {
    for (const g of grfs) {
        const buf = g.read(filename);
        if (buf !== null) return buf;
    }
    return null;
}

function writeGrfEntry(grfs: Grf[], grfPath: string, outRoot: string, dstRel: string): boolean {
    const buf = readFromGrfs(grfs, grfPath);
    if (buf === null) return false;
    const segments = dstRel.split("\\");
    const dst = path.join(outRoot, ...segments.map((s) => s.toLowerCase()));
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, buf);
    return true;
}

function copyTexture(grfs: Grf[], name: string, copied: Set<string>, missing: Set<string>): boolean {
    if (name === "" || copied.has(name) || missing.has(name))
        return false;
    if (writeGrfEntry(grfs, `data\\texture\\${name}`, OUT_TEXTURE_DIR, name)) {
        copied.add(name);
        return true;
    }
    missing.add(name);
    return false;
}

function extractTextures(grfs: Grf[], gndBuf: Buffer, copied: Set<string>, missing: Set<string>): void {
    const gnd = parseGND(toSlice(gndBuf));
    let n = 0;
    for (const name of gnd.textureNames)
        if (copyTexture(grfs, name, copied, missing)) n++;
    console.log(`  terrain textures: ${n} copied`);
}

function extractModels(grfs: Grf[], rswBuf: Buffer, copied: Set<string>, missing: Set<string>): void {
    const rsw = parseRSW(toSlice(rswBuf));
    console.log(`  rsw v${rsw.major}.${rsw.minor}, ${rsw.models.length} placements`);

    const uniqueModels = new Set<string>();
    for (const p of rsw.models)
        if (p.modelName !== "")
            uniqueModels.add(p.modelName);

    let modelsCopied = 0, modelMisses = 0, texCopied = 0;
    for (const modelName of uniqueModels) {
        const modelBuf = readFromGrfs(grfs, `data\\model\\${modelName}`);
        if (modelBuf === null) {
            console.warn(`  skip (missing model): ${modelName}`);
            modelMisses++;
            continue;
        }
        const segments = modelName.split("\\");
        const dst = path.join(OUT_MODEL_DIR, ...segments.map((s) => s.toLowerCase()));
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, modelBuf);
        modelsCopied++;

        try {
            const rsm = parseRSM(toSlice(modelBuf));
            for (const texName of rsm.textures)
                if (copyTexture(grfs, texName, copied, missing)) texCopied++;
        } catch (e) {
            console.warn(`  warn (rsm parse failed, textures skipped): ${modelName}: ${e}`);
        }
    }

    console.log(`  models: ${modelsCopied} unique RSM copied (${modelMisses} missing), ${texCopied} model textures copied`);
}

function extractWater(grfs: Grf[], rswBuf: Buffer, gndBuf: Buffer | null): void {
    const rsw = parseRSW(toSlice(rswBuf));

    let waterType = rsw.waterType;
    if (gndBuf !== null) {
        try {
            const gnd = parseGND(toSlice(gndBuf));
            if (gnd.water !== null)
                waterType = gnd.water.type;
        } catch (e) {
            console.warn(`  warn (gnd water parse failed, falling back to rsw): ${e}`);
        }
    }

    let copied = 0, missing = 0;
    for (let i = 0; i < WATER_FRAME_COUNT; i++) {
        const nn = i.toString().padStart(2, "0");
        const file = `water${waterType}${nn}.jpg`;
        if (writeGrfEntry(grfs, `data\\texture\\${WATER_DIR}\\${file}`, OUT_TEXTURE_DIR, `${WATER_DIR}\\${file}`))
            copied++;
        else
            missing++;
    }
    console.log(`  water: type ${waterType}, ${copied}/${WATER_FRAME_COUNT} frames copied (${missing} missing)`);
}

interface FogEntry { start: number; end: number; color: string; density: number; }
function parseFogTable(grf: Grf): Map<string, FogEntry> {
    const out = new Map<string, FogEntry>();
    const buf = grf.read("data\\fogparametertable.txt");
    if (buf === null) return out;

    const text = buf.toString("latin1");
    const tokens = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).map((l) => l.replace(/#$/, ""));

    for (let i = 0; i + 4 < tokens.length + 1 && i + 4 <= tokens.length; i += 5) {
        const key = tokens[i];
        const start = parseFloat(tokens[i + 1]);
        const end = parseFloat(tokens[i + 2]);
        const color = tokens[i + 3];
        const density = parseFloat(tokens[i + 4]);
        if (key !== undefined && key.endsWith(".rsw"))
            out.set(key.toLowerCase(), { start, end, color, density });
    }
    return out;
}

function extractFog(mapName: string, table: Map<string, FogEntry>): void {
    const entry = table.get(`${mapName}.rsw`.toLowerCase());
    if (entry === undefined) {
        console.log(`  fog: no entry for ${mapName}`);
        return;
    }
    const dst = path.join(OUT_MAPS_DIR, `${mapName.toLowerCase()}.fog.json`);
    writeFileSync(dst, JSON.stringify(entry));
    console.log(`  fog: start=${entry.start} end=${entry.end} color=${entry.color} density=${entry.density}`);
}

function extractSprite(grf: Grf, name: string): void {
    const grfRel = name.replace(/\//g, "\\");
    let copied = 0;
    for (const ext of [".spr", ".act"]) {
        const grfPath = `data\\sprite\\${grfRel}${ext}`;
        const buf = grf.read(grfPath);
        if (buf === null) {
            console.warn(`  skip (missing sprite): ${grfPath}`);
            continue;
        }
        const dst = path.join(OUT_SPRITE_DIR, ...name.split("/")) + ext;
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, buf);
        copied++;
    }
    console.log(`  sprite ${name}: ${copied}/2 files copied`);
}

function extractEffectTexture(grf: Grf, name: string): void {
    const texOutDir = path.join(OUT_EFFECT_DIR, "textures");
    mkdirSync(texOutDir, { recursive: true });
    const buf = grf.read(`data\\texture\\effect\\${name}`);
    if (buf === null) {
        console.warn(`  skip (missing effect texture): ${name}`);
        return;
    }
    writeFileSync(path.join(texOutDir, name), buf);
    console.log(`  effect texture ${name}: copied`);
}

function extractEffect(grf: Grf, strName: string): void {
    const strBuf = grf.read(`data\\texture\\effect\\${strName}`);
    if (strBuf === null) {
        console.warn(`  skip (missing effect): ${strName}`);
        return;
    }
    const effect = parseSTR(toSlice(strBuf));

    const strDst = path.join(OUT_EFFECT_DIR, strName);
    mkdirSync(path.dirname(strDst), { recursive: true });
    writeFileSync(strDst, strBuf);

    const texOutDir = path.join(OUT_EFFECT_DIR, "textures");
    mkdirSync(texOutDir, { recursive: true });
    const seen = new Set<string>();
    let texCopied = 0, texMissing = 0;
    for (const layer of effect.layers) {
        for (const rawName of layer.texNames) {
            if (rawName === "")
                continue;
            const name = rawName.includes(".") ? rawName : `${rawName}.bmp`;
            if (seen.has(name))
                continue;
            seen.add(name);
            const buf = grf.read(`data\\texture\\effect\\${name}`);
            if (buf === null) {
                texMissing++;
                continue;
            }
            writeFileSync(path.join(texOutDir, name), buf);
            texCopied++;
        }
    }
    console.log(`  effect ${strName}: ${effect.layers.length} layers, ${texCopied} textures copied (${texMissing} missing)`);
}

function enumerateMapIds(grf: Grf, mapIdFilter: string[]): string[] {
    if (mapIdFilter.length > 0)
        return mapIdFilter.map((s) => s.toLowerCase());
    const ids = new Set<string>();
    for (const key of grf.files.keys()) {
        const m = /^data\\([^\\]+)\.rsw$/i.exec(key);
        if (m !== null) {
            const id = m[1].toLowerCase();
            if (modernMapIsRenderable(grf, id))
                ids.add(id);
        }
    }
    for (const id of LEGACY_ONLY_MAPS)
        if (legacyMapIsRenderable(id))
            ids.add(id);
    for (const id of CLASSIC_MAPS)
        if (modernMapIsRenderable(grf, id) && legacyMapIsRenderable(id))
            ids.add(`${id}@classic`);
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

const legacyGrfCache = new Map<string, Grf | null>();
function openLegacyGrfs(): Grf[] {
    const out: Grf[] = [];
    for (const p of legacyGrfPaths()) {
        let g = legacyGrfCache.get(p);
        if (g === undefined) {

            try { g = new Grf(p); }
            catch (e) { console.warn(`  skip legacy GRF ${path.basename(p)}: ${(e as Error).message}`); g = null; }
            legacyGrfCache.set(p, g);
        }
        if (g !== null) out.push(g);
    }
    return out;
}
function legacyGrfHas(filename: string): boolean {
    return openLegacyGrfs().some((g) => g.has(filename));
}
function modernMapIsRenderable(grf: Grf, mapId: string): boolean {
    return grf.has(`data\\${mapId}.rsw`) && grf.has(`data\\${mapId}.gnd`);
}
function legacyMapIsRenderable(mapId: string): boolean {
    return legacyGrfHas(`data\\${mapId}.rsw`) && legacyGrfHas(`data\\${mapId}.gnd`);
}
function readMapFile(grf: Grf, mapId: string, ext: string): Buffer | null {
    const classicMatch = /^(.+)@classic$/i.exec(mapId);
    const isLegacy = classicMatch !== null || LEGACY_ONLY_MAPS.has(mapId);
    if (!isLegacy)
        return grf.read(`data\\${mapId}${ext}`);
    const baseId = classicMatch !== null ? classicMatch[1] : mapId;
    for (const lg of openLegacyGrfs()) {
        const buf = lg.read(`data\\${baseId}${ext}`);
        if (buf !== null) return buf;
    }
    return null;
}

function runExtract(mapIdFilter: string[]): void {
    const grf = openGrf();

    mkdirSync(OUT_MAPS_DIR, { recursive: true });

    const copied = new Set<string>();
    const missing = new Set<string>();

    const fogTable = parseFogTable(grf);

    for (const mapId of enumerateMapIds(grf, mapIdFilter)) {
        console.log(`\n${mapId}:`);
        const isLegacy = /@classic$/i.test(mapId) || LEGACY_ONLY_MAPS.has(mapId);
        const assetGrfs: Grf[] = isLegacy ? [grf, ...openLegacyGrfs()] : [grf];
        const buffers: Record<string, Buffer | null> = {};
        for (const ext of MAP_EXTENSIONS) {
            const buf = readMapFile(grf, mapId, ext);
            buffers[ext] = buf;
            if (buf === null) {
                console.warn(`  skip (missing): ${mapId}${ext}`);
                continue;
            }
            const dst = path.join(OUT_MAPS_DIR, `${mapId}${ext}`);
            writeFileSync(dst, buf);
        }
        if (buffers[".gnd"] !== null)
            extractTextures(assetGrfs, buffers[".gnd"]!, copied, missing);
        if (buffers[".rsw"] !== null) {
            extractModels(assetGrfs, buffers[".rsw"]!, copied, missing);
            extractWater(assetGrfs, buffers[".rsw"]!, buffers[".gnd"]);
        }
        extractFog(mapId, fogTable);
    }

    for (const sprite of SPRITES_TO_EXTRACT)
        extractSprite(grf, sprite);

    for (const effect of EFFECTS_TO_EXTRACT)
        extractEffect(grf, effect);

    for (const tex of EFFECT_TEXTURES_TO_EXTRACT)
        extractEffectTexture(grf, tex);

    grf.close();

    extractGrannyModels();

    console.log(`\nDone. ${copied.size} textures copied, ${missing.size} textures missing.`);
}

const LUA_BIN = path.resolve("data/RagnarokOnline_raw/bin/lua-5.1-iro");
const DUMP_LUA = path.resolve("src/RagnarokOnline/tools/dump-emitters.lua");

const LUB_ROOT = path.resolve("data/RagnarokOnline_raw/iro_effecttool");

const EFFECT_TEX_OUT = path.resolve("data/RagnarokOnline/textures/effect");

function loadMapIds(): Set<string> {
    const mapsTs = path.resolve("src/RagnarokOnline/maps.ts");
    if (!existsSync(mapsTs))
        return new Set();
    const text = readFileSync(mapsTs, "utf8");
    const ids = new Set<string>();
    for (const m of text.matchAll(/\bid:\s*["']([a-z0-9_@\-]+)["']/gi)) {
        const id = m[1].toLowerCase();
        ids.add(id);
    }
    return ids;
}

function stripClassicSuffix(id: string): string {
    const suffix = "@classic";
    return id.endsWith(suffix) ? id.slice(0, -suffix.length) : id;
}

function eraForManifest(manifestId: string): "classic" | "renewal" {
    return manifestId.endsWith("@classic") ? "classic" : "renewal";
}

function resolveWarpDestForSceneIds(rawDest: string, targetEra: "classic" | "renewal", classicGeometryBases: Set<string>): string {
    const dest = stripClassicSuffix(rawDest.trim().toLowerCase());
    return targetEra === "classic" && classicGeometryBases.has(dest) ? `${dest}@classic` : dest;
}

interface EmitterSpec {
    pos: [number, number, number];
    radius: [number, number, number];
    dir1: [number, number, number];
    dir2: [number, number, number];
    gravity: [number, number, number];
    color: [number, number, number, number];
    rate: [number, number];
    size: [number, number];
    life: [number, number];
    speed: [number];
    srcmode: [number];
    destmode: [number];
    maxcount: [number];
    zenable: [number];
    texture: string;
}

interface RawEmitterDump {
    version?: number;
    emitters: Partial<EmitterSpec>[] | null;
}

function withDefaults(e: Partial<EmitterSpec>): EmitterSpec {
    const v3 = (x: any, d: [number, number, number] = [0, 0, 0]): [number, number, number] =>
        (Array.isArray(x) && x.length >= 3) ? [Number(x[0]) || 0, Number(x[1]) || 0, Number(x[2]) || 0] : d;
    const v4 = (x: any, d: [number, number, number, number] = [255, 255, 255, 255]): [number, number, number, number] =>
        (Array.isArray(x) && x.length >= 4) ? [Number(x[0]) || 0, Number(x[1]) || 0, Number(x[2]) || 0, Number(x[3]) || 0] : d;
    const v2 = (x: any, d: [number, number] = [1, 1]): [number, number] =>
        (Array.isArray(x) && x.length >= 2) ? [Number(x[0]) || 0, Number(x[1]) || 0] : (Array.isArray(x) && x.length === 1) ? [Number(x[0]) || 0, Number(x[0]) || 0] : d;
    const v1 = (x: any, d: [number] = [1]): [number] =>
        (Array.isArray(x) && x.length >= 1) ? [Number(x[0]) || 0] : d;
    return {
        pos: v3(e.pos),
        radius: v3(e.radius),
        dir1: v3(e.dir1),
        dir2: v3(e.dir2),
        gravity: v3(e.gravity),
        color: v4(e.color),
        rate: v2(e.rate, [1, 1]),
        size: v2(e.size, [1, 1]),
        life: v2(e.life, [1, 1]),
        speed: v1(e.speed, [0]),
        srcmode: v1(e.srcmode, [5]),
        destmode: v1(e.destmode, [6]),
        maxcount: v1(e.maxcount, [1]),
        zenable: v1(e.zenable, [1]),
        texture: typeof e.texture === "string" ? e.texture : "",
    };
}

function findLubFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const ent of readdirSync(dir)) {
            const p = path.join(dir, ent);
            const st = statSync(p);
            if (st.isDirectory()) {
                walk(p);
                continue;
            }
            if (!/\b(effecttool)\b/i.test(p))
                continue;
            if (/\.(lub|lua)$/i.test(p))
                out.push(p);
        }
    };
    walk(root);
    return out;
}

function dumpOne(file: string): RawEmitterDump | null {
    try {
        const out = execFileSync(LUA_BIN, [DUMP_LUA, file], { encoding: "utf8", timeout: 5000 }).trim();
        if (out === "null" || out === "")
            return null;
        return JSON.parse(out) as RawEmitterDump;
    } catch {
        return null;
    }
}

function runExtractEmitters(): void {
    if (!existsSync(LUA_BIN)) {
        console.error(`missing patched lua binary: ${LUA_BIN}`);
        console.error(`(see the lua-5.1-iro section of the header comment at the top of this file for the build steps)`);
        throw new Error("stage aborted");
    }
    if (!existsSync(DUMP_LUA)) {
        console.error(`missing dump script: ${DUMP_LUA}`);
        throw new Error("stage aborted");
    }
    if (!existsSync(LUB_ROOT)) {
        console.error(`missing LUB tree: ${LUB_ROOT}`);
        throw new Error("stage aborted");
    }
    if (!existsSync(OUT_MAPS_DIR)) {
        console.error(`missing maps dir: ${OUT_MAPS_DIR}`);
        throw new Error("stage aborted");
    }

    const knownIds = loadMapIds();
    console.log(`maps.ts: ${knownIds.size} known map ids`);

    mkdirSync(EFFECT_TEX_OUT, { recursive: true });

    const lubs = findLubFiles(LUB_ROOT);
    console.log(`found ${lubs.length} effecttool LUB/LUA files`);

    const byId = new Map<string, string>();
    const conflicts: string[] = [];
    for (const file of lubs) {
        const base = path.basename(file).replace(/\.(lub|lua)$/i, "");
        const id = base.toLowerCase();
        const prev = byId.get(id);
        if (prev === undefined) {
            byId.set(id, file);
            continue;
        }
        const prevIsLub = /\.lub$/i.test(prev);
        const curIsLub = /\.lub$/i.test(file);
        if (prevIsLub && !curIsLub) { conflicts.push(`${id}: keeping ${prev} over ${file}`); continue; }
        if (!prevIsLub && curIsLub) { byId.set(id, file); conflicts.push(`${id}: keeping ${file} over ${prev}`); continue; }
        conflicts.push(`${id}: duplicate (${prev} and ${file}); keeping first`);
    }
    if (conflicts.length > 0)
        console.warn(`emitter file conflicts (${conflicts.length}):\n  ${conflicts.join("\n  ")}`);

    const referencedTextures = new Set<string>();

    let wrote = 0, skipped = 0, badId = 0, badParse = 0;
    for (const file of byId.values()) {
        const base = path.basename(file).replace(/\.(lub|lua)$/i, "");
        const id = base.toLowerCase();

        if (!knownIds.has(id)) {
            badId++;
            continue;
        }

        const raw = dumpOne(file);
        if (raw === null || raw.emitters === null || raw.emitters === undefined) {
            badParse++;
            continue;
        }

        const arr: Partial<EmitterSpec>[] = Array.isArray(raw.emitters)
            ? raw.emitters
            : Object.values(raw.emitters);
        if (arr.length === 0) {
            badParse++;
            continue;
        }

        const emitters = arr.map(withDefaults).filter((e) => e.texture !== "");

        if (emitters.length === 0) {
            skipped++;
            continue;
        }

        for (const e of emitters) {
            const name = e.texture.replace(/\\/g, "/").split("/").pop()!;
            referencedTextures.add(name);
        }

        const outPath = path.join(OUT_MAPS_DIR, `${id}.emitters.json`);
        const json = { version: raw.version ?? 1, emitters };
        writeFileSync(outPath, JSON.stringify(json));
        wrote++;
    }

    console.log(`wrote ${wrote}, skipped(empty)=${skipped}, skipped(notMap)=${badId}, parseFail=${badParse}`);

    const grf = openGrf();
    let texCopied = 0, texMissing = 0;
    for (const name of referencedTextures) {
        const buf = grf.read(`data\\texture\\effect\\${name}`);
        if (buf === null) {
            texMissing++;
            continue;
        }
        writeFileSync(path.join(EFFECT_TEX_OUT, name), buf);
        texCopied++;
    }
    grf.close();
    console.log(`textures: copied ${texCopied}, missing ${texMissing} of ${referencedTextures.size}`);
}

const HERCULES = path.resolve("../Hercules");

const MOB_DBS = [
    path.join(HERCULES, "db/pre-re/mob_db.conf"),
    path.join(HERCULES, "db/re/mob_db.conf"),
];

const MONSTER_DIR = "몬스터";
const NPC_SPRITE_DIR = "npc";

const OUT_ENTITIES = path.resolve("data/RagnarokOnline/entities");

interface MobEntry {
    id: number;
    sprite: string;
    name: string;
    count: number;
    cellX: number; cellY: number;
    spanX: number; spanY: number;
    speed: number;
    canMove: boolean;
}

interface NpcEntry {
    sprite: string;
    cellX: number; cellY: number; dir: number;
    name: string;
}

interface WarpEntry {
    cellX: number; cellY: number;
    spanX: number; spanY: number;
    dest: string;
    destX: number; destY: number;

    destEra?: "classic" | "renewal";
}

interface Manifest {
    mobs: MobEntry[];
    npcs: NpcEntry[];
    warps: WarpEntry[];
}

const DEFAULT_MOVE_SPEED = 150;
interface MobDbEntry { sprite: string; speed: number; canMove: boolean; }

function parseMobDb(): Map<number, MobDbEntry> {
    const out = new Map<number, MobDbEntry>();
    for (const dbPath of MOB_DBS) {
        if (!existsSync(dbPath))
            continue;
        const text = readFileSync(dbPath, "utf8");
        let curId = -1, curSprite = "", curSpeed = DEFAULT_MOVE_SPEED, curCanMove = false;
        let inMode = false;
        const commit = (): void => {
            if (curId >= 0 && curSprite !== "")
                out.set(curId, { sprite: curSprite, speed: curSpeed, canMove: curCanMove });
            curId = -1; curSprite = ""; curSpeed = DEFAULT_MOVE_SPEED; curCanMove = false; inMode = false;
        };
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            const idM = /^Id:\s*(\d+)\b/.exec(line);
            if (idM !== null) { commit(); curId = parseInt(idM[1], 10); continue; }
            if (curId < 0)
                continue;
            if (/^Mode:\s*\{/.test(line)) { inMode = true; continue; }
            if (inMode) {
                if (line.includes("}")) { inMode = false; continue; }
                if (/^CanMove:\s*true\b/.test(line)) curCanMove = true;
                continue;
            }
            const spM = /^SpriteName:\s*"([^"]+)"/.exec(line);
            if (spM !== null) { curSprite = spM[1]; continue; }
            const msM = /^MoveSpeed:\s*(\d+)\b/.exec(line);
            if (msM !== null) { curSpeed = parseInt(msM[1], 10); continue; }
        }
        commit();
    }
    return out;
}

function mobSpriteRel(spriteName: string): string {
    return `${MONSTER_DIR}/${spriteName.toLowerCase()}`;
}

const INVISIBLE_NPC_SPRITES = new Set(["HIDDEN_NPC", "FAKE_NPC", "INVISIBLE_NPC", "HIDDEN_WARP_NPC", "WARPNPC", "CLEAR_NPC"]);

function npcSpriteRel(spriteToken: string): string | null {
    if (INVISIBLE_NPC_SPRITES.has(spriteToken.toUpperCase()))
        return null;

    if (/^-?\d+$/.test(spriteToken))
        return null;
    return `${NPC_SPRITE_DIR}/${spriteToken.toLowerCase()}`;
}

function spriteExistsInGrf(grf: Grf, rel: string): boolean {
    return grf.has(`data\\sprite\\${rel.replace(/\//g, "\\")}.spr`);
}

function quotedTokens(line: string): string[] {
    const noComment = line.replace(/\/\/.*$/, "");
    const out: string[] = [];
    const re = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComment)) !== null)
        out.push(m[1]);
    return out;
}

function stripBlockComments(src: string): string {
    let out = "";
    let i = 0, inStr = false, inCom = false;
    while (i < src.length) {
        const c = src[i];
        if (inCom) {
            if (c === "*" && src[i + 1] === "/") { inCom = false; i += 2; continue; }
            if (c === "\n") out += "\n";
            i++;
            continue;
        }
        if (inStr) {
            out += c;
            if (c === "\\" && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
            if (c === '"') inStr = false;
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") { inCom = true; i += 2; continue; }
        if (c === '"') { inStr = true; out += c; i++; continue; }
        out += c;
        i++;
    }
    return out;
}

function parseScriptConf(confRel: string, scripts: Set<string>, removed: Set<string>, seen: Set<string>): void {
    if (seen.has(confRel))
        return;
    seen.add(confRel);

    const confPath = path.join(HERCULES, confRel);
    if (!existsSync(confPath)) {
        console.warn(`  conf include missing: ${confRel}`);
        return;
    }

    let inRemoved = false;

    const text = stripBlockComments(readFileSync(confPath, "utf8"));
    for (const raw of text.split(/\r?\n/)) {
        const noComment = raw.replace(/\/\/.*$/, "");

        if (/\bnpc_removed_list\s*:/.test(noComment)) inRemoved = true;
        else if (inRemoved && noComment.includes(")")) inRemoved = false;

        const includeM = /@include\s+"([^"]+)"/.exec(noComment);
        if (includeM !== null) {
            parseScriptConf(includeM[1], scripts, removed, seen);
            continue;
        }

        for (const tok of quotedTokens(raw)) {
            if (!tok.endsWith(".txt"))
                continue;
            if (inRemoved) removed.add(tok);
            else scripts.add(tok);
        }
    }
}

const PRE_RE_ROOT_CONF = "npc/pre-re/scripts_main.conf";
const RE_ROOT_CONF = "npc/re/scripts_main.conf";

function collectScriptFiles(rootConf: string): string[] {
    const scripts = new Set<string>();
    const removed = new Set<string>();
    parseScriptConf(rootConf, scripts, removed, new Set<string>());

    const out: string[] = [];
    for (const rel of scripts) {
        if (removed.has(rel))
            continue;
        const full = path.join(HERCULES, rel);
        if (!existsSync(full)) {
            console.warn(`  listed script missing: ${rel}`);
            continue;
        }
        out.push(full);
    }
    return out;
}

function visibleName(name: string): string {
    let s = name;
    const colons = s.indexOf("::");
    if (colons >= 0) s = s.slice(0, colons);
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    return s.trim();
}

interface Line { coords: string[]; fields: string[]; }
function splitLine(raw: string): Line | null {
    const lead = raw.trimStart();
    if (lead.startsWith("//"))
        return null;
    const fields = raw.split("\t");
    if (fields.length < 2)
        return null;
    const coords = fields[0].split(",");
    return { coords, fields };
}

type EntryEra = "pre-re" | "re" | "shared";

interface ScanResult {
    mobs: { name: string; cellX: number; cellY: number; spanX: number; spanY: number; mobId: number; count: number; era: EntryEra }[];
    npcs: { spriteToken: string; cellX: number; cellY: number; dir: number; name: string; era: EntryEra }[];
    warps: (WarpEntry & { era: EntryEra })[];
}

function scanScriptedSpawns(text: string, mobIdByName: Map<string, number>):
    { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] {
    const out: { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] = [];

    const re = /\bmonster\s*[\(\s]\s*"([^"]+)"\s*,\s*([^,]+),\s*([^,]+),\s*(?:_\s*\(\s*)?"([^"]*)"\s*\)?\s*,\s*([A-Z_][A-Z0-9_]*|-?\d+)\s*,\s*([^,;)\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const mapId = m[1].trim();
        const xRaw = m[2].trim(), yRaw = m[3].trim();
        const nameLit = m[4].trim();
        const mobTok = m[5].trim();
        const countRaw = m[6].trim();
        const x = parseInt(xRaw, 10), y = parseInt(yRaw, 10), count = parseInt(countRaw, 10);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(count)) continue;
        let mobId: number;
        if (/^-?\d+$/.test(mobTok)) {
            mobId = parseInt(mobTok, 10);
        } else {
            const lookup = mobIdByName.get(mobTok.toUpperCase());
            if (lookup === undefined) continue;
            mobId = lookup;
        }
        out.push({ mapId, x, y, name: nameLit, mobId, count });
    }
    return out;
}

function scanAllScripts(files: { file: string, era: EntryEra }[], mobIdByName: Map<string, number>): Map<string, ScanResult> {
    const byMap = new Map<string, ScanResult>();
    const NPC_TYPES = new Set(["script", "shop", "cashshop", "pointshop", "marketshop", "trader"]);
    const bucket = (id: string): ScanResult => {
        let r = byMap.get(id);
        if (r === undefined) { r = { mobs: [], npcs: [], warps: [] }; byMap.set(id, r); }
        return r;
    };

    for (const { file, era } of files) {

        const text = stripBlockComments(readFileSync(file, "utf8"));
        for (const { mapId, x, y, name, mobId, count } of scanScriptedSpawns(text, mobIdByName)) {
            const res = bucket(mapId);
            res.mobs.push({ name, cellX: x, cellY: y, spanX: 0, spanY: 0, mobId, count, era });
        }
        for (const raw of text.split(/\r?\n/)) {
            const line = splitLine(raw);
            if (line === null)
                continue;
            const { coords, fields } = line;
            const mapId = coords[0];
            if (!mapId || fields.length < 2)
                continue;
            const res = bucket(mapId);

            const type = fields[1].trim();

            if (type === "monster" || type === "boss_monster") {

                const x = +coords[1], y = +coords[2], xs = +coords[3], ys = +coords[4];
                const args = (fields[3] ?? "").split(",");
                const mobId = parseInt(args[0], 10);
                const count = parseInt(args[1] ?? "1", 10);
                if (!Number.isFinite(mobId)) continue;
                res.mobs.push({ name: fields[2].trim(), cellX: x, cellY: y, spanX: xs, spanY: ys, mobId, count, era });
                continue;
            }

            if (type === "warp") {

                const x = +coords[1], y = +coords[2];
                const args = (fields[3] ?? "").split(",");
                const xs = parseInt(args[0], 10), ys = parseInt(args[1], 10);
                const dest = args[2] ?? "";
                if (dest === "") continue;
                const dx = parseInt(args[3], 10), dy = parseInt(args[4], 10);
                res.warps.push({
                    cellX: x, cellY: y, spanX: xs, spanY: ys, dest,
                    destX: Number.isFinite(dx) ? dx : 0,
                    destY: Number.isFinite(dy) ? dy : 0,
                    era,
                });
                continue;
            }

            const isDuplicate = type.startsWith("duplicate(");
            if (NPC_TYPES.has(type) || isDuplicate) {
                const x = +coords[1], y = +coords[2], dir = +coords[3];
                const args = (fields[3] ?? "").split(",");
                const spriteToken = (args[0] ?? "").replace(/[{].*$/, "").trim();
                if (spriteToken === "") continue;
                res.npcs.push({ spriteToken, cellX: x, cellY: y, dir, name: visibleName(fields[2]), era });
                continue;
            }
        }
    }
    return byMap;
}

function filterByEra(scan: ScanResult, allowed: EntryEra[], destEra: "classic" | "renewal"): ScanResult {
    const ok = (e: { era: EntryEra }): boolean => allowed.includes(e.era);
    return {
        mobs: scan.mobs.filter(ok),
        npcs: scan.npcs.filter(ok),
        warps: scan.warps.filter(ok).map((w) => ({
            ...w,
            destEra: w.era === "shared" ? undefined : destEra,
        })),
    };
}

function hasContent(scan: ScanResult): boolean {
    return scan.mobs.length > 0 || scan.npcs.length > 0 || scan.warps.length > 0;
}

function isEraDivergent(scan: ScanResult): boolean {
    const eraSpecific = (e: { era: EntryEra }): boolean => e.era !== "shared";
    return scan.mobs.some(eraSpecific) || scan.npcs.some(eraSpecific) || scan.warps.some(eraSpecific);
}

function emitManifests(mapId: string, scan: ScanResult): { name: string, scan: ScanResult }[] {
    if (isEraDivergent(scan)) {
        const out: { name: string, scan: ScanResult }[] = [];
        const classic = filterByEra(scan, ["pre-re", "shared"], "classic");
        const renewal = filterByEra(scan, ["re", "shared"], "renewal");
        if (hasContent(classic))
            out.push({ name: `${mapId}@classic`, scan: classic });
        if (hasContent(renewal)) {
            out.push({ name: `${mapId}@renewal`, scan: renewal });
            out.push({ name: mapId, scan: renewal });
        } else if (hasContent(classic)) {

            out.push({ name: mapId, scan: classic });
        }
        return out;
    }
    const bare = filterByEra(scan, ["pre-re", "re", "shared"], "renewal");
    return hasContent(bare) ? [{ name: mapId, scan: bare }] : [];
}

function stageSprite(grf: Grf, rel: string, copied: Set<string>): void {
    if (copied.has(rel)) return;
    const segs = rel.split("/");
    const grfRel = rel.replace(/\//g, "\\");
    for (const ext of [".spr", ".act"]) {
        const buf = grf.read(`data\\sprite\\${grfRel}${ext}`);
        if (buf === null) continue;
        const dst = path.join(OUT_SPRITE_DIR, ...segs) + ext;
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, buf);
    }
    copied.add(rel);
}

function runExtractEntities(): void {
    if (!existsSync(HERCULES)) { console.error(`Hercules not found: ${HERCULES}`); throw new Error("stage aborted"); }
    const grf = openGrf();

    mkdirSync(OUT_ENTITIES, { recursive: true });

    const mobDb = parseMobDb();
    console.log(`mob_db: ${mobDb.size} mobs loaded`);
    for (const [id, label] of [[1002, "Poring"], [1008, "Pupa"], [1063, "Lunatic"], [1113, "Drops"]] as [number, string][]) {
        const e = mobDb.get(id);
        if (e !== undefined)
            console.log(`  ${label} (${id}): CanMove=${e.canMove} speed=${e.speed}`);
    }

    const mobIdByName = new Map<string, number>();
    for (const [id, e] of mobDb)
        mobIdByName.set(e.sprite.toUpperCase(), id);

    const preReFiles = collectScriptFiles(PRE_RE_ROOT_CONF);
    const reFiles = collectScriptFiles(RE_ROOT_CONF);
    const preSet = new Set(preReFiles);
    const reSet = new Set(reFiles);
    const filesWithEra: { file: string, era: EntryEra }[] = [];
    let preReOnlyFiles = 0, reOnlyFiles = 0, sharedFiles = 0;
    for (const file of new Set([...preReFiles, ...reFiles])) {
        const inPre = preSet.has(file), inRe = reSet.has(file);
        const era: EntryEra = (inPre && inRe) ? "shared" : (inPre ? "pre-re" : "re");
        if (era === "shared") sharedFiles++;
        else if (era === "pre-re") preReOnlyFiles++;
        else reOnlyFiles++;
        filesWithEra.push({ file, era });
    }
    console.log(`scripts: ${filesWithEra.length} files (${sharedFiles} shared, ${preReOnlyFiles} pre-re-only, ${reOnlyFiles} re-only)`);

    const stagedSprites = new Set<string>();

    const EVENT_NAME = /\b(demo|popup|test)\b|event/i;
    const byMap = scanAllScripts(filesWithEra, mobIdByName);
    console.log(`scanned ${byMap.size} maps with script entries\n`);

    const sceneIds = loadMapIds();
    if (sceneIds.size === 0) {
        console.error(`maps.ts has no scene ids; run gen-maps before extract-entities`);
        throw new Error("stage aborted");
    }
    const classicGeometryBases = new Set(
        Array.from(sceneIds)
            .filter((id) => id.endsWith("@classic"))
            .map((id) => stripClassicSuffix(id)),
    );
    console.log(`scene registry: ${sceneIds.size} maps (${classicGeometryBases.size} classic geometry variants)`);

    const writtenManifests = new Set<string>();

    let mapsWritten = 0, totalNpcs = 0, totalMobInstances = 0, totalWarps = 0, eraVariantsWritten = 0;
    let removedDeadWarps = 0;
    const removedDeadWarpDests = new Map<string, number>();
    for (const [mapId, scan] of byMap) {
        for (const { name: manifestId, scan: filteredScan } of emitManifests(mapId, scan)) {

            const mobs: MobEntry[] = [];
            let totalMonsters = 0;
            for (const m of filteredScan.mobs) {
                const dbEntry = mobDb.get(m.mobId);
                if (dbEntry === undefined) continue;
                const rel = mobSpriteRel(dbEntry.sprite);
                if (!spriteExistsInGrf(grf, rel)) continue;
                stageSprite(grf, rel, stagedSprites);
                mobs.push({ id: m.mobId, sprite: rel, name: m.name, count: m.count, cellX: m.cellX, cellY: m.cellY, spanX: m.spanX, spanY: m.spanY, speed: dbEntry.speed, canMove: dbEntry.canMove });
                totalMonsters += m.count;
            }

            const npcs: NpcEntry[] = [];
            const cellTaken = new Set<string>();
            for (const n of filteredScan.npcs) {
                if (EVENT_NAME.test(n.name)) continue;
                const cellKey = `${n.cellX},${n.cellY}`;
                if (cellTaken.has(cellKey)) continue;
                const rel = npcSpriteRel(n.spriteToken);
                if (rel === null) continue;
                if (!spriteExistsInGrf(grf, rel)) continue;
                stageSprite(grf, rel, stagedSprites);
                cellTaken.add(cellKey);
                npcs.push({ sprite: rel, cellX: n.cellX, cellY: n.cellY, dir: n.dir, name: n.name });
            }

            const warps: WarpEntry[] = [];
            for (const w of filteredScan.warps) {
                const targetEra = w.destEra ?? eraForManifest(manifestId);
                const resolvedDest = resolveWarpDestForSceneIds(w.dest, targetEra, classicGeometryBases);
                if (!sceneIds.has(resolvedDest)) {
                    removedDeadWarps++;
                    removedDeadWarpDests.set(resolvedDest, (removedDeadWarpDests.get(resolvedDest) ?? 0) + 1);
                    continue;
                }
                warps.push({
                    cellX: w.cellX, cellY: w.cellY, spanX: w.spanX, spanY: w.spanY,
                    dest: w.dest, destX: w.destX, destY: w.destY,
                    destEra: w.destEra,
                });
            }

            if (mobs.length === 0 && npcs.length === 0 && warps.length === 0)
                continue;

            const fileName = `${manifestId}.json`;
            writeFileSync(path.join(OUT_ENTITIES, fileName), JSON.stringify({ mobs, npcs, warps } as Manifest, null, 1));
            writtenManifests.add(fileName);
            mapsWritten++;
            if (manifestId.includes("@")) eraVariantsWritten++;
            totalNpcs += npcs.length;
            totalMobInstances += totalMonsters;
            totalWarps += warps.length;
        }
    }

    grf.close();

    let stale = 0;
    for (const f of readdirSync(OUT_ENTITIES)) {
        if (!f.endsWith(".json")) continue;
        if (writtenManifests.has(f)) continue;
        unlinkSync(path.join(OUT_ENTITIES, f));
        stale++;
    }
    if (stale > 0)
        console.log(`removed ${stale} stale manifest(s) from a previous run.`);

    console.log(`${mapsWritten} map manifests written (${totalNpcs} NPCs, ${totalMobInstances} monster instances, ${totalWarps} warps).`);
    if (removedDeadWarps > 0) {
        const topDests = Array.from(removedDeadWarpDests.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 20)
            .map(([dest, count]) => `${dest}=${count}`)
            .join(", ");
        console.log(`removed ${removedDeadWarps} warp(s) to ${removedDeadWarpDests.size} unavailable destination map(s): ${topDests}`);
    }

    console.log(`\n${stagedSprites.size} unique sprite (.spr/.act) pairs staged into ${OUT_SPRITE_DIR}`);
}

const TOWNS = new Set([
    "prontera", "geffen", "payon", "morocc", "alberta", "izlude", "aldebaran", "comodo",
    "umbala", "niflheim", "amatsu", "gonryun", "ayothaya", "louyang", "jawaii", "einbroch",
    "einbech", "lighthalzen", "hugel", "rachel", "veins", "yuno", "xmas", "moscovia",
    "brasilis", "dewata", "malangdo", "malaya", "eclage", "mora", "manuk", "splendide",
    "dicastes01", "mid_camp", "prt_fild08", "new_1-1", "new_zone01", "prt_monk",
]);

const NAMED_DUNGEON_RE = /^(gl_|abyss|abbey|juperos|jupe_|gefenia|cave\b|izlu2dun|anthell|in_sphinx|in_orcs|in_rogue|orcsdun|c_tower|tha_t|thana|treasure|kh_|ra_san|thor_v|moc_pryd|prt_sew|prt_maze|spl_in|ecl_tdun|1@|2@)/;

function classifyMap(id: string): MapCategory {
    id = id.replace(/@classic$/, "");
    if (/_cas\d|g_cas/.test(id) || id.startsWith("nguild_") || /_gld\b|gld_/.test(id)) return "castle";
    if (/^\d+@/.test(id)) return "dungeon";
    if (/^que_|^job_|^force_|^pvp_|^gvg|^arena|^ordeal|^poring_w|^guild_vs|^bat_|^job3|^turbo_|^sec_|^prt_are|auction/.test(id)) return "instance";
    if (/_fild\d|_field/.test(id)) return "field";
    if (/_dun/.test(id) || NAMED_DUNGEON_RE.test(id)) return "dungeon";
    if (/_in\d|^in_|_in$|_room|_indoor/.test(id)) return "indoor";
    if (TOWNS.has(id) || (/^(prt|gef|pay|moc|alde|cmd|um|nif|ama|gon|ayo|lou|ein|lhz|yuno|ra|ve|bra|dew|mal|izlude|glast|hu|mosk|dic|ecl|man|teak|tur|alb|pay)_/.test(id) && !/_dun|_fild|_in/.test(id))) return "city";
    return "other";
}

const OUT = path.resolve("src/RagnarokOnline/maps.ts");

function parseMapNameTable(buf: Buffer): Map<string, string> {
    const out = new Map<string, string>();
    const text = new TextDecoder("euc-kr").decode(buf);
    for (const raw of text.split(/\r?\n/)) {
        const s = raw.trim();
        if (s.length === 0 || s.startsWith("//"))
            continue;
        const m = /^([A-Za-z0-9_@\-]+)\.rsw#([^#]*)#?/i.exec(s);
        if (m === null)
            continue;
        const id = m[1].toLowerCase();
        const name = m[2].trim();
        if (name.length > 0)
            out.set(id, name);
    }
    return out;
}

function runGenMaps(): void {
    const grf = openGrf();
    const iroBuf = grf.read("data\\mapnametable.txt") ?? Buffer.alloc(0);
    const iro = parseMapNameTable(iroBuf);
    console.log(`iRO names: ${iro.size}`);

    const bareIds = new Set<string>();
    for (const key of grf.files.keys()) {
        const m = /^data\\([^\\]+)\.rsw$/i.exec(key);
        if (m !== null) {
            const id = m[1].toLowerCase();
            if (modernMapIsRenderable(grf, id))
                bareIds.add(id);
        }
    }
    grf.close();
    for (const id of LEGACY_ONLY_MAPS)
        if (legacyMapIsRenderable(id)) bareIds.add(id);

    const classicBaseIds = Array.from(CLASSIC_MAPS)
        .filter((id) => bareIds.has(id) && legacyMapIsRenderable(id))
        .sort((a, b) => a.localeCompare(b));

    const sortedBare = Array.from(bareIds).sort((a, b) => a.localeCompare(b));

    let namedEn = 0, unnamed = 0;
    type Entry = { id: string, name: string, category: MapCategory, era?: "classic" };
    const entries: Entry[] = [];
    const lookupName = (id: string): { display?: string, name: string } => {
        const en = iro.get(id);
        if (en !== undefined) { namedEn++; return { display: en, name: `${id} - ${en}` }; }
        unnamed++;
        return { name: id };
    };
    for (const id of sortedBare)
        entries.push({ id, ...lookupName(id), category: classifyMap(id) });
    for (const base of classicBaseIds) {
        const en = iro.get(base);
        const name = en !== undefined ? `${base} - ${en} (Pre-Renewal)` : `${base} (Pre-Renewal)`;
        entries.push({ id: `${base}@classic`, name, category: classifyMap(base), era: "classic" });
    }

    const body = entries
        .map((e) => {
            const fields = [
                `id: ${JSON.stringify(e.id)}`,
                `name: ${JSON.stringify(e.name)}`,
                `category: ${JSON.stringify(e.category)}`,
            ];
            if (e.era !== undefined)
                fields.push(`era: ${JSON.stringify(e.era)}`);
            return `    { ${fields.join(", ")} },`;
        })
        .join("\n");

    const contents = `
import type { MapCategory } from "./mapcategory.js";

export interface RagnarokMapEntry {
    id: string;
    name: string;
    category: MapCategory;

    era?: "classic";
}

export const maps: RagnarokMapEntry[] = [
${body}
];
`;
    writeFileSync(OUT, contents);
    console.log(`wrote ${entries.length} entries to ${OUT}`);
    console.log(`  ${namedEn} English, ${unnamed} unnamed`);
}

interface Stage {
    name: string;
    requires?: string;
    run: () => void;
}

function main(): void {
    const args = process.argv.slice(2);
    const flags = args.filter((a) => a.startsWith("-"));
    const mapIdFilter = args.filter((a) => !a.startsWith("-"));

    const extractGrf = flags.includes("--extract-grf");
    const onlyFlags = flags.filter((f) => f === "--only" || f.startsWith("--only="));
    const unknownFlags = flags.filter((f) => !onlyFlags.includes(f) && f !== "--extract-grf");
    if (unknownFlags.length > 0) {
        console.error(`unknown flag(s): ${unknownFlags.join(" ")}`);
        console.error(`supported: --extract-grf, --only=stage1,stage2 (repeatable)`);
        process.exit(1);
    }
    if (extractGrf) {
        runExtractGrf();
        return;
    }

    let only: Set<string> | null = null;
    if (onlyFlags.length > 0) {
        only = new Set();
        for (const f of onlyFlags) {
            const parts = f === "--only" ? [] : f.slice("--only=".length).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
            if (parts.length === 0) {
                console.error(`${f} requires at least one stage name (e.g. --only=extract)`);
                process.exit(1);
            }
            for (const p of parts) only.add(p);
        }
    }

    const stages: Stage[] = [
        { name: "extract",          requires: GRF_PATH,                                       run: () => runExtract(mapIdFilter) },
        { name: "gen-maps",         requires: GRF_PATH,                                       run: () => runGenMaps() },
        { name: "extract-emitters", requires: path.resolve("data/RagnarokOnline_raw/iro_effecttool"), run: () => runExtractEmitters() },
        { name: "extract-entities", requires: HERCULES,                                       run: () => runExtractEntities() },
    ];

    if (only !== null) {
        const unknown = Array.from(only).filter((n) => !stages.some((s) => s.name === n));
        if (unknown.length > 0) {
            console.error(`unknown stage(s): ${unknown.join(", ")}`);
            console.error(`available: ${stages.map((s) => s.name).join(", ")}`);
            process.exit(1);
        }
    }

    for (const stage of stages) {
        if (only !== null && !only.has(stage.name))
            continue;
        console.log(`\n=== ${stage.name} ===`);
        if (stage.requires !== undefined && !existsSync(stage.requires)) {
            console.warn(`  skip ${stage.name}: missing ${stage.requires}`);
            continue;
        }
        try {
            stage.run();
        } catch (e) {
            console.error(`  ${stage.name} failed: ${(e as Error).message ?? e}; continuing`);
        }
    }
}

main();
