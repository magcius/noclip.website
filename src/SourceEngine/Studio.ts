
// Source "Studio" models, which seem to be named because of their original ties to 3D Studio Max
// https://developer.valvesoftware.com/wiki/Studiomodel

import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { assert, readString, nArray, assertExists } from "../util";
import { SourceFileSystem, SourceRenderContext } from "./Main";
import { AABB } from "../Geometry";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { MaterialShaderTemplateBase, BaseMaterial, EntityMaterialParameters, StaticLightingMode, SkinningMode } from "./Materials";
import { GfxRenderInstManager, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { mat4, quat, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { bitsAsFloat32, getMatrixTranslation, lerp, MathConstants, setMatrixTranslation } from "../MathHelpers";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";

// Encompasses the MDL, VVD & VTX formats.

const enum StudioModelFlags {
    STATIC_PROP       = 1 << 4,
    EXTRA_VERTEX_DATA = 1 << 26,
}

const enum OptimizeStripGroupFlags {
    IS_FLEXED                      = 0x01,
    IS_HWSKINNED                   = 0x02,
    IS_DELTA_FLEXED                = 0x04,
}

const enum OptimizeStripFlags {
    IS_TRILIST                     = 0x01,
    IS_TRISTRIP                    = 0x02,
}

function computeModelMatrixPosRotInternal(dst: mat4, pitch: number, yaw: number, roll: number, pos: ReadonlyVec3): void {
    // Pitch, Yaw, Roll
    // https://github.com/ValveSoftware/source-sdk-2013/blob/master/sp/src/mathlib/mathlib_base.cpp#L1218-L1233

    const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
    const sinY = Math.sin(yaw),   cosY = Math.cos(yaw);
    const sinR = Math.sin(roll),  cosR = Math.cos(roll);

    dst[0] =  (cosP * cosY);
    dst[1] =  (cosP * sinY);
    dst[2] =  (-sinP);
    dst[3] =  0.0;

    dst[4] =  (sinP * sinR * cosY - cosR * sinY);
    dst[5] =  (sinP * sinR * sinY + cosR * cosY);
    dst[6] =  (sinR * cosP);
    dst[7] =  0.0;

    dst[8] =  (sinP * cosR * cosY + sinR * sinY);
    dst[9] =  (sinP * cosR * sinY - sinR * cosY);
    dst[10] = (cosR * cosP);
    dst[11] = 0.0;

    dst[12] = pos[0];
    dst[13] = pos[1];
    dst[14] = pos[2];
    dst[15] = 1.0;
}

export function computeModelMatrixPosQAngle(dst: mat4, pos: ReadonlyVec3, qangle: ReadonlyVec3): void {
    // QAngle is in degrees.
    const pitch = qangle[0] * MathConstants.DEG_TO_RAD;
    const yaw =   qangle[1] * MathConstants.DEG_TO_RAD;
    const roll =  qangle[2] * MathConstants.DEG_TO_RAD;
    computeModelMatrixPosRotInternal(dst, pitch, yaw, roll, pos);
}

export function computePosQAngleModelMatrix(pos: vec3 | null, qangle: vec3 | null, m: ReadonlyMat4): void {
    if (pos !== null)
        getMatrixTranslation(pos, m);

    if (qangle !== null) {
        const xyDist = Math.hypot(m[0], m[1]);
        qangle[0] = Math.atan2(-m[2], xyDist);

        if (xyDist > 0.001) {
            qangle[1] = Math.atan2(m[1], m[0]);
            qangle[2] = Math.atan2(m[6], m[10]);
        } else {
            qangle[1] = Math.atan2(-m[4], m[5]);
            qangle[2] = 0;
        }

        // QAngle is in degrees.
        vec3.scale(qangle, qangle, MathConstants.RAD_TO_DEG);
    }
}

function computeModelMatrixPosRadianEuler(dst: mat4, pos: ReadonlyVec3, radianEuler: ReadonlyVec3): void {
    // Convert Euler angles to PYR.
    // https://github.com/ValveSoftware/source-sdk-2013/blob/master/sp/src/mathlib/mathlib_base.cpp#L1182
    const pitch = radianEuler[1];
    const yaw =   radianEuler[2];
    const roll =  radianEuler[0];
    computeModelMatrixPosRotInternal(dst, pitch, yaw, roll, pos);
}

class StudioModelStripData {
    constructor(public firstIndex: number, public indexCount: number, public hardwareBoneTable: number[]) {
    }
}

class StudioModelStripGroupData {
    public stripData: StudioModelStripData[] = [];
}

const enum StudioModelMeshDataFlags {
    HasTexCoord1 = 1 << 0,
}

// TODO(jstpierre): Coalesce all buffers for a studio model?
class StudioModelMeshData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    public stripGroupData: StudioModelStripGroupData[] = [];

    constructor(cache: GfxRenderCache, public materialNames: string[], private flags: StudioModelMeshDataFlags, vertexData: ArrayBufferLike, indexData: ArrayBufferLike, public vertexCount: number) {
        const device = cache.device;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData);

        // Create our base input state.
        [this.inputLayout, this.inputState] = this.createInputState(cache, StaticLightingMode.None);
    }

    public createInputState(cache: GfxRenderCache, staticLightingMode: StaticLightingMode, colorBufferDescriptor: GfxVertexBufferDescriptor | null = null): [GfxInputLayout, GfxInputState] {
        // TODO(jstpierre): Lighten up vertex buffers by only allocating bone weights / IDs if necessary?
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialShaderTemplateBase.a_Position,    bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialShaderTemplateBase.a_Normal,      bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TangentS,    bufferIndex: 0, bufferByteOffset: 7*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_BoneWeights, bufferIndex: 0, bufferByteOffset: 11*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_BoneIDs,     bufferIndex: 0, bufferByteOffset: 15*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TexCoord01,  bufferIndex: 0, bufferByteOffset: 19*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4+4+4+4+2)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        if (!!(this.flags & StudioModelMeshDataFlags.HasTexCoord1)) {
            const lastSlot = vertexAttributeDescriptors[vertexAttributeDescriptors.length - 1];
            lastSlot.format = GfxFormat.F32_RGBA;
            vertexBufferDescriptors[0].byteStride += 2*0x04;
        }

        const bufferDescriptors: GfxVertexBufferDescriptor[] = [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ];

        if (staticLightingMode === StaticLightingMode.StudioVertexLighting) {
            assert(colorBufferDescriptor !== null);
            vertexAttributeDescriptors.push(
                { location: MaterialShaderTemplateBase.a_StaticVertexLighting0, bufferIndex: 1, bufferByteOffset: 0*0x04, format: GfxFormat.U8_RGBA_NORM, },
            );
            vertexBufferDescriptors.push(
                { byteStride: 1*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            );
            bufferDescriptors.push(colorBufferDescriptor);
        } else if (staticLightingMode === StaticLightingMode.StudioVertexLighting3) {
            assert(colorBufferDescriptor !== null);
            vertexAttributeDescriptors.push(
                { location: MaterialShaderTemplateBase.a_StaticVertexLighting0, bufferIndex: 1, bufferByteOffset: 0*0x04, format: GfxFormat.U8_RGBA_NORM, },
                { location: MaterialShaderTemplateBase.a_StaticVertexLighting1, bufferIndex: 1, bufferByteOffset: 1*0x04, format: GfxFormat.U8_RGBA_NORM, },
                { location: MaterialShaderTemplateBase.a_StaticVertexLighting2, bufferIndex: 1, bufferByteOffset: 2*0x04, format: GfxFormat.U8_RGBA_NORM, },
            );
            vertexBufferDescriptors.push(
                { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            );
            bufferDescriptors.push(colorBufferDescriptor);
        } else {
            assert(colorBufferDescriptor === null);
        }

        const indexBufferFormat = GfxFormat.U16_R;
        const inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        const inputState = cache.device.createInputState(inputLayout, bufferDescriptors, { buffer: this.indexBuffer, byteOffset: 0, });
        return [inputLayout, inputState];
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

class StudioModelLODData {
    public meshData: StudioModelMeshData[] = [];

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++)
            this.meshData[i].destroy(device);
    }
}

class StudioModelSubmodelData {
    public lodData: StudioModelLODData[] = [];

    constructor(public name: string) {
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lodData.length; i++)
            this.lodData[i].destroy(device);
    }
}

class StudioModelBodyPartData {
    public submodelData: StudioModelSubmodelData[] = [];

    constructor(private name: string) {
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.submodelData.length; i++)
            this.submodelData[i].destroy(device);
    }
}

interface FixupRemapping { copySrc: number; copyDst: number; count: number; }
function fixupRemappingSearch(fixupTable: FixupRemapping[], dstIdx: number): number {
    for (let i = 0; i < fixupTable.length; i++) {
        const map = fixupTable[i];
        const idx = dstIdx - map.copyDst;
        if (idx >= 0 && idx < map.count)
            return map.copySrc + idx;
    }

    // remap did not copy over this vertex, return as is.
    return dstIdx;
}

class BoneDesc {
    public pos = vec3.create();
    public rot = vec3.create();
    public quat = quat.create();
    public poseToBone = mat4.create();

    public posScale = vec3.create();
    public rotScale = vec3.create();

    constructor(public name: string, public parent: number) {
    }
}

const enum AnimDataFlags {
    RAWPOS  = 0x01,
    RAWROT  = 0x02,
    ANIMPOS = 0x04,
    ANIMROT = 0x08,
    DELTA   = 0x10,
    RAWROT2 = 0x20,
}

function decodeQuat64(dst: quat, view: DataView, idx: number): number {
    const b0 = view.getUint32(idx + 0x00, true);
    const b1 = view.getUint32(idx + 0x04, true);
    const xs = b0 & 0x1FFFFF;
    const ys = (((b1 & 0x03FF) << 11) | (b0 >>> 21)) >>> 0;
    const zs = (b1 >>> 10) & 0x1FFFFF;
    const wn = !!(b1 & 0x80000000) ? -1 : 1;

    dst[0] = (xs - 0x100000) / 0x100000;
    dst[1] = (ys - 0x100000) / 0x100000;
    dst[2] = (zs - 0x100000) / 0x100000;
    dst[3] = wn * Math.sqrt(1.0 - dst[0]**2 - dst[1]**2 - dst[2]**2);
    return 0x08;
}

function decodeQuat48(dst: quat, view: DataView, idx: number): number {
    const xs = view.getUint16(idx + 0x00, true);
    const ys = view.getUint16(idx + 0x02, true);
    const zsb = view.getUint16(idx + 0x04, true);
    const zs = zsb & 0x7FFF;
    const wn = !!(zsb & 0x8000) ? -1 : 1;

    dst[0] = (xs - 0x8000) / 0x8000;
    dst[1] = (ys - 0x8000) / 0x8000;
    dst[2] = (zs - 0x4000) / 0x4000;
    dst[3] = wn * Math.sqrt(1.0 - dst[0]**2 - dst[1]**2 - dst[2]**2);
    return 0x06;
}

function decodeFloat16(v: number): number {
    // https://github.com/microsoft/DirectXMath/blob/7c30ba5932e081ca4d64ba4abb8a8986a7444ec9/Inc/DirectXPackedVector.inl#L31-L65

    let mantissa = v & 0x03FF;
    let exponent = v & 0x7C00;
    if (exponent === 0x7C00) { // INF/NAN
        exponent = 0x8F;
    } else if (exponent !== 0) { // The value is normalized
        exponent = (v >>> 10) & 0x1F;
    } else if (mantissa !== 0) { // The value is denormalized
        // Normalize the value in the resulting float.
        exponent = 1;

        do {
            exponent--;
            mantissa <<= 1;
        } while ((mantissa & 0x0400) === 0);
    } else { // The value is zero
        exponent = -112;
    }

    // Convert to unsigned
    exponent >>= 0;
    mantissa >>= 0;

    const u32 = (
        ((v & 0x8000) << 16)     | // Sign
        ((exponent + 112) << 23) | // Exponent
        ((mantissa << 13))         // Mantissa
    );
    return bitsAsFloat32(u32);
}

