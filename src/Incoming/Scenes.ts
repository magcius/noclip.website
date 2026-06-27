
// Scene assembly and registration for Incoming (1998, Rage Software) levels.
//
// Each level is described by an `.odl` object/terrain/sky definition and a `.wdl` placement
// list.

import { mat4, vec3 } from "gl-matrix";
import { GfxDevice, GfxFormat, GfxTexture } from "../gfx/platform/GfxPlatform.js";
import { makeImageBitmapTexture2D } from "../gfx/helpers/TextureHelpers.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { DataFetcher } from "../DataFetcher.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { parseODL, IncomingODL, IncomingObjectType, IncomingPart, IncomingMaterialFlag, IncomingTextureFlag } from "./ODL.js";
import { parseWDL } from "./WDL.js";
import { parseMDL, IncomingMDLPlacement, IncomingMDLWaypoint } from "./MDL.js";
import { buildSphereMesh, buildHemisphereMesh } from "./ProcGeom.js";
import { parseIAN } from "./IAN.js";
import { parseHeightfield, buildTerrainMeshes, buildWaterMesh, sampleGroundHeight, Heightfield, TERRAIN_MAX_TEXTURES } from "./Terrain.js";
import { IncomingMeshData, IncomingRenderer, IncomingAnimFrame, IncomingSceneParams, IncomingMover, SPIN_TICKS_PER_MS, indexFormatFor } from "./Render.js";
import subversionOverridePaths from "./SubversionOverrides.json";


const SPRITE_ATLAS_SIZE = 256;
const IDENTITY_MATRIX = mat4.create();
const WATER_FRAME_COUNT = 16;
const SHADOW_OPACITY = 0.5;
const SHADOW_SIZE_FACTOR = 0.9;
const SHADOW_LIFT = 4;
const pathBase = "Incoming";
const subversionBase = "IncomingSubversion";
const SUBVERSION_OVERRIDES = new Set<string>(subversionOverridePaths);
let overrideSet = new Set<string>();

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase().trim();
}

function baseFor(rel: string): string {
    return overrideSet.has(rel) ? subversionBase : pathBase;
}
function resolveDataPath(p: string): string {
    const rel = normalizePath(p);
    return `${baseFor(rel)}/${rel}`;
}
function resolveTexturePath(p: string): string {
    const rel = `ppm/${normalizePath(p).replace(/\.ppm$/, ".png")}`;
    return `${baseFor(rel)}/${rel}`;
}
function resolveModelPath(p: string): string {
    const rel = `pcobject/${normalizePath(p)}`;
    return `${baseFor(rel)}/${rel}`;
}

async function loadODLRecursive(dataFetcher: DataFetcher, odlPath: string): Promise<IncomingODL> {
    const types = new Map<string, IncomingObjectType>();
    let land: IncomingODL["land"];
    let sky: IncomingODL["sky"];
    let offset = 0;
    let waterLevel: number | undefined;
    const visited = new Set<string>();

    const visit = async (path: string, isRoot: boolean): Promise<void> => {
        const key = normalizePath(path);
        if (visited.has(key)) {
            return;
        }
        visited.add(key);

        let buffer: ArrayBufferSlice;
        try {
            buffer = await dataFetcher.fetchData(path);
        } catch {
            return;
        }
        const text = new TextDecoder("latin1").decode(buffer.createTypedArray(Uint8Array));
        const odl = parseODL(text);

        for (const [name, type] of odl.types) {
            if (!types.has(name)) {
                types.set(name, type);
            }
        }
        if (isRoot) {
            if (odl.land !== undefined) {
                land = odl.land;
            }
            if (odl.sky !== undefined) {
                sky = odl.sky;
            }
            offset = odl.offset;
            waterLevel = odl.waterLevel;
        }

        for (const inc of odl.includes) {
            await visit(resolveDataPath(inc), false);
        }
    };

    await visit(odlPath, true);
    return { types, land, sky, offset, waterLevel, includes: [] };
}


async function loadTexture(device: GfxDevice, dataFetcher: DataFetcher, cache: Map<string, GfxTexture | undefined>, ownedTextures: GfxTexture[], texturePath: string): Promise<GfxTexture | undefined> {
    const url = resolveTexturePath(texturePath);
    if (cache.has(url)) {
        return cache.get(url);
    }
    let tex: GfxTexture | undefined;
    try {
        const buffer = await dataFetcher.fetchData(url);
        const bitmap = await createImageBitmap(new Blob([buffer.createTypedArray(Uint8Array)]));
        tex = makeImageBitmapTexture2D(device, bitmap);
        ownedTextures.push(tex);
    } catch {
        tex = undefined;
    }
    cache.set(url, tex);
    return tex;
}


