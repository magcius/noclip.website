import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSampler, GfxTexture, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { SkyShell } from "./bin-core";
import { mat4, vec3 } from "gl-matrix";
import { noclipSpaceFromRatchetSpace } from "./utils";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";

export class SkyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_ST = 1;
    public static a_Rgba = 2;
    public static a_Alpha = 3;

    public static elementsPerVertex = 9; // position(3) + st(2) + rgba(4) = 9

    public static ub_SceneParams = 0;
    public static ub_SkyParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_SkyParams {
    Mat4x4 u_SkyTransform;
    vec4 u_ExtraData; // x = isTextured, yzw = padding
};

layout(location = 0) uniform sampler2D u_Texture;
`;

    public override vert = `
layout(location = ${SkyProgram.a_Position}) in vec3 a_Position;
layout(location = ${SkyProgram.a_ST}) in vec2 a_ST;
layout(location = ${SkyProgram.a_Rgba}) in vec4 a_Rgba;

out vec3 v_WorldPos;
out vec2 v_ST;
out vec4 v_Rgba;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_SkyTransform) * vec4(a_Position.xyz, 1.0f);
    gl_Position = (UnpackMatrix(u_ClipFromWorld) * t_PositionWorld);

    v_WorldPos = t_PositionWorld.xyz;
    v_ST = a_ST;
    v_Rgba = a_Rgba;
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
in vec3 v_WorldPos;
in vec2 v_ST;
in vec4 v_Rgba;

