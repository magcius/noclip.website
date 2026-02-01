import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { WorldData, WorldSector } from "./bin";

class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
};

varying vec3 v_Position;
varying vec3 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;
    vec4 worldPos = vec4(a_Position, 1.0);
    v_Position = worldPos.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * worldPos;
}
#endif

#ifdef FRAG
void main() {
    // vec3 normal = normalize(cross(dFdx(v_Position), dFdy(v_Position)));
    // vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
    // float dotProduct = dot(normal, lightDir);
    // // float diffuse = clamp(dotProduct * 0.5 + 0.5, 0.2, 1.0);
    // // vec3 baseColor = vec3(0.7, 0.7, 0.7);
    // // gl_FragColor = vec4(baseColor * diffuse, 1.0);
    // gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
    // float c = (fract(v_TexCoord.x) + fract(v_TexCoord.y)) * 0.5;
    // gl_FragColor = vec4(c, c, c, 1.0);
    // vec2 grid = floor(v_TexCoord * 3.0);
    // float checker = mod(grid.x + grid.y, 2.0);
    // vec3 color = checker > 0.5 ? vec3(1.0) : vec3(0.0);
    // gl_FragColor = vec4(color, 1.0);
    gl_FragColor = vec4(v_Color, 1.0);
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
const WORLD_SCALE = 300;

export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private indexCount: number;
    private inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, world: WorldData) {
        const device = cache.device;
        const { vertices, indices, uvs, colors } = this.buildBuffers(world);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer);
        this.indexCount = indices.length;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 } // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos (x, y, z)
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // color (x: r, y: g, z: b)
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex } // uv (x: u, y: v)
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        const program = renderHelper.renderCache.createProgram(new LevelProgram());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offs = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 16);
        const buf = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        offs += fillMatrix4x4(buf, offs, viewerInput.camera.clipFromWorldMatrix);
        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 }
        );
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.indexCount);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
    }

    private buildBuffers(world: WorldData): { vertices: Float32Array, indices: Uint32Array, colors: Float32Array, uvs: Float32Array } {
        let vOffset = 0;
        const vertices: number[] = [];
        const indices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const traverse = (node: WorldSector) => {
            if (node.mesh && node.mesh.vertexCount > 0 && node.mesh.positions.length > 0 && node.mesh.uvs.length > 0) {
                const pos = node.mesh.positions;
                for (let i = 0; i < pos.length; i++) {
                    vertices.push(pos[i] * WORLD_SCALE);
                }
                const idx = node.mesh.indices;
                for (let i = 0; i < idx.length; i++) {
                    indices.push(idx[i] + vOffset); 
                }
                vOffset += node.mesh.vertexCount;
                for (const c of node.mesh.colors) {
                    colors.push(c / 255);
                }
                uvs.push(...node.mesh.uvs);
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        };
        traverse(world.rootSector);
        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs) };
    }
}
