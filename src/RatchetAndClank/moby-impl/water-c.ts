import { mat4, vec2 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection, readWaterMeshes_KindC } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyDrawKit, MobyImpl } from "./moby";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { WaterFogParams, WaterGeometry } from "../render-water";
import { GfxTopology, makeTriangleIndexBuffer } from "../../gfx/helpers/TopologyHelpers";

const ZERO_VEC2 = vec2.create();

type WaterDecl_C = {
    vaddr: number;
    count: number;
    textureId: number,
    envTextureId: number,
    hasNormals: boolean,
    color: [number, number, number] | null,
    uvScale?: number,
    fogParams?: WaterFogParams,
};
export const RAC1_WATER_KIND_C = new Map<number, WaterDecl_C>([
    [317, { vaddr: 0x1f63c0, textureId: 44, envTextureId: 44, count: 10, hasNormals: false, color: [0x8e, 0x7c, 0x75], uvScale: 0.5, fogParams: { color: { r: 200, g: 100, b: 20 }, far: 260080, farIntensity: 0, near: 10000, nearIntensity: 255 } }],
    [293, { vaddr: 0x1f5480, textureId: 0x2c, envTextureId: 0x2d, count: 47, hasNormals: true, color: null }],
    [1418, { vaddr: 0x1f5f80, textureId: 0x2e, envTextureId: 0x2f, count: 19, hasNormals: true, color: null }],
]);

/**
 * Adhoc worldspace meshes
 * 
 * - Used for part of the lava on gaspar (the cutout part, the rest is kind F)
 * - Used for ice on hoven and oltanis
 */
export class Water_C implements MobyImpl {
    overlaySections: OverlaySection[];

    decl: WaterDecl_C;
    meshes: ReturnType<typeof readWaterMeshes_KindC>;
    geometries: WaterGeometry[] | null = null;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        const decl = RAC1_WATER_KIND_C.get(mobyInstance.oClass);
        assert(decl !== undefined);
        this.decl = decl;

        this.meshes = readWaterMeshes_KindC(resources.overlaySections, this.decl.vaddr, this.decl.count, this.decl.hasNormals);
    }

    update(drawKit: MobyDrawKit) {
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): WaterGeometry[] {
        if (this.geometries) return this.geometries;

        this.geometries = [];
        for (const waterMesh of this.meshes) {
            const vertexCount = waterMesh.descriptor.vertexCount;
            const positions = new Float32Array(vertexCount * 3);
            const texcoords = new Float32Array(vertexCount * 2);
            const color = this.decl.color;
            const uvScale = this.decl.uvScale ?? 1;
            const vertexColors = color !== null ? new Float32Array(vertexCount * 4) : null;

            for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
                const position = waterMesh.positions.getFloat32_Xyz(vertexIndex * 3 * 4);
                const texcoord = waterMesh.texcoords.getFloat32_Xy(vertexIndex * 2 * 4);
                positions[vertexIndex * 3 + 0] = position.x;
                positions[vertexIndex * 3 + 1] = position.y;
                positions[vertexIndex * 3 + 2] = position.z;
                texcoords[vertexIndex * 2 + 0] = texcoord.x * uvScale;
                texcoords[vertexIndex * 2 + 1] = texcoord.y * uvScale;
                if (color !== null && vertexColors !== null) {
                    vertexColors[vertexIndex * 4 + 0] = color[0] / 255;
                    vertexColors[vertexIndex * 4 + 1] = color[1] / 255;
                    vertexColors[vertexIndex * 4 + 2] = color[2] / 255;
                    vertexColors[vertexIndex * 4 + 3] = 1;
                }
            }

            const indices = makeTriangleIndexBuffer(GfxTopology.TriStrips, 0, vertexCount);
            this.geometries.push(new WaterGeometry(
                drawKit.renderHelper.renderCache,
                positions,
                texcoords,
                vertexColors,
                indices,
            ));
        }

        return this.geometries;
    }

    drawAfterTies(drawKit: MobyDrawKit) {
        if (!drawKit.fxTextures) return;

        const geometries = this.getOrCreateGeometries(drawKit);
        const transform = mat4.clone(noclipSpaceFromRatchetSpace);
        for (let i = 0; i < geometries.length; i++) {
            drawKit.renderers.water.renderWater(
                drawKit, geometries[i], [transform], drawKit.fxTextures[this.decl.textureId],
                { uvScroll: ZERO_VEC2, zWobble: ZERO_VEC2, randomSeed: 0, uvRandomSeed: 0, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                { blendAlpha: 1, useTextureAlpha: false, useVertexColorAlpha: false },
                this.decl.fogParams ?? null,
                { depthWrite: true, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
            );
        }
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
    }

    destroy(device: GfxDevice) {
        if (!this.geometries) return;
        for (const geometry of this.geometries) geometry.destroy(device);
        this.geometries = null;
    }
}
