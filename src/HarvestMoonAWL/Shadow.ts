// Shadows

import { mat4, vec3 } from "gl-matrix";
import { GfxClipSpaceNearZ, GfxDevice, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { preprocessProgram_GLSL } from "../gfx/shaderc/GfxShaderCompiler.js";
import { projectionMatrixConvertClipSpaceNearZ } from "../gfx/helpers/ProjectionHelpers.js";
import { projectionMatrixForCuboid } from "../MathHelpers.js";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import { GXMaterialHelperGfx } from "../gx/gx_render.js";
import * as GX from "../gx/gx_enum.js";
import { colorNewFromRGBA } from "../Color.js";

//#region Buffer size and Rasterization

// Larger than the ROM, as CAMERA_FIT_RADIUS is larger
export const BUFFER_WIDTH = 4096;
export const BUFFER_HEIGHT = 4096;

export const CASTER_SUPERSAMPLE = 2;

export const CASTER_GUARD_BAND = 2;

export const CASTER_LOD_BIAS = 0.0;

export const NEUTRAL = 0x80 / 0xff;
export const CLEAR_COLOR = colorNewFromRGBA(NEUTRAL, NEUTRAL, NEUTRAL, 1.0);

export const STRENGTH = 1.0;

export const CASTER_COLOR_SCALE = 128.0 / 0xff;

export function casterRed(strength: number = STRENGTH): number {
    return Math.min(0xff, Math.floor(0xff * CASTER_COLOR_SCALE * strength)) / 0xff;
}

//#endregion

//#region Caster Kind

export const enum CasterKind {
    None,
    Solid,
    Billboard,
}

export function lightYaw(dst: mat4, lightDirection: vec3): void {
    if (lightDirection[0] === 0.0 && lightDirection[2] === 0.0) {
        mat4.identity(dst);
        return;
    }
    mat4.fromYRotation(dst, Math.atan2(-lightDirection[0], -lightDirection[2]));
}

//#endregion

//#region The light camera fit

// Deliberately loading in shadows further away than the ROM - looks better in browser
export const CAMERA_FIT_RADIUS = 240.0;

const SCENE_MARGIN = 6.0;

const MIN_EXTENT = 1.0;

const DEPTH_PULLBACK = 100.0;

const LIGHT_UP = vec3.fromValues(0, 1, 0);
const ORIGIN = vec3.create();

export const LATE_BINDING = "HarvestMoonAWL shadow buffer";

export class ShadowCamera {
    public view = mat4.create();
    public projection = mat4.create();
    public texMtx = mat4.create();
    public radius = 0.0;
}

const scratchLightDir = vec3.create();
const scratchPoint = vec3.create();
const scratchCenter = vec3.create();
const scratchLightOrtho = mat4.create();

function lightOrtho(dst: mat4, halfWidth: number, halfHeight: number, flipY: boolean): void {
    mat4.identity(dst);
    dst[0] = 0.5 / halfWidth;
    dst[5] = (flipY ? 0.5 : -0.5) / halfHeight;
    dst[10] = 0.0;
    dst[12] = 0.5;
    dst[13] = 0.5;
    dst[14] = 1.0;
}

function fitCameraCentre(dst: vec3, cameraPos: vec3, boundsMin: vec3, boundsMax: vec3): void {
    const lo0 = boundsMin[0] - SCENE_MARGIN, hi0 = boundsMax[0] + SCENE_MARGIN;
    const lo2 = boundsMin[2] - SCENE_MARGIN, hi2 = boundsMax[2] + SCENE_MARGIN;
    vec3.set(dst,
        Math.min(hi0, Math.max(lo0, cameraPos[0])),
        (boundsMin[1] + boundsMax[1]) * 0.5,
        Math.min(hi2, Math.max(lo2, cameraPos[2])));
}

const RADIUS_STEP_DOWN = 0.45;

function maxRadius(boundsMin: vec3, boundsMax: vec3): number {
    const sx = (boundsMax[0] - boundsMin[0]) + 2.0 * SCENE_MARGIN;
    const sz = (boundsMax[2] - boundsMin[2]) + 2.0 * SCENE_MARGIN;
    const sy = (boundsMax[1] - boundsMin[1]) * 0.5;
    const cover = Math.sqrt(sx * sx + sz * sz + sy * sy);
    let radius = CAMERA_FIT_RADIUS;
    while (radius < cover)
        radius *= 2.0;
    return radius;
}

function fitRadius(dst: ShadowCamera, centre: vec3, cameraPos: vec3, boundsMin: vec3, boundsMax: vec3): number {
    const cap = maxRadius(boundsMin, boundsMax);
    const distance = vec3.distance(cameraPos, centre);
    let radius = dst.radius > 0.0 ? Math.min(dst.radius, cap) : CAMERA_FIT_RADIUS;
    while (radius < cap && distance > radius)
        radius *= 2.0;
    while (radius > CAMERA_FIT_RADIUS && distance < radius * RADIUS_STEP_DOWN)
        radius *= 0.5;
    dst.radius = radius;
    return radius;
}

export function fitLightCamera(dst: ShadowCamera, lightDirection: vec3, boundsMin: vec3, boundsMax: vec3, cameraPos: vec3, device: GfxDevice): void {
    vec3.copy(scratchLightDir, lightDirection);
    if (vec3.squaredLength(scratchLightDir) < 1e-6)
        vec3.set(scratchLightDir, 0, 1, 0);
    vec3.normalize(scratchLightDir, scratchLightDir);

    mat4.lookAt(dst.view, ORIGIN, scratchLightDir, LIGHT_UP);

    fitCameraCentre(scratchCenter, cameraPos, boundsMin, boundsMax);

    const radius = Math.max(MIN_EXTENT, fitRadius(dst, scratchCenter, cameraPos, boundsMin, boundsMax));

    vec3.transformMat4(scratchPoint, scratchCenter, dst.view);
    const halfWidth = radius, halfHeight = radius;
    const cx = scratchPoint[0];
    const cy = scratchPoint[1];
    const minZ = scratchPoint[2] - radius, maxZ = scratchPoint[2] + radius;

    const nearPlane = maxZ + DEPTH_PULLBACK;
    let depth = nearPlane - minZ;
    if (depth <= 0.0) depth = MIN_EXTENT;

    dst.view[12] -= cx;
    dst.view[13] -= cy;
    dst.view[14] -= nearPlane;

    projectionMatrixForCuboid(dst.projection, -halfWidth, halfWidth, -halfHeight, halfHeight, 0.0, depth);
    projectionMatrixConvertClipSpaceNearZ(dst.projection, device.queryVendorInfo().clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

    lightOrtho(scratchLightOrtho, halfWidth, halfHeight, gfxDeviceNeedsFlipY(device));
    mat4.mul(dst.texMtx, scratchLightOrtho, dst.view);
}

//#endregion

//#region Caster materials

export function createCasterMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL shadow caster (0.5 - C0)");
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(0, GX.CC.C0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.HALF);
    mb.setTevColorOp(0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A0);
    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

export function createBillboardCasterMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL shadow caster, billboard (0.5 - C0*TEXC)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevSwapMode(0, undefined, [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R]);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.C0, GX.CC.TEXC, GX.CC.HALF);
    mb.setTevColorOp(0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

//#endregion

//#region Downsample pass

export class ShadowDownsample {
    private gfxProgram: GfxProgram;
    private gfxSampler: GfxSampler;

    constructor(cache: GfxRenderCache) {
        this.gfxProgram = cache.createProgramSimple(preprocessProgram_GLSL(cache.device.queryVendorInfo(),
            GfxShaderLibrary.fullscreenVS, GfxShaderLibrary.fullscreenBlitOneTexPS));
        this.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear, magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest, minLOD: 0, maxLOD: 0,
        });
    }

    public pushPass(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, casterTargetID: GfxrRenderTargetID, bufferTargetID: GfxrRenderTargetID): void {
        builder.pushPass((pass) => {
            pass.setDebugName("Shadow Buffer Downsample");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, bufferTargetID);

            const casterResolveID = builder.resolveRenderTarget(casterTargetID);
            pass.attachResolveTexture(casterResolveID);

            const renderInst = renderHelper.renderInstManager.newRenderInst();
            renderInst.setUniformBuffer(renderHelper.uniformBuffer);
            renderInst.setAllowSkippingIfPipelineNotReady(false);
            renderInst.setMegaStateFlags(fullscreenMegaState);
            renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
            renderInst.setDrawCount(3);
            renderInst.setGfxProgram(this.gfxProgram);

            pass.exec((passRenderer, scope) => {
                renderInst.setSamplerBindingsFromTextureMappings([
                    { gfxTexture: scope.getResolveTextureForID(casterResolveID), gfxSampler: this.gfxSampler },
                ]);
                renderInst.drawOnPass(renderHelper.renderCache, passRenderer);
            });
        });
    }
}

//#endregion
