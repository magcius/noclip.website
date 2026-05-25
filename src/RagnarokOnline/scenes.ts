
// Scene registry for Ragnarok Online maps. A single SceneDesc covers any map
// by base name; the loader fetches the .rsw (ground + model placements),
// decodes textures, builds unique RSM meshes, and composes the scene.

import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DataFetcher } from "../DataFetcher.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { Destroyable, SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { DecodedImage, decodeBMP, decodeTGA } from "./bmp.js";
import { parseGND, textureNameToUrl } from "./gnd.js";
import { GatMap, parseGAT } from "./gat.js";
import { AnimatedModelMesh, buildAnimatedModelMesh, buildModelMesh, buildPlacementMatrix, modelIsAnimated, ModelMesh } from "./model.js";
import { AnimatedModelPlacement, EntityLayerBundle, FogSceneData, FOG_DEFAULT_COLOR_UNFOGGED, FOG_DEFAULT_TINT_UNFOGGED, LightSceneData, ModelPlacement, ModelSceneData, RagnarokTerrainRenderer, WarpClickSceneData, WarpTarget, WaterSceneData } from "./render.js";
import { parseRSM } from "./rsm.js";
import { parseRSW } from "./rsw.js";
import { decodeImageBitmapRGBA } from "./water.js";
import { loadEntities, loadEffectSources } from "./entity.js";
import { loadWarpPortals } from "./warp-portal.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight, GAT_CELL_SIZE, GND_CELL_SIZE } from "./coord.js";
import { vec3 } from "gl-matrix";
import { loadWoeGrannyModels } from "./granny-scene.js";
import { loadPointLights } from "./lights.js";
import { maps } from "./maps.js";
import { mapCategory, MapCategory, mapWantsFog, mapWeather } from "./mapcategory.js";
import { currentEra } from "./era.js";
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
    return name.toLowerCase().split("\\").map(encodeURIComponent).join("/");
}

function decodeTexture(name: string, data: ArrayBufferSlice): DecodedImage {
    return name.toLowerCase().endsWith(".tga") ? decodeTGA(data) : decodeBMP(data);
}

// Cross-scene cache held in DataShare. Adjacent maps reuse the same terrain
// BMPs, model RSMs and water frames; without this every map switch re-fetched
// and re-decoded them. Stored as in-flight Promises so concurrent requests
// collapse to a single fetch. Holds no GPU state (GfxTextures live on the
// per-scene renderer), so destroy() is a no-op; DataShare prunes by age.
interface SharedModelEntry {
    mesh: ModelMesh | null;
    animatedMesh: AnimatedModelMesh | null;
    textures: (DecodedImage | null)[];
}

class RagnarokSharedCache implements Destroyable {
    public textures = new Map<string, Promise<DecodedImage | null>>();
    public waterFrames = new Map<number, Promise<(DecodedImage | null)[]>>();
    public models = new Map<string, Promise<SharedModelEntry | null>>();

    public fetchTexture(dataFetcher: DataFetcher, url: string): Promise<DecodedImage | null> {
        let p = this.textures.get(url);
        if (p !== undefined)
            return p;
        p = (async (): Promise<DecodedImage | null> => {
            let data;
            try {
                data = await dataFetcher.fetchData(url);
            } catch {
                return null;
            }
            try {
                return decodeTexture(url, data);
            } catch (e) {
                console.error(`RagnarokOnline: failed to decode texture ${url}:`, e);
                return null;
            }
        })();
        this.textures.set(url, p);
        return p;
    }

    public destroy(_device: GfxDevice): void {
        // CPU-only data; GC reclaims it once the cache is dropped.
    }
}

class RagnarokMapSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const shared = await context.dataShare.ensureObject(
            `${pathBase}/SharedCache`,
            async () => new RagnarokSharedCache(),
        );

        let rswData;
        try {
            rswData = await dataFetcher.fetchData(`${pathBase}/maps/${this.id}.rsw`);
        } catch {
            throw new Error(`Ragnarok map "${this.id}" is not available (its assets aren't on the CDN).`);
        }
        const rsw = parseRSW(rswData);

        const baseGnd = rsw.gndFile !== "" ? rsw.gndFile.replace(/\.gnd$/i, "") : this.id;
        const gndData = await dataFetcher.fetchData(`${pathBase}/maps/${baseGnd}.gnd`);
        const gnd = parseGND(gndData);

        // Missing texture: silently skip the draw group. Decode failure: log
        // (real bug we want to see) rather than swallow alongside 404s. The
        // shared cache dedupes within and across maps.
        const fetchTextureByName = (name: string): Promise<DecodedImage | null> =>
            shared.fetchTexture(dataFetcher, `${pathBase}/textures/${textureNameToUrl(name)}`);
        const textureImages: (DecodedImage | null)[] = await Promise.all(
            gnd.textureNames.map((n) => fetchTextureByName(n)),
        );

        // Models with keyframe tracks take the animated path. The cache stores
        // the parsed mesh + resolved textures, so a revisit skips fetch + parse.
        const uniqueModels = new Set<string>();
        for (const p of rsw.models)
            if (p.modelName !== "")
                uniqueModels.add(p.modelName);

        const loadModel = (modelName: string): Promise<SharedModelEntry | null> => {
            const key = modelName.toLowerCase();
            let p = shared.models.get(key);
            if (p !== undefined)
                return p;
            p = (async (): Promise<SharedModelEntry | null> => {
                let data;
                try {
                    data = await dataFetcher.fetchData(`${pathBase}/model/${modelNameToUrl(modelName)}`);
                } catch {
                    return null;
                }
                try {
                    const rsm = parseRSM(data);
                    if (modelIsAnimated(rsm)) {
                        const animatedMesh = buildAnimatedModelMesh(rsm);
                        const textures = await Promise.all(animatedMesh.textureNames.map((n) => fetchTextureByName(n)));
                        return { mesh: null, animatedMesh, textures };
                    } else {
                        const mesh = buildModelMesh(rsm);
                        const textures = await Promise.all(mesh.textureNames.map((n) => fetchTextureByName(n)));
                        return { mesh, animatedMesh: null, textures };
                    }
                } catch {
                    return null;
                }
            })();
            shared.models.set(key, p);
            return p;
        };

        const meshes = new Map<string, { mesh: ModelMesh, textures: (DecodedImage | null)[] }>();
        const animatedMeshes = new Map<string, { mesh: AnimatedModelMesh, textures: (DecodedImage | null)[] }>();
        await Promise.all(Array.from(uniqueModels).map(async (modelName) => {
            const entry = await loadModel(modelName);
            if (entry === null)
                return;
            if (entry.animatedMesh !== null)
                animatedMeshes.set(modelName, { mesh: entry.animatedMesh, textures: entry.textures });
            else if (entry.mesh !== null)
                meshes.set(modelName, { mesh: entry.mesh, textures: entry.textures });
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
        const loadWaterFrames = (waterType: number): Promise<(DecodedImage | null)[]> => {
            let p = shared.waterFrames.get(waterType);
            if (p !== undefined)
                return p;
            p = Promise.all(
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
            shared.waterFrames.set(waterType, p);
            return p;
        };
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

        const lightData: LightSceneData = {
            diffuse: vec3.fromValues(rsw.diffuse.x, rsw.diffuse.y, rsw.diffuse.z),
            ambient: vec3.fromValues(rsw.ambient.x, rsw.ambient.y, rsw.ambient.z),
            longitudeDeg: rsw.longitude,
            pitchDeg: rsw.latitude,
        };

        // Fog table doubles as the sky colour (always applied when present).
        // The fog tint over geometry only reads as atmosphere inside dungeons,
        // so it's gated by mapWantsFog.
        let fogTableColor: vec3 | null = null;
        let fogTableDensity: number = 0;
        try {
            const fogRaw = await dataFetcher.fetchData(`${pathBase}/maps/${this.id}.fog.json`, { allow404: true });
            const fogText = new TextDecoder().decode(fogRaw.createTypedArray(Uint8Array));
            const fog = JSON.parse(fogText) as { start: number, end: number, color: string, density: number };
            const argb = parseInt(fog.color, 16) >>> 0;
            const r = ((argb >>> 16) & 0xff) / 255;
            const g = ((argb >>> 8) & 0xff) / 255;
            const b = (argb & 0xff) / 255;
            fogTableColor = vec3.fromValues(r, g, b);
            fogTableDensity = Math.min(Math.max(fog.density, 0), 0.45);
        } catch {
            // No fog entry: sky falls back to a category default, tint off.
        }

        const fogData: FogSceneData = {
            enabled: fogTableColor !== null && mapWantsFog(this.id),
            color: fogTableColor !== null ? vec3.clone(fogTableColor) : vec3.clone(FOG_DEFAULT_COLOR_UNFOGGED),
            tint: fogTableColor !== null ? fogTableDensity : FOG_DEFAULT_TINT_UNFOGGED,
        };

        const skyData = buildSkyData(this.id, fogTableColor);

        // A missing/unparseable GAT just disables mob wandering.
        let gat: GatMap | null = null;
        try {
            const gatData = await dataFetcher.fetchData(`${pathBase}/maps/${this.id}.gat`);
            gat = parseGAT(gatData);
        } catch {
            gat = null;
        }

        // Effect sources are era-invariant (loaded once, merged into the entity
        // sprite layer on every era swap).
        const effectSources = await loadEffectSources(dataFetcher, pathBase, rsw.effects, mapOffX, mapOffZ);

        const gatHeight = (gatX: number, gatY: number): number =>
            gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gatCellGroundHeight(gnd, gatX, gatY);
        const buildWarpTargets = (warps: typeof entityData.warps): WarpTarget[] => warps.map((w) => {
            const wp = gatCellToWorld(w.cellX, w.cellY, gatHeight(w.cellX, w.cellY), gnd.width);
            const spanCells = Math.max(w.spanX, w.spanY);
            const radius = Math.max(spanCells * GAT_CELL_SIZE, WARP_MIN_HIT_RADIUS);
            let arrivalWorldPos: vec3 | undefined;
            if (w.dest === this.id && w.destX !== undefined && w.destY !== undefined) {
                const ap = gatCellToWorld(w.destX, w.destY, gatHeight(w.destX, w.destY), gnd.width);
                arrivalWorldPos = vec3.fromValues(ap[0], ap[1], ap[2]);
            }
            return {
                worldPos: vec3.fromValues(wp[0], wp[1], wp[2]),
                radius,
                dest: w.dest,
                arrivalCellX: w.destX,
                arrivalCellY: w.destY,
                arrivalWorldPos,
            };
        });

        const buildLayer = async (): Promise<EntityLayerBundle> => {
            const ed = await loadEntities(dataFetcher, pathBase, this.id, currentEra(), gnd, gat);
            if (effectSources.sprites.length > 0) {
                const spriteBase = ed.sprites.length;
                for (const ls of effectSources.sprites)
                    ed.sprites.push(ls);
                for (const p of effectSources.placements)
                    ed.placements.push({ ...p, spriteIndex: p.spriteIndex + spriteBase });
            }
            const wpd = await loadWarpPortals(dataFetcher, pathBase, ed.warps, gnd, gat);
            return { entityData: ed, warpPortalData: wpd, warpClickData: { targets: buildWarpTargets(ed.warps) } };
        };

        const { entityData, warpPortalData, warpClickData } = await buildLayer();

        const grannyData = await loadWoeGrannyModels(dataFetcher, pathBase, this.id, gnd, gat);

        let weatherParams: WeatherParams | null = null;
        if (mapWeather(this.id) === "snow")
            weatherParams = SNOW_PARAMS;

        const pointLights = loadPointLights(rsw, gnd);

        const particleData = await loadParticles(dataFetcher, pathBase, this.id, mapOffX, mapOffZ);

        const bgm = new Bgm("RagnarokOnline");
        void bgm.setMap(dataFetcher, this.id);

        return new RagnarokTerrainRenderer(device, gnd, textureImages, modelData, waterData, lightData, fogData, entityData, warpPortalData, grannyData, weatherParams, warpClickData, pointLights, skyData, particleData, bgm, context.sceneLoader, buildLayer);
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
