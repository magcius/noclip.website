
// Scene-side loading and placement of the WoE 3D Granny models.
//
// The Emperium, the three guardian types, the guild flag and the treasure box
// ship as Granny (.gr2) files. RO stores them Oodle0-compressed with RAD-encoded
// textures that only granny2.dll decodes, so they're expanded OFFLINE (see
// tools/gr2_decompress.c + gr2_texbake.c) into data/RagnarokOnline/model3d/ as a
// decompressed <name>.gr2 (geometry our parser reads) plus per-texture
// <name>.<i>.tex (a 16-byte header + RGBA). This module fetches those, decodes
// each mesh's texture, and builds one placed GrannyInstance per model.
//
// These objects belong to War-of-Emperium guild castles, so we place them only
// on castle maps (id contains "_cas"), clustered at the map centre and grounded
// on the terrain. Coordinate handling: the models are authored Z-up with their
// base at z≈0, so the placement rotates Z-up -> the renderer's Y-up frame
// (x,y,z) -> (x, z, -y), then scales and positions.

import { mat4 } from "gl-matrix";
import { DataFetcher } from "../DataFetcher.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DecodedImage } from "./bmp.js";
import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";
import { gatCellSurfaceHeight } from "./coord.js";
import { extractGrannyModel, GrannyAnimation, parseGranny } from "./granny.js";
import { GrannyInstance } from "./granny-render.js";

// The guardians ship a single idle clip in their own .gr2; their action clips
// live in shared 3dmob_bone files keyed by the guardian's id (the .gr2 name
// suffix). Each clip's bones match the guardian skeleton 1:1 by name, so they
// retarget directly. We cycle idle -> these so the guardians visibly run their
// whole animation set rather than looping one idle. (Death is omitted — a
// looped death pose reads as a glitch.)
const GUARDIAN_CLIP_ID: { [model: string]: string } = {
    kguardian90_7: "7", aguardian90_8: "8", sguardian90_9: "9",
};
const GUARDIAN_ACTIONS = ["move", "attack", "damage"];

// The treasure box's only clip is a one-shot spawn tumble (~180° root sweep);
// looped it spins unnaturally, so it's drawn static.
const STATIC_MODELS = new Set(["treasurebox_2"]);

// Uniform model->world scale for the WoE props. The Granny units put the
// Emperium ~24 tall; this brings it to a sensible in-world height. Tunable.
const GRANNY_WORLD_SCALE = 1.0;

// The Emperium-room cell (server GAT coordinates) of each guild castle — where
// the Emperium spawns when WoE runs. The Emperium goes exactly here; the other
// display models are arranged immediately beside it (their real positions are
// guild-dynamic / in other rooms, so this keeps them together in the right
// area rather than guessing each). Maps not in this table fall back to centre.
const EMPERIUM_ROOM: { [mapId: string]: [number, number] } = {
    // First Edition castles (npc/woe-fe/agit_main.txt).
    aldeg_cas01: [216, 23], aldeg_cas02: [213, 23], aldeg_cas03: [205, 31], aldeg_cas04: [36, 217], aldeg_cas05: [27, 101],
    gefg_cas01: [197, 181], gefg_cas02: [176, 178], gefg_cas03: [244, 166], gefg_cas04: [174, 177], gefg_cas05: [194, 184],
    payg_cas01: [139, 139], payg_cas02: [38, 25], payg_cas03: [269, 265], payg_cas04: [270, 28], payg_cas05: [30, 30],
    prtg_cas01: [197, 197], prtg_cas02: [157, 174], prtg_cas03: [16, 220], prtg_cas04: [291, 14], prtg_cas05: [266, 266],
    // Second Edition castles (npc/woe-se/agit_main_se.txt).
    arug_cas01: [87, 219], arug_cas02: [89, 256], arug_cas03: [141, 293], arug_cas04: [141, 293], arug_cas05: [141, 293],
    schg_cas02: [162, 193], schg_cas03: [338, 202],
};

