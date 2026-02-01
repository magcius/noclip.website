enum ChunkID {
    STRUCT = 0x01,
    STRING = 0x02,
    EXTENSION = 0x03,
    TEXTURE = 0x06,
    MATERIAL = 0x07,
    MATERIAL_LIST = 0x08,
    ATOMIC_SECTION = 0x09,
    PLANE_SECTION = 0x0A,
    WORLD = 0x0B,
    BIN_MESH_PLG = 0x50E,
    COLLISION_PLG = 0x11D,
    MATERIAL_EFFECTS_PLG = 0x120
}

export interface WorldSector {
    type: 'node' | 'leaf';
    mesh?: Mesh;
    children: WorldSector[];
}

export interface WorldData {
    flags: number;
    materials: string[];
    rootSector: WorldSector;
}

interface Mesh {
    materialIndex: number;
    vertCount: number;
    positions: number[];
    indices: number[];
}

export class BSPParser {
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

    public parse(): WorldData {
        const worldData: WorldData = {
            flags: 0,
            materials: [],
            rootSector: {type: "node", children: []}
        };

        while (this.offset < this.view.byteLength) {
            const header = this.readHeader();
            const endOffset = this.offset + header.size;

            if (header.id === ChunkID.WORLD) {
                const struct = this.readHeader();
                worldData.flags = this.view.getUint32(this.offset + 44, true);
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
        const structHeader = this.readHeader();
        const structEnd = this.offset + structHeader.size;

        const matIndex = this.view.getInt32(this.offset, true);
        const numTriangles = this.view.getUint32(this.offset + 4, true);
        const numVertices = this.view.getUint32(this.offset + 8, true);
        if (numVertices === 0) {
            this.offset = structEnd; 
            return { vertCount: 0, indices: [], positions: [], materialIndex: -1 };
        }

        let pointer = this.offset + 40;
        pointer += 4; // skip first 4 byte number since always zero
        const positions: number[] = [];
        for (let i = 0; i < numVertices; i++) {
            positions.push(
                this.view.getFloat32(pointer, true),
                this.view.getFloat32(pointer + 4, true),
                this.view.getFloat32(pointer + 8, true)
            );
            pointer += 12;
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
                const totalIndices = this.view.getUint32(this.offset + 8, true);

                let seeker = this.offset + 12;
                for (let s = 0; s < numSplits; s++) {
                    const count = this.view.getUint32(seeker, true);
                    const matIndex = this.view.getUint32(seeker + 4, true);
                    seeker += 8;
                    const tempIndices: number[] = [];
                    for (let i = 0; i < count; i++) {
                        const val = this.view.getUint32(seeker, true);
                        tempIndices.push(val);
                        seeker += 4;
                    }
                    if (faceType === 1) {
                        for (let i = 0; i < tempIndices.length - 2; i++) {
                            const v1 = tempIndices[i];
                            const v2 = tempIndices[i + 1];
                            const v3 = tempIndices[i + 2];
                            if (v1 !== v2 && v1 !== v3 && v2 !== v3) {
                                if (i % 2 === 0) {
                                    indices.push(v1, v2, v3);
                                } else {
                                    indices.push(v1, v3, v2);
                                }
                            }
                        }
                    } else {
                        indices.push(...tempIndices);
                    }
                }
                this.offset += subHeader.size;
            } else {
                this.offset += subHeader.size;
            }
        }

        this.offset = extEnd;

        return {
            vertCount: numVertices,
            indices: indices, 
            positions: positions,
            materialIndex: matIndex
        };
    }

    private readString(size: number): string {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, size);
        const str = new TextDecoder().decode(bytes);
        this.offset += size;
        return str.replace(/\0/g, '');
    }
}