function decodeVec48(dst: vec3, view: DataView, idx: number): number {
    dst[0] = decodeFloat16(view.getUint16(idx + 0x00, true));
    dst[1] = decodeFloat16(view.getUint16(idx + 0x02, true));
    dst[2] = decodeFloat16(view.getUint16(idx + 0x04, true));
    return 0x06;
}

function decodeAnimTrackRLE(view: DataView, offs: number, idx: number, frame: number, scale: number): [number, number] {
    if (idx === 0)
        return [0, 0];
    idx += offs;

    const i0 = frame | 0;

    // Simple RLE scheme: valid is the number of data elements, total is the number of frames
    // if total > valid, then the last data element just repeats

    let c = 0; // current frame
    let v0: number, v1: number;
    while (true) {
        const valid = view.getUint8(idx + 0x00);
        const total = view.getUint8(idx + 0x01);

        if (i0 < c + total) {
            // i0 is inside this frame segment
            let c0 = i0 - c;
            if (c0 < valid)
                v0 = view.getInt16(idx + 0x02 + c0 * 0x02, true);
            else
                v0 = view.getInt16(idx + 0x02 + (valid - 1) * 0x02, true);
            break;
        }

        idx += 0x02 + valid * 0x02;
        c += total;
    }
    v0 = v0 * scale;

    if (i0 === frame) {
        // no blending needed
        return [v0, v0];
    }

    // try to find v1
    let i1 = i0 + 1;
    while (true) {
        const valid = view.getUint8(idx + 0x00);
        const total = view.getUint8(idx + 0x01);

        if (i1 < c + total) {
            // i1 is inside this frame segment
            let c1 = i1 - c;
            if (c1 < valid)
                v1 = view.getInt16(idx + 0x02 + c1 * 0x02, true);
            else
                v1 = view.getInt16(idx + 0x02 + (valid - 1) * 0x02, true);
            break;
        }

        idx += 0x02 + valid * 0x02;
        c += total;
    }
    v1 = v1 * scale;

    return [v0, v1];
}

function quatFromRadianEuler(dst: quat, roll: number, pitch: number, yaw: number): void {
    // https://github.com/ValveSoftware/source-sdk-2013/blob/master/sp/src/mathlib/mathlib_base.cpp#L2001-L2042
    roll *= 0.5; pitch *= 0.5; yaw *= 0.5;
    const sinR = Math.sin(roll),  cosR = Math.cos(roll);
    const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
    const sinY = Math.sin(yaw),   cosY = Math.cos(yaw);
    dst[0] = sinR * cosP * cosY - cosR * sinP * sinY;
    dst[1] = cosR * sinP * cosY + sinR * cosP * sinY;
    dst[2] = cosR * cosP * sinY - sinR * sinP * cosY;
    dst[3] = cosR * cosP * cosY + sinR * sinP * sinY;
}

const scratchQuat = nArray(2, () => quat.create());
class AnimTrackData {
    public boneindex: number;
    public bone: BoneDesc;
    public flags: AnimDataFlags;
    private view: DataView;

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        this.view = view;

        this.boneindex = view.getUint8(0x00);
        this.flags = view.getUint8(0x01) as AnimDataFlags;
        // const nextoffset = view.getUint16(0x02);
    }

    public getPosRot(dstPos: vec3, dstQuat: quat, origBone: BoneDesc, frame: number): void {
        const view = this.view;
        const t = frame % 1;

        let idx = 0x04;
        if (!!(this.flags & AnimDataFlags.RAWROT)) {
            idx += decodeQuat48(dstQuat, view, idx);
        } else if (!!(this.flags & AnimDataFlags.RAWROT2)) {
            idx += decodeQuat64(dstQuat, view, idx);
        } else if (!!(this.flags & AnimDataFlags.ANIMROT)) {
            let [ix0, ix1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x00, true), frame, origBone.rotScale[0]);
            let [iy0, iy1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x02, true), frame, origBone.rotScale[1]);
            let [iz0, iz1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x04, true), frame, origBone.rotScale[2]);

            if (!(this.flags & AnimDataFlags.DELTA)) {
                ix0 += origBone.rot[0];
                iy0 += origBone.rot[1];
                iz0 += origBone.rot[2];
                ix1 += origBone.rot[0];
                iy1 += origBone.rot[1];
                iz1 += origBone.rot[2];
            }

            if (t > 0.0) {
                quatFromRadianEuler(scratchQuat[0], ix0, iy0, iz0);
                quatFromRadianEuler(scratchQuat[1], ix1, iy1, iz1);
                quat.slerp(dstQuat, scratchQuat[0], scratchQuat[1], t);
            } else {
                quatFromRadianEuler(dstQuat, ix0, iy0, iz0);
            }

            idx += 0x06;
        } else if (!!(this.flags & AnimDataFlags.DELTA)) {
            quat.identity(dstQuat);
        } else {
            quat.copy(dstQuat, origBone.quat);
        }

        if (!!(this.flags & AnimDataFlags.RAWPOS)) {
            idx += decodeVec48(dstPos, view, idx);
        } else if (!!(this.flags & AnimDataFlags.ANIMPOS)) {
            const [ix0, ix1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x00, true), frame, origBone.posScale[0]);
            const [iy0, iy1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x02, true), frame, origBone.posScale[1]);
            const [iz0, iz1] = decodeAnimTrackRLE(view, idx, view.getUint16(idx + 0x04, true), frame, origBone.posScale[2]);

            dstPos[0] = lerp(ix0, ix1, t);
            dstPos[1] = lerp(iy0, iy1, t);
            dstPos[2] = lerp(iz0, iz1, t);

            if (!(this.flags & AnimDataFlags.DELTA))
                vec3.add(dstPos, dstPos, origBone.pos);
            idx += 0x06;
        } else if (!!(this.flags & AnimDataFlags.DELTA)) {
            vec3.zero(dstPos);
        } else {
            vec3.copy(dstPos, origBone.pos);
        }
    }
}

class AnimData {
    public tracks: (AnimTrackData | null)[];

    constructor(buffer: ArrayBufferSlice, bone: BoneDesc[]) {
        const view = buffer.createDataView();

        let idx = 0x00;
        this.tracks = nArray(bone.length, () => null);
        while (true) {
            const track = new AnimTrackData(buffer.slice(idx));
            this.tracks[track.boneindex] = track;
            track.bone = bone[track.boneindex];

            const nextoffset = view.getUint16(idx + 0x02, true);
            if (nextoffset === 0)
                break;
            idx += nextoffset;
        }
    }
}

class AnimSection {
    public animdata: AnimData | null = null;

    constructor(public animblock: number, public animindex: number, public firstframe: number, public numframes: number) {
    }
}

class AnimDesc {
    public animsection: AnimSection[] = [];
    public flags: number;
    public fps: number;
    public numframes: number;
    public boneRemapTable: number[] | null = null;

    constructor(public name: string) {
    }

    public clone(boneRemapTable: number[]): AnimDesc {
        const o = new AnimDesc(this.name);
        o.animsection = this.animsection;
        o.flags = this.flags;
        o.fps = this.fps;
        o.numframes = this.numframes;
        o.boneRemapTable = boneRemapTable;
        return o;
    }
}

class SeqEventDesc {
    constructor(public cycle: number, public event: number, public type: number, public options: string) {
    }
}

const enum SeqFlags {
    LOOPING = 0x01,
}

class SeqDesc {
    public flags: SeqFlags;
    public anim: Uint16Array;
    public viewBB: AABB;
    public events: SeqEventDesc[] = [];

    constructor(public label: string, public activityname: string) {
    }

    public isLooping(): boolean {
        return !!(this.flags & SeqFlags.LOOPING);
    }

    public clone(animStart: number): SeqDesc {
        const o = new SeqDesc(this.label, this.activityname);
        o.flags = this.flags;
        o.anim = this.anim.slice();
        for (let i = 0; i < o.anim.length; i++)
            o.anim[i] += animStart;
        o.viewBB = this.viewBB;
        return o;
    }
}

interface AnimBlock {
    dataStart: number;
    dataEnd: number;
}

class AttachmentDesc {
    public local = mat4.create();

    constructor(public name: string, public flags: number, public bone: number) {
    }

    public clone(boneStart: number): AttachmentDesc {
        const o = new AttachmentDesc(this.name, this.flags, this.bone + boneStart);
        mat4.copy(o.local, this.local);
        return o;
    }
}

export class StudioModelData {
    private name: string;

    public bodyPartData: StudioModelBodyPartData[] = [];
    public checksum: number;
    public hullBB: AABB;
    public viewBB: AABB;
    public bone: BoneDesc[] = [];
    public illumPosition = vec3.create();
    public anim: AnimDesc[] = [];
    public seq: SeqDesc[] = [];
    public attachment: AttachmentDesc[] = [];
    public includemodel: string[] = [];
    public animBlockName: string | null = null;
    public animblocks: AnimBlock[] = [];
    public numLOD: number;

