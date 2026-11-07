import { mat4, vec2, vec3 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection, readWaterGrid_KindE } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace } from "../utils";
import { MobyDrawKit, MobyImpl, ownPvars } from "./moby";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { WaterGeometry } from "../render-water";

// patch water on many levels
// keyed by level number not moby class - each moby selects which patch to control based on pvars - the one controlling the first patch draws all of them
interface WaterDecl_E {
    dataVaddr: number;
    masksVaddr: number | null;
    maskSize: number;
    count: number;
}
export const RAC1_WATER_KIND_E = new Map<number, WaterDecl_E>([
    [1, { dataVaddr: 0x1e34c0, masksVaddr: 0x1fa590, maskSize: 4, count: 21 }],
    [5, { dataVaddr: 0x1d6880, masksVaddr: 0x20b380, maskSize: 2, count: 48 }],
    [7, { dataVaddr: 0x1dce40, masksVaddr: 0x204680, maskSize: 2, count: 36 }],
    [11, { dataVaddr: 0x1da880, masksVaddr: null, maskSize: 2, count: 20 }],
    [12, { dataVaddr: 0x1cbf40, masksVaddr: null, maskSize: 2, count: 17 }],
    [13, { dataVaddr: 0x1d9bc0, masksVaddr: 0x1f1e20, maskSize: 2, count: 22 }],
]);

/**
 * Patch water, a 4x4 grid of 4x4 subblocks. Each subblock can be toggled.
 * Each moby "owns" one grid, and can move it around. It decides which grid it owns based on its pvars.
 * 
 * Used on many levels
 * - All hydrodisplacer water (except veldin finale which is a special snowflake)
 * - Some novalis water
 * - Rilgar rising water
 * - Oltanis orbit water that moves up and down
 */
export class Water_E implements MobyImpl {
    overlaySections: OverlaySection[];

    grids: ReturnType<typeof readWaterGrid_KindE>[] = [];
    geometry: WaterGeometry | null = null;

    // the water patch being controlled by this
    // null means "draw all but don't touch position"
    controlTargetPatch: number | null = null;

    uvScrolls: vec2[] = [];
    zWobble = vec2.fromValues(0.05, 40);
    waterTextureOverride: number | null = null;
    envTextureOverride: number | null = null;
    waterFixOverride: number | null = null;
    envFixOverride: number | null = null;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        const pv = ownPvars(mobyInstance, resources);

        switch (mobyInstance.oClass) {
            case 751:
                // novalis
                // controls all patches
                break;
            case 831:
                // rilgar
                this.controlTargetPatch = pv.getInt32(0x14);
                break;
            case 902: case 941: case 943: case 944:
            case 948: case 949: case 950: case 951:
            case 952: case 953: case 954: case 955:
            case 958: case 961: case 962: case 967:
            case 968: case 969: case 970: case 971:
                // umbris
                this.controlTargetPatch = pv.getInt32(0x14);
                break;
            case 1158:
            case 19:
                // pokitaru and hoven
                if (resources.mobyImplShared!.waterPatchInitCounter === undefined)
                    resources.mobyImplShared!.waterPatchInitCounter = 0;
                this.controlTargetPatch = resources.mobyImplShared!.waterPatchInitCounter;
                resources.mobyImplShared!.waterPatchInitCounter += 1;
                break;
            case 1263: case 1393:
                // oltanis orbit
                this.controlTargetPatch = pv.getInt32(0x10);
                break;
        }

        switch (this.mobyInstance.oClass) {
            case 1158:
                // pokitaru
                this.waterTextureOverride = 0x39;
                this.envTextureOverride = 0x38;
                this.waterFixOverride = 0x44;
                this.envFixOverride = 0x1c;
                break;
            case 19:
                // hoven
                this.waterTextureOverride = 43;
                this.envTextureOverride = 42;
                this.waterFixOverride = 0x44;
                this.envFixOverride = 0x1c;
                break;
        }

        const waterDecl_E = RAC1_WATER_KIND_E.get(resources.levelNumber); // level number not class number
        assert(waterDecl_E !== undefined);

