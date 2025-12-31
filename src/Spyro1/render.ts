import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import { GfxBuffer } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { CombinedAtlas, Spyro1LevelData } from "./bin";

export class Spyro1Program extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_LevelCenter;
};

uniform sampler2D u_Texture;

varying vec3 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;

    vec3 worldPos = a_Position - u_LevelCenter.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    // Use the engine’s sampler macro, just like KH2
    vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = texColor;
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{numUniformBuffers: 1, numSamplers: 1}];

export class Spyro1LevelRenderer {
    private vertexBuffer;
    private colorBuffer;
    private indexBuffer;
    private uvBuffer;
    private indexCount;
    private inputLayout;
    private texture;
    private levelMin;
    private levelMax;
    private levelCenter;

    constructor(device: GfxDevice, levelData: Spyro1LevelData) {
        const atlas = levelData.atlas;
        // debugShowAtlas(atlas);
        this.texture = device.createTexture({
            width: atlas.atlasWidth,
            height: atlas.atlasHeight,
            numLevels: 1,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1
        });
        device.uploadTextureData(this.texture, 0, [atlas.atlasData]);
        const finalUVs: number[] = [];
        for (const face of levelData.faces) {
            if (face.uvIndices) {
                for (const uvIdx of face.uvIndices) {
                    const [u, v] = levelData.uvs[uvIdx];
                    finalUVs.push(u, v);
                }
            } else {
                for (let i = 0; i < face.indices.length; i++) {
                    finalUVs.push(0, 0);
                }
            }
        }

        const { vertices, colors, faces, uvs } = levelData;
        const xs = vertices.map(v => v[0]);
        const ys = vertices.map(v => v[1]);
        const zs = vertices.map(v => v[2]);
        this.levelMin = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
        this.levelMax = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
        this.levelCenter = [
            (this.levelMin[0] + this.levelMax[0]) * 0.5,
            (this.levelMin[1] + this.levelMax[1]) * 0.5,
            (this.levelMin[2] + this.levelMax[2]) * 0.5,
        ];

        // We'll build new, expanded arrays: one vertex per index in faces.
        const expandedPos: number[] = [];
        const expandedCol: number[] = [];
        const expandedUV: number[] = [];
        const expandedIdx: number[] = [];

        let runningIndex = 0;

        for (const face of faces) {
            // if (face.rotation !== 0) {
            //     continue;
            // }
            const { indices, uvIndices } = face;

            for (let k = 0; k < indices.length; k++) {
                const vertIndex = indices[k];

                // Position
                const v = vertices[vertIndex];
                expandedPos.push(v[0], v[1], v[2]);

                // Color — this assumes color index == vertex index; if not, adjust.
                const c = colors[vertIndex] ?? [1, 1, 1];
                expandedCol.push(c[0] / 255, c[1] / 255, c[2] / 255);

                // UV
                if (uvIndices) {
                    const uvIndex = uvIndices[k];
                    const uvVal = uvs[uvIndex];
                    expandedUV.push(uvVal[0], uvVal[1]);
                } else {
                    expandedUV.push(0, 0);
                }

                // Index (sequential)
                expandedIdx.push(runningIndex++);
            }
        }

        const pos = new Float32Array(expandedPos);
        const col = new Float32Array(expandedCol);
        const uv  = new Float32Array(expandedUV);
        const idx = new Uint32Array(expandedIdx);

        this.vertexBuffer = this.createStaticBuffer(device, GfxBufferUsage.Vertex, pos);
        this.colorBuffer = this.createStaticBuffer(device, GfxBufferUsage.Vertex, col);
        this.indexBuffer = this.createStaticBuffer(device, GfxBufferUsage.Index, idx);
        this.uvBuffer = this.createStaticBuffer(device, GfxBufferUsage.Vertex, uv);
        this.indexCount = idx.length;
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG,  bufferByteOffset: 0 },  // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // color
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex }, // uv
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });
    }

    createStaticBuffer(device: GfxDevice, usage: GfxBufferUsage, data: ArrayBufferView): GfxBuffer {
        const buffer = device.createBuffer(data.byteLength, usage, GfxBufferFrequencyHint.Static);
        device.uploadBufferData(buffer, 0, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        return buffer;
    }

    prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        const program = renderHelper.renderCache.createProgram(new Spyro1Program());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);
        template.setSamplerBindingsFromTextureMappings([
            {
                gfxTexture: this.texture,
                gfxSampler: renderHelper.renderCache.createSampler({
                    minFilter: GfxTexFilterMode.Point,
                    magFilter: GfxTexFilterMode.Point,
                    mipFilter: GfxMipFilterMode.Nearest,
                    wrapS: GfxWrapMode.Clamp,
                    wrapT: GfxWrapMode.Clamp,
                }),
                lateBinding: null,
            }
        ]);

        let offs = template.allocateUniformBuffer(Spyro1Program.ub_SceneParams, 20);
        const buf = template.mapUniformBufferF32(Spyro1Program.ub_SceneParams);
        offs += fillMatrix4x4(buf, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(buf, offs, this.levelCenter[0], this.levelCenter[1], this.levelCenter[2], 0);

        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 },
        );
        // template.setPrimitiveTopology(GfxPrimitiveTopology.Triangles);
        // const megaState = makeMegaState({
        //     cullMode: GfxCullMode.Back,
        //     depthCompare: GfxCompareMode.LessEqual,
        //     depthWrite: true,
        // }, defaultMegaState);
        // template.setMegaStateFlags(megaState);
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.indexCount);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

function debugShowAtlas(atlas: CombinedAtlas) {
    const canvas = document.createElement('canvas');
    canvas.width = atlas.atlasWidth;
    canvas.height = atlas.atlasHeight;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(atlas.atlasWidth, atlas.atlasHeight);
    imageData.data.set(atlas.atlasData);
    ctx.putImageData(imageData, 0, 0);
}


