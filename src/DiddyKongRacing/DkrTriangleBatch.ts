import { GfxBuffer, GfxDevice, GfxInputLayout, GfxInputState } from "../gfx/platform/GfxPlatform";
import { DkrTexture } from "./DkrTexture";
import { assert } from "../util";
import { bytesToShort, isFlagSet } from "./DkrUtil"
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";

export const SIZE_OF_VERTEX = 10;
export const SIZE_OF_TRIANGLE_FACE = 16;

export interface DkrVertex {
    x: number, y: number, z: number,    // position
    xr: number, yg: number, zb: number, // Color / Normal
    a: number, // Alpha (Transparency)
}

export interface DkrTriangle {
    doBackface: boolean,
    i0: number, i1: number, i2: number, // indices
    u0: number, v0: number, // Texture coordinates for the first index.
    u1: number, v1: number, // Texture coordinates for the second index.
    u2: number, v2: number, // Texture coordinates for the third index.
}

// What gets sent to the shaders
export interface DkrFinalVertex {
    x: number, y: number, z: number,    // Position
    xr: number, yg: number, zb: number, // Color / Normal
    a: number,                          // Alpha (Transparency)
    u: number, v: number,               // Texture Coordinates
    originalIndex: number, // Used as a reference for object animations
}

export class DkrTriangleBatch {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    
    private vertices = Array<DkrVertex>();
    private finalVertices = Array<DkrFinalVertex>();
    private numberOfIndices = 0;

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, triangleData: Uint8Array, vertexData: Uint8Array, 
    verticesStart: number, private flags: number, private texture?: DkrTexture | null) {
        let numberOfVertices = vertexData.length / SIZE_OF_VERTEX;
        let numberOfTriangles = triangleData.length / SIZE_OF_TRIANGLE_FACE;

        // If the sizes are not integers, then something went wrong with the input data.
        assert(Number.isInteger(numberOfVertices));
        assert(Number.isInteger(numberOfTriangles));
        assert(numberOfVertices <= 32); // Up to 32 vertices can be used in a batch.
        assert(numberOfTriangles <= 16); // Up to 16 triangles can be drawn in a batch.

        let uScale = 0, vScale = 0;

        if(!!this.texture) {
            uScale = 1.0 / (this.texture.getWidth() * 32.0);
            vScale = 1.0 / (this.texture.getHeight() * 32.0);
        }

        // Read vertices. Similar to Fast3D, but without the UV coordinates.
        for(let i = 0; i < numberOfVertices; i++) {
            let vi = i * SIZE_OF_VERTEX; // vertex index
            this.vertices.push({
                x: bytesToShort(vertexData, vi+0), // X position
                y: bytesToShort(vertexData, vi+2), // Y position
                z: bytesToShort(vertexData, vi+4), // Z position
                xr: vertexData[vi+6] / 255.0,        // X unit vector or red color
                yg: vertexData[vi+7] / 255.0,        // Y unit vector or green color
                zb: vertexData[vi+8] / 255.0,        // Z unit vector or blue color
                a: vertexData[vi+9] / 255.0          // Alpha (Transparency)
            });
        }

        // Read triangles. More than just indices, also includes UV coordinates and a backface flag.
        for(let i = 0; i < numberOfTriangles; i++) {
            let fi = i * SIZE_OF_TRIANGLE_FACE; // triangle face index

            // If the first byte is 0x40, then the backface should be drawn.
            let isBackfaceVisible = isFlagSet(triangleData[fi + 0x00], 0x40);

            let v0 = triangleData[fi + 0x01];
            let v1 = triangleData[fi + 0x02];
            let v2 = triangleData[fi + 0x03];
            let uv0 = [
                bytesToShort(triangleData, fi + 0x04) * uScale,
                bytesToShort(triangleData, fi + 0x06) * vScale
            ];
            let uv1 = [
                bytesToShort(triangleData, fi + 0x08) * uScale,
                bytesToShort(triangleData, fi + 0x0A) * vScale
            ];
            let uv2 = [
                bytesToShort(triangleData, fi + 0x0C) * uScale,
                bytesToShort(triangleData, fi + 0x0E) * vScale
            ];

            this.setFinalVertex(verticesStart + v0, this.vertices[v0], uv0);
            this.setFinalVertex(verticesStart + v1, this.vertices[v1], uv1);
            this.setFinalVertex(verticesStart + v2, this.vertices[v2], uv2);
            
            if(isBackfaceVisible) {
                this.setFinalVertex(verticesStart + v0, this.vertices[v0], uv0);
                this.setFinalVertex(verticesStart + v2, this.vertices[v2], uv2);
                this.setFinalVertex(verticesStart + v1, this.vertices[v1], uv1);
            }
            
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }

    public getVertices(): Array<any> {
        return this.finalVertices;
    }

    public getFlags(): number {
        return this.flags;
    }

    private setFinalVertex(vertexIndex: number, vertex: DkrVertex, uv: any): void {
        this.finalVertices.push({
            x: vertex.x, y: vertex.y, z: vertex.z,
            xr: vertex.xr, yg: vertex.yg, zb: vertex.zb, a: vertex.a,
            u: uv[0], v: uv[1],
            originalIndex: vertexIndex, // Used as a reference for object animations.
        });
    }
}

