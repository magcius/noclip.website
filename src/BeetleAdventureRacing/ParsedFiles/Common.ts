import { assert } from "../../util";
import { mat4, vec3 } from "gl-matrix";
import { UVTX } from "./UVTX";
import { clamp } from "../../MathHelpers";
import { Filesystem } from "../Filesystem";

// TODO: all of these names may be too specific
export const enum RenderOptionMasks
{
    ENABLE_DEPTH_CALCULATIONS = 1 << 0x15,
    ENABLE_BACKFACE_CULLING  = 1 << 0x14,
    ENABLE_FRONTFACE_CULLING = 1 << 0x13,
}

export class Material {
    public vertexData: Float32Array; //obviously in BAR these are not turned into floats
    public renderOptions: number; //32-bit
    public indexData: Uint16Array; // again, in BAR this is a pointer to the displaylist commands
    public lightColors: LightColors | null; // again again, in BAR this is an index into a global array of lights
    public vertCount: number; //16-bit
    public almostAlwaysVertCount: number; //16-bit
    public triangleCount: number; //16-bit
    public loadCommandCount: number; //16-bit

// BREAKDOWN OF MATERIAL RENDER OPTIONS
// ____ SXXU VWZB FLX_ ____ tttt tttt tttt
//
// _ - never set in a file, so probably never used? (could be dynamically set)
//
// U - seems to select one set of rendering options
// VW - rendering options associated with U?
// V - another thing that selects one or more sets of rendering options?
// WZ - render options associated with V?
//
// S - geometry mode - G_TEXTURE_GEN (possibly other things)
// Z - geometry mode - G_ZBUFFER (possibly other things)
// B - geometry mode - G_CULL_BACK (possibly other things)
// F - geometry mode - G_CULL_FRONT (possibly other things)
// L - something light related (lighting enabled?)
// tttttttttttt = uvtx index
//
// (S || L) -> geometry mode - G_LIGHTING
//
//
//
//
// BREAKDOWN OF UVTX RENDER OPTIONS
// 0000 0000 0000 XX00 X00X tttt tttt tttt
//
// 0 - never set in a file, so probably never used?
// tttttttttttt = uvtx index

// For UVTX these are the only bits that are ever stored in a file: 000c97ff
// For Materials these are the only bits that are ever stored in a file: 0ff60fff





    // This is NOT in the original struct. unk_someinfo contains the uvtx's index so I assume that's how it's
    // referenced?
    public uvtx: UVTX | null;
}

class LightColors {
    public vecColor1: vec3;
    public vecColor2: vec3;
    public vecColor3: vec3;
    public packedColor1: number;
    public packedColor2: number;
    public packedColor3: number;

    // these are stored in separate arrays: TODO figure out what they mean
    // premultiplied color?
    public unk_packedVec31: number;
    public unk_packedVec32: number;
}

export function parseVertices(view: DataView, curPos: number, vertCount: number) {
    // (copied w/ modifications from PW64)
    const vertexData = new Float32Array(9 * vertCount);
    for (let j = 0; j < vertexData.length;) {
        // X, Y, Z
        vertexData[j++] = view.getInt16(curPos + 0x00);
        vertexData[j++] = view.getInt16(curPos + 0x02);
        vertexData[j++] = view.getInt16(curPos + 0x04);

        /* skip the next short, it seems to be an index/uid of some sort? */
        // texture coords (S and T) TODO: check format
        vertexData[j++] = (view.getInt16(curPos + 0x08) / 0x20);
        vertexData[j++] = (view.getInt16(curPos + 0x0A) / 0x20);

        // RGBA
        vertexData[j++] = view.getUint8(curPos + 0x0C) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0D) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0E) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0F) / 0xFF;
        curPos += 0x10;
    }
    return { vertexData, curPos };
}

export function parseTriangles(view: DataView, curPos: number, shortCount: number, triangleCount: number) {
    // BAR stores triangles as a series of shorts (as in 2-byte units)
    // which it transforms into display list commands.
    // These commands either draw triangles or load vertices into
    // vertex memory
    // Turning them into commands and then interpreting those commands
    // would be a waste, so we just directly interpret the shorts.

    // each "vertex" is really an index into the vertex data above
    let fakeVertexMemory = new Array<number>(32);
    const indexData = new Uint16Array(3 * triangleCount);
    let indexDataIndex = 0;
    for (let j = 0; j < shortCount; j++) {
        const nextShort = view.getUint16(curPos);

        // If the highest bit is not set, we read another byte
        // and use that + the short to load new verts
        if ((nextShort & 0x8000) === 0) {
            const extraByte = view.getUint8(curPos + 2);

            // Unpack parameters
            const numVerts = 1 + (((nextShort & 0x6000) >> 10) | ((extraByte & 0xE0) >> 5));
            const destIndex = extraByte & 0x1F;
            const srcIndex = nextShort & 0x1FFF;

            // Fake copy vertices, i.e. copy indices
            for (let v = 0; v < numVerts; v++) {
                fakeVertexMemory[destIndex + v] = srcIndex + v;
            }

            curPos += 3;
        }
        else { // This is just a triangle
            // The indices here are indices into vertex memory, not into
            // the vertex data loaded above.
            let a = (nextShort & 0x7c00) >> 10;
            let b = (nextShort & 0x03e0) >> 5;
            let c = (nextShort & 0x001f) >> 0;

            indexData[indexDataIndex++] = fakeVertexMemory[a];
            indexData[indexDataIndex++] = fakeVertexMemory[b];
            indexData[indexDataIndex++] = fakeVertexMemory[c];

            curPos += 2;
        }
    }

    assert(indexData.length === triangleCount * 3);
    return { indexData, curPos };
}

