import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { DkrTextureCache } from "./DkrTextureCache";
import { bytesToInt, bytesToShort, bytesToUInt, getRange, IDENTITY_MATRIX, isFlagSet } from "./DkrUtil";
import { SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX, DkrTriangleBatch } from "./DkrTriangleBatch";
import { DkrTexture } from "./DkrTexture";
import { DkrDrawCall } from "./DkrDrawCall";
import { mat4, vec3, vec4 } from "gl-matrix";
import { textureAnimationToCanvas } from "../kh2fm/render";
import { CURRENT_LEVEL_ID, DkrLevel } from "./DkrLevel";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";

class TriangleBatchFlags {
    constructor(
        public isInvisibleGeometry: boolean, // Determines if the geometry should be an invisible wall/ceiling.
        public isEnvMapEnabled: boolean      // Determines if environment mapping (spherical) is enabled.
    ){}
};

function buf2hex(buffer: Uint8Array) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x: any) => ('00' + x.toString(16)).slice(-2)).join('');
  }

const SIZE_OF_BATCH_INFO = 12;

export class DkrLevelSegment {
    private triangleBatches: Array<DkrTriangleBatch>;
    private transTexDrawCalls = Array<DkrDrawCall>();

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, level: DkrLevel, levelData: Uint8Array, offset: number, 
        textureCache: DkrTextureCache, textureIndices: Array<number>, opaqueTextureDrawCalls: any) {
        let verticesOffset = bytesToInt(levelData, offset + 0x00);
        let numberOfVertices = bytesToShort(levelData, offset + 0x1C);
        let trianglesOffset = bytesToInt(levelData, offset + 0x04);
        let numberOfTriangles = bytesToShort(levelData, offset + 0x1E);
        let triangleBatchInfoOffset = bytesToInt(levelData, offset + 0x0C);
        let numberOfTriangleBatches = bytesToShort(levelData, offset + 0x20);

        //let vertices = getRange(levelData, verticesOffset, numberOfVertices * SIZE_OF_VERTEX);
        //let triangles = getRange(levelData, trianglesOffset, numberOfTriangles * SIZE_OF_TRIANGLE_FACE);
        //let triBatches = getRange(levelData, triangleBatchInfoOffset, numberOfTriangleBatches * SIZE_OF_BATCH_INFO);
        
        this.triangleBatches = new Array(numberOfTriangleBatches);
        
        for (let i = 0; i < numberOfTriangleBatches; i++) {
            let ti = triangleBatchInfoOffset + (i * SIZE_OF_BATCH_INFO); // Triangle batch info index
            let tiNext = ti + SIZE_OF_BATCH_INFO;
            
            if(levelData[ti] != 0xFF) {    
                let textureIndex = textureIndices[levelData[ti]];
                textureCache.get3dTexture(textureIndex, (texture: DkrTexture) => {
                    this.parseBatch(device, renderHelper, levelData, i, ti, tiNext, verticesOffset, trianglesOffset, texture, textureIndex);
                    const layer = texture.getLayer()
                    if(layer == GfxRendererLayer.OPAQUE || layer == GfxRendererLayer.BACKGROUND) {
                        if(opaqueTextureDrawCalls[textureIndex] == undefined) {
                            opaqueTextureDrawCalls[textureIndex] = new DkrDrawCall(device, texture);
                        }
                        if(!!this.triangleBatches[i]) {
                            opaqueTextureDrawCalls[textureIndex].addTriangleBatch(this.triangleBatches[i]);
                        }
                    } else {
                        let drawCall = new DkrDrawCall(device, texture);
                        if(!!this.triangleBatches[i]) {
                            drawCall.addTriangleBatch(this.triangleBatches[i]);
                            drawCall.build();
                            this.transTexDrawCalls.push(drawCall);
                            if(CURRENT_LEVEL_ID === 10 && textureIndex === 317) {
                                // Hack to properly scroll the waterfalls in Crescent Island
                                level.addDrawCallScrollerForCrescentIsland(drawCall, i);
                            }
                        }
                    }
                });
            } else {
                if(opaqueTextureDrawCalls['noTex'] == undefined) {
                    opaqueTextureDrawCalls['noTex'] = new DkrDrawCall(device, null);
                }
                this.parseBatch(device, renderHelper, levelData, i, ti, tiNext, verticesOffset, trianglesOffset, null, 0);
                if(!!this.triangleBatches[i]) {
                    opaqueTextureDrawCalls['noTex'].addTriangleBatch(this.triangleBatches[i]);
                }
            }
            
        }
    }

    private parseBatch(device: GfxDevice, renderHelper: GfxRenderHelper, levelData: Uint8Array, 
        i: number, ti: number, tiNext: number, verticesOffset: number, trianglesOffset: number, 
        texture: DkrTexture | null, textureIndex: number) {
        let curVertexOffset = bytesToShort(levelData, ti + 0x02);
        let curTrisOffset = bytesToShort(levelData, ti + 0x04);
        let nextVertexOffset = bytesToShort(levelData, tiNext + 0x02);
        let nextTrisOffset = bytesToShort(levelData, tiNext + 0x04);
        let batchVerticesOffset = verticesOffset + (curVertexOffset * SIZE_OF_VERTEX);
        let batchTrianglesOffset = trianglesOffset + (curTrisOffset * SIZE_OF_TRIANGLE_FACE);
        let numberOfTrianglesInBatch = nextTrisOffset - curTrisOffset;
        let numberOfVerticesInBatch = nextVertexOffset - curVertexOffset;
        let flags = bytesToUInt(levelData, ti + 0x08);

        this.triangleBatches[i] = new DkrTriangleBatch(
            device, 
            renderHelper,
            getRange(levelData, batchTrianglesOffset, numberOfTrianglesInBatch * SIZE_OF_TRIANGLE_FACE), 
            getRange(levelData, batchVerticesOffset, numberOfVerticesInBatch * SIZE_OF_VERTEX), 
            0,
            flags,
            texture
        );
    }

    public destroy(device: GfxDevice): void {
        for(let i = 0; i < this.transTexDrawCalls.length; i++) {
            this.transTexDrawCalls[i].destroy(device);
        }
    }
    
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const params = {
            modelMatrices: [IDENTITY_MATRIX],
            textureFrame: -1,
            isSkydome: false,
            usesNormals: false,
            overrideAlpha: null,
            objAnim: null,
            objAnimIndex: 0,
        };
        for(let i = 0; i < this.transTexDrawCalls.length; i++) {
            this.transTexDrawCalls[i].prepareToRender(device, renderInstManager, viewerInput, params);
        }
    }


    
}