import { GfxCullMode, GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";

// Credit to the "RW Analyze" tool by Steve M. for helping to parse the RenderWare files

enum ChunkID {
    STRUCT = 1, STRING = 2, EXTENSION = 3, TEXTURE = 6,
    MATERIAL = 7, MATERIAL_LIST = 8, ATOMIC_SECTION = 9,
    PLANE_SECTION = 10, WORLD = 11, FRAME_LIST = 14,
    GEOMETRY = 15, CLUMP = 16, ATOMIC = 0x14, TEXTURE_NATIVE = 0x15,
    TEXTURE_DICTIONARY = 0x16, GEOMETRY_LIST = 0x1A,
    MORPH_PLG = 0x105, ANIMATION_PLG = 0x108, SKY_MIPMAP_VAL = 0x110,
    SKIN_PLG = 0x116, PARTICLES_PLG = 0x118, COLLISION_PLG = 0x11D,
    MATERIAL_EFFECTS_PLG = 0x120, LIBRARY_PLG = 0x189, BIN_MESH_PLG = 0x50E
}

/**
 * 12-byte header for each node in RW file
 */
interface NodeHeader {
    id: number;
    size: number;
}

/**
 * List of indices for a material
 */
interface IndexSplit {
    materialIndex: number;
    indices: number[];
}

export interface LevelSector {
    type: 'node' | 'leaf';
    mesh?: Mesh;
    children: LevelSector[];
}

export interface Level {
    materials: string[];
    objMeshes: Mesh[];
    root: LevelSector;
    number: number;
}

/**
 * An object defintion from the CASPER.OBD file
 */
export interface ObjectDefintion {
    names: string[];
    dffPath: string;
    thirdValue: string;
}

/**
 * Mesh from either DFF or BSP file
 */
export interface Mesh {
    vertexCount: number;
    vertices: number[];
    uvs: number[];
    colors: number[];
    indexSplits: IndexSplit[];
    materials?: string[];
}

/**
 * Instance of an object from a level's TOM file
 */
export class ObjectInstance {
    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    properties: string[];
}

/**
 * Texture from DIC file, either 32-bit or unswizzled 8-bit. Uploaded to device upon creation
 */
export class Texture {
    public gfxTexture: GfxTexture;
    constructor(device: GfxDevice, public rgba: Uint8Array, public width: number, public height: number, public bitDepth: number, public hasAlpha: boolean = false, public cullModeOverride: number) {
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

const TRANSPARENT_TEXTURES_MAP: Map<string, number[]> = new Map<string, number[]>([
    ["skin1", [140, GfxCullMode.Back]],
    ["kibosh", [200, GfxCullMode.Back]],
    ["spinner", [250, GfxCullMode.None]],
    ["gemg1", [1, GfxCullMode.Back]],
    ["gemb1", [1, GfxCullMode.Back]],
    ["gemr1", [1, GfxCullMode.Back]],
    ["gemy1", [1, GfxCullMode.Back]],
    ["fwatenv", [180, GfxCullMode.None]],
    ["wizwtr1", [120, GfxCullMode.None]],
    ["keyshldr", [70, GfxCullMode.Back]],
    ["keyshldb", [70, GfxCullMode.Back]],
    ["keyshldg", [70, GfxCullMode.Back]],
    ["keyshldo", [70, GfxCullMode.Back]],
    ["keyshldy", [70, GfxCullMode.Back]]
]);
const SCALE_OVERRIDES: Map<string, number[]> = new Map<string, number[]>([["needle2", [1, 1, 1]]]);
const IGNORED_OBJS: string[] = ["6wall01", "6wall02", "6wall03", "6wall04", "6wall05", "robostand"];

export class RWParser {
    private data: DataView;
    private offset: number = 0;

    constructor(view: DataView) {
        this.data = view;
    }

    private readHeader(): NodeHeader {
        const id = this.data.getUint32(this.offset, true);
        const size = this.data.getUint32(this.offset + 4, true);
        this.offset += 12;
        return { id, size };
    }

    public parseLevel(number: number): Level {
        const level: Level = {
            materials: [],
            objMeshes: [],
            root: {type: "node", children: []},
            number
        };

        while (this.offset < this.data.byteLength) {
            const header = this.readHeader();
            const endOffset = this.offset + header.size;
            if (header.id === ChunkID.WORLD) {
                const struct = this.readHeader();
                this.offset += struct.size;
                while (this.offset < endOffset) {
                    const childHeader = this.readHeader();
                    if (childHeader.id === ChunkID.MATERIAL_LIST) {
                        level.materials = this.parseMaterialList(childHeader.size);
                    } else if (childHeader.id === ChunkID.PLANE_SECTION) {
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

    public parseDIC(device: GfxDevice, materials: string[]): Map<string, Texture> {
        this.offset = 0;
        const txdHeader = this.readHeader();
        const txdEnd = this.offset + txdHeader.size;
        const txdMetaStructHeader = this.readHeader(); 
        this.offset += 4;
        // let index = -1;
        // let debugWidth = 0;
        // let debugHeight = 0;
        const textures: Map<string, Texture> = new Map();
        while (this.offset < txdEnd) {
            // index += 1;
            const nativeHeader = this.readHeader();
            const nativeEnd = this.offset + nativeHeader.size;
            if (this.offset >= txdEnd) {
                break;
            }
            // this always has "PS2"
            const structMeta = this.readHeader();
            this.offset += structMeta.size;
            const nameHeader = this.readHeader();
            const textureName = this.readString(nameHeader.size);
            // only parse materials with known name
            if (materials.indexOf(textureName) === -1) {
                this.offset = nativeEnd;
                // console.log("Skipping texture", textureName);
                continue;
            }
            // not sure what exactly this is, but any texture that has transparency in the game has this set to something
            const alphaHeader = this.readHeader();
            const alphaName = this.readString(alphaHeader.size);

            const pixelStructHeader = this.readHeader();

            const pixelStructMeta = this.readHeader(); // always 64 bytes
            const pixelStructMetaEnd = this.offset + pixelStructMeta.size;
            const width = this.data.getUint16(this.offset, true);
            const height = this.data.getUint16(this.offset + 4, true);
            const bitDepth = this.data.getUint8(this.offset + 8);

            const pixelCount = width * height;
            let rgba: Uint8Array = new Uint8Array(pixelCount * 4);

            const transparencyOverride = TRANSPARENT_TEXTURES_MAP.get(textureName);

            this.offset = pixelStructMetaEnd;
            const pixelDataHeader = this.readHeader();
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

                // unswizzle 8-bit textures
                // https://ps2linux.no-ip.info/playstation2-linux.com/docs/howto/display_docef7c.html?docid=75
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
                        const a = Math.min(clut[pointer + 3] * 2, 255);
                        rgba[index + 3] = transparencyOverride && a === 255 ? transparencyOverride[0] : a;
                    }
                }
                // this.debugRenderToCanvas(rgba, width, height, textureName, debugWidth, debugHeight);
                // debugWidth += width + 32;
                // if (debugWidth > 2000) {
                //     debugWidth = 0;
                //     debugHeight += 150;
                // }
            } else if (bitDepth === 32) {
                const clut = new Uint8Array(this.data.buffer, this.offset + 80, pixelCount * 4);
                // there's also a copy of the texture at half resolution after another 80-byte offset

                rgba = new Uint8Array(pixelCount * 4);
                for (let i = 0; i < rgba.length; i += 4) {
                    rgba[i] = clut[i];
                    rgba[i + 1] = clut[i + 1];
                    rgba[i + 2] = clut[i + 2];
                    const a = Math.min(clut[i + 3] * 2, 255);
                    rgba[i + 3] = transparencyOverride && a === 255 ? transparencyOverride[0] : a;
                }
            }
            textures.set(textureName, new Texture(device, rgba, width, height, bitDepth, alphaName.length > 0 || TRANSPARENT_TEXTURES_MAP.has(textureName), transparencyOverride ? transparencyOverride[1] : 0));
            this.offset = nativeEnd;
        }

        return textures;
    }

    public parseLevelObjects(): ObjectInstance[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength));
        const lines = rawText.split("\n");
        const instances: ObjectInstance[] = [];
        let instance: ObjectInstance = new ObjectInstance();
        let inProperties = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                continue;
            }

            if (line.startsWith("BEGIN_OBJ:")) {
                instance = new ObjectInstance();
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
                    instance = new ObjectInstance();
                } else if (line.startsWith("BEGIN_USERPROPS:")) {
                    inProperties = true;
                } else if (line.startsWith("END_USERPROPS:")) {
                    inProperties = false;
                } else if (!inProperties) {
                    const parts = line.split(/\s+/);
                    const key = parts[0].replace(":", "");
                    const values = parts.slice(1).map(Number);
                    // y and z might be flipped (???)
                    if (key === "POS") {
                        instance.position = { x: values[0], y: values[2], z: values[1] };
                    } else if (key === "ROTATE") {
                        instance.rotation = { x: values[0], y: values[2], z: values[1] };
                    } else if (key === "SCALE") {
                        if (SCALE_OVERRIDES.has(instance.name)) {
                            const s = SCALE_OVERRIDES.get(instance.name)!;
                            instance.scale = { x: s[0], y: s[2], z: s[1] };
                        } else {
                            instance.scale = { x: values[0], y: values[2], z: values[1] };
                        }
                    }
                } else {
                    instance.properties.push(line.replace("\t", ""));
                }
            }
        }

        return instances;
    }

    public parseObjectDictionary(): ObjectDefintion[] {
        const rawText = new TextDecoder("utf-8").decode(new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength));
        const lines = rawText.split("\n");
        const objDefs: ObjectDefintion[] = [];

        function extractQuotedStrings(line: string): string[] {
            const matches = line.match(/"([^"]*)"/g);
            if (!matches) {
                return [];
            }
            return matches.map(s => s.slice(1, -1));
        }

        for (let line of lines) {
            line = line.trim().split("//")[0]; // ignore any comments
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

    public parseDFF(): Mesh {
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
                const splits: IndexSplit[] = [];
                if (extensionHeader.id === ChunkID.EXTENSION) {
                    const binMeshHeader = this.readHeader();
                    if (binMeshHeader.id === ChunkID.BIN_MESH_PLG) {
                        splits.push(...this.parseBinMesh());
                        return { vertexCount, vertices, uvs, colors, indexSplits: splits, materials };
                    }
                }
            }
        }
        return { vertexCount: 0, vertices: [], uvs: [], colors: [], indexSplits: [], materials: [] };
    }

    private parsePlaneSection(header: NodeHeader): LevelSector {
        const endOffset = this.offset + header.size;
        const sector: LevelSector = {
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
                    sector.children.push(this.parsePlaneSection(child));
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
        
        const struct = this.readHeader();
        const numMaterials = this.data.getInt32(this.offset, true);
        this.offset += struct.size;

        for (let i = 0; i < numMaterials; i++) {
            const matHeader = this.readHeader();
            const matEnd = this.offset + matHeader.size;

            while (this.offset < matEnd) {
                const child = this.readHeader();
                if (this.data.getUint8(this.offset + 12) === 0) {
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
        const structHeader = this.readHeader();
        const structEnd = this.offset + structHeader.size;

        const vertexCount = this.data.getUint32(this.offset + 8, true);
        if (vertexCount === 0) {
            this.offset = structEnd; 
            return { vertexCount: 0, indexSplits: [], vertices: [], uvs: [], colors: [] };
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

        pointer += vertexCount * 4; // skip block, don't know what these colors are. They appear rainbow-like when rendered

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

        const extHeader = this.readHeader();
        const extEnd = this.offset + extHeader.size;
        const splits: IndexSplit[] = [];
        while (this.offset < extEnd - 12) {
            const subHeader = this.readHeader();
            if (subHeader.id === ChunkID.BIN_MESH_PLG) {
                splits.push(...this.parseBinMesh());
            }
            this.offset += subHeader.size;
        }

        this.offset = extEnd;

        return { vertexCount, vertices, uvs, colors, indexSplits: splits };
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

    private parseGeometryStruct(start: number, end: number): { vertexCount: number, vertices: number[], uvs: number[], colors: number[] } {
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

        // skip bounding sphere and unknown nums and work backwards
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

        return { vertexCount, vertices, uvs, colors };
    }

    private readString(size: number): string {
        const str = new TextDecoder().decode(new Uint8Array(this.data.buffer, this.data.byteOffset + this.offset, size));
        this.offset += size;
        return str.replace(/\0/g, '').toLowerCase().replace(/[^a-zA-Z0-9_,]/g, "");
    }

    private debugRenderToCanvas(rgba: Uint8Array, width: number, height: number, name: string, dw: number, dh: number) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        canvas.style.position = 'fixed';
        canvas.style.top = `${300 + dh}px`;
        canvas.style.left = `${10 + dw}px`;
        canvas.style.zIndex = '9999';
        canvas.style.border = '1px solid red';
        canvas.style.background = 'black';
        canvas.title = name;
        document.body.appendChild(canvas);
    }
}
