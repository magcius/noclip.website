import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";

// Credit to the "RW Analyze" tool by Steve M. for helping to parse the RenderWare files

enum ChunkID {
    STRUCT = 1, STRING = 2, EXTENSION = 3, TEXTURE = 6,
    MATERIAL = 7, MATERIAL_LIST = 8, ATOMIC_SECTION = 9,
    PLANE_SECTION = 10, WORLD = 11, FRAME_LIST = 14,
    GEOMETRY = 15, CLUMP = 16, ATOMIC = 0x14, TEXTURE_NATIVE = 0x15,
    TEXTURE_DICTIONARY = 0x16, GEOMETRY_LIST = 0x1A,
    MORPH_PLG = 0x105, SKY_MIPMAP_VAL = 0x110,
    PARTICLES_PLG = 0x118, COLLISION_PLG = 0x11D,
    MATERIAL_EFFECTS_PLG = 0x120, BIN_MESH_PLG = 0x50E
}

export interface WorldSector {
    type: 'node' | 'leaf';
    mesh?: Mesh;
    children: WorldSector[];
}

export interface WorldData {
    materials: string[];
    tomMeshes: DFFMesh[];
    rootSector: WorldSector;
}

export class TOMInstance {
    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    properties: string[];
}

export class ObjectDefintion {
    names: string[];
    dffPath: string;
}

interface MeshSplit {
    materialIndex: number;
    indices: number[];
}

interface Mesh {
    vertexCount: number;
    vertices: number[];
    uvs: number[];
    colors: number[];
    splits: MeshSplit[];
}

export interface DFFMesh extends Mesh {
    materials: string[];
}

export class Texture {
    public gfxTexture: GfxTexture;

    constructor(device: GfxDevice, public rgba: Uint8Array, public width: number, public height: number, public hasAlpha: boolean = false) {
        const gfxTexture = device.createTexture({
            width, height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1,
            numLevels: 1
        });
        device.uploadTextureData(gfxTexture, 0, [rgba]);
        this.gfxTexture = gfxTexture;
    }
}

export class Parser {
    private view: DataView;
    private offset: number = 0;

    constructor(view: DataView) {
        this.view = view;
    }

    private readHeader() {
        const id = this.view.getUint32(this.offset, true);
        const size = this.view.getUint32(this.offset + 4, true);
        this.offset += 12;
        return { id, size };
    }

    public parseBSP(): WorldData {
        const worldData: WorldData = {
            materials: [],
            tomMeshes: [],
            rootSector: {type: "node", children: []}
        };

        while (this.offset < this.view.byteLength) {
            const header = this.readHeader();
            const endOffset = this.offset + header.size;

            if (header.id === ChunkID.WORLD) {
                const struct = this.readHeader();
                this.offset += struct.size;

                while (this.offset < endOffset) {
                    const childHeader = this.readHeader();
                    if (childHeader.id === ChunkID.MATERIAL_LIST) {
                        worldData.materials = this.parseMaterialList(childHeader.size);
                    } else if (childHeader.id === ChunkID.PLANE_SECTION) {
                        worldData.rootSector = this.processSector(childHeader);
                    } else {
                        this.offset += childHeader.size;
                    }
                }
            } else {
                this.offset = endOffset;
            }
        }

        return worldData;
    }

    private processSector(header: any): WorldSector {
        const endOffset = this.offset + header.size;
        const sector: WorldSector = {
            type: header.id === ChunkID.ATOMIC_SECTION ? 'leaf' : 'node',
            children: []
        };

        if (header.id === ChunkID.ATOMIC_SECTION) {
            sector.mesh = this.parseAtomicSection();
            this.offset = endOffset;
        } else {
            while (this.offset < endOffset) {
                const child = this.readHeader();
                if (child.id === ChunkID.PLANE_SECTION || child.id === ChunkID.ATOMIC_SECTION) {
                    sector.children.push(this.processSector(child));
                } else {
                    this.offset += child.size;
                }
            }
        }

        return sector;
    }

