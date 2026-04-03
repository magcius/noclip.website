import { mat4 } from "gl-matrix";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";
import { AABB } from "../Geometry";
import ArrayBufferSlice from "../ArrayBufferSlice";

// Credit to the "RW Analyze" tool by Steve M. for helping to parse the RenderWare files

enum Chunk {
    STRUCT = 1,
    STRING = 2,
    EXTENSION = 3,
    TEXTURE = 6,
    MATERIAL = 7,
    MATERIAL_LIST = 8,
    ATOMIC_SECTION = 9,
    PLANE_SECTION = 10,
    WORLD = 11,
    FRAME_LIST = 14,
    GEOMETRY = 15,
    CLUMP = 16,
    ATOMIC = 0x14,
    TEXTURE_NATIVE = 0x15,
    TEXTURE_DICTIONARY = 0x16,
    GEOMETRY_LIST = 0x1A,
    MORPH_PLG = 0x105,
    ANIMATION_PLG = 0x108,
    SKY_MIPMAP_VAL = 0x110,
    SKIN_PLG = 0x116,
    PARTICLES_PLG = 0x118,
    COLLISION_PLG = 0x11D,
    MATERIAL_EFFECTS_PLG = 0x120,
    LIBRARY_PLG = 0x189,
    BIN_MESH_PLG = 0x50E
}

interface NodeHeader {
    id: number;
    size: number;
}

interface IndexSplit {
    materialIndex: number;
    indices: number[];
}

interface GeometryData {
    vertices: number[];
    uvs: number[];
    colors: number[];
    boundingSphere: CasperBoundingSphere;
}

export interface CasperBSPNode {
    type: "node" | "leaf";
    mesh?: CasperMesh;
    leaves: CasperBSPNode[];
}

export interface CapserLevel {
    materials: string[];
    root: CasperBSPNode;
    number: number;
    name: string;
}

/**
 * An object definition from the CASPER.OBD file
 */
export interface CasperObjectDefinition {
    names: string[];
    dffPath: string;
    thirdValue: string;
}

export interface CasperMesh {
    vertices: number[];
    uvs: number[];
    colors: number[];
    indexSplits: IndexSplit[];
    materials?: string[];
    boundingSphere?: CasperBoundingSphere;
}

export interface CasperBoundingSphere {
    x: number;
    y: number;
    z: number;
    r: number;
}

export class CasperObjectInstance {
    name: string = "";
    position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    rotation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };
    properties: string[] = [];
    shiftMatrix: mat4 = mat4.create();
    bbox: AABB = new AABB();
}

export class CasperTexture {
    public gfxTexture: GfxTexture;

    constructor(device: GfxDevice, name: string, mips: Uint8Array[], width: number, height: number, public bitDepth: number, public hasAlpha: boolean = false) {
        const gfxTexture = device.createTexture({
            width, height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1,
            numLevels: mips.length
        });
        device.setResourceName(gfxTexture, name);
        device.uploadTextureData(gfxTexture, 0, mips);
        this.gfxTexture = gfxTexture;
    }
}

const SCALE_OVERRIDES: Map<string, number[]> = new Map<string, number[]>([["needle2", [1, 1, 1]]]);
const IGNORED_OBJS: string[] = ["6wall01", "6wall02", "6wall03", "6wall04", "6wall05", "robostand"];

export class CasperRWParser {
    private data: DataView;
    private offset: number = 0;

    constructor(buffer: ArrayBufferSlice) {
        this.data = buffer.createDataView();
    }

    private parseHeader(): NodeHeader {
        const id = this.data.getUint32(this.offset, true);
        const size = this.data.getUint32(this.offset + 4, true);
        this.offset += 12;
        return { id, size };
    }

    public parseBSP(name: string, number: number): CapserLevel {
        const level: CapserLevel = {
            materials: [],
            root: { type: "node", leaves: [] },
            number, name
        };

        while (this.offset < this.data.byteLength) {
            const header = this.parseHeader();
            const endOffset = this.offset + header.size;
            if (header.id === Chunk.WORLD) {
                const struct = this.parseHeader();
                this.offset += struct.size;
                while (this.offset < endOffset) {
                    const childHeader = this.parseHeader();
                    if (childHeader.id === Chunk.MATERIAL_LIST) {
                        level.materials = this.parseMaterialList(childHeader.size);
                    } else if (childHeader.id === Chunk.PLANE_SECTION) {
                        level.root = this.parsePlaneSection(childHeader);
                    } else {
                        this.offset += childHeader.size;
                    }
                }
            } else {
                this.offset = endOffset;
            }
        }

        return level;
    }

