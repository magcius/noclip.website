
// Extract per-map particle emitters from the iRO effecttool .lub corpus.
//
// Each map's effecttool entry (e.g. `effecttool/prontera.lub`) is a compiled
// Lua 5.1 script that, when executed, populates two globals:
//
//   _<mapId>_effect_version  -- table-format version (1 or 2)
//   _<mapId>_emitterInfo     -- the emitter array (one entry per spawn point)
//
// The LUBs were compiled for 32-bit Lua (the Win32 RO client), so a stock
// 64-bit Lua refuses to load them ("bad header"/"bad size_t"). We ship a
// minimally patched Lua 5.1 binary at `data/RagnarokOnline_raw/bin/lua-5.1-iro` that
// reads 32-bit size_t from the file regardless of the host pointer width.
// dump-emitters.lua runs each LUB under that binary in a sandboxed env and
// emits the discovered emitter table as one JSON object on stdout.
//
// This tool drives that:
//   1. Enumerate the LUB/LUA files under data/RagnarokOnline_raw/iro_effecttool.
//   2. For each, invoke the patched Lua to dump JSON.
//   3. Filter out non-map files (libraries, utilities whose basename isn't in the
//      maps.ts manifest).
//   4. Write one <mapId>.emitters.json per map next to the existing .rsw.
//   5. Also stage the textures the emitters reference (already extracted
//      under data/RagnarokOnline_raw/iro_eff_textures_all) into the data effect dir.
//
// Run with: tsx src/RagnarokOnline/tools/extract-emitters.ts

import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import * as path from "path";

const REPO = path.resolve(".");

// The patched Lua 5.1 binary (see lua-5.1.5/src/lundump.c patch for the
// 32-bit-size_t header tolerance) and the dump script that runs each LUB.
const LUA_BIN = path.resolve("data/RagnarokOnline_raw/bin/lua-5.1-iro");
const DUMP_LUA = path.resolve("src/RagnarokOnline/tools/dump-emitters.lua");

// Source: extracted LUB tree from the iRO GRF. The path inside data.grf is
// `data\luafiles514\lua files\effecttool\<name>.lub`; we sweep the whole tree
// so we catch the few stragglers under `data\lua files\` too.
const LUB_ROOT = path.resolve("data/RagnarokOnline_raw/iro_effecttool");

// Source: the 133 textures the LUBs reference, pre-extracted from the GRF
// into a flat `data/texture/effect/` layout.
const EFFECT_TEX_ROOT = path.resolve("data/RagnarokOnline_raw/iro_eff_textures_all/data/texture/effect");

// Destination: per-map emitter JSON lives next to the staged .rsw/.gnd/.gat
// so the scene loader can fetch it with `${mapId}.emitters.json`.
const MAPS_DIR = path.resolve("data/RagnarokOnline/maps");

// Destination: shared particle texture pool. The runtime resolves a texture
// reference (e.g. `effect\smoke1.bmp` -> `effect/smoke1.bmp`) against the
// terrain renderer's existing `data/RagnarokOnline/textures/` tree, where
// model + terrain textures already live. We put effect particles under
// `textures/effect/` so they sit alongside the existing few effect TGAs
// (alpha_down, ring_blue, gloria_*) without polluting the per-map dirs.
const EFFECT_TEX_OUT = path.resolve("data/RagnarokOnline/textures/effect");

// Shared-library LUBs that iRO's runtime merges into every map of a given
// prefix. Each map's own LUB defines its specific spawn points; the shared
// LUB defines extras (e.g. prt_lib carries the chimney smokestack emitters
// that show up across every prontera-family map). We mirror that merge here
// at extract time so the per-map JSON contains the full union. The runtime
// stays a single-map fetch with no library logic.
//
// Mapping is by map-id prefix. Anything that matches one of these prefixes
// gets the corresponding library's emitters appended. A map with no prefix
// match just keeps its own LUB.
// Shared-library merging is currently disabled. The naming convention
// suggested prt_lib.lub holds the prontera chimney smokestacks (it carries
// 2 smoke2.bmp emitters at coordinates that look reasonable as map offsets),
// but a visual check on prontera placed those particles floating mid-plaza
// rather than at any chimney, so prt_lib isn't authored against prontera's
// world frame, or it's keyed to a different map entirely (an instance/event
// variant, maybe), or the iRO runtime applies a different coordinate
// transform to library emitters than to map-owned ones. Without confirmed
// per-lib target maps we don't merge: each map's own LUB is faithful as-is.
const SHARED_LIBS: { libBasename: string, mapPrefix: RegExp }[] = [];

