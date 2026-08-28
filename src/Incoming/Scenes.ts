
// Scene assembly and registration for Incoming (1998, Rage Software) levels. A level pairs an
// `.odl` object, terrain and sky definition with a `.wdl` placement list, plus an optional `.mdl`
// mission file holding the actors.

import { mat4, vec3, type ReadonlyMat4 } from "gl-matrix";
import { Mat4Identity } from "../MathHelpers.js";
import { GfxDevice, GfxFormat, GfxFrontFaceMode, GfxTexture } from "../gfx/platform/GfxPlatform.js";
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
const WATER_FRAME_COUNT = 16;
const SHADOW_OPACITY = 0.5;
const SHADOW_SIZE_FACTOR = 0.9;
const SHADOW_LIFT = 4;
const pathBase = "Incoming";
const subversionBase = "IncomingSubversion";
const SUBVERSION_OVERRIDES = new Set<string>(subversionOverridePaths);

// `drawtype flip*` mirrors the mesh with a negative scale. An odd number of flips flips the
// winding too, so such a part presents the opposite face to the camera.
function frontFaceForFlips(flipX: boolean, flipY: boolean, flipZ: boolean): GfxFrontFaceMode {
    const flips = (flipX ? 1 : 0) + (flipY ? 1 : 0) + (flipZ ? 1 : 0);
    return flips % 2 === 1 ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase().trim();
}

// Subversion ships a partial tree, so a path falls back to the base game unless it overrides it.
class PathResolver {
    constructor(private overrides: ReadonlySet<string>) {}

    public data(p: string): string {
        return this.resolve(normalizePath(p));
    }
    public texture(p: string): string {
        return this.resolve(`ppm/${normalizePath(p).replace(/\.ppm$/, ".png")}`);
    }
    public model(p: string): string {
        return this.resolve(`pcobject/${normalizePath(p)}`);
    }
    private resolve(rel: string): string {
        return `${this.overrides.has(rel) ? subversionBase : pathBase}/${rel}`;
    }
}

async function loadODLRecursive(dataFetcher: DataFetcher, paths: PathResolver, odlPath: string): Promise<IncomingODL> {
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
            await visit(paths.data(inc), false);
        }
    };

    await visit(odlPath, true);
    return { types, land, sky, offset, waterLevel, includes: [] };
}