void main() {
    // discard the hemisphere behind the camera (needed for ortho view since no backface culling)
    if (dot(u_CameraData.direction.xyz, v_WorldPos - u_CameraData.position.xyz) > 0.0) discard;

    float isTextured = u_ExtraData.x;
    if (isTextured == 1.0) {
        if (u_RenderSettings.x == 0.0) discard;
        gl_FragColor = commonFragmentShader(v_Rgba, texture(SAMPLER_2D(u_Texture), v_ST), 0.0);
    } else {
        if (u_RenderSettings.x == 0.0) { gl_FragColor = v_Rgba; return; }
        gl_FragColor = commonFragmentShader(v_Rgba, vec4(1.0, 1.0, 1.0, 1.0), 0.0);
    }
}
`;

}

type SkyDraw = { material: number, flags: { textured: boolean }, indexCount: number, startIndex: number };

export class SkyGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private draws: { material: number, flags: { textured: boolean }, indexCount: number, startIndex: number }[] = [];

    constructor(private cache: GfxRenderCache, public index: number, private skyShell: SkyShell) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: SkyProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: SkyProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: SkyProgram.a_Rgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: SkyProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
            ],
            indexBufferFormat: GfxFormat.U16_R,
        });
    }

    public getOrCreateVertexBuffer() {
        if (!this.vertexBuffer) {
            const vertexData = this.assemble();
            const device = this.cache.device;
            this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
            device.setResourceName(this.vertexBuffer, `Sky (VB)`);
            this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, vertexData.indexArrayBuffer.buffer);
            device.setResourceName(this.indexBuffer, `Sky (IB)`);
            this.draws = vertexData.draws;
        }
        return {
            vertexBuffer: this.vertexBuffer,
            indexBuffer: this.indexBuffer,
            draws: this.draws,
        }
    }

    private assemble() {
        const skyShell = this.skyShell;

        const positionScale = 1 / 1024;
        const texcoordScale = 1 / 4096;

        let clusterBaseVerts: number[] = [];
        let vertexCount = 0;
        let triangleCount = 0;

        const clusters = skyShell.clusters;
        for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
            const cluster = clusters[clusterIndex];
            clusterBaseVerts.push(vertexCount);
            vertexCount += cluster.vertices.length;
            triangleCount += cluster.triangles.length;
        }

        const vertexArrayBuffer = new Float32Array(vertexCount * SkyProgram.elementsPerVertex);
        let vertexPtr = 0;
        const indexArrayBuffer = new Uint16Array(triangleCount * 3);
        let indexPtr = 0;
        const draws: SkyDraw[] = [];

        for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
            const cluster = clusters[clusterIndex];
            const baseVert = clusterBaseVerts[clusterIndex];

            for (let vertIndex = 0; vertIndex < cluster.vertices.length; vertIndex++) {
                const vert = cluster.vertices[vertIndex];
                const st = cluster.texcoords[vertIndex];
                const rgba = cluster.rgbas[vertIndex];
                if (skyShell.header.flags.textured) {
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.x;
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.y;
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.z;
                    vertexArrayBuffer[vertexPtr++] = texcoordScale * st.s;
                    vertexArrayBuffer[vertexPtr++] = texcoordScale * st.t;
                    vertexArrayBuffer[vertexPtr++] = 1;
                    vertexArrayBuffer[vertexPtr++] = 1;
                    vertexArrayBuffer[vertexPtr++] = 1;
                    vertexArrayBuffer[vertexPtr++] = vert.alpha / 0x80;
                } else {
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.x;
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.y;
                    vertexArrayBuffer[vertexPtr++] = positionScale * vert.z;
                    vertexArrayBuffer[vertexPtr++] = 0;
                    vertexArrayBuffer[vertexPtr++] = 0;
                    vertexArrayBuffer[vertexPtr++] = rgba.r / 0xFF;
                    vertexArrayBuffer[vertexPtr++] = rgba.g / 0xFF;
                    vertexArrayBuffer[vertexPtr++] = rgba.b / 0xFF;
                    vertexArrayBuffer[vertexPtr++] = (vert.alpha / 0x80) * (rgba.a / 0x80);
                }
            }

            for (let triIndex = 0; triIndex < cluster.triangles.length; triIndex++) {
                const triangle = cluster.triangles[triIndex];
                draws.push({
                    material: triangle.texture,
                    flags: skyShell.header.flags,
                    indexCount: 3,
                    startIndex: indexPtr,
                });
                indexArrayBuffer[indexPtr++] = baseVert + triangle.indices[0];
                indexArrayBuffer[indexPtr++] = baseVert + triangle.indices[1];
                indexArrayBuffer[indexPtr++] = baseVert + triangle.indices[2];
            }
        }

        // merge adjacent draws with the same material
        for (let i = 0; i < draws.length - 1; i++) {
            const d0 = draws[i]!;
            const d1 = draws[i + 1]!;
            if (d0.material === d1.material) {
                d1.indexCount += d0.indexCount;
                d1.startIndex = d0.startIndex;
                d0.indexCount = 0;
            }
        }

        return {
            vertexArrayBuffer,
            indexArrayBuffer,
            draws: draws.filter(draw => draw.indexCount > 0),
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.vertexBuffer) {
            device.destroyBuffer(this.vertexBuffer);
        }
        if (this.indexBuffer) {
            device.destroyBuffer(this.indexBuffer);
        }
    }
}

const scratchMat4 = mat4.create();

const bindingLayouts = [
    { numSamplers: 1, numUniformBuffers: 2 },
];

const megaStateFlags = {
    cullMode: GfxCullMode.None,
    depthWrite: false,
    depthCompare: GfxCompareMode.Always,
    attachmentsState: [{
        channelWriteMask: GfxChannelWriteMask.AllChannels,
        rgbBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        },
        alphaBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        },
    }],
};

export class SkyRenderer {
    private skyProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.skyProgram = renderHelper.renderCache.createProgram(new SkyProgram());
    }

    renderSky(renderInstList: GfxRenderInstList, cameraPosition: vec3, time: number, skyShellGeometry: SkyGeometry, skyShellTextures: GfxTexture[], skySampler: GfxSampler, isOrtho: boolean): void {
        const objectMatrix = mat4.identity(scratchMat4);
        mat4.translate(objectMatrix, objectMatrix, cameraPosition);
        if (isOrtho) {
            const scale = 20;
            mat4.scale(objectMatrix, objectMatrix, [scale, scale, scale]);
        }
        mat4.multiply(objectMatrix, objectMatrix, noclipSpaceFromRatchetSpace);

        // can't find data for sky shell rotation speed
        // if (...) {
        //     mat4.rotateZ(objectMatrix, objectMatrix, time / ...);
        // }

        const template1 = this.renderHelper.pushTemplateRenderInst();
        template1.setGfxProgram(this.skyProgram);
        template1.setBindingLayouts(bindingLayouts);
        template1.setMegaStateFlags(megaStateFlags);

        const vertexData = skyShellGeometry.getOrCreateVertexBuffer();
        const { draws, vertexBuffer, indexBuffer } = vertexData;

        for (const draw of draws) {
            const renderInst = this.renderHelper.renderInstManager.newRenderInst();

            const skyParams = renderInst.allocateUniformBufferF32(SkyProgram.ub_SkyParams, 20);
            let offs = 0;
            offs += fillMatrix4x4(skyParams, offs, objectMatrix);
            offs += fillVec4(skyParams, offs, Number(draw.flags.textured), 0, 0, 0);

            renderInst.setVertexInput(
                skyShellGeometry.inputLayout,
                [{ buffer: vertexBuffer, byteOffset: 0 }],
                { buffer: indexBuffer, byteOffset: 0 },
            );
            if (draw.flags.textured) {
                renderInst.setSamplerBindingsFromTextureMappings([
                    { gfxTexture: skyShellTextures[draw.material], gfxSampler: skySampler }
                ]);
            }
            renderInst.setDrawCount(draw.indexCount, draw.startIndex);
            renderInstList.submitRenderInst(renderInst);
        }

        this.renderHelper.renderInstManager.popTemplate();
    }
}
