import { mat4, vec4 } from "gl-matrix";
import { Color, White } from "../../Color.js";
import { RwTexture, RwStream, RwEngine, RwPluginID, RwFrame } from "./rwcore.js";

export class RpMaterial {
    public color: Color;
    public ambient: number;
    public specular: number;
    public diffuse: number;
    public texture?: RwTexture;

    public static streamRead(stream: RwStream, rw: RwEngine): RpMaterial | null {
        const material = new RpMaterial();

        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find material struct");
            return null;
        }

        const flags = stream.readInt32();
        material.color = stream.readRGBA();
        const unused = stream.readInt32();
        const textured = stream.readBool();
        material.ambient = stream.readFloat();
        material.specular = stream.readFloat();
        material.diffuse = stream.readFloat();

        if (textured) {
            if (!stream.findChunk(RwPluginID.TEXTURE)) {
                console.error("Could not find texture");
                return null;
            }

            const texture = RwTexture.streamRead(stream, rw);
            if (texture) {
                material.texture = texture;
            }
        }

        const extension = stream.findChunk(RwPluginID.EXTENSION);
        if (!extension) {
            console.error("Could not find material extension");
            return null;
        }
        // Skip extensions
        stream.pos = extension.end;

        return material;
    }
}

export interface RpMesh {
    matIndex: number;
    indices: Uint16Array;
}

export class RpMeshHeader {
    public flags: number = 0;
    public totalIndicesInMesh: number = 0;
    public meshes: RpMesh[] = [];

    public static streamRead(stream: RwStream, rw: RwEngine): RpMeshHeader | null {
        const mh = new RpMeshHeader();

        const flags = stream.readUint32();
        const numMeshes = stream.readUint32();
        const totalIndicesInMesh = stream.readUint32();

        mh.flags = flags;
        mh.totalIndicesInMesh = totalIndicesInMesh;

        for (let i = 0; i < numMeshes; i++) {
            const numIndices = stream.readUint32();
            const matIndex = stream.readInt32();
            const indices = stream.readArray(Uint32Array, numIndices);

            mh.meshes.push({ matIndex, indices: new Uint16Array(indices) });
        }

        return mh;
    }
}

export interface RpTriangle {
    vertIndex: [number, number, number];
    matIndex: number;
}

export class RpMorphTarget {
    public boundingSphere: vec4;
    public verts?: Float32Array;
    public normals?: Float32Array;
}

export enum RpGeometryFlag {
    TRISTRIP = 0x00000001,
    POSITIONS = 0x00000002,
    TEXTURED = 0x00000004,
    PRELIT = 0x00000008,
    NORMALS = 0x00000010,
    LIGHT = 0x00000020,
    MODULATEMATERIALCOLOR = 0x00000040,
    TEXTURED2 = 0x00000080,
    NATIVE = 0x01000000,
    NATIVEINSTANCE = 0x02000000,
    FLAGSMASK = 0x000000FF,
    NATIVEFLAGSMASK = 0x0F000000
}

export class RpGeometry {
    public flags: number = 0;
    public numVertices: number = 0;
    public mesh: RpMeshHeader;
    public preLitLum?: Float32Array;
    public texCoords?: Float32Array;
    //public triangles: RwTriangle[] = [];
    public morphTargets: RpMorphTarget[] = [];
    public materials: RpMaterial[] = [];
    public instanceData: any;

    public static streamRead(stream: RwStream, rw: RwEngine): RpGeometry | null {
        const geom = new RpGeometry();

        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find geometry struct");
            return null;
        }

        const format = stream.readInt32();
        const numTriangles = stream.readInt32();
        const numVertices = stream.readInt32();
        const numMorphTargets = stream.readInt32();

        if (format & RpGeometryFlag.NATIVE) {
            console.error("Native data not supported");
            return null;
        }

        geom.flags = format & RpGeometryFlag.FLAGSMASK;
        geom.numVertices = numVertices;

        let numTexCoordSets = 0;
        if (format & 0xFF0000) {
            numTexCoordSets = (format & 0xFF0000) >> 16;
        } else if (format & RpGeometryFlag.TEXTURED2) {
            numTexCoordSets = 2;
        } else if (format & RpGeometryFlag.TEXTURED) {
            numTexCoordSets = 1;
        }

