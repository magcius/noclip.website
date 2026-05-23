
// Offline extraction tool for the Ragnarok Online port.
//
// Phase 0 only needs to stage one map's source files (.rsw + .gnd + .gat) from
// the already-extracted client assets into the noclip dev data directory, so
// the viewer can fetch them via DataFetcher at `RagnarokOnline/maps/<map>.gnd`.
//
// Run with: tsx src/RagnarokOnline/tools/extract.ts
//
// Later phases extend this into the two-pass pipeline described in PORTING.md:
// an asset pass (RSW/GND/GAT/RSM/SPR/textures + a generated maps manifest) and
// a Hercules pass (per-map entity manifests). For now it just copies a triplet.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { parseGND } from "../gnd.js";
import { parseRSM } from "../rsm.js";
import { parseRSW } from "../rsw.js";
import { parseSTR } from "../str.js";

// Source: the client's already-extracted asset tree. Filenames here are the
// real on-disk names. Korean-named maps would arrive CP949-encoded and must be
// normalized to UTF-8 (see normalizeMapName); ASCII maps like `prontera` pass
// through unchanged.
const ASSET_MAPS_DIR = path.resolve("../client_data/assets/data/maps");

// Destination: noclip's local dev data dir. DataFetcher serves this at /data in
// development; the `data/` tree is gitignored (see .gitignore), so these staged
// files are local-only and never committed.
const OUT_MAPS_DIR = path.resolve("data/RagnarokOnline/maps");

// Source: the client's texture tree. The GND stores each texture path as a
// CP949 string like `필드바닥\\prt_초원01.bmp`; on disk the same path exists with
// the Korean directory/file names already in UTF-8 and backslashes replaced by
// the OS separator.
const ASSET_TEXTURE_DIR = path.resolve("../client_data/assets/graphics/texture");

// Destination: textures land under here at the normalized relative path the
// renderer reconstructs from the GND name alone (backslashes -> '/').
const OUT_TEXTURE_DIR = path.resolve("data/RagnarokOnline/textures");

// Source/destination for RSM 3D model props. The RSW stores each model path as
// a CP949 string like `프론테라\\분수대.rsm`; on disk the same path exists with
// the Korean directory/file names already in UTF-8.
const ASSET_MODEL_DIR = path.resolve("../client_data/assets/graphics/model");
const OUT_MODEL_DIR = path.resolve("data/RagnarokOnline/model");

const MAP_EXTENSIONS = [".rsw", ".gnd", ".gat"];

// Granny (.gr2) 3D models — the WoE objects (Emperium, guardians, guild flag,
// treasure box). RO ships these Oodle0-compressed with RAD-encoded textures that
// only granny2.dll can decode, so they're expanded OFFLINE (see gr2_decompress.c
// + gr2_texbake.c, run under wine on x86) into client_data/baked/. This stage
// just copies the baked artifacts into the dev data dir: each model's
// decompressed <name>.gr2 (our parser reads its geometry) and its expanded
// per-texture <name>.<i>.tex (a 16-byte header + RGBA). A missing baked dir just
// skips this stage (the maps still render without the 3D WoE props).
const BAKED_GR2_DIR = path.resolve("../client_data/baked/gr2/3dmob");
const BAKED_BONE_DIR = path.resolve("../client_data/baked/gr2/3dmob_bone");
const BAKED_TEX_DIR = path.resolve("../client_data/baked/gr2tex");
const OUT_MODEL3D_DIR = path.resolve("data/RagnarokOnline/model3d");
const WOE_GRANNY_MODELS = ["empelium90_0", "sguardian90_9", "aguardian90_8", "kguardian90_7", "guildflag90_1", "treasurebox_2"];
// Shared skeletal action clips (mesh-less) the guardians cycle through, keyed by
// guardian id (7=knight, 8=archer, 9=soldier). Retargeted onto the matching
// guardian skeleton by bone name at load.
const GUARDIAN_BONE_CLIPS = ["7_move", "7_attack", "7_damage", "8_move", "8_attack", "8_damage", "9_move", "9_attack", "9_damage"];

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
        // Its textures: <name>.<i>.tex (i = 0..N-1). Match strictly on
        // `<name>.<digits>.tex` so a sibling model whose name starts with
        // this one's name (e.g. "empelium90" vs "empelium90_0") can't steal
        // the wrong file.
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

