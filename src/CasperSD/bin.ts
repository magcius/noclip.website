enum ChunkID {
    STRUCT = 1,
    STRING = 2,
    EXTENSION = 3,
    TEXTURE = 6,
    MATERIAL = 7,
    MATERIAL_LIST = 8,
    ATOMIC_SECTION = 9,
    PLANE_SECTION = 10,
    WORLD = 11,
    TEXTURE_NATIVE = 0x15,
    TEXTURE_DICTIONARY = 0x16,
    SKY_MIPMAP_VAL = 0x110,
    COLLISION_PLG = 0x11D,
    MATERIAL_EFFECTS_PLG = 0x120,
    BIN_MESH_PLG = 0x50E
}

export interface WorldSector {
    type: 'node' | 'leaf';
    mesh?: Mesh;
    children: WorldSector[];
}

export interface WorldData {
    materials: string[];
    rootSector: WorldSector;
}

interface Mesh {
    vertexCount: number;
    positions: number[];
    indices: number[];
    uvs: number[];
    colors: number[];
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
        // const version = this.view.getUint32(this.offset + 8, true);
        this.offset += 12;
        return { id, size };
    }

    public parseBSP(): WorldData {
        const worldData: WorldData = {
            materials: [],
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
                if (child.id === ChunkID.TEXTURE) {
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
        // vertices (12), color 1 (4), color 2 (4), uvs (8), ??? (few thousand bytes left usually)

        const structHeader = this.readHeader();
        const structEnd = this.offset + structHeader.size;

        // const unknownNum = this.view.getUint32(this.offset + 4, true);
        const vertexCount = this.view.getUint32(this.offset + 8, true);
        if (vertexCount === 0) {
            this.offset = structEnd; 
            return { vertexCount: 0, indices: [], positions: [], uvs: [], colors: [] };
        }

        let pointer = this.offset + 44; // skip struct header
        const positions: number[] = [];
        for (let i = 0; i < vertexCount; i++) {
            positions.push(
                this.view.getFloat32(pointer, true),
                this.view.getFloat32(pointer + 4, true),
                this.view.getFloat32(pointer + 8, true)
            );
            pointer += 12;
        }

        pointer += vertexCount * 4; // skip first color block (rainbow when rendered)

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
        let indices: number[] = [];
        while (this.offset < extEnd - 12) {
            const subHeader = this.readHeader();
            
            if (subHeader.id === ChunkID.BIN_MESH_PLG) {
                const faceType = this.view.getUint32(this.offset, true);
                const numSplits = this.view.getUint32(this.offset + 4, true);
                // const totalIndices = this.view.getUint32(this.offset + 8, true);

                let seeker = this.offset + 12;
                for (let s = 0; s < numSplits; s++) {
                    const count = this.view.getUint32(seeker, true);
                    const materialIndex = this.view.getUint32(seeker + 4, true);
                    seeker += 8;
                    const rawIndices: number[] = [];
                    for (let i = 0; i < count; i++) {
                        const val = this.view.getUint32(seeker, true);
                        rawIndices.push(val);
                        seeker += 4;
                    }
                    if (faceType === 1) {
                        for (let i = 0; i < rawIndices.length - 2; i++) {
                            const v1 = rawIndices[i];
                            const v2 = rawIndices[i + 1];
                            const v3 = rawIndices[i + 2];
                            if (v1 !== v2 && v1 !== v3 && v2 !== v3) {
                                if (i % 2 === 0) {
                                    indices.push(v1, v2, v3);
                                } else {
                                    indices.push(v1, v3, v2);
                                }
                            }
                        }
                    } else {
                        indices.push(...rawIndices);
                    }
                }
                this.offset += subHeader.size;
            } else {
                this.offset += subHeader.size;
            }
        }

        this.offset = extEnd;

        return { vertexCount, indices,  positions, uvs, colors };
    }

    public parseDIC() {
        this.offset = 0;
        const txdHeader = this.readHeader();
        const txdEnd = this.offset + txdHeader.size;
        const txdMetaStructHeader = this.readHeader(); 
        const materialCount = this.view.getUint8(this.offset);
        this.offset += 4; 
        let index = -1;
        let debugWidth = 0;
        let debugHeight = 0;
        while (this.offset < txdEnd) {
            index += 1;
            const nativeHeader = this.readHeader();
            if (nativeHeader.id !== 0x15) {
                this.offset += nativeHeader.size;
                continue;
            }
            const nativeEnd = this.offset + nativeHeader.size;
            const structMeta1 = this.readHeader();
            this.offset += structMeta1.size;
            const nameHeader = this.readHeader();
            const textureName = this.readString(nameHeader.size);
            const alphaHeader = this.readHeader();
            const alphaName = this.readString(alphaHeader.size);
            const pixelStructHeader = this.readHeader();
            const pixelStructEnd = this.offset + pixelStructHeader.size;
            const pixelStructMeta = this.readHeader(); // always 64 bytes
            const pixelStructMetaEnd = this.offset + pixelStructMeta.size;
            const pixelStructMetaOffset = this.offset;
            const width = this.view.getUint16(this.offset, true);
            const height = this.view.getUint16(this.offset + 4, true);
            const bitDepth = this.view.getUint8(this.offset + 8);
            this.offset = pixelStructMetaEnd;
            const pixelDataHeader = this.readHeader();
            if (bitDepth === 8) {
                const indicesOffset = this.offset + 16;
                const pixelCount = width * height;
                const indices = new Uint8Array(this.view.buffer, indicesOffset, pixelCount);
                const paletteOffset = this.offset + pixelDataHeader.size - 1024;
                const rawPalette = new Uint8Array(this.view.buffer, paletteOffset, 1024);
                
                const cleanPalette = new Uint8Array(256 * 4);
                for (let i = 0; i < 256; i++) {
                    const swizzledIdx = (i & 0xE7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1);
                    for (let c = 0; c < 4; c++) {
                        cleanPalette[i * 4 + c] = rawPalette[swizzledIdx * 4 + c];
                    }
                }

                const rgba = new Uint8Array(width * height * 4);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const sx = (x + 32) % width;

                        const block_location = (y & (~0xf)) * width + (sx & (~0xf)) * 2;
                        const swap_selector = (((y + 2) >> 2) & 0x1) * 4;
                        const posY = (((y & (~3)) >> 1) + (y & 1)) & 0x7;
                        const column_location = posY * width * 2 + ((sx + swap_selector) & 0x7) * 4;
                        const byte_num = ((y >> 1) & 1) + ((sx >> 2) & 2);

                        const swizzledAddr = block_location + column_location + byte_num;

                        if (swizzledAddr < indices.length) {
                            const colorIdx = indices[swizzledAddr];
                            const outIdx = (y * width + x) * 4;
                            const p = colorIdx * 4;

                            rgba[outIdx + 0] = cleanPalette[p + 0];
                            rgba[outIdx + 1] = cleanPalette[p + 1];
                            rgba[outIdx + 2] = cleanPalette[p + 2];
                            rgba[outIdx + 3] = 255;
                        }
                    }
                }
                this.debugRenderToCanvas(rgba, width, height, textureName, debugWidth, debugHeight);
                debugWidth += width + 32;
                if (debugWidth > 2000) {
                    debugWidth = 0;
                    debugHeight += 150;
                }
            } else if (bitDepth === 32) {
                // const rgbaPixels = new Uint8Array(this.view.buffer, this.offset, width * height * 4);
            }
            
            this.offset = nativeEnd;
        }
    }

    private getGrayscaleTestPalette(): Uint8Array {
        const palette = new Uint8Array(1024);
        for (let i = 0; i < 256; i++) {
            const offset = i * 4;
            palette[offset + 0] = i;
            palette[offset + 1] = i;
            palette[offset + 2] = i;
            palette[offset + 3] = 255;
        }
        return palette;
    }

    private unswizzlePalette(rawPalette: Uint8Array): Uint8Array {
        const cleanPalette = new Uint8Array(1024);
        for (let i = 0; i < 256; i++) {
            const p = (Math.floor(i / 8) % 4 === 1) ? i + 8 : (Math.floor(i / 8) % 4 === 2) ? i - 8 : i;
            cleanPalette[i * 4 + 0] = rawPalette[p * 4 + 0]; // R
            cleanPalette[i * 4 + 1] = rawPalette[p * 4 + 1]; // G
            cleanPalette[i * 4 + 2] = rawPalette[p * 4 + 2]; // B
            const alpha = rawPalette[p * 4 + 3];
            cleanPalette[i * 4 + 3] = Math.min(255, alpha * 2); 
        }
        return cleanPalette;
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

    private readString(size: number): string {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, size);
        const str = new TextDecoder().decode(bytes);
        this.offset += size;
        return str.replace(/\0/g, '');
    }
}
