
// Tops up the asset tree at data/RagnarokOnline_raw/assets/graphics/{texture,model}/
// with anything every staged map references but the existing dump is missing,
// pulling the bytes out of data/RagnarokOnline_raw/grf/data.grf.
//
// Why: the legacy asset extraction predates Episode 15+ content (verus, lasagna,
// ilusion, rockridge, ...), so hundreds of maps reference textures/models that
// were never staged. The modern data.grf has all of them; this script bridges
// the gap so the renderer's 404 set drops to zero.
//
// Workflow:
//   1. tsx src/RagnarokOnline/tools/extract-from-grf.ts        (fills assets/)
//   2. tsx src/RagnarokOnline/tools/extract.ts                 (stages to CDN tree)
//
// CP949 path note: GND.textureNames and RSW model placements arrive in CP949
// (e.g. `필드바닥\\grass01.bmp`). The GRF stores its file table CP949-decoded
// AND lowercased; on disk we keep the UTF-8 form the existing dump uses.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { parseGND } from "../gnd.js";
import { parseRSM } from "../rsm.js";
import { parseRSW, RswWorld } from "../rsw.js";
import { Grf } from "./grf.js";

const GRF_PATH = path.resolve("data/RagnarokOnline_raw/grf/data.grf");
const ASSET_MAPS_DIR = path.resolve("data/RagnarokOnline_raw/assets/data/maps");
const ASSET_TEXTURE_DIR = path.resolve("data/RagnarokOnline_raw/assets/graphics/texture");
const ASSET_MODEL_DIR = path.resolve("data/RagnarokOnline_raw/assets/graphics/model");

function toSlice(buf: Buffer): ArrayBufferSlice {
    return new ArrayBufferSlice(buf.buffer, buf.byteOffset, buf.byteLength);
}

interface Refs {
    textures: Set<string>;
    models: Set<string>;
}

function gatherRefs(mapIds: string[]): Refs {
    const textures = new Set<string>();
    const models = new Set<string>();
    const rsmCache = new Set<string>();

    for (const mapId of mapIds) {
        const gndPath = path.join(ASSET_MAPS_DIR, `${mapId}.gnd`);
        if (existsSync(gndPath)) {
            try {
                const gnd = parseGND(toSlice(readFileSync(gndPath)));
                for (const name of gnd.textureNames)
                    if (name !== "") textures.add(name);
            } catch (e) {
                console.warn(`  warn (gnd parse): ${gndPath}: ${e}`);
            }
        }

        const rswPath = path.join(ASSET_MAPS_DIR, `${mapId}.rsw`);
        if (!existsSync(rswPath)) continue;
        let rsw: RswWorld;
        try {
            rsw = parseRSW(toSlice(readFileSync(rswPath)));
        } catch (e) {
            console.warn(`  warn (rsw parse): ${rswPath}: ${e}`);
            continue;
        }
        for (const p of rsw.models) {
            if (p.modelName === "" || rsmCache.has(p.modelName)) continue;
            rsmCache.add(p.modelName);
            models.add(p.modelName);
        }
    }

    return { textures, models };
}

// Resolve RSM dependencies a second pass: now that we know every referenced
// model, we need each one parsed (from disk if present, GRF otherwise) so we
// can pick up the textures the RSM itself references.
function gatherRsmTextures(grf: Grf, models: Set<string>, textures: Set<string>): void {
    for (const modelName of models) {
        const segments = modelName.split("\\");
        const onDisk = path.join(ASSET_MODEL_DIR, ...segments);
        let buf: Buffer | null = null;
        if (existsSync(onDisk)) {
            buf = readFileSync(onDisk);
        } else {
            try {
                buf = grf.read(`data\\model\\${modelName}`);
            } catch (e) {
                console.warn(`  warn (grf read model): ${modelName}: ${e}`);
            }
        }
        if (buf === null) continue;
        try {
            const rsm = parseRSM(toSlice(buf));
            for (const t of rsm.textures)
                if (t !== "") textures.add(t);
        } catch {
            // unparseable; texture refs unrecoverable, skip
        }
    }
}

function topUp(grf: Grf, names: Set<string>, rootDir: string, grfPrefix: string, kind: string): void {
    let copied = 0, skipped = 0, missing = 0, errors = 0;
    for (const name of names) {
        const segments = name.split("\\");
        const dst = path.join(rootDir, ...segments);
        if (existsSync(dst)) { skipped++; continue; }
        let buf: Buffer | null = null;
        try {
            buf = grf.read(`${grfPrefix}\\${name}`);
        } catch (e) {
            console.warn(`  grf read failed: ${kind} ${name}: ${(e as Error).message}`);
            errors++;
            continue;
        }
        if (buf === null) { missing++; continue; }
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, buf);
        copied++;
    }
    console.log(`  ${kind}: ${copied} copied, ${skipped} already present, ${missing} not in GRF, ${errors} errors`);
}

function main(): void {
    if (!existsSync(GRF_PATH)) {
        console.error(`GRF not found: ${GRF_PATH}`);
        process.exit(1);
    }
    if (!existsSync(ASSET_MAPS_DIR)) {
        console.error(`Source maps dir not found: ${ASSET_MAPS_DIR}`);
        process.exit(1);
    }

    const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
    const mapIds = args.length > 0 ? args : readdirSync(ASSET_MAPS_DIR)
        .filter((f) => f.toLowerCase().endsWith(".rsw"))
        .map((f) => f.slice(0, -".rsw".length));

    console.log(`Loading ${GRF_PATH}...`);
    const grf = new Grf(GRF_PATH);
    console.log(`  v0x${grf.version.toString(16)}, ${grf.files.size} files`);

    console.log(`\nGathering references from ${mapIds.length} map(s)...`);
    const refs = gatherRefs(mapIds);
    console.log(`  ${refs.textures.size} textures referenced (pre-RSM scan)`);
    console.log(`  ${refs.models.size} models referenced`);

    console.log(`\nResolving RSM texture references...`);
    gatherRsmTextures(grf, refs.models, refs.textures);
    console.log(`  ${refs.textures.size} textures referenced (post-RSM scan)`);

    console.log(`\nTopping up assets/graphics/model/ from GRF...`);
    topUp(grf, refs.models, ASSET_MODEL_DIR, "data\\model", "models");

    console.log(`\nTopping up assets/graphics/texture/ from GRF...`);
    topUp(grf, refs.textures, ASSET_TEXTURE_DIR, "data\\texture", "textures");

    grf.close();
    console.log(`\nDone.`);
}

main();
