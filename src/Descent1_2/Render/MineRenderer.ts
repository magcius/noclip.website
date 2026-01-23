import { mat2, ReadonlyMat2, vec2, vec3 } from "gl-matrix";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import {
    fillMatrix4x3,
    fillMatrix4x4,
} from "../../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBindingLayoutDescriptor,
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxFrontFaceMode,
    GfxIndexBufferDescriptor,
    GfxInputLayout,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode,
} from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../../Program.js";
import { TextureMapping } from "../../TextureHolder.js";
import * as Viewer from "../../viewer.js";
import { DescentAssetCache } from "../Common/AssetCache.js";
import { applySegmentLight } from "../Common/FlickeringLight.js";
import { DescentFlickeringLight } from "../Common/Level.js";
import { makeSegmentSideKey } from "../Common/LevelReaders.js";
import { DescentSide, WALL_TYPE_OPEN } from "../Common/LevelTypes.js";
import { DescentTextureList, ResolvedTexture } from "../Common/TextureList.js";
import { MultiMap } from "../Common/Util.js";
import { Descent1Level } from "../D1/D1Level.js";
import { Descent2Level } from "../D2/D2Level.js";
import { DescentRenderParameters } from "./RenderParameters.js";

class DescentMineProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 2 },
    ];

    public static a_xyz = 0;
    public static a_uvl = 1;
    public static a_quadl = 2;

    public static ub_SceneParams = 0;
    public static ub_TextureParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
precision highp float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_matProjection;
    Mat3x4 u_matView;
    float u_minLight;
    float u_slideTime;
};

layout(std140) uniform ub_TextureParams {
    vec4 u_overlayRot;
    vec2 u_texSlide;
};

layout(binding = 0) uniform sampler2D u_sampler_base;
layout(binding = 1) uniform sampler2D u_sampler_overlay;
`;

    public override vert = `
layout (location = ${DescentMineProgram.a_xyz}) in vec3 a_xyz;
layout (location = ${DescentMineProgram.a_uvl}) in vec3 a_uvl;
layout (location = ${DescentMineProgram.a_quadl}) in vec4 a_quadl;

out vec3 v_uvl;
out vec4 v_quadl;
out vec2 v_quadxy;

const vec2 QUAD_XY[] = vec2[4](
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0)
);

void main() {
    vec3 t_xyz = UnpackMatrix(u_matView) * vec4(a_xyz, 1.0);
    gl_Position = UnpackMatrix(u_matProjection) * vec4(t_xyz, 1.0);
    v_uvl = a_uvl;
    v_quadl = a_quadl;
    v_quadxy = QUAD_XY[gl_VertexID & 3];
}
`;

    public override frag = `
in vec3 v_uvl;
in vec4 v_quadl;
in vec2 v_quadxy;

mat2 mat2_from_vec4(vec4 v) {
    return mat2(v.x, v.y, v.z, v.w);
}

