import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { DkrTexture, SIZE_OF_TEXTURE_INFO } from "./DkrTexture.js";
import { ViewerRenderInput } from "../viewer.js";
import { DkrTextureCache } from "./DkrTextureCache.js";
import { DkrLevel } from "./DkrLevel.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DkrDrawCall, DkrDrawCallParams } from "./DkrDrawCall.js";
import { BatchBuilder } from "./DkrObjectModel.js";
import { DkrTriangleBatch, SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX } from "./DkrTriangleBatch.js";
import { Mat4Identity } from "../MathHelpers.js";

const SIZE_OF_LEVEL_SEGMENT_HEADER = 0x44;
const SIZE_OF_BATCH_INFO = 12;

class DkrLevelSegment {
    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, level: DkrLevel, levelData: ArrayBufferSlice, offset: number, textureCache: DkrTextureCache, textureIndices: number[], batchBuilder: BatchBuilder) {
        const view = levelData.createDataView();

        let verticesOffset = view.getInt32(offset + 0x00);
        let numberOfVertices = view.getInt16(offset + 0x1C);
        let trianglesOffset = view.getInt32(offset + 0x04);
        let numberOfTriangles = view.getInt16(offset + 0x1E);
        let triangleBatchInfoOffset = view.getInt32(offset + 0x0C);
        let numberOfTriangleBatches = view.getInt16(offset + 0x20);

        const cache = renderHelper.renderCache;
        for (let i = 0; i < numberOfTriangleBatches; i++) {
            const ti = triangleBatchInfoOffset + (i * SIZE_OF_BATCH_INFO); // Triangle batch info index
            const tiNext = ti + SIZE_OF_BATCH_INFO;
            const tii = view.getUint8(ti);

            if (tii !== 0xFF) {
                let textureIndex = textureIndices[tii];
                textureCache.get3dTexture(textureIndex, (texture: DkrTexture) => {
                    const triangleBatch = this.parseBatch(levelData, i, ti, tiNext, verticesOffset, trianglesOffset, texture);
                    const drawCall = batchBuilder.addDrawCall(textureIndex, texture);
                    drawCall.addTriangleBatch(triangleBatch);

                    if (level.id === 10 && textureIndex === 317) {
                        // Hack to properly scroll the waterfalls in Crescent Island
                        level.addDrawCallScrollerForCrescentIsland(drawCall, i);
                    }
                });
            } else {
                const triangleBatch = this.parseBatch(levelData, i, ti, tiNext, verticesOffset, trianglesOffset, null);
                const drawCall = batchBuilder.addDrawCall(-1, null);
                drawCall.addTriangleBatch(triangleBatch);
            }
        }
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
            0,
            flags,
            texture
        );
    }
}

export class DkrLevelModel {
    private textureIndices: number[] = [];
    private segments: DkrLevelSegment[] = [];
    private drawCalls: DkrDrawCall[] = [];

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, level: DkrLevel, private textureCache: DkrTextureCache, levelData: ArrayBufferSlice) {
        const view = levelData.createDataView();

        let texturesOffset = view.getUint32(0x00);
        let segmentsOffset = view.getUint32(0x04);
        let segmentsBBOffset = view.getUint32(0x08);// Bounding boxes for segments
        let segmentsBitfieldsOffset = view.getUint32(0x10);
        let segmentsBspTreeOffset = view.getUint32(0x14);
        let bspSplitOffset = view.getUint32(0x14);
        let numberOfTextures = view.getUint16(0x18);
        let numberOfSegments = view.getUint16(0x1A);

        for (let i = 0; i < numberOfTextures; i++) {
            const texIndex = view.getUint32(texturesOffset + (i * SIZE_OF_TEXTURE_INFO));
            this.textureIndices.push(texIndex);
        }

        // Preloading all the textures makes loading much faster.
        textureCache.preload3dTextures(this.textureIndices, () => {
            const batchBuilder = new BatchBuilder();

            for (let i = 0; i < numberOfSegments; i++) {
                const segment = new DkrLevelSegment(device, renderHelper, level, levelData, segmentsOffset + (i * SIZE_OF_LEVEL_SEGMENT_HEADER), textureCache, this.textureIndices, batchBuilder);
                this.segments.push(segment);
            }

            this.drawCalls = batchBuilder.finish(renderHelper.renderCache, null);
        });
    }

    public destroy(device: GfxDevice): void {
        for (const drawCall of this.drawCalls)
            drawCall.destroy(device);
    }

    public getTextureIndices(): number[] {
        return this.textureIndices;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.textureCache.advanceTextureFrames(viewerInput.deltaTime);

        const params: DkrDrawCallParams = {
            modelMatrix: Mat4Identity,
            textureFrame: -1,
            isSkydome: false,
            usesNormals: false,
            overrideAlpha: null,
            objAnim: null,
            objAnimIndex: 0,
        };

        for (const drawCall of this.drawCalls)
            drawCall.prepareToRender(device, renderInstManager, viewerInput, params);
    }
}
