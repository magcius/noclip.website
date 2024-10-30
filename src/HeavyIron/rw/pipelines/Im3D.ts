import { mat4 } from "gl-matrix";
import { RwEngine, RwIm3DPipeline, RwIm3DTransformFlags, RwIm3DVertex, RwPrimitiveType } from "../rwcore.js";
import { RwGfxIndexBuffer, RwGfxVertexBuffer } from "../rwgfx.js";
import { White } from "../../../Color.js";
import { assert } from "../../../util.js";

export class Im3DPipeline implements RwIm3DPipeline {
    private static readonly MAX_VERTICES = 65536;
    private static readonly MAX_INDICES = 65536;

    private vertexBuffer: RwGfxVertexBuffer;
    private indexBuffer: RwGfxIndexBuffer;

    private verts: RwIm3DVertex[];
    private numVerts: number;
    private ltm = mat4.create();
    private flags: RwIm3DTransformFlags;

    private tempIndices = new Uint16Array(Im3DPipeline.MAX_INDICES);

    public init(rw: RwEngine) {
        this.vertexBuffer = rw.gfx.createDynamicVertexBuffer(Im3DPipeline.MAX_VERTICES);
        this.indexBuffer = rw.gfx.createDynamicIndexBuffer(Im3DPipeline.MAX_INDICES);
    }

    public destroy(rw: RwEngine) {
        rw.gfx.destroyBuffer(this.vertexBuffer);
    }

    public transform(rw: RwEngine, verts: RwIm3DVertex[], numVerts: number, ltm: mat4 | null, flags: RwIm3DTransformFlags) {
        assert(numVerts <= verts.length);
        
        if (verts.length > Im3DPipeline.MAX_VERTICES) {
            console.error(`Max vertices allowed is ${Im3DPipeline.MAX_VERTICES}`);
            return false;
        }

        flags |= RwIm3DTransformFlags.VERTEXXYZ;
        flags |= RwIm3DTransformFlags.VERTEXRGBA;

        if (ltm) {
            mat4.copy(this.ltm, ltm);
        } else {
            mat4.identity(this.ltm);
        }
        
        this.flags = flags;
        this.verts = verts;
        this.numVerts = numVerts;

        return true;
    }

    public renderPrimitive(rw: RwEngine, primType: RwPrimitiveType) {
        for (let i = 0; i < this.numVerts; i++) {
            this.tempIndices[i] = i;
        }

        this.renderIndexedPrimitive(rw, primType, this.tempIndices, this.numVerts);
    }

    public renderIndexedPrimitive(rw: RwEngine, primType: RwPrimitiveType, indices: Uint16Array, numIndices: number) {
        assert(numIndices <= indices.length);

        // Some of this is yoinked from TopologyHelpers.ts
        let count = 0;
        switch (primType) {
        case RwPrimitiveType.TRILIST:
        case RwPrimitiveType.LINELIST:
            for (let i = 0; i < numIndices; i++) {
                this.indexBuffer.data[count++] = indices[i];
            }
            break;
        case RwPrimitiveType.TRISTRIP:
            for (let i = 2; i < numIndices; i++) {
                this.indexBuffer.data[count++] = indices[i - 2];
                this.indexBuffer.data[count++] = indices[i - (~i & 1)];
                this.indexBuffer.data[count++] = indices[i - (i & 1)];
            }
            break;
        case RwPrimitiveType.TRIFAN:
            for (let i = 0; i < numIndices - 2; i++) {
                this.indexBuffer.data[count++] = indices[0];
                this.indexBuffer.data[count++] = indices[i + 1];
                this.indexBuffer.data[count++] = indices[i + 2];
            }
            break;
        case RwPrimitiveType.POLYLINE:
            for (let i = 0; i < numIndices - 1; i++) {
                this.indexBuffer.data[count++] = indices[i];
                this.indexBuffer.data[count++] = indices[i + 1];
            }
            break;
        default:
            console.warn(`Unsupported primitive type ${primType}`);
            return;
        }

        this.indexBuffer.indexCount = count;
        
        rw.gfx.uploadIndexBuffer(this.indexBuffer);
        
        this.vertexBuffer.vertexCount = this.numVerts;

        for (let i = 0; i < this.numVerts; i++) {
            rw.gfx.fillVertexPosition(this.vertexBuffer, i, this.verts[i].x, this.verts[i].y, this.verts[i].z);
            rw.gfx.fillVertexColor(this.vertexBuffer, i, this.verts[i].r, this.verts[i].g, this.verts[i].b, this.verts[i].a);

            if (this.flags & RwIm3DTransformFlags.VERTEXUV) {
                rw.gfx.fillVertexTexCoord(this.vertexBuffer, i, this.verts[i].u, this.verts[i].v);
            }
        }
        
        rw.gfx.uploadVertexBuffer(this.vertexBuffer);

        this.setRenderStates(rw);

        rw.gfx.drawElements(this.vertexBuffer, this.indexBuffer, (primType === RwPrimitiveType.LINELIST || primType === RwPrimitiveType.POLYLINE));
    }

    public end(rw: RwEngine) {
    }

    private setRenderStates(rw: RwEngine) {
        rw.gfx.disableFog();
        rw.gfx.disableLighting();
        rw.gfx.disableNormalArray();

        rw.gfx.setModelMatrix(this.ltm);

        if (this.flags & RwIm3DTransformFlags.VERTEXRGBA) {
            rw.gfx.enableColorArray();
        } else {
            rw.gfx.disableColorArray();
        }

        if (this.flags & RwIm3DTransformFlags.VERTEXUV) {
            rw.gfx.enableTexCoordArray();
        } else {
            rw.gfx.disableTexCoordArray();
        }
        
        rw.gfx.setMaterialColor(White);

        const raster = rw.renderState.getTextureRaster();
        if (raster) {
            rw.gfx.setTextureRaster(raster);
            rw.gfx.setTextureFilter(rw.renderState.getTextureFilter());
            rw.gfx.setTextureAddressU(rw.renderState.getTextureAddressU());
            rw.gfx.setTextureAddressV(rw.renderState.getTextureAddressV());
        } else {
            rw.gfx.setTextureRaster(null);
        }
    }
}