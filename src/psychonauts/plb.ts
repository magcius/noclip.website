
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataStream } from "./DataStream";
import { assert } from "../util";
import { AABB } from "../Geometry";
import { ReadonlyVec2, vec2, vec3, vec4 } from "gl-matrix";
import { normalizeTextureName } from "./ppf";
import { GfxTopology } from "../gfx/helpers/TopologyHelpers";

export interface EScene {
    textureReferences: TextureReference[];
    domain: EDomain;
}

function readEVec2(stream: DataStream): vec2 {
    return vec2.fromValues(stream.readFloat32(), stream.readFloat32());
}

function readEVec3(stream: DataStream): vec3 {
    return vec3.fromValues(stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

function readEVec4(stream: DataStream): vec4 {
    return vec4.fromValues(stream.readFloat32(), stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

function readEBox3(stream: DataStream): AABB {
    const min = readEVec3(stream);
    const max = readEVec3(stream);
    return new AABB(min[0], min[1], min[2], max[0], max[1], max[2]);
}

export interface EModelTriggerOBB {
    name: string;
    v1: vec3;
    v2: vec3;
    v3: vec3;
    v4: vec3;
    bbox: AABB;
}

function readEModelTriggerOBB(stream: DataStream): EModelTriggerOBB {
    let name = stream.readStringStream_4b();
    if (name === 'PLANE') {
        const plane = readEVec3(stream);
        name = stream.readStringStream_4b();
    }
    const v1 = readEVec3(stream);
    const v2 = readEVec3(stream);
    const v3 = readEVec3(stream);
    const v4 = readEVec3(stream);
    const bbox = readEBox3(stream);
    return { name, v1, v2, v3, v4, bbox };
}

interface ELight {
    type: number;
    flags: number;
    name: string;
    position: vec3;
};

function readELight(stream: DataStream): ELight {
    const type = stream.readUint32();
    const flags = stream.readUint32();
    const name = stream.readStringStream_4b();
    // Light parameters
    const p1 = readEVec3(stream);
    const p2 = readEVec3(stream);
    const position = readEVec3(stream);

    if (type === 0x03) {
        const g = readEVec3(stream);
    } else if (type === 0x04) {
        // Spot light
        const g = readEVec3(stream);
        const o0 = stream.readFloat32();
        const o1 = stream.readFloat32();
    } else if (type === 0x05) {
        // Projected light
        const projTexName = stream.readStringStream_4b();
        stream.offs += 0x04 * 3; // g
        stream.offs += 0x04 * 3; // field_48
        stream.offs += 0x04 * 6; // field_78
    }

    // Some sort of lookup table?
    if (flags & 0x200) {
        let numThings = (type === 0x03) ? 1 : 6;

        const v21: number[] = [];
        const v41: number[] = [];

        for (let i = 0; i < numThings; i++)
            v21[i] = stream.readUint16();
        for (let i = 0; i < numThings; i++)
            v41[i] = stream.readUint16();

        if (type === 0x03) {
            stream.offs += 0x40; // field_D0
            stream.offs += 0x18; // field_110
        }

        for (let i = 0; i < numThings; i++) {
            if (v41[i] <= 0x100)
                stream.offs += 0x01 * v21[i];
            else
                stream.offs += 0x02 * v21[i];

                if (type === 0x03)
                stream.offs += 0x10 * v41[i]; // EPlane
            else
                stream.offs += 0x06 * v41[i]; // EPlanePacked3
        }
    }

    return { type, flags, name, position };
}

export interface EJoint {
    index: number;
    name: string;
}

function readEJoint(stream: DataStream): EJoint {
    const index = stream.readUint16();
    const name = stream.readStringStream_4b();
    const v1 = readEVec3(stream);
    const v2 = readEVec3(stream);
    assert(false);
    return { index, name };
}

export interface ESkeleton {
    name: string;
    joints: EJoint[];
}

function readESkeleton(stream: DataStream): ESkeleton {
    const name = stream.readStringStream_4b();
    const count = stream.readUint32();
    const joints: EJoint[] = [];
    for (let i = 0; i < count; i++)
        joints.push(readEJoint(stream));
    return { name, joints };
}

export const enum MaterialFlags {
    Alpha             = 0x00000001,
    Incandescent      = 0x00000002,
    Skinned           = 0x00000004,
    Bumpmap           = 0x00000008,
    DoubleSided       = 0x00000010,
    Lightmap          = 0x00000020,
    Billboard         = 0x00000080,
    AdditiveBlended   = 0x00000200,
    BinaryAlpha       = 0x00000400,
    Decal             = 0x00000800,
    EdgeAlpha         = 0x00002000,
    InvEdgeAlpha      = 0x00004000,
    Distortion        = 0x00010000,
    FresnelReflection = 0x00200000,
    GlareOnly         = 0x00400000,
    PerPixelLighting  = 0x00800000,
    Tristrip          = 0x01000000,
    DetailTexture     = 0x40000000,
}

export interface EMeshFrag {
    materialFlags: MaterialFlags;
    bbox: AABB;
    materialColor: vec4;
    textureIds: number[];
    textureLightmap: number | null;
    textureDetail: number | null;
    texCoordTransVel: ReadonlyVec2;
    streamPosNrm: ArrayBufferSlice;
    streamColor: ArrayBufferSlice | null;
    streamUVCount: number;
    uvCoordScale: number;
    streamUV: ArrayBufferSlice | null;
    streamIdx: ArrayBufferSlice;
    topology: GfxTopology;
    iVertCount: number;
    iPolyCount: number;
}

function readEMeshFrag(stream: DataStream, version: number): EMeshFrag {
    // This is actually EModelFrag...

    const bbox = readEBox3(stream);

    let modelFlags: number = 0;
    if (version > 0x13D)
        modelFlags = stream.readUint32();

    const materialFlags = stream.readUint32();
    const unk00 = stream.readUint32(); // unused

    const distantLOD = stream.readUint8();
    const blendFlags = stream.readUint8();
    const materialColor = readEVec4(stream);

    const textureCount = stream.readUint32();
    const textureIds: number[] = [];
    for (let i = 0; i < textureCount; i++)
        textureIds.push(stream.readUint32());

    let textureLightmap: number | null = null;
    let textureDetail: number | null = null;

    if (!!(materialFlags & MaterialFlags.Lightmap)) {
        const lightmap0TextureID = stream.readUint32();
        const lightmap1TextureID = stream.readUint32();
        if (lightmap1TextureID != 0xFFFFFFFF) {
            const switchLightName = stream.readStringStream_4b();
        }

        textureLightmap = lightmap0TextureID;
    }

    if (!!(materialFlags & MaterialFlags.Bumpmap)) {
        const bumpmapTextureID = stream.readUint32();
    }

    const glossmapTextureID = stream.readUint32();

    if (materialFlags & 0x20000) {
        const blinn_info_18 = stream.readFloat32();
        const blinn_info_1C = readEVec3(stream);
    }
    const reflectionTextureID = stream.readUint32();

    const blinn_info_04 = readEVec3(stream);

    if (!!(materialFlags & MaterialFlags.DetailTexture)) {
        const detailTextureID = stream.readUint32();
        const detailFactor = readEVec2(stream);
    }

    const glareIntensity = stream.readFloat32();
    const texCoordTransVel = readEVec2(stream);
    const unk01 = stream.readUint32(); // unused

    const iVertCount = stream.readUint32();
    const streamPosNrm = stream.readSlice(0x10 * iVertCount);

    const bHasStreamColor = stream.readUint32();
    let streamColor: ArrayBufferSlice | null = null;
    if (bHasStreamColor) {
        streamColor = stream.readSlice(0x04 * iVertCount);
    }

    const streamUVCount = stream.readUint32();
    let streamUV: ArrayBufferSlice | null = null;
    let uvCoordScale: number = 0;
    if (streamUVCount != 0) {
        uvCoordScale = stream.readFloat32();
        streamUV = stream.readSlice(0x04 * streamUVCount * iVertCount);
    }

    const bHasStreamBasis = stream.readUint32();
    if (bHasStreamBasis) {
        const streamBasis = stream.readSlice(0x04 * 0x03 * iVertCount);
    }

    const iPolyCount = stream.readUint32();
    const iDegenPolyCount = stream.readUint32();

    // Tristrip
    let streamIdx: ArrayBufferSlice;
    let topology: GfxTopology;
    if (!!(materialFlags & MaterialFlags.Tristrip)) {
        topology = GfxTopology.TriStrips;
        streamIdx = stream.readSlice(0x02 * (iPolyCount + 2));
    } else {
        topology = GfxTopology.Triangles;
        streamIdx = stream.readSlice(0x02 * (iPolyCount * 3));
    }

    if (!!(materialFlags & MaterialFlags.Skinned)) {
        // Denotes an animated / skinned stream.
        assert(false);
    }

    return {
        materialFlags, bbox, materialColor,
        textureIds, textureLightmap, textureDetail, texCoordTransVel,
        streamPosNrm, streamColor, streamUVCount, uvCoordScale, streamUV, streamIdx,
        iVertCount, iPolyCount, topology,
     };
}

function readECollisionMesh(stream: DataStream): void {
    const numCollisionMeshes = stream.readUint32();
    for (let i = 0; i < numCollisionMeshes; i++) {
        stream.readUint32();
        stream.readUint32();
        stream.readUint32();
        stream.readUint32();
        stream.readUint32();
    }

    const numPlanes = stream.readUint32();
    for (let i = 0; i < numPlanes; i++) {
        readEVec3(stream);
    }

    // EOctree
    const v21 = stream.readUint32();
    const cube_0 = stream.readFloat32();
    const cube_1 = stream.readFloat32();
    const cube_2 = stream.readFloat32();
    const cube_3 = stream.readFloat32();
    const m_nLeaf = stream.readUint32();
    const field_14 = stream.readUint32();
    for (let i = 0; i < 6 * field_14; i++)
        stream.readFloat32();
    const dwStoredLeaves = stream.readUint32();
    for (let i = 0; i < m_nLeaf; i++)
        stream.readUint32();
    const field_1C = stream.readUint32();
    for (let i = 0; i < field_1C; i++)
        stream.readUint32();

    const bbox = readEBox3(stream);
}

export interface EMesh {
    name: string;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
    bbox: AABB;
    modelTriggerOBB: EModelTriggerOBB[];
    skeleton: ESkeleton[];
    meshFrag: EMeshFrag[];
    submesh: EMesh[];
}

function readEMesh(stream: DataStream, version: number): EMesh {
    const name = stream.readStringStream_4b();

    const translation = readEVec3(stream);
    const rotation = readEVec3(stream);
    const scale = readEVec3(stream);
    const bbox = readEBox3(stream);

    const modelTriggerOBBCount = stream.readUint32();
    const modelTriggerOBB: EModelTriggerOBB[] = [];
    for (let i = 0; i < modelTriggerOBBCount; i++)
        modelTriggerOBB.push(readEModelTriggerOBB(stream));

    const entityFlags = stream.readUint32();
    if (!!(entityFlags & 0x02)) {
        // LOD.
        const lodCount = stream.readUint8();
        stream.offs += 0x04 * (lodCount - 1);
    }

    const lightCount = stream.readUint32();
    const lights: ELight[] = [];
    for (let i = 0; i < lightCount; i++) {
        lights.push(readELight(stream));
    }

    const skeletonCount = stream.readUint32();
    const skeleton: ESkeleton[] = [];
    for (let i = 0; i < skeletonCount; i++)
        skeleton.push(readESkeleton(stream));

    const meshFragCount = stream.readUint32();
    const meshFrag: EMeshFrag[] = [];
    for (let i = 0; i < meshFragCount; i++)
        meshFrag.push(readEMeshFrag(stream, version));

    const affectorCount = stream.readUint32();
    for (let i = 0; i < affectorCount; i++) {
        const affectorType = stream.readUint32();
        assert(affectorType === 0x00);
        stream.offs += 0x1C;
    }

    const bHasCollisionMesh = stream.readUint32();
    if (bHasCollisionMesh)
        readECollisionMesh(stream);

    const submeshCount = stream.readUint32();
    const submesh: EMesh[] = [];
    for (let i = 0; i < submeshCount; i++)
        submesh.push(readEMesh(stream, version));

    return { name, translation, rotation, scale, bbox, modelTriggerOBB, skeleton, meshFrag, submesh };
}

interface DomainEntityInfo {
    name: string;
    scriptClass: string;
    editVars: string | null;
    position: vec3;
    rotation: vec3;
    scale: vec3;
    flags: number;
    initialMesh: number;
    initialData: number;
}

export interface EDomain {
    name: string;
    bbox: AABB;
    meshes: EMesh[];
    scripts: DomainEntityInfo[];
    subdomains: EDomain[];
}

function readEDomain(stream: DataStream, version: number): EDomain {
    const name = stream.readStringStream_4b();
    const bbox = readEBox3(stream);

    assert(stream.readString(0x04) === 'HSEM');
    const meshCount = stream.readUint32();
    const meshes = [];
    for (let i = 0; i < meshCount; i++)
        meshes.push(readEMesh(stream, version));

    // Entity Data
    assert(stream.readString(0x04) === 'TADE');
    const edatCount = stream.readUint32();
    for (let i = 0; i < edatCount; i++) {
        const tag = stream.readUint32();
        const size = stream.readUint32();
        stream.offs += size;
    }

    // Script
    assert(stream.readString(0x04) === 'PRCS');
    const scrpCount = stream.readUint32();
    const scripts: DomainEntityInfo[] = [];
    for (let i = 0; i < scrpCount; i++) {
        // _DomainEntityInfo
        const name = stream.readStringStream_4b();
        const scriptClass = stream.readStringStream_4b();
        const hasEditVars = stream.readUint32();
        const editVars = hasEditVars ? stream.readStringStream_4b() : null;
        const position = readEVec3(stream);
        const rotation = readEVec3(stream);
        const scale = readEVec3(stream);
        const flags = stream.readUint32();
        const initialMesh = stream.readUint32();
        const initialData = stream.readUint32();
        scripts.push({ name, scriptClass, editVars, position, rotation, scale, flags, initialMesh, initialData, });
    }

    // Runtime Reference
    assert(stream.readString(0x04) === 'FRTR');
    const rtrfCount = stream.readUint32();
    for (let i = 0; i < rtrfCount; i++) {
        console.log(stream.readStringStream_4b());
    }

    const subdomainCount = stream.readUint32();
    const subdomains: EDomain[] = [];
    for (let i = 0; i < subdomainCount; i++) {
        subdomains.push(readEDomain(stream, version));
    }

    return { name, bbox, meshes, scripts, subdomains, };
}

export interface TextureReference {
    textureName: string;
    flags: number;
}

export interface EScene {
    textureReferences: TextureReference[];
    domain: EDomain;
}

export function parse(buffer: ArrayBufferSlice, name: string): EScene {
    const stream = new DataStream(buffer);

    const magic = stream.readString(0x04);
    assert(magic === 'CYSP');
    const version = stream.readUint32();
    assert(version >= 0x13D);
    const unk00 = stream.readUint32();

    const fileCount = stream.readUint32();
    const textureReferences: TextureReference[] = [];
    for (let i = 0; i < fileCount; i++) {
        const textureName = normalizeTextureName(stream.readStringStream_4b());
        const flags = stream.readUint16();
        textureReferences.push({ textureName, flags });
    }

    const domain = readEDomain(stream, version);

    return { textureReferences, domain };
}
