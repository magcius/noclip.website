
import { ReadonlyVec3, vec3 } from "gl-matrix";
import { colorNewCopy, TransparentBlack, colorCopy, colorScaleAndAdd, colorScale, Color, White, colorNewFromRGBA } from "../../Color.js";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D, drawWorldSpaceLine } from "../../DebugJunk.js";
import { Vec3NegX, Vec3NegY, Vec3NegZ, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero, invlerp, lerp } from "../../MathHelpers.js";
import { fillVec4, fillVec3v, fillColor } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxrResolveTextureID } from "../../gfx/render/GfxRenderGraph.js";
import { nArray, assert } from "../../util.js";
import { BSPFile, Cubemap, WorldLight, WorldLightType, AmbientCube, BSPLeaf, WorldLightFlags } from "../BSPFile.js";
import { BSPRenderer, SourceEngineView, SourceEngineViewType } from "../Main.js";
import { VTF } from "../VTF.js";

//#region Runtime Lighting / LightCache
function findEnvCubemapTexture(bspfile: BSPFile, pos: ReadonlyVec3): Cubemap | null {
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < bspfile.cubemaps.length; i++) {
        const distance = vec3.squaredDistance(pos, bspfile.cubemaps[i].pos);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    if (bestIndex < 0)
        return null;

    return bspfile.cubemaps[bestIndex];
}

function worldLightInsideRadius(light: WorldLight, delta: ReadonlyVec3): boolean {
    return light.radius <= 0.0 || vec3.squaredLength(delta) <= light.radius**2;
}

function worldLightDistanceFalloff(light: WorldLight, delta: ReadonlyVec3): number {
    if (light.type === WorldLightType.Surface) {
        const sqdist = vec3.squaredLength(delta);
        if (light.radius > 0.0 && sqdist > light.radius**2)
            return 0.0;
        return 1.0 / Math.max(1.0, vec3.squaredLength(delta));
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.Spotlight) {
        const sqdist = vec3.squaredLength(delta);
        if (light.radius > 0.0 && sqdist > light.radius**2)
            return 0.0;

        // Compute quadratic attn falloff.
        const dist = Math.sqrt(sqdist);
        const denom = (1.0*light.distAttenuation[0] + dist*light.distAttenuation[1] + sqdist*light.distAttenuation[2]);
        return 1.0 / denom;
    } else if (light.type === WorldLightType.SkyLight) {
        // Sky light requires visibility to the sky. Until we can do a raycast,
        // just place low on the list...
        return 0.1;
    } else if (light.type === WorldLightType.SkyAmbient) {
        // Already in ambient cube; ignore.
        return 0.0;
    } else if (light.type === WorldLightType.QuakeLight) {
        return Math.max(0.0, light.distAttenuation[1] - vec3.length(delta));
    } else {
        throw "whoops";
    }
}

function worldLightAngleFalloff(light: WorldLight, surfaceNormal: ReadonlyVec3, delta: ReadonlyVec3): number {
    if (light.type === WorldLightType.Surface) {
        const dot1 = vec3.dot(surfaceNormal, delta);
        if (dot1 <= 0.0)
            return 0.0;
        const dot2 = -vec3.dot(delta, light.normal);
        if (dot2 <= 0.0)
            return 0.0;
        return dot1 * dot2;
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.QuakeLight) {
        const dot = vec3.dot(surfaceNormal, delta);
        if (dot <= 0.0)
            return 0.0;
        return dot;
    } else if (light.type === WorldLightType.Spotlight) {
        const visDot = vec3.dot(surfaceNormal, delta);
        if (visDot <= 0.0)
            return 0.0;

        const angleDot = -vec3.dot(delta, light.normal);
        if (angleDot <= light.stopdot2) // Outside outer cone.
            return 0.0;

        if (angleDot >= light.stopdot) // Inside inner cone.
            return visDot;

        const ratio = Math.pow(invlerp(light.stopdot2, light.stopdot, angleDot), light.exponent);
        return visDot * ratio;
    } else if (light.type === WorldLightType.SkyLight) {
        const dot = -vec3.dot(delta, light.normal);
        if (dot <= 0.0)
            return 0.0;
        return dot;
    } else if (light.type === WorldLightType.SkyAmbient) {
        return 1.0;
    } else {
        throw "whoops";
    }
}