    public parseDIC(device: GfxDevice, materials: string[]): Map<string, CasperTexture> {
        this.offset = 0;
        const txdHeader = this.parseHeader();
        const txdEnd = this.offset + txdHeader.size;
        const txdMetaStructHeader = this.parseHeader();
        this.offset += 4;
        const textures: Map<string, CasperTexture> = new Map();
        while (this.offset < txdEnd) {
            const nativeHeader = this.parseHeader();
            const nativeEnd = this.offset + nativeHeader.size;
            if (this.offset >= txdEnd) {
                break;
            }
            // this always has "PS2"
            const structMeta = this.parseHeader();
            this.offset += structMeta.size;
            const nameHeader = this.parseHeader();
            const textureName = this.readString(nameHeader.size);
            // only parse materials with known name
            if (materials.indexOf(textureName) === -1) {
                this.offset = nativeEnd;
                continue;
            }
            // not sure what exactly this is, but any texture that has transparency in the game has this set to something
            // could be an alpha mask but there's not any matching texture with the name it gives
            const alphaHeader = this.parseHeader();
            const alphaName = this.readString(alphaHeader.size);

            const pixelStructHeader = this.parseHeader();
            const pixelStructMeta = this.parseHeader(); // always 64 bytes
            const pixelStructMetaEnd = this.offset + pixelStructMeta.size;
            const width = this.data.getUint16(this.offset, true);
            const height = this.data.getUint16(this.offset + 4, true);
            const bitDepth = this.data.getUint8(this.offset + 8);

            const pixelCount = width * height;
            const mips: Uint8Array[] = [];

            this.offset = pixelStructMetaEnd;
            const pixelDataHeader = this.parseHeader();
            if (bitDepth === 8) {
                const colorIndices = new Uint8Array(this.data.buffer, this.offset + 80, pixelCount);
                const swizzledCLUT = new Uint8Array(this.data.buffer, this.offset + pixelDataHeader.size - 1024, 1024);

                const clut = new Uint8Array(1024);
                for (let i = 0; i < 256; i++) {
                    const unswizzled = (i & 231) | ((i & 8) << 1) | ((i & 16) >> 1);
                    for (let c = 0; c < 4; c++) {
                        clut[i * 4 + c] = swizzledCLUT[unswizzled * 4 + c];
                    }
                }

                // Credit: https://ps2linux.no-ip.info/playstation2-linux.com/docs/howto/display_docef7c.html?docid=75
                const rgba = new Uint8Array(pixelCount * 4);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const blockLocation = (y & -16) * width + (x & -16) * 2;
                        const swapSelector = (((y + 2) >> 2) & 1) * 4;
                        const posY = (((y & -4) >> 1) + (y & 1)) & 7;
                        const columnLocation = posY * width * 2 + ((x + swapSelector) & 7) * 4;
                        const byteNum = ((y >> 1) & 1) + ((x >> 2) & 2);
                        const colorIndex = colorIndices[blockLocation + columnLocation + byteNum];
                        const index = ((y * width) + x) * 4;
                        const pointer = colorIndex * 4;
                        rgba[index] = clut[pointer];
                        rgba[index + 1] = clut[pointer + 1];
                        rgba[index + 2] = clut[pointer + 2];
                        rgba[index + 3] = Math.min(clut[pointer + 3] * 2, 255);
                    }
                }
                mips.push(rgba);
            } else if (bitDepth === 32) {
                // mip 0
                const rgba = new Uint8Array(pixelCount * 4);
                let clut = new Uint8Array(this.data.buffer, this.offset + 80, rgba.length);
                for (let i = 0; i < rgba.length; i += 4) {
                    rgba[i] = clut[i];
                    rgba[i + 1] = clut[i + 1];
                    rgba[i + 2] = clut[i + 2];
                    rgba[i + 3] = Math.min(clut[i + 3] * 2, 255);
                }
                mips.push(rgba);

                // mip 1
                const mip1Offset = this.offset + 80 + (pixelCount * 4) + 80;
                const mip1Length = pixelCount * 2;
                if (mip1Offset + mip1Length <= this.data.buffer.byteLength) {
                    clut = new Uint8Array(this.data.buffer, mip1Offset, mip1Length);
                    const rgba2 = new Uint8Array(mip1Length);
                    for (let i = 0; i < rgba2.length; i += 4) {
                        rgba2[i] = clut[i];
                        rgba2[i + 1] = clut[i + 1];
                        rgba2[i + 2] = clut[i + 2];
                        rgba2[i + 3] = Math.min(clut[i + 3] * 2, 255);
                    }
                    mips.push(rgba2);
                }
            }

