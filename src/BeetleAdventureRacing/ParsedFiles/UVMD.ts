import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { mat4 } from "gl-matrix";
import { UVTX } from "./UVTX";
import { parseVertices, parseTriangles, parseMatrix } from "./Common";

// This is more of a placeholder while I figure out what exactly is needed.
class MoreAccurateUVMDMaterial {
    public vertexData: Float32Array; //obviously in BAR these are not turned into floats
    public unk_someinfo: number; //32-bit
    public indexData: Uint16Array; // again, in BAR this is a pointer to the displaylist commands
    public unk_someLightingThing: number; //short
    public vertCount: number; //16-bit
    public almostAlwaysVertCount: number; //16-bit
    public triangleCount: number; //16-bit
    public loadCommandCount: number; //16-bit




    // This is NOT in the original struct. unk_someinfo contains the uvtx's index so I assume that's how it's
    // referenced?
    public uvtx: UVTX | null;
}
class ModelPart {
    public materials: MoreAccurateUVMDMaterial[];
    public b5: number; //byte
    public b6: number; //byte
    public b7: number; //byte
    public sixFloats: number[];
    public unknownBool: boolean; // not 100% sure this is a boolean but like 95% sure. byte
}
class LOD {
    public modelParts: ModelPart[];
    public f: number;
    public b2: number;
}

export class UVMD {
    public lods: LOD[];
    public b3: number; //byte
    public matrices: mat4[];
    public float1: number;
    public float2: number;
    public float3: number;
    // struct also contains lodCount and partsPerLOD/matrixCount but that's redundant here
    // struct also contains pDisplayListCommands but we don't need it
    // struct also contains vertexCount but we don't need it
    // TODO: the actual struct has an extra 6 bytes after this - what is it used for?
    // This code I've manually decompiled, so it should be functionally complete
    // aside from a few bits marked TODO
    // (obviously, there's still a lot I don't understand though)
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();
        let curPos = 0;

        const lodCount = view.getUint8(curPos + 0);
        const partsPerLOD = view.getUint8(curPos + 1); // Same as transform count


        //TODO: what does this do exactly
        this.b3 = view.getUint8(curPos + 2);
        // this is always zero for some reason
        assert(view.getUint8(curPos + 3) === 0);

        // We don't actually care about these,
        // they're only used for memory allocation/storing array bounds
        const vertCount = view.getUint16(curPos + 4);
        const materialCount = view.getUint16(curPos + 6);
        const commandCount = view.getUint16(curPos + 8);
        curPos += 10;

        if ((this.b3 & 0x80) !== 0) {
            //TODO: figure out what happens here
            // seems to be 10 floats, 3 signed shorts, and 1 byte?
            curPos += 0x2F;
            console.log("b3 & 0x80 !== 0", this);
        }

        // TODO: what do these do? why do most UV formats have 3 floats?
        this.float1 = view.getFloat32(curPos + 0);
        this.float2 = view.getFloat32(curPos + 4);
        this.float3 = view.getFloat32(curPos + 8);
        curPos += 12;


        // TODO: we should be able to only read the first LOD and ignore everything else
        this.lods = [];
        for (let i = 0; i < lodCount; i++) {
            const partCount = view.getUint8(curPos);
            assert(partCount === partsPerLOD);
            // TODO: what do these do?
            const b2 = view.getUint8(curPos + 1);
            let f = view.getFloat32(curPos + 2);
            f = f * f;
            curPos += 6;

            const modelParts: ModelPart[] = [];

            for (let j = 0; j < partCount; j++) {
                // TODO: what do all of these mean?
                const b5 = view.getUint8(curPos + 0);
                const b6 = view.getUint8(curPos + 1);
                const b7 = view.getUint8(curPos + 2);
                curPos += 3;
                const sixFloats = [
                    view.getFloat32(curPos + 0) * this.float2,
                    view.getFloat32(curPos + 4) * this.float2,
                    view.getFloat32(curPos + 8) * this.float2,
                    view.getFloat32(curPos + 12) * this.float2,
                    view.getFloat32(curPos + 16) * this.float2,
                    view.getFloat32(curPos + 20) * this.float2
                ];
                curPos += 24;
                const stackByte1 = view.getUint8(curPos + 0);
                const stackByte2 = view.getUint8(curPos + 1);

                const materialCount = view.getUint8(curPos + 2);
                curPos += 3;

                const materials: MoreAccurateUVMDMaterial[] = [];
                let unknownBool = false;

                for (let k = 0; k < materialCount; k++) {
                    const unk_someinfo = view.getUint32(curPos);

                    const unk_usedByLightingFn1 = view.getUint32(curPos + 4);
                    const unk_usedByLightingFn2 = view.getUint32(curPos + 8);
                    const unk_usedByLightingFn3 = view.getUint32(curPos + 12);

                    curPos += 16;
                    const vertCount = view.getUint16(curPos);
                    const triangleCount = view.getUint16(curPos + 2);
                    // This is always equal to vertCount except for a *single* model.
                    // In that model, it's 2 fewer than vertCount and the last two
                    // vertices both have their uid set to 0.
                    const almostAlwaysVertCount = view.getUint16(curPos + 4);
                    assert(almostAlwaysVertCount === vertCount);
                    // Number of G_VTX commands that will be generated
                    // (ofc we will not actually generate these)
                    const loadCommandCount = view.getUint16(curPos + 6);

                    const shortCount = view.getUint16(curPos + 8);
                    const commandCount = view.getUint16(curPos + 10);
                    curPos += 12;

                    const uvtxIndex = (unk_someinfo & 0xFFF);
                    let uvtx: UVTX | null = null;
                    if (uvtxIndex !== 0xFFF) {
                        uvtx = filesystem.getParsedFile(UVTX, "UVTX", uvtxIndex);
                    }
                    let unk_someLightingThing = -1;
                    if (((unk_someinfo << 13) & 0x80000000) !== 0) {
                        // TODO: it calls some function related to lighting
                        //  (I think it's related to lighting because of the vertex structure
                        // when something has this flag set).
                        // pass in unk_usedByLightingFn1, 2, 3
                        // unk_someLightingThing = return value of lighting function
                    }
                    //TODO: what is this
                    if ((unk_someinfo & 0x08000000) != 0) {
                        unknownBool = true;
                    }

                    let vertexData;
                    ({ vertexData, curPos } = parseVertices(view, curPos, vertCount));

                    let indexData;
                    ({ indexData, curPos } = parseTriangles(view, curPos, shortCount, triangleCount));


                    materials.push({
                        vertexData,
                        unk_someinfo,
                        indexData,
                        unk_someLightingThing,
                        vertCount,
                        almostAlwaysVertCount,
                        triangleCount,
                        loadCommandCount,
                        uvtx
                    });
                }

                modelParts.push({ materials, b5, b6, b7, sixFloats, unknownBool });
            }

            this.lods.push({ modelParts, f, b2 });
        }

        this.matrices = [];
        for (let m = 0; m < partsPerLOD; m++) {
            let mat;
            ({ mat, curPos } = parseMatrix(view, curPos));
            this.matrices.push(mat);
        }
    }
}
