import { mat4 } from "gl-matrix";
import { RwEngine, RwIm3DPipeline, RwIm3DTransformFlags, RwIm3DVertex, RwPrimitiveType } from "../rwcore.js";
import { RwGfxVertexBuffer } from "../rwgfx.js";
import { White } from "../../../Color.js";

export class Im3DPipeline implements RwIm3DPipeline {
    private static readonly MAX_VERTICES = 65536;
    private static readonly MAX_INDICES = 65536;

    private vertexBuffer: RwGfxVertexBuffer;
    private ltm = mat4.create();
    private flags: RwIm3DTransformFlags;

    public init(rw: RwEngine) {
        this.vertexBuffer = rw.gfx.createDynamicVertexBuffer(Im3DPipeline.MAX_VERTICES);
    }

    public destroy(rw: RwEngine) {
        rw.gfx.destroyBuffer(this.vertexBuffer);
    }

    public transform(rw: RwEngine, verts: RwIm3DVertex[], ltm: mat4 | null, flags: RwIm3DTransformFlags) {
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

        this.vertexBuffer.vertexCount = verts.length;

        for (let i = 0; i < verts.length; i++) {
            rw.gfx.fillVertexPosition(this.vertexBuffer, i, verts[i].x, verts[i].y, verts[i].z);
            rw.gfx.fillVertexColor(this.vertexBuffer, i, verts[i].r, verts[i].g, verts[i].b, verts[i].a);

            if (flags & RwIm3DTransformFlags.VERTEXUV) {
                rw.gfx.fillVertexTexCoord(this.vertexBuffer, i, verts[i].u, verts[i].v);
            }
        }
        
        rw.gfx.uploadVertexBuffer(this.vertexBuffer);

        return true;
    }

    public renderPrimitive(rw: RwEngine, primType: RwPrimitiveType) {
        if (primType !== RwPrimitiveType.TRILIST) {
            console.error(`Only TRILIST supported`);
            return;
        }

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

        rw.gfx.drawArrays(this.vertexBuffer);
    }

    public end(rw: RwEngine) {
    }
}