    constructor(renderContext: SourceRenderContext, mdlBuffer: ArrayBufferSlice, vvdBuffer: ArrayBufferSlice | null, vtxBuffer: ArrayBufferSlice | null) {
        const mdlView = mdlBuffer.createDataView();

        // We have three separate files of data (MDL, VVD, VTX) to chew through.
        //
        // MDL = Studio Model Header, contains skeleton, most aux data, animations, etc.
        // VVD = Valve Vertex Data, contains actual vertex data.
        // VTX = Optimized Model, contains per-LOD information (index buffer, optimized trilist information & material replacement).

        // Parse MDL header
        assert(readString(mdlBuffer, 0x00, 0x04) === 'IDST');
        const mdlVersion = mdlView.getUint32(0x04, true);

        const supportedVersions = [44, 45, 46, 47, 48, 49];
        assert(supportedVersions.includes(mdlVersion));

        this.checksum = mdlView.getUint32(0x08, true);

        this.name = readString(mdlBuffer, 0x0C, 0x40, true);
        const length = mdlView.getUint32(0x4C, true);

        const eyePositionX = mdlView.getFloat32(0x50, true);
        const eyePositionY = mdlView.getFloat32(0x54, true);
        const eyePositionZ = mdlView.getFloat32(0x58, true);

        const illumPositionX = mdlView.getFloat32(0x5C, true);
        const illumPositionY = mdlView.getFloat32(0x60, true);
        const illumPositionZ = mdlView.getFloat32(0x64, true);
        vec3.set(this.illumPosition, illumPositionX, illumPositionY, illumPositionZ);

        const moveHullMinX = mdlView.getFloat32(0x68, true);
        const moveHullMinY = mdlView.getFloat32(0x6C, true);
        const moveHullMinZ = mdlView.getFloat32(0x70, true);
        const moveHullMaxX = mdlView.getFloat32(0x74, true);
        const moveHullMaxY = mdlView.getFloat32(0x78, true);
        const moveHullMaxZ = mdlView.getFloat32(0x7C, true);
        this.hullBB = new AABB(moveHullMinX, moveHullMinY, moveHullMinZ, moveHullMaxX, moveHullMaxY, moveHullMaxZ);

        const viewBBoxMinX = mdlView.getFloat32(0x80, true);
        const viewBBoxMinY = mdlView.getFloat32(0x84, true);
        const viewBBoxMinZ = mdlView.getFloat32(0x88, true);
        const viewBBoxMaxX = mdlView.getFloat32(0x8C, true);
        const viewBBoxMaxY = mdlView.getFloat32(0x90, true);
        const viewBBoxMaxZ = mdlView.getFloat32(0x94, true);
        this.viewBB = new AABB(viewBBoxMinX, viewBBoxMinY, viewBBoxMinZ, viewBBoxMaxX, viewBBoxMaxY, viewBBoxMaxZ);
        if (this.viewBB.isEmpty())
            this.viewBB.copy(this.hullBB);

        const flags: StudioModelFlags = mdlView.getUint32(0x98, true);
        const isStaticProp = !!(flags & StudioModelFlags.STATIC_PROP);
        const hasExtraVertexData = !!(flags & StudioModelFlags.EXTRA_VERTEX_DATA);

        const numbones = mdlView.getUint32(0x9C, true);
        const boneindex = mdlView.getUint32(0xA0, true);

        let boneidx = boneindex;
        for (let i = 0; i < numbones; i++) {
            const szname = readString(mdlBuffer, boneidx + mdlView.getUint32(boneidx + 0x00, true));
            const parent = mdlView.getInt32(boneidx + 0x04, true);
            assert(parent < i);
            const bone = new BoneDesc(szname, parent);

            const bonecontroller = [
                mdlView.getInt32(boneidx + 0x08, true),
                mdlView.getInt32(boneidx + 0x0C, true),
                mdlView.getInt32(boneidx + 0x10, true),
                mdlView.getInt32(boneidx + 0x14, true),
                mdlView.getInt32(boneidx + 0x18, true),
                mdlView.getInt32(boneidx + 0x1C, true),
            ];

            bone.pos[0] = mdlView.getFloat32(boneidx + 0x20, true);
            bone.pos[1] = mdlView.getFloat32(boneidx + 0x24, true);
            bone.pos[2] = mdlView.getFloat32(boneidx + 0x28, true);
            bone.quat[0] = mdlView.getFloat32(boneidx + 0x2C, true);
            bone.quat[1] = mdlView.getFloat32(boneidx + 0x30, true);
            bone.quat[2] = mdlView.getFloat32(boneidx + 0x34, true);
            bone.quat[3] = mdlView.getFloat32(boneidx + 0x38, true);
            bone.rot[0] = mdlView.getFloat32(boneidx + 0x3C, true);
            bone.rot[1] = mdlView.getFloat32(boneidx + 0x40, true);
            bone.rot[2] = mdlView.getFloat32(boneidx + 0x44, true);

            bone.posScale[0] = mdlView.getFloat32(boneidx + 0x48, true);
            bone.posScale[1] = mdlView.getFloat32(boneidx + 0x4C, true);
            bone.posScale[2] = mdlView.getFloat32(boneidx + 0x50, true);
            bone.rotScale[0] = mdlView.getFloat32(boneidx + 0x54, true);
            bone.rotScale[1] = mdlView.getFloat32(boneidx + 0x58, true);
            bone.rotScale[2] = mdlView.getFloat32(boneidx + 0x5C, true);

            const poseToBone00 = mdlView.getFloat32(boneidx + 0x60, true);
            const poseToBone01 = mdlView.getFloat32(boneidx + 0x64, true);
            const poseToBone02 = mdlView.getFloat32(boneidx + 0x68, true);
            const poseToBone03 = mdlView.getFloat32(boneidx + 0x6C, true);
            const poseToBone10 = mdlView.getFloat32(boneidx + 0x70, true);
            const poseToBone11 = mdlView.getFloat32(boneidx + 0x74, true);
            const poseToBone12 = mdlView.getFloat32(boneidx + 0x78, true);
            const poseToBone13 = mdlView.getFloat32(boneidx + 0x7C, true);
            const poseToBone20 = mdlView.getFloat32(boneidx + 0x80, true);
            const poseToBone21 = mdlView.getFloat32(boneidx + 0x84, true);
            const poseToBone22 = mdlView.getFloat32(boneidx + 0x88, true);
            const poseToBone23 = mdlView.getFloat32(boneidx + 0x8C, true);
            mat4.set(bone.poseToBone,
                poseToBone00, poseToBone10, poseToBone20, 0,
                poseToBone01, poseToBone11, poseToBone21, 0,
                poseToBone02, poseToBone12, poseToBone22, 0,
                poseToBone03, poseToBone13, poseToBone23, 1,
            );

            const alignmentX = mdlView.getFloat32(boneidx + 0x90, true);
            const alignmentY = mdlView.getFloat32(boneidx + 0x94, true);
            const alignmentZ = mdlView.getFloat32(boneidx + 0x98, true);
            const alignmentW = mdlView.getFloat32(boneidx + 0x9C, true);

            const proctype = mdlView.getUint32(boneidx + 0xA4, true);
            const procindex = mdlView.getUint32(boneidx + 0xA8, true);
            const physicsbone = mdlView.getUint32(boneidx + 0xAC, true);
            const surfacepropidx = mdlView.getUint32(boneidx + 0xB0, true);
            const contents = mdlView.getUint32(boneidx + 0xB4, true);

            // int unused[8];

            this.bone.push(bone);
            boneidx += 0xD8;
        }

        const numbonecontrollers = mdlView.getUint32(0xA4, true);
        const bonecontrollerindex = mdlView.getUint32(0xA8, true);
        if (isStaticProp)
            assert(numbonecontrollers === 0);

        const numhitboxsets = mdlView.getUint32(0xAC, true);
        const hitboxsetindex = mdlView.getUint32(0xB0, true);

        const numlocalanims = mdlView.getUint32(0xB4, true);
        let localanimindex = mdlView.getUint32(0xB8, true);
        for (let i = 0; i < numlocalanims; i++, localanimindex += 0x64) {
            const baseptr = mdlView.getUint32(localanimindex + 0x00, true);
            const szName = readString(mdlBuffer, localanimindex + mdlView.getUint32(localanimindex + 0x04, true));

            const anim = new AnimDesc(szName);
            anim.fps = mdlView.getFloat32(localanimindex + 0x08, true);
            anim.flags = mdlView.getUint32(localanimindex + 0x0C, true);
            anim.numframes = mdlView.getUint32(localanimindex + 0x10, true);

            const nummovements = mdlView.getUint32(localanimindex + 0x14, true);
            const movementindex = mdlView.getUint32(localanimindex + 0x18, true);

            // const unused10 = mdlView.getUint32(localanimindex + 0x1C, true);
            // const unused11 = mdlView.getUint32(localanimindex + 0x20, true);
            // const unused12 = mdlView.getUint32(localanimindex + 0x24, true);
            // const unused13 = mdlView.getUint32(localanimindex + 0x28, true);
            // const unused14 = mdlView.getUint32(localanimindex + 0x2C, true);
            // const unused15 = mdlView.getUint32(localanimindex + 0x30, true);

            const animblock = mdlView.getUint32(localanimindex + 0x34, true);
            const animindex = mdlView.getUint32(localanimindex + 0x38, true);

            const numikrules = mdlView.getUint32(localanimindex + 0x3C, true);
            const ikruleindex = mdlView.getUint32(localanimindex + 0x40, true);
            const animblockikruleindex = mdlView.getUint32(localanimindex + 0x44, true);

            const numlocalhierarchy = mdlView.getUint32(localanimindex + 0x48, true);
            const localhierarchyindex = mdlView.getUint32(localanimindex + 0x4C, true);

            let sectionindex = localanimindex + mdlView.getUint32(localanimindex + 0x50, true);
            const sectionframes = mdlView.getUint32(localanimindex + 0x54, true);

            if (sectionframes !== 0) {
                // We have multiple sections.
                const numsections = Math.ceil(anim.numframes / sectionframes);
                let firstframe = 0;
                for (let j = 0; j < numsections; j++, sectionindex += 0x08) {
                    const sectionanimblock = mdlView.getUint32(sectionindex + 0x00, true);
                    const sectionanimindex = mdlView.getUint32(sectionindex + 0x04, true);
                    const sectionnumframes = Math.min(firstframe + sectionframes, anim.numframes) - firstframe;
                    anim.animsection.push(new AnimSection(sectionanimblock, sectionanimindex, firstframe, sectionnumframes));
                    firstframe += sectionframes;
                }
            } else {
                // Single section.
                anim.animsection.push(new AnimSection(animblock, animindex, 0, anim.numframes));
            }

            // Go through and create all of our animation data (at least for what we can...)
            for (let i = 0; i < anim.animsection.length; i++) {
                const animsection = anim.animsection[i];
                if (animsection.animblock === 0) {
                    const animBuffer = mdlBuffer.slice(localanimindex + animsection.animindex);
                    animsection.animdata = new AnimData(animBuffer, this.bone);
                } else {
                    // External block. Save for later.
                }
            }

            const zeroframespan = mdlView.getUint16(localanimindex + 0x58, true);
            const zeroframecount = mdlView.getUint16(localanimindex + 0x5A, true);
            const zeroframeindex = mdlView.getUint32(localanimindex + 0x5C, true);
            const zeroframestalltime = mdlView.getFloat32(localanimindex + 0x60, true);

            this.anim.push(anim);
        }

        const numlocalseqs = mdlView.getUint32(0xBC, true);
        let localseqindex = mdlView.getUint32(0xC0, true);
        for (let i = 0; i < numlocalseqs; i++, localseqindex += 0xD4) {
            const baseptr = mdlView.getUint32(localseqindex + 0x00, true);
            const szLabel = readString(mdlBuffer, localseqindex + mdlView.getUint32(localseqindex + 0x04, true));
            const szActivityName = readString(mdlBuffer, localseqindex + mdlView.getUint32(localseqindex + 0x08, true));
            const seq = new SeqDesc(szLabel.toLowerCase(), szActivityName);
            seq.flags = mdlView.getUint32(localseqindex + 0x0C, true);

            const activity = mdlView.getUint32(localseqindex + 0x10, true);
            const actweight = mdlView.getUint32(localseqindex + 0x14, true);

            const numevents = mdlView.getUint32(localseqindex + 0x18, true);
            let eventindex = localseqindex + mdlView.getUint32(localseqindex + 0x1C, true);
            for (let j = 0; j < numevents; j++, eventindex += 0x50) {
                const cycle = mdlView.getFloat32(eventindex + 0x00, true);
                const event = mdlView.getUint32(eventindex + 0x04, true);
                const type = mdlView.getUint32(eventindex + 0x08, true);
                const options = readString(mdlBuffer, eventindex + 0x0C, 0x40);
                // const eventName = readString(mdlBuffer, mdlView.getUint32(eventindex + 0x4C, true));
                seq.events.push(new SeqEventDesc(cycle, event, type, options));
            }

            const viewBBoxMinX = mdlView.getFloat32(localseqindex + 0x20, true);
            const viewBBoxMinY = mdlView.getFloat32(localseqindex + 0x24, true);
            const viewBBoxMinZ = mdlView.getFloat32(localseqindex + 0x28, true);
            const viewBBoxMaxX = mdlView.getFloat32(localseqindex + 0x2C, true);
            const viewBBoxMaxY = mdlView.getFloat32(localseqindex + 0x30, true);
            const viewBBoxMaxZ = mdlView.getFloat32(localseqindex + 0x34, true);
            seq.viewBB = new AABB(viewBBoxMinX, viewBBoxMinY, viewBBoxMinZ, viewBBoxMaxX, viewBBoxMaxY, viewBBoxMaxZ);

            const numblends = mdlView.getUint32(localseqindex + 0x38, true);
            const animindexindex = mdlView.getUint32(localseqindex + 0x3C, true);
            const movementindex = mdlView.getUint32(localseqindex + 0x40, true);
            const groupsizeX = mdlView.getUint32(localseqindex + 0x44, true);
            const groupsizeY = mdlView.getUint32(localseqindex + 0x48, true);
            seq.anim = mdlBuffer.createTypedArray(Uint16Array, localseqindex + animindexindex, groupsizeX * groupsizeY);
            const paramindexX = mdlView.getUint32(localseqindex + 0x4C, true);
            const paramindexY = mdlView.getUint32(localseqindex + 0x50, true);
            const paramstartX = mdlView.getFloat32(localseqindex + 0x54, true);
            const paramstartY = mdlView.getFloat32(localseqindex + 0x58, true);
            const paramendX = mdlView.getFloat32(localseqindex + 0x5C, true);
            const paramendY = mdlView.getFloat32(localseqindex + 0x60, true);
            const paramparent = mdlView.getUint32(localseqindex + 0x64, true);

            const fadeintime = mdlView.getFloat32(localseqindex + 0x68, true);
            const fadeouttime = mdlView.getFloat32(localseqindex + 0x6C, true);
            const localentrynode = mdlView.getUint32(localseqindex + 0x70, true);
            const localexitnode = mdlView.getUint32(localseqindex + 0x74, true);
            const nodeflags = mdlView.getUint32(localseqindex + 0x78, true);
            const entryphase = mdlView.getUint32(localseqindex + 0x7C, true);
            const exitphase = mdlView.getUint32(localseqindex + 0x80, true);
            const lastframe = mdlView.getUint32(localseqindex + 0x84, true);
            const nextseq = mdlView.getUint32(localseqindex + 0x88, true);
            const pose = mdlView.getUint32(localseqindex + 0x8C, true);

            const numikrules = mdlView.getUint32(localseqindex + 0x90, true);
            const numautolayers = mdlView.getUint32(localseqindex + 0x94, true);
            const autolayerindex = mdlView.getUint32(localseqindex + 0x98, true);
            const weightlistindex = mdlView.getUint32(localseqindex + 0x9C, true);
            const posekeyindex = mdlView.getUint32(localseqindex + 0xA0, true);
            const numiklocks = mdlView.getUint32(localseqindex + 0xA4, true);
            const iklockindex = mdlView.getUint32(localseqindex + 0xA8, true);
            const keyvalueindex = mdlView.getUint32(localseqindex + 0xAC, true);
            const keyvaluesize = mdlView.getUint32(localseqindex + 0xB0, true);
            const cycleposeindex = mdlView.getUint32(localseqindex + 0xB4, true);
            const activitymodifierindex = mdlView.getUint32(localseqindex + 0xB8, true);
            const numactivitymodifiers = mdlView.getUint32(localseqindex + 0xBC, true);

            // const unused0 = mdlView.getUint32(localseqindex + 0xC0, true);
            // const unused1 = mdlView.getUint32(localseqindex + 0xC4, true);
            // const unused2 = mdlView.getUint32(localseqindex + 0xC8, true);
            // const unused3 = mdlView.getUint32(localseqindex + 0xCC, true);
            // const unused4 = mdlView.getUint32(localseqindex + 0xD0, true);

            this.seq.push(seq);
        }

        const activitylistversion = mdlView.getUint32(0xC4, true);
        const eventsindexed = mdlView.getUint32(0xC8, true);

        const numtextures = mdlView.getUint32(0xCC, true);
        const textureindex = mdlView.getUint32(0xD0, true);

        const numcdtextures = mdlView.getUint32(0xD4, true);
        const cdtextureindex = mdlView.getUint32(0xD8, true);

        const materialSearchDirs: string[] = [];
        let cdtextureIdx = cdtextureindex;
        for (let i = 0; i < numcdtextures; i++, cdtextureIdx += 0x04) {
            const textureDir = readString(mdlBuffer, mdlView.getUint32(cdtextureIdx + 0x00, true));
            const materialSearchDir = `materials/${textureDir}`;
            materialSearchDirs.push(materialSearchDir);
        }

        const numskinref = mdlView.getUint32(0xDC, true);
        const numskinfamilies = mdlView.getUint32(0xE0, true);
        const skinindex = mdlView.getUint32(0xE4, true);
        const skinArray = mdlBuffer.createTypedArray(Uint16Array, skinindex, numskinref * numskinfamilies);

        const numbodyparts = mdlView.getUint32(0xE8, true);
        const bodypartindex = mdlView.getUint32(0xEC, true);

        const numlocalattachments = mdlView.getUint32(0xF0, true);
        const localattachmentindex = mdlView.getUint32(0xF4, true);
        let localattachmentIdx = localattachmentindex;
        for (let i = 0; i < numlocalattachments; i++, localattachmentIdx += 0x5C) {
            const name = readString(mdlBuffer, localattachmentIdx + mdlView.getUint32(localattachmentIdx + 0x00, true));
            const flags = mdlView.getUint32(localattachmentIdx + 0x04, true);
            const localbone = mdlView.getUint32(localattachmentIdx + 0x08, true);
            const attachment = new AttachmentDesc(name, flags, localbone);

            const local00 = mdlView.getFloat32(localattachmentIdx + 0x0C, true);
            const local01 = mdlView.getFloat32(localattachmentIdx + 0x10, true);
            const local02 = mdlView.getFloat32(localattachmentIdx + 0x14, true);
            const local03 = mdlView.getFloat32(localattachmentIdx + 0x18, true);
            const local10 = mdlView.getFloat32(localattachmentIdx + 0x1C, true);
            const local11 = mdlView.getFloat32(localattachmentIdx + 0x20, true);
            const local12 = mdlView.getFloat32(localattachmentIdx + 0x24, true);
            const local13 = mdlView.getFloat32(localattachmentIdx + 0x28, true);
            const local20 = mdlView.getFloat32(localattachmentIdx + 0x2C, true);
            const local21 = mdlView.getFloat32(localattachmentIdx + 0x30, true);
            const local22 = mdlView.getFloat32(localattachmentIdx + 0x34, true);
            const local23 = mdlView.getFloat32(localattachmentIdx + 0x38, true);
            mat4.set(attachment.local,
                local00, local10, local20, 0,
                local01, local11, local21, 0,
                local02, local12, local22, 0,
                local03, local13, local23, 1,
            );

            this.attachment.push(attachment);
        }

        const numlocalnodes = mdlView.getUint32(0xF8, true);
        const localnodeindex = mdlView.getUint32(0xFC, true);
        const localnodenameindex = mdlView.getUint32(0x100, true);

        const numflexdesc = mdlView.getUint32(0x104, true);
        const flexdescindex = mdlView.getUint32(0x108, true);

        const numflexcontrollers = mdlView.getUint32(0x10C, true);
        const flexcontrollerindex = mdlView.getUint32(0x110, true);

        const numflexrules = mdlView.getUint32(0x114, true);
        const flexruleindex = mdlView.getUint32(0x118, true);

        const numikchains = mdlView.getUint32(0x11C, true);
        const ikchainindex = mdlView.getUint32(0x120, true);

        const nummouthss = mdlView.getUint32(0x124, true);
        const mouthsindex = mdlView.getUint32(0x128, true);

        const numlocalposeparameters = mdlView.getUint32(0x12C, true);
        const localposeparamindex = mdlView.getUint32(0x130, true);

        const surfacepropindex = mdlView.getUint32(0x134, true);
        const surfaceprop = readString(mdlBuffer, surfacepropindex);

        const keyvalueindex = mdlView.getUint32(0x138, true);
        const keyvaluesize = mdlView.getUint32(0x13C, true);

        const numlocalikautoplaylocks = mdlView.getUint32(0x140, true);
        const localikautoplaylockindex = mdlView.getUint32(0x144, true);

        const mass = mdlView.getFloat32(0x148, true);
        const contents = mdlView.getUint32(0x14C, true);

        const numincludemodels = mdlView.getUint32(0x150, true);
        const includemodelindex = mdlView.getUint32(0x154, true);
        let includemodelIdx = includemodelindex;
        for (let i = 0; i < numincludemodels; i++, includemodelIdx += 0x08) {
            const name = readString(mdlBuffer, includemodelIdx + mdlView.getUint32(includemodelIdx + 0x04, true));
            this.includemodel.push(name);
        }

        // Runtime backpointer.
        const virtualModel = mdlView.getUint32(0x158, true);
        assert(virtualModel === 0);

        this.animBlockName = readString(mdlBuffer, mdlView.getUint32(0x15C, true));
        const numanimblocks = mdlView.getUint32(0x160, true);
        const animblockindex = mdlView.getUint32(0x164, true);
        let animblockIdx = animblockindex;
        for (let i = 0; i < numanimblocks; i++, animblockIdx += 0x08) {
            const dataStart = mdlView.getUint32(animblockIdx + 0x00, true);
            const dataEnd = mdlView.getUint32(animblockIdx + 0x04, true);
            this.animblocks.push({ dataStart, dataEnd });
        }

        const animblockModel = mdlView.getUint32(0x168, true);

        const bonetablebynameindex = mdlView.getUint32(0x16C, true);

        // Runtime backpointer.
        const vertexBase = mdlView.getUint32(0x170, true);
        const indexBase = mdlView.getUint32(0x174, true);
        assert(vertexBase === 0);
        assert(indexBase === 0);

        const constantdirectionallightdot = mdlView.getUint32(0x178, true);
        const rootLOD = mdlView.getUint32(0x179, true);
        const numAllowedRootLODs = mdlView.getUint32(0x17A, true);

        const numflexcontrollerui = mdlView.getUint32(0x180, true);
        const flexcontrollleruiindex = mdlView.getUint32(0x184, true);

        const vertAnimFixedPointScale = mdlView.getFloat32(0x188, true);
        const studiohdr2index = mdlView.getUint32(0x190, true);

        if (vvdBuffer === null || vtxBuffer === null)
            return;

        // Parse VVD header
        const vvdView = vvdBuffer.createDataView();

        assert(readString(vvdBuffer, 0x00, 0x04) === 'IDSV');
        const vvdVersion = vvdView.getUint32(0x04, true);
        assert(vvdVersion === 0x04);
        const vvdChecksum = vvdView.getUint32(0x08, true);
        assert(vvdChecksum === this.checksum);
        const vvdNumLODs = vvdView.getUint32(0x0C, true);
        this.numLOD = vvdNumLODs;
        const vvdNumLODVertexes = nArray(8, (i) => vvdView.getUint32(0x10 + i * 0x04, true));
        const vvdNumFixups = vvdView.getUint32(0x30, true);
        const vvdFixupTableStart = vvdView.getUint32(0x34, true);
        const vvdVertexDataStart = vvdView.getUint32(0x38, true);
        const vvdTangentDataStart = vvdView.getUint32(0x3C, true);

        let meshDataFlags: StudioModelMeshDataFlags = 0;
        let vvdTexCoord1DataStart = 0;
        if (hasExtraVertexData) {
            // Find start of extra data pointer
            const vvdExtraDataOffs = vvdTangentDataStart + vvdNumLODVertexes[0] * 0x10;

            const vvdExtraDataCount = vvdView.getUint32(vvdExtraDataOffs + 0x00, true);
            const vvdExtraDataTotalBytes = vvdView.getUint32(vvdExtraDataOffs + 0x04, true);

            let vvdExtraDataTableIdx = vvdExtraDataOffs + 0x08;
            for (let i = 0; i < vvdExtraDataCount; i++, vvdExtraDataTableIdx += 0x0C) {
                const type = vvdView.getUint32(vvdExtraDataTableIdx + 0x00, true);
                assert(type === 1); // texcoord 1

                vvdTexCoord1DataStart = vvdExtraDataOffs + vvdView.getUint32(vvdExtraDataTableIdx + 0x04, true);
                const stride = vvdView.getUint32(vvdExtraDataTableIdx + 0x08, true);

                // All the types are texcoords, in order
                meshDataFlags |= StudioModelMeshDataFlags.HasTexCoord1;
                assert(stride === 2*0x04);
            }
        }

        const fixupRemappings: FixupRemapping[] = [];
        let vvdFixupTableIdx = vvdFixupTableStart;
        let fixupTableCopyDstIdx = 0;
        for (let i = 0; i < vvdNumFixups; i++) {
            // const lod = vvdView.getUint32(vvdFixupTableIdx + 0x00, true);
            // The fixup table works by memcpy-ing vertex data from src -> dst. So the indices in the
            // MDL/VTX files are in copyDst range, and the vertices in the VVD file are in copySrc.
            const copySrc = vvdView.getUint32(vvdFixupTableIdx + 0x04, true);
            const copyDst = fixupTableCopyDstIdx;
            const count = vvdView.getUint32(vvdFixupTableIdx + 0x08, true);
            fixupRemappings.push({ copySrc, copyDst, count });
            fixupTableCopyDstIdx += count;
            vvdFixupTableIdx += 0x0C;
        }

        // Parse VTX header
        const vtxView = vtxBuffer.createDataView();

        const vtxVersion = vtxView.getUint32(0x00, true);
        assert(vtxVersion === 0x07);

        // VTX optimization settings.
        const vtxCacheSize = vtxView.getUint32(0x04, true);
        const vtxMaxBonesPerStrip = vtxView.getUint16(0x08, true);
        const vtxMaxBonesPerTri = vtxView.getUint16(0x0A, true);
        const vtxMaxBonesPerVert = vtxView.getUint32(0x0C, true);

        const vtxChecksum = vtxView.getUint32(0x10, true);
        assert(vtxChecksum === this.checksum);

        const vtxNumLODs = vtxView.getUint32(0x14, true);
        assert(vtxNumLODs === vvdNumLODs);
        const vtxMaterialReplacementListOffset = vtxView.getUint32(0x18, true);
        const vtxNumBodyParts = vtxView.getUint32(0x1C, true);
        assert(vtxNumBodyParts === numbodyparts);
        const vtxBodyPartOffset = vtxView.getUint32(0x20, true);

        // Gather our materials for each LOD.
        // First, gather our base material names.
        const baseMaterialNames: string[] = [];
        let textureIdx = textureindex;
        for (let i = 0; i < numtextures; i++) {
            const nameindex = textureIdx + mdlView.getUint32(textureIdx + 0x00, true);
            const materialName = readString(mdlBuffer, nameindex);
            const flags = mdlView.getUint32(textureIdx + 0x04, true);
            const used = mdlView.getUint32(textureIdx + 0x08, true);
            const unused1 = mdlView.getUint32(textureIdx + 0x0C, true);
            const material = mdlView.getUint32(textureIdx + 0x10, true);
            // This appears to be a stale pointer generated by studiomdl, lol.
            // assert(material === 0);
            const clientmaterial = mdlView.getUint32(textureIdx + 0x14, true);
            assert(clientmaterial === 0);

            const resolvedPath = renderContext.filesystem.searchPath(materialSearchDirs, materialName, '.vmt');
            if (resolvedPath !== null) {
                baseMaterialNames.push(resolvedPath);
            } else {
                // TODO(jstpierre): Error material
                baseMaterialNames.push('materials/editor/obsolete.vmt');
            }

            textureIdx += 0x40;
        }

        const lodMaterialNames: string[][] = [];
        let vtxMaterialReplacementListIdx = vtxMaterialReplacementListOffset;
        for (let i = 0; i < vtxNumLODs; i++) {
            const numReplacements = vtxView.getUint32(vtxMaterialReplacementListIdx + 0x00, true);
            const replacementOffset = vtxView.getInt32(vtxMaterialReplacementListIdx + 0x04, true);

            const materialNames: string[] = baseMaterialNames.slice();
            let replacementIdx = vtxMaterialReplacementListIdx + replacementOffset;
            for (let i = 0; i < numReplacements; i++) {
                const materialID = vtxView.getUint16(replacementIdx + 0x00, true);
                assert(materialID < materialNames.length);
                const nameOffset = replacementIdx + vtxView.getInt32(replacementIdx + 0x02, true);
                const replacementName = readString(vtxBuffer, nameOffset);
                materialNames[materialID] = assertExists(renderContext.filesystem.searchPath(materialSearchDirs, replacementName, '.vmt'));
                replacementIdx += 0x06;
            }

            lodMaterialNames.push(materialNames);
            vtxMaterialReplacementListIdx += 0x08;
        }

        // The hierarchy of a model is Body Part -> Submodel -> Submodel LOD -> Mesh -> Strip Group -> Strip
        // Note that "strips" might not actually be tristrips. They appear to be trilists in modern models.

        let mdlBodyPartIdx = bodypartindex;
        let vtxBodyPartIdx = vtxBodyPartOffset;
        for (let i = 0; i < numbodyparts; i++) {
            const bodyPartName = readString(mdlBuffer, mdlBodyPartIdx + mdlView.getUint32(mdlBodyPartIdx + 0x00, true));
            const mdlNumModels = mdlView.getUint32(mdlBodyPartIdx + 0x04, true);
            const mdlBase = mdlView.getUint32(mdlBodyPartIdx + 0x08, true);
            const mdlModelindex = mdlView.getUint32(mdlBodyPartIdx + 0x0C, true);

            const vtxNumModels = vtxView.getUint32(vtxBodyPartIdx + 0x00, true);
            assert(mdlNumModels === vtxNumModels);
            const vtxModelOffs = vtxView.getUint32(vtxBodyPartIdx + 0x04, true);

            const bodyPartData = new StudioModelBodyPartData(bodyPartName);
            this.bodyPartData.push(bodyPartData);

            let mdlSubmodelIdx = mdlBodyPartIdx + mdlModelindex;
            let vtxSubmodelIdx = vtxBodyPartIdx + vtxModelOffs;
            for (let j = 0; j < mdlNumModels; j++) {
                const mdlSubmodelName = readString(mdlBuffer, mdlSubmodelIdx + 0x00);
                // Never written to.
                // const mdlSubmodelType = mdlView.getUint32(mdlSubmodelIdx + 0x40, true);
                const mdlSubmodelBoundingRadius = mdlView.getFloat32(mdlSubmodelIdx + 0x44, true);
                const mdlSubmodelNumMeshes = mdlView.getUint32(mdlSubmodelIdx + 0x48, true);
                const mdlSubmodelMeshindex = mdlView.getUint32(mdlSubmodelIdx + 0x4C, true);
                const mdlSubmodelNumvertices = mdlView.getUint32(mdlSubmodelIdx + 0x50, true);
                const mdlSubmodelVertexindex = mdlView.getUint32(mdlSubmodelIdx + 0x54, true);
                const mdlSubmodelTangentsindex = mdlView.getUint32(mdlSubmodelIdx + 0x58, true);
                const mdlSubmodelNumattachments = mdlView.getUint32(mdlSubmodelIdx + 0x5C, true);
                const mdlSubmodelAttachmentindex = mdlView.getUint32(mdlSubmodelIdx + 0x60, true);
                const mdlSubmodelNumeyeballs = mdlView.getUint32(mdlSubmodelIdx + 0x64, true);
                const mdlSubmodelEyeballindex = mdlView.getUint32(mdlSubmodelIdx + 0x68, true);

                // mstudio_modelvertexdata_t
                // const mdlSubmodelVertexDataPtr = mdlView.getUint32(mdlSubmodelIdx + 0x6C, true); junk pointer
                // const mdlSubmodelTangentsDataPtr = mdlView.getUint32(mdlSubmodelIdx + 0x70, true); junk pointer
                assert(mdlSubmodelVertexindex % 0x30 === 0);
                assert(mdlSubmodelTangentsindex % 0x10 === 0);
                const mdlSubmodelFirstVertex = (mdlSubmodelVertexindex / 0x30) | 0;
                const mdlSubmodelFirstTangent = (mdlSubmodelTangentsindex / 0x10) | 0;

                // Extra data

                // int unused[8];

                const vtxSubmodelNumLODs = vtxView.getUint32(vtxSubmodelIdx + 0x00, true);
                assert(vtxSubmodelNumLODs === vtxNumLODs);
                const vtxSubmodelLODOffset = vtxView.getUint32(vtxSubmodelIdx + 0x04, true);

                const submodelData = new StudioModelSubmodelData(mdlSubmodelName);
                bodyPartData.submodelData.push(submodelData);

                let vtxLODIdx = vtxSubmodelIdx + vtxSubmodelLODOffset;
                for (let lod = 0; lod < vtxSubmodelNumLODs; lod++) {
                    const vtxNumMeshes = vtxView.getUint32(vtxLODIdx + 0x00, true);
                    assert(vtxNumMeshes === mdlSubmodelNumMeshes);
                    const vtxMeshOffset = vtxView.getUint32(vtxLODIdx + 0x04, true);
                    const vtxSwitchPoint = vtxView.getFloat32(vtxLODIdx + 0x08, true);

                    const lodData = new StudioModelLODData();
                    submodelData.lodData.push(lodData);
                    let mdlMeshIdx = mdlSubmodelIdx + mdlSubmodelMeshindex;
                    let vtxMeshIdx = vtxLODIdx + vtxMeshOffset;

                    for (let m = 0; m < mdlSubmodelNumMeshes; m++, mdlMeshIdx += 0x74, vtxMeshIdx += 0x09) {
                        // MDL data is not LOD-specific, we reparse this for each LOD.

                        const skinrefIndex = mdlView.getUint32(mdlMeshIdx + 0x00, true);

                        // Parse out the material names for each skin family.
                        const materialNames: string[] = [];
                        for (let i = 0; i < numskinfamilies; i++) {
                            const materialNameIndex = skinArray[i * numskinref + skinrefIndex];
                            materialNames.push(lodMaterialNames[lod][materialNameIndex]);
                        }

                        const modelindex = mdlView.getInt32(mdlMeshIdx + 0x04, true);

                        const mdlMeshNumvertices = mdlView.getUint32(mdlMeshIdx + 0x08, true);
                        const mdlMeshVertexoffset = mdlView.getUint32(mdlMeshIdx + 0x0C, true);

                        const numflexes = mdlView.getUint32(mdlMeshIdx + 0x10, true);
                        const flexindex = mdlView.getUint32(mdlMeshIdx + 0x14, true);

                        const materialtype = mdlView.getUint32(mdlMeshIdx + 0x18, true);
                        // assert(materialtype === 0); // not eyeballs
                        const materialparam = mdlView.getUint32(mdlMeshIdx + 0x1C, true);

                        const meshid = mdlView.getUint32(mdlMeshIdx + 0x20, true);
                        const centerX = mdlView.getFloat32(mdlMeshIdx + 0x24, true);
                        const centerY = mdlView.getFloat32(mdlMeshIdx + 0x28, true);
                        const centerZ = mdlView.getFloat32(mdlMeshIdx + 0x2C, true);

                        // mstudio_meshvertexdata_t
                        // const modelvertexdata = mdlView.getUint32(mdlMeshIdx + 0x30, true); junk pointer
                        const lodVertices = mdlView.getUint32(mdlMeshIdx + 0x34 + lod * 0x04, true);

                        // On the VTX side, each mesh contains a number of "strip groups". In theory, there can be up to
                        // four different strip groups for the 2x2 combinatoric matrix of "hw skin" and "is flex".
                        // We load the DX90 VTX files, which always have hw skin enabled, so we should see at most two
                        // flex groups.
                        const vtxNumStripGroups = vtxView.getUint32(vtxMeshIdx + 0x00, true);

                        // TODO(jstpierre): It seems some non-hw-skin groups are showing up in DX90 files in HL2?
                        // assert(vtxNumStripGroups === 1 || vtxNumStripGroups === 2);

                        const vtxStripGroupHeaderOffset = vtxView.getUint32(vtxMeshIdx + 0x04, true);
                        const vtxMeshFlags = vtxView.getUint8(vtxMeshIdx + 0x08);

                        // It seems that Valve extended the .vtx format at some point without
                        // changing the major version for that version, but it can be detected
                        // through the mdl version... this is for subd.
                        const hasTopologyData = mdlVersion >= 49;

                        let vtxStripGroupStride = 0x19;
                        let vtxStripStride = 0x1B;
                        if (hasTopologyData) {
                            vtxStripGroupStride += 0x08;
                            vtxStripStride += 0x08;
                        }

                        let meshNumVertices = 0;
                        let meshNumIndices = 0;
                        let vtxStripGroupIdx = vtxMeshIdx + vtxStripGroupHeaderOffset;
                        for (let g = 0; g < vtxNumStripGroups; g++, vtxStripGroupIdx += vtxStripGroupStride) {
                            const numVerts = vtxView.getUint32(vtxStripGroupIdx + 0x00, true);
                            const numIndices = vtxView.getUint32(vtxStripGroupIdx + 0x08, true);
                            meshNumVertices += numVerts;
                            meshNumIndices += numIndices;
                        }

                        // Ignore any meshes with 0 vertices.
                        // TODO(jstpierre): Where is this in the original engine? It's required for .vhv to match correctly.
                        if (meshNumVertices === 0)
                            continue;

                        // 3 pos, 4 normal, 4 tangent, 4 bone weight, 4 bone id, 2 uv
                        let vertexSize = (3+4+4+4+4+2);
                        if (meshDataFlags & StudioModelMeshDataFlags.HasTexCoord1)
                            vertexSize += 2;
                        const meshVtxData = new Float32Array(meshNumVertices * vertexSize);
                        const meshIdxData = new Uint16Array(meshNumIndices);

                        let dataOffs = 0x00;
                        let meshIdxBase = 0;
                        let idxOffs = 0x00;
                        let meshFirstIdx = 0;

                        const stripGroupDatas: StudioModelStripGroupData[] = [];

                        vtxStripGroupIdx = vtxMeshIdx + vtxStripGroupHeaderOffset;
                        for (let g = 0; g < vtxNumStripGroups; g++, vtxStripGroupIdx += vtxStripGroupStride) {
                            const numVerts = vtxView.getUint32(vtxStripGroupIdx + 0x00, true);
                            const vertOffset = vtxView.getUint32(vtxStripGroupIdx + 0x04, true);

                            const numIndices = vtxView.getUint32(vtxStripGroupIdx + 0x08, true);
                            const indexOffset = vtxView.getUint32(vtxStripGroupIdx + 0x0C, true);

                            const numStrips = vtxView.getUint32(vtxStripGroupIdx + 0x10, true);
                            const stripOffset = vtxView.getUint32(vtxStripGroupIdx + 0x14, true);

                            const stripGroupFlags: OptimizeStripGroupFlags = vtxView.getUint8(vtxStripGroupIdx + 0x18);
                            const isHWSkin = !!(stripGroupFlags & OptimizeStripGroupFlags.IS_HWSKINNED);

                            if (hasTopologyData) {
                                const numTopologyIndices = vtxView.getUint32(vtxStripGroupIdx + 0x18, true);
                                const topologyOffset = vtxView.getUint32(vtxStripGroupIdx + 0x1C, true);
                            }

                            // Build the vertex data for our strip group.
                            let vertIdx = vtxStripGroupIdx + vertOffset;
                            for (let v = 0; v < numVerts; v++) {
                                // VTX Bone weight data.
                                const vtxBoneWeightIdx = [
                                    vtxView.getUint8(vertIdx + 0x00),
                                    vtxView.getUint8(vertIdx + 0x01),
                                    vtxView.getUint8(vertIdx + 0x02),
                                ];
                                const vtxNumBones = vtxView.getUint8(vertIdx + 0x03);

                                const vtxOrigMeshVertID = vtxView.getUint16(vertIdx + 0x04, true);
                                const vtxBoneID = [
                                    vtxView.getUint8(vertIdx + 0x06),
                                    vtxView.getUint8(vertIdx + 0x07),
                                    vtxView.getUint8(vertIdx + 0x08),
                                ];

                                // Pull out VVD vertex data.
                                const modelVertIndex = (mdlMeshVertexoffset + vtxOrigMeshVertID);
                                const vvdVertIndex = fixupRemappingSearch(fixupRemappings, mdlSubmodelFirstVertex + modelVertIndex);
                                const vvdTangentIndex = fixupRemappingSearch(fixupRemappings, mdlSubmodelFirstTangent + modelVertIndex);
                                const vvdVertexOffs = vvdVertexDataStart + 0x30 * vvdVertIndex;
                                const vvdTangentOffs = vvdTangentDataStart + 0x10 * vvdTangentIndex;

                                const vvdBoneWeight = [
                                    vvdView.getFloat32(vvdVertexOffs + 0x00, true),
                                    vvdView.getFloat32(vvdVertexOffs + 0x04, true),
                                    vvdView.getFloat32(vvdVertexOffs + 0x08, true),
                                ];
                                const vvdBoneIdx = [
                                    vvdView.getUint8(vvdVertexOffs + 0x0C),
                                    vvdView.getUint8(vvdVertexOffs + 0x0D),
                                    vvdView.getUint8(vvdVertexOffs + 0x0E),
                                ];
                                const vvdNumBones = vvdView.getUint8(vvdVertexOffs + 0x0F);

                                const boneWeights: number[] = [0, 0, 0, 0];

                                if (vtxNumBones >= 1)
                                    assert(vvdNumBones === vtxNumBones);

                                let totalBoneWeight = 0.0;
                                for (let i = 0; i < vtxNumBones; i++) {
                                    const boneWeightIdx = vtxBoneWeightIdx[i];
                                    boneWeights[i] = vvdBoneWeight[boneWeightIdx];
                                    totalBoneWeight += boneWeights[i];

                                    // Sanity check.
                                    if (!isHWSkin) {
                                        assert(vtxBoneID[i] === vvdBoneIdx[i]);

                                        // TODO(jstpierre): Re-pack a new hardware bone table.
                                        assert(vtxBoneID[i] < MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix);
                                    }
                                }

                                // Normalize.
                                for (let i = 0; i < vtxNumBones; i++)
                                    boneWeights[i] /= totalBoneWeight;

                                const vvdPositionX = vvdView.getFloat32(vvdVertexOffs + 0x10, true);
                                const vvdPositionY = vvdView.getFloat32(vvdVertexOffs + 0x14, true);
                                const vvdPositionZ = vvdView.getFloat32(vvdVertexOffs + 0x18, true);

                                const vvdNormalX = vvdView.getFloat32(vvdVertexOffs + 0x1C, true);
                                const vvdNormalY = vvdView.getFloat32(vvdVertexOffs + 0x20, true);
                                const vvdNormalZ = vvdView.getFloat32(vvdVertexOffs + 0x24, true);

                                const vvdTexCoordS = vvdView.getFloat32(vvdVertexOffs + 0x28, true);
                                const vvdTexCoordT = vvdView.getFloat32(vvdVertexOffs + 0x2C, true);

                                const vvdTangentSX = vvdView.getFloat32(vvdTangentOffs + 0x00, true);
                                const vvdTangentSY = vvdView.getFloat32(vvdTangentOffs + 0x04, true);
                                const vvdTangentSZ = vvdView.getFloat32(vvdTangentOffs + 0x08, true);
                                const vvdTangentSW = vvdView.getFloat32(vvdTangentOffs + 0x0C, true);

                                // Sanity check our tangent sign data.
                                // TODO(jstpierre): Check the tangent data validity against our material.
                                assert(vvdTangentSW === 0.0 || vvdTangentSW === 1.0 || vvdTangentSW === -1.0);

                                // Position
                                meshVtxData[dataOffs++] = vvdPositionX;
                                meshVtxData[dataOffs++] = vvdPositionY;
                                meshVtxData[dataOffs++] = vvdPositionZ;

                                // Normal
                                meshVtxData[dataOffs++] = vvdNormalX;
                                meshVtxData[dataOffs++] = vvdNormalY;
                                meshVtxData[dataOffs++] = vvdNormalZ;
                                meshVtxData[dataOffs++] = 1.0; // vertex alpha

                                // Tangent
                                meshVtxData[dataOffs++] = vvdTangentSX;
                                meshVtxData[dataOffs++] = vvdTangentSY;
                                meshVtxData[dataOffs++] = vvdTangentSZ;
                                meshVtxData[dataOffs++] = vvdTangentSW;

                                // Bone weights
                                meshVtxData[dataOffs++] = boneWeights[0];
                                meshVtxData[dataOffs++] = boneWeights[1];
                                meshVtxData[dataOffs++] = boneWeights[2];
                                meshVtxData[dataOffs++] = boneWeights[3];

                                // Bone IDs
                                meshVtxData[dataOffs++] = vtxBoneID[0];
                                meshVtxData[dataOffs++] = vtxBoneID[1];
                                meshVtxData[dataOffs++] = vtxBoneID[2];
                                meshVtxData[dataOffs++] = 0;

                                // Texcoord
                                meshVtxData[dataOffs++] = vvdTexCoordS;
                                meshVtxData[dataOffs++] = vvdTexCoordT;

                                if (!!(meshDataFlags & StudioModelMeshDataFlags.HasTexCoord1)) {
                                    const vvdExtraTexCoordOffs = vvdTexCoord1DataStart + vvdVertIndex * 2*0x04;
                                    meshVtxData[dataOffs++] = vvdView.getFloat32(vvdExtraTexCoordOffs + 0x00, true);
                                    meshVtxData[dataOffs++] = vvdView.getFloat32(vvdExtraTexCoordOffs + 0x04, true);
                                }

                                vertIdx += 0x09;
                            }

                            let indexIdx = vtxStripGroupIdx + indexOffset;
                            for (let i = 0; i < numIndices; i++) {
                                meshIdxData[idxOffs++] = meshIdxBase + vtxView.getUint16(indexIdx, true);
                                indexIdx += 0x02;
                            }

                            meshIdxBase += numVerts;

                            const stripGroupData = new StudioModelStripGroupData();
                            stripGroupDatas.push(stripGroupData);

                            // We can have multiple strips in a strip group if we have a bone change table between
                            // strips. For unskinned / static prop models without bones, we should always have one strip.

                            // Each strip in a strip group can change the bones, relative to the previous one.
                            const hardwareBoneTable: number[] = [];

                            if (!isHWSkin) {
                                // If this is a software skinned system, then the bone IDs stored in the vertices should be
                                // the same as the overall bone table, not the hardware bone table. As such, set the table
                                // to be identity.
                                for (let i = 0; i < MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix; i++)
                                    hardwareBoneTable[i] = i;
                            }

                            let vtxStripIdx = vtxStripGroupIdx + stripOffset;
                            for (let s = 0; s < numStrips; s++, vtxStripIdx += vtxStripStride) {
                                const stripNumIndices = vtxView.getUint32(vtxStripIdx + 0x00, true);
                                const stripIndexOffset = vtxView.getUint32(vtxStripIdx + 0x04, true);
                                // assert(stripNumIndices === numIndices);
                                // assert(stripIndexOffset === 0);

                                const stripNumVerts = vtxView.getUint32(vtxStripIdx + 0x08, true);
                                const stripVertOffset = vtxView.getUint32(vtxStripIdx + 0x0C, true);
                                // assert(stripNumVerts === numVerts);
                                // assert(stripVertOffset === 0);

                                const numBones = vtxView.getUint16(vtxStripIdx + 0x10, true);

                                const stripFlags: OptimizeStripFlags = vtxView.getUint8(vtxStripIdx + 0x12);
                                // TODO(jstpierre): Retopologize strips
                                assert(stripFlags === OptimizeStripFlags.IS_TRILIST);

                                const numBoneStateChanges = vtxView.getUint32(vtxStripIdx + 0x13, true);
                                const boneStateChangeOffset = vtxView.getUint32(vtxStripIdx + 0x17, true);
                                let boneStateChangeIdx = vtxStripIdx + boneStateChangeOffset;

                                if (hasTopologyData) {
                                    const numTopologyIndices = vtxView.getUint32(vtxStripIdx + 0x1B, true);
                                    const topologyOffset = vtxView.getUint32(vtxStripIdx + 0x1F, true);
                                }

                                for (let i = 0; i < numBoneStateChanges; i++) {
                                    const hardwareID = vtxView.getUint32(boneStateChangeIdx + 0x00, true);
                                    const boneID = vtxView.getUint32(boneStateChangeIdx + 0x04, true);
                                    hardwareBoneTable[hardwareID] = boneID;
                                    boneStateChangeIdx += 0x08;
                                }

                                if (!isHWSkin)
                                    assert(numBoneStateChanges === 0);

                                stripGroupData.stripData.push(new StudioModelStripData(meshFirstIdx + stripIndexOffset, stripNumIndices, hardwareBoneTable.slice()));
                            }

                            meshFirstIdx += numIndices;
                        }

                        const cache = renderContext.renderCache;
                        const meshData = new StudioModelMeshData(cache, materialNames, meshDataFlags, meshVtxData.buffer, meshIdxData.buffer, meshNumVertices);
                        for (let i = 0; i < stripGroupDatas.length; i++)
                            meshData.stripGroupData.push(stripGroupDatas[i]);
                        lodData.meshData.push(meshData);
                    }

                    vtxLODIdx += 0x0C;
                }

                mdlSubmodelIdx += 0x94;
                vtxSubmodelIdx += 0x08;
            }

            mdlBodyPartIdx += 0x10;
            vtxBodyPartIdx += 0x08;
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bodyPartData.length; i++)
            this.bodyPartData[i].destroy(device);
    }
}

