import { vec3 } from "gl-matrix";
import { Color, colorNewFromRGBA8 } from "../Color";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import {
  fillColor,
  fillMatrix4x3,
  fillMatrix4x4,
  fillVec3v,
  fillVec4,
} from "../gfx/helpers/UniformBufferHelpers";
import {
  GfxBlendFactor,
  GfxBlendMode,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxCompareMode,
  GfxCullMode,
  GfxDevice,
  GfxIndexBufferDescriptor,
  GfxMegaStateDescriptor,
  GfxProgram,
  GfxVertexBufferDescriptor,
  GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxBuffer, GfxInputLayout } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import {
  GfxRenderInstList,
  GfxRenderInstManager,
} from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { GlowProgram } from "./GlowProgram";

export const enum GlowShape {
  Ring10,
  Ring16,
  Ring24,
  Ring32,
  Star1,
  Star2,
  Star3,
  Star4,
  Ring3,
  Ring4,
  Ring5,
  Ring6,
  Ring8,
}

const GLOW_SHAPE_PARAMS: { star: boolean; count: number }[] = [
  { star: false, count: 10 },
  { star: false, count: 16 },
  { star: false, count: 24 },
  { star: false, count: 32 },
  { star: true, count: 1 },
  { star: true, count: 2 },
  { star: true, count: 3 },
  { star: true, count: 4 },
  { star: false, count: 3 },
  { star: false, count: 4 },
  { star: false, count: 5 },
  { star: false, count: 6 },
  { star: false, count: 8 },
];

export interface GlowDef {
  center: vec3;
  colorA: Color;
  colorB: Color;
  radiusA: number;
  radiusB: number;
  angle: number;
  shape: GlowShape;
}

export function glowColorFromRGBA32(rgba: number): Color {
  const color = colorNewFromRGBA8(rgba);
  color.a = (rgba & 0xff) / 0x80;
  return color;
}

const VERTEX_STRIDE = 3;

class GlowStripBuilder {
  private vertices: number[] = [];
  private indices: number[] = [];
  private stripStart = 0;

  public startStrip() {
    this.stripStart = this.vertices.length / VERTEX_STRIDE;
  }

  public addPoint(x: number, y: number, vertexClass: number) {
    const index = this.vertices.length / VERTEX_STRIDE;
    this.vertices.push(x, y, vertexClass);

    if (index >= this.stripStart + 2)
      this.indices.push(index - 2, index - 1, index);
  }

  public addPointPair(x: number, y: number) {
    this.addPoint(x, y, 1.0);
    this.addPoint(x, y, 0.0);
  }

  public finish() {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
    };
  }
}

function buildRing(segments: number): GlowStripBuilder {
  const builder = new GlowStripBuilder();
  builder.startStrip();

  for (let i = 0; i <= segments; i++) {
    const theta = (i * 2.0 * Math.PI) / segments;
    builder.addPointPair(Math.cos(theta), Math.sin(theta));
  }

  return builder;
}

const STAR_WAIST_SCALE = 0.03125;
const STAR_BODY_ORDER = [0, 1, 3, 2];

function buildStar(points: number): GlowStripBuilder {
  const builder = new GlowStripBuilder();

  const direction = (base: number, k: number): [number, number] => {
    const theta = base + (k * Math.PI) / 2.0;
    const scale = (k & 1) !== 0 ? STAR_WAIST_SCALE : 1.0;
    return [Math.cos(theta) * scale, Math.sin(theta) * scale];
  };

  for (let i = 0; i < points; i++) {
    const base = Math.PI / 2.0 + (i * Math.PI) / points;

    builder.startStrip();
    for (let k = 0; k <= 4; k++) builder.addPointPair(...direction(base, k));

    builder.startStrip();
    for (const k of STAR_BODY_ORDER)
      builder.addPoint(...direction(base, k), 1.0);
  }

  return builder;
}

interface GlowShapeBuffers {
  vertexBuffer: GfxBuffer;
  indexBuffer: GfxBuffer;
  vertexBufferDescriptors: GfxVertexBufferDescriptor[];
  indexBufferDescriptor: GfxIndexBufferDescriptor;
  indexCount: number;
}

