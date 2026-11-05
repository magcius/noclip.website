import { mat4, vec2, vec3 } from "gl-matrix";
import { assert } from "../../util";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { MobyInstance } from "../bin-gameplay";
import { readOverlayVMem } from "../bin-overlay";
import { LevelResources } from "../loader";
import { MobyDrawKit, MobyImpl, ownPvars } from "./moby";
import { WaterGeometry } from "../render-water";
import { lerp } from "../../MathHelpers";

interface Water_I_Pvars {
    colorSurfaceNear: { a: number, r: number, g: number, b: number };
    colorSurfaceFar: { a: number, r: number, g: number, b: number };
    colorHorizonTop: { a: number, r: number, g: number, b: number };
    colorRippleNear: { a: number, r: number, g: number, b: number };
    colorRippleFar: { a: number, r: number, g: number, b: number };
    height: number;
    tileSize: number;
    fxTextureId: number;
    minCameraHeight: number;
    wallDrop: number;
    oceanForwardReach: number;
    surfaceFadeHeight: number;
}

const ZERO_VEC2 = vec2.create();
const SURFACE_UV_SPEED_VADDR_BY_LEVEL = new Map<number, number>([
    [11, 0x1D9AF0],
    [16, 0x1D8A10],
]);

/**
 * A dynamic ocean plane centered on the camera
 * 
 * - Used on pokitaru and kalebo iii
 */
export class Water_I implements MobyImpl {
    pvars: Water_I_Pvars;
    private horizonGeometry: WaterGeometry | null = null;
    private surfaceGeometry1: WaterGeometry | null = null;
    private surfaceGeometry2: WaterGeometry | null = null;
    private surfaceUVScroll1 = vec2.create();
    private surfaceUVScroll2 = vec2.create();
    private surfaceUVVelocity1 = vec2.create();
    private surfaceUVVelocity2 = vec2.create();

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        const pv = ownPvars(mobyInstance, resources);
        this.pvars = {
            colorSurfaceNear: pv.getUint8_Rgba(0x0),
            colorSurfaceFar: pv.getUint8_Rgba(0x4),
            colorHorizonTop: pv.getUint8_Rgba(0x8),
            colorRippleNear: pv.getUint8_Rgba(0xc),
            colorRippleFar: pv.getUint8_Rgba(0x10),
            height: pv.getFloat32(0x14),
            tileSize: pv.getFloat32(0x18),
            fxTextureId: pv.getUint32(0x1c),
            minCameraHeight: pv.getFloat32(0x20),
            wallDrop: pv.getFloat32(0x24),
            oceanForwardReach: pv.getFloat32(0x28),
            surfaceFadeHeight: pv.getFloat32(0x2c)
        }