const scratchVec3 = vec3.create();
const ntscGrayscale = vec3.fromValues(0.299, 0.587, 0.114);

export const enum ShaderWorldLightType {
    None, Point, Spot, Directional,
}

function fillWorldLight(d: Float32Array, offs: number, light: WorldLight | null, worldLightingState: WorldLightingState): number {
    const base = offs;

    if (light === null) {
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        return offs - base;
    }

    if (light.style >= 0)
        vec3.scale(scratchVec3, light.intensity, worldLightingState.styleIntensities[light.style]);
    else
        vec3.copy(scratchVec3, light.intensity);

    if (light.type === WorldLightType.Surface) {
        // 180 degree spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec4(d, offs, 0, 0, 1);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.Spotlight) {
        // Controllable spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3, light.exponent);
        offs += fillVec3v(d, offs, light.distAttenuation, light.stopdot);
        offs += fillVec3v(d, offs, light.normal, light.stopdot2);
    } else if (light.type === WorldLightType.Point) {
        const type = ShaderWorldLightType.Point;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec3v(d, offs, light.distAttenuation);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.SkyLight) {
        // Directional.
        const type = ShaderWorldLightType.Directional;
        offs += fillVec3v(d, offs, Vec3Zero, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec4(d, offs, 0);
        offs += fillVec3v(d, offs, light.normal);
    } else {
        debugger;
    }

    return offs - base;
}

class LightCacheWorldLight {
    public worldLight: WorldLight | null = null;
    public intensity: number = 0;

    public copy(o: LightCacheWorldLight): void {
        this.worldLight = o.worldLight;
        this.intensity = o.intensity;
    }

    public reset(): void {
        this.worldLight = null;
        this.intensity = 0;
    }

    public fill(d: Float32Array, offs: number, worldLightingState: WorldLightingState): number {
        return fillWorldLight(d, offs, this.worldLight, worldLightingState);
    }
}

function newAmbientCube(): AmbientCube {
    return nArray(6, () => colorNewCopy(TransparentBlack));
}

function computeAmbientCubeFromLeaf(dst: AmbientCube, leaf: BSPLeaf, pos: ReadonlyVec3): boolean {
    // XXX(jstpierre): This breaks on d2_coast_01, where there's a prop located outside
    // the leaf it's in due to floating point rounding error.
    // assert(leaf.bbox.containsPoint(pos));

    if (leaf.ambientLightSamples.length === 0) {
        // No ambient light samples.
        return false;
    } else if (leaf.ambientLightSamples.length === 1) {
        // Fast path.
        const sample = leaf.ambientLightSamples[0];
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], sample.ambientCube[p]);

        return true;
    } else {
        // Slow path.
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], TransparentBlack);

        let totalWeight = 0.0;

        for (let i = 0; i < leaf.ambientLightSamples.length; i++) {
            const sample = leaf.ambientLightSamples[i];

            // Compute the weight for each sample, using inverse square falloff.
            const dist2 = vec3.squaredDistance(sample.pos, pos);
            const weight = 1.0 / (dist2 + 1.0);
            totalWeight += weight;

            for (let p = 0; p < 6; p++)
                colorScaleAndAdd(dst[p], dst[p], sample.ambientCube[p], weight);
        }

        for (let p = 0; p < 6; p++)
            colorScale(dst[p], dst[p], 1.0 / totalWeight);

        return true;
    }
}

