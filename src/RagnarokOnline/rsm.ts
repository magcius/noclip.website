
// Parser for Ragnarok Online's RSM 3D model format (magic "GRSM").
//
// An RSM is a hierarchy of nodes (a tree, parented by name). Each node carries
// its own vertex list, texture-coordinate list, triangle faces (each face
// references a per-node texture slot), an offset matrix baked into its mesh, and
// a local transform (translation + axis-angle rotation + scale). The model-level
// header lists the texture filenames every node's faces ultimately reference.
//
// Nodes may also carry keyframe tracks (rotation always, position from v1.5,
// scale from v2.2) and the model header carries an animation length. These drive
// the moving parts of a model (spinning signs, windmills); they are retained
// here and applied by the renderer for animated models. Static models (no
// keyframes) ignore them and render their rest pose.
//
// All multi-byte values are little-endian. Texture names are CP949 (EUC-KR),
// decoded with the same TextDecoder the GND/RSW use.

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { RswVec3 } from "./rsw.js";

const eucKrDecoder = new TextDecoder("euc-kr");

export interface RsmTexCoord {
    color: number;
    u: number;
    v: number;
}

export interface RsmFace {
    vertIdx: [number, number, number];
    texIdx: [number, number, number];
    textureId: number;   // index into RsmNode.textureIds
    twoSided: number;
    smoothGroup: number;
}

// A rotation keyframe: a unit quaternion (x,y,z,w) sampled at frame `frame`.
export interface RsmRotKeyframe {
    frame: number;
    q: [number, number, number, number];
}

// A position keyframe (v1.5+): the node-local translation at frame `frame`.
export interface RsmPosKeyframe {
    frame: number;
    p: RswVec3;
}

// A scale keyframe (v2.2+): the node-local scale at frame `frame`.
export interface RsmScaleKeyframe {
    frame: number;
    s: RswVec3;
}

export interface RsmNode {
    name: string;
    parent: string;
    // Per-node texture indices into RsmModel.textures.
    textureIds: number[];
    // 3x3 linear part of the offset transform, row-major (9 floats).
    offsetMatrix: number[];
    offsetTranslation: RswVec3;
    position: RswVec3;
    rotAngle: number;     // radians
    rotAxis: RswVec3;
    scale: RswVec3;
    vertices: RswVec3[];
    texCoords: RsmTexCoord[];
    faces: RsmFace[];
    // Animation tracks (empty when the node does not animate that channel).
    posKeyframes: RsmPosKeyframe[];
    rotKeyframes: RsmRotKeyframe[];
    scaleKeyframes: RsmScaleKeyframe[];
}

export interface RsmModel {
    major: number;
    minor: number;
    shadeType: number;
    alpha: number;        // 0..255
    mainNode: string;
    textures: string[];   // CP949, relative to the texture root
    nodes: RsmNode[];
    // Loop length in frames (the model-header animation length). Frame numbers in
    // the keyframe tracks are measured against this; playback wraps at it.
    animLength: number;
}

