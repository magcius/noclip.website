import { mat4, vec3 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { UVTX, UVTXRenderHelper } from "./ParsedFiles/UVTX";
import { F3DEX_Program } from "../BanjoKazooie/render";

import * as RDP from '../Common/N64/RDP';
import { humanReadableCombineParams } from './Util';
import { drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { DEBUGGING_TOOLS_STATE } from "./Scenes";
import { Material } from "./ParsedFiles/Common";

export class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    private isTextured: boolean;
    private uvtxRenderHelper: UVTXRenderHelper;

    private isTextureSequence: boolean;
    private uvtxRenderHelpers: Map<UVTX, UVTXRenderHelper>;

    private program: DeviceProgram;

    private indexCount: number;

    private material: Material;
    private uvtx: UVTX;
    
    // TODO: some models are being culled incorrectly, figure out what's up with that
    // TODO: what's going on with the materials that (seemingly) have no texture and are invisible?
    // (e.g. see SS in the desert, MoM by the ice wall you smash)
    constructor(device: GfxDevice, material: Material, rendererCache: Map<any, any>) {
        this.material = material;
        this.isTextured = material.uvtx !== null;
        if(this.isTextured) {
            this.uvtx = material.uvtx!;
            this.isTextureSequence = this.uvtx.seqAnim !== null;
        }

        //TODO: remove
        if(DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null && 
            (!this.isTextured || (material.uvtx!.flagsAndIndex & 0xFFF) !== DEBUGGING_TOOLS_STATE.singleUVTXToRender)) {
            this.isTextured = false;
            return;
        }

        //TODO: proper lighting support

        if(this.isTextured) {
            let rspState = this.uvtx.rspState;
            // TODO: K4 is used, though it's not supported by F3DEX_Program - is it important?
            // TODO: what other CC settings does BAR use that F3DEX_Program doesn't support?
            // TODO: K5 is also used, as is NOISE

            let otherModeL = 0;
            if(this.uvtx.blendAlpha !== 0xFF) {
                otherModeL |= 1; // set G_MDSFT_ALPHACOMPARE to 0b01 (compare to blend color register) 
            }
            this.program = new F3DEX_Program(rspState.otherModeH, otherModeL, rspState.combineParams, this.uvtx.blendAlpha / 0xFF, rspState.tileStates);
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

        // oh god i get why people use factories now
        if (this.isTextured) {
            if(this.isTextureSequence) {
                this.uvtxRenderHelpers = new Map();
                for(let frame of this.uvtx.seqAnim!.uvts.frames) {
                    this.uvtxRenderHelpers.set(frame.uvtx!, this.getOrMakeRenderHelper(device, frame.uvtx!, rendererCache));
                }
            } else {
                this.uvtxRenderHelper = this.getOrMakeRenderHelper(device, this.uvtx, rendererCache);
            }
            //this.uvtxRenderHelper = new UVTXRenderHelper(this.uvtx, device);
        }
    }

    private getOrMakeRenderHelper(device: GfxDevice, uvtx: UVTX, rendererCache: Map<any, any>): UVTXRenderHelper {
        if (rendererCache.has(uvtx)) {
            return rendererCache.get(uvtx);
        }
        else {
            let uvtxRenderHelper = new UVTXRenderHelper(uvtx, device);
            rendererCache.set(uvtx, uvtxRenderHelper);
            return uvtxRenderHelper;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {        
        //TODO: a lot

        // TODO: scale
        // TODO: properly handle other modes
        // TODO: figure out other processing

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
            let uvtxRenderHelper: UVTXRenderHelper;
            if(this.isTextureSequence) {
                let curUVTX = this.uvtx.seqAnim!.uvts.frames[this.uvtx.seqAnim!.curFrameIndex].uvtx;
                uvtxRenderHelper = this.uvtxRenderHelpers.get(curUVTX!)!;          
            } else {
                uvtxRenderHelper = this.uvtxRenderHelper;
            }

            renderInst.setSamplerBindingsFromTextureMappings(uvtxRenderHelper.getTextureMappings());
            uvtxRenderHelper.fillTexMatrices(drawParams, drawParamsOffs);
            uvtxRenderHelper.fillCombineParams(combineParams, combineParamsOffs);
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

            let debugStr = (this.uvtx.flagsAndIndex & 0xfff).toString(16);
            if(this.uvtx.otherUVTX !== null) {
                debugStr += " | " + (this.uvtx.otherUVTX.flagsAndIndex & 0xfff).toString(16);
            }
            debugStr += "\n";
            debugStr += humanReadableCombineParams(this.uvtx.rspState.combineParams);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, centerWorldSpace, debugStr);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if(this.isTextured) {
            if(this.isTextureSequence) {
                this.uvtxRenderHelpers.forEach(v => v.destroy(device));
            } else {
                this.uvtxRenderHelper.destroy(device);
            }
        }
    }
}
