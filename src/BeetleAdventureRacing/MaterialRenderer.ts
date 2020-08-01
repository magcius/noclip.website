import { mat4 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { UVTX } from "./ParsedFiles/UVTX";
import { F3DEX_Program } from "../BanjoKazooie/render";

import * as RDP from '../Common/N64/RDP';

export class TempTestingProgram extends DeviceProgram {
    public static inPosition = 0;
    public static inTexCoord = 1;
    public static inColor = 2;

    public static ub_ModelToWorld = 0;
    public static ub_WorldToNDC = 1;

    //TODO-ASK: why do i need to use an interface?
    //TODO: fix: yzx and * 1000.0?
    public vert = `
layout(location = ${TempTestingProgram.inPosition}) in vec3 inPosition;
layout(location = ${TempTestingProgram.inTexCoord}) in vec2 inTexCoord;
layout(location = ${TempTestingProgram.inColor}) in vec4 inColor;

layout(row_major, std140) uniform ub_ModelToWorld {
    Mat4x4 u_ModelToWorld;
};

layout(row_major, std140) uniform ub_WorldToNDC {
    Mat4x4 u_WorldToNDC;
};

out vec4 color;
out vec2 texCoord;

void main() {
    vec4 worldPos = Mul(u_ModelToWorld, vec4(inPosition, 1.0));
    //TODO: better solution for this
    worldPos = worldPos.yzxw;
    worldPos = worldPos * vec4(100.0, 100.0, 100.0, 1.0);
    gl_Position = Mul(u_WorldToNDC, worldPos);
    color = inColor;
    texCoord = inTexCoord;
}
    `;

    public frag = `
in vec4 color;
in vec2 texCoord;

uniform sampler2D u_Texture;

void main() {
#ifdef TEXTURED
    gl_FragColor = vec4((color * texture(u_Texture, texCoord)).xyz, 1.0);
#else
    gl_FragColor = color;
#endif
}
    `;
}

export interface Material {
    uvtx: UVTX | null;
    // XYZ ST RGBA
    vertexData: Float32Array;
    indexData: Uint16Array;
}

export class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    private hasTextureData: boolean;
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;

    private program: DeviceProgram;

    private indexCount: number;

    
    constructor(device: GfxDevice, material: Material) {
        //const program = new F3DEX_Program(0 /* TODO */, 0 /* TODO */, x); //TODO: blendalpha? tiles?
        // program.defines.set("BONE_MATRIX_COUNT", '1');
        // program.setDefineBool("USE_VERTEX_COLOR", true);
        // program.setDefineBool("USE_TEXTURE", material.uvtx !== null);
        // program.setDefineBool("ONLY_VERTEX_COLOR", material.uvtx === null);








        let vertexDataCopy = Float32Array.from(material.vertexData);
        if (material.uvtx !== null) {
            for (let q = 0; q < vertexDataCopy.byteLength / 9; q++) {
                let origS = vertexDataCopy[q * 9 + 3];
                let origT = vertexDataCopy[q * 9 + 4];
                let tile = material.uvtx.rspState.primitiveTile;
                let oglS = (origS - tile.uls) / (tile.lrs - tile.uls);
                let oglT = (origT - tile.ult) / (tile.lrt - tile.ult);
                vertexDataCopy[q * 9 + 3] = oglS;
                vertexDataCopy[q * 9 + 4] = oglT;
                console.warn("REMOVEME!!!");
            }
        }

        this.program = new TempTestingProgram();
        this.indexCount = material.indexData.length;

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexDataCopy.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, material.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TempTestingProgram.inPosition, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: TempTestingProgram.inTexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 0x04, },
            { location: TempTestingProgram.inColor, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 9 * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0 });



        this.hasTextureData = false;
        if (material.uvtx !== null && !material.uvtx.not_supported_yet) {
            this.hasTextureData = true;
            const uvtx = material.uvtx;
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, uvtx.imageWidth, uvtx.imageHeight, 1));
            //device.setResourceName(this.gfxTexture, texture.name);
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(this.gfxTexture, 0, [uvtx.convertedTexelData]);
            device.submitPass(hostAccessPass);

            // TODO: actually implement
            this.gfxSampler = device.createSampler({
                wrapS: GfxWrapMode.REPEAT,
                wrapT: GfxWrapMode.REPEAT,
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0, maxLOD: 0,
            });
        }
        this.program.setDefineBool("TEXTURED", this.hasTextureData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {        
        const renderInst = renderInstManager.newRenderInst();

        // Build model->NDC matrix
        let worldToNDCMatrix = mat4.create();
        mat4.mul(worldToNDCMatrix, viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix);

        // Allocate memory and fill matrix
        // TODO-ASK: what exactly is happening here? 
        let offs1 = renderInst.allocateUniformBuffer(TempTestingProgram.ub_ModelToWorld, 16);
        const d1 = renderInst.mapUniformBufferF32(TempTestingProgram.ub_ModelToWorld);
        offs1 += fillMatrix4x4(d1, offs1, modelToWorldMatrix);

        let offs2 = renderInst.allocateUniformBuffer(TempTestingProgram.ub_WorldToNDC, 16);
        const d2 = renderInst.mapUniformBufferF32(TempTestingProgram.ub_WorldToNDC);
        offs2 += fillMatrix4x4(d2, offs2, worldToNDCMatrix);

        // Load mesh data
        if (this.hasTextureData) {
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null }]);
        }
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        let gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.drawIndexes(this.indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyTexture(this.gfxTexture);
        device.destroySampler(this.gfxSampler);
    }
}
