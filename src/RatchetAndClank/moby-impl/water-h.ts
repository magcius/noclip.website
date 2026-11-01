import { mat4, vec2 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection, readWaterMesh_KindH, WaterMesh_KindH } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyDrawKit, MobyImpl } from "./moby";
import { GfxDevice, GfxTexture } from "../../gfx/platform/GfxPlatform";
import { WaterGeometry } from "../render-water";

interface WaterDecl_H {
    quadCount: number;
    positionsVaddr: number;
    quadIndicesVaddr: number;
    texcoordsVaddr: number;
    positionScale: number;
    textureId: number;
    uvScroll: boolean;
    alpha: number;
    color: number;
}
export const RAC1_WATER_KIND_H = new Map<number, WaterDecl_H[]>([
    [1402, [
        { quadCount: 22, positionsVaddr: 0x1db030, texcoordsVaddr: 0x1db3a0, quadIndicesVaddr: 0x1db240, positionScale: 1, textureId: 43, uvScroll: false, alpha: 0x50, color: 0x50 },
        { quadCount: 25, positionsVaddr: 0x1da3c0, texcoordsVaddr: 0x1da7a0, quadIndicesVaddr: 0x1da610, positionScale: 1, textureId: 43, uvScroll: true, alpha: 0x50, color: 0x50 },
        { quadCount: 38, positionsVaddr: 0x1da8d0, texcoordsVaddr: 0x1dae80, quadIndicesVaddr: 0x1dac20, positionScale: 1, textureId: 43, uvScroll: false, alpha: 0x50, color: 0x50 },
    ]],
    [1062, [
        { quadCount: 58, positionsVaddr: 0x1eed30, texcoordsVaddr: 0x1ef6b0, quadIndicesVaddr: 0x1ef310, positionScale: 0.01, textureId: 0x2a, uvScroll: false, alpha: 0x20, color: 0x50 },
        { quadCount: 50, positionsVaddr: 0x1f0900, texcoordsVaddr: 0x1f1540, quadIndicesVaddr: 0x1f1220, positionScale: 1, textureId: 0x2a, uvScroll: false, alpha: 0x20, color: 0x50 },
        { quadCount: 864, positionsVaddr: 0x1dbff0, texcoordsVaddr: 0x1e2cf0, quadIndicesVaddr: 0x1df6f0, positionScale: 0.01, textureId: 0x2a, uvScroll: false, alpha: 0x20, color: 0x50 },
    ]],
    [1083, [
        { quadCount: 96, positionsVaddr: 0x1fb5f0, texcoordsVaddr: 0x1fc2f0, quadIndicesVaddr: 0x1fbcf0, positionScale: 0.01, textureId: 0x15, uvScroll: false, alpha: 0x20, color: 0x20 },
        { quadCount: 96, positionsVaddr: 0x1f77b0, texcoordsVaddr: 0x1f84b0, quadIndicesVaddr: 0x1f7eb0, positionScale: 0.01, textureId: 0x15, uvScroll: false, alpha: 0x20, color: 0x20 },
        // these are "damaged" versions of above
        // { quadCount: 64, positionsVaddr: 0x1f5330, texcoordsVaddr: 0x1f5d30, quadIndicesVaddr: 0x1f5930, positionScale: 0.01, textureId: 0x15, uvScroll: false, alpha: 0x20 },
        // { quadCount: 64, positionsVaddr: 0x1f2eb0, texcoordsVaddr: 0x1f38b0, quadIndicesVaddr: 0x1f34b0, positionScale: 0.01, textureId: 0x15, uvScroll: false, alpha: 0x20 },
    ]]
]);

const ZERO_VEC2 = vec2.create();
const SECOND_MESH_UV_SCROLL_VELOCITY = vec2.fromValues(0.05, 0.05);

/**
 * Adhoc worldspace quad meshes.
 * This one has a particularly bonkers layout.
 * It has two interleaved index buffers (one for positions, one for texcoords).
 * 
 * - Used for glass on nebula g34
 * - Used for hydrodisplacer water on veldin finale
 */