async function loadModel(device: GfxDevice, dataFetcher: DataFetcher, cache: Map<string, IncomingMeshData | undefined>, ownedMeshes: IncomingMeshData[], modelPath: string): Promise<IncomingMeshData | undefined> {
    const url = resolveModelPath(modelPath);
    if (cache.has(url)) {
        return cache.get(url);
    }
    let mesh: IncomingMeshData | undefined;
    try {
        const buffer = await dataFetcher.fetchData(url);
        const model = parseIAN(buffer);
        if (model.triangleCount > 0 && model.vertexCount > 0) {
            mesh = new IncomingMeshData(device, model.vertices, model.indices);
            ownedMeshes.push(mesh);
        }
    } catch {
        mesh = undefined;
    }
    cache.set(url, mesh);
    return mesh;
}

function buildModelMatrix(out: mat4, px: number, py: number, pz: number, forward: vec3, up: vec3, scale: number): void {
    const f = vec3.normalize(vec3.create(), forward);
    const u = vec3.normalize(vec3.create(), up);
    const r = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), u, f));
    // Re-orthogonalize up from forward and right.
    const u2 = vec3.cross(vec3.create(), f, r);

    // Column-major: columns are scaled basis vectors (X=right, Y=up, Z=forward), then translation.
    out[0] = r[0] * scale; out[1] = r[1] * scale; out[2] = r[2] * scale; out[3] = 0;
    out[4] = u2[0] * scale; out[5] = u2[1] * scale; out[6] = u2[2] * scale; out[7] = 0;
    out[8] = f[0] * scale; out[9] = f[1] * scale; out[10] = f[2] * scale; out[11] = 0;
    out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
}

function normColor(c: number[]): [number, number, number] {
    return [(c[0] | 0) / 255, (c[1] | 0) / 255, (c[2] | 0) / 255];
}

function pickSkyColor(sky: IncomingODL["sky"], fogColor: [number, number, number]): [number, number, number] {
    if (sky !== undefined && sky.gradient.length > 0) {
        return normColor(sky.gradient[sky.gradient.length - 1]);
    }
    if (fogColor[0] + fogColor[1] + fogColor[2] > 0.05) {
        return fogColor;
    }
    return [0.5, 0.6, 0.7];
}

function deriveSkyGradient(sky: NonNullable<IncomingODL["sky"]>): number[][] {
    // Horizon glow: a brightened blend of the sun tint and the directional-light colour.
    const glow = (i: number) => Math.min(255, ((sky.sunColor[i] + sky.directColor[i]) * 0.5) * 1.25);
    const horizon = [glow(0), glow(1), glow(2)];
    // Zenith: a darker version of the same hue (keeps the sky one warm/cool family — no stray blue).
    const zenith = [horizon[0] * 0.45, horizon[1] * 0.30, horizon[2] * 0.22];
    const bands: number[][] = [];
    for (let i = 0; i < 8; i++) {
        // Bands 0..3 span zenith→horizon (the visible upper hemisphere); 4..7 hold at the horizon.
        const t = Math.min(i / 3, 1);
        bands.push([
            zenith[0] + (horizon[0] - zenith[0]) * t,
            zenith[1] + (horizon[1] - zenith[1]) * t,
            zenith[2] + (horizon[2] - zenith[2]) * t,
        ]);
    }
    return bands;
}

interface ResolvedPartMaterial {
    readonly objfile: string;
    readonly scale: number;
    readonly texturePath?: string;
    readonly textureFlags: number;
    readonly materialFlags: number;
    readonly doubleSided: boolean;
}

function buildGlobalPartRegistry(types: Map<string, IncomingObjectType>): Map<string, IncomingPart> {
    const registry = new Map<string, IncomingPart>();
    for (const type of types.values()) {
        for (const part of type.parts) {
            if (part.name !== "") {
                registry.set(part.name.toLowerCase(), part);
            }
        }
    }
    return registry;
}

function resolvePartMaterial(type: IncomingObjectType, part: IncomingPart, globalParts: Map<string, IncomingPart>): ResolvedPartMaterial | undefined {
    let src = part;
    const visited = new Set<IncomingPart>();
    // Follow the alias chain until reaching a part with a real mesh (or a cycle/dead end).
    while (src.objfile === undefined && src.aliasOf !== undefined && !visited.has(src)) {
        visited.add(src);
        const target = src.aliasOf.toLowerCase();
        const found = type.parts.find((p) => p.name.toLowerCase() === target) ?? globalParts.get(target);
        if (found === undefined) {
            break;
        }
        src = found;
    }
    if (src.objfile === undefined) {
        return undefined;
    }
    return {
        objfile: src.objfile, scale: src.scale, texturePath: src.texturePath,
        textureFlags: src.textureFlags, materialFlags: src.materialFlags, doubleSided: src.doubleSided,
    };
}

interface ResolvedPlacement {
    readonly world: [number, number, number];
    readonly forward: [number, number, number];
    readonly up: [number, number, number];
}

