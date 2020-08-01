import { mat4 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { UVTX } from "./ParsedFiles/UVTX";
import { F3DEX_Program } from "../BanjoKazooie/render";

import * as RDP from '../Common/N64/RDP';

export interface Material {
    uvtx: UVTX | null;
    // XYZ ST RGBA
    vertexData: Float32Array;
    indexData: Uint16Array;
}

//TODO: check this
const enum TexCM {
    WRAP = 0x00,
    MIRROR = 0x01,
    CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
        case TexCM.WRAP: return GfxWrapMode.REPEAT;
        case TexCM.MIRROR: return GfxWrapMode.MIRROR;
        case TexCM.CLAMP: return GfxWrapMode.CLAMP;
    }
}

export class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    private isTextured: boolean;
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;

    private program: DeviceProgram;

    private indexCount: number;

    private uvtx: UVTX;
    
    constructor(device: GfxDevice, material: Material) {

        this.isTextured = material.uvtx !== null && !material.uvtx.not_supported_yet;

        // TODO: what's going on with the textures missing vert colors?
        if(this.isTextured) {
            this.uvtx = material.uvtx!;
            let rspState = this.uvtx.rspState;
            // TODO: actually figure out othermodeL?
            this.program = new F3DEX_Program(rspState.otherModeH, 0, rspState.combineParams);
            this.program.setDefineBool("USE_TEXTURE", true);
            
        } else {
            // TODO: better
            this.program = new F3DEX_Program(0, 0, RDP.decodeCombineParams(0, 0));
            this.program.setDefineBool("ONLY_VERTEX_COLOR", true);
        }
        this.program.defines.set("BONE_MATRIX_COUNT", '1');
        this.program.setDefineBool("USE_VERTEX_COLOR", true);

        this.indexCount = material.indexData.length;

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, material.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, material.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 0x04, },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 0x04, },
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

        if (this.isTextured) {
            let rspState =  this.uvtx.rspState;
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.uvtx.imageWidth,  this.uvtx.imageHeight, 1));
            //device.setResourceName(this.gfxTexture, texture.name);
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(this.gfxTexture, 0, [ this.uvtx.convertedTexelData]);
            device.submitPass(hostAccessPass);

            this.gfxSampler = device.createSampler({
                wrapS: translateCM(rspState.primitiveTile.cms),
                wrapT: translateCM(rspState.primitiveTile.cmt),
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0, maxLOD: 0,
            });
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {        
        //TODO: a lot
        
        const renderInst = renderInstManager.newRenderInst();

        // TODO: move this to template, it only needs to be set once
        let sceneParamsOffset = renderInst.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        const sceneParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        fillMatrix4x4(sceneParams, sceneParamsOffset, viewerInput.camera.projectionMatrix);

        let drawParamsOffs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 2 * 8);
        const drawParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        //TODO: better solution for this
        let adjmodelToWorldMatrix = mat4.create();
        let shiftMatrix = mat4.fromValues(
            0, 0, 1, 0,
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 1
        )
        mat4.mul(adjmodelToWorldMatrix, shiftMatrix, modelToWorldMatrix);

        let modelToViewMatrix = mat4.create();
        mat4.mul(modelToViewMatrix, viewerInput.camera.viewMatrix, adjmodelToWorldMatrix);

        drawParamsOffs += fillMatrix4x3(drawParams, drawParamsOffs, modelToViewMatrix);
        
        let combineParamsOffs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const combineParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);

        if(this.isTextured) {
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null }]);
            let texMatrix = mat4.create();
            mat4.fromScaling(texMatrix, [1 / this.uvtx.imageWidth, 1 / this.uvtx.imageHeight, 1]);
            drawParamsOffs += fillMatrix4x2(drawParams, drawParamsOffs, texMatrix);

            fillVec4v(combineParams, combineParamsOffs, this.uvtx.rspState.primitiveColor);
            fillVec4v(combineParams, combineParamsOffs + 4, this.uvtx.rspState.environmentColor);
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
        if(this.isTextured) {
            device.destroyTexture(this.gfxTexture);
            device.destroySampler(this.gfxSampler);
        }
    }
}
