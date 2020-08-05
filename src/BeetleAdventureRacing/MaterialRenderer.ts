import { mat4, vec3 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { UVTX } from "./ParsedFiles/UVTX";
import { F3DEX_Program } from "../BanjoKazooie/render";

import * as RDP from '../Common/N64/RDP';
import { humanReadableCombineParams } from './Util';
import { drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { DEBUGGING_TOOLS_STATE } from "./Scenes";

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

class TextureData {
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;
    public width: number;
    public height: number;
    
    public constructor(device: GfxDevice, uvtx: UVTX) {
        this.width = uvtx.width;
        this.height = uvtx.height;

        let rspState = uvtx.rspState;
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, uvtx.width, uvtx.height, 1));
        //device.setResourceName(this.gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(this.gfxTexture, 0, [uvtx.convertedTexelData]);
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

    public getTextureMapping()  {
        return { gfxTexture: this.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null };
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
        device.destroySampler(this.gfxSampler);
    }
}

export class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    private isTextured: boolean;
    private hasPairedTexture: boolean;
    private texel0TextureData: TextureData;
    private texel1TextureData: TextureData;

    private program: DeviceProgram;

    private indexCount: number;

    private material: Material;
    private uvtx: UVTX;
    
    // TODO: some models are being culled incorrectly, figure out what's
    // up with that
    constructor(device: GfxDevice, material: Material) {
        this.material = material;
        this.isTextured = material.uvtx !== null && !material.uvtx.not_supported_yet;
        if(this.isTextured) {
            this.uvtx = material.uvtx!;
        }
        this.hasPairedTexture = this.isTextured && this.uvtx.otherUVTX !== null;

        //TODO: remove
        if(DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null && 
            (!this.isTextured || (material.uvtx!.flagsAndIndex & 0xFFF) !== DEBUGGING_TOOLS_STATE.singleUVTXToRender)) {
            this.isTextured = false;
            return;
        }

        if(this.isTextured) {
            let rspState = this.uvtx.rspState;
            // TODO: K4 is used, though it's not supported by F3DEX_Program - is it important?
            // TODO: what other CC settings does BAR use that F3DEX_Program doesn't support?
            // TODO: K5 is also used, as is NOISE

            this.program = new F3DEX_Program(rspState.otherModeH, 0, rspState.combineParams, this.uvtx.alpha / 0xFF, rspState.tileStates);
            this.program.setDefineBool("USE_TEXTURE", true);

            if(DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null) {
                console.log(this.program.frag);
                console.log(this.uvtx);
                console.log(humanReadableCombineParams(rspState.combineParams));
            }

            // TODO: Figure out what actually determines if this is set
            this.program.setDefineBool("TWO_CYCLE", true);
            
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
            if(this.hasPairedTexture) {
                // TODO: smarter handling of case where other uvtx = this uvtx ?
                if(this.uvtx.rspState.mainTextureIsFirstTexture) {
                    this.texel0TextureData = new TextureData(device, this.uvtx);
                    this.texel1TextureData = new TextureData(device, this.uvtx.otherUVTX!);
                } else {
                    this.texel0TextureData = new TextureData(device, this.uvtx.otherUVTX!);
                    this.texel1TextureData = new TextureData(device, this.uvtx);
                }
            } else {
                this.texel0TextureData = new TextureData(device, this.uvtx);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {        
        //TODO: a lot

        // TODO: scale
        // TODO: properly handle other modes
        // TODO: figure out other processing
        // TODO: clamp/mask/shift?
        // TODO: correct texture matrices

        if(DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null && 
            (!this.isTextured || (this.uvtx.flagsAndIndex & 0xFFF) !== DEBUGGING_TOOLS_STATE.singleUVTXToRender)) {
            return;
        }

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

            
            let textureMappings = [this.texel0TextureData.getTextureMapping()];

            let texMatrix = mat4.create();
            mat4.fromScaling(texMatrix, [1 / this.texel0TextureData.width, 1 / this.texel0TextureData.height, 1]);
            drawParamsOffs += fillMatrix4x2(drawParams, drawParamsOffs, texMatrix);

            if(this.hasPairedTexture) {
                mat4.fromScaling(texMatrix, [1 / this.texel1TextureData.width, 1 / this.texel1TextureData.height, 1]);
                drawParamsOffs += fillMatrix4x2(drawParams, drawParamsOffs, texMatrix);
                textureMappings.push(this.texel1TextureData.getTextureMapping());
            }

            renderInst.setSamplerBindingsFromTextureMappings(textureMappings);

            fillVec4v(combineParams, combineParamsOffs, this.uvtx.rspState.primitiveColor);
            fillVec4v(combineParams, combineParamsOffs + 4, this.uvtx.rspState.environmentColor);
        }

        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        let gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.drawIndexes(this.indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);


        if(DEBUGGING_TOOLS_STATE.showTextureIndices && this.isTextured) {
            let xSum = 0;
            let ySum = 0;
            let zSum = 0;
            let vCt = this.material.vertexData.length / 9;
            for(let i = 0; i < this.material.vertexData.length; i += 9) {
                xSum += this.material.vertexData[i];
                ySum += this.material.vertexData[i + 1];
                zSum += this.material.vertexData[i + 2];
            }
            let centerModelSpace = vec3.fromValues(xSum / vCt, ySum / vCt, zSum / vCt);

            let centerWorldSpace = vec3.create();
            vec3.transformMat4(centerWorldSpace, centerModelSpace, adjmodelToWorldMatrix);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, centerWorldSpace, (this.uvtx.flagsAndIndex & 0xfff).toString(16));
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if(this.isTextured) {
            this.texel0TextureData.destroy(device);
            if(this.hasPairedTexture) {
                this.texel1TextureData.destroy(device);
            }
        }
    }
}