export class GlowRenderer {
  private program: GfxProgram;
  private inputLayout: GfxInputLayout;
  private shapes = new Map<GlowShape, GlowShapeBuffers>();
  private megaStateFlags: Partial<GfxMegaStateDescriptor> = {
    cullMode: GfxCullMode.None,
    depthWrite: false,
    depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
  };

  constructor(private cache: GfxRenderCache) {
    this.program = cache.createProgram(new GlowProgram());

    this.inputLayout = cache.createInputLayout({
      vertexAttributeDescriptors: [
        {
          location: GlowProgram.a_Direction,
          format: GfxFormat.F32_RG,
          bufferByteOffset: 0,
          bufferIndex: 0,
        },
        {
          location: GlowProgram.a_Class,
          format: GfxFormat.F32_R,
          bufferByteOffset: 2 * 4,
          bufferIndex: 0,
        },
      ],
      vertexBufferDescriptors: [
        {
          byteStride: VERTEX_STRIDE * 4,
          frequency: GfxVertexBufferFrequency.PerVertex,
        },
      ],
      indexBufferFormat: GfxFormat.U32_R,
    });

    setAttachmentStateSimple(this.megaStateFlags, {
      blendMode: GfxBlendMode.Add,
      blendSrcFactor: GfxBlendFactor.SrcAlpha,
      blendDstFactor: GfxBlendFactor.One,
    });
  }

  private getShape(shape: GlowShape): GlowShapeBuffers {
    let buffers = this.shapes.get(shape);
    if (buffers !== undefined) return buffers;

    const params = GLOW_SHAPE_PARAMS[shape];
    const builder = params.star
      ? buildStar(params.count)
      : buildRing(params.count);
    const { vertices, indices } = builder.finish();

    const device = this.cache.device;
    const vertexBuffer = createBufferFromData(
      device,
      GfxBufferUsage.Vertex,
      GfxBufferFrequencyHint.Static,
      vertices.buffer,
    );
    const indexBuffer = createBufferFromData(
      device,
      GfxBufferUsage.Index,
      GfxBufferFrequencyHint.Static,
      indices.buffer,
    );

    buffers = {
      vertexBuffer,
      indexBuffer,
      vertexBufferDescriptors: [{ buffer: vertexBuffer, byteOffset: 0 }],
      indexBufferDescriptor: { buffer: indexBuffer, byteOffset: 0 },
      indexCount: indices.length,
    };
    this.shapes.set(shape, buffers);
    return buffers;
  }

  public pushTemplate(
    renderInstManager: GfxRenderInstManager,
    viewerInput: ViewerRenderInput,
  ): void {
    const template = renderInstManager.pushTemplate();
    template.setBindingLayouts([{ numSamplers: 0, numUniformBuffers: 2 }]);
    template.setGfxProgram(this.program);
    template.setMegaStateFlags(this.megaStateFlags);

    const data = template.allocateUniformBufferF32(
      GlowProgram.ub_SceneParams,
      16 + 12,
    );
    const offs = fillMatrix4x4(data, 0, viewerInput.camera.projectionMatrix);
    fillMatrix4x3(data, offs, viewerInput.camera.viewMatrix);
  }

  public submitGlow(
    renderInstManager: GfxRenderInstManager,
    list: GfxRenderInstList,
    def: GlowDef,
  ): void {
    const shape = this.getShape(def.shape);

    const renderInst = renderInstManager.newRenderInst();
    renderInst.setVertexInput(
      this.inputLayout,
      shape.vertexBufferDescriptors,
      shape.indexBufferDescriptor,
    );
    renderInst.setDrawCount(shape.indexCount);

    const data = renderInst.allocateUniformBufferF32(
      GlowProgram.ub_GlowParams,
      4 * 4,
    );
    let offs = 0;
    offs += fillVec3v(data, offs, def.center);
    offs += fillVec4(
      data,
      offs,
      def.radiusA,
      def.radiusB,
      Math.cos(def.angle),
      Math.sin(def.angle),
    );
    offs += fillColor(data, offs, def.colorA);
    fillColor(data, offs, def.colorB);

    list.submitRenderInst(renderInst);
  }

  public destroy(device: GfxDevice): void {
    for (const shape of this.shapes.values()) {
      device.destroyBuffer(shape.vertexBuffer);
      device.destroyBuffer(shape.indexBuffer);
    }
  }
}