        if (!(format & RpGeometryFlag.NATIVE)) {
            if (numVertices) {
                if (format & RpGeometryFlag.PRELIT) {
                    const bytes = stream.readArray(Uint8Array, numVertices * 4);
                    geom.preLitLum = new Float32Array(numVertices * 4);
                    for (let i = 0; i < numVertices * 4; i++) {
                        geom.preLitLum[i] = bytes[i] / 255.0;
                    }
                }
                if (numTexCoordSets) {
                    geom.texCoords = stream.readArray(Float32Array, numTexCoordSets * numVertices * 2);
                }
                if (numTriangles) {
                    const triangles = stream.readArray(Uint32Array, numTriangles * 2);
                    /*
                    let offs = 0;
                    for (let i = 0; i < numTriangles; i++) {
                        const vertex01 = triangles[offs++];
                        const vertex2Mat = triangles[offs++];
                        const vertIndex0 = (vertex01 >> 16) & 0xFFFF;
                        const vertIndex1 = vertex01 & 0xFFFF;
                        const vertIndex2 = (vertex2Mat >> 16) & 0xFFFF;
                        const matIndex = vertex2Mat & 0xFFFF;
                        geom.triangles.push({ vertIndex: [vertIndex0, vertIndex1, vertIndex2], matIndex });
                    }
                    */
                }
            }
        }

        if (numMorphTargets) {
            for (let i = 0; i < numMorphTargets; i++) {
                const mt = new RpMorphTarget();
                mt.boundingSphere = stream.readVec4();
                const pointsPresent = stream.readBool();
                const normalsPresent = stream.readBool();
                if (pointsPresent) {
                    mt.verts = stream.readArray(Float32Array, numVertices * 3);
                }
                if (normalsPresent) {
                    mt.normals = stream.readArray(Float32Array, numVertices * 3);
                }
                geom.morphTargets.push(mt);
            }
        }

        if (!stream.findChunk(RwPluginID.MATLIST)) {
            console.error("Could not find material list");
            return null;
        }

        if (!geom.readMaterialList(stream, rw)) {
            return null;
        }

        const extension = stream.findChunk(RwPluginID.EXTENSION);
        if (!extension) {
            console.error("Could not find geometry extension");
            return null;
        }
        
        while (stream.pos < extension.end) {
            const header = stream.readChunkHeader();
            if (header.type === RwPluginID.BINMESHPLUGIN) {
                const mesh = RpMeshHeader.streamRead(stream, rw);
                if (!mesh) {
                    return null;
                }
                geom.mesh = mesh;
            } else {
                stream.pos = header.end;
            }
        }

        return geom;
    }

    private readMaterialList(stream: RwStream, rw: RwEngine): boolean {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find material list struct");
            return false;
        }

        const numMaterials = stream.readInt32();
        const matindex = stream.readArray(Int32Array, numMaterials);
        
        for (let i = 0; i < numMaterials; i++) {
            let material = null;
            if (matindex[i] < 0) {
                // New material
                if (!stream.findChunk(RwPluginID.MATERIAL)) {
                    console.error("Could not find material");
                    return false;
                }
                material = RpMaterial.streamRead(stream, rw);
                if (!material) {
                    return false;
                }
            } else {
                material = this.materials[matindex[i]];
            }
            this.materials.push(material);
        }

        return true;
    }
}

export enum RpAtomicFlag {
    COLLISIONTEST = 0x01,
    RENDER = 0x04
}

export class RpAtomic {
    public flags: number;
    public frame: RwFrame;
    public geometry: RpGeometry;

    private _pipeline: RpAtomicPipeline;

    constructor(rw: RwEngine) {
        this._pipeline = rw.defaultAtomicPipeline;
    }

    public getPipeline() {
        return this._pipeline;
    }

    public setPipeline(p: RpAtomicPipeline | null, rw: RwEngine) {
        this._pipeline.destroy(this, rw);
        this._pipeline = p || rw.defaultAtomicPipeline;
    }

    public render(rw: RwEngine) {
        this._pipeline.instance(this, rw);
    }

    public destroy(rw: RwEngine) {
        this._pipeline.destroy(this, rw);
    }
}

export interface RpAtomicPipeline {
    instance(atomic: RpAtomic, rw: RwEngine): void;
    destroy(atomic: RpAtomic, rw: RwEngine): void;
}