async function loadTexture(device: GfxDevice, dataFetcher: DataFetcher, paths: PathResolver, cache: Map<string, GfxTexture | undefined>, ownedTextures: GfxTexture[], texturePath: string): Promise<GfxTexture | undefined> {
    const url = paths.texture(texturePath);
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


async function loadModel(device: GfxDevice, dataFetcher: DataFetcher, paths: PathResolver, cache: Map<string, IncomingMeshData | undefined>, ownedMeshes: IncomingMeshData[], modelPath: string): Promise<IncomingMeshData | undefined> {
    const url = paths.model(modelPath);
    if (cache.has(url)) {
        return cache.get(url);
    }
    let mesh: IncomingMeshData | undefined;
    try {
        const buffer = await dataFetcher.fetchData(url);
        const model = parseIAN(buffer);
        if (model.indices.length > 0 && model.vertices.length > 0) {
            mesh = new IncomingMeshData(device, model.vertices, model.indices, model.singleSidedIndexCount);
            ownedMeshes.push(mesh);
        }
    } catch {
        mesh = undefined;
    }
    cache.set(url, mesh);
    return mesh;
}

function buildModelMatrix(out: mat4, px: number, py: number, pz: number, forward: vec3, up: vec3, scale: number): void {
    const forwardAxis = vec3.normalize(vec3.create(), forward);
    const upAxis = vec3.normalize(vec3.create(), up);
    const rightAxis = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), upAxis, forwardAxis));
    const orthogonalUp = vec3.cross(vec3.create(), forwardAxis, rightAxis);

    // Column-major, so the columns are the scaled axes, then the translation.
    out[0] = rightAxis[0] * scale; out[1] = rightAxis[1] * scale; out[2] = rightAxis[2] * scale; out[3] = 0;
    out[4] = orthogonalUp[0] * scale; out[5] = orthogonalUp[1] * scale; out[6] = orthogonalUp[2] * scale; out[7] = 0;
    out[8] = forwardAxis[0] * scale; out[9] = forwardAxis[1] * scale; out[10] = forwardAxis[2] * scale; out[11] = 0;
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
    // Brighten a blend of the sun tint and the directional colour for the horizon.
    const glow = (i: number) => Math.min(255, ((sky.sunColor[i] + sky.directColor[i]) * 0.5) * 1.25);
    const horizon = [glow(0), glow(1), glow(2)];
    // Darken the same hue for the zenith, keeping the sky in one colour family.
    const zenith = [horizon[0] * 0.45, horizon[1] * 0.30, horizon[2] * 0.22];
    const bands: number[][] = [];
    for (let i = 0; i < 8; i++) {
        // Bands 0..3 span zenith to horizon; 4..7 hold at the horizon.
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
    // Follow the alias chain to a part with a real mesh, guarding against cycles.
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
            // `relative to`: a world-axis offset from the reference position.
            world = [base.world[0] + p.ref.dx, base.world[1] + p.ref.dy, base.world[2] + p.ref.dz];
        } else {
            // `local to` and `fixed_to ... at`: an offset in the reference's own rotated frame, so
            // its model matrix transforms the offset directly. `localxz` uses the full local frame
            // too, since reference objects are level and the yaw-only distinction never shows.
            const referenceMatrix = mat4.create();
            buildModelMatrix(referenceMatrix, base.world[0], base.world[1], base.world[2], base.forward as vec3, base.up as vec3, 1);
            const offsetWorld = vec3.transformMat4(vec3.create(), [p.ref.dx, p.ref.dy, p.ref.dz], referenceMatrix);
            world = [offsetWorld[0], offsetWorld[1], offsetWorld[2]];
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
            const referenceMatrix = mat4.create();
            buildModelMatrix(referenceMatrix, base.world[0], base.world[1], base.world[2], base.forward as vec3, base.up as vec3, 1);
            const offsetWorld = vec3.transformMat4(vec3.create(), [wp.ref.dx, wp.ref.dy, wp.ref.dz], referenceMatrix);
            world = [offsetWorld[0], offsetWorld[1], offsetWorld[2]];
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
        // Drop a point on top of the previous one, since a zero-length leg adds nothing.
        const prev = points[points.length - 1];
        if (Math.abs(w[0] - prev[0]) > 1 || Math.abs(w[1] - prev[1]) > 1 || Math.abs(w[2] - prev[2]) > 1) {
            points.push(w);
        }
    }
    if (points.length < 2) {
        return undefined;
    }
    const cumLengths: number[] = new Array(points.length);
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
        cumLengths[i] = acc;
        const b = points[(i + 1) % points.length];
        acc += Math.hypot(b[0] - points[i][0], b[1] - points[i][1], b[2] - points[i][2]);
    }
    return { points, cumLengths, totalLength: acc, speed: maxVel * SPIN_TICKS_PER_MS, forward, up, phase };
}