            const t = new CasperTexture(device, textureName, mips, width, height, bitDepth, alphaName.length > 0);
            textures.set(textureName, t);
            this.offset = nativeEnd;
        }

        return textures;
    }

    public parseTOM(): CasperObjectInstance[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength));
        const lines = rawText.split("\n");
        const instances: CasperObjectInstance[] = [];
        let instance: CasperObjectInstance = new CasperObjectInstance();
        let inProperties = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                continue;
            }

            if (line.startsWith("BEGIN_OBJ:")) {
                instance = new CasperObjectInstance();
                const nameMatch = line.match(/"([^"]+)"/);
                let name = nameMatch ? nameMatch[1] : "";
                if (name.includes(",")) {
                    name = name.split(",")[0]
                }
                instance.name = name;
                instance.properties = [];
                inProperties = false;
            } else if (!line.startsWith("//")) {
                if (line.startsWith("END_OBJ:")) {
                    if (IGNORED_OBJS.indexOf(instance.name) === -1) {
                        instances.push(instance);
                    }
                    instance = new CasperObjectInstance();
                } else if (line.startsWith("BEGIN_USERPROPS:")) {
                    inProperties = true;
                } else if (line.startsWith("END_USERPROPS:")) {
                    inProperties = false;
                } else if (!inProperties) {
                    const parts = line.split(/\s+/);
                    const key = parts[0].replace(":", "");
                    const values = parts.slice(1).map(Number);
                    if (key === "POS") {
                        instance.position = { x: values[0], y: values[1], z: values[2] };
                    } else if (key === "ROTATE") {
                        instance.rotation = { x: values[0], y: values[1], z: values[2] };
                    } else if (key === "SCALE") {
                        if (SCALE_OVERRIDES.has(instance.name)) {
                            const s = SCALE_OVERRIDES.get(instance.name)!;
                            instance.scale = { x: s[0], y: s[1], z: s[2] };
                        } else {
                            instance.scale = { x: values[0], y: values[1], z: values[2] };
                        }
                    }
                } else {
                    instance.properties.push(line.replace("\t", ""));
                }
            }
        }

        return instances;
    }

    public parseOBD(): CasperObjectDefinition[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength));
        const lines = rawText.split("\n");
        const objDefs: CasperObjectDefinition[] = [];

        function extractQuotedStrings(line: string): string[] {
            const matches = line.match(/"([^"]*)"/g);
            if (!matches) {
                return [];
            }
            return matches.map(s => s.slice(1, -1));
        }

        for (let line of lines) {
            line = line.trim().split("//")[0]; // ignore any comments (somtimes after actual data)
            if (!line) {
                continue;
            }
            if (line.startsWith("DEFINE_OBJ:")) {
                const elems = extractQuotedStrings(line.substring(12, line.lastIndexOf("\"") + 1));
                const name = elems[0].toLowerCase();
                const type = elems[1].toLowerCase();
                const val1 = elems[2];
                const val2 = elems.length > 3 ? elems[3] : "";
                if (type === "alias") {
                    for (const o of objDefs) {
                        if (o.names.includes(val1)) {
                            o.names.push(name);
                            break;
                        }
                    }
                } else if (type === "anim" || type === "basic") {
                    objDefs.push({ names: [name], dffPath: val1.toUpperCase(), thirdValue: val2 });
                }
            }
        }

        return objDefs;
    }

    public parseDFF(): CasperMesh {
        this.offset = 0;
        const clumpHeader = this.parseHeader();
        const clumpEnd = this.offset + clumpHeader.size;
        const clumpStructHeader = this.parseHeader(); // struct is just object count, ignore
        this.offset += clumpStructHeader.size;
        const frameListHeader = this.parseHeader(); // skip for now
        this.offset += frameListHeader.size;
        const atomicHeader = this.parseHeader();
        const atomicStructHeader = this.parseHeader(); // frame and geometry index numbers
        this.offset += atomicStructHeader.size;
        const geometryHeader = this.parseHeader();
        if (geometryHeader.id === Chunk.GEOMETRY) {
            const geometryStructHeader = this.parseHeader();
            const geometryStructEnd = this.offset + geometryStructHeader.size;
            const geometryData = this.parseGeometryData(this.offset, geometryStructEnd);
            this.offset = geometryStructEnd;
            const materialListHeader = this.parseHeader();
            const materials = this.parseMaterialList(materialListHeader.size);
            if (materials[0].length > 0) {
                // temp don't build meshes without textures
                const extensionHeader = this.parseHeader();
                const splits: IndexSplit[] = [];
                if (extensionHeader.id === Chunk.EXTENSION) {
                    const binMeshHeader = this.parseHeader();
                    if (binMeshHeader.id === Chunk.BIN_MESH_PLG) {
                        splits.push(...this.parseBinMesh());
                        return {
                            vertices: geometryData.vertices,
                            uvs: geometryData.uvs, colors: geometryData.colors,
                            indexSplits: splits, materials,
                            boundingSphere: geometryData.boundingSphere
                        };
                    }
                }
            }
        }
        return { vertices: [], uvs: [], colors: [], indexSplits: [], materials: [] };
    }

    private parsePlaneSection(header: NodeHeader): CasperBSPNode {
        const endOffset = this.offset + header.size;
        const sector: CasperBSPNode = {
            type: header.id === Chunk.ATOMIC_SECTION ? 'leaf' : 'node',
            leaves: []
        };

        if (header.id === Chunk.ATOMIC_SECTION) {
            sector.mesh = this.parseAtomicSection();
            this.offset = endOffset;
        } else {
            while (this.offset < endOffset) {
                const child = this.parseHeader();
                if (child.id === Chunk.PLANE_SECTION || child.id === Chunk.ATOMIC_SECTION) {
                    sector.leaves.push(this.parsePlaneSection(child));
                } else {
                    this.offset += child.size;
                }
            }
        }

        return sector;
    }

    /**
     * Empty or color-only materials are set as "" to keep material indices consistent
     */
    private parseMaterialList(size: number): string[] {
        const names: string[] = [];
        const end = this.offset + size;

        const struct = this.parseHeader();
        const numMaterials = this.data.getInt32(this.offset, true);
        this.offset += struct.size;

        for (let i = 0; i < numMaterials; i++) {
            const matHeader = this.parseHeader();
            const matEnd = this.offset + matHeader.size;

            while (this.offset < matEnd) {
                const child = this.parseHeader();
                if (this.data.getUint8(this.offset + 12) === 0) {
                    names.push("");
                    this.offset += child.size;
                } else if (child.id === Chunk.TEXTURE) {
                    const texEnd = this.offset + child.size;
                    while (this.offset < texEnd) {
                        const texChild = this.parseHeader();
                        if (texChild.id === Chunk.STRING) {
                            names.push(this.readString(texChild.size));
                            this.offset = texEnd;
                        } else {
                            this.offset += texChild.size;
                        }
                    }
                } else {
                    this.offset += child.size;
                }
            }
        }
        this.offset = end;
        return names;
    }

    private parseAtomicSection(): CasperMesh {
        const structHeader = this.parseHeader();
        const structEnd = this.offset + structHeader.size;

        const vertexCount = this.data.getUint32(this.offset + 8, true);
        if (vertexCount === 0) {
            this.offset = structEnd;
            return { vertices: [], uvs: [], colors: [], indexSplits: [] };
        }

        // vertices (12), unknown colors (4), vertex colors (4), uvs (8)

        let pointer = this.offset + 44; // skip struct header
        const vertices: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push(
                this.data.getFloat32(pointer, true),
                this.data.getFloat32(pointer + 4, true),
                this.data.getFloat32(pointer + 8, true)
            );
            pointer += 12;
        }

        pointer += vertexCount * 4; // skip block, don't know what this data is. When used as colors, it appears rainbow-like

        const colors: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            colors.push(
                this.data.getUint8(pointer),
                this.data.getUint8(pointer + 1),
                this.data.getUint8(pointer + 2)
            );
            pointer += 4;
        }

        const uvs: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            uvs.push(
                this.data.getFloat32(pointer, true),
                this.data.getFloat32(pointer + 4, true)
            );
            pointer += 8;
        }

        this.offset = structEnd;

        const extHeader = this.parseHeader();
        const extEnd = this.offset + extHeader.size;
        const indexSplits: IndexSplit[] = [];
        while (this.offset < extEnd - 12) {
            const subHeader = this.parseHeader();
            if (subHeader.id === Chunk.BIN_MESH_PLG) {
                indexSplits.push(...this.parseBinMesh());
            }
            this.offset += subHeader.size;
        }

        this.offset = extEnd;

        return { vertices, uvs, colors, indexSplits };
    }

    private parseBinMesh(): IndexSplit[] {
        const faceType = this.data.getUint32(this.offset, true);
        const numSplits = this.data.getUint32(this.offset + 4, true);
        let pointer = this.offset + 12;
        const splits: IndexSplit[] = [];
        for (let s = 0; s < numSplits; s++) {
            const count = this.data.getUint32(pointer, true);
            const materialIndex = this.data.getUint32(pointer + 4, true);
            pointer += 8;

            const indices: number[] = [];
            const rawIndices: number[] = [];
            for (let i = 0; i < count; i++) {
                rawIndices.push(this.data.getUint32(pointer, true));
                pointer += 4;
            }

            if (faceType === 1) {
                // triangle strips
                for (let i = 0; i < rawIndices.length - 2; i++) {
                    const v1 = rawIndices[i], v2 = rawIndices[i + 1], v3 = rawIndices[i + 2];
                    if (v1 !== v2 && v1 !== v3 && v2 !== v3) {
                        if (i % 2 === 0) {
                            indices.push(v1, v2, v3);
                        } else {
                            indices.push(v1, v3, v2);
                        }
                    }
                }
            } else {
                // triangle list
                indices.push(...rawIndices);
            }

            splits.push({ materialIndex, indices });
        }
        return splits;
    }

    private parseGeometryData(start: number, end: number): GeometryData {
        // header (28)
        // bitwise flags (1), ? (3), face num (4), vertex num (4), frame num (4), c1 (4), c2 (4), c3 (4)
        this.offset = start;
        const flags = this.data.getUint8(this.offset);
        // const geoTriStrip = (flags & 1) === 1;
        // const geoPositions = ((flags >> 1) & 1) === 1;
        const geoTextured = ((flags >> 2) & 1) === 1;
        const geoPrelit = ((flags >> 3) & 1) === 1;
        const geoNormals = ((flags >> 4) & 1) === 1;
        // const geoLight = ((flags >> 5) & 1) === 1;
        // const geoModulate = ((flags >> 6) & 1) === 1;
        // const geoTextured2 = ((flags >> 7) & 1) === 1;
        const faceCount = this.data.getUint32(this.offset + 4, true);
        const vertexCount = this.data.getUint32(this.offset + 8, true);
        this.offset += 28; // skip over internal header
        let pointer = this.offset;

        // colors (4)
        const colors: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            if (geoPrelit) {
                colors.push(
                    this.data.getUint8(pointer),
                    this.data.getUint8(pointer + 1),
                    this.data.getUint8(pointer + 2)
                );
                pointer += 4;
            } else {
                colors.push(255, 255, 255);
            }
        }

        // uvs (8)
        const uvs: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            if (geoTextured) {
                uvs.push(
                    this.data.getFloat32(pointer, true),
                    this.data.getFloat32(pointer + 4, true)
                );
                pointer += 8;
            } else {
                uvs.push(0, 0);
            }
        }

        // faces (8)
        pointer += 8 * faceCount;

        // bounding sphere (16)
        const boundingSphere = {
            x: this.data.getFloat32(pointer, true),
            y: this.data.getFloat32(pointer + 4, true),
            z: this.data.getFloat32(pointer + 8, true),
            r: this.data.getFloat32(pointer + 12, true),
        };

        // work backwards
        pointer = end - (12 * vertexCount);
        if (geoNormals) {
            // skip normals if present
            pointer -= 12 * vertexCount;
        }

        // vertices (12)
        const vertices: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push(
                this.data.getFloat32(pointer, true),
                this.data.getFloat32(pointer + 4, true),
                this.data.getFloat32(pointer + 8, true)
            );
            pointer += 12;
        }

        return { vertices, uvs, colors, boundingSphere };
    }

    private readString(size: number): string {
        const str = new TextDecoder().decode(new Uint8Array(this.data.buffer, this.data.byteOffset + this.offset, size));
        this.offset += size;
        return str.replace(/\0/g, '').toLowerCase().replace(/[^a-zA-Z0-9_,]/g, "");
    }
}
