import { mat4, vec2 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { readWaterMeshes_KindD, WaterMesh_KindD } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyUpdateKit, MobyImpl } from "./moby";
import { WaterGeometry } from "../render-water";
import { GfxTopology, makeTriangleIndexBuffer } from "../../gfx/helpers/TopologyHelpers";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";

interface WaterDecl_D {
    positionsVaddr: number;
    texcoordsVaddr: number;
    colorsVaddr: number;
    vertexCountsVaddr: number;
    uvScrollSpeedVaddr: number;
    uvScrollSpeedCount: number;
    count: number;
    textureId: number;
    replaceVertexColorRgb?: [number, number, number];
    alphaScale?: number;
    additive?: boolean;
    depthWrite?: boolean;
    additiveSecondDraw?: boolean;
    ignoreTextureAlpha?: boolean;
}
export const RAC1_WATER_KIND_D = new Map<number, WaterDecl_D[]>([
    // each moby is one waterfall with 3 meshes
    // - the main water part
    // - the falling water part
    // - the splash part
    [1903, [
        { positionsVaddr: 0x162540, texcoordsVaddr: 0x162550, colorsVaddr: 0x162570, vertexCountsVaddr: 0x162530, uvScrollSpeedVaddr: 0x1f14d0, uvScrollSpeedCount: 3, textureId: 0x2c, replaceVertexColorRgb: [0.7, 1.0, 0.9], alphaScale: 1, count: 4, additive: false },
        { positionsVaddr: 0x1ff6d0, texcoordsVaddr: 0x1ff6f0, colorsVaddr: 0x1ff730, vertexCountsVaddr: 0x1f9a78, uvScrollSpeedVaddr: 0x162508, uvScrollSpeedCount: 2, textureId: 0x2a, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 8, additive: true },
        { positionsVaddr: 0x1f99b8, texcoordsVaddr: 0x1f99e8, colorsVaddr: 0x1f9a48, vertexCountsVaddr: 0x1f4978, uvScrollSpeedVaddr: 0x162520, uvScrollSpeedCount: 1, textureId: 0x2b, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 11, additive: true },
    ]],
    [1919, [
        { positionsVaddr: 0x215148, texcoordsVaddr: 0x215190, colorsVaddr: 0x215220, vertexCountsVaddr: 0x207900, uvScrollSpeedVaddr: 0x200710, uvScrollSpeedCount: 3, textureId: 0x2c, replaceVertexColorRgb: [0.7, 1.0, 0.9], alphaScale: 1, count: 17, additive: false },
        { positionsVaddr: 0x207860, texcoordsVaddr: 0x207888, colorsVaddr: 0x2078d8, vertexCountsVaddr: 0x200728, uvScrollSpeedVaddr: 0x1625d8, uvScrollSpeedCount: 2, textureId: 0x2a, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 9, additive: true },
        { positionsVaddr: 0x2176f8, texcoordsVaddr: 0x217710, colorsVaddr: 0x217740, vertexCountsVaddr: 0x215268, uvScrollSpeedVaddr: 0x1625f0, uvScrollSpeedCount: 1, textureId: 0x2b, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 5, additive: true },
    ]],
    [600, [
        { positionsVaddr: 0x1e8268, texcoordsVaddr: 0x1e82a0, colorsVaddr: 0x1e8310, vertexCountsVaddr: 0x1e2858, uvScrollSpeedVaddr: 0x1db500, uvScrollSpeedCount: 3, textureId: 0x3d, replaceVertexColorRgb: [0.5, 0.5, 0.65], alphaScale: 0.5, count: 13, additive: false },
        { positionsVaddr: 0x1e2798, texcoordsVaddr: 0x1e27c8, colorsVaddr: 0x1e2828, vertexCountsVaddr: 0x1ddf40, uvScrollSpeedVaddr: 0x161de0, uvScrollSpeedCount: 2, textureId: 0x3c, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 11, additive: true },
        { positionsVaddr: 0x1ddec0, texcoordsVaddr: 0x1ddee0, colorsVaddr: 0x1ddf20, vertexCountsVaddr: 0x1db518, uvScrollSpeedVaddr: 0x161df8, uvScrollSpeedCount: 1, textureId: 0x3a, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 8, additive: true },
    ]],
    [1649, [
        { positionsVaddr: 0x1f84c8, texcoordsVaddr: 0x1f84e8, colorsVaddr: 0x1f8528, vertexCountsVaddr: 0x1f4c60, uvScrollSpeedVaddr: 0x1ef790, uvScrollSpeedCount: 3, textureId: 0x3d, replaceVertexColorRgb: [0.5, 0.5, 0.65], alphaScale: 0.5, count: 8, additive: false },
        { positionsVaddr: 0x1f4c00, texcoordsVaddr: 0x1f4c18, colorsVaddr: 0x1f4c48, vertexCountsVaddr: 0x1f01c8, uvScrollSpeedVaddr: 0x1623a0, uvScrollSpeedCount: 2, textureId: 0x3c, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 6, additive: true },
        { positionsVaddr: 0x1623d0, texcoordsVaddr: 0x1623d8, colorsVaddr: 0x1623e8, vertexCountsVaddr: 0x1623c8, uvScrollSpeedVaddr: 0x1623b8, uvScrollSpeedCount: 1, textureId: 0x3a, replaceVertexColorRgb: [1, 1, 1], alphaScale: 1, count: 2, additive: true },
    ]],
    // this one is different
    // - the first one is the ooze
    // - the second one is the ocean, and is drawn a second time with additive blending
    [1901, [
        { positionsVaddr: 0x2059e0, texcoordsVaddr: 0x205a08, colorsVaddr: 0x205a58, vertexCountsVaddr: 0x1fbd10, uvScrollSpeedVaddr: 0x1620d8, uvScrollSpeedCount: 1, textureId: 0x2c, replaceVertexColorRgb: [0.2, 1.2, 0.8], alphaScale: 1, count: 10, depthWrite: true, additive: false },
        { positionsVaddr: 0x208a98, texcoordsVaddr: 0x208ab0, colorsVaddr: 0x208ae0, vertexCountsVaddr: 0x205a80, uvScrollSpeedVaddr: 0x1620e0, uvScrollSpeedCount: 2, textureId: 0x2f, replaceVertexColorRgb: [0.1, 0.7, 0.6], alphaScale: 1, count: 5, depthWrite: true, additiveSecondDraw: true, ignoreTextureAlpha: true },
    ]],
]);