// Hardware verts, used for static color data

interface HardwareVertDataMesh {
    lod: number;
    vertexCount: number;
    byteOffset: number;
    byteSize: number;
}

export class HardwareVertData {
    public checksum: number;
    public buffer: GfxBuffer;
    public mesh: HardwareVertDataMesh[] = [];
    public vertexSize: number;

    constructor(renderContext: SourceRenderContext, buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        const version = view.getUint32(0x00, true);
        assert(version === 0x02);

        this.checksum = view.getUint32(0x04, true);

        // Hardware verts are used solely for vertex colors

        const enum VertexFlags { POSITION = 0x01, NORMAL = 0x02, COLOR = 0x04, SPECULAR = 0x08, TANGENT_S = 0x10, TANGENT_T = 0x20, }
        const vertexFlags: VertexFlags = view.getUint32(0x08, true);
        assert(vertexFlags === VertexFlags.COLOR || vertexFlags === VertexFlags.NORMAL);

        this.vertexSize = view.getUint32(0x0C, true);
        if (vertexFlags === VertexFlags.COLOR)
            assert(this.vertexSize === 1*0x04);
        else if (vertexFlags === VertexFlags.NORMAL)
            assert(this.vertexSize === 3*0x04);

        const vertexCount = view.getUint32(0x10, true);

        const numMeshes = view.getUint32(0x14, true);

        // 0x10 bytes of padding.
        const vertexData = new Uint8Array(vertexCount * this.vertexSize);
        let vertexOffs = 0;

        let meshHeaderIdx = 0x28;
        for (let i = 0; i < numMeshes; i++) {
            const lod = view.getUint32(meshHeaderIdx + 0x00, true);
            const meshVertexCount = view.getUint32(meshHeaderIdx + 0x04, true);
            const offset = view.getUint32(meshHeaderIdx + 0x08, true);

            const meshByteSize = meshVertexCount * this.vertexSize;

            this.mesh.push({ lod, vertexCount: meshVertexCount, byteOffset: vertexOffs, byteSize: meshByteSize });

            // Input and output data are both RGBA
            // Input is BGRA, we need RGBA
            // TODO(jstpierre): Do this in the shader?
            let dataOffs = offset;
            for (let i = 0; i < meshByteSize; i += 4) {
                const b = view.getUint8(dataOffs++);
                const g = view.getUint8(dataOffs++);
                const r = view.getUint8(dataOffs++);
                const a = view.getUint8(dataOffs++);
                vertexData[vertexOffs++] = r;
                vertexData[vertexOffs++] = g;
                vertexData[vertexOffs++] = b;
                vertexData[vertexOffs++] = a;
            }

            // 0x10 bytes of padding.
            meshHeaderIdx += 0x1C;
        }

        this.buffer = makeStaticDataBuffer(renderContext.device, GfxBufferUsage.Vertex, vertexData.buffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.buffer);
    }
}

