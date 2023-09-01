import { mat4, quat, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { GfxTopology, convertToTriangles, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers.js";
import { assert, readString } from "../util.js";
import * as IMG from "./img.js";
import * as MOT from "./mot.js";

export interface Chunk {
    indexData: Uint16Array;
    positionData: Float32Array;
}

export interface Material {
    name: string;
    texName: string;
    bIsTransparent: boolean;
    bIsAdditive: boolean;
    bIsAlphaTest: boolean;
    bIsAlphaBlend: boolean;
    bPolyOffset: boolean;
}

export class MDS {
    public static maxJointCount: number = 48;
    public name: string;
    public joints: Joint[] = [];
    public rigidTransformJointIds: number[] = [];
    public mdts: MDT[] = [];
    public modelMats: mat4[] = [];
    public materials: Material[] = [];
    public textureDataMap: Map<string, IMG.TextureData>;
    public mot: MOT.MOT | null = null;
    public currentMotion: MOT.Motion | null = null;
    //Used by sky joints mainly (cloud rotation etc)
    public rotJointIdToAngVels: Map<number, number> = new Map<number, number>; //index to velocity
}

export interface Joint {
    id: number;
    name: string;
    parentId: number;
    bIsBillboard: boolean;
    bIsDefaultVisible: boolean;
    transform: mat4;
    //cache these for anim computation
    scale: vec3;
    translation: vec3;
    rotation: quat;
    //used by rotating objects
    extraRotMat: mat4;
}

export interface MDTSubmesh {
    materialIdx: number;
    indexData: Uint16Array;
}

export interface MDT {
    vertexData: Float32Array;
    submeshes: MDTSubmesh[];
    jointPerVertCount: number;
    parentMDS: MDS;
    jointPalette: number[];
}

export enum EAttributeDataType {
    BYTE = 0x8,
    SHORT = 0x10,
    FLOAT = 0x20
}

function vec2FromView(view: DataView, offset: number, littleEndian: boolean): vec2 {
    return vec2.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
    )
}

function vec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
    )
}

function mat4FromView(view: DataView, offset: number, littleEndian: boolean): mat4 {
    const mat = mat4.create();
    for (let i = 0; i < 16; i++)
        mat[i] = view.getFloat32(offset + 0x4 * i, littleEndian);
    return mat;
}