// Source/destination for SPR/ACT character sprites. The corpus stores them under
// graphics/sprite/, with monsters in the CP949 "몬스터" dir; on disk the Korean
// names are already UTF-8. The renderer fetches them at the same normalized
// relative path (backslashes/forward-slashes preserved, percent-encoded).
const ASSET_SPRITE_DIR = path.resolve("../client_data/assets/graphics/sprite");
const OUT_SPRITE_DIR = path.resolve("data/RagnarokOnline/sprite");

// SPR/ACT pairs to stage outside the per-map entity manifest. "몬스터/poring" is
// the original Phase 4a test sprite. The "이팩트/..." entries are ambient
// effect-source sprites (the effect sprite folder "이팩트" is the decomp's
// "misc\" alias): torch_01 is the EF_TORCH flame and particle1 the EF_FIREFLY
// mote, placed at OT_EFFECTSRC sources (torches/fireflies are the two most common
// map effects). Only effect sprites that exist in the extracted corpus AND map to
// a confidently-identified effect id are staged here.
const SPRITES_TO_EXTRACT = ["몬스터/poring", "이팩트/torch_01", "이팩트/particle1"];

// Source: the per-map fog parameter table. Records are '#'-delimited fields in
// the order: <rsw>#, start#, end#, 0xAARRGGBB#, density#. The viewer fetches a
// compact per-map JSON the extractor writes alongside the map files.
const ASSET_FOG_TABLE = path.resolve("../client_data/assets/data/misc/fogparametertable.txt");

// Source: the map display-name table. One '#'-delimited record per line in the
// form `<rsw>#<display name>#` (the key keeps its `.rsw` extension). The file is
// CP949 (EUC-KR) encoded; names are Korean. The committed manifest cross-
// references it so each map gets a human-readable label, falling back to its id.
const ASSET_MAP_NAME_TABLE = path.resolve("../client_data/assets/data/misc/mapnametable.txt");

// Destination: the committed, generated manifest the scene registry maps over.
// It lives in source (not data/) because main.ts builds the scene groups
// synchronously at module load — see PORTING.md "Map auto-discovery".
const OUT_MAP_MANIFEST = path.resolve("src/RagnarokOnline/maps.ts");

// Maps whose base assets (rsw/gnd/gat + textures/models/water) are staged. By
// default every map on disk, so any entry in the generated manifest loads;
// pass map ids as CLI args to stage only those (faster for iterating on one).
// data/ is gitignored, so a full stage is local-only.
function mapsToExtract(): string[] {
    const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
    if (args.length > 0)
        return args;
    return readdirSync(ASSET_MAPS_DIR)
        .filter((f) => f.toLowerCase().endsWith(".rsw"))
        .map((f) => f.slice(0, -".rsw".length));
}

// Normalizes a map's base name to the clean UTF-8 form the TypeScript side
// expects. The client corpus stores some map/texture names in the legacy CP949
// (EUC-KR) Korean code page; those need transcoding here so paths on disk and
// in the manifest are always UTF-8. The common starter maps (prontera,
// prt_fild08, ...) are already plain ASCII, so for those this is a no-op.
//
// When we extend extraction to the full corpus, decode any non-ASCII bytes in
// the source filename from CP949 to UTF-8 here. The single place that happens
// is intentionally centralized in this function.
function normalizeMapName(name: string): string {
    // Runtime resolves map ids in lowercase (see maps.ts + the scene loader);
    // lowercase the staged basename so a mixed-case asset filename never
    // produces a mixed-case staged file. Nothing in the corpus has uppercase
    // ids today — pure robustness for future content. CP949 transcoding
    // hooks in here later.
    return name.toLowerCase();
}

// Parses a map's .gnd, decodes its CP949 texture names, and copies each texture
// BMP from the client tree into OUT_TEXTURE_DIR at the normalized relative path
// the renderer fetches it from. The on-disk source path is the decoded name
// with backslashes turned into the OS separator; the destination path is the
// same with forward slashes. Both come from the SAME euc-kr decode parseGND
// uses, so disk and fetch paths always agree.
// Source/destination for .str layered effects + their textures. The .str files
// live alongside the effect textures under texture/effect/; each layer's frame
// texture names are relative to that same dir. The viewer fetches the .str at
// effects/<name>.str and its textures flat at effects/textures/<name>.
const ASSET_EFFECT_DIR = path.resolve("../client_data/assets/graphics/texture/effect");
const OUT_EFFECT_DIR = path.resolve("data/RagnarokOnline/effects");

// .str effect files to stage (room to add ambient sources later).
const EFFECTS_TO_EXTRACT = ["gloria.str"];