    private parseMaterialList(size: number): string[] {
        const names: string[] = [];
        const end = this.offset + size;
        
        const struct = this.readHeader();
        const numMaterials = this.view.getInt32(this.offset, true);
        this.offset += struct.size;

        for (let i = 0; i < numMaterials; i++) {
            const matHeader = this.readHeader();
            const matEnd = this.offset + matHeader.size;

            while (this.offset < matEnd) {
                const child = this.readHeader();
                if (this.view.getUint8(this.offset + 12) === 0) {
                    names.push("");
                    this.offset += child.size;
                } else if (child.id === ChunkID.TEXTURE) {
                    const texEnd = this.offset + child.size;
                    while (this.offset < texEnd) {
                        const texChild = this.readHeader();
                        if (texChild.id === ChunkID.STRING) {
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

    private parseAtomicSection(): Mesh {
        // struct has these blocks:
        // vertices (12), normals? (4), color (4), uvs (8)

        const structHeader = this.readHeader();
        const structEnd = this.offset + structHeader.size;

        const vertexCount = this.view.getUint32(this.offset + 8, true);
        if (vertexCount === 0) {
            this.offset = structEnd; 
            return { vertexCount: 0, splits: [], vertices: [], uvs: [], colors: [] };
        }

        let pointer = this.offset + 44; // skip struct header
        const vertices: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push(
                this.view.getFloat32(pointer, true),
                this.view.getFloat32(pointer + 4, true),
                this.view.getFloat32(pointer + 8, true)
            );
            pointer += 12;
        }

        pointer += vertexCount * 4; // skip block, these could be normals

        const colors: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            colors.push(
                this.view.getUint8(pointer),
                this.view.getUint8(pointer + 1),
                this.view.getUint8(pointer + 2)
            );
            pointer += 4;
        }

        const uvs: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            uvs.push(
                this.view.getFloat32(pointer, true),
                this.view.getFloat32(pointer + 4, true)
            );
            pointer += 8;
        }

        this.offset = structEnd;

        const extHeader = this.readHeader();
        const extEnd = this.offset + extHeader.size;
        const splits: MeshSplit[] = [];
        while (this.offset < extEnd - 12) {
            const subHeader = this.readHeader();
            if (subHeader.id === ChunkID.BIN_MESH_PLG) {
                splits.push(...this.parseBinMesh());
            }
            this.offset += subHeader.size;
        }

        this.offset = extEnd;

        return { vertexCount, vertices, uvs, colors, splits };
    }

    private parseBinMesh(): MeshSplit[] {
        const faceType = this.view.getUint32(this.offset, true);
        const numSplits = this.view.getUint32(this.offset + 4, true);
        let seeker = this.offset + 12;
        const splits: MeshSplit[] = [];
        for (let s = 0; s < numSplits; s++) {
            const count = this.view.getUint32(seeker, true);
            const materialIndex = this.view.getUint32(seeker + 4, true);
            seeker += 8;

            const indices: number[] = [];
            const rawIndices: number[] = [];
            for (let i = 0; i < count; i++) {
                rawIndices.push(this.view.getUint32(seeker, true));
                seeker += 4;
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

    public parseDIC(device: GfxDevice, materials: string[]): Map<string, Texture> {
        this.offset = 0;
        const txdHeader = this.readHeader();
        const txdEnd = this.offset + txdHeader.size;
        const txdMetaStructHeader = this.readHeader(); 
        this.offset += 4;

        const textures: Map<string, Texture> = new Map();
        while (this.offset < txdEnd) {
            const nativeHeader = this.readHeader();
            const nativeEnd = this.offset + nativeHeader.size;
            if (this.offset >= txdEnd) {
                break;
            }
            const structMeta = this.readHeader(); // this always has "PS2" (50 53 32 ...)
            this.offset += structMeta.size;
            const nameHeader = this.readHeader();
            const textureName = this.readString(nameHeader.size);
            if (materials.indexOf(textureName) === -1) { // only parse materials with known name
                this.offset = nativeEnd;
                continue;
            }
            const alphaHeader = this.readHeader();
            const alphaName = this.readString(alphaHeader.size);

            const pixelStructHeader = this.readHeader();

            const pixelStructMeta = this.readHeader(); // always 64 bytes
            const pixelStructMetaEnd = this.offset + pixelStructMeta.size;
            const width = this.view.getUint16(this.offset, true);
            const height = this.view.getUint16(this.offset + 4, true);
            const bitDepth = this.view.getUint8(this.offset + 8);

            const pixelCount = width * height;
            let rgba: Uint8Array = new Uint8Array(pixelCount * 4);

            this.offset = pixelStructMetaEnd;
            const pixelDataHeader = this.readHeader();
            if (bitDepth === 8) {
                const indices = new Uint8Array(this.view.buffer, this.offset + 80, pixelCount);
                const rawPalette = new Uint8Array(this.view.buffer, this.offset + pixelDataHeader.size - 1024, 1024);

                const cleanPalette = new Uint8Array(1024);
                for (let i = 0; i < 256; i++) {
                    const swizzledIdx = (i & 231) | ((i & 8) << 1) | ((i & 16) >> 1);
                    for (let c = 0; c < 4; c++) {
                        cleanPalette[i * 4 + c] = rawPalette[swizzledIdx * 4 + c];
                    }
                }

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        // https://ps2linux.no-ip.info/playstation2-linux.com/docs/howto/display_docef7c.html?docid=75
                        const blockLocation = (y & -16) * width + (x & -16) * 2;
                        const swapSelector = (((y + 2) >> 2) & 1) * 4;
                        const posY = (((y & -4) >> 1) + (y & 1)) & 7;
                        const columnLocation = posY * width * 2 + ((x + swapSelector) & 7) * 4;
                        const byteNum = ((y >> 1) & 1) + ((x >> 2) & 2);

                        const swizzledAddr = blockLocation + columnLocation + byteNum;

                        const colorIdx = indices[swizzledAddr];
                        const outIdx = ((y * width) + x) * 4;
                        const p = colorIdx * 4;
                        rgba[outIdx] = cleanPalette[p];
                        rgba[outIdx + 1] = cleanPalette[p + 1];
                        rgba[outIdx + 2] = cleanPalette[p + 2];
                        rgba[outIdx + 3] = 255;
                    }
                }
            } else if (bitDepth === 32) {
                const rawData = new Uint8Array(this.view.buffer, this.offset + 80, pixelCount * 4);
                // there's also a copy of the texture at half resolution after another 80-byte offset

                // scale alpha to 255
                rgba = new Uint8Array(pixelCount * 4);
                for (let i = 0; i < rgba.length; i += 4) {
                    rgba[i] = rawData[i];
                    rgba[i + 1] = rawData[i + 1];
                    rgba[i + 2] = rawData[i + 2];
                    rgba[i + 3] = Math.min((rawData[i + 3] * 255) / 128, 255);
                }
            }
            textures.set(textureName, new Texture(device, rgba, width, height, alphaName.length > 0));
            this.offset = nativeEnd;
        }

        return textures;
    }

    public parseTOM(): TOMInstance[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.view.buffer, this.view.byteOffset, this.view.byteLength));
        const lines = rawText.split("\n");
        const instances: TOMInstance[] = [];
        let currentObj;
        let inProperties = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                continue;
            }

            if (line.startsWith("BEGIN_OBJ:")) {
                currentObj = new TOMInstance();
                const nameMatch = line.match(/"([^"]+)"/);
                let name = nameMatch ? nameMatch[1] : "";
                if (name.includes(",")) {
                    name = name.split(",")[0]
                }
                currentObj.name = name;
                currentObj.properties = [];
                inProperties = false;
            } else if (currentObj) {
                if (line.startsWith("END_OBJ:")) {
                    instances.push(currentObj);
                    currentObj = new TOMInstance();
                } else if (line.startsWith("BEGIN_USERPROPS:")) {
                    inProperties = true;
                } else if (line.startsWith("END_USERPROPS:")) {
                    inProperties = false;
                } else if (!inProperties) {
                    const parts = line.split(/\s+/);
                    const key = parts[0].replace(":", "");
                    const values = parts.slice(1).map(Number);
                    if (key === "POS") {
                        currentObj.position = { x: values[0], y: values[1], z: values[2] };
                    } else if (key === "ROTATE") {
                        currentObj.rotation = { x: values[0], y: values[1], z: values[2] };
                    } else if (key === "SCALE") {
                        currentObj.scale = { x: values[0], y: values[1], z: values[2] };
                    }
                } else {
                    currentObj.properties.push(line.replace("\t", ""));
                }
            }
        }