export function parseMaterial(view: DataView, curPos: number, filesystem: Filesystem, unknownBool: boolean) {
    const unk_someinfo = view.getUint32(curPos);

    const lightPackedColor1 = view.getUint32(curPos + 4);
    const lightPackedColor2 = view.getUint32(curPos + 8);
    const lightPackedColor3 = view.getUint32(curPos + 12);

    curPos += 16;
    const vertCount = view.getUint16(curPos);
    const triangleCount = view.getUint16(curPos + 2);
    // This is always equal to vertCount except for two materials.
    // Not sure what it means, probably not important
    const almostAlwaysVertCount = view.getUint16(curPos + 4);
    if(almostAlwaysVertCount !== vertCount) console.log(almostAlwaysVertCount + " " + vertCount);
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
    let lights = null;
    if (((unk_someinfo << 13) & 0x80000000) !== 0) {
        lights = buildLightColors(lightPackedColor1, lightPackedColor2, lightPackedColor3);
    }
    //TODO: what is this
    if ((unk_someinfo & 0x08000000) != 0) {
        unknownBool = true;
    }

    let vertexData;
    ({ vertexData, curPos } = parseVertices(view, curPos, vertCount));

    let indexData;
    ({ indexData, curPos } = parseTriangles(view, curPos, shortCount, triangleCount));


    let material: Material = {
        vertexData,
        renderOptions: unk_someinfo,
        indexData,
        lightColors: lights,
        vertCount,
        almostAlwaysVertCount,
        triangleCount,
        loadCommandCount,
        uvtx
    };
    return { material, curPos, unknownBool };
}

function buildLightColors(packedColor1: number, packedColor2: number, packedColor3: number): LightColors {
    if(packedColor1 === 0x10101000) {
        //TODO
        assert(false);
    }

    // TODO
    // these are probably global environment colors
    const unkGlobalVec31: vec3 = vec3.fromValues(NaN, NaN, NaN);
    const unkGlobalVec32: vec3 = vec3.fromValues(NaN, NaN, NaN);
    

    let vecColor1 = unpackVec3(packedColor1);
    let vecColor2 = unpackVec3(packedColor2);
    let vecColor3 = unpackVec3(packedColor3);

    let asd = vec3.create();
    vec3.mul(asd, unkGlobalVec31, vecColor2);

    let asd2 = vec3.create();
    let asd3 = vec3.create();
    vec3.mul(asd2, unkGlobalVec32, vecColor3);
    vec3.add(asd3, vecColor1, asd2);

    return {
        vecColor1,
        vecColor2,
        vecColor3,
        packedColor1,
        packedColor2,
        packedColor3,
        unk_packedVec31: packVec3(asd),
        unk_packedVec32: packVec3(asd3)
    }
}

function unpackVec3(v: number): vec3 {
    return vec3.fromValues(
        ((v >>> 0x18) & 0xff) / 0xff,
        ((v >>> 0x10) & 0xff) / 0xff,
        ((v >>> 0x08) & 0xff) / 0xff,
    );
}

function packVec3(v: vec3): number {
    return (clamp((v[0] * 255) | 0, 0, 255) << 0x18) |
        (clamp((v[1] * 255) | 0, 0, 255) << 0x10) |
        (clamp((v[2] * 255) | 0, 0, 255) << 0x08);
}

export function parseMatrix(view: DataView, curPos: number) {
    const m00 = view.getFloat32(curPos + 0x00);
    const m01 = view.getFloat32(curPos + 0x04);
    const m02 = view.getFloat32(curPos + 0x08);
    const m03 = view.getFloat32(curPos + 0x0C);
    const m10 = view.getFloat32(curPos + 0x10);
    const m11 = view.getFloat32(curPos + 0x14);
    const m12 = view.getFloat32(curPos + 0x18);
    const m13 = view.getFloat32(curPos + 0x1C);
    const m20 = view.getFloat32(curPos + 0x20);
    const m21 = view.getFloat32(curPos + 0x24);
    const m22 = view.getFloat32(curPos + 0x28);
    const m23 = view.getFloat32(curPos + 0x2C);
    const m30 = view.getFloat32(curPos + 0x30);
    const m31 = view.getFloat32(curPos + 0x34);
    const m32 = view.getFloat32(curPos + 0x38);
    const m33 = view.getFloat32(curPos + 0x3C);

    const mat = mat4.fromValues(
        m00, m01, m02, m03,
        m10, m11, m12, m13,
        m20, m21, m22, m23,
        m30, m31, m32, m33
    );
    curPos += 64;
    return { mat, curPos };
}
