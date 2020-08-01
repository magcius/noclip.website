import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { mat4 } from "gl-matrix";
import { UVTX } from "./UVTX";
import { UVMD, UVMDRenderer } from "./UVMD";
import { parseVertices, parseTriangles } from "./Common";
import { Material, MaterialRenderer } from "../MaterialRenderer";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../../viewer";

export class UVCT {
    public uvmds: [UVMD, mat4][] = [];
    public indexData: Uint16Array;
    public triFlags: Uint16Array;
    public materials: Material[] = [];

    // TODO flesh out with more revEng
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();

        // TODO: do these mean the same things as in PW64?
        const vertCount = view.getUint16(0);
        const faceCount = view.getUint16(2);
        const modelCount = view.getUint16(4);
        const materialCount = view.getUint16(6);
        let curPos = 8;

        // TODO: what do these do? why do most UV formats have 3 floats?
        const unk_float_1 = view.getFloat32(curPos + 0);
        const unk_float_2 = view.getFloat32(curPos + 4);
        const unk_float_3 = view.getFloat32(curPos + 8);
        curPos += 12;

        // Copied (with some modifications) from PW64
        // TODO: why is there this and also the materials?
        // TODO: try rendering this
        this.indexData = new Uint16Array(3 * faceCount);
        this.triFlags = new Uint16Array(faceCount);
        for (let i = 0, j = 0; i < this.indexData.length;) {
            this.indexData[i++] = view.getUint16(curPos + 0x00);
            this.indexData[i++] = view.getUint16(curPos + 0x02);
            this.indexData[i++] = view.getUint16(curPos + 0x04);
            this.triFlags[j++] = view.getUint16(curPos + 0x06);
            curPos += 0x08;
        }

        // Copied (with some modifications) from PW64
        for (let i = 0; i < modelCount; i++) {
            //TODO: verify
            const matrixCount = view.getUint8(curPos + 0);
            curPos += 1;

            let placement: mat4 = mat4.create();
            for (let j = 0; j < matrixCount; j++) {
                const wholes = curPos;
                const fracs = curPos + 0x20;
                const m00 = view.getInt16(wholes + 0x00) + view.getUint16(fracs + 0x00) / 0x10000;
                const m01 = view.getInt16(wholes + 0x02) + view.getUint16(fracs + 0x02) / 0x10000;
                const m02 = view.getInt16(wholes + 0x04) + view.getUint16(fracs + 0x04) / 0x10000;
                const m03 = view.getInt16(wholes + 0x06) + view.getUint16(fracs + 0x06) / 0x10000;
                const m10 = view.getInt16(wholes + 0x08) + view.getUint16(fracs + 0x08) / 0x10000;
                const m11 = view.getInt16(wholes + 0x0a) + view.getUint16(fracs + 0x0a) / 0x10000;
                const m12 = view.getInt16(wholes + 0x0c) + view.getUint16(fracs + 0x0c) / 0x10000;
                const m13 = view.getInt16(wholes + 0x0e) + view.getUint16(fracs + 0x0e) / 0x10000;
                const m20 = view.getInt16(wholes + 0x10) + view.getUint16(fracs + 0x10) / 0x10000;
                const m21 = view.getInt16(wholes + 0x12) + view.getUint16(fracs + 0x12) / 0x10000;
                const m22 = view.getInt16(wholes + 0x14) + view.getUint16(fracs + 0x14) / 0x10000;
                const m23 = view.getInt16(wholes + 0x16) + view.getUint16(fracs + 0x16) / 0x10000;
                const matx = view.getInt16(wholes + 0x18) + view.getUint16(fracs + 0x18) / 0x10000;
                const maty = view.getInt16(wholes + 0x1a) + view.getUint16(fracs + 0x1a) / 0x10000;
                const matz = view.getInt16(wholes + 0x1c) + view.getUint16(fracs + 0x1c) / 0x10000;
                const one = view.getInt16(wholes + 0x1e) + view.getUint16(fracs + 0x1e) / 0x10000;
                if (j == 0) { // [PW64] TODO: figure out what other matrices are for
                    placement = mat4.fromValues(
                        m00, m01, m02, m03,
                        m10, m11, m12, m13,
                        m20, m21, m22, m23,
                        matx, maty, matz, one);
                }
                assert(one === 1);

                curPos += 0x40;
            }

            const modelIndex = view.getInt16(curPos + 0);
            const x = view.getFloat32(curPos + 2);
            const y = view.getFloat32(curPos + 6);
            const z = view.getFloat32(curPos + 10);
            //TODO: this seems to be generally true but not 100%?? 
            if (matrixCount === 0) {
                assert(x === 0.0);
                assert(y === 0.0);
                assert(z === 0.0);
            }
            /* not in pw64 (not sure of types just sizes) */
            const unk_uvmd_1 = view.getFloat32(curPos + 14);
            const unk_uvmd_2 = view.getUint16(curPos + 18);
            const unk_uvmd_3 = view.getUint16(curPos + 20);


            curPos += 22;

            let uvmd = filesystem.getParsedFile(UVMD, "UVMD", modelIndex);
            this.uvmds.push([uvmd, placement]);
        }