/**
 * Adhoc worldspace meshes
 * 
 * - Flowing water and ocean on hoven (uses two layered textures)
 * - Flowing water on batalia
 * - Flowing water on pokitaru
 */
export class Water_D implements MobyImpl {
    private decls: WaterDecl_D[];
    private meshes: WaterMesh_KindD[] = [];
    private geometries: WaterGeometry[] | null = null;

    private uvScrolls: vec2[][] = [];
    private zWobble = vec2.create();

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);

        const decls = RAC1_WATER_KIND_D.get(mobyInstance.oClass);
        assert(decls !== undefined);
        this.decls = decls;

        for (let i = 0; i < this.decls.length; i++) {
            const decl = this.decls[i];
            const waterMesh = readWaterMeshes_KindD(
                resources.overlaySections,
                decl.positionsVaddr,
                decl.texcoordsVaddr,
                decl.colorsVaddr,
                decl.vertexCountsVaddr,
                decl.uvScrollSpeedVaddr,
                decl.uvScrollSpeedCount,
                decl.count,
            );
            this.meshes.push(waterMesh);
            this.uvScrolls.push(waterMesh.uvScrollSpeeds.map(() => vec2.fromValues(Math.random(), Math.random())));
        }
    }

    update(updateKit: MobyUpdateKit) {
        const dtSeconds = updateKit.dt / 1000;
        for (let i = 0; i < this.meshes.length; i++) {
            for (let j = 0; j < this.meshes[i].uvScrollSpeeds.length; j++) {
                const speed = this.meshes[i].uvScrollSpeeds[j];
                vec2.scaleAndAdd(this.uvScrolls[i][j], this.uvScrolls[i][j], [speed.x, speed.y], dtSeconds);
            }
        }
    }

    private getOrCreateGeometries(updateKit: MobyUpdateKit): WaterGeometry[] {
        if (this.geometries) return this.geometries;

        this.geometries = [];
        for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex++) {
            const waterMesh = this.meshes[meshIndex];
            const decl = this.decls[meshIndex];

            const positions: number[] = [];
            const texcoords: number[] = [];
            const vertexColors: number[] = [];
            const indices: number[] = [];
            let vertexOffset = 0;

            for (let stripIndex = 0; stripIndex < waterMesh.stripCount; stripIndex++) {
                const vertexCount = waterMesh.vertexCounts[stripIndex];
                if (vertexCount === 0) continue;

                for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
                    const position = waterMesh.positions[stripIndex].getFloat32_Xyz(vertexIndex * 3 * 4);
                    const texcoord = waterMesh.texcoords[stripIndex].getFloat32_Xy(vertexIndex * 2 * 4);
                    positions.push(position.x, position.y, position.z);
                    texcoords.push(texcoord.x, texcoord.y);

                    const color = waterMesh.colors[stripIndex].getUint8_Rgba(vertexIndex * 4);
                    if (decl.replaceVertexColorRgb) {
                        color.r = decl.replaceVertexColorRgb[0] * 255;
                        color.g = decl.replaceVertexColorRgb[1] * 255;
                        color.b = decl.replaceVertexColorRgb[2] * 255;
                    }
                    vertexColors.push(color.r / 255, color.g / 255, color.b / 255, color.a / 255);
                }

                // copy triangle indices
                const stripIndices = makeTriangleIndexBuffer(GfxTopology.TriStrips, vertexOffset, vertexCount);
                for (let i = 0; i < stripIndices.length; i++) indices.push(stripIndices[i]);

                // insert degenerate before next strip
                const lastVertex = vertexOffset + vertexCount - 1;
                indices.push(lastVertex, lastVertex, lastVertex);
                vertexOffset += vertexCount;
            }

            this.geometries.push(new WaterGeometry(
                updateKit.renderHelper.renderCache,
                new Float32Array(positions),
                new Float32Array(texcoords),
                new Float32Array(vertexColors),
                new Uint16Array(indices)
            ));
        }
        return this.geometries;
    }

    drawAfterTies(updateKit: MobyUpdateKit) {
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
        if (!updateKit.fxTextures) return;

        const geometries = this.getOrCreateGeometries(updateKit);
        const transform = mat4.clone(noclipSpaceFromRatchetSpace);
        for (let i = 0; i < geometries.length; i++) {
            const geometry = geometries[i];
            const decl = this.decls[i];

            updateKit.renderers.water.renderWater(
                updateKit, geometry, [transform], updateKit.fxTextures[decl.textureId],
                { uvScroll: this.uvScrolls[i][0], zWobble: this.zWobble, randomSeed: this.mobyInstance.uid + i, uvRandomSeed: 0, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                { blendAlpha: 1, useTextureAlpha: !decl.ignoreTextureAlpha, useVertexColorAlpha: false },
                null,
                { depthWrite: decl.depthWrite ?? false, useAdditiveBlend: decl.additive ?? false, vertexColorTexture: null, vertexColorLayers: null },
            );

            if (decl.additiveSecondDraw) {
                updateKit.renderers.water.renderWater(
                    updateKit, geometry, [transform], updateKit.fxTextures[decl.textureId],
                    { uvScroll: this.uvScrolls[i][1], zWobble: this.zWobble, randomSeed: this.mobyInstance.uid + i, uvRandomSeed: 0, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                    { blendAlpha: 1, useTextureAlpha: !decl.ignoreTextureAlpha, useVertexColorAlpha: false },
                    null,
                    { depthWrite: decl.depthWrite ?? false, useAdditiveBlend: true, vertexColorTexture: null, vertexColorLayers: null },
                );
            }
        }
    }

    destroy(device: GfxDevice) {
        if (this.geometries) {
            for (let geometry of this.geometries) geometry.destroy(device);
        }
    }
}
