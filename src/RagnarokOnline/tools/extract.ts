
// Offline pipeline that produces data/RagnarokOnline/ (the CDN tree the
// renderer fetches at runtime). One script; runs every stage in order:
//
//   npx tsx src/RagnarokOnline/tools/extract.ts [mapId ...]
//   npx tsx src/RagnarokOnline/tools/extract.ts --only=extract,gen-maps
//   npx tsx src/RagnarokOnline/tools/extract.ts --extract-grf   (debug only)
//
// Stages (run in order; each gated by its inputs existing):
//   1. extract          : stages GRF + baked + legacy assets -> data/RagnarokOnline/
//   2. extract-emitters : per-map particle JSON from iRO effecttool .lub dump
//   3. extract-entities : per-map NPC/mob/warp JSON from Hercules scripts
//   4. gen-maps         : rewrites src/RagnarokOnline/maps.ts (committed)
//
// Required inputs (drop in place before running):
//
//   data/RagnarokOnline_raw/grf/data.grf
//     iRO Mar-11-2026 client GRF (~4.4 GiB, Event Horizon v0x300). Install
//     latest iRO; data.grf is at the install root. Source of every asset the
//     renderer ships except the items below. Stages read entries straight
//     out of it; no intermediate filesystem dump required.
//
//   data/RagnarokOnline_raw/grf/legacy/*.grf
//     kRO 2008/2009 snapshot GRFs. data.grf (v0x200, SAK) ships the 22
//     CLASSIC_MAPS' pre-renewal geometry; sdata.grf (v0x200, sound overlay)
//     also contains the two LEGACY_ONLY_MAPS (poring_c01/c02). data_hp.grf
//     (HighPriest patch, v0x102) is harmlessly skipped: the parser doesn't
//     handle v0x102 and no map we use lives there. Optional; missing -> the
//     classic/legacy scene entries don't appear in maps.ts and the modern
//     map renders under its bare id only.
//
//   data/RagnarokOnline_raw/iro_effecttool/
//     iRO effecttool .lub/.lua dump (per-map particle emitter specs). Not in
//     the GRF; copy from an iRO client install's effecttool/ dir.
//
//   data/RagnarokOnline_raw/bin/lua-5.1-iro
//     Patched Lua 5.1 binary. iRO ships its effecttool .lub files precompiled
//     with 32-bit Lua, so a vanilla 64-bit lua refuses to load them ("bad
//     header" on the size_t width byte; "bad size" on the string length read).
//     Build once:
//       curl -O https://www.lua.org/ftp/lua-5.1.5.tar.gz
//       tar xf lua-5.1.5.tar.gz && cd lua-5.1.5
//       patch -p0 < ../src/RagnarokOnline/tools/lua-5.1.5-iro.patch
//       make <platform>            # e.g. macosx, linux
//       mv src/lua data/RagnarokOnline_raw/bin/lua-5.1-iro
//     Stage 2 spawns this to execute the iRO .lub scripts. Also requires
//     `iconv` on PATH (standard on macOS/Linux) for CP949 -> UTF-8 transcoding
//     of emitter strings.
//
//   data/RagnarokOnline_raw/baked/gr2/, baked/gr2tex/
//     WoE Granny models pre-expanded offline (RO ships them Oodle0-compressed
//     with RAD-encoded textures only granny2.dll can decode). Build steps,
//     one-time, on an x86 host with mingw + wine:
//       i686-w64-mingw32-gcc -O2 -o gr2_decompress.exe tools/gr2_decompress.c
//       i686-w64-mingw32-gcc -O2 -o gr2_texbake.exe   tools/gr2_texbake.c
//       # drop granny2.dll (lift from any iRO/kRO client install root)
//       # beside both .exes
//     For each WoE model (empelium90_0, [a|s|k]guardian90_{7,8,9},
//     guildflag90_1, treasurebox_2) and each shared clip
//     ({7,8,9}_{move,attack,damage}):
//       wine gr2_decompress.exe <src>.gr2 baked/gr2/<name>.gr2
//       wine gr2_texbake.exe   baked/gr2/<name>.gr2 baked/gr2tex/<name>
//     texbake emits one baked/gr2tex/<name>.<i>.tex per texture. Optional;
//     missing -> WoE props skipped.
//
//   ../Hercules
//     Sibling checkout of github.com/HerculesWS/Hercules for NPC/mob spawn
//     data. Optional; missing -> entity manifests skipped.
//
// BGM mp3s aren't touched by any stage but the CDN needs them: copy from
// a client installation into data/RagnarokOnline/audio/bgm/ separately.
//
// Debug-only flag: `--extract-grf` dumps every GRF entry to
// data/RagnarokOnline_raw/assets/ (CP949-decoded paths) and exits without
// running any stage. Useful for poking around the corpus; the pipeline
// itself reads the GRF directly and does not need this tree to exist.
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

// ---- Shared helpers --------------------------------------------------------

