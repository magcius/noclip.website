import { mat4, vec2 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { readWaterMesh_KindA, SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A, WaterMesh_KindA } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyUpdateKit, MobyImpl } from "./moby";
import { WaterGeometry } from "../render-water";
import { GfxTopology, makeTriangleIndexBuffer } from "../../gfx/helpers/TopologyHelpers";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";

export interface WaterDecl_A {
    vaddr: number;
    count: number;
}
export const RAC1_WATER_KIND_A = new Map<number, WaterDecl_A>([
    [676, { vaddr: 0x1e2fc0, count: 8 }],
    [678, { vaddr: 0x1e3380, count: 2 }],
    [761, { vaddr: 0x1fbc80, count: 4 }],
    [1225, { vaddr: 0x202d80, count: 3 }]
]);

/**
 * Adhoc worldspace meshes
 * 
 * - Novalis flowing water
 */
export class Water_A implements MobyImpl {
    private decl: WaterDecl_A;
    private meshes: WaterMesh_KindA[];
    private geometries: WaterGeometry[] | null = null;

    private zOffset = 0;
    private zWobbleAmplitude = 0;
    private zWobblePeriod = 0;

    private scroll1 = vec2.create();
    private scroll2 = vec2.create();

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);

        const decl = RAC1_WATER_KIND_A.get(mobyInstance.oClass);
        assert(decl !== undefined);
        this.decl = decl;

        this.meshes = [];
        for (let i = 0; i < this.decl.count; i++) {
            const waterMesh = readWaterMesh_KindA(resources.overlaySections, this.decl.vaddr + i * SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A);
            this.meshes.push(waterMesh);
        }

        switch (mobyInstance.oClass) {
            case 761:
                this.zOffset = -0.45;
                this.zWobbleAmplitude = 0.05;
                this.zWobblePeriod = 40;
                break;
            case 1225:
                this.zWobbleAmplitude = 0.05;
                this.zWobblePeriod = 40;
                break;
        }
    }

    update(updateKit: MobyUpdateKit) {
        for (let i = 0; i < this.meshes.length; i++) {
            const waterMesh = this.meshes[i];
            const multiplier = 120; // not sure about units
            vec2.scaleAndAdd(this.scroll1, this.scroll1, vec2.fromValues(waterMesh.descriptor.direction1.x, waterMesh.descriptor.direction1.y), waterMesh.descriptor.scrollSpeed1 * (updateKit.dt / multiplier));
            vec2.scaleAndAdd(this.scroll2, this.scroll2, vec2.fromValues(waterMesh.descriptor.direction2.x, waterMesh.descriptor.direction2.y), waterMesh.descriptor.scrollSpeed2 * (updateKit.dt / multiplier));
        }
    }

    private getOrCreateGeometries(updateKit: MobyUpdateKit): WaterGeometry[] {
        if (this.geometries) return this.geometries;

        this.geometries = [];
        for (let i = 0; i < this.meshes.length; i++) {
            const waterMesh = this.meshes[i];
            const vertexCount = waterMesh.descriptor.vertexCount;
            const positionsWithPadding = waterMesh.positions;
            const positions = new Float32Array(vertexCount * 3);
            for (let j = 0; j < vertexCount; j++) {
                positions[j * 3 + 0] = positionsWithPadding[j * 4 + 0];
                positions[j * 3 + 1] = positionsWithPadding[j * 4 + 1];
                positions[j * 3 + 2] = positionsWithPadding[j * 4 + 2];
            }
            const texcoords = waterMesh.texcoords;
            const vertexColors = new Float32Array(vertexCount * 4);
            for (let j = 0; j < vertexCount; j++) {
                vertexColors[j * 4 + 0] = waterMesh.descriptor.rgba.r / 0x80;
                vertexColors[j * 4 + 1] = waterMesh.descriptor.rgba.g / 0x80;
                vertexColors[j * 4 + 2] = waterMesh.descriptor.rgba.b / 0x80;
                vertexColors[j * 4 + 3] = 1;
            }
            const indices = makeTriangleIndexBuffer(GfxTopology.TriStrips, 0, vertexCount);
            this.geometries.push(new WaterGeometry(updateKit.renderHelper.renderCache, positions, texcoords, vertexColors, indices));
        }
        return this.geometries;
    }

    drawAfterTies(updateKit: MobyUpdateKit) {
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
        if (!updateKit.fxTextures) return;

        const geometries = this.getOrCreateGeometries(updateKit);
        const m = mat4.clone(noclipSpaceFromRatchetSpace);
        mat4.translate(m, m, [0, 0, this.zOffset]);
        for (let i = 0; i < geometries.length; i++) {
            const geometry = geometries[i];
            const descriptor = this.meshes[i].descriptor;

            const zWobble = vec2.fromValues(this.zWobbleAmplitude, this.zWobblePeriod);

            const seed1 = this.mobyInstance.uid + i;
            const seed2 = this.mobyInstance.uid + i + 1.234;

            updateKit.renderers.water.renderWater(
                updateKit, geometry, [m], updateKit.fxTextures[descriptor.fxTexture1],
                { uvScroll: this.scroll1, zWobble, randomSeed: seed1, uvRandomSeed: seed1, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                { blendAlpha: descriptor.fix1 / 0x80, useTextureAlpha: false, useVertexColorAlpha: false },
                null,
                { depthWrite: false, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
            );

            updateKit.renderers.water.renderWater(
                updateKit, geometry, [m], updateKit.fxTextures[descriptor.fxTexture2],
                { uvScroll: this.scroll2, zWobble, randomSeed: seed1, uvRandomSeed: seed2, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                { blendAlpha: descriptor.fix2 / 0x80, useTextureAlpha: false, useVertexColorAlpha: false },
                null,
                { depthWrite: false, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
            );
        }
    }

    destroy(device: GfxDevice) {
        if (this.geometries) {
            for (let geometry of this.geometries) geometry.destroy(device);
        }
    }
}