function parseMaterials(mds: MDS, buffer: ArrayBufferSlice, nameBuffer: ArrayBufferSlice, materialCount: number, materialChunkSize: number) {
    const view = buffer.createDataView();
    let offs = 0;

    //The material spec is quite tricky, with some materials sometimes having the exact same content while still giving different results.
    //Some external parameters not yet taken care of may be responsible for this behavior. The current approach for now is to use some heuristics
    //based on modding, observations etc and fix the annoying edge cases manually until I go back to this.

    for (let i = 0; i < materialCount; i++) {
        const matNameOffs = view.getUint32(offs + 0x30, true);
        const texNameOffs = view.getUint32(offs + 0x34, true);
        const materialFlags = view.getUint32(offs + 0x44, true);
        const flag1 = view.getUint8(offs + 0x4D);
        let bIsAlphaTest = (view.getUint8(offs + 0x4E) === 0x40 || materialFlags === 0x20a);
        let bIsAlphaBlend = materialFlags === 0x2a || materialFlags === 0x2e || materialFlags === 0xaa || materialFlags === 0x6e || ((materialFlags === 0x6f) && flag1 === 5);
        let bIsTransparent = ((materialFlags === 0xa7) && flag1 === 5) || ((materialFlags === 0xea) && flag1 === 5) || ((materialFlags === 0x6a) && flag1 === 5) || ((materialFlags === 0x026B) && flag1 === 5) || ((materialFlags === 0xab)) || ((materialFlags === 0x2b)) || ((materialFlags === 0x2e || materialFlags === 0x42e) && flag1 === 5) || ((materialFlags === 0x2f || materialFlags === 0x42f) && flag1 === 5) || (materialFlags === 0x2f && view.getInt8(offs + 0x52) > 0 && !mds.name.startsWith("m08")) || view.getInt8(offs + 0x51) === 1;
        let bIsAdditive = view.getUint32(offs + 0x48, true) === 0x2;
        let polyOffset = view.getInt8(offs + 0x52);

        //Annoying few edge cases that don't follow the above. Manually fixing for now, helps maintaining a list of non working materials for later research.
        if (mds.name === "t02_01-m.mds" && i === 3)
            bIsAlphaTest = true;
        if (mds.name === "x04i0103-m.mds" && i === 17)
            bIsTransparent = true;
        if (mds.name === "x04i0101-m.mds" && i === 5)
            bIsAlphaTest = true;
        if (mds.name === "p061a.mds" && i === 17)
            bIsAlphaBlend = false;
        if ((mds.name === "ep002.mds" || mds.name === "p026a.mds") && i === 8)
            bIsTransparent = false;
        if (mds.name === "d11i04_01-m.mds" && ((materialFlags === 0x2b) || (materialFlags === 0x2c)))
            bIsTransparent = false;
        if (mds.name === "d11i04_06-m.mds" && i === 2) {
            bIsAlphaBlend = false;
            bIsTransparent = false;
        }
        if (mds.name === "c01i02_10-m.mds" && i === 10)
            bIsAlphaBlend = true;
        if (mds.name === "c01i03_01-m.mds" && (i === 9 || i === 15 || i === 17 || i === 19 || i === 21 || i === 26 || i === 27 || i === 28 || i === 33 || i === 36 || i === 38 || i === 32 || i === 34 || i === 44 || i === 40 || i === 46 || i === 67)) {
            bIsTransparent = true;
        }
        if (mds.name === "c01i03_10-m.mds" && (i === 6))
            bIsTransparent = true;
        if (mds.name === "heiei-m.mds" && (i === 1 || i === 8))
            bIsTransparent = true;
        if (mds.name === "c01i0602-m.mds" && (i >= 11 && i <= 15))
            bIsTransparent = true;
        if (mds.name === "d0504-m.mds" && (i === 13))
            bIsTransparent = true;
        if (mds.name === "d01_03-m.mds" && (i === 6 || i === 7))
            bIsTransparent = true;
        if (mds.name === "s04i01-m.mds" && (i === 18 || i === 19 || i === 36))
            bIsTransparent = true;
        if (mds.name === "s04i01-m.mds" && (i === 49))
            bIsTransparent = false;
        if (mds.name === "m01i07_09-m.mds" && (i === 0))
            bIsAdditive = false;
        if (mds.name === "z03_01-m.mds" && (i === 7))
            bIsTransparent = true;
        if (mds.name === "z03_05-m.mds" && (i === 9))
            bIsTransparent = true;
        if (mds.name === "z03_06-m.mds" && (i === 20))
            bIsTransparent = true;
        if (mds.name === "m08i01_01-m.mds" && (i === 9))
            bIsTransparent = false;
        if (mds.name === "m10i04_taimatu-m.mds" && (i === 1))
            bIsTransparent = false;
        if (mds.name === "m11i04-m.mds" && (i === 7))
            bIsTransparent = false;
        if (mds.name === "s05i01-m.mds" && (i === 60))
            bIsTransparent = true;
        if (mds.name === "h20_01-m.mds")
            bIsAlphaBlend = true;
        if (mds.name === "s16_06-m.mds" && (i === 14 || i === 15))
            bIsTransparent = false;
        if (mds.name === "s16_10-m.mds" && (i === 24))
            bIsTransparent = false;
        if (mds.name === "t01i07_01-m.mds" && (i === 5))
            bIsTransparent = false;
        if (mds.name === "x04i02_01-m.mds" && (i === 7))
            polyOffset = 0;
        if (mds.name === "x04_g04-m.mds" && (i === 3))
            bIsAlphaBlend = true;
        if (mds.name === "x02i02_01-m.mds" && (i === 43))
            bIsAlphaBlend = true;
        if (mds.name === "x01i05_06-m.mds" && (i === 9))
            bIsAlphaBlend = true;
        if (mds.name === "x01i09_06-m.mds" && (i === 16))
            bIsAlphaBlend = true;
        if (mds.name === "x01i09_05-m.mds" && (i >= 40 && i <= 46))
            bIsTransparent = false;
        if (mds.name === "x01i09_05-m.mds" && (i === 16))
            bIsTransparent = true;
        if (mds.name === "p13-m.mds" && (i >= 15))
            bIsTransparent = false;
        if (mds.name === "p14-m.mds" && (i === 30))
            bIsTransparent = true;
        if (mds.name === "p02-m.mds" && (i === 6))
            bIsTransparent = false;
        if (mds.name === "r02i01_10-m.mds" && (i === 2))
            bIsTransparent = true;
        if (mds.name === "r02i01_11-m.mds" && (i === 0))
            bIsTransparent = true;
        if (mds.name === "s02i01_01-m.mds" && (i === 59))
            bIsTransparent = true;
        if (mds.name === "s23_01-m.mds" && (i === 50))
            bIsTransparent = true;
        if (mds.name === "s02i02_01-m.mds" && (i === 30))
            bIsTransparent = true;
        if (mds.name === "s38i01_01-m.mds" && (i === 20 || i === 21 || i === 23 || i === 64 || i === 65 || i === 66))
            bIsTransparent = true;
        if (mds.name === "kaigi-m.mds" && (i === 11 || i === 47))
            bIsTransparent = true;
        if (mds.name === "s19i01_12-m.mds" && (i === 1))
            bIsTransparent = true;
        if (mds.name === "s02i02_01-m.mds" && (i === 28 || i === 31))
            bIsTransparent = true;
        if (mds.name === "s02i02_02-m.mds" && (i === 15) && mds.joints.length !== 44)
            bIsTransparent = true;
        if (mds.name === "s02i02_02-m.mds" && (i === 13) && mds.joints.length === 44)
            bIsTransparent = true;

        offs += materialChunkSize;

        const matName = readString(nameBuffer, matNameOffs);
        let texName = readString(nameBuffer, texNameOffs);

        //Some environmental texture animations (uv scrolling, copying etc) use an empty placeholder. Until proper support for these is implemented, put the correct textures
        //manually just like the animation would do.
        if (texName === "d12i01_moya")
            texName += "0";
        else if (texName === "d12_moya")
            texName += "0";
        else if (texName === "migiwa3w")
            texName = "migiwa3";
        else if (texName === "bf01_12")
            texName += "b";
        else if (texName === "d01w01")
            texName = "d01w03";
        else if (texName === "m07_g14")
            texName += "a";
        else if (texName === "f01g08_14")
            texName += "a";
        else if (texName === "x05i01_13")
            texName = "x05i01_12";
        else if (texName === "x05i01_15")
            texName = "x05i01_14";
        else if (texName === "scroll1w")
            texName = "scroll1";
        else if (texName === "scroll2w")
            texName = "scroll2";
        else if (texName === "sea")
            texName = "sea1";
        else if (texName === "s04_12")
            texName += "a";
        else if (texName === "sinden1hari")
            texName = "sinden1ani";
        else if (texName === "sinden2hari")
            texName = "sinden2ani";
        else if (texName === "namihari")
            texName = "namiani";
        else if (texName === "taikohari")
            texName = "taikoani";
        else if (texName === "harphari")
            texName = "harpani";
        else if (texName === "harphari2")
            texName = "harpani2";
        else if (texName === "taikohari2")
            texName = "taikoani";
        else if (texName === "hosi")
            texName = "hosiani";
        else if (texName === "s50i12" || texName === "s50i13")
            texName += "a";
        else if (texName === "m10_32_dummy")
            texName = "m10_32_a";
        else if (texName === "m10_33_dummy")
            texName = "m10_33_a";
        else if (texName === "x01bf01_12")
            texName += "b";
        else if (texName === "t02i01_03" || texName === "t02i01_08")
            texName = "hamon_24";
        else if (texName === "f01g03_28")
            texName = "f01g03_18";
        else if (texName === "kawa")
            texName += "5";
        else if (texName === "gnami")
            texName += "b";
        mds.materials.push({ name: matName, texName: texName, bIsTransparent: bIsTransparent, bIsAlphaBlend: bIsAlphaBlend, bIsAlphaTest: bIsAlphaTest, bIsAdditive: bIsAdditive, bPolyOffset: polyOffset > 0 });
    }
}

