import { mat4, vec2, vec3 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection, readOverlayVMem, readWaterGrid_KindF } from "../bin-overlay";
import { LevelResources } from "../loader";
import { noclipSpaceFromRatchetSpace, ratchetSpaceFromNoclipSpace } from "../utils";
import { cuboidContainsPoint, MobyDrawKit, MobyImpl, ownPvars } from "./moby";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../../gfx/platform/GfxPlatform";
import { WaterGeometry } from "../render-water";
import { VifUnpackFormat } from "../../Common/PS2/VIF";
import { readVifCommandList, VifUnpackReader } from "../vif";
import { White } from "../../Color";

const ZERO_VEC2 = vec2.create();

interface WaterDecl_F {
    vaddrs: number[];
}
export const RAC1_WATER_KIND_F = new Map<number, WaterDecl_F>([
    [317, { vaddrs: [0x1fc740] }],
    [327, { vaddrs: [0x1d7060] }],
    [460, { vaddrs: [0x1d3400] }],
    [854, { vaddrs: [0x1f3c00, 0x1f3cd0, 0x1f3d30, 0x1f3d90, 0x1f3dd0, 0x1f3e10, 0x1f3c60] }],
    [879, { vaddrs: [0x211b20] }],
    [994, { vaddrs: [0x1dc1a0] }],
    [1018, { vaddrs: [0x208560] }],
    [1260, { vaddrs: [0x1e9c60] }],
]);

// overlay addresses for hardcoded UVs (index buffers are there too)
const RAC1_WATER_KIND_F_UV_VADDRS = new Map<number, number>([
    [2, 0x1cb500],
    [3, 0x1cb000],
    [5, 0x1cb380],
    [7, 0x1caf80],
    [8, 0x1cb700],
    [9, 0x1cb080],
    [14, 0x1cb600],
]);

/**
 * A finite plane, made up of 7x7 patches.
 * Some oceans are hidden if the camera is in certain regions.
 * Can be moved by mobys.
 * 
 * - Used for all oceans except hoven
 * - Used for all mud on aridia
 * - Used for lava on umbris
 */
export class Water_F implements MobyImpl {
    overlaySections: OverlaySection[];

    decls: WaterDecl_F;
    grids: ReturnType<typeof readWaterGrid_KindF>[] = [];
    geometry: WaterGeometry | null = null;

    colorTextureData: Uint8Array[] = [];
    colorTextures: GfxTexture[] | null = null;
    vertexTexcoords: Float32Array;

    lateRender = false; // the phase in which the ocean renders can vary

    alpha = 1;
    bobAmplitude = 0;
    bobFrequency = 0;
    noRenderInCuboidIndexes: number[] = []; // if camera is in one of these cuboids, skip render

    private elapsedTime = 0;


    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        const decls = RAC1_WATER_KIND_F.get(mobyInstance.oClass);
        assert(decls !== undefined);
        this.decls = decls;

        const uvVaddr = RAC1_WATER_KIND_F_UV_VADDRS.get(resources.levelNumber);
        assert(uvVaddr !== undefined);

        const pv = ownPvars(mobyInstance, resources);
        let uvScale = 1;

        switch (mobyInstance.oClass) {
            case 327: {
                this.lateRender = true;
                break;
            }
            case 854: {
                uvScale = 1 / 6;
                break;
            }
            case 879: {
                this.noRenderInCuboidIndexes = pv.getArrayOfNumbers(0, 8, Int32Array);
                this.bobAmplitude = 1 / 4;
                this.bobFrequency = 1 / 6;
                break;
            }
            case 994: {
                this.alpha = 0x20 / 0x80; // lmao you can barely see this
                this.lateRender = true;
                break;
            }
            case 1018: {
                this.noRenderInCuboidIndexes = pv.getArrayOfNumbers(0, 1, Int32Array);
                break;
            }
            case 1260: {
                this.alpha = 0x40 / 0x80;
                break;
            }
            case 1260: {
                this.lateRender = true;
                break;
            }
        }

        this.vertexTexcoords = untangleStripOrderedTexcoords(this.overlaySections, uvVaddr, uvScale);

