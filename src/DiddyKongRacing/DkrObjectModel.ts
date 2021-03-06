import { mat4, vec3 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { DataManager } from "./DataManager";
import { DkrDrawCall, DkrDrawCallParams } from "./DkrDrawCall";
import { DkrObject } from "./DkrObject";
import { DkrObjectAnimation } from "./DkrObjectAnimation";
import { DkrTexture, SIZE_OF_TEXTURE_INFO } from "./DkrTexture";
import { DkrTextureCache } from "./DkrTextureCache";
import { DkrTriangleBatch, DkrVertex, SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX } from "./DkrTriangleBatch";
import { getRange } from "./DkrUtil";

const SIZE_OF_BATCH_INFO = 12;

export class DkrObjectModel {
    private triangleBatches: DkrTriangleBatch[];
    private textureIndices = new Array<number>();

    private opaqueTextureDrawCalls: any = {};
    private opaqueTextureDrawCallsKeys: any[];
    private transTexDrawCalls = Array<any>();

    private verticesOffset = 0;
    private numberOfVertices = 0;
    private numberOfTriangles = 0;
    private numberOfTriangleBatches = 0; 

    // Used for object animations.
    private numberOfAnimatedVertices = 0;
    private animatedVerticesOffset = 0;
    private animatedVerticesIndices = Array<number>();
    private objectAnimations: DkrObjectAnimation[] | null = null;
    private currObjAnimIndex = 0;

    private modelDataView: DataView;

    constructor(private modelId: number, modelData: Uint8Array, device: GfxDevice, 
    renderHelper: GfxRenderHelper, dataManager: DataManager, textureCache: DkrTextureCache) {
        const dataView = new DataView(modelData.buffer);

        this.modelDataView = dataView;

        let texturesOffset = dataView.getUint32(0x00);
        let numberOfTextures = dataView.getUint16(0x22);
        
        this.verticesOffset = dataView.getInt32(0x04);
        let trianglesOffset = dataView.getInt32(0x08);
        let triangleBatchInfoOffset = dataView.getInt32(0x38);
        this.numberOfVertices = dataView.getInt16(0x24);
        this.numberOfTriangles = dataView.getInt16(0x26);
        this.numberOfTriangleBatches = dataView.getInt16(0x28);

        this.numberOfAnimatedVertices = dataView.getInt16(0x4A);
        this.animatedVerticesOffset = dataView.getInt32(0x4C);
        this.readAnimatedVerticesIndices(dataView);

        let animationIds = dataManager.objectAnimationIds[modelId];

        if(!!animationIds) {
            let promises = [];
            for(let i = 0; i < animationIds.length; i++) {
                promises.push(dataManager.getObjectAnimation(animationIds[i]));
            }
            Promise.all(promises).then((out) => {
                this.objectAnimations = new Array<DkrObjectAnimation>();
                const vertices = this.getVertices();
                for(let i = 0; i < animationIds!.length; i++) {
                    this.objectAnimations.push(new DkrObjectAnimation(
                        animationIds![i],
                        out[i].createTypedArray(Uint8Array),
                        vertices, 
                        this.animatedVerticesIndices, 
                        this.numberOfAnimatedVertices
                    ));
                }
                this.loadGeometry(dataView, device, renderHelper, textureCache, numberOfTextures, 
                texturesOffset, triangleBatchInfoOffset, trianglesOffset);
            });
        } else {
            this.loadGeometry(dataView, device, renderHelper, textureCache, numberOfTextures, 
            texturesOffset, triangleBatchInfoOffset, trianglesOffset);
        }

    }

    public destroy(device: GfxDevice): void { 
        if(!!this.opaqueTextureDrawCallsKeys) {
            for(const key of this.opaqueTextureDrawCallsKeys) {
                this.opaqueTextureDrawCalls[key].destroy(device);
            }
        }
        if(!!this.transTexDrawCalls) {
            for(const transDrawCall of this.transTexDrawCalls) {
                transDrawCall.drawCall.destroy(device);
            }
        }
    }

    private loadGeometry(dataView: DataView, device: GfxDevice, renderHelper: GfxRenderHelper, 
    textureCache: DkrTextureCache, numberOfTextures: number, texturesOffset: number, 
    triangleBatchInfoOffset: number, trianglesOffset: number): void {
        
        for (let i = 0; i < numberOfTextures; i++) {
            this.textureIndices.push(dataView.getUint32(texturesOffset + (i * SIZE_OF_TEXTURE_INFO)));
        }
        textureCache.preload3dTextures(this.textureIndices, () => {
            this.triangleBatches = new Array(this.numberOfTriangleBatches);
            
            for (let i = 0; i < this.numberOfTriangleBatches; i++) {
                let ti = triangleBatchInfoOffset + (i * SIZE_OF_BATCH_INFO); // Triangle batch info index
                let tiNext = ti + SIZE_OF_BATCH_INFO;
                
                let textureIndex = this.textureIndices[dataView.getUint8(ti)];
                
                if(textureIndex != null && textureIndex != undefined && dataView.getUint8(ti) != 0xFF) {    
                    textureCache.get3dTexture(textureIndex, (texture: DkrTexture) => {
                        this.parseBatch(device, renderHelper, dataView, i, ti, tiNext, this.verticesOffset, trianglesOffset, texture);
                        const layer = texture.getLayer()
                        if(layer == GfxRendererLayer.OPAQUE || layer == GfxRendererLayer.BACKGROUND) {
                            if(this.opaqueTextureDrawCalls[textureIndex] == undefined) {
                                this.opaqueTextureDrawCalls[textureIndex] = new DkrDrawCall(device, texture);
                            }
                            this.opaqueTextureDrawCalls[textureIndex].addTriangleBatch(this.triangleBatches[i]);
                        } else {
                            let drawCall = new DkrDrawCall(device, texture);
                            drawCall.addTriangleBatch(this.triangleBatches[i]);
                            drawCall.build(this.objectAnimations);
                            this.transTexDrawCalls.push({
                                drawCall: drawCall,
                                textureIndex: textureIndex
                            });
                        }
                    });
                } else {
                    if(this.opaqueTextureDrawCalls['noTex'] == undefined) {
                        this.opaqueTextureDrawCalls['noTex'] = new DkrDrawCall(device, null);
                    }
                    this.parseBatch(device, renderHelper, dataView, i, ti, tiNext, this.verticesOffset, trianglesOffset, null);
                    this.opaqueTextureDrawCalls['noTex'].addTriangleBatch(this.triangleBatches[i]);
                }
            }
            this.opaqueTextureDrawCallsKeys = Object.keys(this.opaqueTextureDrawCalls);
            for(const key of this.opaqueTextureDrawCallsKeys) {
                this.opaqueTextureDrawCalls[key].build(this.objectAnimations);
            }
        });
    }

    private parseBatch(device: GfxDevice, renderHelper: GfxRenderHelper, dataView: DataView, 
        i: number, ti: number, tiNext: number, verticesOffset: number, trianglesOffset: number, 
        texture: DkrTexture | null) {
        let curVertexOffset = dataView.getInt16(ti + 0x02);
        let curTrisOffset = dataView.getInt16(ti + 0x04);
        let nextVertexOffset = dataView.getInt16(tiNext + 0x02);
        let nextTrisOffset = dataView.getInt16(tiNext + 0x04);
        let batchVerticesOffset = verticesOffset + (curVertexOffset * SIZE_OF_VERTEX);
        let batchTrianglesOffset = trianglesOffset + (curTrisOffset * SIZE_OF_TRIANGLE_FACE);
        let numberOfTrianglesInBatch = nextTrisOffset - curTrisOffset;
        let numberOfVerticesInBatch = nextVertexOffset - curVertexOffset;
        let flags = dataView.getUint32(ti + 0x08);

        const triangleDataStart = batchTrianglesOffset;
        const triangleDataEnd = triangleDataStart + (numberOfTrianglesInBatch * SIZE_OF_TRIANGLE_FACE);
        const verticesDataStart = batchVerticesOffset;
        const verticesDataEnd = verticesDataStart + (numberOfVerticesInBatch * SIZE_OF_VERTEX);

        this.triangleBatches[i] = new DkrTriangleBatch(
            device, 
            renderHelper,
            new Uint8Array(dataView.buffer).slice(triangleDataStart, triangleDataEnd),
            new Uint8Array(dataView.buffer).slice(verticesDataStart, verticesDataEnd),
            curVertexOffset,
            flags,
            texture
        );
    }

    private readAnimatedVerticesIndices(dataView: DataView): void {
        for(let i = 0; i < this.numberOfVertices; i++) {
            const offset = this.animatedVerticesOffset + (i * 2);
            this.animatedVerticesIndices.push(dataView.getInt16(offset));
        }
    }

    // Currently only used as a reference for Object Animations.
    private getVertices(): Array<DkrVertex> {
        let vertices = new Array<DkrVertex>();

        for(let i = 0; i < this.numberOfVertices; i++) {
            const voff = this.verticesOffset + (i * SIZE_OF_VERTEX);
            vertices.push({
                x: this.modelDataView.getInt16(voff + 0),
                y: this.modelDataView.getInt16(voff + 2),
                z: this.modelDataView.getInt16(voff + 4),
                xr: this.modelDataView.getUint8(voff + 6),
                yg: this.modelDataView.getUint8(voff + 7),
                zb: this.modelDataView.getUint8(voff + 8),
                a: this.modelDataView.getUint8(voff + 9),
            });
        }

        return vertices;
    }

    // Only used with the `midifadepoint` object.
    public getVertex(index: number): vec3 {
        return vec3.fromValues(
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 0),
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 2),
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 4)
        );
    }

    public getVertexAlpha(index: number): number {
        return this.modelDataView.getUint8(this.verticesOffset + (index * SIZE_OF_VERTEX) + 9);
    }

    public setAnimationIndexAndProgress(index: number, progress: number, loopType: number): void {
        this.currObjAnimIndex = index;
        if(!!this.objectAnimations && !!this.objectAnimations[this.currObjAnimIndex]) {
            this.objectAnimations[this.currObjAnimIndex].setProgress(progress, loopType);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput,
        params: DkrDrawCallParams, texFrameOverride: any | null = null) {
        if(!!this.opaqueTextureDrawCallsKeys) {
            for(const key of this.opaqueTextureDrawCallsKeys) {
                if(!!this.objectAnimations) {
                    params.objAnim = this.objectAnimations[this.currObjAnimIndex];
                    params.objAnimIndex = this.currObjAnimIndex;
                }
                params.textureFrame = -1;
                if(!!texFrameOverride && texFrameOverride[key] != null && texFrameOverride[key] != undefined) {
                    params.textureFrame = texFrameOverride[key];
                } else if(!!texFrameOverride && texFrameOverride['doNotAnimate']) {
                    params.textureFrame = 0;
                }
                this.opaqueTextureDrawCalls[key].prepareToRender(device, renderInstManager, viewerInput, params);
            }
        }
        for(let i = 0; i < this.transTexDrawCalls.length; i++) {
            if(!!this.objectAnimations) {
                params.objAnim = this.objectAnimations[this.currObjAnimIndex];
                params.objAnimIndex = this.currObjAnimIndex;
            }
            params.textureFrame = -1;
            const key = this.transTexDrawCalls[i].textureIndex;
            if(!!texFrameOverride && texFrameOverride[key] != null && texFrameOverride[key] != undefined) {
                params.textureFrame = texFrameOverride[key];
            } else if(!!texFrameOverride && texFrameOverride['doNotAnimate']) {
                params.textureFrame = 0;
            }
            this.transTexDrawCalls[i].drawCall.prepareToRender(device, renderInstManager, viewerInput, params);
        }
        /*
        if(!!this.objectAnimations && !!this.objectAnimations[this.currObjAnimIndex]) {
            this.objectAnimations[this.currObjAnimIndex].advance(viewerInput.deltaTime);
        }
        */
    }
}
