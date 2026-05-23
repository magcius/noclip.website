
// Strip the Lunar New Year "Yut" board overlay from malangdo.gnd.
//
// iRO ships malangdo with a 7x5 (35-cell) Korean Yut game board baked into the
// terrain top surface at grid (87..93, 99..103). The cells reference two event
// textures (`event\pay_yut_bt01.bmp` / `bt02.bmp`) and produce a very visible
// rectangular checkerboard sitting on the grass north of the harbour. The
// overlay is in the base data.grf — there is no clean, non-event version of
// malangdo obtainable through the iRO Wiki client channel — so we restore the
// underlying grass at extraction time.
//
// The 35 affected cells are surrounded by `필드바닥\해변풀바닥04.bmp` ("beach
// grass floor 04", texture id 6) and a handful of adjacent variants
// (해변풀바닥01/02/03, texture ids 8/9/11). The pre-event topSurface entries
// are gone from the GND, so we cannot recover the exact original UVs; instead
// each yut cell adopts the topSurface id of its nearest grass neighbour (1..5
// ring search). This makes each patched cell render as a copy of that
// neighbour's grass quad — the texture tiles per-cell exactly as on every other
// grass cell on the map, so it blends in seamlessly with the surrounding grass.
//
// The patch is byte-level (rewrites Int32 topSurface ids in place) and
// idempotent: if no cell references the yut textures, nothing is written.
// Re-running it after a re-extraction restores the grass. Run with:
//
//   tsx src/RagnarokOnline/tools/patch-malangdo-yut.ts

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";

// Both copies of malangdo.gnd that the dev data tree carries (the extractor
// stages it under `maps/`; an older copy still sits at the data root from an
// earlier extraction pass). Patch whichever exist — missing copies are skipped
// silently.
const TARGETS = [
    path.resolve("data/RagnarokOnline/maps/malangdo.gnd"),
    path.resolve("data/RagnarokOnline/malangdo.gnd"),
];

// Texture-name fragments that identify the Yut board surfaces in the GND
// texture table. The full names are `event\pay_yut_bt01.bmp` and
// `pay_yut_bt02.bmp`; we match on the unique prefix so any future variant
// (e.g. `_bt03`) is caught too. ASCII, decoder-agnostic.
const YUT_TEXTURE_PREFIX = "event\\pay_yut_bt";

// Texture-name prefix that identifies the beach-grass top-surface textures we
// want as replacements. The GND stores names as CP949 (EUC-KR) bytes, decoded
// here to UTF-16 for a readable comparison: 필드바닥\해변풀바닥0X.bmp
// ("beach grass floor 0X").
const GRASS_TEXTURE_PREFIX = "필드바닥\\해변풀바닥";

const cp949 = new TextDecoder("euc-kr");

interface Gnd {
    width: number;
    height: number;
    textureNames: string[];     // raw CP949 strings (length-padded, NUL trimmed)
    surfaceTextureIds: number[]; // per-surface textureId (Int16, signed; -1 = no texture)
    cellsOffset: number;        // file offset of the cells block (cell stride = 28 bytes; topSurface @ +16)
    cellTopSurface: number[];   // length width*height
}

// Reads enough of the GND to locate the cells block and learn each surface's
// textureId. We keep cell heights/front/right untouched — only topSurface ids
// are rewritten — so we don't need to materialize them.
function readGnd(p: string): Gnd {
    const buf = readFileSync(p);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== "GRGN") throw new Error(`${p}: bad GND magic "${magic}"`);
    let o = 4 + 2; // magic + version
    const width = dv.getInt32(o, true); o += 4;
    const height = dv.getInt32(o, true); o += 4;
    o += 4; // zoom
    const texCount = dv.getInt32(o, true); o += 4;
    const texNameLen = dv.getInt32(o, true); o += 4;
    const textureNames: string[] = [];
    for (let i = 0; i < texCount; i++) {
        // Names are CP949 (EUC-KR), NUL-padded to texNameLen. Trim to the first
        // NUL before decoding so the decoder doesn't see padding bytes.
        const start = o;
        let end = start;
        while (end < start + texNameLen && dv.getUint8(end) !== 0) end++;
        textureNames.push(cp949.decode(new Uint8Array(buf.buffer, buf.byteOffset + start, end - start)));
        o += texNameLen;
    }
    const lmCount = dv.getInt32(o, true); o += 4;
    o += 12; // lightmap w/h/format
    o += lmCount * (64 + 192); // intensity (8*8) + colour (8*8*3) per lightmap
    const surfCount = dv.getInt32(o, true); o += 4;
    const surfaceTextureIds: number[] = [];
    for (let i = 0; i < surfCount; i++) {
        o += 32; // 4 u + 4 v floats
        surfaceTextureIds.push(dv.getInt16(o, true));
        o += 8; // textureId(2) + lightmapId(2) + color(4)
    }
    const cellsOffset = o;
    const cellTopSurface: number[] = [];
    for (let i = 0; i < width * height; i++) {
        o += 16; // 4 corner heights
        cellTopSurface.push(dv.getInt32(o, true));
        o += 12; // topSurface + front + right (we read top above)
    }
    return { width, height, textureNames, surfaceTextureIds, cellsOffset, cellTopSurface };
}