function toSlice(buf: Buffer): ArrayBufferSlice {
    return new ArrayBufferSlice(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---- Shared source paths ---------------------------------------------------

const GRF_PATH = path.resolve("data/RagnarokOnline_raw/grf/data.grf");

// Pre-renewal kRO 2008/2009 GRFs (v0x200). The Grf class reads them the same
// way as the modern iRO GRF; we open each in order and treat them as an
// overlay set when a map id isn't in the modern GRF or is `<id>@classic`.
const LEGACY_GRF_DIR = path.resolve("data/RagnarokOnline_raw/grf/legacy");
function legacyGrfPaths(): string[] {
    if (!existsSync(LEGACY_GRF_DIR)) return [];
    return readdirSync(LEGACY_GRF_DIR)
        .filter((f) => f.toLowerCase().endsWith(".grf"))
        .map((f) => path.join(LEGACY_GRF_DIR, f));
}

// Pre-renewal maps with meaningful geometry differences from the modern iRO
// versions, exposed as separate `<id>@classic` scene entries. List discovered
// by hash-diffing the kRO 2009 GRFs against the iRO renewal GRF (commit
// f2b1c12a). Update if Gravity rebuilds another map's geometry in a future
// patch and we want to expose both vintages.
const CLASSIC_MAPS = new Set<string>([
    "alberta", "alde_gld", "aru_gld", "bat_c01", "bra_in01", "brasilis",
    "cmd_fild08", "ein_fild01", "gl_cas02", "iz_dun03", "izlude", "manuk",
    "moc_castle", "moc_fild20", "morocc", "prt_fild05", "prt_in", "ra_in01",
    "rachel", "spl_fild01", "splendide", "ve_fild02",
]);

// Pre-renewal-only maps absent from the modern iRO GRF; exposed under their
// bare id, sourced from the legacy GRFs.
const LEGACY_ONLY_MAPS = new Set<string>(["poring_c01", "poring_c02"]);

// ============================================================================
// Grf reader
// ============================================================================

// Reader for Gravity's GRF archive format. Handles both v0x200 (the long-
// standing kRO/iRO layout, including the legacy kRO 2008/2009 snapshots) and
// v0x300 (the "Event Horizon" variant iRO ships since ~Oct 2024 to accommodate
// 4 GiB+ archives).
//
// Header (46 bytes), v0x200:
//   0x00..0x0E  signature (15 bytes, ignored)
//   0x0F..0x1D  padding/key
//   0x1E..0x21  fileTableOffset (u32 LE)
//   0x22..0x25  seed           (i32 LE)
//   0x26..0x29  fileCountRaw   (i32 LE; real count = raw - seed - 7)
//   0x2A..0x2D  version        (u32 LE; 0x200, 0x103, etc.)
//
// Header, v0x300 (only when bytes 35..37 are all zero AND version == 0x300):
//   0x1E..0x25  fileTableOffset (u64 LE)
//   0x26..0x29  fileCountPre    (u32 LE; real count = this value directly)
//
// File table at HEADER_SIZE + fileTableOffset:
//   v0x300 prefixes a 4-byte zero word, then both versions have
//   u32 packedSize + u32 realSize + packedSize bytes of zlib-deflated entries.
//
// Each entry:
//   CP949 filename, null-terminated; u32 compressedSize; u32 lengthAligned;
//   u32 realSize; u8 type; then a u32 offset in v0x200 or u64 in v0x300
//   (post-name stride 17 vs 21).
//
// File data at HEADER_SIZE + entry.offset:
//   lengthAligned bytes; zlib-deflate when realSize !== compressedSize.
//   DES-encrypted entries (type bits 0x02 / 0x04) used in pre-v0x200 archives
//   aren't implemented; we'd throw on read if we ever hit one.

const HEADER_SIZE = 46;
const FILELIST_TYPE_FILE = 0x01;
const FILELIST_TYPE_ENCRYPT_MIXED = 0x02;
const FILELIST_TYPE_ENCRYPT_HEADER = 0x04;

export interface GrfEntry {
    compressedSize: number;
    lengthAligned: number;
    realSize: number;
    type: number;
    offset: number;
}

export class Grf {
    public readonly version: number;
    public readonly files: Map<string, GrfEntry> = new Map();
    private readonly fd: number;

    constructor(private readonly path: string) {
        this.fd = openSync(this.path, "r");

        const header = Buffer.alloc(HEADER_SIZE);
        readSync(this.fd, header, 0, HEADER_SIZE, 0);

        this.version = header.readUInt32LE(0x2A);

        // v0x300 "Event Horizon" uses a u64 file-table offset only when bytes
        // 35..37 are all zero (the guard distinguishes it from legacy v0x300
        // builds that still used the old u32 + seed layout). Anything else
        // falls through to the v0x200 layout. Best-effort for v0x103/v0x101/
        // v0x102 (different prefixes, different encryption); those typically
        // fail in inflateSync below and the caller decides whether to skip.
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

        // v0x300 prefixes the size header with a 4-byte zero word.
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

// Loads the GRF, aborting the current stage with a clear message if the file
// is missing. Every stage that needs the GRF goes through this; parse cost is
// a few seconds per call. If multiple stages run back-to-back and the repeated
// parse becomes noticeable, share a single instance via the orchestrator.
function openGrf(): Grf {
    if (!existsSync(GRF_PATH)) {
        console.error(`GRF not found: ${GRF_PATH}`);
        throw new Error("stage aborted");
    }
    const grf = new Grf(GRF_PATH);
    console.log(`  grf: v0x${grf.version.toString(16)}, ${grf.files.size} files`);
    return grf;
}

// Debug-only: dump every GRF entry under data/RagnarokOnline_raw/assets/ using
// its CP949-decoded path. The pipeline itself does not need this tree; this is
// purely for poking at the corpus with normal filesystem tools.
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

// ============================================================================
// Stage 1: extract (stages GRF -> CDN tree)
// ============================================================================

// CP949 path note: GND.textureNames and RSW model placements arrive in CP949
// (e.g. `필드바닥\\grass01.bmp`). The GRF stores its file table CP949-decoded
// and lowercased. On disk we keep the UTF-8 form and lowercase the basenames
// so the case-sensitive CDN serves them under a stable path.

// Destination: noclip's local dev data dir. DataFetcher serves this at /data in
// development; the `data/` tree is gitignored (see .gitignore), so these staged
// files are local-only and never committed.
const OUT_MAPS_DIR = path.resolve("data/RagnarokOnline/maps");
const OUT_TEXTURE_DIR = path.resolve("data/RagnarokOnline/textures");
const OUT_MODEL_DIR = path.resolve("data/RagnarokOnline/model");
const OUT_SPRITE_DIR = path.resolve("data/RagnarokOnline/sprite");
const OUT_EFFECT_DIR = path.resolve("data/RagnarokOnline/effects");
const OUT_MODEL3D_DIR = path.resolve("data/RagnarokOnline/model3d");

const MAP_EXTENSIONS = [".rsw", ".gnd", ".gat"];

// Granny (.gr2) 3D models. The WoE objects (Emperium, guardians, guild flag,
// treasure box). RO ships these Oodle0-compressed with RAD-encoded textures
// that only granny2.dll can decode, so they're expanded OFFLINE (see
// gr2_decompress.c + gr2_texbake.c, run under wine on x86) into
// data/RagnarokOnline_raw/baked/. This stage just copies the baked artifacts
// into the dev data dir: each model's decompressed <name>.gr2 (our parser
// reads its geometry) and its expanded per-texture <name>.<i>.tex (a 16-byte
// header + RGBA). A missing baked dir just skips this stage (the maps still
// render without the 3D WoE props).
const BAKED_GR2_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2/3dmob");
const BAKED_BONE_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2/3dmob_bone");
const BAKED_TEX_DIR = path.resolve("data/RagnarokOnline_raw/baked/gr2tex");
const WOE_GRANNY_MODELS = ["empelium90_0", "sguardian90_9", "aguardian90_8", "kguardian90_7", "guildflag90_1", "treasurebox_2"];
// Shared skeletal action clips (mesh-less) the guardians cycle through, keyed
// by guardian id (7=knight, 8=archer, 9=soldier). Retargeted onto the matching
// guardian skeleton by bone name at load.
const GUARDIAN_BONE_CLIPS = ["7_move", "7_attack", "7_damage", "8_move", "8_attack", "8_damage", "9_move", "9_attack", "9_damage"];

// SPR/ACT pairs to stage outside the per-map entity manifest. "몬스터/poring"
// is the original Phase 4a test sprite. The "이팩트/..." entries are ambient
// effect-source sprites (the effect sprite folder "이팩트" is the decomp's
// "misc\" alias): torch_01 is the EF_TORCH flame and particle1 the EF_FIREFLY
// mote, placed at OT_EFFECTSRC sources (torches/fireflies are the two most
// common map effects). Only effect sprites that exist in the GRF AND map to a
// confidently-identified effect id are staged here.
const SPRITES_TO_EXTRACT = ["몬스터/poring", "이팩트/torch_01", "이팩트/particle1"];

// .str effect files to stage (room to add ambient sources later).
const EFFECTS_TO_EXTRACT = ["gloria.str"];

// Standalone effect textures not referenced by any staged .str: the warp-portal
// (WarpZone) disc and ring. They live alongside the .str textures and are
// fetched flat at effects/textures/<name>. (The portal's third asset, the
// orbiting particle1 sprite, is staged via SPRITES_TO_EXTRACT.)
const EFFECT_TEXTURES_TO_EXTRACT = ["alpha_down.tga", "ring_blue.tga"];

// The water animation frames live under the texture tree's CP949 "워터" dir
// as water<type><NN>.jpg (NN = 00..31). The water type comes from the map's
// RSW (or its GND for 2.6+ maps; see extractWater).
const WATER_DIR = "워터";
const WATER_FRAME_COUNT = 32;

// Copies each baked WoE .gr2 and all of its expanded .tex into OUT_MODEL3D_DIR,
// keyed by the model basename (e.g. empelium90_0.gr2, empelium90_0.0.tex).
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
        // Match strictly on `<name>.<digits>.tex` so a sibling model whose
        // name starts with this one's (e.g. "empelium90" vs "empelium90_0")
        // can't steal the wrong file.
        const texRe = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.tex$`);
        for (const f of existsSync(BAKED_TEX_DIR) ? readdirSync(BAKED_TEX_DIR) : []) {
            if (texRe.test(f)) {
                copyFileSync(path.join(BAKED_TEX_DIR, f), path.join(OUT_MODEL3D_DIR, f));
                texs++;
            }
        }
    }
    // Shared guardian action clips (mesh-less; no textures to copy).
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

// Reads a file from the first GRF in the priority list that has it. Modern
// iRO GRF is always first; legacy GRFs follow for `@classic` and LEGACY_ONLY
// maps so `.gnd`/`.rsm` references to pre-renewal-only textures or models
// fall back to legacy bytes when the name is gone in modern.
function readFromGrfs(grfs: Grf[], filename: string): Buffer | null {
    for (const g of grfs) {
        const buf = g.read(filename);
        if (buf !== null) return buf;
    }
    return null;
}

// Writes one GRF entry to the staged tree at `dstRel`. Backslashes in the GRF
// path become OS separators on disk; basenames are lowercased so the
// case-sensitive CDN serves them under a stable path. Returns true if it
// wrote a file.
function writeGrfEntry(grfs: Grf[], grfPath: string, outRoot: string, dstRel: string): boolean {
    const buf = readFromGrfs(grfs, grfPath);
    if (buf === null) return false;
    const segments = dstRel.split("\\");
    const dst = path.join(outRoot, ...segments.map((s) => s.toLowerCase()));
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, buf);
    return true;
}

// Copies one texture, given its CP949-decoded name (the SAME decode the
// parsers use). Skips names already copied this run. Returns true if it
// copied a file; missing names accumulate in `missing` for a final report.
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

// Reads each model the RSW references, copies it to the staged tree, then
// parses it for its texture references and copies those too. Dedupes textures
// against `copied`.
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

// Copies all 32 water frames for the map's water type into OUT_TEXTURE_DIR at
// the same relative path the renderer fetches.
function extractWater(grfs: Grf[], rswBuf: Buffer, gndBuf: Buffer | null): void {
    const rsw = parseRSW(toSlice(rswBuf));
    // RSW 2.6 moved the water block into the GND (1.8/1.9); rsw.waterType is
    // 0 on those maps. Prefer the GND's parsed water.type when present so
    // modern maps stage the right animation frames.
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

// Parses the fog parameter table into a map of rswName -> [start, end, color,
// density]. The on-disk format is one '#'-terminated token per line; records
// are groups of five (key, start, end, color, density), matching the engine's
// parser (key first, then three pushes, the fourth closing the record).
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

// Writes a compact fog JSON for one map (or nothing if the map has no entry).
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

// Copies one .spr+.act pair from the GRF into OUT_SPRITE_DIR at the same
// relative path. `name` is a forward-slash relative path without extension
// (e.g. "몬스터/poring").
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

// Copies one standalone effect texture from the GRF into OUT_EFFECT_DIR/textures.
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

// Copies one .str effect and every texture its layers reference. The .str
// lands at OUT_EFFECT_DIR/<name>.str; its textures land flat at
// OUT_EFFECT_DIR/textures (the names the layers carry, .bmp default appended
// when extensionless).
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

// Enumerates every staged map id, optionally filtered. Bare ids come from
// `data\<id>.rsw` entries in the modern iRO GRF plus LEGACY_ONLY_MAPS;
// CLASSIC_MAPS contribute a `<id>@classic` variant each. Returned lowercased.
function enumerateMapIds(grf: Grf, mapIdFilter: string[]): string[] {
    if (mapIdFilter.length > 0)
        return mapIdFilter.map((s) => s.toLowerCase());
    const ids = new Set<string>();
    for (const key of grf.files.keys()) {
        const m = /^data\\([^\\]+)\.rsw$/i.exec(key);
        if (m !== null) ids.add(m[1].toLowerCase());
    }
    for (const id of LEGACY_ONLY_MAPS)
        ids.add(id);
    for (const id of CLASSIC_MAPS)
        ids.add(`${id}@classic`);
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

// Reads one per-map file (rsw/gnd/gat) for a given id. CLASSIC and LEGACY_ONLY
// ids resolve against the legacy GRFs (opened lazily and cached); everything
// else against the modern GRF. Returns null when no archive has the file (gat
// is sometimes absent for instance dungeons).
const legacyGrfCache = new Map<string, Grf | null>();
function openLegacyGrfs(): Grf[] {
    const out: Grf[] = [];
    for (const p of legacyGrfPaths()) {
        let g = legacyGrfCache.get(p);
        if (g === undefined) {
            // Skip archives whose version this parser doesn't handle (e.g.
            // v0x102 sound overlays). Cache the null so we don't retry.
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

    // Shared across all maps this run: dedupe copied/missing textures.
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

    // WoE 3D Granny models (baked offline; copied once, not per-map).
    extractGrannyModels();

    console.log(`\nDone. ${copied.size} textures copied, ${missing.size} textures missing.`);
}


// ============================================================================
// Stage 2: extract-emitters (iRO effecttool .lub -> per-map JSON)
// ============================================================================

// Each map's effecttool entry (e.g. `effecttool/prontera.lub`) is a compiled
// Lua 5.1 script that, when executed, populates two globals:
//
//   _<mapId>_effect_version  -- table-format version (1 or 2)
//   _<mapId>_emitterInfo     -- the emitter array (one entry per spawn point)
//
// The LUBs were compiled for 32-bit Lua (the Win32 RO client), so a stock
// 64-bit Lua refuses to load them ("bad header"/"bad size_t"). We ship a
// minimally patched Lua 5.1 binary at `data/RagnarokOnline_raw/bin/lua-5.1-iro`
// that reads 32-bit size_t from the file regardless of the host pointer width.
// dump-emitters.lua runs each LUB under that binary in a sandboxed env and
// emits the discovered emitter table as one JSON object on stdout.
//
// This stage drives that:
//   1. Enumerate the LUB/LUA files under data/RagnarokOnline_raw/iro_effecttool.
//   2. For each, invoke the patched Lua to dump JSON.
//   3. Filter out non-map files (libraries, utilities whose basename isn't in
//      the maps.ts manifest).
//   4. Write one <mapId>.emitters.json per map next to the existing .rsw.
//   5. Stage the textures the emitters reference (pulled live from the GRF).

const LUA_BIN = path.resolve("data/RagnarokOnline_raw/bin/lua-5.1-iro");
const DUMP_LUA = path.resolve("src/RagnarokOnline/tools/dump-emitters.lua");

// Source: LUB tree extracted from the iRO GRF. The path inside data.grf is
// `data\luafiles514\lua files\effecttool\<name>.lub`; we sweep the whole tree
// so we catch the few stragglers under `data\lua files\` too.
const LUB_ROOT = path.resolve("data/RagnarokOnline_raw/iro_effecttool");

// Destination: shared particle texture pool. The runtime resolves a texture
// reference (e.g. `effect\smoke1.bmp` -> `effect/smoke1.bmp`) against the
// terrain renderer's existing `data/RagnarokOnline/textures/` tree, where
// model + terrain textures already live. We put effect particles under
// `textures/effect/` so they sit alongside the existing few effect TGAs
// (alpha_down, ring_blue, gloria_*) without polluting the per-map dirs.
const EFFECT_TEX_OUT = path.resolve("data/RagnarokOnline/textures/effect");

// Maps the runtime knows about. Anything not in here is a library (prt_lib,
// effecttoolutil, bl_grass, ...) we don't want to stage as a per-map JSON.
function loadMapIds(): Set<string> {
    const mapsTs = path.resolve("src/RagnarokOnline/maps.ts");
    if (!existsSync(mapsTs))
        return new Set();
    const text = readFileSync(mapsTs, "utf8");
    const ids = new Set<string>();
    // The manifest lists each map as a quoted id followed by ", " plus its
    // English name string. A loose regex finds them in either entries[] or
    // a Map literal; we don't depend on the exact shape.
    for (const m of text.matchAll(/["']([a-z0-9_@\-]+)["']\s*[,:]/gi)) {
        const id = m[1].toLowerCase();
        if (id.length >= 2)
            ids.add(id);
    }
    return ids;
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

// Defaults applied where the raw dump is missing a field. Mirrors how the
// engine treats absent table entries: zeros, single-particle caps, additive
// blend. Better to default than reject a partially-authored emitter.
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
        srcmode: v1(e.srcmode, [5]),       // D3DBLEND_SRCALPHA
        destmode: v1(e.destmode, [6]),     // D3DBLEND_INVSRCALPHA
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

// Run the Lua dump on a single file. Returns the parsed JSON object (with
// .emitters as an array) or null when the LUB couldn't be evaluated.
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

    // Dedupe by id: prefer .lub over .lua when both exist (the .lub is the
    // compiled form Gravity ships; the .lua, when present, is a stale
    // pre-compiled source). filesystem ordering from readdirSync isn't
    // stable across platforms so picking explicitly avoids run-to-run drift.
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
        // Same extension on both, likely two paths under different subtrees.
        // Keep the first seen; log so the operator notices.
        conflicts.push(`${id}: duplicate (${prev} and ${file}); keeping first`);
    }
    if (conflicts.length > 0)
        console.warn(`emitter file conflicts (${conflicts.length}):\n  ${conflicts.join("\n  ")}`);

    const referencedTextures = new Set<string>();

    let wrote = 0, skipped = 0, badId = 0, badParse = 0;
    for (const file of byId.values()) {
        // The map id is the lowercased basename without extension. iRO uses
        // ASCII lowercase for all map ids; we normalize anything weird.
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
        // Defensive: dump-emitters.lua emits arrays for contiguous int-keyed
        // tables and objects otherwise. A few LUBs that mix numeric + string
        // keys come through as objects; coerce to a value array here.
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

    // Stage the referenced textures from the GRF under
    // data/RagnarokOnline/textures/effect/. Texture lookup at runtime drops
    // the `effect\` prefix and resolves the basename in this dir.
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


// ============================================================================
// Stage 3: extract-entities (Hercules scripts -> per-map JSON + sprites)
// ============================================================================

// Parses the Hercules server scripts into a per-map entity manifest (mobs,
// NPCs, warps) and stages the SPR/ACT sprite assets those entities need.
// Output:
//   data/RagnarokOnline/entities/<map>.json
//   data/RagnarokOnline/sprite/<dir>/<name>.spr|.act   (deduped)
//
// Re-runnable: pulling newer scripts and re-running flows new content into the
// manifests. The base map assets are staged by Stage 1; this stage adds the
// entity layer + the sprites it references (all pulled live from the GRF).

const HERCULES = path.resolve("../Hercules");
// Mob DB: read pre-renewal first, then renewal. Renewal is the modern source
// of truth (it adds ~750 mobs unique to renewal-era maps and updates the stats
// of existing ones), so the second pass overrides the first on shared ids.
// Both eras' mob ids match for the classic mobs (Poring=1002, etc.).
const MOB_DBS = [
    path.join(HERCULES, "db/pre-re/mob_db.conf"),
    path.join(HERCULES, "db/re/mob_db.conf"),
];

// Sprite tree inside the GRF: monsters under `data\sprite\몬스터\` (CP949
// "monster"), NPC job sprites under `data\sprite\npc\`. Names on disk match
// these CP949-decoded paths.
const MONSTER_DIR = "몬스터";
const NPC_SPRITE_DIR = "npc";

const OUT_ENTITIES = path.resolve("data/RagnarokOnline/entities");

interface MobEntry {
    id: number;
    sprite: string;   // sprite path relative to the sprite root, no extension
    name: string;     // display name from the spawn line
    count: number;
    cellX: number; cellY: number; // spawn-rect center (GAT cells); 0,0 = whole map
    spanX: number; spanY: number; // spawn-rect radius; 0,0 = whole map
    speed: number;    // movement speed in ms per cell (mob_db MoveSpeed)
    canMove: boolean; // mob_db Mode.CanMove: immobile mobs (Pupa, plants) never wander
}

interface NpcEntry {
    sprite: string;   // sprite path relative to the sprite root, no extension
    cellX: number; cellY: number; dir: number;
    name: string;     // visible name (the #suffix hidden part stripped)
}

interface WarpEntry {
    cellX: number; cellY: number;
    spanX: number; spanY: number;
    dest: string;     // destination map id
    destX: number; destY: number; // arrival cell on the destination map (GAT cells)
    // Era hint for the destination resolver (set on warps from era-specific
    // source scripts; omitted for shared-script warps so the runtime falls
    // back to the source scene's own era). Lines up with entity.ts:WarpEntry.
    destEra?: "classic" | "renewal";
}

interface Manifest {
    mobs: MobEntry[];
    npcs: NpcEntry[];
    warps: WarpEntry[];
}

// ---- mob_db: Id -> SpriteName ----------------------------------------------

// One mob_db record's fields we care about: the sprite name and the walk speed
// (MoveSpeed, ms per cell). DEFAULT_MOVE_SPEED is the engine's stock value,
// used when a record omits MoveSpeed.
const DEFAULT_MOVE_SPEED = 150;
interface MobDbEntry { sprite: string; speed: number; canMove: boolean; }

// The libconfig-style mob_db lists records with `Id: <n>`, `SpriteName:
// "<NAME>"`, `MoveSpeed: <ms>`, and a `Mode: { ... }` block of behavior flags.
// We need the sprite, the walk speed, and the Mode.CanMove flag (mobs whose
// Mode lacks CanMove (Pupa, plants, eggs, mushrooms) never wander; their
// MoveSpeed is meaningless). A line scan suffices: Id leads each record;
// SpriteName, MoveSpeed and the Mode block follow within it. CanMove is only
// honored while inside that record's Mode block. The record commits when the
// next Id is seen.
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
            // Track the Mode flag block so CanMove is only read from this
            // record's Mode object (the flags share generic names with no
            // record prefix).
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

// ---- Sprite resolution -----------------------------------------------------

// Mob sprite: the mob_db SpriteName lowercased, under the monster dir.
// Verified against the corpus (PORING -> 몬스터/poring.spr,
// LUNATIC -> lunatic.spr, ...).
function mobSpriteRel(spriteName: string): string {
    return `${MONSTER_DIR}/${spriteName.toLowerCase()}`;
}

// NPC sprite: the script's SPRITE-constant name lowercased, under the npc dir
// (4_F_KAFRA1 -> npc/4_f_kafra1.spr). A few constants have no visible sprite
// (HIDDEN_NPC, FAKE_NPC, INVISIBLE_NPC); those are placeable triggers, not
// drawable, so we skip them.
const INVISIBLE_NPC_SPRITES = new Set(["HIDDEN_NPC", "FAKE_NPC", "INVISIBLE_NPC", "HIDDEN_WARP_NPC", "WARPNPC", "CLEAR_NPC"]);

function npcSpriteRel(spriteToken: string): string | null {
    if (INVISIBLE_NPC_SPRITES.has(spriteToken.toUpperCase()))
        return null;
    // Numeric SPRITE tokens are player-job IDs (rare for town NPCs); we don't
    // resolve those to a file here. Skip and report.
    if (/^-?\d+$/.test(spriteToken))
        return null;
    return `${NPC_SPRITE_DIR}/${spriteToken.toLowerCase()}`;
}

// Confirms a sprite's .spr exists in the GRF (the .act sits beside it).
// `rel` is the sprite path relative to the sprite root, no extension.
function spriteExistsInGrf(grf: Grf, rel: string): boolean {
    return grf.has(`data\\sprite\\${rel.replace(/\//g, "\\")}.spr`);
}

// ---- Hercules script load list ---------------------------------------------

// Hercules does not load every .txt under npc/; it loads exactly the files
// named in its config, following the era-specific entry point. A raw
// directory walk pulls in content the live server never loads: seasonal
// events and especially npc/custom/ (the sample Healer, Warper, Stylist, Job
// Master, MVP/bank/lottery rooms and other novelty NPCs), all of which
// over-populate towns with content that isn't part of the map.
//
// Instead we reproduce the server's own load order. The entry points are
// libconfig files (npc/pre-re/scripts_main.conf and npc/re/scripts_main.conf)
// whose `npc_global_list` tuples list script files as bare quoted paths and
// pull in further lists via `@include`. Lines beginning with `//` are
// disabled. Following the includes and collecting the live (non-commented)
// quoted paths yields exactly the set the server loads, which excludes
// npc/custom/ because scripts_custom.conf, while included, has all of its
// entries commented out by default.
//
// We process BOTH eras' load lists in one pass: each era's main conf shares
// the era-neutral `npc/scripts*.conf` family and adds its own subtree
// (npc/pre-re/* or npc/re/*). A Set dedups the shared files so they're
// scanned once. The result captures pre-renewal-only content (old Morroc),
// renewal-only content (Malangdo, Eclage, Dewata, ...), and all shared towns.
//
// A separate `npc_removed_list` (scripts_removed.conf, shared between eras)
// names files to drop even if they appear in the load list; we honor it.

// Pulls every double-quoted token out of one libconfig line, after stripping
// a `//` line comment. Used for both `@include "x.conf"` and bare
// `"npc/x.txt",` list entries. A line that is entirely commented out yields
// nothing.
function quotedTokens(line: string): string[] {
    const noComment = line.replace(/\/\/.*$/, "");
    const out: string[] = [];
    const re = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComment)) !== null)
        out.push(m[1]);
    return out;
}

// Strips `/* ... */` block comments from `src`, preserving newlines (so line
// numbers + the line-by-line parsers downstream stay aligned). `/*` inside a
// double-quoted string literal is NOT a comment opener; required so e.g.
// an NPC `mes "/* hint */"` line doesn't toggle global comment state.
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

// Recursively parses a libconfig script list, accumulating the loaded .txt
// script files into `scripts` and the removed-file paths into `removed`.
// Paths in the conf are relative to the Hercules root. `@include` lines
// recurse into the named conf; quoted ".txt" tokens are script files; quoted
// ".conf" tokens reached outside an `@include` are ignored (none occur in
// practice).
function parseScriptConf(confRel: string, scripts: Set<string>, removed: Set<string>, seen: Set<string>): void {
    if (seen.has(confRel))
        return;
    seen.add(confRel);

    const confPath = path.join(HERCULES, confRel);
    if (!existsSync(confPath)) {
        console.warn(`  conf include missing: ${confRel}`);
        return;
    }

    // Track whether we are inside the removed-file list, so its entries are
    // dropped from (not added to) the load set.
    let inRemoved = false;
    // Strip /* ... */ block comments first so a commented-out @include or
    // quoted script path doesn't get picked up by the line scan below.
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

// Resolves one era's load list to absolute script file paths, honoring the
// removed-file list and skipping any entry whose file is absent. Called per
// era (pre-renewal and renewal) so we can scan each independently and apply
// per-map era preference downstream.
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

// Extracts the visible display name from an NPC's name field. Hercules names
// carry two kinds of hidden suffix: `#tag` (the hidden part shown to no one)
// and `::uniqueID` (the internal unique-name used by duplicate()/event hooks).
// Both are stripped; "Kafra Employee::kaf_prontera" -> "Kafra Employee", and
// a name that is only a hidden tag ("#prt_key-1") becomes "".
function visibleName(name: string): string {
    let s = name;
    const colons = s.indexOf("::");
    if (colons >= 0) s = s.slice(0, colons);
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    return s.trim();
}

// Parses an NPC/warp/mob definition line, returning its leading
// `map,x,y,dir` (or `map,x,y,xs,ys` for mobs) plus the tab-separated fields.
// Returns null for lines that aren't map-anchored definitions OR are disabled
// by a leading `//` comment. Skipping commented lines matters: their
// coords[0] would otherwise read as "//<mapId>" and write to "<mapId>.json"
// under POSIX path normalisation, silently overwriting the real manifest
// with the disabled content (this had wiped prt_in's NPCs/mobs and replaced
// its warps with four commented-out tiles in npc/warps/cities/prontera.txt).
interface Line { coords: string[]; fields: string[]; }
function splitLine(raw: string): Line | null {
    // Definition lines are tab-separated: <coords>\t<type>\t<name>\t<args>.
    // Script bodies and `function`/`-`-anchored entries either don't start
    // with a map name or have no tab structure of interest. Commented-out
    // entries (with or without indent) drop out.
    const lead = raw.trimStart();
    if (lead.startsWith("//"))
        return null;
    const fields = raw.split("\t");
    if (fields.length < 2)
        return null;
    const coords = fields[0].split(",");
    return { coords, fields };
}

// Which load-list a script file came from. Drives era assignment for every
// entity the file declares (see emitManifests for the per-(map, era)
// fan-out). "shared" = a script that both eras' main.conf @includes
// (npc/cities/*.txt etc., Gravity-authored once, used in both vintages);
// "pre-re" or "re" = scripts unique to that era's subtree (npc/pre-re/* or
// npc/re/*).
type EntryEra = "pre-re" | "re" | "shared";

interface ScanResult {
    mobs: { name: string; cellX: number; cellY: number; spanX: number; spanY: number; mobId: number; count: number; era: EntryEra }[];
    npcs: { spriteToken: string; cellX: number; cellY: number; dir: number; name: string; era: EntryEra }[];
    warps: (WarpEntry & { era: EntryEra })[];
}

// Scans `text` for scripted `monster(...)` calls embedded in NPC script
// bodies. These are placed by OnInit/OnTimer/OnTouch handlers and don't show
// up as tab-anchored definition lines, so the line scanner misses them.
// Real examples: niflheim.txt (Ashe Bruce's "touch the book" Rideword
// spawns), quests_airship.txt (the staged Gremlin/Beholder encounters
// inside airplane_01).
//
// monster() signature (script.c):
//   monster "<map>",<x>,<y>,"<name>",<id|CONST>,<count>{,"<event>"};
//   monster("<map>",<x>,<y>,"<name>",<id|CONST>,<count>{,"<event>"});
//
// Mob identifier is either a numeric id (rare in scripts) or a SpriteName
// constant (GREMLIN, G_RIDEWORD, ...). We resolve constants via the
// reverse mob_db lookup; unknown / non-literal mob args are skipped.
//
// Caveat handling: any monster() whose map/x/y/count is not a literal (i.e.
// a script variable like .@x or $RANDOM) gets SKIPPED rather than emitted
// with a placeholder. The runtime has nowhere meaningful to draw a mob with
// no coords, and emitting a fake spawn at (0,0) would just clutter origin.
// `warp()` script calls are intentionally NOT scanned: they teleport the
// calling player rather than declaring a placeable warp tile (the visible
// warp tiles already come through as `WARPNPC` script definitions caught
// by the line scanner).
function scanScriptedSpawns(text: string, mobIdByName: Map<string, number>):
    { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] {
    const out: { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] = [];
    // Match `monster(...)` OR `monster "..."` opening. Quoted-string-first
    // arg (the map id) is the easy disambiguator from `killmonster`/
    // `areamonster`/`summon`/etc. The name field may be a raw "..." quoted
    // literal or a gettext-style _("...") wrapper (Hercules uses both
    // interchangeably).
    const re = /\bmonster\s*[\(\s]\s*"([^"]+)"\s*,\s*([^,]+),\s*([^,]+),\s*(?:_\s*\(\s*)?"([^"]*)"\s*\)?\s*,\s*([A-Z_][A-Z0-9_]*|-?\d+)\s*,\s*([^,;)\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const mapId = m[1].trim();
        const xRaw = m[2].trim(), yRaw = m[3].trim();
        const nameLit = m[4].trim();
        const mobTok = m[5].trim();
        const countRaw = m[6].trim();
        // Literal coords + count only; skip script-variable args.
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
        // Name may be "--ja--" (mob_db default-name marker); pass through
        // and let the manifest reader treat it like any other name.
        out.push({ mapId, x, y, name: nameLit, mobId, count });
    }
    return out;
}

// One pass over every loaded script, tagging each entry with its source
// file's era and bucketing by the map id in its coordinate field. Returns
// one big map (mapId -> entries) for the whole corpus; the main loop fans
// entries out into per-(map, era) manifests downstream.
function scanAllScripts(files: { file: string, era: EntryEra }[], mobIdByName: Map<string, number>): Map<string, ScanResult> {
    const byMap = new Map<string, ScanResult>();
    const NPC_TYPES = new Set(["script", "shop", "cashshop", "pointshop", "marketshop", "trader"]);
    const bucket = (id: string): ScanResult => {
        let r = byMap.get(id);
        if (r === undefined) { r = { mobs: [], npcs: [], warps: [] }; byMap.set(id, r); }
        return r;
    };

    for (const { file, era } of files) {
        // Block-comment-strip first: NPCs wrapped in /* ... */ (e.g. the
        // disabled Curator of Library in npc/cities/prontera.txt) would
        // otherwise be parsed as live map entries because splitLine only
        // skips `//` line comments.
        const text = stripBlockComments(readFileSync(file, "utf8"));
        // Second pass: scripted monster() spawns. Done BEFORE the line scan
        // because the line scan only sees tab-anchored definition lines.
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
                // coords: map,x,y,xs,ys ; fields[2]=name ; fields[3]=id,amt,d1,d2{,event}
                const x = +coords[1], y = +coords[2], xs = +coords[3], ys = +coords[4];
                const args = (fields[3] ?? "").split(",");
                const mobId = parseInt(args[0], 10);
                const count = parseInt(args[1] ?? "1", 10);
                if (!Number.isFinite(mobId)) continue;
                res.mobs.push({ name: fields[2].trim(), cellX: x, cellY: y, spanX: xs, spanY: ys, mobId, count, era });
                continue;
            }

            if (type === "warp") {
                // coords: map,x,y,dir ; fields[3]=xs,ys,dest,dx,dy
                // dx,dy are the arrival cell on the destination map; keep
                // them so the viewer can place the camera at the landing
                // point.
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

            // NPC-like definitions, including duplicate(Parent).
            const isDuplicate = type.startsWith("duplicate(");
            if (NPC_TYPES.has(type) || isDuplicate) {
                const x = +coords[1], y = +coords[2], dir = +coords[3];
                // SPRITE is the first comma-separated token of the args field.
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

// ---- Era-aware map fan-out -------------------------------------------------

// Filters a scan's entries to those whose era is in `allowed`, and tags the
// resulting warps with `destEra` so cross-map warps from this manifest carry
// the right era hint into the runtime resolver. A "shared" warp leaves
// destEra undefined regardless (the runtime falls back to the source scene's
// own era when no hint is set; see era.ts:resolveWarpDest).
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

// A map's entries are era-divergent when classic and renewal would produce
// meaningfully different manifests, i.e. there exists at least one entry
// from an era-specific script (pre-re-only or re-only). Maps with only
// "shared" entries collapse to a single manifest because both eras would
// produce byte-identical content. We use this signal to decide whether to
// emit per-era manifests at all (most cities + dungeons don't diverge; no
// point writing three identical .json files).
function isEraDivergent(scan: ScanResult): boolean {
    const eraSpecific = (e: { era: EntryEra }): boolean => e.era !== "shared";
    return scan.mobs.some(eraSpecific) || scan.npcs.some(eraSpecific) || scan.warps.some(eraSpecific);
}

// Maps a raw scan for one mapId into the (possibly multiple) manifest names
// + pre-filtered scans that should be written. Returns [] when nothing of
// value resolves (no entity content; manifest is skipped and the scene 404s
// cleanly).
//
// Era-divergent maps produce THREE files: <id>@classic.json (pre-re +
// shared), <id>@renewal.json (re + shared), and a bare <id>.json that
// aliases the primary (renewal) era, so existing URLs and inter-map warp
// scripts naming bare ids keep working without knowing about era variants.
//
// Non-divergent maps produce ONE bare <id>.json (no point emitting redundant
// per-era copies of the same content). Renewal-removed legacy maps (only
// pre-re entries exist) fall through to that single bare manifest using the
// pre-re entries.
function emitManifests(mapId: string, scan: ScanResult): { name: string, scan: ScanResult }[] {
    if (isEraDivergent(scan)) {
        const out: { name: string, scan: ScanResult }[] = [];
        const classic = filterByEra(scan, ["pre-re", "shared"], "classic");
        const renewal = filterByEra(scan, ["re", "shared"], "renewal");
        if (hasContent(classic))
            out.push({ name: `${mapId}@classic`, scan: classic });
        if (hasContent(renewal)) {
            out.push({ name: `${mapId}@renewal`, scan: renewal });
            out.push({ name: mapId, scan: renewal });   // bare alias = renewal
        } else if (hasContent(classic)) {
            // Pre-re-only map (renewal removed it): the bare alias falls
            // back to classic so the scene still loads under its canonical
            // id.
            out.push({ name: mapId, scan: classic });
        }
        return out;
    }
    // Non-divergent: a single bare manifest covers both eras. Pull from any
    // entries (they're all "shared", which exist in both era buckets).
    const bare = filterByEra(scan, ["pre-re", "re", "shared"], "renewal");
    return hasContent(bare) ? [{ name: mapId, scan: bare }] : [];
}

// ---- Sprite staging --------------------------------------------------------

// Copies a sprite's .spr + .act pair from the GRF into OUT_SPRITE_DIR at the
// same relative path. `rel` is forward-slash, no extension. Dedup via
// `copied`.
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

// ---- Main ------------------------------------------------------------------

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

    // Reverse lookup SpriteName -> Id for scripted monster() calls (whose
    // first arg is the SpriteName constant rather than a numeric id).
    // Renewal wins on shared names because the renewal mob_db is processed
    // second in parseMobDb; reusing the same iteration order here keeps the
    // two sources in sync.
    const mobIdByName = new Map<string, number>();
    for (const [id, e] of mobDb)
        mobIdByName.set(e.sprite.toUpperCase(), id);

    // Resolve each era's load list; the eras share many files
    // (npc/cities/*, npc/quests/*, etc., Gravity-authored once and @included
    // by both scripts_main.conf). Tag each unique file with its origin: in
    // BOTH lists = "shared" (entries are era-shared and duplicate into both
    // sides), in pre-re only = "pre-re", in re only = "re".
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
    // One scan over every file (each read once), tagging each entry with its
    // source era so emitManifests can fan into per-(map, era) buckets.
    const byMap = scanAllScripts(filesWithEra, mobIdByName);
    console.log(`scanned ${byMap.size} maps with script entries\n`);

    // Track which manifest files this run produces so we can sweep any stale
    // .json from a previous run (a map whose entities have since been
    // filtered out, e.g. CLEAR_NPC additions to the invisible-sprite list).
    const writtenManifests = new Set<string>();

    let mapsWritten = 0, totalNpcs = 0, totalMobInstances = 0, totalWarps = 0, eraVariantsWritten = 0;
    for (const [mapId, scan] of byMap) {
        // Fan into per-(map, era) manifests. Most maps emit a single bare
        // <mapId>.json (renewal-preference, with a pre-re fallback for
        // renewal-removed maps). Era-aware maps emit three: <mapId>.json
        // (= renewal alias), <mapId>@renewal.json, and <mapId>@classic.json.
        for (const { name: manifestId, scan: filteredScan } of emitManifests(mapId, scan)) {
            // Mobs: resolve id -> sprite via mob_db. Every map declared with
            // mob spawns gets them placed; a few cities have single rare
            // "tame" spawns (Wild Rose, etc.) with multi-hour respawn timers
            // that we treat as legitimate content rather than filtering on a
            // map-name heuristic.
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

            // NPCs: resolve SPRITE token -> sprite file; skip event/demo/
            // debug NPCs and dedup stacked NPCs sharing a cell.
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

            // Warps: drop the per-entry `era` scratch field but keep destEra
            // (the runtime-relevant hint set by filterByEra). For an
            // era-aware map both the @classic and @renewal manifests use
            // destEra, so the resolver picks the matching dest variant when
            // both eras exist.
            const warps: WarpEntry[] = filteredScan.warps.map((w) => ({
                cellX: w.cellX, cellY: w.cellY, spanX: w.spanX, spanY: w.spanY,
                dest: w.dest, destX: w.destX, destY: w.destY,
                destEra: w.destEra,
            }));

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

    // Sweep stale manifests left over from previous runs.
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

    console.log(`\n${stagedSprites.size} unique sprite (.spr/.act) pairs staged into ${OUT_SPRITE_DIR}`);
}


// ============================================================================
// Stage 4: gen-maps (writes src/RagnarokOnline/maps.ts)
// ============================================================================

// Generates src/RagnarokOnline/maps.ts from the iRO GRF map list + the iRO
// English mapnametable that ships inside the GRF.
//
// Inputs:
//   data/RagnarokOnline_raw/grf/data.grf
//     `data\<id>.rsw` (the id list)
//     `data\mapnametable.txt` (English display names)
//   CLASSIC_MAPS / LEGACY_ONLY_MAPS (compiled-in lists; see the constants
//   for the curation rationale). Their geometry comes from the legacy kRO
//   GRFs at the runtime; gen-maps only consumes the names.
// Output:
//   src/RagnarokOnline/maps.ts (committed; the scene registry maps over it)

// Bare-named towns (and town-equivalent hubs) that no prefix rule catches.
const TOWNS = new Set([
    "prontera", "geffen", "payon", "morocc", "alberta", "izlude", "aldebaran", "comodo",
    "umbala", "niflheim", "amatsu", "gonryun", "ayothaya", "louyang", "jawaii", "einbroch",
    "einbech", "lighthalzen", "hugel", "rachel", "veins", "yuno", "xmas", "moscovia",
    "brasilis", "dewata", "malangdo", "malaya", "eclage", "mora", "manuk", "splendide",
    "dicastes01", "mid_camp", "prt_fild08", "new_1-1", "new_zone01", "prt_monk",
]);

// Named dungeons (and dungeon-like areas) whose ids don't contain `_dun`. Ids
// matching `/_dun/` are handled by the generic check in `classifyMap` below.
const NAMED_DUNGEON_RE = /^(gl_|abyss|abbey|juperos|jupe_|gefenia|cave\b|izlu2dun|anthell|in_sphinx|in_orcs|in_rogue|orcsdun|c_tower|tha_t|thana|treasure|kh_|ra_san|thor_v|moc_pryd|prt_sew|prt_maze|spl_in|ecl_tdun|1@|2@)/;

function classifyMap(id: string): MapCategory {
    id = id.replace(/@classic$/, "");
    if (/_cas\d|g_cas/.test(id) || id.startsWith("nguild_") || /_gld\b|gld_/.test(id)) return "castle";
    if (/^\d+@/.test(id)) return "dungeon"; // instance dungeons read as dungeons for fog
    if (/^que_|^job_|^force_|^pvp_|^gvg|^arena|^ordeal|^poring_w|^guild_vs|^bat_|^job3|^turbo_|^sec_|^prt_are|auction/.test(id)) return "instance";
    if (/_fild\d|_field/.test(id)) return "field";
    if (/_dun/.test(id) || NAMED_DUNGEON_RE.test(id)) return "dungeon";
    if (/_in\d|^in_|_in$|_room|_indoor/.test(id)) return "indoor";
    if (TOWNS.has(id) || (/^(prt|gef|pay|moc|alde|cmd|um|nif|ama|gon|ayo|lou|ein|lhz|yuno|ra|ve|bra|dew|mal|izlude|glast|hu|mosk|dic|ecl|man|teak|tur|alb|pay)_/.test(id) && !/_dun|_fild|_in/.test(id))) return "city";
    return "other";
}

const OUT = path.resolve("src/RagnarokOnline/maps.ts");

// mapnametable.txt: `<map_id>.rsw#<display name>#`. The iRO file is ASCII
// (which decodes through CP949 unchanged). WHATWG's "euc-kr" label is the
// CP949 index.
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

    // Bare ids: one per `data\<id>.rsw` in the iRO GRF plus any LEGACY_ONLY
    // map whose .rsw actually lives in one of the legacy GRFs. Instance maps
    // (`1@4cdn`, `2@nyd`) use `@` as a LEADING char and stay in the bare
    // list. CLASSIC_MAPS contribute a `<id>@classic` each, gated likewise.
    const bareIds = new Set<string>();
    for (const key of grf.files.keys()) {
        const m = /^data\\([^\\]+)\.rsw$/i.exec(key);
        if (m !== null) bareIds.add(m[1].toLowerCase());
    }
    grf.close();
    for (const id of LEGACY_ONLY_MAPS)
        if (legacyGrfHas(`data\\${id}.rsw`)) bareIds.add(id);

    const classicBaseIds = Array.from(CLASSIC_MAPS)
        .filter((id) => bareIds.has(id) && legacyGrfHas(`data\\${id}.rsw`))
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
// Generated map manifest for the Ragnarok Online scene registry. Do not edit
// by hand: regenerate by running
//   npx tsx src/RagnarokOnline/tools/extract.ts --only=gen-maps
//
// ${entries.length} entries (${sortedBare.length} bare + ${classicBaseIds.length}
// pre-renewal classic variants with rebuilt geometry). ${namedEn} with an iRO
// English name, ${unnamed} unnamed.

import type { MapCategory } from "./mapcategory.js";

export interface RagnarokMapEntry {
    id: string;
    name: string;
    category: MapCategory;
    // Set on dedicated pre-renewal scene entries; their assets and entity
    // manifest are loaded from the @classic-suffixed files regardless of the
    // global era toggle.
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


// ============================================================================
// Orchestrator
// ============================================================================

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
        // Debug-only: dump every GRF entry to assets/ then exit. Not invoked
        // by any stage; the pipeline reads the GRF directly.
        runExtractGrf();
        return;
    }

    // Merge all --only= flags into one set; --only with no `=` value (or
    // with an empty one) is a CLI error rather than a silent no-op.
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
        { name: "extract-emitters", requires: path.resolve("data/RagnarokOnline_raw/iro_effecttool"), run: () => runExtractEmitters() },
        { name: "extract-entities", requires: HERCULES,                                       run: () => runExtractEntities() },
        { name: "gen-maps",         requires: GRF_PATH,                                       run: () => runGenMaps() },
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
