import { vec2 } from "gl-matrix";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { fillMatrix4x4 } from "../../gfx/helpers/UniformBufferHelpers.js";
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
import {
    DescentObject,
    DescentObjectRenderTypeVClip,
    DescentRenderType,
} from "../Common/LevelObject.js";
import {
    DescentTextureList,
    ResolvedTexture,
    VclipTexture,
} from "../Common/TextureList.js";
import { MultiMap } from "../Common/Util.js";
import { Descent1Level } from "../D1/D1Level.js";
import { Descent2Level } from "../D2/D2Level.js";
import { DescentRenderParameters } from "./RenderParameters.js";

class DescentBillboardProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 1, numSamplers: 1 },
    ];

    public static a_xyz = 0;
    public static a_uvl = 1;
    public static a_sxsy = 2;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
precision highp float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_matProjection;
    Mat4x4 u_matView;
    float u_minLight;
};

layout(binding = 0) uniform sampler2D u_sampler;
`;

    public override vert = `
layout (location = ${DescentBillboardProgram.a_xyz}) in vec3 a_xyz;
layout (location = ${DescentBillboardProgram.a_uvl}) in vec3 a_uvl;
layout (location = ${DescentBillboardProgram.a_sxsy}) in vec2 a_sxsy;

out vec3 v_uvl;

void main() {
    vec4 t_xyz = UnpackMatrix(u_matView) * vec4(a_xyz, 1.0);
    t_xyz.xy += a_sxsy.xy * (a_uvl.xy - 0.5);
    gl_Position = UnpackMatrix(u_matProjection) * t_xyz;
    v_uvl = vec3(a_uvl.x, -a_uvl.y, a_uvl.z);
}
`;

    public override frag = `
in vec3 v_uvl;

void main() {
    vec4 t_color = texture(SAMPLER_2D(u_sampler), v_uvl.xy).rgba;
    if (t_color.a < 0.5) discard;
    gl_FragColor = t_color * clamp(v_uvl.z, u_minLight, 1.0);
}
`;

    constructor() {
        super();
    }
}

type BillboardCall = {
    indexOffset: number;
    indexCount: number;
    texture: ResolvedTexture;
};

type BillboardCollection = {
    vertices: Float32Array;
    indices: Uint16Array;
    calls: BillboardCall[];
};

const BILLBOARD_UV: [number, number][] = [
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
    [0.0, 1.0],
];

const SCALE_FACTOR = 2;
function buildBillboard(
    bufVertex: number[][],
    bufIndex: number[],
    level: Descent1Level | Descent2Level,
    object: DescentObject,
    texture: VclipTexture,
) {
    const segmentLight = level.segments[object.segmentNum].light ?? 1.0;
    const light = segmentLight + texture.vclip.lightValue;

    const indexBase = bufVertex.length;
    const scale = vec2.fromValues(
        object.size * SCALE_FACTOR,
        (object.size * SCALE_FACTOR) / texture.aspectRatio,
    );

    for (let i = 0; i < 4; ++i)
        bufVertex.push([
            object.position[0],
            object.position[1],
            -object.position[2],
            ...BILLBOARD_UV[i],
            light,
            ...scale,
        ]);

    bufIndex.push(indexBase + 0);
    bufIndex.push(indexBase + 1);
    bufIndex.push(indexBase + 2);
    bufIndex.push(indexBase + 2);
    bufIndex.push(indexBase + 3);
    bufIndex.push(indexBase + 0);
}

function getObjectVclipRenderer(
    object: DescentObject,
): DescentObjectRenderTypeVClip | null {
    const render = object.renderType;
    switch (render.type) {
        case DescentRenderType.POWERUP:
            return render;
        // Ignore FIREBALL, HOSTAGE and WEAPONVCLIP on purpose, even though they are also rendered as VClips.
    }
    return null;
}

function buildBillboardCollection(
    level: Descent1Level | Descent2Level,
    textureList: DescentTextureList,
    assetCache: DescentAssetCache,
): BillboardCollection {
    // First, group objects to render by texture.
    const objectsGrouped = new MultiMap<number, DescentObject>();
    for (const object of level.objects) {
        let render = getObjectVclipRenderer(object);
        if (level.objectShouldBeVisible(object) && render !== null) {
            objectsGrouped.add(render.vclip_num, object);
        }
    }

    // Then, load in textures as needed.
    const vertices: number[][] = [];
    const indices: number[] = [];
    const calls: BillboardCall[] = [];

    for (const [vclipId, objects] of objectsGrouped.entries()) {
        const texture = textureList.resolveVclipToTexture(vclipId);
        if (texture === null) continue;

        const indexOffset = indices.length;
        for (const object of objects)
            buildBillboard(vertices, indices, level, object, texture);

        const indexCount = indices.length - indexOffset;
        const call: BillboardCall = { indexOffset, indexCount, texture };
        calls.push(call);
    }

    return {
        vertices: new Float32Array(vertices.flat()),
        indices: new Uint16Array(indices),
        calls,
    };
}

const megaStateFlags: Partial<GfxMegaStateDescriptor> = {
    cullMode: GfxCullMode.Back,
    frontFace: GfxFrontFaceMode.CCW,
};

export class DescentPowerupRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private inputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private billboardCalls: BillboardCall[];
    private gfxSampler: GfxSampler;
    private textureMapping: TextureMapping[];
    public billboards: BillboardCollection;

    constructor(
        device: GfxDevice,
        private level: Descent1Level | Descent2Level,
        private assetCache: DescentAssetCache,
        private textureList: DescentTextureList,
        private cache: GfxRenderCache,
        private renderParameters: DescentRenderParameters,
    ) {
        this.gfxProgram = cache.createProgram(new DescentBillboardProgram());

        this.billboards = buildBillboardCollection(
            level,
            this.textureList,
            assetCache,
        );
        const { vertices, indices, calls } = this.billboards;
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
        this.billboardCalls = calls;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: DescentBillboardProgram.a_xyz,
                bufferIndex: 0,
                bufferByteOffset: 0 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentBillboardProgram.a_uvl,
                bufferIndex: 0,
                bufferByteOffset: 3 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentBillboardProgram.a_sxsy,
                bufferIndex: 0,
                bufferByteOffset: 6 * 0x04,
                format: GfxFormat.F32_RG,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {
                byteStride: 8 * 0x04,
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
        this.textureMapping = [new TextureMapping()];
        this.textureMapping[0].gfxSampler = this.gfxSampler;
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
    ): void {
        const template = renderInstManager.pushTemplate();
        const time = viewerInput.time * 0.001;
        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(DescentBillboardProgram.bindingLayouts);
        template.setVertexInput(
            this.inputLayout,
            this.vertexBufferDescriptors,
            this.indexBufferDescriptor,
        );
        template.setMegaStateFlags(megaStateFlags);

        let offset = template.allocateUniformBuffer(
            DescentBillboardProgram.ub_SceneParams,
            36,
        );
        const mappedScene = template.mapUniformBufferF32(
            DescentBillboardProgram.ub_SceneParams,
        );
        offset += fillMatrix4x4(
            mappedScene,
            offset,
            viewerInput.camera.projectionMatrix,
        );
        offset += fillMatrix4x4(
            mappedScene,
            offset,
            viewerInput.camera.viewMatrix,
        );
        mappedScene[offset++] = this.renderParameters.enableShading ? 0.0 : 1.0;

        for (const call of this.billboardCalls) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setDrawCount(call.indexCount, call.indexOffset);
            this.textureMapping[0].gfxTexture = this.textureList.pickTexture(
                call.texture,
                time,
            );
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
