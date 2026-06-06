import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";
import { RswVec3 } from "./rsw.js";

export interface RsmTexCoord {
    color: number;
    u: number;
    v: number;
}

export interface RsmFace {
    vertIdx: [number, number, number];
    texIdx: [number, number, number];
    textureId: number;
    twoSided: number;
    smoothGroup: number;
}

export interface RsmRotKeyframe {
    frame: number;
    q: [number, number, number, number];
}

export interface RsmPosKeyframe {
    frame: number;
    p: RswVec3;
}

export interface RsmScaleKeyframe {
    frame: number;
    s: RswVec3;
}

export interface RsmNode {
    name: string;
    parent: string;
    textureIds: number[];

    offsetMatrix: number[];
    offsetTranslation: RswVec3;
    position: RswVec3;
    rotAngle: number;
    rotAxis: RswVec3;
    scale: RswVec3;
    vertices: RswVec3[];
    texCoords: RsmTexCoord[];
    faces: RsmFace[];
    posKeyframes: RsmPosKeyframe[];
    rotKeyframes: RsmRotKeyframe[];
    scaleKeyframes: RsmScaleKeyframe[];
}

export interface RsmModel {
    major: number;
    minor: number;
    shadeType: number;
    alpha: number;
    mainNode: string;
    textures: string[];
    nodes: RsmNode[];

    animLength: number;