// Maps the runtime knows about. Anything not in here is a library (prt_lib,
// effecttoolutil, bl_grass, ...) we don't want to stage as a per-map JSON.
function loadMapIds(): Set<string> {
    const mapsTs = path.join(REPO, "src/RagnarokOnline/maps.ts");
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

function main(): void {
    if (!existsSync(LUA_BIN)) {
        console.error(`missing patched lua binary: ${LUA_BIN}`);
        console.error(`(rebuild from /tmp/lua-5.1.5; see notes at top of dump-emitters.lua)`);
        process.exit(1);
    }
    if (!existsSync(DUMP_LUA)) {
        console.error(`missing dump script: ${DUMP_LUA}`);
        process.exit(1);
    }
    if (!existsSync(LUB_ROOT)) {
        console.error(`missing LUB tree: ${LUB_ROOT}`);
        process.exit(1);
    }
    if (!existsSync(MAPS_DIR)) {
        console.error(`missing maps dir: ${MAPS_DIR}`);
        process.exit(1);
    }

    const knownIds = loadMapIds();
    console.log(`maps.ts: ${knownIds.size} known map ids`);

    // Pre-dump every shared library once: a path lookup so the per-map loop
    // can stitch the right libraries into each map's emitter list. Libraries
    // that aren't on disk just contribute nothing (the lookup misses).
    const sharedLibCache = new Map<string, EmitterSpec[]>();
    const allFiles = findLubFiles(LUB_ROOT);
    for (const lib of SHARED_LIBS) {
        const file = allFiles.find((f) => path.basename(f).toLowerCase().replace(/\.(lub|lua)$/i, "") === lib.libBasename);
        if (file === undefined) continue;
        const raw = dumpOne(file);
        if (raw === null || raw.emitters === null || raw.emitters === undefined)
            continue;
        const arr: Partial<EmitterSpec>[] = Array.isArray(raw.emitters) ? raw.emitters : Object.values(raw.emitters);
        const emitters = arr.map(withDefaults).filter((e) => e.texture !== "");
        if (emitters.length > 0)
            sharedLibCache.set(lib.libBasename, emitters);
    }
    console.log(`shared libs loaded: ${Array.from(sharedLibCache.keys()).join(", ") || "(none)"}`);

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
        // Both forms exist for this id; keep the .lub.
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

        // Merge any shared-library emitters whose prefix matches this map id.
        // The libraries carry their own spawn positions (chimney smokestacks
        // for prt_lib, battle-arena fountains for ba_lib, etc.) which the
        // engine appends to every map matching the prefix.
        for (const lib of SHARED_LIBS) {
            if (!lib.mapPrefix.test(id))
                continue;
            const libEmitters = sharedLibCache.get(lib.libBasename);
            if (libEmitters === undefined)
                continue;
            emitters.push(...libEmitters);
        }

        if (emitters.length === 0) {
            skipped++;
            continue;
        }

        // Collect referenced textures for the texture-staging step below.
        for (const e of emitters) {
            const name = e.texture.replace(/\\/g, "/").split("/").pop()!;
            referencedTextures.add(name);
        }

        const outPath = path.join(MAPS_DIR, `${id}.emitters.json`);
        const json = { version: raw.version ?? 1, emitters };
        writeFileSync(outPath, JSON.stringify(json));
        wrote++;
    }

    console.log(`wrote ${wrote}, skipped(empty)=${skipped}, skipped(notMap)=${badId}, parseFail=${badParse}`);

    // Stage the referenced textures under data/RagnarokOnline/textures/effect/.
    // Texture lookup at runtime drops the `effect\` prefix and resolves the
    // basename in this dir.
    let texCopied = 0, texMissing = 0;
    for (const name of referencedTextures) {
        const src = path.join(EFFECT_TEX_ROOT, name);
        if (!existsSync(src)) {
            texMissing++;
            continue;
        }
        copyFileSync(src, path.join(EFFECT_TEX_OUT, name));
        texCopied++;
    }
    console.log(`textures: copied ${texCopied}, missing ${texMissing} of ${referencedTextures.size}`);
}

main();