export function worldLightingCalcColorForPoint(dst: Color, bspRenderer: BSPRenderer, pos: ReadonlyVec3): void {
    dst.r = 0;
    dst.g = 0;
    dst.b = 0;

    const bspfile = bspRenderer.bsp;
    for (let i = 0; i < bspfile.worldlights.length; i++) {
        const light = bspfile.worldlights[i];

        vec3.sub(scratchVec3, light.pos, pos);
        const ratio = worldLightDistanceFalloff(light, scratchVec3);
        vec3.normalize(scratchVec3, scratchVec3);
        const angularRatio = worldLightAngleFalloff(light, scratchVec3, scratchVec3);

        dst.r += light.intensity[0] * ratio * angularRatio;
        dst.g += light.intensity[1] * ratio * angularRatio;
        dst.b += light.intensity[2] * ratio * angularRatio;
    }
}

export class ProjectedLight {
    public farZ: number = 1000;
    public frustumView = new SourceEngineView();
    public texture: VTF | null = null;
    public textureFrame: number = 0;
    public lightColor = colorNewCopy(White);
    public brightnessScale: number = 1.0;
    public resolveTextureID: GfxrResolveTextureID;

    constructor() {
        this.frustumView.viewType = SourceEngineViewType.ShadowMap;
    }
}

const ambientCubeDirections = [ Vec3UnitX, Vec3NegX, Vec3UnitY, Vec3NegY, Vec3UnitZ, Vec3NegZ ] as const;
export class LightCache {
    private leaf: number = -1;
    public envCubemap: Cubemap | null;

    private worldLights: LightCacheWorldLight[] = nArray(4, () => new LightCacheWorldLight());
    private ambientCube: AmbientCube = newAmbientCube();

    constructor(bspRenderer: BSPRenderer, private pos: ReadonlyVec3) {
        this.calc(bspRenderer);
    }

    public debugDrawLights(view: SourceEngineView): void {
        for (let i = 0; i < this.worldLights.length; i++) {
            const worldLight = this.worldLights[i].worldLight;
            if (worldLight !== null) {
                const norm = 1 / Math.max(...worldLight.intensity);
                const lightColor = colorNewFromRGBA(worldLight.intensity[0] * norm, worldLight.intensity[1] * norm, worldLight.intensity[2] * norm);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, worldLight.pos, lightColor, 10);

                const lineColorI = [1.0, 0.8, 0.5, 0.0][i];
                const lineColor = colorNewFromRGBA(lineColorI, lineColorI, lineColorI);
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.pos, worldLight.pos, lineColor, 4);
            }
        }
    }

    private cacheAmbientLight(leaf: BSPLeaf): boolean {
        return computeAmbientCubeFromLeaf(this.ambientCube, leaf, this.pos);
    }

    private addWorldLightToAmbientCube(light: WorldLight): void {
        vec3.sub(scratchVec3, light.pos, this.pos);
        const ratio = worldLightDistanceFalloff(light, scratchVec3);
        vec3.normalize(scratchVec3, scratchVec3);
        const angularRatio = worldLightAngleFalloff(light, scratchVec3, scratchVec3);

        for (let i = 0; i < ambientCubeDirections.length; i++) {
            const dst = this.ambientCube[i];
            const mul = vec3.dot(scratchVec3, ambientCubeDirections[i]) * ratio * angularRatio;
            if (mul <= 0)
                continue;
            dst.r += light.intensity[0] * mul;
            dst.g += light.intensity[1] * mul;
            dst.b += light.intensity[2] * mul;
        }
    }

    private cacheWorldLights(worldLights: WorldLight[], hasAmbientLeafLighting: boolean): void {
        for (let i = 0; i < this.worldLights.length; i++)
            this.worldLights[i].reset();

        for (let i = 0; i < worldLights.length; i++) {
            const light = worldLights[i];

            if (hasAmbientLeafLighting && !!(light.flags & WorldLightFlags.InAmbientCube))
                continue;

            vec3.sub(scratchVec3, light.pos, this.pos);
            const ratio = worldLightDistanceFalloff(light, scratchVec3);
            vec3.normalize(scratchVec3, scratchVec3);
            const intensity = ratio * vec3.dot(light.intensity, ntscGrayscale);

            if (intensity <= 0.0)
                continue;

            // Look for a place to insert.
            for (let j = 0; j < this.worldLights.length; j++) {
                if (intensity <= this.worldLights[j].intensity)
                    continue;

                // Found a better light than the one we have right now. Move down the remaining ones to make room.

                // If we're about to eject a light, toss it into the ambient cube first.
                const ejectedLight = this.worldLights[this.worldLights.length - 1].worldLight;
                if (ejectedLight !== null)
                    this.addWorldLightToAmbientCube(ejectedLight);

                for (let k = this.worldLights.length - 1; k > j; k--)
                    if (this.worldLights[k - 1].worldLight !== null)
                        this.worldLights[k].copy(this.worldLights[k - 1]);

                this.worldLights[j].worldLight = light;
                this.worldLights[j].intensity = intensity;
                break;
            }
        }
    }

    private calc(bspRenderer: BSPRenderer): void {
        const bspfile = bspRenderer.bsp;

        // Calculate leaf information.
        this.leaf = bspfile.findLeafIdxForPoint(this.pos);
        assert(this.leaf >= 0);

        this.envCubemap = findEnvCubemapTexture(bspfile, this.pos);

        // Reset ambient cube to leaf lighting.
        const hasAmbientLeafLighting = this.cacheAmbientLight(bspfile.leaflist[this.leaf]);

        // Now go through and cache world lights.
        this.cacheWorldLights(bspfile.worldlights, hasAmbientLeafLighting);
    }

    public fillAmbientCube(d: Float32Array, offs: number): number {
        const base = offs;
        for (let i = 0; i < 6; i++)
            offs += fillColor(d, offs, this.ambientCube[i]);
            // offs += fillVec4(d, offs, 0.5, 0.5, 0.5);
        return offs - base;
    }

    public fillWorldLights(d: Float32Array, offs: number, worldLightingState: WorldLightingState): number {
        const base = offs;
        for (let i = 0; i < this.worldLights.length; i++)
            offs += this.worldLights[i].fill(d, offs, worldLightingState);
        return offs - base;
    }
}
//#endregion