    frameRate: number;
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
        const s = readString(this.buffer, this.offs, width, true, "euc-kr");
        this.offs += width;
        return s;
    }

    public sizedName(): string {
        const width = this.i32();
        if (width < 0)
            throw new Error(`RSM: bad string length ${width}`);
        return this.name(width);
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
    const frameRate = ge(2, 2) ? r.f32() : 0;

    if (!ge(2, 2)) r.skip(16);

    const textures: string[] = [];
    const textureToId = new Map<string, number>();
    const addTexture = (name: string): number => {
        let id = textureToId.get(name);
        if (id === undefined) {
            id = textures.length;
            textures.push(name);
            textureToId.set(name, id);
        }
        return id;
    };

    if (!ge(2, 3)) {
        const numTextures = r.i32();
        if (numTextures < 0)
            throw new Error(`RSM: bad texture count ${numTextures}`);
        for (let i = 0; i < numTextures; i++)
            textures.push(ge(2, 2) ? r.sizedName() : r.name(40));
    }

    const mainNodes: string[] = [];
    if (ge(2, 2)) {
        const numMainNodes = r.i32();
        if (numMainNodes < 0)
            throw new Error(`RSM: bad main node count ${numMainNodes}`);
        for (let i = 0; i < numMainNodes; i++)
            mainNodes.push(r.sizedName());
    } else {
        mainNodes.push(r.name(40));
    }
    const mainNode = mainNodes[0] ?? "";

    const numNodes = r.i32();
    if (numNodes < 0)
        throw new Error(`RSM: bad node count ${numNodes}`);

    const nodes: RsmNode[] = [];
    for (let n = 0; n < numNodes; n++) {
        const name = ge(2, 2) ? r.sizedName() : r.name(40);
        const parent = ge(2, 2) ? r.sizedName() : r.name(40);

        const numNodeTex = r.i32();
        if (numNodeTex < 0)
            throw new Error(`RSM: bad node texture count ${numNodeTex}`);
        const textureIds: number[] = [];
        for (let i = 0; i < numNodeTex; i++) {
            if (ge(2, 3))
                textureIds.push(addTexture(r.sizedName()));
            else
                textureIds.push(r.i32());
        }

        const offsetMatrix: number[] = [];
        for (let i = 0; i < 9; i++)
            offsetMatrix.push(r.f32());
        let offsetTranslation: RswVec3, position: RswVec3, rotAngle: number, rotAxis: RswVec3, scale: RswVec3;
        if (ge(2, 2)) {
            offsetTranslation = { x: 0, y: 0, z: 0 };
            position = r.vec3();
            rotAngle = 0;
            rotAxis = { x: 0, y: 0, z: 0 };
            scale = { x: 1, y: 1, z: 1 };
        } else {
            offsetTranslation = r.vec3();
            position = r.vec3();
            rotAngle = r.f32();
            rotAxis = r.vec3();
            scale = r.vec3();
        }

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
            const color = ge(1, 2) ? r.u32() : 0xFFFFFFFF;
            const u = r.f32();
            const v = r.f32();
            texCoords.push({ color, u, v });
        }

        const numFaces = r.i32();
        if (numFaces < 0)
            throw new Error(`RSM: bad face count ${numFaces}`);
        const faces: RsmFace[] = [];
        for (let i = 0; i < numFaces; i++) {
            const faceEnd = ge(2, 2) ? (() => {
                const len = r.i32();
                if (len < 0)
                    throw new Error(`RSM: bad face length ${len}`);
                return r.offs + len;
            })() : -1;
            const vertIdx: [number, number, number] = [r.u16(), r.u16(), r.u16()];
            const texIdx: [number, number, number] = [r.u16(), r.u16(), r.u16()];
            const textureId = r.u16();
            r.u16();
            const twoSided = r.i32();
            const smoothGroup = r.i32();
            if (faceEnd >= 0) {
                if (r.offs > faceEnd)
                    throw new Error(`RSM: face overread at ${r.offs} > ${faceEnd}`);
                r.skip(faceEnd - r.offs);
            }
            faces.push({ vertIdx, texIdx, textureId, twoSided, smoothGroup });
        }

        const posKeyframes: RsmPosKeyframe[] = [];
        const rotKeyframes: RsmRotKeyframe[] = [];
        const scaleKeyframes: RsmScaleKeyframe[] = [];
        if (ge(2, 2)) {
            const numScaleKf = r.i32();
            if (numScaleKf < 0)
                throw new Error(`RSM: bad scale keyframe count ${numScaleKf}`);
            for (let i = 0; i < numScaleKf; i++) {
                const frame = r.i32();
                scaleKeyframes.push({ frame, s: r.vec3() });
                r.f32();
            }

            const numRotKf = r.i32();
            if (numRotKf < 0)
                throw new Error(`RSM: bad rotation keyframe count ${numRotKf}`);
            for (let i = 0; i < numRotKf; i++) {
                const frame = r.i32();
                const qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
                rotKeyframes.push({ frame, q: [qx, qy, qz, qw] });
            }

            const numPosKf = r.i32();
            if (numPosKf < 0)
                throw new Error(`RSM: bad position keyframe count ${numPosKf}`);
            for (let i = 0; i < numPosKf; i++) {
                const frame = r.i32();
                posKeyframes.push({ frame, p: r.vec3() });
                r.i32();
            }

            if (ge(2, 3)) {
                const numTexAnimGroups = r.i32();
                if (numTexAnimGroups < 0)
                    throw new Error(`RSM: bad texture animation group count ${numTexAnimGroups}`);
                for (let i = 0; i < numTexAnimGroups; i++) {
                    r.i32();
                    const numTexAnims = r.i32();
                    if (numTexAnims < 0)
                        throw new Error(`RSM: bad texture animation count ${numTexAnims}`);
                    for (let j = 0; j < numTexAnims; j++) {
                        r.i32();
                        const numFrames = r.i32();
                        if (numFrames < 0)
                            throw new Error(`RSM: bad texture animation frame count ${numFrames}`);
                        r.skip(numFrames * 8);
                    }
                }
            }
        } else {

            if (ge(1, 6)) {
                const numPosKf = r.i32();
                if (numPosKf < 0)
                    throw new Error(`RSM: bad position keyframe count ${numPosKf}`);
                for (let i = 0; i < numPosKf; i++) {
                    const frame = r.i32();
                    posKeyframes.push({ frame, p: r.vec3() });
                }
            }

            const numRotKf = r.i32();
            if (numRotKf < 0)
                throw new Error(`RSM: bad rotation keyframe count ${numRotKf}`);
            for (let i = 0; i < numRotKf; i++) {
                const frame = r.i32();
                const qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
                rotKeyframes.push({ frame, q: [qx, qy, qz, qw] });
            }
        }

        nodes.push({
            name, parent, textureIds, offsetMatrix, offsetTranslation,
            position, rotAngle, rotAxis, scale, vertices, texCoords, faces,
            posKeyframes, rotKeyframes, scaleKeyframes,
        });
    }

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

    return { major, minor, shadeType, alpha, mainNode, textures, nodes, animLength, frameRate };
}
