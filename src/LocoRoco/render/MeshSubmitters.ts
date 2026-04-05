/*
 * Render-instance submission helpers for LocoRoco. Each function builds and
 * submits one GfxRenderInst for a specific kind of draw (normal mesh, line,
 * debug overlay, selection mask, glow marker). Keeping this out of the main
 * renderer file lets LocoRocoRenderer focus on render-graph orchestration
 * while this module owns the per-draw mega-state + uniform-buffer details.
 *
 * petton-svn, 2026.
 */

import { mat4 } from "gl-matrix";
import { Color, colorNewFromRGBA } from "../../Color.js";
import {
  fillColor,
  fillMatrix4x4,
  fillVec4,
} from "../../gfx/helpers/UniformBufferHelpers.js";
import {
  GfxBindingLayoutDescriptor,
  GfxBlendFactor,
  GfxBlendMode,
  GfxChannelWriteMask,
  GfxMegaStateDescriptor,
  GfxProgram,
} from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../../TextureHolder.js";
import * as Viewer from "../../viewer.js";
import { GpuLineResources, NodeMeshInstance } from "../SceneTree.js";
import { DebugOverlayCircleProgram } from "./program/DebugOverlayCircleProgram.js";
import { DebugOverlayLineProgram } from "./program/DebugOverlayLineProgram.js";
import { DebugOverlayProgram } from "./program/DebugOverlayProgram.js";
import { GlowProgram } from "./program/GlowProgram.js";
import { ObjectProgram } from "./program/ObjectProgram.js";
import { SelectionMaskProgram } from "./program/SelectionMaskProgram.js";

// -----------------------------------------------------------------------------
// Binding layouts & mega states
// -----------------------------------------------------------------------------

/** One sampler + one UBO. Used by every textured mesh draw. */
export const samplerBindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numSamplers: 1, numUniformBuffers: 1 },
];

/** No sampler, one UBO. Used by line draws and the procedural glow marker. */
export const lineBindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numSamplers: 0, numUniformBuffers: 1 },
];

/** Standard alpha blending: SrcAlpha·src + (1−SrcAlpha)·dst. */
export const AlphaBlendMegaState: Partial<GfxMegaStateDescriptor> = {
  attachmentsState: [
    {
      channelWriteMask: GfxChannelWriteMask.AllChannels,
      rgbBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
      },
      alphaBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
      },
    },
  ],
};

/**
 * Additive blend used by the collectible-focus glow pass: color accumulates,
 * alpha is taken from the destination (Zero·src + One·dst).
 */
export const AdditiveGlowMegaState: Partial<GfxMegaStateDescriptor> = {
  attachmentsState: [
    {
      channelWriteMask: GfxChannelWriteMask.AllChannels,
      rgbBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.One,
      },
      alphaBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.Zero,
        blendDstFactor: GfxBlendFactor.One,
      },
    },
  ],
};

/**
 * Opaque overwrite of every channel, used by the selection mask pass. Non-covered
 * pixels are handled by the shader's discard so the transparent clear value is
 * preserved where nothing was drawn.
 */
export const OpaqueWriteAllMegaState: Partial<GfxMegaStateDescriptor> = {
  attachmentsState: [
    {
      channelWriteMask: GfxChannelWriteMask.AllChannels,
      rgbBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.Zero,
      },
      alphaBlendState: {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.Zero,
      },
    },
  ],
};

// -----------------------------------------------------------------------------
// Scratch state (reused across submit calls, never retained by the render inst
// since setSamplerBindingsFromTextureMappings copies the fields out)
// -----------------------------------------------------------------------------

const scratchTextureMapping = new TextureMapping();

/**
 * Resolve the texture mapping to bind for a mesh draw. If the mesh's per-frame
 * render state supplies an override texture, return a scratch mapping that
 * reuses the mesh's sampler; otherwise return the cached default mapping.
 */
function resolveMeshTextureMapping(mesh: NodeMeshInstance): TextureMapping {
  const rs = mesh.renderState;
  const defaultMapping = mesh.gpuResources.textureMapping;
  if (rs.texture && rs.texture !== defaultMapping.gfxTexture) {
    scratchTextureMapping.gfxTexture = rs.texture;
    scratchTextureMapping.gfxSampler = defaultMapping.gfxSampler;
    return scratchTextureMapping;
  }
  return defaultMapping;
}

// -----------------------------------------------------------------------------
// Draw submitters
// -----------------------------------------------------------------------------

/**
 * Submit a single scene mesh as a draw against the object shader. `grayscale`
 * is forwarded to the shader as a 0..1 mix from full color to luminance.
 */