// Each WoE display model and its placement offset (in GAT cells) relative to the
// Emperium. The Emperium sits at the room cell; the guardians ring it, the flag
// and treasure stand just behind.
const WOE_LAYOUT: { name: string, dx: number, dy: number }[] = [
    { name: "empelium90_0", dx: 0, dy: 0 },
    { name: "kguardian90_7", dx: -4, dy: 0 },
    { name: "sguardian90_9", dx: 0, dy: -4 },
    { name: "aguardian90_8", dx: 4, dy: 0 },
    { name: "guildflag90_1", dx: -4, dy: 4 },
    { name: "treasurebox_2", dx: 4, dy: 4 },
];

// A baked .tex: 16-byte header ['G','T','E','X', u32 width, u32 height, u32
// flags] then width*height*4 RGBA bytes. Returns null on a bad/short header.
function parseTex(data: ArrayBufferSlice): DecodedImage | null {
    const view = data.createDataView();
    if (view.byteLength < 16 || view.getUint8(0) !== 0x47 || view.getUint8(1) !== 0x54 || view.getUint8(2) !== 0x45 || view.getUint8(3) !== 0x58)
        return null;
    const width = view.getUint32(4, true);
    const height = view.getUint32(8, true);
    if (width <= 0 || height <= 0 || view.byteLength < 16 + width * height * 4)
        return null;
    const rgba = data.createTypedArray(Uint8Array, 16, width * height * 4);
    return { width, height, rgba };
}

// Fallback ground height (the value the terrain mesh negates) at a GAT cell when
// no GAT is loaded: averages the containing GND cell's four corners. Used only
// for the no-GAT path; with a GAT we prefer gatCellSurfaceHeight, which follows
// the platform/staircase RSM props the Emperium room often sits on top of
// (averaging GND under a platformed castle floats or sinks the props).
function gndGroundHeight(gnd: GndMap, gatX: number, gatY: number): number {
    const gx = gatX >> 1, gy = gatY >> 1;
    if (gx < 0 || gy < 0 || gx >= gnd.width || gy >= gnd.height)
        return 0;
    const c = gnd.cells[gy * gnd.width + gx];
    return (c.height[0] + c.height[1] + c.height[2] + c.height[3]) * 0.25;
}

// Builds a model->world matrix. The Granny models are authored Z-up (tall axis
// +z, base at z≈0); the render frame is Y-up (the terrain stores world_y =
// -height to undo RO's inverted altitude, leaving the camera's +Y as up). So
// model up (+z) must map to render +Y, i.e. rotateX(-90°). (cx, cy) is the
// model's horizontal (footprint) centre in model space — subtracted so the model
// sits centred on the target cell rather than offset by its local origin. Then
// scale + position.
function placement(worldX: number, worldY: number, worldZ: number, scale: number, cx: number, cy: number): mat4 {
    const m = mat4.create();
    mat4.translate(m, m, [worldX, worldY, worldZ]);
    mat4.scale(m, m, [scale, scale, scale]);
    mat4.rotateX(m, m, -Math.PI / 2);
    mat4.translate(m, m, [-cx, -cy, 0]); // model-space recenter (footprint -> origin)
    return m;
}