function buildPartFrames(type: IncomingObjectType, placementMatrix: ReadonlyMat4): mat4[] {
    const parts = type.parts;
    const n = parts.length;

    // Unit scale here: part offsets are already in world units.
    const local: mat4[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const p = parts[i];
        const m = mat4.create();
        buildModelMatrix(m, p.position[0], p.position[1], p.position[2], p.forward as vec3, p.up as vec3, 1);
        local[i] = m;
    }

    // One pass suffices because the parser guarantees a parent's index precedes its child's.
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
        // Stop the walk from spinning a parent object, which made buildings turn along with their
        // mounted satellite dish.
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
        const paths = new PathResolver(this.subversion ? SUBVERSION_OVERRIDES : new Set());

        const odl = await loadODLRecursive(dataFetcher, paths, paths.data(this.odlPath));
        const globalParts = buildGlobalPartRegistry(odl.types);
        const wdlBuffer = await dataFetcher.fetchData(paths.data(this.wdlPath));
        const placements = parseWDL(new TextDecoder("latin1").decode(wdlBuffer.createTypedArray(Uint8Array)));

        const sky = odl.sky;
        const fogColor: [number, number, number] = sky !== undefined ? normColor(sky.fogColor) : [0.5, 0.6, 0.7];
        // `not_unit` leaves the vector un-normalized, letting its magnitude scale the directional
        // term. The warm sunset look comes from the sun `color`, not the gray `direct` value.
        const lightDir: [number, number, number] = sky === undefined ? [0.4, 0.8, 0.4]
            : sky.lightUnnormalized ? [sky.lightDir[0], sky.lightDir[1], sky.lightDir[2]]
            : (vec3.normalize(vec3.create(), sky.lightDir as vec3) as unknown as [number, number, number]);
        // A `flat` sky derives its gradient from the level's own lighting, so the player sees the
        // sun-tinted sky rather than the deep-blue backdrop bands the engine hides behind its
        // warm-lit cloud plane. Space levels keep their authored bands, and the moon has none.
        const skyGradient: number[][] = sky !== undefined ? (sky.flat ? deriveSkyGradient(sky) : sky.gradient) : [];
        // Clear to the gradient's horizon band so nothing peeks through in a foreign colour.
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
            // Toward the light's `from` direction, converted to noclip space by negating Y and Z.
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

        if (sky !== undefined && sky.texturePath !== undefined) {
            renderer.skyCloudTexture = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, sky.texturePath);
        }
        if (sky !== undefined && sky.sunImagePath !== undefined) {
            renderer.sunTexture = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, sky.sunImagePath);
        }

        let heightfield: Heightfield | undefined;
        if (odl.land !== undefined) {
            const land = odl.land;
            try {
                const hfBuffer = await dataFetcher.fetchData(paths.data(land.heightfieldPath));
                const cfBuffer = await dataFetcher.fetchData(paths.data(land.cellFlagsPath));
                heightfield = parseHeightfield(hfBuffer);

                const landTextures: (GfxTexture | undefined)[] = [];
                for (let i = 0; i < TERRAIN_MAX_TEXTURES; i++) {
                    const tp = land.texturePaths[i];
                    landTextures.push(tp !== undefined ? await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, tp) : undefined);
                }

                const terrainMeshes = buildTerrainMeshes(heightfield, cfBuffer);
                for (const tm of terrainMeshes) {
                    const mesh = new IncomingMeshData(device, tm.vertices, tm.indices);
                    renderer.meshes.push(mesh);
                    renderer.instances.push({
                        mesh, texture: landTextures[tm.textureIndex],
                        modelMatrix: mat4.create(), selfIllum: false, colorKey: false,
                        twoSided: false, indexFormat: indexFormatFor(tm.indices),
                        frontFace: GfxFrontFaceMode.CCW,
                    });
                }
                // A flat plane over the water-flagged tiles, at the ODL `water` level.
                if (odl.waterLevel !== undefined) {
                    const waterMesh = buildWaterMesh(cfBuffer, odl.waterLevel);
                    if (waterMesh !== undefined) {
                        const mesh = new IncomingMeshData(device, waterMesh.vertices, waterMesh.indices);
                        renderer.meshes.push(mesh);
                        // Reuse the `animatemodel` flipbook to cycle textures on one shared mesh.
                        const waterFrames: IncomingAnimFrame[] = [];
                        for (let n = 1; n <= WATER_FRAME_COUNT; n++) {
                            const tex = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, `water4\\water${n}.ppm`);
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
                // Without the terrain binaries the level still renders its objects.
            }
        }

        const labelWorld = new Map<string, ResolvedPlacement>();
        const instancePlacement = async (type: IncomingObjectType, placementMatrix: ReadonlyMat4, mover?: IncomingMover): Promise<void> => {
            const frames = buildPartFrames(type, placementMatrix);
            // Largest scaled part footprint, which sizes the ground shadow.
            let footprintRadius = 0;
            for (let i = 0; i < type.parts.length; i++) {
                const part = type.parts[i];
                const partSpin = effectiveSpin(type, i);
                // Lights, sprites, smoke and shadows all bake to fixed world points, and a moving
                // actor's frames are actor-local, so baking them would strand the effects at the
                // origin. Travelling effects can come later.
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
                if (part.smoke !== undefined && mover === undefined) {
                    const smoke = part.smoke;
                    const emitterWorld = vec3.transformMat4(vec3.create(), smoke.offset as vec3, frames[i]);
                    const smokeTex = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, "smoke.ppm");
                    renderer.smoke.push({
                        position: [emitterWorld[0], emitterWorld[1], emitterWorld[2]],
                        size: smoke.size,
                        color: smoke.color,
                        alpha: smoke.alpha,
                        rate: smoke.rate,
                        lifetime: smoke.lifetime,
                        additive: smoke.additive,
                        texture: smokeTex,
                    });
                }
                // This has to precede mesh resolution, which would `continue` past the sprite-only
                // parts that carry no mesh of their own.
                if (part.sprite !== undefined && mover === undefined) {
                    const sprite = part.sprite;
                    const spriteWorld = mat4.getTranslation(vec3.create(), frames[i]);
                    const tex = part.texturePath !== undefined ? await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, part.texturePath) : undefined;
                    renderer.sprites.push({
                        position: [spriteWorld[0], spriteWorld[1], spriteWorld[2]],
                        size: sprite.size,
                        uvRect: [sprite.u / SPRITE_ATLAS_SIZE, sprite.v / SPRITE_ATLAS_SIZE, sprite.w / SPRITE_ATLAS_SIZE, sprite.h / SPRITE_ATLAS_SIZE],
                        texture: tex,
                        color: sprite.color,
                        cycleColors: sprite.cycleColors,
                        cycleSpeed: sprite.cycleSpeed,
                    });
                }
                // The radius is already in world units, so the mesh sits at the part frame with unit
                // scale rather than the part's own.
                if (part.procGeom !== undefined) {
                    const geom = part.procGeom;
                    const cacheKey = `${geom.kind}:${geom.radius}:${geom.width}:${geom.height}:${geom.repeatU}:${geom.repeatV}`;
                    let procMesh = procCache.get(cacheKey);
                    if (procMesh === undefined) {
                        const generated = geom.kind === "hemisphere"
                            ? buildHemisphereMesh(geom.radius, geom.width, geom.height, geom.repeatU, geom.repeatV)
                            : buildSphereMesh(geom.radius, geom.width, geom.height);
                        procMesh = new IncomingMeshData(device, generated.vertices, generated.indices);
                        renderer.meshes.push(procMesh);
                        procCache.set(cacheKey, procMesh);
                    }
                    const procTexture = part.texturePath !== undefined ? await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, part.texturePath) : undefined;
                    let texAnim: IncomingAnimFrame[] | undefined;
                    if (part.textures.length > 1) {
                        const textureFrames: IncomingAnimFrame[] = [];
                        for (const texturePath of part.textures) {
                            const frameTexture = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, texturePath);
                            if (frameTexture !== undefined) {
                                textureFrames.push({ mesh: procMesh, texture: frameTexture });
                            }
                        }
                        if (textureFrames.length > 1) {
                            texAnim = textureFrames;
                        }
                    }
                    renderer.instances.push({
                        mesh: procMesh, texture: texAnim !== undefined ? texAnim[0].texture : procTexture, modelMatrix: mat4.clone(frames[i]),
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
                if (part.animFrames.length > 0) {
                    const animFrames: IncomingAnimFrame[] = [];
                    let frameScale = 1, frameSelfIllum = false, frameColorKey = false, frameTwoSided = false;
                    for (const frameName of part.animFrames) {
                        const frameType = odl.types.get(frameName.toLowerCase());
                        if (frameType === undefined || frameType.parts.length === 0) {
                            continue;
                        }
                        const frameMaterial = resolvePartMaterial(frameType, frameType.parts[0], globalParts);
                        if (frameMaterial === undefined) {
                            continue;
                        }
                        const frameMesh = await loadModel(device, dataFetcher, paths, modelCache, renderer.meshes, frameMaterial.objfile);
                        if (frameMesh === undefined) {
                            continue;
                        }
                        const frameTexture = frameMaterial.texturePath !== undefined ? await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, frameMaterial.texturePath) : undefined;
                        animFrames.push({ mesh: frameMesh, texture: frameTexture });
                        footprintRadius = Math.max(footprintRadius, frameMesh.localRadiusXZ * frameMaterial.scale);
                        frameScale = frameMaterial.scale;
                        frameSelfIllum = (frameMaterial.materialFlags & IncomingMaterialFlag.SelfIlluminating) !== 0;
                        frameColorKey = (frameMaterial.textureFlags & IncomingTextureFlag.ColorKey) !== 0;
                        frameTwoSided = frameMaterial.doubleSided;
                    }
                    if (animFrames.length > 0) {
                        const scale = frameScale;
                        const modelMatrix = mat4.multiply(mat4.create(), frames[i], mat4.fromScaling(mat4.create(), [scale, scale, scale]));
                        renderer.instances.push({
                            mesh: animFrames[0].mesh, texture: animFrames[0].texture, modelMatrix,
                            selfIllum: frameSelfIllum, colorKey: frameColorKey, twoSided: frameTwoSided,
                            indexFormat: GfxFormat.U32_R, animFrames,
                            spin: partSpin, baseFrame: frames[i], meshScale: scale, mover,
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
                const mesh = await loadModel(device, dataFetcher, paths, modelCache, renderer.meshes, material.objfile);
                if (mesh === undefined) {
                    continue;
                }
                footprintRadius = Math.max(footprintRadius, mesh.localRadiusXZ * material.scale);
                const texture = material.texturePath !== undefined ? await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, material.texturePath) : undefined;

                // A negative scale mirrors the mesh, which is how the data builds a rotated variant
                // from a shared one.
                const scale = material.scale;
                const mirroredScale: [number, number, number] = [
                    part.flipX ? -scale : scale, part.flipY ? -scale : scale, part.flipZ ? -scale : scale,
                ];
                const modelMatrix = mat4.multiply(mat4.create(), frames[i], mat4.fromScaling(mat4.create(), mirroredScale));

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
                    frontFace: frontFaceForFlips(part.flipX, part.flipY, part.flipZ),
                    spin: partSpin,
                    flameFlicker: part.flameFlicker,
                    baseFrame: frames[i],
                    meshScale: scale,
                    animTargetFrame,
                    mover,
                });
            }
            if (type.shadowTexture !== undefined && footprintRadius > 0 && mover === undefined) {
                const shadowTex = await loadTexture(device, dataFetcher, paths, textureCache, renderer.textures, type.shadowTexture);
                // An undefined bind samples the fallback white texture, painting a solid black
                // square instead of a silhouette.
                if (shadowTex !== undefined) {
                    const objX = placementMatrix[12], objZ = placementMatrix[14];
                    const groundY = heightfield !== undefined ? sampleGroundHeight(heightfield, objX, objZ) : placementMatrix[13];
                    const flattenedForward: [number, number, number] = [placementMatrix[8], 0, placementMatrix[10]];
                    if (flattenedForward[0] === 0 && flattenedForward[2] === 0) {
                        flattenedForward[2] = 1;
                    }
                    const shadowMatrix = mat4.create();
                    buildModelMatrix(shadowMatrix, objX, groundY - SHADOW_LIFT, objZ, flattenedForward as vec3, [0, 1, 0], footprintRadius * SHADOW_SIZE_FACTOR);
                    renderer.shadows.push({ modelMatrix: shadowMatrix, texture: shadowTex, opacity: SHADOW_OPACITY });
                }
            }
        };
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
        const mdlPath = this.mdlPathOverride ?? this.wdlPath.replace(/\.wdl$/i, "_action.mdl");
        let mdlPlacements: IncomingMDLPlacement[] = [];
        try {
            const mdlBuffer = await dataFetcher.fetchData(paths.data(mdlPath));
            mdlPlacements = parseMDL(new TextDecoder("latin1").decode(mdlBuffer.createTypedArray(Uint8Array)));
        } catch {
            // A level without a mission file has no actors.
        }
        // Register every absolute label first, so reference-relative placements resolve whatever
        // order the file lists them in.
        for (const p of mdlPlacements) {
            if (p.abs === undefined || p.label === undefined) {
                continue;
            }
            const wx = p.abs.x + odl.offset, wz = p.abs.z + odl.offset;
            const wy = p.abs.onGround && heightfield !== undefined ? sampleGroundHeight(heightfield, wx, wz) : p.abs.y;
            labelWorld.set(p.label.toLowerCase(), { world: [wx, wy, wz], forward: p.forward ?? [0, 0, 1], up: p.up });
        }
        // Dynamic spawns and references to an unknown label resolve to undefined, so skip them.
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
            if (p.path !== undefined && type.maxVel !== undefined && type.maxVel > 0) {
                const mover = buildMover(resolved.world, p.path.waypoints, odl.offset, heightfield, labelWorld, type.maxVel, resolved.forward, resolved.up, 0);
                if (mover !== undefined) {
                    await instancePlacement(type, Mat4Identity, mover);
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
    ],
};

export const subversionSceneGroup: SceneGroup = {
    id: "IncomingSubversion", name: "Incoming: Subversion",
    sceneDescs: [
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
