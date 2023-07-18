
import { mat4 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxProgram, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from '../gfx/platform/GfxPlatform.js';
import { assert } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { DkrControlGlobals } from './DkrControlGlobals.js';
import { DkrTexture } from './DkrTexture.js';
import { DkrFinalVertex, DkrTriangleBatch } from './DkrTriangleBatch.js';
import { F3DDKR_Program, MAX_NUM_OF_INSTANCES } from './F3DDKR_Program.js';
import { DkrObjectAnimation } from './DkrObjectAnimation.js';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { makeTriangleIndexBuffer } from '../gfx/helpers/TopologyHelpers.js';
import { GfxTopology } from '../gfx/helpers/TopologyHelpers.js';

// Currently known flags
const FLAG_ENABLE_DEPTH_WRITE    = 0x00000010;
const FLAG_IS_INVISIBLE_GEOMETRY = 0x00000100;
const FLAG_IS_ENV_MAP_ENABLED    = 0x00008000; // Spherical Environment Mapping
const FLAG_IS_TEXTURE_ANIMATED   = 0x00010000;

const viewMatrixScratch = mat4.create();
const viewMatrixCalcScratch = mat4.create();
const mirrorMatrix = mat4.fromValues(
    -1, 0, 0, 0,
     0, 1, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1,
);

export interface DkrDrawCallParams {
    modelMatrices: mat4[];
    overrideAlpha: number | null;
    usesNormals: boolean;
    isSkydome: boolean;
    textureFrame: number;
    objAnim: DkrObjectAnimation | null;
    objAnimIndex: number;
}

export class DkrDrawCall {
    private vertices: DkrFinalVertex[] = [];
    private positionBuffer: GfxBuffer;
    private attribBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private indexCount: number;

    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private objAnimPositionBufferByteOffset: number[][] = [];
    private gfxProgram: GfxProgram | null = null;
    private program: F3DDKR_Program;
    private isBuilt = false;
    private flags: number;
    private hasBeenDestroyed = false;

    // Only used for the Crescent Island waterfalls
    private scrollU = 0;
    private scrollV = 0;

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private texture?: DkrTexture | null) {
        this.program = new F3DDKR_Program();
    }

    public addTriangleBatch(triBatch: DkrTriangleBatch): void {
        if(this.flags == undefined || this.flags == null) {
            this.flags = triBatch.getFlags();
        }
        this.vertices = this.vertices.concat(triBatch.getVertices());
    }

    public build(animations: DkrObjectAnimation[] | null = null): void {
        assert(!this.isBuilt);

        const indexData = makeTriangleIndexBuffer(GfxTopology.Triangles, 0, this.vertices.length);
        this.indexCount = indexData.length;
        this.indexBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.Index, indexData.buffer);

        const attribBuffer = new Float32Array(this.vertices.length * 6);
        for(let i = 0; i < this.vertices.length; i++) {
            const attribOffs = i * 6;
            attribBuffer[attribOffs + 0] = this.vertices[i].xr;
            attribBuffer[attribOffs + 1] = this.vertices[i].yg;
            attribBuffer[attribOffs + 2] = this.vertices[i].zb;
            attribBuffer[attribOffs + 3] = this.vertices[i].a;
            attribBuffer[attribOffs + 4] = this.vertices[i].u;
            attribBuffer[attribOffs + 5] = this.vertices[i].v;
        }

        const positionBufferFrameSize = this.vertices.length * 3;
        let positionBuffer: Float32Array;

        if (animations !== null && animations.length > 0) {
            let keyframeTotalNum = 0;
            for (let i = 0; i < animations.length; i++) {
                const keyframes = animations![i].getKeyframes();
                keyframeTotalNum += keyframes.length;
            }
            assert(keyframeTotalNum > 0);

            // Now set up the keyframes. Each keyframe is effectively a contiguous position vertex buffer.
            positionBuffer = new Float32Array(positionBufferFrameSize * keyframeTotalNum);
            let positionOffs = 0;
            for (let i = 0; i < animations.length; i++) {
                const frameByteOffset: number[] = [];
                const keyframes = animations![i].getKeyframes();
                for (let j = 0; j < keyframes.length; j++) {
                    frameByteOffset.push(positionOffs * 0x04);
                    const positions = keyframes[j];
                    for (let k = 0; k < this.vertices.length; k++) {
                        const originalIndex = this.vertices[k].originalIndex;
                        positionBuffer.set(positions[originalIndex], positionOffs);
                        positionOffs += 3;
                    }
                }
                this.objAnimPositionBufferByteOffset.push(frameByteOffset);
            }
        } else {
            positionBuffer = new Float32Array(positionBufferFrameSize);
            for (let i = 0; i < this.vertices.length; i++) {
                const positionOffs = i * 3;
                positionBuffer[positionOffs + 0] = this.vertices[i].x;
                positionBuffer[positionOffs + 1] = this.vertices[i].y;
                positionBuffer[positionOffs + 2] = this.vertices[i].z;
            }
        }

        const vertexAttributeDescriptors = [
            { location: F3DDKR_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: F3DDKR_Program.a_Position_2, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: F3DDKR_Program.a_Color, bufferIndex: 2, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 0x04, },
            { location: F3DDKR_Program.a_TexCoord, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 0x04, },
        ];
        const vertexBufferDescriptors = [
            { byteStride: 3 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex, }, // XYZ
            { byteStride: 3 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex, }, // XYZ
            { byteStride: 6 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex, }, // RGBA UV
        ];
        this.inputLayout = this.cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.positionBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.Vertex, positionBuffer.buffer);
        this.attribBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.Vertex, attribBuffer.buffer);
        this.vertexBufferDescriptors = [
            { buffer: this.positionBuffer, byteOffset: 0 },
            { buffer: this.positionBuffer, byteOffset: 0 },
            { buffer: this.attribBuffer, byteOffset: 0 },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.isBuilt = true;
    }

    public destroy(device: GfxDevice): void {
        if(!this.hasBeenDestroyed) {
            device.destroyBuffer(this.indexBuffer);
            device.destroyBuffer(this.positionBuffer);
            this.hasBeenDestroyed = true;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, params: DkrDrawCallParams): void {
        if(!DkrControlGlobals.SHOW_INVISIBLE_GEOMETRY.on && !!(this.flags & FLAG_IS_INVISIBLE_GEOMETRY)) {
            return;
        }
        if(params.overrideAlpha === 0.0) {
            return;
        }

        if(this.isBuilt) {
            let texLayer;

            const renderInst = renderInstManager.newRenderInst();

            if(!!this.texture) {
                if(params.isSkydome) {
                    renderInst.setMegaStateFlags(setAttachmentStateSimple({}, {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    }));
                    renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
                } else {
                    if(params.overrideAlpha === null || params.overrideAlpha === 1.0) {
                        texLayer = this.texture!.getLayer();
                    } else {
                        texLayer = GfxRendererLayer.TRANSLUCENT;
                    }
                    if(texLayer == GfxRendererLayer.ALPHA_TEST) {
                        texLayer = GfxRendererLayer.TRANSLUCENT;
                        renderInst.setMegaStateFlags(setAttachmentStateSimple({
                            depthWrite: true
                        }, {
                            blendMode: GfxBlendMode.Add,
                            blendSrcFactor: GfxBlendFactor.SrcAlpha,
                            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                        }));
                    } else if(texLayer == GfxRendererLayer.TRANSLUCENT) {
                        renderInst.setMegaStateFlags(setAttachmentStateSimple({
                            depthWrite: !!(this.flags & FLAG_ENABLE_DEPTH_WRITE),
                        }, {
                            blendMode: GfxBlendMode.Add,
                            blendSrcFactor: GfxBlendFactor.SrcAlpha,
                            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                        }));
                    }
                    renderInst.sortKey = makeSortKey(texLayer);
                }
            } else {
                renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            }

            if (this.gfxProgram === null) {
                this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);
            }

            // Set draw parameters
            let offs = renderInst.allocateUniformBuffer(F3DDKR_Program.ub_DrawParams, 8 + (12 * MAX_NUM_OF_INSTANCES));
            const d = renderInst.mapUniformBufferF32(F3DDKR_Program.ub_DrawParams);

            // Color
            d[offs + 0] = 1.0;
            d[offs + 1] = 1.0;
            d[offs + 2] = 1.0;
            d[offs + 3] = (params.overrideAlpha !== null) ? params.overrideAlpha : 1.0;
            offs += 4;

            // Misc[0] -- TexCoordOffset
            if (!!this.texture) {
                const texCoordOffset = this.texture!.getTexCoordOffset();
                d[offs + 0] = texCoordOffset[0] + this.scrollU;
                d[offs + 1] = texCoordOffset[1] + this.scrollV;
            }
            offs += 2;

            // Misc[0] -- AnimProgress
            if (!!params.objAnim) {
                d[offs] = params.objAnim.getProgressInCurrentFrame();
            }
            offs++;

            // Misc[0] -- Options
            let options = 0;
            if (!!this.texture && DkrControlGlobals.ENABLE_TEXTURES.on)
                options |= 0b0001;
            if (DkrControlGlobals.ENABLE_VERTEX_COLORS.on)
                options |= 0b0010;
            if (params.usesNormals)
                options |= 0b0100;
            if (params.objAnim)
                options |= 0b1000;

            d[offs] = options;
            offs++;

            if(!!this.texture) {
                // Use the texture.
                this.texture!.bind(renderInst, params.textureFrame);

                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, 0);
            } else {
                offs += 16;
            }

            assert(params.modelMatrices.length <= MAX_NUM_OF_INSTANCES);
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);
            for(let i = 0; i < params.modelMatrices.length; i++) {
                if(DkrControlGlobals.ADV2_MIRROR.on) {
                    mat4.mul(viewMatrixCalcScratch, mirrorMatrix, params.modelMatrices[i]);
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, viewMatrixCalcScratch);
                } else {
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, params.modelMatrices[i]);
                }
                offs += fillMatrix4x3(d, offs, viewMatrixCalcScratch);
            }

            if(!!params.objAnim) {
                const currentFrameIndex = params.objAnim.getCurrentFrame();
                this.vertexBufferDescriptors[0].byteOffset = this.objAnimPositionBufferByteOffset[params.objAnimIndex][currentFrameIndex];
                const nextFrameIndex = (currentFrameIndex + 1) % params.objAnim.getKeyframes().length;
                this.vertexBufferDescriptors[1].byteOffset = this.objAnimPositionBufferByteOffset[params.objAnimIndex][nextFrameIndex];
            } else {
                this.vertexBufferDescriptors[0].byteOffset = 0;
                this.vertexBufferDescriptors[1].byteOffset = 0;
            }

            renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

            renderInst.setGfxProgram(this.gfxProgram);
            renderInst.drawIndexesInstanced(this.indexCount, params.modelMatrices.length);
            renderInst.setMegaStateFlags({
                cullMode: DkrControlGlobals.ADV2_MIRROR.on ? GfxCullMode.Front : GfxCullMode.Back
            });

            renderInstManager.submitRenderInst(renderInst);
        }
    }

    // Only for the animated waterfalls in Crescent Island.
    public scrollTexture(u: number, v: number, dt: number) {
        // The numbers here are just a guess from eyeballing it.
        this.scrollU += (u / 1024) * (dt * (60/1000));
        this.scrollV += (v / 1024) * (dt * (60/1000));
    }
}
