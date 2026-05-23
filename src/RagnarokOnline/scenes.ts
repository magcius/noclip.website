
// Scene registry for Ragnarok Online maps.
//
// A single generic SceneDesc describes any map by its base name. The loader
// fetches the map's .rsw (which names the .gnd ground and lists every model
// placement), parses the ground, decodes the terrain textures, then pulls each
// unique RSM prop, builds its mesh, decodes its textures, and lays out one world
// matrix per placement. Terrain + props render in one depth-tested pass.

import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { DecodedImage, decodeBMP, decodeTGA } from "./bmp.js";
import { parseGND, textureNameToUrl } from "./gnd.js";
import { GatMap, parseGAT } from "./gat.js";
import { AnimatedModelMesh, buildAnimatedModelMesh, buildModelMesh, buildPlacementMatrix, modelIsAnimated, ModelMesh } from "./model.js";
import { AnimatedModelInstance, FogSceneData, LightSceneData, ModelInstance, ModelSceneData, RagnarokTerrainRenderer, WarpClickSceneData, WarpTarget, WaterSceneData } from "./render.js";
import { parseRSM } from "./rsm.js";
import { computeLightDir, parseRSW } from "./rsw.js";
import { decodeImageBitmapRGBA } from "./water.js";
import { loadEntities, loadEffectSources } from "./entity.js";
import { loadWarpPortals } from "./warp-portal.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight } from "./coord.js";
import { takePendingArrival } from "./travel.js";
import { vec3 } from "gl-matrix";
import { loadWoeGrannyModels } from "./granny-scene.js";
import { loadPointLights } from "./lights.js";
import { maps } from "./maps.js";
import { mapCategory, MapCategory, mapWantsFog, mapWeather } from "./mapcategory.js";
import { eraOf, eraSharedKey, eraSuffix, fetchEraOrBare, resolveWarpDest } from "./era.js";
import { SNOW_PARAMS, WeatherParams } from "./weather.js";
import { buildSkyData } from "./sky.js";
import { loadParticles } from "./particles.js";
import * as BGM from "./bgm.js";

BGM.setBgmPathBase("RagnarokOnline");

// The water animation frames live in the texture tree under the (CP949) "워터"
// directory as water<type><NN>.jpg, NN = 00..31. The renderer fetches them at
// the same normalized path the extractor writes.
const WATER_DIR = "워터";
const WATER_FRAME_COUNT = 32;

const pathBase = `RagnarokOnline`;

// Floor on a warp's world hit radius (so a 1x1-cell warp is still easy to
// click). Mirrors the renderer's pick floor.
const WARP_MIN_HIT_RADIUS = 8;