function remapIncludeModelSkeleton(animData: StudioModelData, modelData: StudioModelData): number[] {
    // Construct a remap table going from the model bone index to the animation track index.
    const remapTable: number[] = nArray(modelData.bone.length, () => -1);
    for (let i = 0; i < animData.bone.length; i++) {
        const origBone = animData.bone[i];
        const newIndex = modelData.bone.findIndex((bone) => bone.name === origBone.name);
        remapTable[newIndex] = i;
    }

    return remapTable;
}

function mergeIncludeModel(dst: StudioModelData, src: StudioModelData): void {
    const boneRemapTable = remapIncludeModelSkeleton(src, dst);

    let animStart = dst.anim.length;
    for (let i = 0; i < src.anim.length; i++)
        dst.anim.push(src.anim[i].clone(boneRemapTable));
    for (let i = 0; i < src.seq.length; i++)
        dst.seq.push(src.seq[i].clone(animStart));
}

export class StudioModelCache {
    private modelData: StudioModelData[] = [];
    private modelDataPromiseCache = new Map<string, Promise<StudioModelData>>();

    constructor(private renderContext: SourceRenderContext, private filesystem: SourceFileSystem) {
    }

    private resolvePath(path: string, ext: string): string {
        if (path.endsWith('.mdl'))
            path = path.slice(0, -4);
        if (!path.endsWith(ext))
            path = `${path}${ext}`;
        return this.filesystem.resolvePath(path, ext);
    }