function parseSkeleton(mds: MDS, buffer: ArrayBufferSlice, nameBuffer: ArrayBufferSlice, jointCount: number, bSkelModelMat: boolean) {
    const view = buffer.createDataView();
    let offs = 0;
    const modelMats: mat4[] = [];
    const pInv = mat4.create();
    for (let i = 0; i < jointCount; i++) {
        const jNameOffs = view.getUint32(offs, true);
        const mdtIdx = view.getInt32(offs + 0xC, true);
        const parentIdx = view.getInt32(offs + 0x10, true);
        const bIsBillboard = view.getInt32(offs + 0x14, true) === 3 || view.getInt32(offs + 0x14, true) === 5 || view.getInt32(offs + 0x14, true) === 2 || view.getInt32(offs + 0x14, true) === 4 ? true : false; //Probably some flags but this works for now
        const bIsDefaultVisible = view.getUint8(offs + 0x1F) ? true : false;
        let jointLocalMat = mat4FromView(view, offs + 0x20, true);
        let jointModelMat = mat4FromView(view, offs + 0x60, true);
        const jName = readString(nameBuffer, jNameOffs);
        offs += 0xa0;
        if (bSkelModelMat) {
            if (parentIdx >= 0) {
                if (jointModelMat[15] === 1) {
                    mat4.invert(pInv, modelMats[parentIdx]);
                    mat4.mul(jointLocalMat, pInv, jointModelMat);
                }
                else {
                    mat4.mul(jointModelMat, modelMats[parentIdx], jointLocalMat);
                }
            }
        }
        else {
            if (parentIdx >= 0)
                mat4.mul(jointModelMat, modelMats[parentIdx], jointLocalMat);
            else
                mat4.copy(jointModelMat, jointLocalMat);
        }
        if (mds.name.startsWith("mizusibuki")) {
            jointModelMat = mat4.create();
            jointLocalMat = mat4.create();
        }
        modelMats.push(jointModelMat);

        mds.joints.push({ id: i, name: jName, parentId: parentIdx, bIsBillboard: bIsBillboard, bIsDefaultVisible: bIsDefaultVisible, transform: jointLocalMat, scale: mat4.getScaling(vec3.create(), jointLocalMat), translation: mat4.getTranslation(vec3.create(), jointLocalMat), rotation: mat4.getRotation(quat.create(), jointLocalMat), extraRotMat: mat4.create() });
        if (mdtIdx >= 0)
            mds.rigidTransformJointIds.push(i);
    }
    mds.modelMats = modelMats;
}