export const enum RpLightType {
    NALIGHTTYPE = 0,
    DIRECTIONAL,
    AMBIENT,
    // Currently unsupported
    //POINT = 0x80,
    //SPOT,
    //SPOTSOFT
}

export class RpLight {
    public frame = new RwFrame();
    public color = White;

    constructor(public type: RpLightType) {
        this.frame.matrix = mat4.create();
    }

    public destroy() {
    }
}

export class RpClump {
    public frames: RwFrame[] = [];
    public geometries: RpGeometry[] = [];
    public atomics: RpAtomic[] = [];

    public destroy(rw: RwEngine) {
        for (const atomic of this.atomics) {
            atomic.destroy(rw);
        }
    }

    public render(rw: RwEngine) {
        for (const atomic of this.atomics) {
            if (atomic.flags & RpAtomicFlag.RENDER) {
                atomic.render(rw);
            }
        }
    }

    public static streamRead(stream: RwStream, rw: RwEngine): RpClump | null {
        const clump = new RpClump();
        
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("[RwClump] Could not find clump struct");
            return null;
        }

        const numAtomics = stream.readInt32();
        const numLights = stream.readInt32();
        const numCameras = stream.readInt32();

        if (!stream.findChunk(RwPluginID.FRAMELIST)) {
            console.error("[RwClump] Could not find frame list");
            return null;
        }

        if (!clump.readFrameList(stream, rw)) {
            return null;
        }

        if (!stream.findChunk(RwPluginID.GEOMETRYLIST)) {
            console.error("[RwClump] Could not find geometry list");
            return null;
        }

        if (!clump.readGeometryList(stream, rw)) {
            return null;
        }

        for (let i = 0; i < numAtomics; i++) {
            if (!stream.findChunk(RwPluginID.ATOMIC)) {
                console.error("[RwClump] Could not find atomic");
                return null;
            }

            if (!clump.readAtomic(stream, rw)) {
                return null;
            }
        }

        return clump;
    }

    private readFrameList(stream: RwStream, rw: RwEngine): boolean {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find frame list struct");
            return false;
        }

        const numFrames = stream.readInt32();
        for (let i = 0; i < numFrames; i++) {
            const frame = new RwFrame();

            frame.matrix = mat4.create();
            frame.matrix[0] = stream.readFloat();
            frame.matrix[1] = stream.readFloat();
            frame.matrix[2] = stream.readFloat();
            frame.matrix[4] = stream.readFloat();
            frame.matrix[5] = stream.readFloat();
            frame.matrix[6] = stream.readFloat();
            frame.matrix[8] = stream.readFloat();
            frame.matrix[9] = stream.readFloat();
            frame.matrix[10] = stream.readFloat();
            frame.matrix[12] = stream.readFloat();
            frame.matrix[13] = stream.readFloat();
            frame.matrix[14] = stream.readFloat();

            const parentIndex = stream.readInt32();
            const data = stream.readUint32();
            
            if (parentIndex >= 0) {
                frame.parent = this.frames[parentIndex];
            }

            this.frames.push(frame);
        }

        return true;
    }

    private readGeometryList(stream: RwStream, rw: RwEngine): boolean {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find geometry list struct");
            return false;
        }

        const numGeoms = stream.readInt32();
        for (let i = 0; i < numGeoms; i++) {
            if (!stream.findChunk(RwPluginID.GEOMETRY)) {
                console.error("Could not find geometry");
                return false;
            }
            
            const geom = RpGeometry.streamRead(stream, rw);
            if (!geom) {
                return false;
            }

            this.geometries.push(geom);
        }

        return true;
    }

    private readAtomic(stream: RwStream, rw: RwEngine): boolean {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find atomic struct");
            return false;
        }

        const frameIndex = stream.readInt32();
        const geomIndex = stream.readInt32();
        const flags = stream.readInt32();
        const unused = stream.readInt32();

        const frame = this.frames[frameIndex];
        const geometry = this.geometries[geomIndex];

        const atomic = new RpAtomic(rw);
        atomic.flags = flags;
        atomic.frame = frame;
        atomic.geometry = geometry;

        this.atomics.push(atomic);

        return true;
    }
}

export class RpWorld {
    public lights = new Set<RpLight>();

    public addLight(light: RpLight) {
        this.lights.add(light);
    }

    public removeLight(light: RpLight) {
        this.lights.delete(light);
    }
}