// The model's horizontal footprint centre (model X/Y; +Z is up) across all meshes.
function footprintCentre(meshes: { positions: Float32Array, vertexCount: number }[]): [number, number] {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const me of meshes) {
        for (let i = 0; i < me.vertexCount; i++) {
            const x = me.positions[i * 3], y = me.positions[i * 3 + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    }
    if (!isFinite(minX)) return [0, 0];
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// True for guild-castle maps (where the WoE objects live).
export function isWoeCastleMap(mapId: string): boolean {
    return /_cas\d/.test(mapId) || mapId.includes("_cas");
}

// Fetches + builds the placed WoE Granny instances for a castle map. Returns []
// for non-castle maps or if the baked assets aren't staged. Failure-tolerant per
// model: a missing/unparseable .gr2 just drops that one. `gat` is optional —
// when present, it drives the per-cell walkable-surface height (so an Emperium
// in a platformed castle room sits on the platform, not on the GND under it).
export async function loadWoeGrannyModels(dataFetcher: DataFetcher, pathBase: string, mapId: string, gnd: GndMap, gat: GatMap | null): Promise<GrannyInstance[]> {
    if (!isWoeCastleMap(mapId))
        return [];

    // Anchor on the Emperium room cell (server GAT coords) if known, else the
    // map centre. The attribute grid is 2x the GND resolution, so the centre cell
    // is at (gnd.width, gnd.height).
    const anchor = EMPERIUM_ROOM[mapId] ?? [gnd.width, gnd.height];
    const cell = gnd.zoom / 2; // world units per GAT cell

    const instances: GrannyInstance[] = [];
    for (const layout of WOE_LAYOUT) {
        const name = layout.name;
        let gr2Data: ArrayBufferSlice;
        try {
            gr2Data = await dataFetcher.fetchData(`${pathBase}/model3d/${name}.gr2`, { allow404: true });
        } catch {
            continue;
        }
        let model;
        try {
            model = extractGrannyModel(parseGranny(gr2Data));
        } catch {
            continue;
        }
        if (model.meshes.length === 0)
            continue;

        // Load each texture slot (0..textureNames.length-1) and map per mesh.
        const texImages: (DecodedImage | null)[] = [];
        for (let t = 0; t < model.textureNames.length; t++) {
            try {
                const td = await dataFetcher.fetchData(`${pathBase}/model3d/${name}.${t}.tex`, { allow404: true });
                texImages.push(parseTex(td));
            } catch {
                texImages.push(null);
            }
        }
        const meshTextures = model.meshes.map((m) => (m.textureIndex >= 0 && m.textureIndex < texImages.length) ? texImages[m.textureIndex] : null);

        // Position relative to the Emperium room cell, grounded on the terrain
        // (same GAT-cell -> world mapping the NPC/mob placement uses). Use the
        // GAT cell's walkable-surface height when available — castle rooms are
        // commonly platformed (the Emperium sits on a raised dais), and the GAT
        // is authored to follow the prop the player walks on. The bare GND
        // fallback only applies when no GAT loaded.
        const gatX = anchor[0] + layout.dx;
        const gatY = anchor[1] + layout.dy;
        // X is mirrored about the map centre (RO is left-handed, this renderer
        // right-handed; see coord.ts), matching the terrain and RSM placements.
        const worldX = gnd.width * gnd.zoom - (gatX + 0.5) * cell;
        const worldZ = (gatY + 0.5) * cell;
        const surfaceHeight = gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gndGroundHeight(gnd, gatX, gatY);
        const worldY = -surfaceHeight;

        // Build the clip set the model cycles through.
        const animations: GrannyAnimation[] = [];
        if (!STATIC_MODELS.has(name)) {
            if (model.animations[0])
                animations.push(model.animations[0]); // embedded idle
            const clipId = GUARDIAN_CLIP_ID[name];
            if (clipId !== undefined) {
                for (const action of GUARDIAN_ACTIONS) {
                    try {
                        const cd = await dataFetcher.fetchData(`${pathBase}/model3d/${clipId}_${action}.gr2`, { allow404: true });
                        const clip = extractGrannyModel(parseGranny(cd));
                        if (clip.animations[0])
                            animations.push(clip.animations[0]);
                    } catch {
                        // Missing action clip just drops from the cycle.
                    }
                }
            }
        }

        const [cx, cy] = footprintCentre(model.meshes);
        // Mirror the model's own geometry/normals in place (negate the X-output
        // row's linear part, keep the already-mirrored translation) so the prop
        // faces correctly in the X-mirrored world; the sun's X is negated to match.
        const worldMatrix = placement(worldX, worldY, worldZ, GRANNY_WORLD_SCALE, cx, cy);
        worldMatrix[0] = -worldMatrix[0]; worldMatrix[4] = -worldMatrix[4]; worldMatrix[8] = -worldMatrix[8];
        instances.push({
            meshes: model.meshes,
            textures: meshTextures,
            worldMatrix,
            // The skeleton drives skinning; the clips (idle + any action clips)
            // are cycled. Empty clip list / null skeleton -> drawn rigid.
            skeleton: model.skeletons[0] ?? null,
            animations,
        });
    }
    return instances;
}