    private async fetchStudioModelDataInternal(name: string, includeVertexData: boolean = true): Promise<StudioModelData> {
        const mdlPath = this.resolvePath(name, '.mdl');

        let mdlBuffer: ArrayBufferSlice | null = null;
        let vvdBuffer: ArrayBufferSlice | null = null;
        let vtxBuffer: ArrayBufferSlice | null = null;
        if (includeVertexData) {
            const vvdPath = this.resolvePath(name, '.vvd');
            const vtxPath = this.resolvePath(name, '.dx90.vtx');
            [mdlBuffer, vvdBuffer, vtxBuffer] = await Promise.all([
                this.filesystem.fetchFileData(mdlPath),
                this.filesystem.fetchFileData(vvdPath),
                this.filesystem.fetchFileData(vtxPath),
            ]);
        } else {
            mdlBuffer = await this.filesystem.fetchFileData(mdlPath);
        }

        const modelData = new StudioModelData(this.renderContext, assertExists(mdlBuffer), vvdBuffer!, vtxBuffer!);

        if (modelData.animBlockName !== null) {
            // Fetch external animation block.
            const aniPath = this.filesystem.resolvePath(modelData.animBlockName, '.ani');
            const aniBuffer = (await this.filesystem.fetchFileData(aniPath))!;

            // Go through each of our animations and set the relevant animation data.
            for (let i = 0; i < modelData.anim.length; i++) {
                for (let j = 0; j < modelData.anim[i].animsection.length; j++) {
                    const animsection = modelData.anim[i].animsection[j];
                    if (animsection.animdata === null) {
                        assert(animsection.animblock > 0);
                        const animblock = modelData.animblocks[animsection.animblock];
                        const blockBuffer = aniBuffer.slice(animblock.dataStart, animblock.dataEnd);
                        animsection.animdata = new AnimData(blockBuffer.slice(animsection.animindex), modelData.bone);
                    }
                }
            }
        }
    
        for (let i = 0; i < modelData.includemodel.length; i++) {
            // includeModels should not have additional vertex information.
            const includeModel = await this.fetchStudioModelData(modelData.includemodel[i], false);
            mergeIncludeModel(modelData, includeModel);
        }

        this.modelData.push(modelData);
        return modelData;
    }

