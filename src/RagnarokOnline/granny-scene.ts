import { mat4 } from "gl-matrix";
import { DataFetcher } from "../DataFetcher.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DecodedImage } from "./bmp.js";
import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";
import { gatCellSurfaceHeight, GAT_CELL_SIZE, GND_CELL_SIZE } from "./coord.js";
import { extractGrannyModel, GrannyAnimation, parseGranny } from "./granny.js";
import { GrannyInstance } from "./granny-render.js";

const GUARDIAN_CLIP_ID: { [model: string]: string } = {
    kguardian90_7: "7", aguardian90_8: "8", sguardian90_9: "9",
};
const GUARDIAN_ACTIONS = ["move", "attack", "damage"];

const STATIC_MODELS = new Set(["treasurebox_2"]);

const GRANNY_WORLD_SCALE = 1.0;

const EMPERIUM_ROOM: { [mapId: string]: [number, number] } = {
    aldeg_cas01: [216, 23], aldeg_cas02: [213, 23], aldeg_cas03: [205, 31], aldeg_cas04: [36, 217], aldeg_cas05: [27, 101],
    gefg_cas01: [197, 181], gefg_cas02: [176, 178], gefg_cas03: [244, 166], gefg_cas04: [174, 177], gefg_cas05: [194, 184],
    payg_cas01: [139, 139], payg_cas02: [38, 25], payg_cas03: [269, 265], payg_cas04: [270, 28], payg_cas05: [30, 30],
    prtg_cas01: [197, 197], prtg_cas02: [157, 174], prtg_cas03: [16, 220], prtg_cas04: [291, 14], prtg_cas05: [266, 266],
    arug_cas01: [87, 219], arug_cas02: [89, 256], arug_cas03: [141, 293], arug_cas04: [141, 293], arug_cas05: [141, 293],
    schg_cas02: [162, 193], schg_cas03: [338, 202],
};

const WOE_LAYOUT: { name: string, dx: number, dy: number }[] = [
    { name: "empelium90_0", dx: 0, dy: 0 },
    { name: "kguardian90_7", dx: -4, dy: 0 },
    { name: "sguardian90_9", dx: 0, dy: -4 },
    { name: "aguardian90_8", dx: 4, dy: 0 },
    { name: "guildflag90_1", dx: -4, dy: 4 },
    { name: "treasurebox_2", dx: 4, dy: 4 },
];

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

function placement(worldX: number, worldY: number, worldZ: number, scale: number, cx: number, cy: number): mat4 {
    const m = mat4.create();
    mat4.translate(m, m, [worldX, worldY, worldZ]);
    mat4.scale(m, m, [scale, scale, scale]);
    mat4.rotateX(m, m, -Math.PI / 2);
    mat4.translate(m, m, [-cx, -cy, 0]);
    return m;
}

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

export async function loadWoeGrannyModels(dataFetcher: DataFetcher, pathBase: string, mapId: string, gnd: GndMap, gat: GatMap | null): Promise<GrannyInstance[]> {
    const anchor = EMPERIUM_ROOM[mapId];
    if (anchor === undefined)
        return [];
    if (gat === null)
        return [];

    const instances: GrannyInstance[] = [];
    for (const layout of WOE_LAYOUT) {
        const name = layout.name;
        const gr2Data = await dataFetcher.fetchData(`${pathBase}/model3d/${name}.gr2`);
        const model = extractGrannyModel(parseGranny(gr2Data));

        const texImages: (DecodedImage | null)[] = [];
        for (let t = 0; t < model.textureNames.length; t++) {
            const td = await dataFetcher.fetchData(`${pathBase}/model3d/${name}.${t}.tex`);
            texImages.push(parseTex(td));
        }
        const meshTextures = model.meshes.map((m) => (m.textureIndex >= 0 && m.textureIndex < texImages.length) ? texImages[m.textureIndex] : null);

        const gatX = anchor[0] + layout.dx;
        const gatY = anchor[1] + layout.dy;

        const worldX = gnd.width * GND_CELL_SIZE - (gatX + 0.5) * GAT_CELL_SIZE;
        const worldZ = (gatY + 0.5) * GAT_CELL_SIZE;
        const worldY = -gatCellSurfaceHeight(gat, gatX, gatY);

        const animations: GrannyAnimation[] = [];
        if (!STATIC_MODELS.has(name)) {
            if (model.animations[0])
                animations.push(model.animations[0]);
            const clipId = GUARDIAN_CLIP_ID[name];
            if (clipId !== undefined) {
                for (const action of GUARDIAN_ACTIONS) {
                    try {
                        const cd = await dataFetcher.fetchData(`${pathBase}/model3d/${clipId}_${action}.gr2`, { allow404: true });
                        const clip = extractGrannyModel(parseGranny(cd));
                        if (clip.animations[0])
                            animations.push(clip.animations[0]);
                    } catch {

                    }
                }
            }
        }

        const [cx, cy] = footprintCentre(model.meshes);
        const worldMatrix = placement(worldX, worldY, worldZ, GRANNY_WORLD_SCALE, cx, cy);

        worldMatrix[0] = -worldMatrix[0]; worldMatrix[4] = -worldMatrix[4]; worldMatrix[8] = -worldMatrix[8];
        instances.push({
            meshes: model.meshes,
            textures: meshTextures,
            worldMatrix,
            skeleton: model.skeletons[0] ?? null,
            animations,
        });
    }
    return instances;
}
