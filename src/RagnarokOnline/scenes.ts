
// Scene registry for Ragnarok Online maps. A single SceneDesc covers any map
// by base name; the loader fetches the .rsw (ground + model placements),
// decodes textures, builds unique RSM meshes, and composes the scene.

import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { DecodedImage, decodeBMP, decodeTGA } from "./bmp.js";
import { parseGND, textureNameToUrl } from "./gnd.js";
import { GatMap, parseGAT } from "./gat.js";
import { AnimatedModelMesh, buildAnimatedModelMesh, buildModelMesh, buildPlacementMatrix, modelIsAnimated, ModelMesh } from "./model.js";
import { AnimatedModelPlacement, FogSceneData, LightSceneData, ModelPlacement, ModelSceneData, RagnarokTerrainRenderer as RaganarokRenderer, WarpClickSceneData, WarpTarget, WaterSceneData } from "./render.js";
import { parseRSM } from "./rsm.js";
import { computeLightDir, parseRSW } from "./rsw.js";
import { decodeImageBitmapRGBA } from "./water.js";
import { loadEntities, loadEffectSources } from "./entity.js";
import { loadWarpPortals } from "./warp-portal.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight, GAT_CELL_SIZE, GND_CELL_SIZE } from "./coord.js";
import { vec3 } from "gl-matrix";
import { loadWoeGrannyModels } from "./granny-scene.js";
import { loadPointLights } from "./lights.js";
import { maps } from "./maps.js";
import { mapCategory, MapCategory, mapWantsFog, mapWeather } from "./mapcategory.js";
import { eraOf, eraSharedKey, eraSuffix, fetchEraOrBare, resolveWarpDest } from "./era.js";
import { SNOW_PARAMS, WeatherParams } from "./weather.js";
import { buildSkyData } from "./sky.js";
import { loadParticles } from "./particles.js";
import { Bgm } from "./bgm.js";

// Water animation frames live in textures/워터/water<type><NN>.jpg, NN=00..31.
const WATER_DIR = "워터";
const WATER_FRAME_COUNT = 32;

const pathBase = `RagnarokOnline`;

// Floor on a warp's world hit radius so a 1x1-cell warp is still easy to click.
const WARP_MIN_HIT_RADIUS = 8;

function modelNameToUrl(name: string): string {
    return name.split("\\").map(encodeURIComponent).join("/");
}

function decodeTexture(name: string, data: ArrayBufferSlice): DecodedImage {
    return name.toLowerCase().endsWith(".tga") ? decodeTGA(data) : decodeBMP(data);
}

class RagnarokMapSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;

        // Era-aware: try the era-specific asset first, fall back to the bare
        // file. Most era-divergent maps share geometry (only the NPC manifest
        // differs); a genuinely-rebuilt map ships its own .rsw/.gnd/.gat.
        let rswData;
        try {
            rswData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, this.id, ".rsw");
        } catch {
            throw new Error(`Ragnarok map "${this.id}" is not available (its assets aren't on the CDN).`);
        }
        const rsw = parseRSW(rswData);

        const baseGnd = rsw.gndFile !== "" ? rsw.gndFile.replace(/\.gnd$/i, "") : eraSharedKey(this.id);
        const gndAssetId = `${baseGnd}${eraSuffix(this.id)}`;
        const gndData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, gndAssetId, ".gnd");
        const gnd = parseGND(gndData);

        // Missing texture: silently skip the draw group. Decode failure: log
        // (real bug we want to see) rather than swallow alongside 404s.
        const textureImages: (DecodedImage | null)[] = await Promise.all(gnd.textureNames.map(async (name): Promise<DecodedImage | null> => {
            const url = `${pathBase}/textures/${textureNameToUrl(name)}`;
            let data;
            try {
                data = await dataFetcher.fetchData(url);
            } catch {
                return null;
            }
            try {
                return decodeTexture(name, data);
            } catch (e) {
                console.error(`RagnarokOnline: failed to decode terrain texture ${url}:`, e);
                return null;
            }
        }));

        // Shared decoded-texture cache: many models reference the same BMPs.
        const texCache = new Map<string, DecodedImage | null>();
        const fetchTexture = async (name: string): Promise<DecodedImage | null> => {
            const url = textureNameToUrl(name);
            if (texCache.has(url))
                return texCache.get(url)!;
            const fullUrl = `${pathBase}/textures/${url}`;
            let img: DecodedImage | null = null;
            let data;
            try {
                data = await dataFetcher.fetchData(fullUrl);
            } catch {
                texCache.set(url, null);
                return null;
            }
            try {
                img = decodeTexture(name, data);
            } catch (e) {
                console.error(`RagnarokOnline: failed to decode model texture ${fullUrl}:`, e);
                img = null;
            }
            texCache.set(url, img);
            return img;
        };

        // Models with keyframe tracks take the animated path.
        const meshes = new Map<string, { mesh: ModelMesh, textures: (DecodedImage | null)[] }>();
        const animatedMeshes = new Map<string, { mesh: AnimatedModelMesh, textures: (DecodedImage | null)[] }>();
        const uniqueModels = new Set<string>();
        for (const p of rsw.models)
            if (p.modelName !== "")
                uniqueModels.add(p.modelName);

        await Promise.all(Array.from(uniqueModels).map(async (modelName) => {
            try {
                const data = await dataFetcher.fetchData(`${pathBase}/model/${modelNameToUrl(modelName)}`);
                const rsm = parseRSM(data);
                if (modelIsAnimated(rsm)) {
                    const mesh = buildAnimatedModelMesh(rsm);
                    const textures = await Promise.all(mesh.textureNames.map((n) => fetchTexture(n)));
                    animatedMeshes.set(modelName, { mesh, textures });
                } else {
                    const mesh = buildModelMesh(rsm);
                    const textures = await Promise.all(mesh.textureNames.map((n) => fetchTexture(n)));
                    meshes.set(modelName, { mesh, textures });
                }
            } catch {
                // Skip unreadable/unparseable models; placements drop out.
            }
        }));

        // Half the map extent: RSW is map-centred, terrain is corner-origin.
        const mapOffX = gnd.width * GND_CELL_SIZE * 0.5;
        const mapOffZ = gnd.height * GND_CELL_SIZE * 0.5;

        const instances: ModelPlacement[] = [];
        const animatedInstances: AnimatedModelPlacement[] = [];
        for (const p of rsw.models) {
            const staticEntry = meshes.get(p.modelName);
            if (staticEntry !== undefined) {
                const world = mat4.create();
                buildPlacementMatrix(staticEntry.mesh.bbox, p.pos, p.rot, p.scale, mapOffX, mapOffZ, world);
                instances.push({ modelKey: p.modelName, worldMatrix: world });
                continue;
            }
            const animEntry = animatedMeshes.get(p.modelName);
            if (animEntry !== undefined) {
                const placement = mat4.create();
                buildPlacementMatrix(animEntry.mesh.bbox, p.pos, p.rot, p.scale, mapOffX, mapOffZ, placement);
                animatedInstances.push({ modelKey: p.modelName, placementMatrix: placement, animSpeed: p.animSpeed });
            }
        }

        const modelData: ModelSceneData = { meshes, instances, animatedMeshes, animatedInstances };

        // GND vs RSW water-type precedence: 1.8+ GNDs carry their own water
        // params which usually agree with the RSW. When they disagree (a GND
        // references a tile set the staged corpus doesn't have), trusting GND
        // unconditionally kills the map's water. Try GND first; if no frames
        // load, fall back to the RSW's type.
        const rswWater = {
            level: rsw.waterLevel,
            type: rsw.waterType,
            animSpeed: rsw.waterAnimSpeed,
            wavePitch: rsw.wavePitch,
            waveSpeed: rsw.waveSpeed,
            waveHeight: rsw.waveHeight,
        };
        const waterParams = gnd.water ?? rswWater;
        const loadWaterFrames = async (waterType: number): Promise<(DecodedImage | null)[]> => Promise.all(
            Array.from({ length: WATER_FRAME_COUNT }, (_unused, i) => i).map(async (i): Promise<DecodedImage | null> => {
                const nn = i.toString().padStart(2, "0");
                const url = `${WATER_DIR}/water${waterType}${nn}.jpg`.split("/").map(encodeURIComponent).join("/");
                try {
                    const data = await dataFetcher.fetchData(`${pathBase}/textures/${url}`);
                    return decodeImageBitmapRGBA(data.createTypedArray(Uint8Array));
                } catch {
                    return null;
                }
            }),
        );
        let frames = await loadWaterFrames(waterParams.type);
        if (!frames.some((f) => f !== null) && gnd.water !== undefined && rswWater.type !== waterParams.type) {
            const fallback = await loadWaterFrames(rswWater.type);
            if (fallback.some((f) => f !== null))
                frames = fallback;
        }

        const waterData: WaterSceneData | null = frames.some((f) => f !== null) ? {
            gndWidth: gnd.width,
            gndHeight: gnd.height,
            zoom: GND_CELL_SIZE,
            params: {
                level: waterParams.level,
                animSpeed: waterParams.animSpeed,
                wavePitch: waterParams.wavePitch,
                waveSpeed: waterParams.waveSpeed,
                waveHeight: waterParams.waveHeight,
            },
            frames,
        } : null;

        // Sun X is negated because the world is mirrored about X (see coord.ts).
        const sunDir = computeLightDir(rsw.longitude, rsw.latitude);
        sunDir[0] = -sunDir[0];
        const lightData: LightSceneData = {
            lightDir: sunDir,
            diffuse: [rsw.diffuse.x, rsw.diffuse.y, rsw.diffuse.z],
            ambient: [rsw.ambient.x, rsw.ambient.y, rsw.ambient.z],
        };

        // Fog table doubles as the sky colour (always applied when present).
        // The fog *tint* over geometry only reads as atmosphere inside
        // dungeons, so it's gated by mapWantsFog. Era-shared: bare base id.
        let fogTableColor: [number, number, number] | null = null;
        let fogTableDensity: number = 0;
        try {
            const fogRaw = await dataFetcher.fetchData(`${pathBase}/maps/${eraSharedKey(this.id)}.fog.json`, { allow404: true });
            const fogText = new TextDecoder().decode(fogRaw.createTypedArray(Uint8Array));
            const fog = JSON.parse(fogText) as { start: number, end: number, color: string, density: number };
            const argb = parseInt(fog.color, 16) >>> 0;
            const r = ((argb >>> 16) & 0xff) / 255;
            const g = ((argb >>> 8) & 0xff) / 255;
            const b = (argb & 0xff) / 255;
            fogTableColor = [r, g, b];
            fogTableDensity = Math.min(Math.max(fog.density, 0), 0.45);
        } catch {
            // No fog entry: sky falls back to a category default, tint off.
        }

        const fogData: FogSceneData = (fogTableColor !== null && mapWantsFog(this.id))
            ? { enabled: true, color: fogTableColor, tint: fogTableDensity }
            : { enabled: false, color: [0, 0, 0], tint: 0 };

        // The sky dome wants a vector FROM the ground TOWARD the sun. `sunDir`
        // is the propagation direction (already X-mirrored), so negate it.
        const skyData = buildSkyData(this.id, fogTableColor, [-sunDir[0], -sunDir[1], -sunDir[2]]);

        // A missing/unparseable GAT just disables mob wandering.
        let gat: GatMap | null = null;
        try {
            const gatData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, this.id, ".gat");
            gat = parseGAT(gatData);
        } catch {
            gat = null;
        }

        const entityData = await loadEntities(dataFetcher, pathBase, this.id, gnd, gat);

        // Effect sources share the entity sprite renderer; offset their
        // placement indices past the existing entity sprites.
        const effectSources = await loadEffectSources(dataFetcher, pathBase, rsw.effects, mapOffX, mapOffZ);
        if (effectSources.sprites.length > 0) {
            const spriteBase = entityData.sprites.length;
            for (const ls of effectSources.sprites)
                entityData.sprites.push(ls);
            for (const p of effectSources.placements)
                entityData.placements.push({ ...p, spriteIndex: p.spriteIndex + spriteBase });
        }

        const warpPortalData = await loadWarpPortals(dataFetcher, pathBase, entityData.warps, gnd, gat);

        // Stays in sync with the portal renderer's placement choice.
        const gatHeight = (gatX: number, gatY: number): number =>
            gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gatCellGroundHeight(gnd, gatX, gatY);
        const sourceEra = eraOf(this.id);
        const warpTargets: WarpTarget[] = entityData.warps.map((w) => {
            const wp = gatCellToWorld(w.cellX, w.cellY, gatHeight(w.cellX, w.cellY), gnd.width);
            const spanCells = Math.max(w.spanX, w.spanY);
            const radius = Math.max(spanCells * GAT_CELL_SIZE, WARP_MIN_HIT_RADIUS);
            const dest = resolveWarpDest(w.dest, w.destEra, sourceEra);
            // Intra-map warps: pre-resolve arrival world pos so the click
            // teleports without a scene reload. Compare the RESOLVED dest so
            // era-aware self-warps still match.
            let arrivalWorldPos: vec3 | undefined;
            if (dest === this.id && w.destX !== undefined && w.destY !== undefined) {
                const ap = gatCellToWorld(w.destX, w.destY, gatHeight(w.destX, w.destY), gnd.width);
                arrivalWorldPos = vec3.fromValues(ap[0], ap[1], ap[2]);
            }
            return {
                worldPos: vec3.fromValues(wp[0], wp[1], wp[2]),
                radius,
                dest,
                arrivalCellX: w.destX,
                arrivalCellY: w.destY,
                arrivalWorldPos,
            };
        });

        const warpClickData: WarpClickSceneData = { targets: warpTargets };

        const grannyData = await loadWoeGrannyModels(dataFetcher, pathBase, eraSharedKey(this.id), gnd, gat);

        let weatherParams: WeatherParams | null = null;
        if (mapWeather(this.id) === "snow")
            weatherParams = SNOW_PARAMS;

        const pointLights = loadPointLights(rsw, gnd);

        const particleData = await loadParticles(dataFetcher, pathBase, eraSharedKey(this.id), mapOffX, mapOffZ);

        const bgm = new Bgm("RagnarokOnline");
        void bgm.setMap(dataFetcher, eraSharedKey(this.id));

        return new RaganarokRenderer(context, gnd, textureImages, modelData, waterData, lightData, fogData, entityData, warpPortalData, grannyData, weatherParams, warpClickData, pointLights, skyData, particleData, bgm);
    }
}

// String entries in sceneDescs render as headers in the scene list.
const CATEGORY_ORDER: { cat: MapCategory, label: string }[] = [
    { cat: "city", label: "Cities & Towns" },
    { cat: "field", label: "Fields" },
    { cat: "dungeon", label: "Dungeons" },
    { cat: "indoor", label: "Indoors" },
    { cat: "castle", label: "Guild Castles (WoE)" },
    { cat: "instance", label: "Instances & Special" },
    { cat: "other", label: "Other" },
];

const sceneDescs: (string | SceneDesc)[] = [];
for (const { cat, label } of CATEGORY_ORDER) {
    const inCat = maps.filter((m) => mapCategory(m.id) === cat);
    if (inCat.length === 0)
        continue;
    sceneDescs.push(label);
    for (const m of inCat)
        sceneDescs.push(new RagnarokMapSceneDesc(m.id, m.name));
}

export const sceneGroup: SceneGroup = {
    id: "RagnarokOnline",
    name: "Ragnarok Online",
    sceneDescs,
};