function resolveMDLWorld(p: IncomingMDLPlacement, offset: number, heightfield: Heightfield | undefined, labelWorld: Map<string, ResolvedPlacement>): ResolvedPlacement | undefined {
    if (p.abs !== undefined) {
        const wx = p.abs.x + offset, wz = p.abs.z + offset;
        const wy = p.abs.onGround && heightfield !== undefined ? sampleGroundHeight(heightfield, wx, wz) : p.abs.y;
        return { world: [wx, wy, wz], forward: p.forward ?? [0, 0, 1], up: p.up };
    }
    if (p.ref !== undefined) {
        const base = labelWorld.get(p.ref.label.toLowerCase());
        if (base === undefined) {
            return undefined;
        }
        let world: [number, number, number];
        if (p.ref.mode === "world") {
            // World-axis offset from the reference position (`relative to`).
            world = [base.world[0] + p.ref.dx, base.world[1] + p.ref.dy, base.world[2] + p.ref.dz];
        } else {
            // Offset in the reference's own rotated frame (`local to` / `fixed_to ... at`). The
            // right vector is up×forward, matching buildModelMatrix, so transforming the offset by
            // the reference's model matrix yields base + R·offset. (`localxz` is approximated as the
            // full local frame; reference objects are level, making the yaw-only distinction moot.)
            const bm = mat4.create();
            buildModelMatrix(bm, base.world[0], base.world[1], base.world[2], base.forward as vec3, base.up as vec3, 1);
            const w = vec3.transformMat4(vec3.create(), [p.ref.dx, p.ref.dy, p.ref.dz], bm);
            world = [w[0], w[1], w[2]];
        }
        if (p.ref.onGround && heightfield !== undefined) {
            world[1] = sampleGroundHeight(heightfield, world[0], world[2]);
        }
        return { world, forward: p.forward ?? base.forward, up: p.up };
    }
    return undefined;
}

function resolveWaypointWorld(wp: IncomingMDLWaypoint, offset: number, heightfield: Heightfield | undefined, labelWorld: Map<string, ResolvedPlacement>): [number, number, number] | undefined {
    if (wp.abs !== undefined) {
        const wx = wp.abs.x + offset, wz = wp.abs.z + offset;
        const wy = wp.abs.onGround && heightfield !== undefined ? sampleGroundHeight(heightfield, wx, wz) : wp.abs.y;
        return [wx, wy, wz];
    }
    if (wp.ref !== undefined) {
        const base = labelWorld.get(wp.ref.label.toLowerCase());
        if (base === undefined) {
            return undefined;
        }
        let world: [number, number, number];
        if (wp.ref.mode === "world") {
            world = [base.world[0] + wp.ref.dx, base.world[1] + wp.ref.dy, base.world[2] + wp.ref.dz];
        } else {
            const bm = mat4.create();
            buildModelMatrix(bm, base.world[0], base.world[1], base.world[2], base.forward as vec3, base.up as vec3, 1);
            const w = vec3.transformMat4(vec3.create(), [wp.ref.dx, wp.ref.dy, wp.ref.dz], bm);
            world = [w[0], w[1], w[2]];
        }
        if (wp.ref.onGround && heightfield !== undefined) {
            world[1] = sampleGroundHeight(heightfield, world[0], world[2]);
        }
        return world;
    }
    return undefined;
}

function buildMover(start: [number, number, number], waypoints: IncomingMDLWaypoint[], offset: number, heightfield: Heightfield | undefined, labelWorld: Map<string, ResolvedPlacement>, maxVel: number, forward: [number, number, number], up: [number, number, number], phase: number): IncomingMover | undefined {
    const points: [number, number, number][] = [start];
    for (const wp of waypoints) {
        const w = resolveWaypointWorld(wp, offset, heightfield, labelWorld);
        if (w === undefined) {
            continue;
        }
        // Skip a point coincident with the previous one (zero-length leg adds nothing).
        const prev = points[points.length - 1];
        if (Math.abs(w[0] - prev[0]) > 1 || Math.abs(w[1] - prev[1]) > 1 || Math.abs(w[2] - prev[2]) > 1) {
            points.push(w);
        }
    }
    if (points.length < 2) {
        return undefined;
    }
    // Cumulative arc length at the start of each leg; the loop closes from the last point to the first.
    const cumLengths: number[] = new Array(points.length);
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
        cumLengths[i] = acc;
        const b = points[(i + 1) % points.length];
        acc += Math.hypot(b[0] - points[i][0], b[1] - points[i][1], b[2] - points[i][2]);
    }
    return { points, cumLengths, totalLength: acc, speed: maxVel * SPIN_TICKS_PER_MS, forward, up, phase };
}

