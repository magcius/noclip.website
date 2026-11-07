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

/**
 * A dynamic ocean plane centered on the camera
 * 
 * - Used on pokitaru and kalebo iii
 */
export class Water_I implements MobyImpl {
    pvars: Water_I_Pvars;

    surfaceGeometry: WaterGeometry | null = null;
    rippleGeometry1: WaterGeometry | null = null;
    rippleGeometry2: WaterGeometry | null = null;

    baseTextureId: number; // texture id from pvar is added to this

    surfaceUVVelocity1 = vec2.fromValues(0.04, 0.04); // these should be read from the overlay, but the data always has these values so I must be missing something
    surfaceUVVelocity2 = vec2.fromValues(0, -0.04);

    surfaceUVScroll1 = vec2.create();
    surfaceUVScroll2 = vec2.create();

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        const pv = ownPvars(mobyInstance, resources);

        switch (resources.gn) {
            case 1:
                this.baseTextureId = 40;
                break;
            case 2:
                this.baseTextureId = 63;
                // not quite working...
                return;
            case 3:
            case 4:
                // some levels (e.g. aquatos sewers, annihilation nation) have this, but some others (daxx) have it but should not
                // (also pvar layout is different)
                return;
        }

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
    }

    update(drawKit: MobyDrawKit) {
        const dtSeconds = drawKit.dt / 1000;
        vec2.scaleAndAdd(this.surfaceUVScroll1, this.surfaceUVScroll1, this.surfaceUVVelocity1, dtSeconds);
        vec2.scaleAndAdd(this.surfaceUVScroll2, this.surfaceUVScroll2, this.surfaceUVVelocity2, dtSeconds);
    }

    private getOrCreateGeometries(drawKit: MobyDrawKit): [WaterGeometry, WaterGeometry, WaterGeometry] {
        if (this.surfaceGeometry && this.rippleGeometry1 && this.rippleGeometry2) {
            return [this.surfaceGeometry, this.rippleGeometry1, this.rippleGeometry2];
        }

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
        this.surfaceGeometry = new WaterGeometry(
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

        const createRippleGeometry = (uvRepeat: number) => {
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
        this.rippleGeometry1 = createRippleGeometry(4);
        this.rippleGeometry2 = createRippleGeometry(6);

        return [this.surfaceGeometry, this.rippleGeometry1, this.rippleGeometry2];
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
        if (this.resources.gn >= 2) return;
        if (!drawKit.fxTextures) return;

        const [surfaceGeometry, rippleGeometry1, rippleGeometry2] = this.getOrCreateGeometries(drawKit);
        const transform = this.getCameraTransform(drawKit);
        const surfaceTransform = this.getSurfaceTransform(drawKit);
        const surfaceSize = this.pvars.tileSize * 2;

        drawKit.renderers.water.renderWater(
            drawKit, surfaceGeometry, [transform], drawKit.fxTextures[22],
            { uvScroll: ZERO_VEC2, zWobble: ZERO_VEC2, randomSeed: this.mobyInstance.uid, uvRandomSeed: this.mobyInstance.uid, useWorldspaceWobble: false, uvWorldSpaceScale: 0 },
            { blendAlpha: 1, useTextureAlpha: false, useVertexColorAlpha: true },
            null,
            { depthWrite: false, useAdditiveBlend: false, vertexColorTexture: null, vertexColorLayers: null },
        );

        drawKit.renderers.water.renderWater(
            drawKit, rippleGeometry1, [surfaceTransform], drawKit.fxTextures[this.baseTextureId + this.pvars.fxTextureId],
            { uvScroll: this.surfaceUVScroll1, zWobble: ZERO_VEC2, randomSeed: this.mobyInstance.uid + 1, uvRandomSeed: this.mobyInstance.uid + 1, useWorldspaceWobble: false, uvWorldSpaceScale: 4 / surfaceSize },
            { blendAlpha: 1, useTextureAlpha: false, useVertexColorAlpha: true },
            null,
            { depthWrite: false, useAdditiveBlend: true, vertexColorTexture: null, vertexColorLayers: null },
        );

        drawKit.renderers.water.renderWater(
            drawKit, rippleGeometry2, [surfaceTransform], drawKit.fxTextures[this.baseTextureId + this.pvars.fxTextureId + 1],
            { uvScroll: this.surfaceUVScroll2, zWobble: ZERO_VEC2, randomSeed: this.mobyInstance.uid + 2, uvRandomSeed: this.mobyInstance.uid + 2, useWorldspaceWobble: false, uvWorldSpaceScale: 6 / surfaceSize },
            { blendAlpha: 1, useTextureAlpha: true, useVertexColorAlpha: true },
            null,
            { depthWrite: false, useAdditiveBlend: true, vertexColorTexture: null, vertexColorLayers: null },
        );
    }

    destroy(device: GfxDevice) {
        this.surfaceGeometry?.destroy(device);
        this.rippleGeometry1?.destroy(device);
        this.rippleGeometry2?.destroy(device);
    }
}