function parseMDTs(mds: MDS, buffer: ArrayBufferSlice, MDTCount: number, bIsFromChar: boolean = false) {
    const view = buffer.createDataView();
    let offs = 0;
    const mdts: MDT[] = [];
    if (mds.name === "s38i01_01-m.mds" || mds.name === "m11-m.mds" || mds.name === "s16_11-m.mds")
        bIsFromChar = true;
    for (let u = 0; u < MDTCount; u++) {
        assert(view.getUint32(offs, true) === 0x54444D20);
        const attributeHeaderOffs = view.getUint32(offs + 0x8, true);
        const MDTSize = view.getUint32(offs + 0xC, true);

        const posType: EAttributeDataType = view.getUint8(offs + 0x10);
        const normType: EAttributeDataType = view.getUint8(offs + 0x11);
        const uvType: EAttributeDataType = view.getUint8(offs + 0x12);
        const jIType: EAttributeDataType = view.getUint8(offs + 0x14);
        const jWType: EAttributeDataType = view.getUint8(offs + 0x15);

        const posQuantScale = vec3FromView(view, offs + 0x20, true);
        const uvQuantScale = vec2FromView(view, offs + 0x50, true);

        const indexOffset = view.getUint32(offs + 0x74, true);
        const posCount = view.getUint32(offs + attributeHeaderOffs, true);
        const posOffset = view.getUint32(offs + attributeHeaderOffs + 0x4, true);
        const nCount = view.getUint32(offs + attributeHeaderOffs + 0x8, true);
        const nOffset = view.getUint32(offs + attributeHeaderOffs + 0xC, true);
        const uvCount = view.getUint32(offs + attributeHeaderOffs + 0x10, true);
        const uvOffset = view.getUint32(offs + attributeHeaderOffs + 0x14, true);
        const vColCount = view.getUint32(offs + attributeHeaderOffs + 0x18, true);
        const vColOffset = view.getUint32(offs + attributeHeaderOffs + 0x1C, true);
        const jointPerVertCount = view.getUint32(offs + attributeHeaderOffs + 0x20, true);
        assert(jointPerVertCount === 0 || jointPerVertCount === 4);
        const jWOffset = view.getUint32(offs + attributeHeaderOffs + 0x24, true);
        const jIOffset = view.getUint32(offs + attributeHeaderOffs + 0x28, true);

        if (!uvCount) {
            offs += MDTSize;
            continue;
        }


        let offsetToNextSubmesh = 1;
        let currentSubmeshStart = indexOffset;
        const finalAttribs: number[] = [];
        const submeshes: MDTSubmesh[] = [];
        const idxTripletToFinalIdx = new Map<String, number>();
        const jointSeenMap = new Map<number, number>();
        const jointPalette = [];

        const scratchVecPos = vec3.create();

        do {
            offsetToNextSubmesh = view.getUint32(offs + currentSubmeshStart, true);
            const polyType = view.getUint16(offs + currentSubmeshStart + 0x4, true); //Probably lower bits of second byte
            if (polyType !== 3 && polyType !== 4) {
                break;
            }
            const idxCount = view.getUint16(offs + currentSubmeshStart + 0x6, true);
            const posIdxBufferOffset = view.getUint32(offs + currentSubmeshStart + 0x10, true);
            const materialIndex = view.getUint32(offs + currentSubmeshStart + 0x20, true);
            const uvIdxBufferOffset = view.getUint32(offs + currentSubmeshStart + 0x24, true);
            const normIdxBufferOffset = view.getUint32(offs + currentSubmeshStart + 0x28, true);
            const vColIdxBufferOffset = view.getUint32(offs + currentSubmeshStart + 0x2C, true);

            if (uvIdxBufferOffset === 0) {
                currentSubmeshStart += offsetToNextSubmesh;
                continue;
            }

            const posIdxBuffer = new Uint16Array(idxCount);
            posIdxBuffer.set(buffer.createTypedArray(Uint16Array, offs + currentSubmeshStart + posIdxBufferOffset, idxCount));
            const normIdxBuffer = new Uint16Array(idxCount);
            normIdxBuffer.set(buffer.createTypedArray(Uint16Array, offs + currentSubmeshStart + normIdxBufferOffset, idxCount));
            const uvIdxBuffer = new Uint16Array(idxCount);
            uvIdxBuffer.set(buffer.createTypedArray(Uint16Array, offs + currentSubmeshStart + uvIdxBufferOffset, idxCount));
            const vColIdxBuffer = new Uint16Array(idxCount);
            vColIdxBuffer.set(buffer.createTypedArray(Uint16Array, offs + currentSubmeshStart + vColIdxBufferOffset, idxCount));

            const finalIndices = new Uint16Array(idxCount);
            for (let i = 0; i < idxCount; i++) {
                // if(!normIdxBufferOffset) //Red's den next to main has no norm buffer
                //     continue;
                const triplet = [posIdxBuffer[i], normIdxBuffer[i], uvIdxBuffer[i], vColIdxBuffer[i]].toString();

                //If the triplet was never seen before, update the hashmap and the relevant attribute data to the vertex buffer.
                if (!idxTripletToFinalIdx.has(triplet)) {

                    idxTripletToFinalIdx.set(triplet, idxTripletToFinalIdx.size);
                    //Positions
                    if (posType === EAttributeDataType.FLOAT) {
                        for (let j = 0; j < 3; j++) {
                            scratchVecPos[j] = view.getFloat32(offs + attributeHeaderOffs + posOffset + posIdxBuffer[i] * 12 + j * 4, true);
                        }
                        if (bIsFromChar)
                            vec3.transformMat4(scratchVecPos, scratchVecPos, mds.modelMats[mds.rigidTransformJointIds[u]]);
                        for (let j = 0; j < 3; j++) {
                            finalAttribs.push(scratchVecPos[j]);
                        }
                    }
                    else if (posType === EAttributeDataType.SHORT) {
                        for (let j = 0; j < 3; j++) {
                            scratchVecPos[j] = view.getInt16(offs + attributeHeaderOffs + posOffset + posIdxBuffer[i] * 6 + j * 2, true) / 32768 * posQuantScale[j];
                        }
                        if (bIsFromChar)
                            vec3.transformMat4(scratchVecPos, scratchVecPos, mds.modelMats[mds.rigidTransformJointIds[u]]);
                        for (let j = 0; j < 3; j++) {
                            finalAttribs.push(scratchVecPos[j]);
                        }
                    }
                    else
                        throw "Unsupported position datatype";

                    //Normal coords
                    if (normIdxBufferOffset) {
                        if (normType === EAttributeDataType.FLOAT) {
                            for (let j = 0; j < 3; j++) {
                                finalAttribs.push(view.getFloat32(offs + attributeHeaderOffs + nOffset + normIdxBuffer[i] * 12 + j * 4, true));
                            }
                        }
                        else if (normType === EAttributeDataType.BYTE) {
                            for (let j = 0; j < 3; j++) {
                                finalAttribs.push(view.getInt8(offs + attributeHeaderOffs + nOffset + normIdxBuffer[i] * 3 + j) / 128);
                            }
                        }
                        else
                            throw "Unsupported normal datatype";
                    }
                    else {
                        for (let j = 0; j < 3; j++)
                            finalAttribs.push(0); //Do this properly later, temporary hack to avoid changing layouts;
                    }

                    //UVs
                    if (uvType === EAttributeDataType.FLOAT) {
                        for (let j = 0; j < 2; j++) {
                            finalAttribs.push(view.getFloat32(offs + attributeHeaderOffs + uvOffset + uvIdxBuffer[i] * 8 + j * 4, true));
                        }
                    }
                    else if (uvType === EAttributeDataType.SHORT) {
                        for (let j = 0; j < 2; j++) {
                            finalAttribs.push(view.getInt16(offs + attributeHeaderOffs + uvOffset + uvIdxBuffer[i] * 4 + j * 2, true) / 32768 * uvQuantScale[j]);
                        }
                    }
                    else if (uvType === EAttributeDataType.BYTE) {
                        for (let j = 0; j < 2; j++) {
                            finalAttribs.push(view.getUint8(offs + attributeHeaderOffs + uvOffset + uvIdxBuffer[i] * 2 + j) / 128 * uvQuantScale[j]);
                        }
                    }
                    else
                        throw "Unsupported uv datatype";

                    //Vcol: irrelevant datatype? 0x10 bits while data is obviously bytes, see m01h02-m for ex
                    if (vColIdxBufferOffset) {
                        for (let j = 0; j < 4; j++) {
                            finalAttribs.push(view.getUint8(offs + attributeHeaderOffs + vColOffset + vColIdxBuffer[i] * 4 + j) / 128);
                        }
                    }
                    else {
                        finalAttribs.push(1);
                        finalAttribs.push(1);
                        finalAttribs.push(1);
                        finalAttribs.push(1);
                    }

                    if (jointPerVertCount) {
                        //Joint index
                        if (jIType === EAttributeDataType.SHORT) {
                            for (let j = 0; j < jointPerVertCount; j++) {
                                const idx = view.getInt16(offs + attributeHeaderOffs + jIOffset + posIdxBuffer[i] * 2 * jointPerVertCount + j * 2, true);
                                if (!jointSeenMap.has(idx) && idx >= 0) {
                                    jointSeenMap.set(idx, jointSeenMap.size);
                                    jointPalette.push(idx);
                                    if (jointPalette.length > MDS.maxJointCount)
                                        throw "More matrices needed";
                                }
                                if (idx >= 0)
                                    finalAttribs.push(jointSeenMap.get(idx) as number);
                                else
                                    finalAttribs.push(0); //weight will be zero anyways
                            }
                        }
                        else
                            throw "Unsupported joint index datatype";
                        //Joint weight
                        if (jWType === EAttributeDataType.SHORT) {
                            for (let j = 0; j < jointPerVertCount; j++) {
                                finalAttribs.push(view.getUint16(offs + attributeHeaderOffs + jWOffset + posIdxBuffer[i] * 2 * jointPerVertCount + j * 2, true) / 32768);
                            }
                        }
                        else
                            throw "Unsupported joint weight datatype";
                    }
                    else if (bIsFromChar) {
                        const idx = mds.rigidTransformJointIds[mdts.length];
                        if (!jointSeenMap.has(idx) && idx >= 0) {
                            jointSeenMap.set(idx, jointSeenMap.size);
                            jointPalette.push(idx);
                            if (jointPalette.length > MDS.maxJointCount)
                                throw "More matrices needed";
                        }
                        if (idx >= 0)
                            finalAttribs.push(jointSeenMap.get(idx) as number);
                        else
                            finalAttribs.push(0); //weight will be zero anyways
                        finalAttribs.push(0);
                        finalAttribs.push(0);
                        finalAttribs.push(0);
                        finalAttribs.push(1);
                        finalAttribs.push(0);
                        finalAttribs.push(0);
                        finalAttribs.push(0);
                    }
                }

                finalIndices[i] = idxTripletToFinalIdx.get(triplet) as number;
            }

            //Convert tristrips to tris if relevant
            if (polyType === 4) {
                const convertedFinalIndices = new Uint16Array(getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriStrips, idxCount));
                convertToTriangles(convertedFinalIndices, 0, GfxTopology.TriStrips, finalIndices);
                submeshes.push({ materialIdx: materialIndex, indexData: convertedFinalIndices });
            }
            else {
                submeshes.push({ materialIdx: materialIndex, indexData: finalIndices });
            }

            currentSubmeshStart += offsetToNextSubmesh;
        } while (offsetToNextSubmesh);

        const mdt: MDT = { vertexData: new Float32Array(finalAttribs), submeshes: submeshes, jointPerVertCount: bIsFromChar ? 4 : jointPerVertCount, parentMDS: mds, jointPalette: jointPalette };
        mdts.push(mdt);
        offs += MDTSize;
    }
    mds.mdts = mdts;
}


