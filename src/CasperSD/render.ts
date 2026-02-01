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

#ifdef VERT
layout(location = 0) in vec3 a_Position;

void main() {
    vec4 worldPos = vec4(a_Position, 1.0);
    v_Position = worldPos.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * worldPos;
}
#endif

#ifdef FRAG
void main() {
    vec3 normal = normalize(cross(dFdx(v_Position), dFdy(v_Position)));
    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
    float dotProduct = dot(normal, lightDir);
    // float diffuse = clamp(dotProduct * 0.5 + 0.5, 0.2, 1.0);
    // vec3 baseColor = vec3(0.7, 0.7, 0.7);
    // gl_FragColor = vec4(baseColor * diffuse, 1.0);
    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
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
    private indexCount: number;
    private inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, world: WorldData) {
        const device = cache.device;
        const { vertices, indices } = this.buildBuffers(world);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.indexCount = indices.length;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 } // a_Position
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex } // pos
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
                { buffer: this.vertexBuffer, byteOffset: 0 }
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
    }

    private buildBuffers(world: WorldData): { vertices: Float32Array, indices: Uint32Array } {
        let vOffset = 0;
        const vertices: number[] = []
        const indices: number[] = []
        const traverse = (node: WorldSector) => {
            if (node.mesh && node.mesh.vertCount > 0 && node.mesh.positions.length > 0) {
                const p = node.mesh.positions;
                for (let i = 0; i < p.length; i++) {
                    vertices.push(p[i] * WORLD_SCALE);
                }
                const idx = node.mesh.indices;
                for (let i = 0; i < idx.length; i++) {
                    indices.push(idx[i] + vOffset); 
                }
                vOffset += node.mesh.vertCount;
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        };
        traverse(world.rootSector);
        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
    }
}