//#region Lightmap / Lighting data
export class WorldLightingState {
    public styleIntensities = new Float32Array(64);
    public stylePatterns: string[] = [
        'm',
        'mmnmmommommnonmmonqnmmo',
        'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba',
        'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',
        'mamamamamama',
        'jklmnopqrstuvwxyzyxwvutsrqponmlkj',
        'nmonqnmomnmomomno',
        'mmmaaaabcdefgmmmmaaaammmaamm',
        'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',
        'aaaaaaaazzzzzzzz',
        'mmamammmmammamamaaamammma',
        'abcdefghijklmnopqrrqponmlkjihgfedcba',
        'mmnnmmnnnmmnn',
    ];
    private smoothAnim = false;
    private doUpdates = true;

    constructor() {
        this.styleIntensities.fill(1.0);
    }

    private styleIntensityFromChar(c: number): number {
        const alpha = c - 0x61;
        assert(alpha >= 0 && alpha <= 25);
        return (alpha * 22) / 264.0;
    }

    private styleIntensityFromPattern(pattern: string, time: number): number {
        const t = time % pattern.length;
        const i0 = t | 0;
        const p0 = this.styleIntensityFromChar(pattern.charCodeAt(i0));

        if (this.smoothAnim) {
            const i1 = (i0 + 1) % pattern.length;
            const t01 = t - i0;

            const p1 = this.styleIntensityFromChar(pattern.charCodeAt(i1));
            return lerp(p0, p1, t01);
        } else {
            return p0;
        }
    }

    public update(timeInSeconds: number): void {
        if (!this.doUpdates)
            return;

       const time = (timeInSeconds * 10);
        for (let i = 0; i < this.styleIntensities.length; i++) {
            const pattern = this.stylePatterns[i];
            if (pattern === undefined)
                continue;

            this.styleIntensities[i] = this.styleIntensityFromPattern(pattern, time);
        }
    }
}
//#endregion