export function submitNormalMesh(
  renderInstManager: GfxRenderInstManager,
  gfxProgram: GfxProgram,
  viewerInput: Viewer.ViewerRenderInput,
  mesh: NodeMeshInstance,
  grayscale: number,
): void {
  const renderInst = renderInstManager.newRenderInst();
  renderInst.setBindingLayouts(samplerBindingLayouts);
  renderInst.setGfxProgram(gfxProgram);
  renderInst.setVertexInput(
    mesh.gpuResources.inputLayout,
    mesh.gpuResources.vertexBufferDescriptors,
    mesh.gpuResources.indexBufferDescriptor,
  );
  renderInst.setSamplerBindingsFromTextureMappings([resolveMeshTextureMapping(mesh)]);
  renderInst.setDrawCount(mesh.gpuResources.drawCount);

  const rs = mesh.renderState;
  let offs = renderInst.allocateUniformBuffer(ObjectProgram.ub_Params, 44);
  const d = renderInst.mapUniformBufferF32(ObjectProgram.ub_Params);
  offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
  offs += fillMatrix4x4(d, offs, mesh.node.renderState.worldMatrix);
  offs += fillColor(d, offs, rs.color);
  offs += fillVec4(d, offs, rs.uvOffset[0], rs.uvOffset[1]);
  offs += fillVec4(d, offs, grayscale);

  renderInst.setMegaStateFlags(AlphaBlendMegaState);
  renderInstManager.submitRenderInst(renderInst);
}

/**
 * Submit a selection-mask draw for a mesh. Same geometry as a normal mesh, but
 * uses the selection mask shader and writes full-opaque white where covered.
 */
export function submitSelectionMaskMesh(
  renderInstManager: GfxRenderInstManager,
  selectionMaskProgram: GfxProgram,
  viewerInput: Viewer.ViewerRenderInput,
  mesh: NodeMeshInstance,
): void {
  const renderInst = renderInstManager.newRenderInst();
  renderInst.setBindingLayouts(samplerBindingLayouts);
  renderInst.setGfxProgram(selectionMaskProgram);
  renderInst.setVertexInput(
    mesh.gpuResources.inputLayout,
    mesh.gpuResources.vertexBufferDescriptors,
    mesh.gpuResources.indexBufferDescriptor,
  );
  renderInst.setSamplerBindingsFromTextureMappings([resolveMeshTextureMapping(mesh)]);
  renderInst.setDrawCount(mesh.gpuResources.drawCount);
  // Write all channels (including alpha) with no blending — discard handles
  // non-object pixels, so the transparent clear value is preserved there.
  renderInst.setMegaStateFlags(OpaqueWriteAllMegaState);

  const rs = mesh.renderState;
  let offs = renderInst.allocateUniformBuffer(SelectionMaskProgram.ub_Params, 36);
  const d = renderInst.mapUniformBufferF32(SelectionMaskProgram.ub_Params);
  offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
  offs += fillMatrix4x4(d, offs, mesh.node.renderState.worldMatrix);
  offs += fillVec4(d, offs, rs.uvOffset[0], rs.uvOffset[1]);

  renderInstManager.submitRenderInst(renderInst);
}

/**
 * Submit a fixed-size additive glow marker at the mesh's world-space origin.
 * The marker quad is generated procedurally in the vertex shader.
 */