function buildPartFrames(type: IncomingObjectType, placementMatrix: mat4): mat4[] {
    const parts = type.parts;
    const n = parts.length;

    // Local translate·rotate of each part relative to its parent (unit scale, world-unit offset).
    const local: mat4[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const p = parts[i];
        const m = mat4.create();
        buildModelMatrix(m, p.position[0], p.position[1], p.position[2], p.forward as vec3, p.up as vec3, 1);
        local[i] = m;
    }

    // Accumulate down the hierarchy (parentIndex < i is guaranteed by the parser).
    const lworld: mat4[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const p = parts[i];
        lworld[i] = p.parentIndex < 0 ? local[i] : mat4.multiply(mat4.create(), lworld[p.parentIndex], local[i]);
    }

    const frames: mat4[] = new Array(n);
    for (let i = 0; i < n; i++) {
        frames[i] = mat4.multiply(mat4.create(), placementMatrix, lworld[i]);
    }
    return frames;
}

function effectiveSpin(type: IncomingObjectType, index: number): [number, number, number] | undefined {
    for (let i = index; i >= 0; i = type.parts[i].parentIndex) {
        const part = type.parts[i];
        if (part.spin === undefined) {
            continue;
        }
        // This is to avoid going too far up the hierarchy so parent objects do not spin (fixes
        // buildings spinning with the mounted satellite dish).
        if (i === index && part.spinInheritOnly) {
            continue;
        }
        return part.spin;
    }
    return undefined;
}

class IncomingSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, private odlPath: string, private wdlPath: string, private subversion = false, private mdlPathOverride?: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        overrideSet = this.subversion ? SUBVERSION_OVERRIDES : new Set();

        const odl = await loadODLRecursive(dataFetcher, resolveDataPath(this.odlPath));
        const globalParts = buildGlobalPartRegistry(odl.types);
        const wdlBuffer = await dataFetcher.fetchData(resolveDataPath(this.wdlPath));
        const placements = parseWDL(new TextDecoder("latin1").decode(wdlBuffer.createTypedArray(Uint8Array)));

        // Derive lighting/fog from the sky block (with defaults).
        const sky = odl.sky;
        const fogColor: [number, number, number] = sky !== undefined ? normColor(sky.fogColor) : [0.5, 0.6, 0.7];
        // Directional light: the engine keeps the `from` vector UN-normalized when `not_unit` is
        // given (its magnitude ~2 scales the directional term), and the warm sunset look comes from
        // the sun `color`, not the gray `direct` value.
        const lightDir: [number, number, number] = sky === undefined ? [0.4, 0.8, 0.4]
            : sky.lightUnnormalized ? [sky.lightDir[0], sky.lightDir[1], sky.lightDir[2]]
            : (vec3.normalize(vec3.create(), sky.lightDir as vec3) as unknown as [number, number, number]);
        // Sky-dome gradient: for a `flat` sky, derive it from the level's lighting (sun/direct) so
        // the player sees the sun-tinted sky (e.g. Africa's sunset orange) rather than the deep-blue
        // backdrop bands the engine keeps behind its warm-lit cloud plane. Non-flat (space) keeps its
        // own bands (moon has none → black space).
        const skyGradient: number[][] = sky !== undefined ? (sky.flat ? deriveSkyGradient(sky) : sky.gradient) : [];
        // Clear/background to the gradient's horizon (band 3 of the 8) so nothing peeks through as a
        // foreign colour; fall back to the prior heuristic when there is no gradient.
        const skyColor: [number, number, number] = skyGradient.length > 3
            ? normColor(skyGradient[3]) : pickSkyColor(sky, fogColor);
        const sceneParams: IncomingSceneParams = {
            lightDir,
            lightColor: sky !== undefined ? normColor(sky.directColor) : [1, 1, 1],
            ambientColor: sky !== undefined ? normColor(sky.ambient) : [0.4, 0.4, 0.4],
            fogColor,
            skyColor,
            skyGradient,
            sunColor: sky !== undefined ? normColor(sky.sunColor) : [1, 0.85, 0.7],
            // Sun is toward the light `from` direction; convert Incoming->noclip (negate Y and Z).
            sunDir: sky !== undefined
                ? (vec3.normalize(vec3.create(), [sky.lightDir[0], -sky.lightDir[1], -sky.lightDir[2]]) as unknown as [number, number, number])
                : [0, 0.3, 1],
            fogStart: 80000,
            fogEnd: 360000,
        };

        const renderer = new IncomingRenderer(device, sceneParams);
        const textureCache = new Map<string, GfxTexture | undefined>();
        const modelCache = new Map<string, IncomingMeshData | undefined>();
        const procCache = new Map<string, IncomingMeshData>();

        // Sky cloud texture for the dome and the sun-sprite texture.
        if (sky !== undefined && sky.texturePath !== undefined) {
            renderer.skyCloudTexture = await loadTexture(device, dataFetcher, textureCache, renderer.textures, sky.texturePath);
        }
        if (sky !== undefined && sky.sunImagePath !== undefined) {
            renderer.sunTexture = await loadTexture(device, dataFetcher, textureCache, renderer.textures, sky.sunImagePath);
        }

        // Terrain.
        let heightfield: Heightfield | undefined;
        if (odl.land !== undefined) {
            const land = odl.land;
            try {
                const hfBuffer = await dataFetcher.fetchData(resolveDataPath(land.heightfieldPath));
                const cfBuffer = await dataFetcher.fetchData(resolveDataPath(land.cellFlagsPath));
                heightfield = parseHeightfield(hfBuffer);

                const landTextures: (GfxTexture | undefined)[] = [];
                for (let i = 0; i < TERRAIN_MAX_TEXTURES; i++) {
                    const tp = land.texturePaths[i];
                    landTextures.push(tp !== undefined ? await loadTexture(device, dataFetcher, textureCache, renderer.textures, tp) : undefined);
                }

                const terrainMeshes = buildTerrainMeshes(heightfield, cfBuffer);
                for (const tm of terrainMeshes) {
                    const mesh = new IncomingMeshData(device, tm.vertices, tm.indices);
                    renderer.meshes.push(mesh);
                    renderer.instances.push({
                        mesh, texture: landTextures[tm.textureIndex],
                        modelMatrix: mat4.create(), selfIllum: false, colorKey: false,
                        // Make the terrain single-sided so the bottom can be culled.
                        twoSided: false, indexFormat: indexFormatFor(tm.indices),
                    });
                }
                // Water plane over the water-flagged tiles, at the ODL `water` level (oceanic/egypt).
                if (odl.waterLevel !== undefined) {
                    const waterMesh = buildWaterMesh(cfBuffer, odl.waterLevel);
                    if (waterMesh !== undefined) {
                        const mesh = new IncomingMeshData(device, waterMesh.vertices, waterMesh.indices);
                        renderer.meshes.push(mesh);
                        // Animated water surface: cycle the sequential water-texture frames on the
                        // shared water mesh, reusing the `animatemodel` flipbook (same mesh,
                        // changing texture). Load every frame that resolves; skip any that are
                        // missing.
                        const waterFrames: IncomingAnimFrame[] = [];
                        for (let n = 1; n <= WATER_FRAME_COUNT; n++) {
                            const tex = await loadTexture(device, dataFetcher, textureCache, renderer.textures, `water4\\water${n}.ppm`);
                            if (tex !== undefined) {
                                waterFrames.push({ mesh, texture: tex });
                            }
                        }
                        if (waterFrames.length > 0) {
                            renderer.instances.push({
                                mesh, texture: waterFrames[0].texture,
                                modelMatrix: mat4.create(), selfIllum: false, colorKey: false,
                                twoSided: true, indexFormat: GfxFormat.U32_R,
                                animFrames: waterFrames,
                            });
                        }
                    }
                }
            } catch {
                // Missing terrain binaries: render objects only.
            }
        }

        // Model placement.
        const labelWorld = new Map<string, ResolvedPlacement>();
        const instancePlacement = async (type: IncomingObjectType, placementMatrix: mat4, mover?: IncomingMover): Promise<void> => {
            const frames = buildPartFrames(type, placementMatrix);
            // Largest scaled part-mesh footprint radius, accumulated to size the ground shadow.
            let footprintR = 0;
            for (let i = 0; i < type.parts.length; i++) {
                const part = type.parts[i];
                // The part's effective spin, inheriting a rotating ancestor's (e.g. a radar dish
                // rotating with its `bradar` base) so rigid sub-assemblies sweep together.
                const partSpin = effectiveSpin(type, i);
                // Collect this part's lamp/point lights in world space (lights can be on parts that
                // have no mesh). The light position is a world-unit offset in the part's frame, like
                // the part position; radius is in world units. Color is normalized (may exceed 1 = HDR).
                // Skipped for moving actors: these are baked at fixed world points (the actor's frames
                // here are actor-local), so a mover's lights/sprites/smoke/shadow would orphan at the
                // origin. Effects that travel with a moving craft are a future refinement.
                if (mover === undefined) {
                    for (const light of part.lights) {
                        const wp = vec3.transformMat4(vec3.create(), light.position as vec3, frames[i]);
                        renderer.pointLights.push({
                            position: [wp[0], wp[1], wp[2]],
                            color: [light.color[0] / 255, light.color[1] / 255, light.color[2] / 255],
                            radius: light.radius,
                        });
                    }
                }
                // Smoke plume emitter = objectPos + rotate(offset).
                if (part.smoke !== undefined && mover === undefined) {
                    const sm = part.smoke;
                    const ep = vec3.transformMat4(vec3.create(), sm.offset as vec3, frames[i]);
                    const smokeTex = await loadTexture(device, dataFetcher, textureCache, renderer.textures, "smoke.ppm");
                    renderer.smoke.push({
                        position: [ep[0], ep[1], ep[2]],
                        size: sm.size,
                        color: sm.color,
                        alpha: sm.alpha,
                        rate: sm.rate,
                        lifetime: sm.lifetime,
                        additive: sm.additive,
                        texture: smokeTex,
                    });
                }
                // Billboard sprite: emitted at the part's world origin, additively, with the part's
                // texture atlas sub-rect. Sprite-only parts have no mesh, so this runs before the mesh resolution that would `continue` past
                // them. The UV rect is normalized from texture pixels by the atlas size.
                if (part.sprite !== undefined && mover === undefined) {
                    const sp = part.sprite;
                    const wp = mat4.getTranslation(vec3.create(), frames[i]);
                    const tex = part.texturePath !== undefined ? await loadTexture(device, dataFetcher, textureCache, renderer.textures, part.texturePath) : undefined;
                    renderer.sprites.push({
                        position: [wp[0], wp[1], wp[2]],
                        size: sp.size,
                        uvRect: [sp.u / SPRITE_ATLAS_SIZE, sp.v / SPRITE_ATLAS_SIZE, sp.w / SPRITE_ATLAS_SIZE, sp.h / SPRITE_ATLAS_SIZE],
                        texture: tex,
                        color: sp.color,
                        cycleColors: sp.cycleColors,
                        cycleSpeed: sp.cycleSpeed,
                    });
                }
                // Procedural `sphere`/`hemisphere` geometry (energy shields/spheres): generate and
                // cache the tessellated mesh, then emit one instance. The radius is in world units,
                // so the mesh sits at the part frame with unit scale (not the default part scale).
                // Semi-transparent shields render alpha-blended after the opaque scene.
                if (part.procGeom !== undefined) {
                    const g = part.procGeom;
                    const key = `${g.kind}:${g.radius}:${g.width}:${g.height}:${g.repeatU}:${g.repeatV}`;
                    let pmesh = procCache.get(key);
                    if (pmesh === undefined) {
                        const gen = g.kind === "hemisphere"
                            ? buildHemisphereMesh(g.radius, g.width, g.height, g.repeatU, g.repeatV)
                            : buildSphereMesh(g.radius, g.width, g.height);
                        pmesh = new IncomingMeshData(device, gen.vertices, gen.indices);
                        renderer.meshes.push(pmesh);
                        procCache.set(key, pmesh);
                    }
                    const ptex = part.texturePath !== undefined ? await loadTexture(device, dataFetcher, textureCache, renderer.textures, part.texturePath) : undefined;
                    // Multi-`texture` parts.
                    let texAnim: IncomingAnimFrame[] | undefined;
                    if (part.textures.length > 1) {
                        const tf: IncomingAnimFrame[] = [];
                        for (const tp of part.textures) {
                            const t = await loadTexture(device, dataFetcher, textureCache, renderer.textures, tp);
                            if (t !== undefined) {
                                tf.push({ mesh: pmesh, texture: t });
                            }
                        }
                        if (tf.length > 1) {
                            texAnim = tf;
                        }
                    }
                    renderer.instances.push({
                        mesh: pmesh, texture: texAnim !== undefined ? texAnim[0].texture : ptex, modelMatrix: mat4.clone(frames[i]),
                        mover,
                        selfIllum: (part.materialFlags & IncomingMaterialFlag.SelfIlluminating) !== 0,
                        colorKey: (part.textureFlags & IncomingTextureFlag.ColorKey) !== 0,
                        twoSided: true,
                        indexFormat: GfxFormat.U32_R,
                        transparent: (part.materialFlags & IncomingMaterialFlag.SemiTransparent) !== 0,
                        animFrames: texAnim,
                    });
                    continue;
                }
                // `animatemodel`
                if (part.animFrames.length > 0) {
                    const animFrames: IncomingAnimFrame[] = [];
                    let frameScale = 1, frameSelfIllum = false, frameColorKey = false, frameTwoSided = false;
                    for (const frameName of part.animFrames) {
                        const ft = odl.types.get(frameName.toLowerCase());
                        if (ft === undefined || ft.parts.length === 0) {
                            continue;
                        }
                        const fm = resolvePartMaterial(ft, ft.parts[0], globalParts);
                        if (fm === undefined) {
                            continue;
                        }
                        const fmesh = await loadModel(device, dataFetcher, modelCache, renderer.meshes, fm.objfile);
                        if (fmesh === undefined) {
                            continue;
                        }
                        const ftex = fm.texturePath !== undefined ? await loadTexture(device, dataFetcher, textureCache, renderer.textures, fm.texturePath) : undefined;
                        animFrames.push({ mesh: fmesh, texture: ftex });
                        footprintR = Math.max(footprintR, fmesh.localRadiusXZ * fm.scale);
                        frameScale = fm.scale;
                        frameSelfIllum = (fm.materialFlags & IncomingMaterialFlag.SelfIlluminating) !== 0;
                        frameColorKey = (fm.textureFlags & IncomingTextureFlag.ColorKey) !== 0;
                        frameTwoSided = fm.doubleSided;
                    }
                    if (animFrames.length > 0) {
                        const fs = frameScale;
                        const modelMatrix = mat4.multiply(mat4.create(), frames[i], mat4.fromScaling(mat4.create(), [fs, fs, fs]));
                        renderer.instances.push({
                            mesh: animFrames[0].mesh, texture: animFrames[0].texture, modelMatrix,
                            selfIllum: frameSelfIllum, colorKey: frameColorKey, twoSided: frameTwoSided,
                            indexFormat: GfxFormat.U32_R, animFrames,
                            spin: partSpin, baseFrame: frames[i], meshScale: fs, mover,
                        });
                    }
                    if (part.objfile === undefined && part.aliasOf === undefined) {
                        continue;
                    }
                }

                const material = resolvePartMaterial(type, part, globalParts);
                if (material === undefined) {
                    continue;
                }
                const mesh = await loadModel(device, dataFetcher, modelCache, renderer.meshes, material.objfile);
                if (mesh === undefined) {
                    continue;
                }
                footprintR = Math.max(footprintR, mesh.localRadiusXZ * material.scale);
                const texture = material.texturePath !== undefined ? await loadTexture(device, dataFetcher, textureCache, renderer.textures, material.texturePath) : undefined;

                const s = material.scale;
                // `drawtype flipx/flipy/flipz` mirror the mesh along an axis (negative scale): a
                // mirrored/180°-yaw variant of a shared mesh.
                const modelMatrix = mat4.multiply(mat4.create(), frames[i],
                    mat4.fromScaling(mat4.create(), [part.flipX ? -s : s, part.flipY ? -s : s, part.flipZ ? -s : s]));

                let animTargetFrame: mat4 | undefined;
                if (part.animTarget !== undefined) {
                    const at = part.animTarget;
                    const parentFrame = part.parentIndex >= 0 ? frames[part.parentIndex] : placementMatrix;
                    const localTarget = mat4.create();
                    buildModelMatrix(localTarget, at.position[0], at.position[1], at.position[2],
                        (at.forward ?? part.forward) as vec3, (at.up ?? part.up) as vec3, 1);
                    animTargetFrame = mat4.multiply(mat4.create(), parentFrame, localTarget);
                }

                renderer.instances.push({
                    mesh, texture, modelMatrix,
                    selfIllum: (material.materialFlags & IncomingMaterialFlag.SelfIlluminating) !== 0,
                    colorKey: (material.textureFlags & IncomingTextureFlag.ColorKey) !== 0,
                    twoSided: material.doubleSided,
                    indexFormat: GfxFormat.U32_R,
                    spin: partSpin,
                    flameFlicker: part.flameFlicker,
                    baseFrame: frames[i],
                    meshScale: s,
                    animTargetFrame,
                    mover,
                });
            }
            // Ground shadow: one flat alpha quad on the terrain beneath the object, sized to its
            // footprint and oriented to its heading.
            if (type.shadowTexture !== undefined && footprintR > 0 && mover === undefined) {
                const shadowTex = await loadTexture(device, dataFetcher, textureCache, renderer.textures, type.shadowTexture);
                // Skip when the texture is missing: an undefined bind would sample the fallback white
                // texture and paint a solid black square instead of a silhouette.
                if (shadowTex !== undefined) {
                    const objX = placementMatrix[12], objZ = placementMatrix[14];
                    const groundY = heightfield !== undefined ? sampleGroundHeight(heightfield, objX, objZ) : placementMatrix[13];
                    // Placement forward (matrix Z column) projected onto the horizontal plane: keeps
                    // the silhouette pointing the right way while the quad lies flat (up = world up).
                    const fwd: [number, number, number] = [placementMatrix[8], 0, placementMatrix[10]];
                    if (fwd[0] === 0 && fwd[2] === 0) {
                        fwd[2] = 1;
                    }
                    const shadowMatrix = mat4.create();
                    buildModelMatrix(shadowMatrix, objX, groundY - SHADOW_LIFT, objZ, fwd as vec3, [0, 1, 0], footprintR * SHADOW_SIZE_FACTOR);
                    renderer.shadows.push({ modelMatrix: shadowMatrix, texture: shadowTex, opacity: SHADOW_OPACITY });
                }
            }
        };
        // Static `.wdl` placements.
        for (const placement of placements) {
            const worldX = placement.x + odl.offset;
            const worldZ = placement.z + odl.offset;
            const py = placement.onGround && heightfield !== undefined ? sampleGroundHeight(heightfield, worldX, worldZ) : placement.y;
            if (placement.label !== undefined) {
                labelWorld.set(placement.label.toLowerCase(), { world: [worldX, py, worldZ], forward: placement.forward, up: placement.up });
            }
            const type = odl.types.get(placement.typeName.toLowerCase());
            if (type === undefined || type.parts.length === 0) {
                continue;
            }
            const placementMatrix = mat4.create();
            buildModelMatrix(placementMatrix, worldX, py, worldZ, placement.forward as vec3, placement.up as vec3, 1);
            await instancePlacement(type, placementMatrix);
        }
        // Mission actors.
        const mdlPath = this.mdlPathOverride ?? this.wdlPath.replace(/\.wdl$/i, "_action.mdl");
        let mdlPlacements: IncomingMDLPlacement[] = [];
        try {
            const mdlBuffer = await dataFetcher.fetchData(resolveDataPath(mdlPath));
            mdlPlacements = parseMDL(new TextDecoder("latin1").decode(mdlBuffer.createTypedArray(Uint8Array)));
        } catch {
            // Ignore no mission file found.
        }
        // Pass 1: register every absolute MDL label's world transform, so reference-relative
        // placements can resolve regardless of file order.
        for (const p of mdlPlacements) {
            if (p.abs === undefined || p.label === undefined) {
                continue;
            }
            const wx = p.abs.x + odl.offset, wz = p.abs.z + odl.offset;
            const wy = p.abs.onGround && heightfield !== undefined ? sampleGroundHeight(heightfield, wx, wz) : p.abs.y;
            labelWorld.set(p.label.toLowerCase(), { world: [wx, wy, wz], forward: p.forward ?? [0, 0, 1], up: p.up });
        }
        // Pass 2: create every actor with a resolvable position. Dynamic spawns (`position at
        // generation point`) and references to an unknown label resolve to undefined and are
        // skipped.
        for (const p of mdlPlacements) {
            const resolved = resolveMDLWorld(p, odl.offset, heightfield, labelWorld);
            if (resolved === undefined) {
                continue;
            }
            if (p.label !== undefined) {
                labelWorld.set(p.label.toLowerCase(), resolved);
            }
            const type = odl.types.get(p.typeName.toLowerCase());
            if (type === undefined || type.parts.length === 0) {
                continue;
            }
            // A waypoint-path actor with a known speed becomes a moving actor: it travels its
            // looped route.
            if (p.path !== undefined && type.maxVel !== undefined && type.maxVel > 0) {
                const mover = buildMover(resolved.world, p.path.waypoints, odl.offset, heightfield, labelWorld, type.maxVel, resolved.forward, resolved.up, 0);
                if (mover !== undefined) {
                    await instancePlacement(type, IDENTITY_MATRIX, mover);
                    continue;
                }
            }

            const actorMatrix = mat4.create();
            buildModelMatrix(actorMatrix, resolved.world[0], resolved.world[1], resolved.world[2], resolved.forward as vec3, resolved.up as vec3, 1);
            await instancePlacement(type, actorMatrix);
        }

        return renderer;
    }
}