// Returns the texture ids referenced by `pay_yut_bt*` entries in the GND's
// texture table (typically [17, 18] on malangdo, but we don't hard-code).
function findYutTextureIds(g: Gnd): Set<number> {
    const out = new Set<number>();
    g.textureNames.forEach((n, i) => {
        if (n.startsWith(YUT_TEXTURE_PREFIX)) out.add(i);
    });
    return out;
}

// Returns the texture ids referenced by `해변풀바닥0X.bmp` entries — the grass
// top textures we'll use as replacement source.
function findGrassTextureIds(g: Gnd): Set<number> {
    const out = new Set<number>();
    g.textureNames.forEach((n, i) => {
        if (n.startsWith(GRASS_TEXTURE_PREFIX)) out.add(i);
    });
    return out;
}

// For each yut-textured cell, find the topSurface id of the nearest grass
// cell in a ring search up to radius `maxRadius`. Returns a mapping
// cellIndex -> new topSurface id. Cells that have no grass neighbour within
// the search radius are left untouched (and reported).
function planReplacements(g: Gnd, yutTex: Set<number>, grassTex: Set<number>, maxRadius: number): Map<number, number> {
    const isGrass = (surf: number): boolean =>
        surf >= 0 && surf < g.surfaceTextureIds.length && grassTex.has(g.surfaceTextureIds[surf]);
    const isYut = (surf: number): boolean =>
        surf >= 0 && surf < g.surfaceTextureIds.length && yutTex.has(g.surfaceTextureIds[surf]);

    const replacements = new Map<number, number>();
    for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
            const idx = y * g.width + x;
            if (!isYut(g.cellTopSurface[idx])) continue;
            let pick: number | null = null;
            ringSearch: for (let r = 1; r <= maxRadius; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= g.width || ny < 0 || ny >= g.height) continue;
                        const ns = g.cellTopSurface[ny * g.width + nx];
                        if (isGrass(ns)) { pick = ns; break ringSearch; }
                    }
                }
            }
            if (pick !== null) replacements.set(idx, pick);
        }
    }
    return replacements;
}

function patchFile(p: string): void {
    if (!existsSync(p)) {
        console.log(`  ${p}: not present, skipping`);
        return;
    }
    const g = readGnd(p);
    const yutTex = findYutTextureIds(g);
    if (yutTex.size === 0) {
        console.log(`  ${p}: no yut textures referenced, already clean`);
        return;
    }
    const grassTex = findGrassTextureIds(g);
    if (grassTex.size === 0)
        throw new Error(`${p}: yut textures present but no grass-floor textures to substitute from`);
    const reps = planReplacements(g, yutTex, grassTex, 5);
    let yutCount = 0;
    for (const t of g.cellTopSurface) if (t >= 0 && yutTex.has(g.surfaceTextureIds[t])) yutCount++;
    if (reps.size < yutCount)
        console.warn(`  ${p}: ${yutCount - reps.size} yut cell(s) had no grass neighbour within 5 cells`);

    // Backup once. Don't clobber an existing backup — preserves the original
    // for an undo even across repeat runs.
    const bak = `${p}.yut-bak`;
    if (!existsSync(bak)) {
        copyFileSync(p, bak);
        console.log(`  ${p}: backup -> ${bak}`);
    }

    // Apply byte-level rewrites. Each cell is 28 bytes; topSurface is the
    // Int32 at +16.
    const buf = readFileSync(p);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (const [idx, newTop] of reps)
        dv.setInt32(g.cellsOffset + idx * 28 + 16, newTop, true);
    writeFileSync(p, buf);
    console.log(`  ${p}: patched ${reps.size}/${yutCount} yut cells -> grass`);
}

function main(): void {
    console.log("patch-malangdo-yut: stripping Lunar New Year Yut board overlay");
    for (const t of TARGETS) patchFile(t);
}

main();
