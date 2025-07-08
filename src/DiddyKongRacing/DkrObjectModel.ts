
import { ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { DataManager } from "./DataManager.js";
import { DkrDrawCall, DkrDrawCallParams } from "./DkrDrawCall.js";
import { DkrObjectAnimation } from "./DkrObjectAnimation.js";
import { DkrTexture, SIZE_OF_TEXTURE_INFO } from "./DkrTexture.js";
import { DkrTextureCache } from "./DkrTextureCache.js";
import { DkrTriangleBatch, DkrVertex, SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX } from "./DkrTriangleBatch.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

const SIZE_OF_BATCH_INFO = 12;

export class BatchBuilder {
    private drawCalls: DkrDrawCall[] = [];
    private drawCallMap = new Map<number, DkrDrawCall>();

    public addDrawCall(textureIndex: number, texture: DkrTexture | null): DkrDrawCall {
        let allowMerge = true;

        if (texture !== null) {
            const layer = texture.getLayer();
            if (layer === GfxRendererLayer.TRANSLUCENT)
                allowMerge = false;
        }

        let drawCall: DkrDrawCall | undefined;
        if (allowMerge) {
            drawCall = this.drawCallMap.get(textureIndex);
            if (drawCall === undefined) {
                drawCall = new DkrDrawCall(texture, textureIndex);
                this.drawCallMap.set(textureIndex, drawCall);
                this.drawCalls.push(drawCall);
            }
        } else {
            drawCall = new DkrDrawCall(texture, textureIndex);
            this.drawCalls.push(drawCall);
        }

        return drawCall;
    }

    public finish(cache: GfxRenderCache, objectAnimations: DkrObjectAnimation[] | null): DkrDrawCall[] {
        for (const drawCall of this.drawCalls)
            drawCall.build(cache, objectAnimations);
        return this.drawCalls;
    }
}

export type DkrTextureFrameOverride = Map<number, number>;

export class DkrObjectModel {
    private drawCalls: DkrDrawCall[] = [];

    private verticesOffset = 0;
    private numberOfVertices = 0;
    private numberOfTriangles = 0;
    private numberOfTriangleBatches = 0;

    // Used for object animations.
    private numberOfAnimatedVertices = 0;
    private animatedVerticesOffset = 0;
    private animatedVerticesIndices: number[] = [];
    private objectAnimations: DkrObjectAnimation[] = [];
    private currObjAnimIndex = 0;

    private modelDataView: DataView;

    constructor(private modelId: number, modelData: ArrayBufferSlice, cache: GfxRenderCache, dataManager: DataManager, textureCache: DkrTextureCache) {
        const view = modelData.createDataView();

        this.modelDataView = view;

        let texturesOffset = view.getUint32(0x00);
        let numberOfTextures = view.getUint16(0x22);

        this.verticesOffset = view.getInt32(0x04);
        let trianglesOffset = view.getInt32(0x08);
        let triangleBatchInfoOffset = view.getInt32(0x38);
        this.numberOfVertices = view.getInt16(0x24);
        this.numberOfTriangles = view.getInt16(0x26);
        this.numberOfTriangleBatches = view.getInt16(0x28);

        this.numberOfAnimatedVertices = view.getInt16(0x4A);
        this.animatedVerticesOffset = view.getInt32(0x4C);
        this.readAnimatedVerticesIndices(view);

        let animationIds = dataManager.objectAnimationIds[modelId];

        if(!!animationIds) {
            for(let i = 0; i < animationIds!.length; i++) {
                const animationDataBinary = dataManager.getObjectAnimation(animationIds[i]).createTypedArray(Uint8Array);
                this.objectAnimations.push(new DkrObjectAnimation(
                    animationIds![i],
                    animationDataBinary,
                    this.getVertices(),
                    this.animatedVerticesIndices,
                    this.numberOfAnimatedVertices
                ));
            }
        }

        this.loadGeometry(modelData, cache, textureCache, numberOfTextures, texturesOffset, triangleBatchInfoOffset, trianglesOffset);
    }

    public destroy(device: GfxDevice): void {
        for (const drawCall of this.drawCalls)
            drawCall.destroy(device);
    }

    private loadGeometry(levelData: ArrayBufferSlice, cache: GfxRenderCache, textureCache: DkrTextureCache, numberOfTextures: number, texturesOffset: number, triangleBatchInfoOffset: number, trianglesOffset: number): void {
        const view = levelData.createDataView();

        const textureIndices: number[] = [];
        for (let i = 0; i < numberOfTextures; i++)
            textureIndices.push(view.getUint32(texturesOffset + (i * SIZE_OF_TEXTURE_INFO)));

        const batchBuilder = new BatchBuilder();

        textureCache.preload3dTextures(textureIndices, () => {
            for (let i = 0; i < this.numberOfTriangleBatches; i++) {
                const ti = triangleBatchInfoOffset + (i * SIZE_OF_BATCH_INFO); // Triangle batch info index
                const tiNext = ti + SIZE_OF_BATCH_INFO;

                const tii = view.getUint8(ti);
                const textureIndex = textureIndices[tii];
                if (textureIndex !== undefined && tii !== 0xFF) {
                    textureCache.get3dTexture(textureIndex, (texture: DkrTexture) => {
                        const triangleBatch = this.parseBatch(levelData, i, ti, tiNext, this.verticesOffset, trianglesOffset, texture);
                        const drawCall = batchBuilder.addDrawCall(textureIndex, texture);
                        drawCall.addTriangleBatch(triangleBatch);
                    });
                } else {
                    const triangleBatch = this.parseBatch(levelData, i, ti, tiNext, this.verticesOffset, trianglesOffset, null);
                    const drawCall = batchBuilder.addDrawCall(-1, null);
                    drawCall.addTriangleBatch(triangleBatch);
                }
            }

            this.drawCalls = batchBuilder.finish(cache, this.objectAnimations);
        });
    }

    private parseBatch(levelData: ArrayBufferSlice, i: number, ti: number, tiNext: number, verticesOffset: number, trianglesOffset: number, texture: DkrTexture | null): DkrTriangleBatch {
        const view = levelData.createDataView();

        let curVertexOffset = view.getInt16(ti + 0x02);
        let curTrisOffset = view.getInt16(ti + 0x04);
        let nextVertexOffset = view.getInt16(tiNext + 0x02);
        let nextTrisOffset = view.getInt16(tiNext + 0x04);
        let batchVerticesOffset = verticesOffset + (curVertexOffset * SIZE_OF_VERTEX);
        let batchTrianglesOffset = trianglesOffset + (curTrisOffset * SIZE_OF_TRIANGLE_FACE);
        let numberOfTrianglesInBatch = nextTrisOffset - curTrisOffset;
        let numberOfVerticesInBatch = nextVertexOffset - curVertexOffset;
        let flags = view.getUint32(ti + 0x08);

        const triangleDataStart = batchTrianglesOffset;
        const triangleDataEnd = triangleDataStart + (numberOfTrianglesInBatch * SIZE_OF_TRIANGLE_FACE);
        const verticesDataStart = batchVerticesOffset;
        const verticesDataEnd = verticesDataStart + (numberOfVerticesInBatch * SIZE_OF_VERTEX);

        return new DkrTriangleBatch(
            levelData.slice(triangleDataStart, triangleDataEnd),
            levelData.slice(verticesDataStart, verticesDataEnd),
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
    private getVertices(): DkrVertex[] {
        const vertices: DkrVertex[] = [];
        for (let i = 0; i < this.numberOfVertices; i++) {
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
    public getVertex(index: number): ReadonlyVec3 {
        return vec3.fromValues(
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 0),
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 2),
            this.modelDataView.getInt16(this.verticesOffset + (index * SIZE_OF_VERTEX) + 4)
        );
    }

    public setAnimationIndexAndProgress(index: number, progress: number, loopType: number): void {
        this.currObjAnimIndex = index;
        if(!!this.objectAnimations && !!this.objectAnimations[this.currObjAnimIndex]) {
            this.objectAnimations[this.currObjAnimIndex].setProgress(progress, loopType);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, params: DkrDrawCallParams, texFrameOverride: DkrTextureFrameOverride | null = null) {
        for (let i = 0; i < this.drawCalls.length; i++) {
            if(!!this.objectAnimations) {
                params.objAnim = this.objectAnimations[this.currObjAnimIndex];
                params.objAnimIndex = this.currObjAnimIndex;
            }
            params.textureFrame = -1;

            const drawCall = this.drawCalls[i];
            const textureIndex = drawCall.textureIndex;
            if (texFrameOverride !== null) {
                if (texFrameOverride.has(-1))
                    params.textureFrame = texFrameOverride.get(-1)!;
                else if (texFrameOverride.has(textureIndex))
                    params.textureFrame = texFrameOverride.get(textureIndex)!;
            }
            drawCall.prepareToRender(device, renderInstManager, viewerInput, params);
        }
    }
}