        if (this.controlTargetPatch === null) {
            for (let i = 0; i < waterDecl_E.count; i++) {
                const waterGrid = readWaterGrid_KindE(
                    this.overlaySections, waterDecl_E.dataVaddr, waterDecl_E.masksVaddr, waterDecl_E.maskSize, i
                );
                this.grids.push(waterGrid);
            }
        } else {
            const waterGrid = readWaterGrid_KindE(
                this.overlaySections, waterDecl_E.dataVaddr, waterDecl_E.masksVaddr, waterDecl_E.maskSize, this.controlTargetPatch
            );
            this.grids.push(waterGrid);
        }

        this.uvScrolls = this.grids.map(() => vec2.create());
    }

    update(drawKit: MobyDrawKit) {
        const dtSeconds = drawKit.dt / 1000;
        for (let i = 0; i < this.grids.length; i++) {
            const waterGrid = this.grids[i];
            const descriptor = waterGrid.descriptor;
            if (this.controlTargetPatch !== null)
                descriptor.center = this.mobyInstance.position;

            const uvScroll = this.uvScrolls[i];
            const directionLength = Math.hypot(descriptor.uvScroll.x, descriptor.uvScroll.y);
            const speed = Math.hypot(descriptor.uvSpeed.x, descriptor.uvSpeed.y);
            if (directionLength > 0) {
                uvScroll[0] += descriptor.uvScroll.x / directionLength * speed * dtSeconds;
                uvScroll[1] += descriptor.uvScroll.y / directionLength * speed * dtSeconds;
            }
        }
    }

    private getOrCreateGeometry(drawKit: MobyDrawKit): WaterGeometry {
        if (this.geometry) return this.geometry;

        const positions = new Float32Array(5 * 5 * 3);
        const texcoords = new Float32Array(5 * 5 * 2);
        for (let y = 0; y <= 4; y++) {
            for (let x = 0; x <= 4; x++) {
                const vertexIndex = y * 5 + x;
                positions[vertexIndex * 3 + 0] = x;
                positions[vertexIndex * 3 + 1] = y;
                texcoords[vertexIndex * 2 + 0] = x / 4;
                texcoords[vertexIndex * 2 + 1] = y / 4;
            }
        }

        const indices = new Uint16Array(4 * 4 * 6);
        let index = 0;
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const topLeft = y * 5 + x;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + 5;
                const bottomRight = bottomLeft + 1;
                indices[index++] = topLeft;
                indices[index++] = topRight;
                indices[index++] = bottomLeft;
                indices[index++] = topRight;
                indices[index++] = bottomRight;
                indices[index++] = bottomLeft;
            }
        }

        this.geometry = new WaterGeometry(drawKit.renderHelper.renderCache, positions, texcoords, null, indices);
        return this.geometry;
    }

    drawAfterTies(drawKit: MobyDrawKit) {
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
        if (!drawKit.fxTextures) return;

        const geometry = this.getOrCreateGeometry(drawKit);
        for (let gridIndex = 0; gridIndex < this.grids.length; gridIndex++) {
            const waterGrid = this.grids[gridIndex];
            const basePosition = waterGrid.descriptor.center;
            const transforms: mat4[] = [];

            for (let sy = 0; sy < 4; sy++) {
                for (let sx = 0; sx < 4; sx++) {
                    const patchIndex = (sy << 2) | sx;
                    if ((waterGrid.descriptor.activeMask & (1 << patchIndex)) === 0) continue;

                    const translation = mat4.fromTranslation(mat4.create(), vec3.fromValues(
                        basePosition.x - 8 + sx * 4,
                        basePosition.y - 8 + sy * 4,
                        basePosition.z
                    ));
                    transforms.push(mat4.mul(mat4.create(), noclipSpaceFromRatchetSpace, translation));
                }
            }

            if (transforms.length === 0) continue;
            drawKit.renderers.water.renderWater(
                drawKit, geometry, transforms, drawKit.fxTextures[this.waterTextureOverride ?? waterGrid.descriptor.fxWater],
                { uvScroll: this.uvScrolls[gridIndex], zWobble: this.zWobble, randomSeed: 0, uvRandomSeed: 0, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
                { blendAlpha: (this.waterFixOverride ?? waterGrid.descriptor.fixWater) / 0x80, useTextureAlpha: false, useVertexColorAlpha: false },
                null,
                { depthWrite: false, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
            );
        }
    }

    destroy(device: GfxDevice) {
        if (!this.geometry) return;
        this.geometry.destroy(device);
        this.geometry = null;
    }
}