class Reader {
    private view: DataView;
    public offs = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`RSM: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u8(): number { this.assertCanRead(1); const v = this.view.getUint8(this.offs); this.offs += 1; return v; }
    public u16(): number { this.assertCanRead(2); const v = this.view.getUint16(this.offs, true); this.offs += 2; return v; }
    public i32(): number { this.assertCanRead(4); const v = this.view.getInt32(this.offs, true); this.offs += 4; return v; }
    public u32(): number { this.assertCanRead(4); const v = this.view.getUint32(this.offs, true); this.offs += 4; return v >>> 0; }
    public f32(): number { this.assertCanRead(4); const v = this.view.getFloat32(this.offs, true); this.offs += 4; return v; }

    public skip(n: number): void { this.assertCanRead(n); this.offs += n; }
    public remaining(): number { return this.view.byteLength - this.offs; }

    public vec3(): RswVec3 {
        return { x: this.f32(), y: this.f32(), z: this.f32() };
    }

    public magic(width: number): string {
        this.assertCanRead(width);
        const bytes = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        let end = bytes.indexOf(0);
        if (end < 0)
            end = width;
        return String.fromCharCode(...bytes.subarray(0, end));
    }

    public name(width: number): string {
        this.assertCanRead(width);
        const bytes = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        let end = bytes.indexOf(0);
        if (end < 0)
            end = width;
        return eucKrDecoder.decode(bytes.subarray(0, end));
    }
}

export function parseRSM(buffer: ArrayBufferSlice): RsmModel {
    const r = new Reader(buffer);

    const magic = r.magic(4);
    if (magic !== "GRSM")
        throw new Error(`RSM: bad magic "${magic}"`);

    const major = r.u8();
    const minor = r.u8();

    const ge = (mj: number, mn: number): boolean =>
        (major === mj && minor >= mn) || major > mj;

    const animLength = r.i32();
    const shadeType = r.i32();
    const alpha = ge(1, 4) ? r.u8() : 0xFF;

    // 16-byte reserved/unused block (versions < 2.2).
    if (!ge(2, 2)) r.skip(16);

    const numTextures = r.i32();
    if (numTextures < 0)
        throw new Error(`RSM: bad texture count ${numTextures}`);
    const textures: string[] = [];
    for (let i = 0; i < numTextures; i++)
        textures.push(r.name(40));

    const mainNode = r.name(40);

    const numNodes = r.i32();
    if (numNodes < 0)
        throw new Error(`RSM: bad node count ${numNodes}`);

    const nodes: RsmNode[] = [];
    for (let n = 0; n < numNodes; n++) {
        const name = r.name(40);
        const parent = r.name(40);

        const numNodeTex = r.i32();
        if (numNodeTex < 0)
            throw new Error(`RSM: bad node texture count ${numNodeTex}`);
        const textureIds: number[] = [];
        for (let i = 0; i < numNodeTex; i++)
            textureIds.push(r.i32());

        const offsetMatrix: number[] = [];
        for (let i = 0; i < 9; i++)
            offsetMatrix.push(r.f32());
        const offsetTranslation = r.vec3();
        const position = r.vec3();
        const rotAngle = r.f32();
        const rotAxis = r.vec3();
        const scale = r.vec3();

        const numVertices = r.i32();
        if (numVertices < 0)
            throw new Error(`RSM: bad vertex count ${numVertices}`);
        const vertices: RswVec3[] = [];
        for (let i = 0; i < numVertices; i++)
            vertices.push(r.vec3());

        const numTexCoords = r.i32();
        if (numTexCoords < 0)
            throw new Error(`RSM: bad texcoord count ${numTexCoords}`);
        const texCoords: RsmTexCoord[] = [];
        for (let i = 0; i < numTexCoords; i++) {
            const color = ge(1, 2) ? r.u32() : 0xFFFFFFFF;  // color present from v1.2
            const u = r.f32();
            const v = r.f32();
            texCoords.push({ color, u, v });
        }

        const numFaces = r.i32();
        if (numFaces < 0)
            throw new Error(`RSM: bad face count ${numFaces}`);
        const faces: RsmFace[] = [];
        for (let i = 0; i < numFaces; i++) {
            const vertIdx: [number, number, number] = [r.u16(), r.u16(), r.u16()];
            const texIdx: [number, number, number] = [r.u16(), r.u16(), r.u16()];
            const textureId = r.u16();
            r.u16();                  // padding
            const twoSided = r.i32();
            const smoothGroup = r.i32();
            faces.push({ vertIdx, texIdx, textureId, twoSided, smoothGroup });
        }

        // Position keyframes are per-node from v1.6 onward. Decomp Model.cpp:655
        // reads posanim.Load for verMinor>=5, but the on-disk v1.5 corpus
        // disagrees: 138/344 v1.5 RSMs (e.g. prontera_re/egg_s_01.rsm) yield
        // infeasible counts when a per-node posanim block is read, while all 344
        // parse cleanly when it isn't. The decomp source is a later client where
        // the format was bumped; for the data we actually load, the gate is 1.6.
        const posKeyframes: RsmPosKeyframe[] = [];
        if (ge(1, 6)) {
            const numPosKf = r.i32();
            if (numPosKf < 0)
                throw new Error(`RSM: bad position keyframe count ${numPosKf}`);
            for (let i = 0; i < numPosKf; i++) {
                const frame = r.i32();
                posKeyframes.push({ frame, p: r.vec3() });
            }
        }

        // Rotation keyframes (always present): { int32 frame; float qx,qy,qz,qw }.
        const rotKeyframes: RsmRotKeyframe[] = [];
        const numRotKf = r.i32();
        if (numRotKf < 0)
            throw new Error(`RSM: bad rotation keyframe count ${numRotKf}`);
        for (let i = 0; i < numRotKf; i++) {
            const frame = r.i32();
            const qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
            rotKeyframes.push({ frame, q: [qx, qy, qz, qw] });
        }

        // Scale keyframes (v2.2+): { int32 frame; float sx,sy,sz }.
        const scaleKeyframes: RsmScaleKeyframe[] = [];
        if (ge(2, 2)) {
            const numScaleKf = r.i32();
            if (numScaleKf < 0)
                throw new Error(`RSM: bad scale keyframe count ${numScaleKf}`);
            for (let i = 0; i < numScaleKf; i++) {
                const frame = r.i32();
                scaleKeyframes.push({ frame, s: r.vec3() });
            }
        }

        nodes.push({
            name, parent, textureIds, offsetMatrix, offsetTranslation,
            position, rotAngle, rotAxis, scale, vertices, texCoords, faces,
            posKeyframes, rotKeyframes, scaleKeyframes,
        });
    }

    // Model-level trailer (versions < 1.6): a position-keyframe section and a
    // volume-box section, both count-prefixed. 6081/6086 v1.4 RSMs in the corpus
    // have a clean trailer; the 5 outliers (morgue_h_02..06) carry garbage here.
    // The renderer only needs the nodes above, so consume only when the counts
    // fit, and warn so a future format change is visible.
    if (!ge(1, 6)) {
        if (r.remaining() >= 4) {
            const numPosKf = r.i32();
            if (numPosKf < 0 || numPosKf * 16 > r.remaining())
                console.warn(`RSM: skipping bad model-level posKf trailer (count=${numPosKf}, remaining=${r.remaining()})`);
            else
                r.skip(numPosKf * 16);
        }

        if (r.remaining() >= 4) {
            const numVolumeBox = r.i32();
            const boxSize = ge(1, 3) ? 40 : 36;
            if (numVolumeBox < 0 || numVolumeBox * boxSize > r.remaining())
                console.warn(`RSM: skipping bad volume-box trailer (count=${numVolumeBox}, remaining=${r.remaining()})`);
            else
                r.skip(numVolumeBox * boxSize);
        }
    }

    return { major, minor, shadeType, alpha, mainNode, textures, nodes, animLength };
}