// Standalone effect textures not referenced by any staged .str: the warp-portal
// (WarpZone) disc and ring. They live alongside the .str textures and are fetched
// flat at effects/textures/<name>. (The portal's third asset, the orbiting
// particle1 sprite, is staged via SPRITES_TO_EXTRACT.)
const EFFECT_TEXTURES_TO_EXTRACT = ["alpha_down.tga", "ring_blue.tga"];

// Copies the standalone effect textures into OUT_EFFECT_DIR/textures.
function extractEffectTextures(): void {
    const texOutDir = path.join(OUT_EFFECT_DIR, "textures");
    mkdirSync(texOutDir, { recursive: true });
    for (const name of EFFECT_TEXTURES_TO_EXTRACT) {
        const src = path.join(ASSET_EFFECT_DIR, name);
        if (!existsSync(src)) {
            console.warn(`  skip (missing effect texture): ${src}`);
            continue;
        }
        copyFileSync(src, path.join(texOutDir, name));
        console.log(`  effect texture ${name}: copied`);
    }
}

// Copies one .str effect and every texture its layers reference. The .str lands
// at OUT_EFFECT_DIR/<name>.str; its textures land flat at OUT_EFFECT_DIR/textures
// (the names the layers carry, .bmp default appended when extensionless).
function extractEffect(strName: string): void {
    const src = path.join(ASSET_EFFECT_DIR, strName);
    if (!existsSync(src)) {
        console.warn(`  skip (missing effect): ${src}`);
        return;
    }
    const effect = parseSTR(toSlice(readFileSync(src)));

    const strDst = path.join(OUT_EFFECT_DIR, strName);
    mkdirSync(path.dirname(strDst), { recursive: true });
    copyFileSync(src, strDst);

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
            const texSrc = path.join(ASSET_EFFECT_DIR, name);
            if (!existsSync(texSrc)) {
                texMissing++;
                continue;
            }
            copyFileSync(texSrc, path.join(texOutDir, name));
            texCopied++;
        }
    }
    console.log(`  effect ${strName}: ${effect.layers.length} layers, ${texCopied} textures copied (${texMissing} missing)`);
}

function toSlice(buf: Buffer): ArrayBufferSlice {
    return new ArrayBufferSlice(buf.buffer, buf.byteOffset, buf.byteLength);
}

// Copies one texture BMP from the client tree, given its CP949-decoded name (the
// SAME decode the parsers use). Skips names already copied this run. Returns
// true if it copied a file. `copied` is the dedupe set, `missing` accumulates
// names whose source BMP was absent.
function copyTexture(name: string, copied: Set<string>, missing: Set<string>): boolean {
    if (name === "" || copied.has(name) || missing.has(name))
        return false;
    const segments = name.split("\\");
    const src = path.join(ASSET_TEXTURE_DIR, ...segments);
    const dst = path.join(OUT_TEXTURE_DIR, ...segments);
    if (!existsSync(src)) {
        missing.add(name);
        return false;
    }
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied.add(name);
    return true;
}

function extractTextures(mapName: string, copied: Set<string>, missing: Set<string>): void {
    const gndPath = path.join(ASSET_MAPS_DIR, `${mapName}.gnd`);
    if (!existsSync(gndPath)) {
        console.warn(`  skip textures (no gnd): ${gndPath}`);
        return;
    }

    const raw = readFileSync(gndPath);
    const gnd = parseGND(toSlice(raw));

    let n = 0;
    for (const name of gnd.textureNames)
        if (copyTexture(name, copied, missing)) n++;
    console.log(`  terrain textures: ${n} copied`);
}

