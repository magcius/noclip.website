import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxBuffer } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";

export class Spyro1Program extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_LevelCenter;
};

varying vec3 v_Color;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

void main() {
    v_Color = a_Color;
    vec3 worldPos = a_Position - u_LevelCenter.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{numUniformBuffers: 1, numSamplers: 0}];

export type Spyro1LevelData = {
  vertices: number[][];
  colors: number[][];
  faces: {
    indices: number[];
    texture: number | null;
    rotation: number | null;
  }[];
  uvs: number[][] | null;
};

export class Spyro1LevelRenderer {
    private vertexBuffer;
    private colorBuffer;
    private indexBuffer;
    private indexCount;
    private inputLayout;
    private levelMin;
    private levelMax;
    private levelCenter;

    constructor(device: GfxDevice, levelData: Spyro1LevelData) {
        const { vertices, colors, faces } = levelData;
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
        const pos = new Float32Array(vertices.flat());
        const col = new Float32Array(colors.flat().map(c => c / 255));
        const idx = new Uint32Array(faces.flatMap(f => f.indices));
        this.vertexBuffer = this.createStaticBuffer(device, GfxBufferUsage.Vertex, pos);
        this.colorBuffer = this.createStaticBuffer(device, GfxBufferUsage.Vertex, col);
        this.indexBuffer = this.createStaticBuffer(device, GfxBufferUsage.Index, idx);
        this.indexCount = idx.length;
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Color
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // positions
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // colors
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
        // template.setSamplerBindingsFromTextureMappings([
        //     {
        //         gfxTexture: this.texture,
        //         gfxSampler: renderHelper.renderCache.createSampler({
        //             minFilter: GfxTexFilterMode.Point,
        //             magFilter: GfxTexFilterMode.Point,
        //             mipFilter: GfxMipFilterMode.Nearest,
        //             wrapS: GfxWrapMode.Clamp,
        //             wrapT: GfxWrapMode.Clamp,
        //         }),
        //         lateBinding: null,
        //     }
        // ]);

        let offs = template.allocateUniformBuffer(Spyro1Program.ub_SceneParams, 20);
        const buf = template.mapUniformBufferF32(Spyro1Program.ub_SceneParams);
        offs += fillMatrix4x4(buf, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(buf, offs, this.levelCenter[0], this.levelCenter[1], this.levelCenter[2], 0);

        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
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