        return instances;
    }

    public parseOBD(): ObjectDefintion[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.view.buffer, this.view.byteOffset, this.view.byteLength));
        const lines = rawText.split("\n");
        const objDefs: ObjectDefintion[] = [];

        function extractQuotedStrings(line: string): string[] {
            const matches = line.match(/"([^"]*)"/g);
            if (!matches) return [];
            return matches.map(s => s.slice(1, -1));
        }

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                continue;
            }
            if (line.startsWith("DEFINE_OBJ:")) {
                const elems = extractQuotedStrings(line.substring("DEFINE_OBJ: ".length, line.lastIndexOf("\"") + 1));
                const name = elems[0].toLowerCase();
                const type = elems[1].toLowerCase();
                const val1 = elems[2];
                // const val2 = elems.length > 3 ? elems[3] : "";
                if (type === "alias") {
                    for (const o of objDefs) {
                        if (o.names.includes(val1)) {
                            o.names.push(name);
                            break;
                        }
                    }
                } else if (type === "anim" || type === "basic") {
                    objDefs.push({ names: [name], dffPath: val1.toUpperCase() });
                }
            }
        }

        return objDefs;
    }

    public parseDFF(): DFFMesh {
        this.offset = 0;
        const clumpHeader = this.readHeader();
        const clumpEnd = this.offset + clumpHeader.size;
        const clumpStructHeader = this.readHeader(); // struct is just object count, ignore
        this.offset += clumpStructHeader.size;
        const frameListHeader = this.readHeader(); // skip for now
        this.offset += frameListHeader.size;
        const atomicHeader = this.readHeader();
        const atomicStructHeader = this.readHeader(); // frame and geometry index numbers
        this.offset += atomicStructHeader.size;
        const geometryHeader = this.readHeader();
        if (geometryHeader.id === ChunkID.GEOMETRY) {
            const geometryStructHeader = this.readHeader();
            const geometryStructEnd = this.offset + geometryStructHeader.size;
            const { vertexCount, vertices, uvs, colors } = this.parseGeometryStruct(this.offset, geometryStructEnd);
            this.offset = geometryStructEnd;
            const materialListHeader = this.readHeader();
            const materials = this.parseMaterialList(materialListHeader.size);
            if (materials[0].length > 0) { // temp don't build meshes without textures
                const extensionHeader = this.readHeader();
                const splits: MeshSplit[] = [];
                if (extensionHeader.id === ChunkID.EXTENSION) {
                    const binMeshHeader = this.readHeader();
                    if (binMeshHeader.id === ChunkID.BIN_MESH_PLG) {
                        splits.push(...this.parseBinMesh());
                        return { vertexCount, vertices, uvs, colors, splits, materials };
                    }
                }
            }
        }
        return { vertexCount: 0, vertices: [], uvs: [], colors: [], splits: [], materials: [] };
    }

    private parseGeometryStruct(start: number, end: number): { vertexCount: number, vertices: number[], uvs: number[], colors: number[] } {
        // header (28)
        // bitwise flags (1), ? (3), face num (4), vertex num (4), frame num (4), c1 (4), c2 (4), c3 (4)
        this.offset = start;
        const flags = this.view.getUint8(this.offset);
        // const geoTriStrip = (flags & 1) === 1;
        // const geoPositions = ((flags >> 1) & 1) === 1;
        const geoTextured = ((flags >> 2) & 1) === 1;
        const geoPrelit = ((flags >> 3) & 1) === 1;
        const geoNormals = ((flags >> 4) & 1) === 1;
        // const geoLight = ((flags >> 5) & 1) === 1;
        // const geoModulate = ((flags >> 6) & 1) === 1;
        // const geoTextured2 = ((flags >> 7) & 1) === 1;
        const faceCount = this.view.getUint32(this.offset + 4, true);
        const vertexCount = this.view.getUint32(this.offset + 8, true);
        this.offset += 28; // skip over internal header
        let pointer = this.offset;

        // colors (4)
        const colors: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            if (geoPrelit) {
                colors.push(
                    this.view.getUint8(pointer),
                    this.view.getUint8(pointer + 1),
                    this.view.getUint8(pointer + 2)
                );
                pointer += 4;
            } else {
                colors.push(180, 180, 180);
            }
        }

        // uvs (8)
        const uvs: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            if (geoTextured) {
                uvs.push(
                    this.view.getFloat32(pointer, true),
                    this.view.getFloat32(pointer + 4, true)
                );
                pointer += 8;
            } else {
                uvs.push(0, 0);
            }
        }

        // faces (8)
        pointer += 8 * faceCount;

        // skip bounding sphere and unknown nums and work backwards to get to vertices
        pointer = end - (12 * vertexCount);
        if (geoNormals) {
            // skip normals if present
            pointer -= 12 * vertexCount;
        }

        // vertices (12)
        const vertices: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push(
                this.view.getFloat32(pointer, true),
                this.view.getFloat32(pointer + 4, true),
                this.view.getFloat32(pointer + 8, true)
            );
            pointer += 12;
        }

        return { vertexCount, vertices, uvs, colors };
    }

    private readString(size: number): string {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, size);
        const str = new TextDecoder().decode(bytes);
        this.offset += size;
        return str.replace(/\0/g, '').toLowerCase().replace(/[^a-zA-Z0-9_,]/g, "");
    }
}