// Reconstructs the fetch URL for an RSM model from its CP949-decoded RSW name
// (backslashes -> '/', each segment percent-encoded). Mirrors textureNameToUrl
// and the layout the extractor writes under model/.
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

        // The RSW is the map's root: it names the GND and lists model placements.
        // Only a subset of the corpus is staged locally/on the CDN, so a missing
        // map's root fetch will 404 here. Turn that into a clear error (the loader
        // surfaces it without taking the app down) rather than the bare null
        // rejection DataFetcher produces on a non-success status.
        //
        // Era-aware scenes (e.g. `geffen@classic`) try the era-specific asset
        // first and fall back to the bare file: most era-divergent maps share
        // the SAME geometry between eras (only the NPC manifest differs), so we
        // avoid duplicating ~700MB of identical .rsw/.gnd/.gat across hundreds
        // of maps. A genuinely-rebuilt map (Gravity's in-place Geffen remodel)
        // is the case where the era-specific file actually exists and wins.
        let rswData;
        try {
            rswData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, this.id, ".rsw");
        } catch {
            throw new Error(`Ragnarok map "${this.id}" is not available (its assets aren't on the CDN).`);
        }
        const rsw = parseRSW(rswData);

        // The GND filename comes from the RSW; fall back to the map id if
        // absent. Era-aware again with the bare-asset fallback.
        const baseGnd = rsw.gndFile !== "" ? rsw.gndFile.replace(/\.gnd$/i, "") : eraSharedKey(this.id);
        const gndAssetId = `${baseGnd}${eraSuffix(this.id)}`;
        const gndData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, gndAssetId, ".gnd");
        const gnd = parseGND(gndData);

        // Fetch + decode each terrain base texture. The fetch path is rebuilt
        // from the CP949-decoded GND name alone; a missing texture yields null
        // and its draw group is skipped.
        //
        // Failure separation: missing-asset (fetch throws) is expected and
        // silenced; a decode failure is a real bug we want to see, so it's
        // logged with the path rather than swallowed alongside 404s. (Returning
        // null on a decoder bug used to hide regressions for months.)
        const textureImages: (DecodedImage | null)[] = await Promise.all(gnd.textureNames.map(async (name): Promise<DecodedImage | null> => {
            const url = `${pathBase}/textures/${textureNameToUrl(name)}`;
            let data;
            try {
                data = await dataFetcher.fetchData(url);
            } catch {
                return null; // missing asset: skip the draw group
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
                texCache.set(url, null); // missing asset: cache the null
                return null;
            }
            try {
                img = decodeTexture(name, data);
            } catch (e) {
                // Surface decoder bugs instead of masking them as missing assets.
                console.error(`RagnarokOnline: failed to decode model texture ${fullUrl}:`, e);
                img = null;
            }
            texCache.set(url, img);
            return img;
        };

        // Build each unique RSM model once (mesh + decoded textures). Models with
        // keyframe tracks take the animated path (node-local geometry + a node
        // tree the renderer poses each frame); the rest bake to a static mesh.
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
                // Skip an unreadable/unparseable model; its placements drop out.
            }
        }));

        // Half the map extent: the RSW frame is centered on the map, the terrain
        // is corner-origin, so placement shifts by this and negates Y to coincide.
        const mapOffX = gnd.width * gnd.zoom * 0.5;
        const mapOffZ = gnd.height * gnd.zoom * 0.5;

        const instances: ModelInstance[] = [];
        const animatedInstances: AnimatedModelInstance[] = [];
        for (const p of rsw.models) {
            const staticEntry = meshes.get(p.modelName);
            if (staticEntry !== undefined) {
                const world = mat4.create();
                buildPlacementMatrix(staticEntry.mesh.bboxMin, staticEntry.mesh.bboxMax, p.pos, p.rot, p.scale, mapOffX, mapOffZ, world);
                instances.push({ modelKey: p.modelName, worldMatrix: world });
                continue;
            }
            const animEntry = animatedMeshes.get(p.modelName);
            if (animEntry !== undefined) {
                // The placement matrix carries the box-offset anchor, scale,
                // Euler rotation, position and the RO->render-frame mapping; the
                // per-node animated transform is applied on top of it at draw.
                const placement = mat4.create();
                buildPlacementMatrix(animEntry.mesh.bboxMin, animEntry.mesh.bboxMax, p.pos, p.rot, p.scale, mapOffX, mapOffZ, placement);
                animatedInstances.push({ modelKey: p.modelName, placementMatrix: placement, animSpeed: p.animSpeed });
            }
        }

        const modelData: ModelSceneData = { meshes, instances, animatedMeshes, animatedInstances };

        // Animated water plane. Fetch the 32 type-<waterType> JPEG frames (a
        // missing/undecodable frame yields null and is skipped at draw time).
        // The grid is built in the terrain's frame, so it shares the same
        // corner-origin world coordinates as the ground.
        //
        // GND vs RSW water-type precedence: 1.8+ GNDs carry their own water
        // params block which usually agrees with the RSW. When they disagree
        // (a GND references a water set the staged texture corpus doesn't have),
        // unconditionally trusting the GND silently kills the map's water. We
        // try GND first; if zero frames load (likely a missing tile set), retry
        // with the RSW's type so at least one source has a chance to populate.
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
            // GND's water type loaded nothing — fall back to the RSW's type
            // before giving up on water entirely.
            const fallback = await loadWaterFrames(rswWater.type);
            if (fallback.some((f) => f !== null))
                frames = fallback;
        }

        const waterData: WaterSceneData | null = frames.some((f) => f !== null) ? {
            gndWidth: gnd.width,
            gndHeight: gnd.height,
            zoom: gnd.zoom,
            params: {
                level: waterParams.level,
                animSpeed: waterParams.animSpeed,
                wavePitch: waterParams.wavePitch,
                waveSpeed: waterParams.waveSpeed,
                waveHeight: waterParams.waveHeight,
            },
            frames,
        } : null;

        // RSW directional sun: the light direction from longitude/latitude plus
        // the map's diffuse/ambient colors. These shade the RSM props and feed the
        // terrain's day/night env-diffuse. The world is mirrored about X (RO is
        // left-handed; see coord.ts), and model geometry/normals are mirrored with
        // it, so the sun's X is negated to keep directional shading consistent.
        const sunDir = computeLightDir(rsw.longitude, rsw.latitude);
        sunDir[0] = -sunDir[0];
        const lightData: LightSceneData = {
            lightDir: sunDir,
            diffuse: [rsw.diffuse.x, rsw.diffuse.y, rsw.diffuse.z],
            ambient: [rsw.ambient.x, rsw.ambient.y, rsw.ambient.z],
        };

        // Per-map fog table (data/fogparametertable.txt, extracted into
        // <mapId>.fog.json). The entry's color doubles as RO's per-map sky
        // colour — white for cheerful towns, light cyan for Payon, warm yellow
        // for the desert, purple for the geffen dungeon, etc. — so we always
        // try to load it (when available) and feed it to the sky/clear path.
        //
        // The fog *tint* (an even wash of that colour over geometry) is a
        // separate concern: RO's distance fog washes out the wide free-fly
        // overview, and a per-map even-tint only reads as atmosphere inside
        // dungeons; over open towns/fields it's a flat, pointless haze. So we
        // only enable the tint for dungeon-type maps (mapWantsFog). The sky
        // colour applies on every map that has a fog entry.
        let fogTableColor: [number, number, number] | null = null;
        let fogTableDensity: number = 0;
        // Gravity ships one fog table entry per logical map id, era-shared —
        // classic and renewal Geffen draw under the same atmospheric tint.
        // Reach the file under the bare base id even when this scene is an
        // era variant.
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
            // No fog entry for this map: the sky falls back to a category
            // default and the tint stays off.
        }

        const fogData: FogSceneData = (fogTableColor !== null && mapWantsFog(this.id))
            ? { enabled: true, color: fogTableColor, tint: fogTableDensity }
            : { enabled: false, color: [0, 0, 0], tint: 0 };

        // The sky dome wants a unit vector FROM the ground TOWARD the sun, in
        // the same render frame as the camera. `sunDir` above is the
        // propagation direction (light traveling toward the surface), already
        // X-mirrored, so its negation is what the dome wants.
        const skyData = buildSkyData(this.id, fogTableColor, [-sunDir[0], -sunDir[1], -sunDir[2]]);

        // Map entities: fetch the per-map manifest, load each unique NPC/monster
        // sprite once, and place every NPC (idle, facing its scripted direction)
        // and every monster (count instances scattered over the spawn area) as a
        // grounded billboard. Warps are stashed but not drawn (their glow is a
        // later-phase effect); name labels are deferred. Failure-tolerant: a
        // missing manifest or sprite just drops those entities.
        // The GAT walkability grid drives mob wandering. It's staged beside the
        // GND as <mapId>.gat; a missing/unparseable GAT just disables wandering
        // (the map still renders, mobs simply aren't placed). Era-aware with
        // the bare-asset fallback for the same reason RSW/GND have it: most
        // era variants share geometry, so only Gravity-rebuilt maps actually
        // ship a separate per-era GAT.
        let gat: GatMap | null = null;
        try {
            const gatData = await fetchEraOrBare(dataFetcher, `${pathBase}/maps`, this.id, ".gat");
            gat = parseGAT(gatData);
        } catch {
            gat = null;
        }

        const entityData = await loadEntities(dataFetcher, pathBase, this.id, gnd, gat);

        // World-placed ambient effect sources (RSW OT_EFFECTSRC): place the
        // confidently-identified ones (e.g. EF_TORCH flames) as looping animated
        // billboards, sharing the entity sprite renderer. Their placements index
        // into their own sprite list, so offset those indices past the entity
        // sprites when merging into the one combined sheet registry.
        const effectSources = await loadEffectSources(dataFetcher, pathBase, rsw.effects, mapOffX, mapOffZ);
        if (effectSources.sprites.length > 0) {
            const spriteBase = entityData.sprites.length;
            for (const ls of effectSources.sprites)
                entityData.sprites.push(ls);
            for (const p of effectSources.placements)
                entityData.placements.push({ ...p, spriteIndex: p.spriteIndex + spriteBase });
        }

        // Warp-portal pass: place RO's procedural WarpZone portal (disc + pulsing
        // blue rings + orbiting sparkles) at each warp tile (warps come from the
        // entity manifest). Failure-tolerant: missing textures yield no portals
        // (the map still renders).
        const warpPortalData = await loadWarpPortals(dataFetcher, pathBase, entityData.warps, gnd, gat);

        // Warp click-to-travel: build a clickable target per warp tile (the
        // portal world centre, a world hit radius from the warp's cell span, the
        // destination map id, and — when the manifest carries them — the arrival
        // cell on that map). Also consume any pending arrival for THIS map (set
        // when we got here by clicking a warp elsewhere) so the renderer frames
        // the camera at the landing point.
        // Cell elevation for warp click targets and arrival framing. Prefer the
        // GAT's per-cell walkable-surface height (the staircase/platform a warp
        // sits on top of) when the GAT loaded; fall back to GND otherwise. Stays
        // in sync with the portal renderer's own placement choice above.
        const gatHeight = (gatX: number, gatY: number): number =>
            gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gatCellGroundHeight(gnd, gatX, gatY);
        const cellSize = gnd.zoom / 2; // world units per GAT cell
        // Resolve each warp's destination to a fully-qualified scene id. For
        // destinations with era variants, this appends the era suffix using
        // the warp's own destEra hint when present (set by the extractor for
        // era-specific source scripts) and the current scene's era otherwise.
        // Bare destinations (no era variants in maps.ts) pass through.
        const sourceEra = eraOf(this.id);
        const warpTargets: WarpTarget[] = entityData.warps.map((w) => {
            const wp = gatCellToWorld(w.cellX, w.cellY, gatHeight(w.cellX, w.cellY), gnd.zoom, gnd.width);
            // The warp's span is a half-extent in cells; its world radius is the
            // larger axis span (or a floor) so the whole trigger tile is hittable.
            const spanCells = Math.max(w.spanX, w.spanY);
            const radius = Math.max(spanCells * cellSize, WARP_MIN_HIT_RADIUS);
            const dest = resolveWarpDest(w.dest, w.destEra, sourceEra);
            // Intra-map warp (e.g. prt_in's room-to-room portals): pre-resolve the
            // arrival world position from this map's own terrain so the click can
            // teleport the camera without a scene reload. Cross-map arrivals stay
            // undefined here (we cannot project a cell against another map's GND).
            // Use the RESOLVED dest so an era-aware self-warp (geffen@classic ->
            // geffen) still detects as intra-map.
            let arrivalWorldPos: vec3 | undefined;
            if (dest === this.id && w.destX !== undefined && w.destY !== undefined) {
                const ap = gatCellToWorld(w.destX, w.destY, gatHeight(w.destX, w.destY), gnd.zoom, gnd.width);
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

        const arrival = takePendingArrival(this.id);
        let arrivalWorldPos: vec3 | null = null;
        if (arrival !== null) {
            const wp = gatCellToWorld(arrival.cellX, arrival.cellY, gatHeight(arrival.cellX, arrival.cellY), gnd.zoom, gnd.width);
            arrivalWorldPos = vec3.fromValues(wp[0], wp[1], wp[2]);
        }

        const warpClickData: WarpClickSceneData = {
            targets: warpTargets,
            arrivalCellX: arrival !== null ? arrival.cellX : null,
            arrivalCellY: arrival !== null ? arrival.cellY : null,
            arrivalWorldPos,
        };

        // WoE 3D Granny props (Emperium/guardians/flag/treasure): only on guild
        // castle maps, clustered at the map centre. Empty elsewhere or if the
        // baked model3d/ assets aren't staged. Castles are renewal-only WoE
        // content (no era variants), but strip era suffix anyway so a future
        // era-aware castle would resolve correctly.
        const grannyData = await loadWoeGrannyModels(dataFetcher, pathBase, eraSharedKey(this.id), gnd, gat);

        // Per-map weather: the outdoor Lutie maps (xmas, xmas_fild01) snow. The
        // weather table lives in mapcategory; "snow" selects the falling-flake
        // particle field. Maps with no weather pass null (no weather renderer).
        let weatherParams: WeatherParams | null = null;
        if (mapWeather(this.id) === "snow")
            weatherParams = SNOW_PARAMS;

        // Per-source coloured point lights (RSW OT_LIGHTSRC): empty on outdoor
        // maps (their lighting bakes into the lightmap), dozens-to-hundreds on
        // indoor / dungeon maps. Converted here into the render frame (X mirror,
        // Y negate, Z shift) to match the terrain/model placements.
        const pointLights = loadPointLights(rsw, gnd);

        // Per-map LUB-driven particle emitters (chimney smoke, dust motes, ambient
        // sparkles). Built offline by tools/extract-emitters.ts into
        // <mapId>.emitters.json; absent for most maps. Coordinates are converted
        // to the render frame here with the same recipe as loadEffectSources.
        // Era-shared: one LUB per logical map, so classic and renewal Geffen
        // get the same ambient particles.
        const particleData = await loadParticles(dataFetcher, pathBase, eraSharedKey(this.id), mapOffX, mapOffZ);

        // Tell the BGM player which map we're on so the next play (if the user
        // enables BGM or the overlay button is clicked) targets the right track.
        // setMap also lazy-creates the floating overlay button on first call.
        // BGM is era-shared: both Geffen variants play the same Geffen track.
        void BGM.setMap(dataFetcher, eraSharedKey(this.id));

        return new RagnarokTerrainRenderer(device, gnd, textureImages, modelData, waterData, lightData, fogData, entityData, warpPortalData, grannyData, weatherParams, warpClickData, pointLights, skyData, particleData, dataFetcher);
    }
}

// One generic SceneDesc per map, built from the generated manifest. Every RO map
// is selectable; maps whose assets aren't staged locally/on the CDN will 404 at
// load and surface a clean error (see createScene) rather than crashing the app.
// Group the 557 maps into labelled sections (string entries in sceneDescs render
// as headers in the scene list) instead of one flat alphabetical wall. Maps stay
// id-sorted within each section (the manifest is pre-sorted).
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