        const uvSpeedVaddr = SURFACE_UV_SPEED_VADDR_BY_LEVEL.get(resources.levelNumber);
        assert(uvSpeedVaddr !== undefined);
        assert(resources.overlaySections !== null);
        const uvSpeeds = readOverlayVMem(resources.overlaySections, uvSpeedVaddr, 0x10);
        vec2.set(this.surfaceUVVelocity1, uvSpeeds.getFloat32(0x0), uvSpeeds.getFloat32(0x4));
        vec2.set(this.surfaceUVVelocity2, uvSpeeds.getFloat32(0x8), uvSpeeds.getFloat32(0xc));

    }

    update(drawKit: MobyDrawKit) {
        const dtSeconds = drawKit.dt / 1000;
        vec2.scaleAndAdd(this.surfaceUVScroll1, this.surfaceUVScroll1, this.surfaceUVVelocity1, dtSeconds);
        vec2.scaleAndAdd(this.surfaceUVScroll2, this.surfaceUVScroll2, this.surfaceUVVelocity2, dtSeconds);
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): [WaterGeometry, WaterGeometry, WaterGeometry] {
        if (this.horizonGeometry && this.surfaceGeometry1 && this.surfaceGeometry2)
            return [this.horizonGeometry, this.surfaceGeometry1, this.surfaceGeometry2];

        const positions: number[] = [];
        const texcoords: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];
        const tileSize = this.pvars.tileSize;
        const reach = Math.max(Math.abs(this.pvars.oceanForwardReach), tileSize * 2);
        const halfWidth = 1000;
        const middleEnd = Math.max(reach / 2, tileSize / 2 + 0.01);
        const farEnd = Math.max(reach, middleEnd + 0.01);

        const addBand = (nearDistance: number, farDistance: number, nearColor: { a: number, r: number, g: number, b: number }, farColor: { a: number, r: number, g: number, b: number }) => {
            const firstVertex = positions.length / 3;
            positions.push(
                -halfWidth, nearDistance, 0,
                halfWidth, nearDistance, 0,
                -halfWidth, farDistance, 0,
                halfWidth, farDistance, 0,
            );
            texcoords.push(0, 0, 1, 0, 0, 1, 1, 1);
            colors.push(
                nearColor.r / 0x80, nearColor.g / 0x80, nearColor.b / 0x80, nearColor.a / 0x80,
                nearColor.r / 0x80, nearColor.g / 0x80, nearColor.b / 0x80, nearColor.a / 0x80,
                farColor.r / 0x80, farColor.g / 0x80, farColor.b / 0x80, farColor.a / 0x80,
                farColor.r / 0x80, farColor.g / 0x80, farColor.b / 0x80, farColor.a / 0x80,
            );
            indices.push(
                firstVertex, firstVertex + 1, firstVertex + 2,
                firstVertex + 1, firstVertex + 3, firstVertex + 2,
            );
        };

        addBand(-reach, middleEnd, this.pvars.colorSurfaceNear, this.pvars.colorSurfaceFar);
        addBand(middleEnd, farEnd, this.pvars.colorSurfaceFar, this.pvars.colorHorizonTop);
        this.horizonGeometry = new WaterGeometry(
            drawKit.renderHelper.renderCache,
            new Float32Array(positions),
            new Float32Array(texcoords),
            new Float32Array(colors),
            new Uint16Array(indices),
        );

        const halfSurfaceSize = this.pvars.tileSize * 2;
        const gridSize = 4;
        const vertexCount = (gridSize + 1) * (gridSize + 1);
        const surfacePositions = new Float32Array(vertexCount * 3);
        const surfaceColors = new Float32Array(vertexCount * 4);
        const nearColor = this.pvars.colorRippleNear;
        const farColor = this.pvars.colorRippleFar;
        for (let y = 0; y < gridSize + 1; y++) {
            for (let x = 0; x < gridSize + 1; x++) {
                const vertexIndex = y * (gridSize + 1) + x;
                const localX = -halfSurfaceSize + (2 * halfSurfaceSize * x) / gridSize;
                const localY = -halfSurfaceSize + (2 * halfSurfaceSize * y) / gridSize;
                const dist = Math.hypot(localX, localY);
                const colorBlend = dist / halfSurfaceSize;
                surfacePositions[vertexIndex * 3 + 0] = localX;
                surfacePositions[vertexIndex * 3 + 1] = localY;
                surfaceColors[vertexIndex * 4 + 0] = lerp(nearColor.r, farColor.r, colorBlend) / 0x80;
                surfaceColors[vertexIndex * 4 + 1] = lerp(nearColor.g, farColor.g, colorBlend) / 0x80;
                surfaceColors[vertexIndex * 4 + 2] = lerp(nearColor.b, farColor.b, colorBlend) / 0x80;
                surfaceColors[vertexIndex * 4 + 3] = lerp(nearColor.a, farColor.a, colorBlend) / 0x80;
            }
        }

        const surfaceIndices = new Uint16Array(gridSize * gridSize * 6);
        let surfaceIndex = 0;
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const topLeft = y * (gridSize + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + gridSize + 1;
                const bottomRight = bottomLeft + 1;
                surfaceIndices[surfaceIndex++] = topLeft;
                surfaceIndices[surfaceIndex++] = topRight;
                surfaceIndices[surfaceIndex++] = bottomLeft;
                surfaceIndices[surfaceIndex++] = topRight;
                surfaceIndices[surfaceIndex++] = bottomRight;
                surfaceIndices[surfaceIndex++] = bottomLeft;
            }
        }

        const createSurfaceGeometry = (uvRepeat: number) => {
            const surfaceTexcoords = new Float32Array(vertexCount * 2);
            for (let y = 0; y <= gridSize; y++) {
                for (let x = 0; x <= gridSize; x++) {
                    const vertexIndex = y * (gridSize + 1) + x;
                    surfaceTexcoords[vertexIndex * 2 + 0] = (x / gridSize) * uvRepeat;
                    surfaceTexcoords[vertexIndex * 2 + 1] = (y / gridSize) * uvRepeat;
                }
            }
            return new WaterGeometry(
                drawKit.renderHelper.renderCache,
                surfacePositions,
                surfaceTexcoords,
                surfaceColors,
                surfaceIndices,
            );
        };
        this.surfaceGeometry1 = createSurfaceGeometry(4);
        this.surfaceGeometry2 = createSurfaceGeometry(6);

        return [this.horizonGeometry, this.surfaceGeometry1, this.surfaceGeometry2];
    }

    private getCameraTransform(drawKit: MobyDrawKit): mat4 {
        const forward = vec3.fromValues(drawKit.cameraForward[0], 0, drawKit.cameraForward[2]);
        if (vec3.squaredLength(forward) < 0.000001)
            vec3.set(forward, 0, 0, -1);
        else
            vec3.normalize(forward, forward);
        const right = vec3.fromValues(-forward[2], 0, forward[0]);

        const transform = mat4.create();
        transform[0] = right[0];
        transform[1] = right[1];
        transform[2] = right[2];
        transform[4] = forward[0];
        transform[5] = forward[1];
        transform[6] = forward[2];
        transform[8] = 0;
        transform[9] = 1;
        transform[10] = 0;
        transform[12] = drawKit.cameraPosition[0];
        transform[13] = this.pvars.height;
        transform[14] = drawKit.cameraPosition[2];
        return transform;
    }

    private getSurfaceTransform(drawKit: MobyDrawKit): mat4 {
        const transform = mat4.create();
        transform[0] = 1;
        transform[4] = 0;
        transform[5] = 0;
        transform[6] = -1;
        transform[8] = 0;
        transform[9] = 1;
        transform[10] = 0;
        transform[12] = drawKit.cameraPosition[0];
        transform[13] = this.pvars.height;
        transform[14] = drawKit.cameraPosition[2];
        return transform;
    }

    drawAfterTies(drawKit: MobyDrawKit) {
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
        if (!drawKit.fxTextures) return;

        const [horizonGeometry, surfaceGeometry1, surfaceGeometry2] = this.getOrCreateGeometries(drawKit);
        const transform = this.getCameraTransform(drawKit);
        const surfaceTransform = this.getSurfaceTransform(drawKit);
        const surfaceSize = this.pvars.tileSize * 2;

        drawKit.renderers.water.renderWater(
            drawKit.renderInstList,
            horizonGeometry,
            [transform],
            ZERO_VEC2,
            ZERO_VEC2,
            this.mobyInstance.uid,
            1,
            drawKit.fxTextures[22],
            drawKit.fxSampler,
            drawKit.instanceDataBuffer,
            false,
            false,
            undefined,
            null,
            null,
            null,
            true,
            false,
            true,
        );


        drawKit.renderers.water.renderWater(
            drawKit.renderInstList,
            surfaceGeometry1,
            [surfaceTransform],
            this.surfaceUVScroll1,
            ZERO_VEC2,
            this.mobyInstance.uid + 1,
            1,
            drawKit.fxTextures[this.pvars.fxTextureId + 0x28],
            drawKit.fxSampler,
            drawKit.instanceDataBuffer,
            false,
            false,
            undefined,
            null,
            null,
            null,
            true,
            false,
            true,
            true,
            4 / surfaceSize,
        );

        drawKit.renderers.water.renderWater(
            drawKit.renderInstList,
            surfaceGeometry2,
            [surfaceTransform],
            this.surfaceUVScroll2,
            ZERO_VEC2,
            this.mobyInstance.uid + 2,
            1,
            drawKit.fxTextures[this.pvars.fxTextureId + 0x29],
            drawKit.fxSampler,
            drawKit.instanceDataBuffer,
            true,
            false,
            undefined,
            null,
            null,
            null,
            true,
            false,
            true,
            true,
            6 / surfaceSize,
        );
    }

    destroy(device: GfxDevice) {
        this.horizonGeometry?.destroy(device);
        this.surfaceGeometry1?.destroy(device);
        this.surfaceGeometry2?.destroy(device);
        this.horizonGeometry = null;
        this.surfaceGeometry1 = null;
        this.surfaceGeometry2 = null;
    }
}
