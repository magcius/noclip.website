import { mat4, vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { Collision, CollisionOctant, HeroCollisionGroups, HeroCollisionGroupsHeader } from "./bin-core";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { noclipSpaceFromRatchetSpace } from "./utils";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";

const collisionTypeMap = Object.fromEntries([
    [0b0000, vec3.fromValues(0.3, 0.3, 0.9)], // 0 water
    [0b0001, vec3.fromValues(0.9, 0.1, 0.1)], // 1 take damage, bounce (hot objects, lava, goo)
    [0b0010, vec3.fromValues(0.9, 0.9, 0.2)], // 2 mag boots
    [0b0011, vec3.fromValues(0.6, 0.5, 0.3)], // 3 drown (mud)
    [0b0100, vec3.fromValues(0.1, 0.4, 0.1)], // 4 slippy slide
    [0b0101, vec3.fromValues(0.9, 0.6, 0.3)], // 5 hoverbike or grindrail jump
    [0b0110, vec3.fromValues(0.4, 0.7, 0.4)], // 6 unused
    [0b0111, vec3.fromValues(0.7, 0.9, 1.0)], // 7 ice
    [0b1000, vec3.fromValues(0.2, 0.2, 0.3)], // 8 out of bounds, can wall-jump
    [0b1001, vec3.fromValues(0.8, 0.5, 0.5)], // 9 cannot mantle
    [0b1010, vec3.fromValues(0.8, 0.6, 0.9)], // 10 cannot wall-jump
    [0b1011, vec3.fromValues(0.4, 0.3, 0.3)], // 11 drown (mud again)
    [0b1100, vec3.fromValues(0.2, 0.2, 0.2)], // 12 out of bounds, cannot wall-jump
    [0b1101, vec3.fromValues(0.3, 0.9, 0.6)], // 13 drown (ocean)
    [0b1110, vec3.fromValues(0.3, 0.3, 0.9)], // 14 unswimmable shallow water
    [0b1111, vec3.fromValues(1.0, 1.0, 1.0)], // 15 normal terrain
]);

const collisionColorLutCode = `
const vec3 colors[16] = vec3[16](
    ${[...Array(16)].map((_, i) => {
    const color = collisionTypeMap[i] || vec3.fromValues(1.0, 0.0, 1.0);
    return `vec3(${color[0]}, ${color[1]}, ${color[2]})`;
}).join(',\n')}
);
`

export class CollisionProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_CollisionType = 1;

    public static elementsPerVertex = 4; // position(3) + type(1) = 4

    public static ub_SceneParams = 0;
    public static ub_CollisionParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_CollisionParams {
    Mat4x4 u_CollisionTransform;
};
`;

    public override vert = `
layout(location = ${CollisionProgram.a_Position}) in vec3 a_Position;
layout(location = ${CollisionProgram.a_CollisionType}) in float a_CollisionType;

out vec3 v_Rgb;
out vec3 v_PositionWorld;

${collisionColorLutCode}

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_CollisionTransform) * vec4(a_Position, 1.0f);
    gl_Position = (UnpackMatrix(u_ClipFromWorld) * t_PositionWorld);

    if (a_CollisionType == -1.0) {
        v_Rgb = vec3(0.5, 1.0, 0.5); // ratchet-only collision
    } else {
        v_Rgb = colors[int(a_CollisionType)];
    }
    v_PositionWorld = t_PositionWorld.xyz;
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
in vec3 v_Rgb;
in vec3 v_PositionWorld;