export const sceneGroup: SceneGroup = {
    id: "Incoming", name: "Incoming",
    sceneDescs: [
        new IncomingSceneDesc("africa", "Africa", "asc/africa/africa.odl", "asc/africa/africa.wdl"),
        new IncomingSceneDesc("arctic", "The Arctic", "asc/arctic/arctic.odl", "asc/arctic/arctic.wdl"),
        new IncomingSceneDesc("oceanic", "North Atlantic", "asc/oceanic/oceanic.odl", "asc/oceanic/oceanic.wdl"),
        new IncomingSceneDesc("canaveral", "U.S.A.", "asc/canaveral/canaveral.odl", "asc/canaveral/canaveral.wdl"),
        new IncomingSceneDesc("moon", "The Moon", "asc/moon/moon.odl", "asc/moon/moon.wdl"),
        new IncomingSceneDesc("egypt", "Alien World", "asc/egypt/egypt.odl", "asc/egypt/egypt.wdl"),
        "Subversion",
        new IncomingSceneDesc("intro", "Intro", "asc/intro/intro.odl", "asc/intro/intro.wdl", true, "asc/intro/intro.mdl"),
        new IncomingSceneDesc("border", "Border Defence", "asc/border/border.odl", "asc/border/border.wdl", true),
        new IncomingSceneDesc("spheres", "Spheres of Influence", "asc/spheres/spheres.odl", "asc/spheres/spheres.wdl", true),
        new IncomingSceneDesc("hostage", "The Hostage Situation", "asc/hostage/hostage.odl", "asc/hostage/hostage.wdl", true),
        new IncomingSceneDesc("covert", "A Covert Hope", "asc/covert/covert.odl", "asc/covert/covert.wdl", true),
        new IncomingSceneDesc("toxin", "The Toxin Threat", "asc/toxin/toxin.odl", "asc/toxin/toxin.wdl", true),
        new IncomingSceneDesc("final", "The Final Assault", "asc/final/final.odl", "asc/final/final.wdl", true),
        new IncomingSceneDesc("end", "The Last Battle", "asc/end/end.odl", "asc/end/end.wdl", true, "asc/end/end.mdl"),
    ],
};