        for (let i = 0; i < materialCount; i++) {
            // TODO: what does the upper half of this mean
            // (from PW64, might be RSP mode info?)
            const someinfo = view.getUint32(curPos + 0);
            const unk_material_1 = view.getUint32(curPos + 4);
            const unk_material_2 = view.getUint32(curPos + 8);
            const unk_material_3 = view.getUint32(curPos + 12);
            curPos += 16;
            const vertCount = view.getUint16(curPos + 0);
            const triangleCount = view.getUint16(curPos + 2);
            const unk_material_5 = view.getUint16(curPos + 4);
            const unk_material_6 = view.getUint16(curPos + 6);
            curPos += 8;

            const uvtxIndex = (someinfo & 0xFFF);
            let uvtx: UVTX | null = null;
            if (uvtxIndex !== 0xFFF) {
                uvtx = filesystem.getParsedFile(UVTX, "UVTX", uvtxIndex);
            }

            const shortCount = view.getUint16(curPos + 0);
            const commandCount = view.getUint16(curPos + 2);
            curPos += 4;

            let vertexData;
            ({ vertexData, curPos } = parseVertices(view, curPos, vertCount));

            let indexData;
            ({ indexData, curPos } = parseTriangles(view, curPos, shortCount, triangleCount));

            //TODO: what do these mean???
            const aaa1 = view.getUint16(curPos + 0);
            const aaa2 = view.getUint16(curPos + 2);
            const aaa3 = view.getUint16(curPos + 4);
            const aaa4 = view.getUint16(curPos + 6);
            curPos += 8;
            const aaa5 = view.getUint32(curPos + 0);
            const aaa6 = view.getUint32(curPos + 4);
            const aaa7 = view.getUint32(curPos + 8);
            const aaa8 = view.getUint32(curPos + 12);
            curPos += 16;


            this.materials.push({ uvtx, vertexData, indexData });
        }

        //TODO TODO TODO
        const asdfasdfasdfasd1 = view.getUint32(curPos + 0);
        const asdfasdfasdfasd2 = view.getUint32(curPos + 4);
        const asdfasdfasdfasd3 = view.getUint32(curPos + 8);
        const asdfasdfasdfasd4 = view.getUint32(curPos + 12);
        curPos += 16;
    }
}

export class UVCTRenderer {
    public materialRenderers: MaterialRenderer[] = [];
    public uvmdRenderers: Map<UVMD, UVMDRenderer> = new Map();
    constructor(public uvct: UVCT, device: GfxDevice) {
        for(let material of uvct.materials) {
            this.materialRenderers.push(new MaterialRenderer(device, material));
        }
        for(let [uvmd, placementMat] of uvct.uvmds) {
            this.uvmdRenderers.set(uvmd, (new UVMDRenderer(uvmd, device)));
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput,
        placementMatrix: mat4) {
        
        for(let matRenderer of this.materialRenderers) {
            matRenderer.prepareToRender(device, renderInstManager, viewerInput, placementMatrix);
        }

        for(let [uvmd, uvmdPlacementMat] of this.uvct.uvmds) {
            const uvmdRenderer = this.uvmdRenderers.get(uvmd)!;

            let combinedPlacementMatrix = mat4.create();
            mat4.multiply(combinedPlacementMatrix, placementMatrix, uvmdPlacementMat);

            uvmdRenderer.prepareToRender(device, renderInstManager, viewerInput, combinedPlacementMatrix);
        }
    }


    public destroy(device: GfxDevice): void {
        this.uvmdRenderers.forEach(r => r.destroy(device));
        this.materialRenderers.forEach(r => r.destroy(device));
    }
}