// Parses the map's .rsw, copies each unique referenced .rsm, then parses each
// .rsm for its texture names and copies those BMPs (deduped against `copied`).
function extractModels(mapName: string, copied: Set<string>, missing: Set<string>): void {
    const rswPath = path.join(ASSET_MAPS_DIR, `${mapName}.rsw`);
    if (!existsSync(rswPath)) {
        console.warn(`  skip models (no rsw): ${rswPath}`);
        return;
    }

    const rsw = parseRSW(toSlice(readFileSync(rswPath)));
    console.log(`  rsw v${rsw.major}.${rsw.minor}, ${rsw.models.length} placements`);

    const uniqueModels = new Set<string>();
    for (const p of rsw.models)
        if (p.modelName !== "")
            uniqueModels.add(p.modelName);

    let modelsCopied = 0, modelMisses = 0, texCopied = 0;
    for (const modelName of uniqueModels) {
        const segments = modelName.split("\\");
        const src = path.join(ASSET_MODEL_DIR, ...segments);
        const dst = path.join(OUT_MODEL_DIR, ...segments);
        if (!existsSync(src)) {
            console.warn(`  skip (missing model): ${src}`);
            modelMisses++;
            continue;
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        modelsCopied++;

        // Parse the model for its texture references and stage those too.
        try {
            const rsm = parseRSM(toSlice(readFileSync(src)));
            for (const texName of rsm.textures)
                if (copyTexture(texName, copied, missing)) texCopied++;
        } catch (e) {
            console.warn(`  warn (rsm parse failed, textures skipped): ${src}: ${e}`);
        }
    }

    console.log(`  models: ${modelsCopied} unique RSM copied (${modelMisses} missing), ${texCopied} model textures copied`);
}

// The water animation frames live under the texture tree's CP949 "워터" dir as
// water<type><NN>.jpg (NN = 00..31). The water type comes from the map's RSW.
// Copies all 32 frames for the map's type into OUT_TEXTURE_DIR at the same
// relative path the renderer fetches. Returns the count copied.
const WATER_DIR = "워터";
const WATER_FRAME_COUNT = 32;

function extractWater(mapName: string): void {
    const rswPath = path.join(ASSET_MAPS_DIR, `${mapName}.rsw`);
    if (!existsSync(rswPath)) {
        console.warn(`  skip water (no rsw): ${rswPath}`);
        return;
    }
    const rsw = parseRSW(toSlice(readFileSync(rswPath)));
    // RSW 2.6 moved the water block into the GND (1.8/1.9); rsw.waterType is
    // 0 on those maps. Prefer the GND's parsed water.type when present so
    // modern maps stage the right animation frames.
    let waterType = rsw.waterType;
    const gndPath = path.join(ASSET_MAPS_DIR, `${mapName}.gnd`);
    if (existsSync(gndPath)) {
        try {
            const gnd = parseGND(toSlice(readFileSync(gndPath)));
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
        const src = path.join(ASSET_TEXTURE_DIR, WATER_DIR, file);
        const dst = path.join(OUT_TEXTURE_DIR, WATER_DIR, file);
        if (!existsSync(src)) {
            missing++;
            continue;
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        copied++;
    }
    console.log(`  water: type ${waterType}, ${copied}/${WATER_FRAME_COUNT} frames copied (${missing} missing)`);
}

// Parses the fog parameter table into a map of rswName -> [start, end, colorHex,
// density]. The on-disk format is one '#'-terminated token per line; records are
// groups of five (key, start, end, color, density), matching the engine's parser
// (key first, then three pushes, the fourth closing the record).
function parseFogTable(): Map<string, { start: number, end: number, color: string, density: number }> {
    const out = new Map<string, { start: number, end: number, color: string, density: number }>();
    if (!existsSync(ASSET_FOG_TABLE))
        return out;

    const text = readFileSync(ASSET_FOG_TABLE, "latin1");
    // Each token ends with '#'; newlines separate them. Strip and collect tokens.
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
function extractFog(mapName: string, table: Map<string, { start: number, end: number, color: string, density: number }>): void {
    const entry = table.get(`${mapName}.rsw`.toLowerCase());
    if (entry === undefined) {
        console.log(`  fog: no entry for ${mapName}`);
        return;
    }
    const dst = path.join(OUT_MAPS_DIR, `${normalizeMapName(mapName)}.fog.json`);
    writeFileSync(dst, JSON.stringify(entry));
    console.log(`  fog: start=${entry.start} end=${entry.end} color=${entry.color} density=${entry.density}`);
}

// Copies one character sprite's .spr + .act pair from the client tree into
// OUT_SPRITE_DIR at the same relative path. `name` is a forward-slash relative
// path without extension (e.g. "몬스터/poring").
function extractSprite(name: string): void {
    const segments = name.split("/");
    let copied = 0;
    for (const ext of [".spr", ".act"]) {
        const src = path.join(ASSET_SPRITE_DIR, ...segments) + ext;
        const dst = path.join(OUT_SPRITE_DIR, ...segments) + ext;
        if (!existsSync(src)) {
            console.warn(`  skip (missing sprite): ${src}`);
            continue;
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        copied++;
    }
    console.log(`  sprite ${name}: ${copied}/2 files copied`);
}

// Parses mapnametable.txt into a map of base map id -> display name. The file is
// CP949 (EUC-KR); we decode it with TextDecoder so the Korean names land as
// proper UTF-8. Each line is `<rsw>#<display name>#`; we drop the `.rsw` from the
// key and the trailing `#` from the name. Blank/short lines are ignored.
function parseMapNameTable(): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(ASSET_MAP_NAME_TABLE))
        return out;

    const raw = readFileSync(ASSET_MAP_NAME_TABLE);
    const text = new TextDecoder("euc-kr").decode(raw);
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0)
            continue;
        // `<rsw>#<display name>#` — the key keeps its extension, the name may
        // itself contain no '#', so a simple split on the first '#' suffices.
        const hash = line.indexOf("#");
        if (hash < 0)
            continue;
        const key = line.slice(0, hash).trim();
        if (!key.toLowerCase().endsWith(".rsw"))
            continue;
        const id = key.slice(0, -".rsw".length).toLowerCase();
        const name = line.slice(hash + 1).replace(/#\s*$/, "").trim();
        if (name.length > 0)
            out.set(id, name);
    }
    return out;
}

// Scans the maps dir for every `*.rsw`, derives each map id (its lowercase
// basename), looks up a display name from mapnametable.txt (falling back to the
// id), and writes the committed `src/RagnarokOnline/maps.ts`. The list is sorted
// by id so the generated file is stable across runs.
function generateMapManifest(): void {
    if (!existsSync(ASSET_MAPS_DIR)) {
        console.warn(`  skip manifest (no maps dir): ${ASSET_MAPS_DIR}`);
        return;
    }

    const nameTable = parseMapNameTable();

    const ids = readdirSync(ASSET_MAPS_DIR)
        .filter((f) => f.toLowerCase().endsWith(".rsw"))
        .map((f) => f.slice(0, -".rsw".length).toLowerCase());
    ids.sort((a, b) => a.localeCompare(b));

    let named = 0;
    const entries = ids.map((id) => {
        const display = nameTable.get(id);
        if (display !== undefined)
            named++;
        // Label by the map id (prontera, geffen, prt_fild08, ...) — the western,
        // RO-standard names players use — with the Korean display name appended
        // as a hint for the cryptic ids.
        const name = display !== undefined ? `${id} — ${display}` : id;
        return { id, name };
    });

    const body = entries
        .map((e) => `    { id: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.name)} },`)
        .join("\n");

    const contents = `
// Generated map manifest for the Ragnarok Online scene registry. Do not edit by
// hand: regenerate by running the extraction tool (it scans the maps dir for
// *.rsw and cross-references mapnametable.txt for the display names).
//
// ${entries.length} maps (${named} with a mapnametable entry, ${entries.length - named} falling back to the id).

export interface RagnarokMapEntry {
    id: string;
    name: string;
}

export const maps: RagnarokMapEntry[] = [
${body}
];
`;

    writeFileSync(OUT_MAP_MANIFEST, contents.replace(/^\n/, ""));
    console.log(`  manifest: ${entries.length} maps (${named} named, ${entries.length - named} id-only) -> ${OUT_MAP_MANIFEST}`);
}

function main(): void {
    if (!existsSync(ASSET_MAPS_DIR)) {
        console.error(`Source maps dir not found: ${ASSET_MAPS_DIR}`);
        process.exit(1);
    }

    mkdirSync(OUT_MAPS_DIR, { recursive: true });

    // Shared across all maps this run: dedupe copied/missing textures.
    const copied = new Set<string>();
    const missing = new Set<string>();

    const fogTable = parseFogTable();

    for (const mapName of mapsToExtract()) {
        const outName = normalizeMapName(mapName);
        for (const ext of MAP_EXTENSIONS) {
            const src = path.join(ASSET_MAPS_DIR, `${mapName}${ext}`);
            const dst = path.join(OUT_MAPS_DIR, `${outName}${ext}`);
            if (!existsSync(src)) {
                console.warn(`  skip (missing): ${src}`);
                continue;
            }
            copyFileSync(src, dst);
            console.log(`  ${src} -> ${dst}`);
        }
        extractTextures(mapName, copied, missing);
        extractModels(mapName, copied, missing);
        extractWater(mapName);
        extractFog(mapName, fogTable);
    }

    for (const sprite of SPRITES_TO_EXTRACT)
        extractSprite(sprite);

    for (const effect of EFFECTS_TO_EXTRACT)
        extractEffect(effect);

    extractEffectTextures();

    // WoE 3D Granny models (baked offline; copied once, not per-map).
    extractGrannyModels();

    // Generate the committed map manifest covering the whole corpus (every
    // *.rsw on disk), independent of which maps had their assets staged above.
    generateMapManifest();

    console.log(`Done. ${copied.size} textures copied, ${missing.size} textures missing.`);
}

main();