        for (let i = 0; i < this.decls.vaddrs.length; i++) {
            const waterGrid = readWaterGrid_KindF(this.overlaySections, this.decls.vaddrs[i]);
            this.grids.push(waterGrid);

            const blockCountX = waterGrid.descriptor.cellsX / 7;
            const blockCountY = waterGrid.descriptor.cellsY / 7;
            const blockCount = blockCountX * blockCountY;
            const colors = new Uint8Array(blockCount * 8 * 8 * 4);
            for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
                const colorVaddr = waterGrid.descriptor.colorsVaddr + blockIndex * SIZEOF_COLOR_BLOCK;
                untangleStripOrderedColors(this.overlaySections, colorVaddr, colors, blockIndex * 8 * 8 * 4);
            }
            this.colorTextureData.push(colors);
        }
    }

    update(drawKit: MobyDrawKit) {
        if (this.mobyInstance.oClass === 879)
            this.elapsedTime += drawKit.dt / 1000;
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): WaterGeometry {
        if (this.geometry) return this.geometry;

        const colorLutPositions = new Float32Array(8 * 8 * 2);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const vertexIndex = y * 8 + x;
                colorLutPositions[vertexIndex * 2 + 0] = (x + 0.5) / 8;
                colorLutPositions[vertexIndex * 2 + 1] = (y + 0.5) / 8;
            }
        }

        const positions = new Float32Array(8 * 8 * 3);
        for (let y = 0; y <= 7; y++) {
            for (let x = 0; x <= 7; x++) {
                const vertexIndex = y * 8 + x;
                positions[vertexIndex * 3 + 0] = x;
                positions[vertexIndex * 3 + 1] = y;
            }
        }

        const indices = new Uint16Array(7 * 7 * 6);
        let index = 0;
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 7; x++) {
                const topLeft = y * 8 + x;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + 8;
                const bottomRight = bottomLeft + 1;
                indices[index++] = topLeft;
                indices[index++] = topRight;
                indices[index++] = bottomLeft;
                indices[index++] = topRight;
                indices[index++] = bottomRight;
                indices[index++] = bottomLeft;
            }
        }

        this.geometry = new WaterGeometry(
            drawKit.renderHelper.renderCache,
            positions,
            this.vertexTexcoords,
            null,
            indices,
            colorLutPositions,
        );

        return this.geometry;
    }

    private draw(drawKit: MobyDrawKit) {
        if (!drawKit.fxTextures) return;

        for (let i = 0; i < this.noRenderInCuboidIndexes.length; i++) {
            // skip rendering if the camera is inside this cuboid
            const cuboidIndex = this.noRenderInCuboidIndexes[i];
            if (cuboidIndex === -1) continue;
            const cameraPositionRatchetSpace = vec3.transformMat4(vec3.create(), drawKit.cameraPosition, ratchetSpaceFromNoclipSpace);
            if (cuboidContainsPoint(cameraPositionRatchetSpace, this.resources, cuboidIndex)) return;
        }

        const colorTextures = this.getOrCreateColorTextures(drawKit.renderHelper.device);
        const geometry = this.getOrCreateGeometries(drawKit);

        for (let gridIndex = 0; gridIndex < this.grids.length; gridIndex++) {
            const waterGrid = this.grids[gridIndex];
            const descriptor = waterGrid.descriptor;
            assert(waterGrid.descriptor.cellsX % 7 == 0);
            assert(waterGrid.descriptor.cellsY % 7 == 0);

            const texture = drawKit.fxTextures[descriptor.firstFx];
            if (!texture) continue;

            const blockCountX = descriptor.cellsX / 7;
            const blockCountY = descriptor.cellsY / 7;
            const transforms: mat4[] = [];
            const colorTextureLayers: number[] = [];

            for (let sx = 0; sx < blockCountX; sx++) {
                for (let sy = 0; sy < blockCountY; sy++) {
                    const subblock = sy * blockCountX + sx;
                    if (waterGrid.mask.getUint8(subblock) === 0) continue;

                    const localTransform = mat4.fromTranslation(mat4.create(), vec3.fromValues(
                        descriptor.origin.x + sx * 7 * descriptor.cellSize.x,
                        descriptor.origin.y + sy * 7 * descriptor.cellSize.y,
                        descriptor.origin.z,
                    ));
                    mat4.scale(localTransform, localTransform, vec3.fromValues(descriptor.cellSize.x, descriptor.cellSize.y, 1));
                    transforms.push(mat4.mul(mat4.create(), noclipSpaceFromRatchetSpace, localTransform));
                    colorTextureLayers.push(subblock);
                }
            }

            for (const transform of transforms) {
                const HARDCODED_OFFSET = this.mobyInstance.oClass === 879 ? -0.5 : 0; // ocean height in rilgar is wrong, not sure why
                mat4.translate(transform, transform, vec3.fromValues(0, 0, HARDCODED_OFFSET + this.bobAmplitude * Math.sin(2 * Math.PI * this.elapsedTime * this.bobFrequency)));
            }

            if (transforms.length === 0) continue;
            drawKit.renderers.water.renderWater(
                drawKit.renderInstList,
                geometry,
                transforms,
                ZERO_VEC2,
                ZERO_VEC2,
                this.mobyInstance.uid,
                this.alpha,
                texture,
                drawKit.fxSampler,
                drawKit.instanceDataBuffer,
                false,
                this.alpha === 1,
                undefined,
                colorTextures[gridIndex],
                colorTextureLayers,
                {
                    near: descriptor.fogNear,
                    far: descriptor.fogFar,
                    nearIntensity: descriptor.fogNearIntensity,
                    farIntensity: descriptor.fogFarIntensity,
                    color: descriptor.fogColor,
                },
            );
        }
    }

    drawAfterTies(drawKit: MobyDrawKit) {
        if (!this.lateRender) this.draw(drawKit);
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
        if (this.lateRender) this.draw(drawKit);
    }

    private getOrCreateColorTextures(device: GfxDevice): GfxTexture[] {
        if (this.colorTextures) return this.colorTextures;

        this.colorTextures = [];
        for (let gridIndex = 0; gridIndex < this.grids.length; gridIndex++) {
            const descriptor = this.grids[gridIndex].descriptor;
            const blockCount = (descriptor.cellsX / 7) * (descriptor.cellsY / 7);
            const texture = device.createTexture({
                dimension: GfxTextureDimension.n2DArray,
                pixelFormat: GfxFormat.U8_RGBA_NORM,
                width: 8,
                height: 8,
                depthOrArrayLayers: blockCount,
                numLevels: 1,
                usage: GfxTextureUsage.Sampled,
            });
            device.uploadTextureData(texture, 0, [this.colorTextureData[gridIndex]]);
            this.colorTextures.push(texture);
        }
        return this.colorTextures;
    }

    destroy(device: GfxDevice) {
        if (this.geometry) {
            this.geometry.destroy(device);
        }
        if (this.colorTextures) {
            for (const texture of this.colorTextures) device.destroyTexture(texture);
        }
    }
}