    public fetchStudioModelData(path: string, includeVertexData: boolean = true): Promise<StudioModelData> {
        if (!this.modelDataPromiseCache.has(path))
            this.modelDataPromiseCache.set(path, this.fetchStudioModelDataInternal(path, includeVertexData));
        return this.modelDataPromiseCache.get(path)!;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

class StudioModelMeshInstance {
    private visible = true;
    private materialInstance: BaseMaterial | null = null;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private staticLightingMode: StaticLightingMode;
    private skinningMode: SkinningMode;
    private currentSkin: number;

    constructor(renderContext: SourceRenderContext, private meshData: StudioModelMeshData, private entityParams: EntityMaterialParameters) {
        this.skinningMode = this.calcSkinningMode();
        this.inputLayout = this.meshData.inputLayout;
        this.inputState = this.meshData.inputState;
        this.staticLightingMode = StaticLightingMode.StudioAmbientCube;
    }

    private calcSkinningMode(): SkinningMode {
        let maxNumBones = 0;

        for (let i = 0; i < this.meshData.stripGroupData.length; i++) {
            const stripGroupData = this.meshData.stripGroupData[i];
            for (let j = 0; j < stripGroupData.stripData.length; j++) {
                const stripData = stripGroupData.stripData[j];
                maxNumBones = Math.max(stripData.hardwareBoneTable.length, maxNumBones);
                if (maxNumBones > 1)
                    return SkinningMode.Smooth;
            }
        }

        if (maxNumBones === 1)
            return SkinningMode.Rigid;

        return SkinningMode.None;
    }

    private async bindMaterial(renderContext: SourceRenderContext, skin: number = 0): Promise<void> {
        const materialInstance = await renderContext.materialCache.createMaterialInstance(this.meshData.materialNames[skin]);
        materialInstance.entityParams = this.entityParams;
        materialInstance.skinningMode = this.skinningMode;
        await materialInstance.init(renderContext);

        // Between the awaits, it's possible for the skin to change...
        if (this.currentSkin !== skin)
            return;

        this.materialInstance = materialInstance;
        this.materialInstance.setStaticLightingMode(this.staticLightingMode);
    }

    public bindColorMeshData(cache: GfxRenderCache, data: HardwareVertData, mesh: HardwareVertDataMesh): void {
        assert(this.inputState === this.meshData.inputState);
        assert(mesh.vertexCount === this.meshData.vertexCount);

        if (data.vertexSize === 1*0x04)
            this.staticLightingMode = StaticLightingMode.StudioVertexLighting;
        else if (data.vertexSize === 3*0x04)
            this.staticLightingMode = StaticLightingMode.StudioVertexLighting3;
        else
            throw "whoops";

        const colorDescriptor: GfxVertexBufferDescriptor = { buffer: data.buffer, byteOffset: mesh.byteOffset };
        [this.inputLayout, this.inputState] = this.meshData.createInputState(cache, this.staticLightingMode, colorDescriptor);

        if (this.materialInstance !== null)
            this.materialInstance.setStaticLightingMode(this.staticLightingMode);
    }

    public setSkin(renderContext: SourceRenderContext, skin: number): void {
        if (skin >= this.meshData.materialNames.length)
            skin = 0;

        if (this.currentSkin === skin)
            return;

        this.bindMaterial(renderContext, skin);
        this.currentSkin = skin;
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || this.materialInstance === null)
            return;

        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, boneMatrix: ReadonlyMat4[], bbox: AABB, depth: number) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.isMaterialVisible(renderContext))
            return;

