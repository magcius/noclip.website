import { mat4, vec2, vec3 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection, readWaterMesh_KindG } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyDrawKit, MobyImpl } from "./moby";
import { GfxDevice, GfxTexture } from "../../gfx/platform/GfxPlatform";
import { WaterGeometry } from "../render-water";
import { GfxTopology, makeTriangleIndexBuffer } from "../../gfx/helpers/TopologyHelpers";

interface WaterDecl_G {
    positionVaddr: number;
    texcoordsVaddr: number;
    vertexCount: number;
    scale: number;
}
export const RAC1_WATER_KIND_G = new Map<number, WaterDecl_G[]>([
    [1405, [
        { positionVaddr: 0x1da040, texcoordsVaddr: 0x1da7b8, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1da730, texcoordsVaddr: 0x1dac58, vertexCount: 11, scale: 1 },
    ]],
    [1406, [{ positionVaddr: 0x1dbe20, texcoordsVaddr: 0x1dc250, vertexCount: 89, scale: 1 }]],
    [1407, [{ positionVaddr: 0x1dcee0, texcoordsVaddr: 0x1dd100, vertexCount: 45, scale: 1 }]],
    [1408, [
        { positionVaddr: 0x1d9e40, texcoordsVaddr: 0x1dad98, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1da530, texcoordsVaddr: 0x1db238, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1dac20, texcoordsVaddr: 0x1db6d8, vertexCount: 31, scale: 1 },
    ]],
    [1409, [{ positionVaddr: 0x1ddba0, texcoordsVaddr: 0x1dded0, vertexCount: 68, scale: 1 }]],
    [1565, [{ positionVaddr: 0x1de860, texcoordsVaddr: 0x1dea88, vertexCount: 46, scale: 0.5 }]],
    [1567, [{ positionVaddr: 0x1df100, texcoordsVaddr: 0x1df520, vertexCount: 88, scale: 1 }]],
]);

const RAC1_WATER_KIND_G_UV_SCROLL = new Map<number, { pass1: [number, number]; pass2: [number, number] }>([
    [1405, { pass1: [0.1, -0.0628], pass2: [0.1, 0.0628] }],
    [1406, { pass1: [0.025, -0.0157], pass2: [0.025, 0.0157] }],
    [1407, { pass1: [0.025, -0.0157], pass2: [0.025, 0.0157] }],
    [1408, { pass1: [0.1, -0.0628], pass2: [0.1, 0.0628] }],
    [1409, { pass1: [0.025, -0.0157], pass2: [0.025, 0.0157] }],
    [1565, { pass1: [0.1, -0.0628], pass2: [0.1, 0.0628] }],
    [1567, { pass1: [0.1, -0.0628], pass2: [0.1, 0.0628] }],
]);

const TEXTURE_ID = 45;

/**
 * Adhoc model-space meshes, uses moby position and hardcoded scale
 * 
 * - Used on quartu and veldin orbit
 */
export class Water_G implements MobyImpl {
    overlaySections: OverlaySection[];

    decls: WaterDecl_G[];
    meshes: ReturnType<typeof readWaterMesh_KindG>[];
    geometries: WaterGeometry[] | null = null;
    private uvScroll1 = vec2.create();
    private uvScroll2 = vec2.create();
    private uvScrollVelocity1 = vec2.create();
    private uvScrollVelocity2 = vec2.create();
    private zWobble = vec2.fromValues(0.1, 2);

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        const decls = RAC1_WATER_KIND_G.get(mobyInstance.oClass);
        assert(decls !== undefined);
        this.decls = decls;

        const uvScroll = RAC1_WATER_KIND_G_UV_SCROLL.get(mobyInstance.oClass);
        assert(uvScroll !== undefined);
        vec2.set(this.uvScrollVelocity1, uvScroll.pass1[0], uvScroll.pass1[1]);
        vec2.set(this.uvScrollVelocity2, uvScroll.pass2[0], uvScroll.pass2[1]);

        this.meshes = [];
        for (let i = 0; i < this.decls.length; i++) {
            const waterMesh = readWaterMesh_KindG(resources.overlaySections, this.decls[i].positionVaddr, this.decls[i].texcoordsVaddr, this.decls[i].vertexCount, this.decls[i].scale);
            this.meshes.push(waterMesh);
        }
    }

    update(drawKit: MobyDrawKit) {
        this.mobyInstance._skipDraw = true;
        const dtSeconds = drawKit.dt / 1000;
        vec2.scaleAndAdd(this.uvScroll1, this.uvScroll1, this.uvScrollVelocity1, dtSeconds);
        vec2.scaleAndAdd(this.uvScroll2, this.uvScroll2, this.uvScrollVelocity2, dtSeconds);
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): WaterGeometry[] {
        if (this.geometries) return this.geometries;

        this.geometries = [];
        for (const mesh of this.meshes) {
            const indices = makeTriangleIndexBuffer(GfxTopology.TriStrips, 0, mesh.positions.length / 3);
            const vertexColors = new Float32Array(mesh.positions.length / 3 * 4).fill(0.5);
            this.geometries.push(new WaterGeometry(
                drawKit.renderHelper.renderCache,
                mesh.positions,
                mesh.texcoords,
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
        const base = vec3.fromValues(this.mobyInstance.position.x, this.mobyInstance.position.y, this.mobyInstance.position.z);
        for (let i = 0; i < this.meshes.length; i++) {
            const waterMesh = this.meshes[i];
            const zWobble = vec2.fromValues(this.zWobble[0], this.zWobble[1] * waterMesh.scale);
            const translation = mat4.fromTranslation(mat4.create(), base);
            mat4.scale(translation, translation, vec3.fromValues(waterMesh.scale, waterMesh.scale, waterMesh.scale));
            const transforms = [mat4.mul(mat4.create(), noclipSpaceFromRatchetSpace, translation)];
            const geometry = geometries[i];
            const randomSeed = this.mobyInstance.uid + i;

            drawKit.renderers.water.renderWater(
                drawKit.renderInstList,
                geometry,
                transforms,
                this.uvScroll1,
                zWobble,
                randomSeed,
                1,
                drawKit.fxTextures[TEXTURE_ID],
                drawKit.fxSampler,
                drawKit.instanceDataBuffer,
                false,
                false,
                undefined,
                null,
                null,
                null,
                true,
                true,
            );
            drawKit.renderers.water.renderWater(
                drawKit.renderInstList,
                geometry,
                transforms,
                this.uvScroll2,
                zWobble,
                randomSeed,
                1,
                drawKit.fxTextures[TEXTURE_ID],
                drawKit.fxSampler,
                drawKit.instanceDataBuffer,
                false,
                false,
                undefined,
                null,
                null,
                null,
                true,
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