void main() {
    vec3 tangentX = dFdx(v_PositionWorld);
    vec3 tangentY = dFdy(v_PositionWorld);
    vec3 faceNormal = normalize(cross(tangentX, tangentY));
    float light = 0.3
        + 0.4 * max(dot(faceNormal, u_DirectionLights[0].directionA.xyz), 0.0)
        + 0.4 * max(dot(faceNormal, u_DirectionLights[0].directionB.xyz), 0.0);

    gl_FragColor = vec4(v_Rgb * light, 1.0);
}
`;

}

export class CollisionGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer;
    private vertexCount: number;

    constructor(private cache: GfxRenderCache, private collision: Collision) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: CollisionProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: CollisionProgram.a_CollisionType, format: GfxFormat.F32_R, bufferByteOffset: 3 * 4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: CollisionProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
            ],
            indexBufferFormat: null,
        });
    }

    public getOrCreateVertexBuffer() {
        if (!this.vertexBuffer) {
            const assembled = this.assemble(this.collision.meshGrid, this.collision.heroGroups);
            const device = this.cache.device;
            this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexArrayBuffer.buffer);
            device.setResourceName(this.vertexBuffer, `Collision (VB)`);
            this.vertexCount = assembled.vertexCount;
        }
        return {
            vertexBuffer: this.vertexBuffer,
            vertexCount: this.vertexCount,
        };
    }

    private assemble(collisionOctants: CollisionOctant[], heroCollisionGroups: HeroCollisionGroups) {
        const heroCollisionPositionScale = 1 / 64;

        let vertexCount = 0;

        for (let i = 0; i < collisionOctants.length; i++) {
            const octant = collisionOctants[i];
            for (let j = 0; j < octant.faces.length; j++) {
                vertexCount += octant.faces[j].quad ? 6 : 3;
            }
        }
        for (let i = 0; i < heroCollisionGroups.groupData.length; i++) {
            const group = heroCollisionGroups.groupData[i];
            vertexCount += group.faces.length * 3;
        }

        const vertexArrayBuffer = new Float32Array(vertexCount * CollisionProgram.elementsPerVertex);
        let vertexPtr = 0;

        for (let i = 0; i < collisionOctants.length; i++) {
            const octant = collisionOctants[i];
            for (let j = 0; j < octant.faces.length; j++) {
                const face = octant.faces[j];
                const type = face.type;
                const verts = [face.v0, face.v1, face.v2];
                if (face.quad) verts.push(face.v0, face.v3!, face.v2);

                for (let k = 0; k < verts.length; k++) {
                    const vert = octant.verts[verts[k]];
                    const { x, y, z } = vert;
                    vertexArrayBuffer[vertexPtr++] = x + octant.pos.x;
                    vertexArrayBuffer[vertexPtr++] = y + octant.pos.y;
                    vertexArrayBuffer[vertexPtr++] = z + octant.pos.z;
                    vertexArrayBuffer[vertexPtr++] = type & 0xF; // only the bottom 4 bits seem important, the rest are related to footsteps or something
                }
            }
        }

        for (let i = 0; i < heroCollisionGroups.groupData.length; i++) {
            const group = heroCollisionGroups.groupData[i];
            for (let j = 0; j < group.faces.length; j++) {
                const face = group.faces[j];
                const verts = [face.v0, face.v1, face.v2];
                for (let k = 0; k < verts.length; k++) {
                    const vert = group.verts[verts[k]];
                    const { x, y, z } = vert;
                    vertexArrayBuffer[vertexPtr++] = heroCollisionPositionScale * x;
                    vertexArrayBuffer[vertexPtr++] = heroCollisionPositionScale * y;
                    vertexArrayBuffer[vertexPtr++] = heroCollisionPositionScale * z;
                    vertexArrayBuffer[vertexPtr++] = -1;
                }
            }
        }

        assert(vertexPtr === vertexArrayBuffer.length);

        return { vertexArrayBuffer, vertexCount };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}

const scratchMat4 = mat4.create();

const bindingLayouts = [
    { numSamplers: 0, numUniformBuffers: 2 },
];

export class CollisionRenderer {
    private collisionProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.collisionProgram = renderHelper.renderCache.createProgram(new CollisionProgram());
    }

    renderCollision(renderInstList: GfxRenderInstList, cameraPosition: vec3, collisionGeometry: CollisionGeometry): void {
        const objectMatrix = mat4.identity(scratchMat4);
        mat4.multiply(objectMatrix, objectMatrix, noclipSpaceFromRatchetSpace);

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.collisionProgram);
        renderInst.setBindingLayouts(bindingLayouts);

        const collisionParams = renderInst.allocateUniformBufferF32(CollisionProgram.ub_CollisionParams, 16);
        let offs = 0;
        offs += fillMatrix4x4(collisionParams, offs, objectMatrix);

        const vertexData = collisionGeometry.getOrCreateVertexBuffer();

        renderInst.setVertexInput(
            collisionGeometry.inputLayout,
            [{ buffer: vertexData.vertexBuffer, byteOffset: 0 }],
            null,
        );
        renderInst.setDrawCount(vertexData.vertexCount, 0);
        renderInstList.submitRenderInst(renderInst);
    }
}