export function parse(buffer: ArrayBufferSlice, name: string, textureDataMap: Map<string, IMG.TextureData>, bIsFromChar: boolean = false, bSkelModelMat: boolean = false): MDS {
    const view = buffer.createDataView();
    const mds = new MDS();
    mds.name = name.split('/').pop()!;

    const magic = readString(buffer, 0x01, 0x03);
    assert(magic === 'MDS');
    //version at 0x4
    const jointSectionOffset = view.getUint32(0x08, true);
    const jointCount = view.getUint32(0xC, true);
    const MDTCount = view.getUint32(0x20, true);
    const MDTSectionOffset = view.getUint32(0x24, true);
    //unk at 0x28
    const materialCount = view.getUint32(0x2C, true);
    const materialChunkSize = view.getUint32(0x30, true);
    const materialSectionOffset = view.getUint32(0x34, true);
    const nameSectionOffset = view.getUint32(0x38, true);
    const nameSectionSize = view.getUint32(0x3C, true);
    const nameSection = buffer.slice(nameSectionOffset, nameSectionOffset + nameSectionSize);
    parseSkeleton(mds, buffer.slice(jointSectionOffset, jointSectionOffset + jointCount * 0xa0), nameSection, jointCount, bSkelModelMat);
    parseMaterials(mds, buffer.slice(materialSectionOffset), nameSection, materialCount, materialChunkSize);
    parseMDTs(mds, buffer.slice(MDTSectionOffset), MDTCount, bIsFromChar);

    mds.textureDataMap = textureDataMap;

    return mds;
}