export function submitGlowMarker(
  renderInstManager: GfxRenderInstManager,
  glowProgram: GfxProgram,
  viewerInput: Viewer.ViewerRenderInput,
  worldMatrix: mat4,
  radiusPx: number,
  color: readonly [number, number, number, number],
): void {
  const renderInst = renderInstManager.newRenderInst();
  renderInst.setBindingLayouts(lineBindingLayouts);
  renderInst.setGfxProgram(glowProgram);
  renderInst.setDrawCount(6);

  let offs = renderInst.allocateUniformBuffer(GlowProgram.ub_Params, 28);
  const d = renderInst.mapUniformBufferF32(GlowProgram.ub_Params);
  offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
  offs += fillVec4(d, offs, worldMatrix[12], worldMatrix[13], worldMatrix[14]);
  offs += fillVec4(d, offs, radiusPx, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
  offs += fillVec4(d, offs, color[0], color[1], color[2], color[3]);

  renderInst.setMegaStateFlags(AdditiveGlowMegaState);
  renderInstManager.submitRenderInst(renderInst);
}

/**
 * Submit a DebugOverlayLineProgram draw. Consolidates collision lines, path
 * lines and selection-mask path lines. If `megaState` is null the draw inherits
 * the default opaque-overwrite state (the smoothstep edge AA then writes RGBA
 * directly — currently how collision outlines & path-line outlines render).
 */
export function submitLineDraw(
  renderInstManager: GfxRenderInstManager,
  lineProgram: GfxProgram,
  resources: GpuLineResources,
  clipFromLocal: mat4,
  color: Color,
  lineWidthPx: number,
  viewerInput: Viewer.ViewerRenderInput,
  megaState: Partial<GfxMegaStateDescriptor> | null,
  maskMode: boolean,
): void {
  const renderInst = renderInstManager.newRenderInst();
  renderInst.setBindingLayouts(lineBindingLayouts);
  renderInst.setGfxProgram(lineProgram);
  renderInst.setVertexInput(
    resources.inputLayout,
    resources.vertexBufferDescriptors,
    resources.indexBufferDescriptor,
  );
  renderInst.setDrawCount(resources.indexCount);
  if (megaState !== null) renderInst.setMegaStateFlags(megaState);

  let offs = renderInst.allocateUniformBuffer(DebugOverlayLineProgram.ub_Params, 24);
  const d = renderInst.mapUniformBufferF32(DebugOverlayLineProgram.ub_Params);
  offs += fillMatrix4x4(d, offs, clipFromLocal);
  offs += fillColor(d, offs, color);
  offs += fillVec4(
    d, offs,
    viewerInput.backbufferWidth,
    viewerInput.backbufferHeight,
    lineWidthPx,
    maskMode ? 1.0 : 0.0,
  );

  renderInstManager.submitRenderInst(renderInst);
}

const DebugColorFallback: Color = colorNewFromRGBA(1, 0, 1, 0.6);

/**
 * Submit a single debug overlay mesh (box or circle). In `maskMode` the draw
 * uses OpaqueWriteAllMegaState + the shader's mask path (solid white output);
 * otherwise the draw uses AlphaBlendMegaState and the mesh's debug color. A
 * `mesh.debugIsCircle` flag picks between the circle and box shaders.
 */
export function submitDebugOverlayMesh(
  renderInstManager: GfxRenderInstManager,
  circleProgram: GfxProgram,
  boxProgram: GfxProgram,
  viewerInput: Viewer.ViewerRenderInput,
  mesh: NodeMeshInstance,
  pixelsPerWorldUnit: number,
  maskMode: boolean,
): void {
  const renderInst = renderInstManager.newRenderInst();
  renderInst.setBindingLayouts(samplerBindingLayouts);
  renderInst.setVertexInput(
    mesh.gpuResources.inputLayout,
    mesh.gpuResources.vertexBufferDescriptors,
    mesh.gpuResources.indexBufferDescriptor,
  );
  renderInst.setSamplerBindingsFromTextureMappings([mesh.gpuResources.textureMapping]);
  renderInst.setDrawCount(mesh.gpuResources.drawCount);
  renderInst.setMegaStateFlags(maskMode ? OpaqueWriteAllMegaState : AlphaBlendMegaState);

  const worldWidth = mesh.debugWorldWidth || 100;
  const worldHeight = mesh.debugWorldHeight || 100;
  const textWidthPx = mesh.debugTextWidthPx || 480;
  const color = mesh.debugColor || DebugColorFallback;

  if (mesh.debugIsCircle) {
    // Circle overlay: projection (16) + worldMatrix (16) + overlayParams (4) + color (4) = 40 floats
    renderInst.setGfxProgram(circleProgram);
    let offs = renderInst.allocateUniformBuffer(DebugOverlayCircleProgram.ub_Params, 40);
    const d = renderInst.mapUniformBufferF32(DebugOverlayCircleProgram.ub_Params);
    offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
    offs += fillMatrix4x4(d, offs, mesh.node.renderState.worldMatrix);
    offs += fillVec4(d, offs, worldWidth, worldHeight, textWidthPx, maskMode ? 1.0 : 0.0);
    if (maskMode) {
      offs += fillVec4(d, offs, 0); // color (unused in mask mode)
    } else {
      offs += fillColor(d, offs, color);
    }
  } else {
    // Box overlay: projection (16) + worldMatrix (16) + overlayParams (4) + color (4) + arrowParams (4) = 44 floats
    renderInst.setGfxProgram(boxProgram);
    let offs = renderInst.allocateUniformBuffer(DebugOverlayProgram.ub_Params, 44);
    const d = renderInst.mapUniformBufferF32(DebugOverlayProgram.ub_Params);
    offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
    offs += fillMatrix4x4(d, offs, mesh.node.renderState.worldMatrix);
    if (maskMode) {
      offs += fillVec4(d, offs, worldWidth, worldHeight); // .z/.w unused in mask mode
      offs += fillVec4(d, offs, 0); // color (unused in mask mode)
      offs += fillVec4(d, offs, 999, 1.0); // u_ArrowParams: .x=no arrows, .y=mask mode
    } else {
      offs += fillVec4(
        d, offs,
        worldWidth, worldHeight,
        pixelsPerWorldUnit,
        viewerInput.time / 1000.0,
      );
      offs += fillColor(d, offs, color);
      offs += fillVec4(d, offs, mesh.debugArrowDirection ?? 999);
    }
  }

  renderInstManager.submitRenderInst(renderInst);
}