export class Water_H implements MobyImpl {
    overlaySections: OverlaySection[];

    decls: WaterDecl_H[];
    meshes: WaterMesh_KindH[] = [];
    geometries: WaterGeometry[] | null = null;
    private secondMeshUVScroll = vec2.create();

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        const decls = RAC1_WATER_KIND_H.get(mobyInstance.oClass);
        assert(decls !== undefined);
        this.decls = decls;

        for (let i = 0; i < decls.length; i++) {
            const decl = decls[i];
            this.meshes.push(readWaterMesh_KindH(
                this.overlaySections,
                decl.positionsVaddr,
                decl.quadIndicesVaddr,
                decl.texcoordsVaddr,
                decl.quadCount,
            ));
        }
    }

    update(drawKit: MobyDrawKit) {
        this.mobyInstance._skipDraw = true;
        vec2.scaleAndAdd(this.secondMeshUVScroll, this.secondMeshUVScroll, SECOND_MESH_UV_SCROLL_VELOCITY, drawKit.dt / 1000);
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): WaterGeometry[] {
        if (this.geometries) return this.geometries;

        this.geometries = [];
        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            const decl = this.decls[i];
            const positionScale = decl.positionScale;
            const positions = new Float32Array(mesh.positions.length * 3);
            const texcoords = new Float32Array(mesh.texcoords.length * 2);
            const vertexColors = new Float32Array(mesh.positions.length * 4);
            for (let i = 0; i < mesh.positions.length; i++) {
                positions[i * 3 + 0] = mesh.positions[i].x * positionScale;
                positions[i * 3 + 1] = mesh.positions[i].y * positionScale;
                positions[i * 3 + 2] = mesh.positions[i].z * positionScale;
                texcoords[i * 2 + 0] = mesh.texcoords[i].x;
                texcoords[i * 2 + 1] = mesh.texcoords[i].y;
                vertexColors[i * 4 + 0] = decl.color / 0x80;
                vertexColors[i * 4 + 1] = decl.color / 0x80;
                vertexColors[i * 4 + 2] = decl.color / 0x80;
                vertexColors[i * 4 + 3] = decl.alpha / 0x80;
            }

            // quad order is 012 132 not the usual 012 123
            const indices = new Uint16Array(mesh.quadCount * 6);
            for (let quadIndex = 0; quadIndex < mesh.quadCount; quadIndex++) {
                const vertexIndex = quadIndex * 4;
                const indexOffset = quadIndex * 6;
                indices[indexOffset + 0] = vertexIndex + 0;
                indices[indexOffset + 1] = vertexIndex + 1;
                indices[indexOffset + 2] = vertexIndex + 2;
                indices[indexOffset + 3] = vertexIndex + 1;
                indices[indexOffset + 4] = vertexIndex + 3;
                indices[indexOffset + 5] = vertexIndex + 2;
            }

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
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
        if (!drawKit.fxTextures) return;

        const geometries = this.getOrCreateGeometries(drawKit);
        const transform = mat4.clone(noclipSpaceFromRatchetSpace);
        for (let meshIndex = 0; meshIndex < geometries.length; meshIndex++) {
            const decl = this.decls[meshIndex];
            const uvScroll = decl.uvScroll ? this.secondMeshUVScroll : ZERO_VEC2;
            drawKit.renderers.water.renderWater(
                drawKit.renderInstList,
                geometries[meshIndex],
                [transform],
                uvScroll,
                ZERO_VEC2,
                this.mobyInstance.uid + meshIndex,
                1,
                drawKit.fxTextures[decl.textureId],
                drawKit.fxSampler,
                drawKit.instanceDataBuffer,
                false,
                false,
                undefined,
                null,
                null,
                null,
                true,
            );
        }
    }

    destroy(device: GfxDevice) {
        if (!this.geometries) return;
        for (const geometry of this.geometries) geometry.destroy(device);
        this.geometries = null;
    }
}