void main() {
    // Semitransparency is alpha ~0.5 on overlay
    // 0 selects base, 1 selects overlay
    // overlay alpha 0.0 -> 0
    // overlay alpha 0.5 -> 1
    // overlay alpha 1.0 -> 1
    vec2 u_pos = v_uvl.xy + u_texSlide;
    mat2 u_overlayRotMat = mat2_from_vec4(u_overlayRot);
    vec4 t_colorOverlay = texture(SAMPLER_2D(u_sampler_overlay), u_overlayRotMat * u_pos);
    float t_select = step(0.25, t_colorOverlay.a);

    // Mix vertex light and interpolated quad light
    float t_quadLight = (v_quadl.x * (1.0 - v_quadxy.x) * (1.0 - v_quadxy.y))
                      + (v_quadl.y * (      v_quadxy.x) * (1.0 - v_quadxy.y))
                      + (v_quadl.z * (      v_quadxy.x) * (      v_quadxy.y))
                      + (v_quadl.w * (1.0 - v_quadxy.x) * (      v_quadxy.y));
    float t_mixLight = v_uvl.z + t_quadLight;

    vec4 t_colorBase = texture(SAMPLER_2D(u_sampler_base), u_pos).rgba;
    vec4 t_colorFinal = mix(t_colorBase, t_colorOverlay, t_select).rgba;
    if (t_colorFinal.a < 0.75) discard;
    gl_FragColor = t_colorFinal * clamp(mix(1.0/33.0, 1.0, clamp(t_mixLight, 0.0, 1.0)), u_minLight, 1.0);
}
`;

    constructor() {
        super();
    }
}

type MineMeshCall = {
    indexOffset: number;
    indexCount: number;
    baseTexture: ResolvedTexture;
    overlayTexture: ResolvedTexture | null;
    overlayRotation: number;
};

type MineMesh = {
    vertices: Float32Array;
    indices: Uint16Array;
    calls: MineMeshCall[];
    segmentSideVertexOffsets: Map<number, number>;
};

function computeNormal(a: vec3, b: vec3, c: vec3): vec3 {
    const ab = vec3.create();
    const ac = vec3.create();
    const n = vec3.create();
    vec3.sub(ab, b, a);
    vec3.sub(ac, c, a);
    vec3.cross(n, ab, ac);
    vec3.normalize(n, n);
    return n;
}

function buildSegmentSideMesh(
    bufVertex: number[][],
    bufIndex: number[],
    level: Descent1Level | Descent2Level,
    side: DescentSide,
) {
    const sideVertices = side.vertices;
    const normal = computeNormal(
        sideVertices[0],
        sideVertices[1],
        sideVertices[2],
    );
    const tmp = vec3.create();
    vec3.sub(tmp, sideVertices[3], sideVertices[1]);
    const dot = vec3.dot(normal, tmp);

    // If the side is a quad, pass quad lights only
    // If the side is not a quad, pass tri lights for each vertex

    const indexBase = bufVertex.length;
    const isQuad = Math.abs(dot) < 0.05;
    const vertexLights = side.uvl.map((uvl) => (isQuad ? uvl[2] : 0));
    for (let i = 0; i < 4; ++i) {
        const xyz = sideVertices[i];
        const uvl = side.uvl[i];
        bufVertex.push([
            xyz[0],
            xyz[1],
            -xyz[2],
            uvl[0],
            uvl[1],
            isQuad ? 0 : uvl[2],
            ...vertexLights,
        ]);
    }

    if (dot > 0) {
        // Triangulate 012 230
        bufIndex.push(indexBase + 0);
        bufIndex.push(indexBase + 1);
        bufIndex.push(indexBase + 2);
        bufIndex.push(indexBase + 2);
        bufIndex.push(indexBase + 3);
        bufIndex.push(indexBase + 0);
    } else {
        // Triangulate 013 123
        bufIndex.push(indexBase + 0);
        bufIndex.push(indexBase + 1);
        bufIndex.push(indexBase + 3);
        bufIndex.push(indexBase + 1);
        bufIndex.push(indexBase + 2);
        bufIndex.push(indexBase + 3);
    }
}

function modifyVertexBufferLight(
    vbuf: Float32Array,
    offset: number,
    factor: number,
    deltas: number[],
) {
    // UVL l at vertex offset 5, quad l's follow immediately
    let floatOffset = offset * 10 + 5;
    for (let i = 0; i < deltas.length; ++i) {
        const finalOffset = floatOffset + 10 * i;
        vbuf[finalOffset] += factor * deltas[i];
        for (let j = 0; j < Math.min(4, deltas.length); ++j)
            vbuf[finalOffset + j + 1] += factor * deltas[j];
    }
}

function makeSideTextureKey(side: DescentSide) {
    return (
        side.baseTextureIndex |
        (side.overlayTextureIndex << 16) |
        (side.overlayRotation << 30)
    );
}

function extractSideTextureKey(sideKey: number) {
    const baseTextureId = sideKey & 0xffff;
    const overlayTextureId = (sideKey >> 16) & 0x3fff;
    const overlayRotation = (sideKey >> 30) & 3;
    return [baseTextureId, overlayTextureId, overlayRotation];
}

function buildMineMesh(
    level: Descent1Level | Descent2Level,
    textureList: DescentTextureList,
    assetCache: DescentAssetCache,
): MineMesh {
    // First, group sides to render by texture.
    const sidesByTexture = new MultiMap<number, DescentSide>();
    for (const segment of level.segments) {
        for (const side of segment.sides) {
            if (side.mayBeRendered) {
                const sideWall =
                    side.wallNum == null
                        ? null
                        : (level.walls[side.wallNum] ?? null);
                const isRendered =
                    sideWall == null || sideWall.type !== WALL_TYPE_OPEN;

                if (isRendered) {
                    sidesByTexture.add(makeSideTextureKey(side), side);
                }
            }
        }
    }

    // Then, load in textures as needed.
    const vertices: number[][] = [];
    const indices: number[] = [];
    const calls: MineMeshCall[] = [];
    const segmentSideVertexOffsets: Map<number, number> = new Map();

    for (const [sideKey, sides] of sidesByTexture.entries()) {
        const [baseTextureId, overlayTextureId, overlayRotation] =
            extractSideTextureKey(sideKey);
        const baseTexture = textureList.resolveTmapToTexture(baseTextureId);
        if (baseTexture == null) continue;

        const overlayTexture =
            overlayTextureId > 0
                ? (textureList.resolveTmapToTexture(overlayTextureId) ?? null)
                : null;

        const indexOffset = indices.length;
        for (const side of sides) {
            segmentSideVertexOffsets.set(
                makeSegmentSideKey(side.segment.segmentNum, side.sideNum),
                vertices.length,
            );
            buildSegmentSideMesh(vertices, indices, level, side);
        }

        const indexCount = indices.length - indexOffset;
        const call: MineMeshCall = {
            indexOffset,
            indexCount,
            baseTexture,
            overlayTexture,
            overlayRotation,
        };
        calls.push(call);
    }

    return {
        vertices: new Float32Array(vertices.flat()),
        indices: new Uint16Array(indices),
        calls,
        segmentSideVertexOffsets,
    };
}

const megaStateFlags: Partial<GfxMegaStateDescriptor> = {
    cullMode: GfxCullMode.Back,
    frontFace: GfxFrontFaceMode.CW,
};

function getRotationMatrix(rot: number): ReadonlyMat2 {
    const arr: [number, number, number, number] = [0, 0, 0, 0];
    if (rot & 1) {
        arr[1] = rot & 2 ? 1.0 : -1.0;
        arr[2] = -arr[1];
        arr[0] = arr[3] = 0.0;
    } else {
        arr[0] = arr[3] = rot > 0 ? -1.0 : 1.0;
        arr[1] = arr[2] = 0.0;
    }
    return mat2.fromValues(...arr);
}

function fillMatrix2x2(d: Float32Array, offs: number, m: ReadonlyMat2): number {
    d[offs + 0] = m[0];
    d[offs + 1] = m[2];
    d[offs + 2] = m[1];
    d[offs + 3] = m[3];
    return 2 * 2;
}

export class DescentMineRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private inputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private mineMeshCalls: MineMeshCall[];
    private gfxSampler: GfxSampler;
    private textureMapping: TextureMapping[];
    public mineMesh: MineMesh;
    private segmentSideVertexOffsets: Map<number, number>;
    private meshVertices: Float32Array;

    constructor(
        private device: GfxDevice,
        private level: Descent1Level | Descent2Level,
        private assetCache: DescentAssetCache,
        private textureList: DescentTextureList,
        private cache: GfxRenderCache,
        private renderParameters: DescentRenderParameters,
    ) {
        this.gfxProgram = cache.createProgram(new DescentMineProgram());

        this.mineMesh = buildMineMesh(level, this.textureList, assetCache);
        const { vertices, indices, calls, segmentSideVertexOffsets } =
            this.mineMesh;
        this.segmentSideVertexOffsets = segmentSideVertexOffsets;
        this.meshVertices = vertices;
        this.vertexBuffer = createBufferFromData(
            device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            vertices.buffer,
        );
        this.indexBuffer = createBufferFromData(
            device,
            GfxBufferUsage.Index,
            GfxBufferFrequencyHint.Static,
            indices.buffer,
        );
        this.mineMeshCalls = calls;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: DescentMineProgram.a_xyz,
                bufferIndex: 0,
                bufferByteOffset: 0 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentMineProgram.a_uvl,
                bufferIndex: 0,
                bufferByteOffset: 3 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentMineProgram.a_quadl,
                bufferIndex: 0,
                bufferByteOffset: 6 * 0x04,
                format: GfxFormat.F32_RGBA,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {
                byteStride: 10 * 0x04,
                frequency: GfxVertexBufferFrequency.PerVertex,
            },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.gfxSampler = this.cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping = [new TextureMapping(), new TextureMapping()];
        this.textureMapping[0].gfxSampler = this.gfxSampler;
        this.textureMapping[1].gfxSampler = this.gfxSampler;
    }

    public applyFlicker(
        lightsOn: DescentFlickeringLight[],
        lightsOff: DescentFlickeringLight[],
    ) {
        let modifiedVertexBuffer = false;
        const sidesOn: DescentSide[] = [];
        const sidesOff: DescentSide[] = [];

        for (const light of lightsOn) {
            const lightSide =
                this.level.segments[light.segmentNum]?.sides[light.sideNum];
            if (lightSide != null) sidesOn.push(lightSide);
            for (const delta of light.deltas) {
                modifiedVertexBuffer = true;
                const segment = this.level.segments[delta.segmentNum];
                const side = segment?.sides[delta.sideNum];
                const target = makeSegmentSideKey(
                    delta.segmentNum,
                    delta.sideNum,
                );
                const vertexOffset = this.segmentSideVertexOffsets.get(target);
                if (side !== undefined && vertexOffset !== undefined) {
                    for (let i = 0; i < 4; ++i)
                        vec3.add(
                            side.uvl[i],
                            side.uvl[i],
                            vec3.fromValues(0, 0, delta.vertexLightDeltas[i]),
                        );
                    modifyVertexBufferLight(
                        this.meshVertices,
                        vertexOffset,
                        1,
                        delta.vertexLightDeltas,
                    );
                    modifiedVertexBuffer = true;
                }
            }
        }

        for (const light of lightsOff) {
            const lightSide =
                this.level.segments[light.segmentNum]?.sides[light.sideNum];
            if (lightSide != null) sidesOff.push(lightSide);
            for (const delta of light.deltas) {
                modifiedVertexBuffer = true;
                const segment = this.level.segments[delta.segmentNum];
                const side = segment?.sides[delta.sideNum];
                const target = makeSegmentSideKey(
                    delta.segmentNum,
                    delta.sideNum,
                );
                const vertexOffset = this.segmentSideVertexOffsets.get(target);
                if (side !== undefined && vertexOffset !== undefined) {
                    for (let i = 0; i < 4; ++i)
                        vec3.sub(
                            side.uvl[i],
                            side.uvl[i],
                            vec3.fromValues(0, 0, delta.vertexLightDeltas[i]),
                        );
                    modifyVertexBufferLight(
                        this.meshVertices,
                        vertexOffset,
                        -1,
                        delta.vertexLightDeltas,
                    );
                    modifiedVertexBuffer = true;
                }
            }
        }

        if (modifiedVertexBuffer) {
            const u8 = new Uint8Array(this.meshVertices.buffer);
            this.device.uploadBufferData(
                this.vertexBuffer,
                0,
                u8,
                0,
                u8.byteLength,
            );
        }

        // Recompute segment light for segments that changed
        for (const side of sidesOn) {
            const sideLight =
                this.assetCache.getTmapLight(side.baseTextureIndex) +
                (side.overlayTextureIndex > 0
                    ? this.assetCache.getTmapLight(side.overlayTextureIndex)
                    : 0);
            if (sideLight > 0) applySegmentLight(side.segment, null, sideLight);
        }
        for (const side of sidesOff) {
            const sideLight =
                this.assetCache.getTmapLight(side.baseTextureIndex) +
                (side.overlayTextureIndex > 0
                    ? this.assetCache.getTmapLight(side.overlayTextureIndex)
                    : 0);
            if (sideLight > 0)
                applySegmentLight(side.segment, null, -sideLight);
        }
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
    ): void {
        const template = renderInstManager.pushTemplate();
        const time = viewerInput.time * 0.001;
        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(DescentMineProgram.bindingLayouts);
        template.setVertexInput(
            this.inputLayout,
            this.vertexBufferDescriptors,
            this.indexBufferDescriptor,
        );
        template.setMegaStateFlags(megaStateFlags);

        let offset = template.allocateUniformBuffer(
            DescentMineProgram.ub_SceneParams,
            32,
        );
        const mappedScene = template.mapUniformBufferF32(
            DescentMineProgram.ub_SceneParams,
        );
        offset += fillMatrix4x4(
            mappedScene,
            offset,
            viewerInput.camera.projectionMatrix,
        );
        offset += fillMatrix4x3(
            mappedScene,
            offset,
            viewerInput.camera.viewMatrix,
        );
        mappedScene[offset++] = this.renderParameters.enableShading ? 0.0 : 1.0;

        for (const call of this.mineMeshCalls) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setDrawCount(call.indexCount, call.indexOffset);
            this.textureMapping[0].gfxTexture = this.textureList.pickTexture(
                call.baseTexture,
                time,
                false,
            );
            this.textureMapping[1].gfxTexture = this.textureList.pickTexture(
                call.overlayTexture,
                time,
                true,
            );

            let offset = renderInst.allocateUniformBuffer(
                DescentMineProgram.ub_TextureParams,
                10,
            );
            const mapped = renderInst.mapUniformBufferF32(
                DescentMineProgram.ub_TextureParams,
            );
            offset += fillMatrix2x2(
                mapped,
                offset,
                getRotationMatrix(call.overlayRotation),
            );

            if (
                call.baseTexture.slide[0] !== 0 ||
                call.baseTexture.slide[1] !== 0
            ) {
                const slideOffset = vec2.create();
                vec2.scale(slideOffset, call.baseTexture.slide, time);
                mapped[offset++] = slideOffset[0] % 1.0;
                mapped[offset++] = slideOffset[1] % 1.0;
            } else {
                mapped[offset++] = 0;
                mapped[offset++] = 0;
            }

            renderInst.setSamplerBindingsFromTextureMappings(
                this.textureMapping,
            );
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