export function createFireMDS(name: string, scale: vec3, textureDataMap: Map<string, IMG.TextureData>): MDS {
    const mds = new MDS();
    mds.name = name;
    mds.textureDataMap = textureDataMap;
    const rigidJointT = mat4.fromTranslation(mat4.create(), vec3.fromValues(0, -2, 0));
    mds.joints.push({ id: 0, name: "fakeRoot", parentId: -1, bIsBillboard: true, bIsDefaultVisible: true, transform: rigidJointT, scale: vec3.fromValues(1, 1, 1), translation: vec3.create(), rotation: quat.create(), extraRotMat: mat4.create() });
    mds.rigidTransformJointIds.push(0);
    mds.materials.push({ name: "fireMat", texName: "fire_01", bIsTransparent: true, bIsAlphaTest: false, bIsAlphaBlend: false, bIsAdditive: false, bPolyOffset: false });
    const indices = new Uint16Array([0, 1, 2, 2, 3, 0]);
    const submesh: MDTSubmesh = { materialIdx: 0, indexData: indices };
    const halfWidth = 10;
    const halfHeight = 2 * halfWidth;
    const finalAttribs = [
        -scale[0] * halfWidth, scale[1] * halfHeight, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
        scale[0] * halfWidth, scale[1] * halfHeight, 0, 0, 0, 1, 0.125, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
        scale[0] * halfWidth, 0, 0, 0, 0, 1, 0.125, 0.18, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
        -scale[0] * halfWidth, 0, 0, 0, 0, 1, 0, 0.18, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
    ];
    const jointPalette = [0];

    const mdt: MDT = { vertexData: new Float32Array(finalAttribs), submeshes: [submesh], jointPerVertCount: 4, parentMDS: mds, jointPalette: jointPalette };
    mds.mdts = [mdt];

    return mds;
}
