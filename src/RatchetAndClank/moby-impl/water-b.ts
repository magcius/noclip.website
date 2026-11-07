import { mat4, vec2 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { readWaterMeshes_KindB } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyUpdateKit, MobyImpl } from "./moby";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { WaterGeometry } from "../render-water";
import { GfxTopology, makeTriangleIndexBuffer } from "../../gfx/helpers/TopologyHelpers";

export interface WaterDecl_B {
    vaddr: number;
    count: number;
}
export const RAC1_WATER_KIND_B = new Map<number, WaterDecl_B>([
    [317, { vaddr: 0x1f3080, count: 108 }],
]);

/**
 * Adhoc worldspace meshes
 * 
 * - Gaspar flowing lava
 * 
 * TODO: this should use a texture passed in from Water_Gaspar
 */
export class Water_B implements MobyImpl {
    private decl: WaterDecl_B;
    private meshes: ReturnType<typeof readWaterMeshes_KindB>;
    private geometry: WaterGeometry | null = null;

    private uvScroll = vec2.create();
    private uvScrollVelocity = vec2.fromValues(0, -60 / 2048);

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);

        const decl = RAC1_WATER_KIND_B.get(mobyInstance.oClass);
        assert(decl !== undefined);
        this.decl = decl;

        this.meshes = readWaterMeshes_KindB(resources.overlaySections, this.decl.vaddr, this.decl.count);
    }

    update(updateKit: MobyUpdateKit) {
        vec2.scaleAndAdd(this.uvScroll, this.uvScroll, this.uvScrollVelocity, updateKit.dt / 1000);
    }

    private getOrCreateGeometry(updateKit: MobyUpdateKit): WaterGeometry {
        if (this.geometry) return this.geometry;

        const totalVertexCount = this.meshes.reduce((sum, mesh) => sum + mesh.vertexCount, 0);
        const positions = new Float32Array(totalVertexCount * 3);
        const texcoords = new Float32Array(totalVertexCount * 2);
        const indices: number[] = [];
        let vertexOffset = 0;

        for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex++) {
            const waterMesh = this.meshes[meshIndex];
            for (let vertexIndex = 0; vertexIndex < waterMesh.vertexCount; vertexIndex++) {
                const position = waterMesh.positions.getFloat32_Xyz(vertexIndex * 3 * 4);
                const texcoord = waterMesh.texcoords.getFloat32_Xy(vertexIndex * 2 * 4);
                const outputVertex = vertexOffset + vertexIndex;
                positions[outputVertex * 3 + 0] = position.x;
                positions[outputVertex * 3 + 1] = position.y;
                positions[outputVertex * 3 + 2] = position.z;
                texcoords[outputVertex * 2 + 0] = texcoord.x;
                texcoords[outputVertex * 2 + 1] = texcoord.y;
            }

            for (let stripIndex = 0; stripIndex < waterMesh.descriptor.stripCount; stripIndex++) {
                const stripStart = waterMesh.descriptor.stripStarts[stripIndex];
                const stripEnd = waterMesh.descriptor.stripStarts[stripIndex + 1];
                const stripIndices = makeTriangleIndexBuffer(GfxTopology.TriStrips, vertexOffset + stripStart, stripEnd - stripStart);
                for (let i = 0; i < stripIndices.length; i++) indices.push(stripIndices[i]);
            }

            // add degenerate
            indices.push(vertexOffset + waterMesh.vertexCount - 1, vertexOffset + waterMesh.vertexCount - 1, vertexOffset + waterMesh.vertexCount - 1);

            vertexOffset += waterMesh.vertexCount;
        }

        this.geometry = new WaterGeometry(
            updateKit.renderHelper.renderCache,
            positions,
            texcoords,
            null,
            new Uint16Array(indices)
        );
        return this.geometry;
    }

    drawAfterTies(updateKit: MobyUpdateKit) {
        if (!updateKit.fxTextures) return;

        const FIRST_TEXTURE_ID = 44;
        const animationFrame = 0; // TODO: texture should be passed in from gaspar water moby
        const textureId1 = FIRST_TEXTURE_ID + animationFrame;

        const geometry = this.getOrCreateGeometry(updateKit);
        const transform = mat4.clone(noclipSpaceFromRatchetSpace);
        updateKit.renderers.water.renderWater(
            updateKit, geometry, [transform], updateKit.fxTextures[textureId1],
            { uvScroll: this.uvScroll, zWobble: vec2.create(), randomSeed: 0, uvRandomSeed: 0, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
            { blendAlpha: 1, useTextureAlpha: false, useVertexColorAlpha: false },
            null,
            { depthWrite: true, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
        );
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
    }

    destroy(device: GfxDevice) {
        if (!this.geometry) return;
        this.geometry.destroy(device);
        this.geometry = null;
    }
}