        this.materialInstance.calcProjectedLight(renderContext, bbox);

        const template = renderInstManager.pushTemplateRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, template);
        this.materialInstance.setOnRenderInstModelMatrix(template, modelMatrix);

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        for (let i = 0; i < this.meshData.stripGroupData.length; i++) {
            const stripGroupData = this.meshData.stripGroupData[i];

            for (let j = 0; j < stripGroupData.stripData.length; j++) {
                const stripData = stripGroupData.stripData[j];
                const renderInst = renderInstManager.newRenderInst();
                this.materialInstance.setOnRenderInstSkinningParams(renderInst, boneMatrix, stripData.hardwareBoneTable);
                renderInst.drawIndexes(stripData.indexCount, stripData.firstIndex);
                renderInst.debug = this;
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
                this.materialInstance.getRenderInstListForView(renderContext.currentView).submitRenderInst(renderInst);
            }
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        if (this.inputState !== this.meshData.inputState)
            device.destroyInputState(this.inputState);
    }
}

class StudioModelLODInstance {
    public meshInstance: StudioModelMeshInstance[] = [];

    constructor(renderContext: SourceRenderContext, private lodData: StudioModelLODData, entityParams: EntityMaterialParameters) {
        for (let i = 0; i < this.lodData.meshData.length; i++)
            this.meshInstance.push(new StudioModelMeshInstance(renderContext, this.lodData.meshData[i], entityParams));
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, boneMatrix: ReadonlyMat4[], bbox: AABB, depth: number) {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].prepareToRender(renderContext, renderInstManager, modelMatrix, boneMatrix, bbox, depth);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].destroy(device);
    }
}

function findAnimationSection(anim: AnimDesc, frame: number): AnimSection | null {
    for (let i = 0; i < anim.animsection.length; i++) {
        const s = anim.animsection[i];
        if (frame < s.firstframe + s.numframes) {
            // should be sorted
            return s;
        }
    }

    return null;
}

const scratchVec3 = vec3.create(), scratchQuatb = quat.create();
function calcPoseFromAnimation(dstBoneMatrix: mat4[], anim: AnimDesc, frame: number, modelData: StudioModelData): void {
    // First, find the relevant section / anim.
    const section = findAnimationSection(anim, frame);
    if (section === null || section.animdata === null)
        return;

    // make frame relative to section
    frame -= section.firstframe;
    const data = section.animdata;

    // don't read off the end (still need to figure out how to do loops...)
    frame = Math.min(frame, section.numframes - 1);

    for (let i = 0; i < modelData.bone.length; i++) {
        const dst = dstBoneMatrix[i];
        const trackIndex = anim.boneRemapTable !== null ? anim.boneRemapTable[i] : i;
        const track = trackIndex >= 0 ? data.tracks[trackIndex] : null;
        const modelBone = modelData.bone[i];
        if (track !== null) {
            const trackBone = track.bone;
            assert(trackBone.name === modelBone.name);
            track.getPosRot(scratchVec3, scratchQuatb, trackBone, frame);
            mat4.fromQuat(dst, scratchQuatb);
            setMatrixTranslation(dst, scratchVec3);
        } else {
            computeModelMatrixPosRadianEuler(dst, modelBone.pos, modelBone.rot);
        }
    }
}

function calcBoneMatrix(dstBoneMatrix: mat4[], modelData: StudioModelData): void {
    for (let i = 0; i < modelData.bone.length; i++) {
        const dst = dstBoneMatrix[i];
        const bone = modelData.bone[i];
        computeModelMatrixPosRadianEuler(dst, bone.pos, bone.rot);
    }
}

function calcWorldFromBone(worldFromBoneMatrix: mat4[], boneMatrix: ReadonlyMat4[], modelMatrix: ReadonlyMat4, modelData: StudioModelData): void {
    for (let i = 0; i < worldFromBoneMatrix.length; i++) {
        const bone = modelData.bone[i];
        const parentBoneMatrix = bone.parent >= 0 ? boneMatrix[bone.parent] : modelMatrix;
        mat4.mul(worldFromBoneMatrix[i], parentBoneMatrix, worldFromBoneMatrix[i]);
    }
}

function calcAttachmentMatrix(attachmentMatrix: mat4[], worldFromBoneMatrix: ReadonlyMat4[], modelData: StudioModelData): void {
    for (let i = 0; i < modelData.attachment.length; i++)
        mat4.mul(attachmentMatrix[i], worldFromBoneMatrix[modelData.attachment[i].bone], modelData.attachment[i].local);
}

function calcWorldFromPose(worldFromPoseMatrix: mat4[], worldFromBoneMatrix: ReadonlyMat4[], modelData: StudioModelData): void {
    for (let i = 0; i < worldFromPoseMatrix.length; i++)
        mat4.mul(worldFromPoseMatrix[i], worldFromBoneMatrix[i], modelData.bone[i].poseToBone);
}

class StudioModelBodyPartInstance {
    public visible: boolean = true;
    public lodInstance: StudioModelLODInstance[] = [];

    constructor(renderContext: SourceRenderContext, public bodyPartData: StudioModelBodyPartData, materialParams: EntityMaterialParameters) {
        // TODO(jstpierre): $bodygroup swapping
        const submodelData = bodyPartData.submodelData[0];

        for (let k = 0; k < submodelData.lodData.length; k++) {
            const lodData = submodelData.lodData[k];
            this.lodInstance.push(new StudioModelLODInstance(renderContext, lodData, materialParams));
        }
    }

    public setSkin(renderContext: SourceRenderContext, skin: number): void {
        for (let i = 0; i < this.lodInstance.length; i++) {
            const lodInstance = this.lodInstance[i];
            for (let j = 0; j < lodInstance.meshInstance.length; j++) {
                const meshInstance = lodInstance.meshInstance[j];
                meshInstance.setSkin(renderContext, skin);
            }
        }
    }

    public getLODInstance(lodIndex: number): StudioModelLODInstance {
        return this.lodInstance[lodIndex];
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lodInstance.length; i++)
            this.lodInstance[i].destroy(device);
    }
}

const scratchAABB = new AABB();
export class StudioModelInstance {
    public visible: boolean = true;
    // Pose data
    public modelMatrix = mat4.create();
    public worldFromPoseMatrix: mat4[];
    public attachmentMatrix: mat4[];

    private bodyPartInstance: StudioModelBodyPartInstance[] = [];
    private viewBB: AABB;

    constructor(renderContext: SourceRenderContext, public modelData: StudioModelData, materialParams: EntityMaterialParameters) {
        for (let i = 0; i < this.modelData.bodyPartData.length; i++) {
            const bodyPartData = this.modelData.bodyPartData[i];
            this.bodyPartInstance.push(new StudioModelBodyPartInstance(renderContext, bodyPartData, materialParams));
        }

        this.worldFromPoseMatrix = nArray(this.modelData.bone.length, () => mat4.create());
        this.attachmentMatrix = nArray(this.modelData.attachment.length, () => mat4.create());
        calcBoneMatrix(this.worldFromPoseMatrix, this.modelData);
        calcWorldFromBone(this.worldFromPoseMatrix, this.worldFromPoseMatrix, this.modelMatrix, this.modelData);
        calcAttachmentMatrix(this.attachmentMatrix, this.worldFromPoseMatrix, this.modelData);
        calcWorldFromPose(this.worldFromPoseMatrix, this.worldFromPoseMatrix, this.modelData);
        this.viewBB = this.modelData.viewBB;
    }

    public setColorMeshData(cache: GfxRenderCache, data: HardwareVertData): void {
        // In some TF2 games, checksums don't match. For now, apply the static lighting anyway,
        // as it won't look as bad as unlit models. If/when we do proper lighting for light probes,
        // then this can go away.

        // if (data.checksum !== this.modelData.checksum)
        //     return;

        let hwi = 0;
        for (let lod = 0; lod < this.modelData.numLOD; lod++) {
            for (let i = 0; i < this.bodyPartInstance.length; i++) {
                const bodyPartInstance = this.bodyPartInstance[i];
                const lodInstance = bodyPartInstance.getLODInstance(lod);

                for (let j = 0; j < lodInstance.meshInstance.length; j++) {
                    const meshInstance = lodInstance.meshInstance[j];

                    // Find proper color mesh.
                    const colorMesh = data.mesh[hwi++];
                    assert(colorMesh.lod === lod);

                    meshInstance.bindColorMeshData(cache, data, colorMesh);
                }
            }
        }
    }

    public setSkin(renderContext: SourceRenderContext, skin: number): void {
        for (let i = 0; i < this.bodyPartInstance.length; i++)
            this.bodyPartInstance[i].setSkin(renderContext, skin);
    }

    private getLODModelIndex(renderContext: SourceRenderContext): number {
        // TODO(jstpierre): Pull out the proper LOD model.
        return 0;
    }

    public movement(renderContext: SourceRenderContext): void {
        const lodIndex = this.getLODModelIndex(renderContext);
        for (let i = 0; i < this.bodyPartInstance.length; i++)
            this.bodyPartInstance[i].getLODInstance(lodIndex).movement(renderContext);
    }

    public sequenceIsFinished(seqindex: number, time: number): boolean {
        const seq = this.modelData.seq[seqindex];
        if (seq.isLooping())
            return false;
        const anim = this.modelData.anim[seq.anim[0]];
        if (anim === undefined)
            return false;
        let frame = time * anim.fps;
        return frame >= anim.numframes;
    }

    public setupPoseFromSequence(seqindex: number, time: number): void {
        const seq = this.modelData.seq[seqindex];
        const anim = this.modelData.anim[seq.anim[0]];
        this.viewBB = seq.viewBB;
        calcBoneMatrix(this.worldFromPoseMatrix, this.modelData);
        if (anim !== undefined) {
            let frame = time * anim.fps;

            if (seq.isLooping())
                frame = frame % anim.numframes;
            else
                frame = Math.min(frame, anim.numframes - 1);

            calcPoseFromAnimation(this.worldFromPoseMatrix, anim, frame, this.modelData);
        }
        calcWorldFromBone(this.worldFromPoseMatrix, this.worldFromPoseMatrix, this.modelMatrix, this.modelData);
        calcAttachmentMatrix(this.attachmentMatrix, this.worldFromPoseMatrix, this.modelData);
        calcWorldFromPose(this.worldFromPoseMatrix, this.worldFromPoseMatrix, this.modelData);
    }

    public checkFrustum(renderContext: SourceRenderContext): boolean {
        if (!this.visible)
            return false;

        scratchAABB.transform(this.viewBB, this.modelMatrix);
        if (!renderContext.currentView.frustum.contains(scratchAABB))
            return false;

        return true;
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager) {
        if (!this.checkFrustum(renderContext))
            return;

        scratchAABB.centerPoint(scratchVec3);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(renderContext.currentView.viewFromWorldMatrix, scratchVec3);

        const lodIndex = this.getLODModelIndex(renderContext);
        for (let i = 0; i < this.bodyPartInstance.length; i++)
            this.bodyPartInstance[i].getLODInstance(lodIndex).prepareToRender(renderContext, renderInstManager, this.modelMatrix, this.worldFromPoseMatrix, scratchAABB, depth);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bodyPartInstance.length; i++)
            this.bodyPartInstance[i].destroy(device);
    }
}