const STRIP_ORDER_INDICES_COUNT = 7 * 16 + 6 * 2; // 7 strips, 16 vertices each, plus 2 degens between each strip

const SIZEOF_TEXCOORDS_BLOCK = 1008; // including 16 byte vif header which is not actually populated until runtime
const SIZEOF_TEXCOORD = 4 * 2;
function untangleStripOrderedTexcoords(overlaySections: OverlaySection[], texcoordsVaddr: number, uvScale: number) {
    const buf = readOverlayVMem(overlaySections, texcoordsVaddr, SIZEOF_TEXCOORDS_BLOCK)
        .subview(0x10); // skip vif header
    assert(buf.byteLength === STRIP_ORDER_INDICES_COUNT * SIZEOF_TEXCOORD);

    const strips = [];
    for (let i = 0; i < 7; i++) strips.push(buf.subview(i * 18 * SIZEOF_TEXCOORD, 16 * SIZEOF_TEXCOORD));
    const out = new Float32Array(8 * 8 * 2);
    let ptr = 0;

    // even texcoords from top edge of each strip
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 8; col++) {
            out[ptr++] = strips[row].getFloat32((col * 2) * SIZEOF_TEXCOORD + 0x0) * uvScale;
            out[ptr++] = strips[row].getFloat32((col * 2) * SIZEOF_TEXCOORD + 0x4) * uvScale;
        }
    }

    // odd texcoords from bottom edge of last row
    for (let col = 0; col < 8; col++) {
        out[ptr++] = strips[6].getFloat32((col * 2 + 1) * SIZEOF_TEXCOORD + 0x0);
        out[ptr++] = strips[6].getFloat32((col * 2 + 1) * SIZEOF_TEXCOORD + 0x4);
    }

    return out;
}

const SIZEOF_COLOR_BLOCK = 0x200;
const SIZEOF_COLOR = 4;
function untangleStripOrderedColors(overlaySections: OverlaySection[], colorsVaddr: number, out: Uint8Array, outPtrStart: number) {
    const vifCommands = readVifCommandList(readOverlayVMem(overlaySections, colorsVaddr, SIZEOF_COLOR_BLOCK));
    const unpackReader = new VifUnpackReader(vifCommands);
    assert(unpackReader.peekNextVnvl() === VifUnpackFormat.V4_8);
    const buf = unpackReader.next();
    assert(buf.byteLength === STRIP_ORDER_INDICES_COUNT * SIZEOF_COLOR);

    const strips = [];
    for (let i = 0; i < 7; i++) strips.push(buf.subview(i * 18 * SIZEOF_COLOR, 16 * SIZEOF_COLOR));
    let ptr = outPtrStart;

    // even texcoords from top edge of each strip
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 8; col++) {
            out[ptr++] = strips[row].getUint8((col * 2) * SIZEOF_COLOR + 0x0);
            out[ptr++] = strips[row].getUint8((col * 2) * SIZEOF_COLOR + 0x1);
            out[ptr++] = strips[row].getUint8((col * 2) * SIZEOF_COLOR + 0x2);
            out[ptr++] = 0xFF;
        }
    }

    // odd texcoords from bottom edge of last row
    for (let col = 0; col < 8; col++) {
        out[ptr++] = strips[6].getUint8((col * 2 + 1) * SIZEOF_COLOR + 0x0);
        out[ptr++] = strips[6].getUint8((col * 2 + 1) * SIZEOF_COLOR + 0x1);
        out[ptr++] = strips[6].getUint8((col * 2 + 1) * SIZEOF_COLOR + 0x2);
        out[ptr++] = 0xFF;
    }

    return out;
}
