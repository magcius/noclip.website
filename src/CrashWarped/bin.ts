import { vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { hexzero, assert, assertExists, nArray, align } from "../util.js";

enum FileType {
    SVTX = 0x01,    // vertex data
    TGEO = 0x02,    // object meshes
    WGEO = 0x03,    // level section meshes
    SLST = 0x04,    // level triangle indices
    TPAG = 0x05,
    LDAT = 0x06,
    ZDAT = 0x07,    // generic key value store
    CPAT = 0x08,
    BINF = 0x09,
    OPAT = 0x0A,
    GOOL = 0x0B,    // object scripts and model info
    ADIO = 0x0C,
    MIDI = 0x0D,
    INST = 0x0E,
    VCOL = 0x0F,
    LINK = 0x10,
    RAWD = 0x11,    // raw data series, used for jet ski levels?
    IPAL = 0x12,
    PBAK = 0x13,
    SDIO = 0x14,
    VIDO = 0x15,
}

export interface DrawCall {
    startIndex: number;
    indexCount: number;
    textureIndex: number;
    texAnimIndex: number;
    oneSided: boolean;
}

export interface SimpleMeshGFX {
    kind: "simple";
    vertexData: Float32Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[];
}

export interface AnimatedMeshGFX {
    kind: "animated";
    vertexData: VertexAnimationData;
    attrData: Float32Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[];
}

interface Mesh {
    tgeo: TGEO;
    svtx: SVTX[];
    textureIndices: number[];
    gfx: AnimatedMeshGFX | SimpleMeshGFX;
}

export interface WGEO {
    origin: vec3;
    isSkybox: boolean;
    textureIndices: number[];
    uvs: UV[];
    texAnims: TextureAnimation[];
    gfx: SimpleMeshGFX;
}

export interface LevelData {
    textures: TexturePage[];
    wgeos: WGEO[];
    zdats: Map<string, ZDAT>;
    checkpoints: Checkpoint[];
    classNameList: string[];
    behaviors: Map<string, GOOL>;
    allBehaviors: GOOL[];
    vidos: Map<number, number[]>;
    allDBs: SeriesDatabase[];
    jetski?: JetskiData;
    terrain?: TerrainData;
}

const base64Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_!";

export function decodeChunkName(hash: number): string {
    let out = "";
    hash = hash >>> 1;
    for (let i = 0; i < 5; i++) {
        out = base64Alphabet[hash & 0x3F] + out;
        hash = hash >>> 6;
    }
    return out;
}

interface Checkpoint {
    zdatName: string;
    zdatIndex: number;
    position: vec3;
}

function diffs(starts: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < starts.length; i++)
        out.push(starts[i] - starts[i - 1]);
    return out;
}

export function parse(index: ArrayBufferSlice, data: ArrayBufferSlice): LevelData {
    const indexView = index.createDataView();
    const fileCount = indexView.getUint32(0x404, true);
    const allFiles = new Map<string, string[]>();
    for (let i = 0; i < fileCount; i++) {
        const name = decodeChunkName(indexView.getUint32(0x524 + 8 * i, true));
        let files = allFiles.get(name[4]);
        if (files === undefined) {
            files = [];
            allFiles.set(name[4], files);
        }
        files.push(name);
    }
    const tableOffset = 0x520 + 8 * fileCount;
    const checkpointCount = indexView.getUint32(tableOffset, true);
    const classNameList: string[] = [];
    for (let i = 0; i < 0x80; i++)
        classNameList.push(decodeChunkName(indexView.getUint32(tableOffset + 0x10 + 4 * i, true)));

    let checkpointOffset = tableOffset + 0x2DC;
    const checkpoints: Checkpoint[] = [];
    for (let i = 0; i < checkpointCount; i++) {
        const zdatName = decodeChunkName(indexView.getUint32(tableOffset + 0x0, true));
        const zdatIndex = indexView.getUint32(tableOffset + 0x4, true);
        const position = vec3.fromValues(
            indexView.getInt32(tableOffset + 0xC, true),
            indexView.getInt32(tableOffset + 0x10, true),
            indexView.getInt32(tableOffset + 0x14, true),
        );
        vec3.scale(position, position, 1 / (1 << 12));
        checkpoints.push({ zdatName, zdatIndex, position });
        checkpointOffset += 0x18;
    }

    const view = data.createDataView();

    const textureChunks = new Map<string, TextureChunk>();
    const geos = new Map<string, TGEO>();
    const verts = new Map<string, SVTX[]>();
    const behaviors = new Map<string, GOOL>();
    const allBehaviors: GOOL[] = [];
    const allDBs: SeriesDatabase[] = [];
    const wgeos: WGEO[] = [];
    const zdats = new Map<string, ZDAT>();
    const vidos = new Map<number, number[]>();
    let buoyData: BuoyData | undefined;
    let jetski: JetskiData | undefined;
    let terrain: TerrainData | undefined;
    let wavesA: number[] = [];
    let wavesB: number[] = [];
    let waterGrid: WaterMesh | undefined;
    let waterUV: UV | undefined;

    // fetch textures first
    for (let chunkOffs = 0; chunkOffs < view.byteLength; chunkOffs += 0x10000) {
        assert(view.getUint16(chunkOffs, true) === 0x1234);
        const type = view.getUint16(chunkOffs + 2, true);
        if (type === 1) {
            const name = decodeChunkName(view.getUint32(chunkOffs + 4, true));
            textureChunks.set(name, {
                data: data.slice(chunkOffs, chunkOffs + 0x100 * 0x80 * 2 + 1),
                index: chunkOffs >>> 0x10,
            });
        }
    }
    const cache = new TextureCache(textureChunks);

    for (let chunkOffs = 0; chunkOffs < view.byteLength; chunkOffs += 0x10000) {
        assert(view.getUint16(chunkOffs, true) === 0x1234);
        const type = view.getUint16(chunkOffs + 2, true);
        switch (type) {
            case 1: // image data, already handled
                break;
            case 0:
            case 5:
                // bunch of files
                const fileCount = view.getUint32(chunkOffs + 8, true);
                for (let i = 0; i < fileCount; i++) {
                    const fileStart = chunkOffs + view.getUint32(chunkOffs + 0x10 + 4 * i, true);
                    assert(view.getUint32(fileStart, true) === 0x100ffff);
                    const rawID = view.getUint32(fileStart + 4, true);
                    const fileName = decodeChunkName(rawID);
                    const fileType: FileType = view.getUint32(fileStart + 8, true);
                    const subCount = view.getUint32(fileStart + 0xC, true);
                    const offsets: number[] = [];
                    for (let i = 0; i <= subCount; i++)
                        offsets.push(fileStart + view.getUint32(fileStart + 0x10 + i * 4, true));
                    switch (fileType) {
                        case FileType.TGEO:
                            geos.set(fileName, parseTGEO(view, offsets));
                            break;
                        case FileType.SVTX:
                            verts.set(fileName, parseSVTX(view, offsets));
                            break;
                        case FileType.GOOL:
                            const output = parseGOOL(fileName, view, offsets, classNameList);
                            behaviors.set(fileName, output);
                            output.lookupIndex = allBehaviors.length;
                            allBehaviors.push(output);
                            break;
                        case FileType.WGEO:
                            wgeos.push(parseWGEO(view, offsets, cache));
                            break;
                        case FileType.ZDAT:
                            // hexdump(data,  fileStart)
                            const newZDAT = parseZDAT(view, offsets, classNameList);
                            zdats.set(fileName, newZDAT);
                            for (let db of newZDAT.dbs) {
                                db.globalIndex = allDBs.length;
                                allDBs.push(db);
                            }
                            for (let obj of newZDAT.objects) {
                                const db = obj.db;
                                db.globalIndex = allDBs.length;
                                allDBs.push(db);
                            }
                            break;
                        case FileType.SLST:
                            break;
                        case FileType.VIDO:
                            vidos.set(rawID, parseVIDO(fileName, view, offsets, cache));
                            break;
                        case FileType.RAWD:
                            if (fileName.startsWith("Wat")) {
                                const id = parseInt(fileName[3], 16);
                                assert(id > 0);
                                if (id === 1) {
                                    assert(offsets.length === 15 && wavesA.length === 0);
                                    wavesA = parseWaveTextures(fileName, view, offsets, cache);
                                } else if (id === 2) {
                                    assert(offsets.length === 16 && wavesB.length === 0);
                                    wavesB = parseWaveTextures(fileName, view, offsets, cache);
                                    waterUV = parseSingleTexQuad(view, offsets[14], offsets[15], cache);
                                } else if (id % 3 === 0) {
                                    assert(offsets.length === 2 && waterGrid === undefined);
                                    waterGrid = parseWaterGrid(view, offsets);
                                } else if (id % 3 === 2) {
                                    assert(!buoyData);
                                    buoyData = parseBuoys(view, offsets, cache);
                                } else {
                                    console.log("other", id);
                                }
                            } else {
                                assert(fileName.startsWith("Ter"));
                                terrain = parseTerrain(view, fileName, offsets, cache);
                            }
                        default:
                        // if (fileType === FileType.PBAK)
                        //     hexdump(view.buffer, fileStart)
                        // console.log("unhandled file type", FileType[fileType], fileName)
                    }
                }
                break;
            default:
                console.warn("unhandled chunk type", type);
                break;
        }
    }

    for (let zdat of zdats.values())
        for (let name of zdat.otherNames)
            if (!zdats.has(name))
                console.log("missing zdat", name);

    // parse models by connecting hash references
    for (let gool of behaviors.values()) {
        for (let model of gool.models.values()) {
            switch (model.kind) {
                case ModelType.MESH: {
                    const geo = geos.get(model.geoName);
                    const vtx = verts.get(model.vtxName);
                    if (geo === undefined || vtx === undefined) {
                        // console.log("missing model data", model.geoName, model.vtxName);
                        continue;
                    }
                    const inds: number[] = [];
                    for (let uv of geo.uvs) {
                        const texIndex = (uv.texPage & TexModeFlags.TEXTURE_INDEX) >>> 10;
                        inds.push(cache.findOrParse(assertExists(geo.textureNames[texIndex]), uv));
                    }
                    model.mesh = {
                        tgeo: geo, svtx: vtx, textureIndices: inds,
                        gfx: buildModel(view, geo, vtx, inds)
                    };
                } break;
                case ModelType.SPRITE: {
                    for (let f of model.frames) {
                        cache.findOrParse(model.texName, f.uv);
                    }
                } break;
                case ModelType.QUAD_LIST: {
                    for (let f of model.frames)
                        for (let rect of f) {
                            rect.texInd = cache.findOrParse(model.texName, rect.uv);
                        }
                    model.data = buildQuadList(model.frames);
                }
            }
        }
    }
    if (wavesA.length > 0) {
        if (!waterGrid) {
            assert(!buoyData && !!waterUV);
            // swimming levels have an implicit water grid at the top
            waterGrid = fakeWaterGrid();
        } else {
            waterUV = assertExists(buoyData).waterTexUV;
        }
        jetski = {
            buoys: buoyData,
            waveTextures: wavesA.concat(wavesB),
            waterUV,
            vertexData: assertExists(waterGrid).vertexData,
            indexData: assertExists(waterGrid).indexData,
        };
        assert(wavesB.length > 0);
    } else {
        assert(wavesA.length === 0 && wavesB.length === 0 && waterGrid === undefined);
    }
    return { textures: cache.texList, zdats, wgeos, checkpoints, classNameList, behaviors, allBehaviors, vidos, allDBs, jetski, terrain };
}

interface TextureChunk {
    data: ArrayBufferSlice;
    index: number;
}

export interface UV {
    texPage: number;
    clut: number;
    us: number[];
    vs: number[];
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
    texIndex: number;
}

function parseUV(view: DataView, offs: number): UV {
    const clut = view.getUint16(offs + 2, true);
    const texPage = view.getUint16(offs + 6, true);
    const us: number[] = [];
    const vs: number[] = [];
    for (let i = 0; i < 0xc; i += 2) {
        if (i === 2 || i === 6)
            continue;
        us.push(view.getUint8(offs + i));
        vs.push(view.getUint8(offs + i + 1));
    }
    const minU = Math.min(...us);
    const maxU = Math.max(...us);
    const minV = Math.min(...vs);
    const maxV = Math.max(...vs);

    return { us, vs, texPage, clut, minU, maxU, minV, maxV, texIndex: -1 };
}

interface TGEO {
    scale: vec3;
    textureNames: string[];
    uvs: UV[];
    colors: vec3[];
    triFlags: number[];
    triCount: number;
    texAnims: TextureAnimation[];
    compression: CompressedVertex[];
}

enum UVFlags {
    MIPS     = 0x80000000,
    SPEED    = 0x7C000000,
    OFFSET   = 0x03F80000,
    COUNT    = 0x0007F000,
    ANIMATED = 0X00000800,
    BASE     = 0x000007FF,
}

interface CompressedVertex {
    bitCounts: number[];
    offsets: number[];
}

export interface TextureAnimation {
    mipMapped: boolean;
    frameShift: number;
    start: number;
    offset: number;
    countMask: number;
    indirect: boolean;
}

function parseUVAnim(flags: number): TextureAnimation {
    return {
        mipMapped: (flags & UVFlags.MIPS) !== 0,
        frameShift: (flags & UVFlags.SPEED) >>> 0x1A,
        countMask: (flags & UVFlags.COUNT) >>> 0xC,
        indirect: (flags & UVFlags.ANIMATED) !== 0,
        offset: (flags & UVFlags.OFFSET) >>> 0x13,
        start: flags & UVFlags.BASE,
    };
}

function parseTGEO(view: DataView, offsets: number[]): TGEO {
    const scale = vec3.fromValues(
        view.getInt32(offsets[0] + 0x0, true),
        view.getInt32(offsets[0] + 0x4, true),
        view.getInt32(offsets[0] + 0x8, true),
    );
    vec3.scale(scale, scale, 1 / 0x100);
    const texCount = view.getUint32(offsets[0] + 0x40, true);
    const uvCount = view.getUint32(offsets[0] + 0x34, true);
    // not quite right, but the same or four more when there is compression
    const compressCount = view.getUint32(offsets[0] + 0x38, true);
    const triCount = view.getUint32(offsets[0] + 0x44, true);
    const texAnimCount = view.getUint32(offsets[0] + 0x48, true);
    const textureNames: string[] = [];
    for (let i = 0; i < texCount; i++)
        textureNames.push(decodeChunkName(view.getUint32(offsets[0] + 0xC + i * 4, true)));
    const colorCount = view.getUint32(offsets[0] + 0x3C, true);

    const copyCount = view.getUint32(offsets[1], true); // copied into scratch, not sure why this matters
    const triFlags: number[] = [];
    let offs = offsets[1] + 4;
    while (true) {
        const tri = view.getUint32(offs, true);
        if (tri === 0xFFFFFFFF)
            break;
        triFlags.push(tri);
        offs += 4;
    }

    // or normals, not sure if we can determine here
    const colors: vec3[] = [];
    for (let i = 0; i < colorCount; i++) {
        colors.push(vec3.fromValues(
            view.getUint8(offsets[2] + i * 4 + 0) / 0xFF,
            view.getUint8(offsets[2] + i * 4 + 1) / 0xFF,
            view.getUint8(offsets[2] + i * 4 + 2) / 0xFF,
        ));
    }

    const uvs: UV[] = [];
    offs = offsets[3];
    for (let i = 0; i < uvCount; i++) {
        uvs.push(parseUV(view, offs));
        offs += 0x0C;
    }

    const texAnims: TextureAnimation[] = [];
    if (texAnimCount > 0) {
        offs = offsets[4];
        assert(offsets.length >= 6 && offsets[4] !== offsets[5]);
        for (let i = 0; i < texAnimCount; i++) {
            const flags = view.getUint32(offs, true);
            texAnims.push(parseUVAnim(flags));
            offs += 4;
        }
    }

    const compression: CompressedVertex[] = [];
    if (offsets.length >= 7) {
        for (let offs = offsets[5]; offs < offsets[6]; offs += 4) {
            const bitCounts: number[] = [];
            const offsets: number[] = [];
            const inst = view.getUint32(offs, true);
            bitCounts.push(1 + (inst >>> 6 & 7));
            bitCounts.push(1 + (inst >>> 3 & 7));
            bitCounts.push(1 + (inst >>> 0 & 7));

            offsets.push(inst >>> 0x18 & 0xFE); // one bit shorter
            offsets.push(inst >>> 0x11 & 0xFF);
            offsets.push(inst >>> 0x09 & 0xFF);

            compression.push({ bitCounts, offsets });
        }
    }

    return { textureNames: textureNames, uvs, colors, triFlags, triCount, texAnims, compression, scale };
}

interface vtxInst {
    outIndex: number;
    coordIndex: number;
    u: number;
    v: number;
}

interface vtxData {
    x: number;
    y: number;
    z: number;
    colorInd: number;
    posEffect: boolean;
    colorEffect: boolean;
}

const texSizeLimit = 0;

function parseWGEO(view: DataView, offsets: number[], cache: TextureCache): WGEO {
    const isSkybox = view.getUint32(offsets[0] + 0x0C, true) !== 0;
    const vtxCount = view.getUint32(offsets[0] + 0x10, true);
    const triCount = view.getUint32(offsets[0] + 0x14, true);
    const quadCount = view.getUint32(offsets[0] + 0x18, true);
    const uvCount = view.getUint32(offsets[0] + 0x1C, true);
    const colorCount = view.getUint32(offsets[0] + 0x20, true);
    const uvAnimCount = view.getUint32(offsets[0] + 0x24, true);
    const texCount = view.getUint32(offsets[0] + 0x28, true);
    assert(offsets.length === 8);

    //      info
    //      vtx
    //      tris
    //      quads
    //      uvs
    //      colors
    //      anims

    const vvv: vtxData[] = [];
    for (let i = 0; i < vtxCount; i++) {
        const x = view.getUint16(offsets[1] + (vtxCount * 4 - 4 * i - 4) + 0, true);
        const y = view.getUint16(offsets[1] + (vtxCount * 4 - 4 * i - 4) + 2, true);
        const z = view.getUint16(offsets[1] + (vtxCount * 4 + 2 * i), true);
        const colorInd = ((y & 0x3) << 8) | ((x & 0xF) << 4) | (z & 0xF);
        vvv.push({ x: x >>> 4, y: y >>> 4, z: z >>> 4, colorInd, posEffect: (y&4) !== 0, colorEffect: (y&8) === 0 });
    }

    const scaleFactor = 16;
    const origin = vec3.fromValues(
        view.getInt32(offsets[0] + 0, true) / scaleFactor,
        view.getInt32(offsets[0] + 4, true) / scaleFactor,
        view.getInt32(offsets[0] + 8, true) / scaleFactor,
    );

    const texNames: string[] = [];
    for (let i = 0; i < texCount; i++)
        texNames.push(decodeChunkName(view.getUint32(offsets[0] + 0x2C + 4 * i, true)));

    const uvs: UV[] = [];
    const textureIndices: number[] = [];
    for (let i = 0; i < uvCount; i++) {
        const uv = parseUV(view, offsets[4] + 0xC * i);
        uvs.push(uv);
        const texIndex = (uv.texPage & TexModeFlags.TEXTURE_INDEX) >>> 10;
        textureIndices.push(cache.findOrParse(texNames[texIndex], uv));
    }

    const colors: vec3[] = [];
    for (let i = 0; i <= colorCount; i++)
        colors.push(vec3.fromValues(
            view.getUint8(offsets[5] + 4 * i + 0) / 0xFF,
            view.getUint8(offsets[5] + 4 * i + 1) / 0xFF,
            view.getUint8(offsets[5] + 4 * i + 2) / 0xFF,
        ));

    const texAnims: TextureAnimation[] = [];
    for (let i = 0; i < uvAnimCount; i++)
        texAnims.push(parseUVAnim(view.getUint32(offsets[6] + 4 * i, true)));

    const seenVtxs = new Map<number, vtxInst>();
    const triLists = new Map<number, number[]>();

    function getVtxInd(coordIndex: number, u: number, v: number): number {
        const key = (u << 0x14) | (v << 0xc) | coordIndex;
        if (seenVtxs.has(key))
            return seenVtxs.get(key)!.outIndex;
        const newInd = seenVtxs.size;
        seenVtxs.set(key, { outIndex: newInd, coordIndex, u, v });
        return newInd;
    }

    // tris
    for (let i = 0; i < triCount; i++) {
        const upper = view.getUint32(offsets[2] + 4 * (triCount - i - 1), true);
        const lower = view.getUint16(offsets[2] + 4 * triCount + 2 * i, true);
        const srcInds: number[] = [];
        srcInds.push(upper >>> 0x14);
        srcInds.push((upper >>> 0x8) & 0xFFF);
        srcInds.push(lower >>> 0x4);
        const uvInd = ((upper & 0xFF) << 4) | (lower & 0xF);
        const endInds: number[] = [];

        let drawCallKey = -1;
        let currUV: UV | null = null;
        if (uvInd & UVFlags.ANIMATED) {
            const anim = texAnims[uvInd & UVFlags.BASE];
            // treat mipmaps as normal textures to help with draw merging
            if (anim.mipMapped) {
                drawCallKey = textureIndices[anim.start - 1];
                currUV = uvs[anim.start - 1];
            } else {
                drawCallKey = TEX_ANIM_FLAG | (uvInd & UVFlags.BASE);
            }
        } else if (uvInd > 0) {
            drawCallKey = textureIndices[uvInd - 1];
            currUV = uvs[uvInd-1];
        }

        for (let j = 0; j < 3; j++) {
            if (currUV) {
                endInds.push(getVtxInd(srcInds[j], currUV.us[j], currUV.vs[j]));
            } else if (uvInd & UVFlags.ANIMATED) {
                // we will set the texture matrix later, just set to basis vectors
                endInds.push(getVtxInd(srcInds[j], j % 2, j >>> 1));
            } else {
                endInds.push(getVtxInd(srcInds[j], 0, 0));
            }
        }

        let list = triLists.get(drawCallKey);
        if (list === undefined) {
            list = [];
            triLists.set(drawCallKey, list);
        }
        list.push(...endInds);
    }

    // quads
    let offs = offsets[3];
    for (let i = 0; i < quadCount; i++) {
        const upper = view.getUint32(offs + 0, true);
        const lower = view.getUint32(offs + 4, true);
        offs += 8;
        const srcInds: number[] = [];
        srcInds.push(upper >>> 0x14);
        srcInds.push((upper >>> 0x8) & 0xFFF);
        srcInds.push(lower >>> 0x14);
        srcInds.push((lower >>> 0x8) & 0xFFF);
        const uvInd = ((upper & 0xFF) << 4) | (lower & 0xF);
        // const uvInd = ((lower & 0xF) << 8) | (upper & 0xFF);
        const endInds: number[] = [];

        if (uvInd > 0 && (uvInd & UVFlags.ANIMATED) === 0) {
            // naive LOD filtering?
            // const uv = uvs[uvInd - 1];
            // if ((uv.maxV - uv.minV) < texSizeLimit && (uv.maxU - uv.minU) < texSizeLimit) {
            //     continue;
            // }
        }

        let drawCallKey = -1;
        let currUV: UV | null = null;
        if (uvInd & UVFlags.ANIMATED) {
            const anim = texAnims[uvInd & UVFlags.BASE];
            // treat mipmaps as normal textures to help with draw merging
            if (anim.mipMapped) {
                drawCallKey = textureIndices[anim.start - 1];
                currUV = uvs[anim.start - 1];
            } else {
                drawCallKey = TEX_ANIM_FLAG | (uvInd & UVFlags.BASE);
                // make sure the UVs form a rectangle
                for (let k = 0; k <= anim.countMask; k++) {
                    const currUV = uvs[anim.start + k - 1];
                    assert(currUV.us[0] + currUV.us[3] === currUV.us[1] + currUV.us[2]);
                    assert(currUV.vs[0] + currUV.vs[3] === currUV.vs[1] + currUV.vs[2]);
                }
            }
        } else if (uvInd > 0) {
            drawCallKey = textureIndices[uvInd - 1];
            currUV = uvs[uvInd-1];
        }

        for (let j = 0; j < 4; j++) {
            if (currUV) {
                endInds.push(getVtxInd(srcInds[j], currUV.us[j], currUV.vs[j]));
            } else if (uvInd & UVFlags.ANIMATED) {
                // we will set the texture matrix later, just set to basis vectors
                endInds.push(getVtxInd(srcInds[j], j % 2, j >>> 1));
            } else {
                endInds.push(getVtxInd(srcInds[j], 0, 0));
            }
        }

        let list = triLists.get(drawCallKey);
        if (list === undefined) {
            list = [];
            triLists.set(drawCallKey, list);
        }
        list.push(
            endInds[0], endInds[1], endInds[2],
            endInds[2], endInds[1], endInds[3],
        );
    }

    const VERTEX_STRIDE = 3 + 3 + 2;
    const vertexData = new Float32Array(seenVtxs.size * VERTEX_STRIDE);

    offs = 0;
    for (let vtx of seenVtxs.values()) {
        const v = vvv[vtx.coordIndex];
        vertexData[offs + 0] = colors[v.colorInd][0] + (v.colorEffect ? 2 : 0);
        vertexData[offs + 1] = colors[v.colorInd][1] + (v.posEffect ? 2 : 0);
        vertexData[offs + 2] = colors[v.colorInd][2];

        vertexData[offs + 3] = vtx.u;
        vertexData[offs + 4] = vtx.v;

        vertexData[offs + 5] = v.x;
        vertexData[offs + 6] = v.y;
        vertexData[offs + 7] = v.z;

        offs += VERTEX_STRIDE;
    }

    let totalIndices = 0;
    for (let inds of triLists.values())
        totalIndices += inds.length;
    const indexData = new Uint16Array(totalIndices);

    let indexOffs = 0;
    const drawCalls: DrawCall[] = [];
    for (let [key, inds] of triLists.entries()) {
        const newDC: DrawCall = { texAnimIndex: -1, textureIndex: -1, startIndex: indexOffs, indexCount: inds.length, oneSided: false };
        if (key & TEX_ANIM_FLAG)
            newDC.texAnimIndex = key ^ TEX_ANIM_FLAG;
        else
            newDC.textureIndex = key;
        drawCalls.push(newDC);

        for (let i = 0; i < inds.length; i++)
            indexData[indexOffs++] = inds[i];
    }

    return { gfx: { kind: "simple", vertexData, indexData, drawCalls }, uvs, texAnims, textureIndices, origin, isSkybox };
}

interface Hitbox {
    flags: number;
    center: vec3;
    minDelta: vec3;
    maxDelta: vec3;
}

interface SVTX {
    origin: vec3;
    count: number;
    start: number;
    hitboxen: Hitbox[];
    viewSpaceOffset: vec3;
    points: vec3[];
}

function getInt32Vec3(view: DataView, offs: number): vec3 {
    return vec3.fromValues(
        view.getInt32(offs + 0x00, true),
        view.getInt32(offs + 0x04, true),
        view.getInt32(offs + 0x08, true),
    );
}

function parseSVTX(view: DataView, offsets: number[]): SVTX[] {
    const vtxSets: SVTX[] = [];

    for (let i = 0; i < offsets.length - 1; i++) {
        const meshStart = offsets[i];
        const origin = vec3.fromValues(
            view.getInt16(meshStart + 0, true),
            view.getInt16(meshStart + 2, true),
            view.getInt16(meshStart + 4, true),
        );
        vec3.scale(origin, origin, 1 / 32);
        const viewSpaceOffset = vec3.fromValues(
            view.getInt16(meshStart + 0x8, true),
            view.getInt16(meshStart + 0xA, true),
            view.getInt32(meshStart + 0xC, true),
        );
        const vertexCount = view.getUint32(meshStart + 0x10, true);
        const hitboxCount = view.getUint32(meshStart + 0x14, true);
        const start = meshStart + view.getUint32(meshStart + 0x18, true);
        const hitboxen: Hitbox[] = [];
        let offs = meshStart + 0x1C;
        for (let j = 0; j < hitboxCount; j++, offs += 0x28) {
            hitboxen.push({
                flags: view.getUint32(offs + 0x00, true),
                center: getInt32Vec3(view, offs + 0x04),
                minDelta: getInt32Vec3(view, offs + 0x10),
                maxDelta: getInt32Vec3(view, offs + 0x1C),
            });
        }
        const points: vec3[] = [];
        while (offs < offsets[i + 1]) {
            const v = vec3.fromValues(
                view.getUint8(offs + 0),
                view.getUint8(offs + 2), // weird order
                view.getUint8(offs + 1),
            );
            vec3.add(v, v, origin);
            points.push(v);
            offs += 3;
        }
        vtxSets.push({ origin, count: vertexCount, viewSpaceOffset, start, hitboxen, points });
    }
    return vtxSets;
}

export enum ModelType {
    MESH = 1,
    SPRITE = 2,
    THREE = 3,
    TEXT = 4,
    QUAD_LIST = 5,
}

export enum MeshFlags {
    INTERPOLATE = 0x1,
}

export interface MeshInfo {
    kind: ModelType.MESH;
    modelIndex: number;
    geoName: string;
    vtxName: string;
    flags: MeshFlags;
    maxFrame: number;

    mesh: Mesh;
}

export interface SpriteFrame {
    color: vec3;
    code: number;
    uv: UV;
}

interface SpriteInfo {
    kind: ModelType.SPRITE;
    texName: string;
    frames: SpriteFrame[];
}


interface TexQuad {
    texInd: number;
    xlu: boolean;
    color: vec3;
    uv: UV;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}
export interface QuadListInfo {
    kind: ModelType.QUAD_LIST;
    texName: string;
    frames: TexQuad[][];
    modelIndex: number;
    data: QuadListGFX;
}

interface QuadListGFX {
    kind: ModelType.QUAD_LIST;
    vertexData: Float32Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[][];
}

enum ValueFormat {
    U8 = 0x01,
    U16 = 0x02,
    S32_3 = 0x03,
    S32_4 = 0x04,
    S32_5 = 0x05,
    S16_VEC = 0x06,
    S32_VEC = 0x07,
    S8 = 0x11,
    S16 = 0x12,
    S32_13 = 0x13,
    TYPE_MASK = 0x1F,
    TIMES = 0x20,
    VARIABLE_LENGTH = 0x40,
}

export enum DatabaseKey {
    GEOMETRY_FORMAT = 0x47,
    PATH = 0x4B,
    LOOKUP_INDEX = 0x9F,
    OBJECT_PARAMETERS = 0xA4,
    OBJECT_FILE = 0xA9,
    OBJECT_ID = 0xAA,
    LEVEL_FLAGS = 0x185,
    PATH_SCALE_SHIFT = 0x30E,
}
export interface SeriesDatabase {
    globalIndex: number;
    vecSeries: Map<DatabaseKey, vec3[][]>;
    scalarSeries: Map<DatabaseKey, number[][]>;
}

export interface ObjectPlacement {
    path: vec3[];
    id: number;
    lookupIndex: number;
    fileIndex: number;
    file: string;
    parameters: number[];
    geoFormat: number;
    db: SeriesDatabase;
}

interface ZDAT {
    dbs: SeriesDatabase[];
    otherNames: string[];
    objects: ObjectPlacement[];
}

function singleValue(db: SeriesDatabase, key: DatabaseKey): number {
    const series = assertExists(db.scalarSeries.get(key));
    assert(series.length >= 1 && series[0].length === 1);
    return series[0][0];
}

function singleValueOrDefault(db: SeriesDatabase, key: DatabaseKey, defaultValue: number): number {
    const series = db.scalarSeries.get(key);
    if (series === undefined)
        return defaultValue;
    assert(series.length === 1 && series[0].length === 1);
    return series[0][0];
}

function parseZDAT(view: DataView, offsets: number[], fileNames: string[]): ZDAT {

    const infoCount = view.getUint32(offsets[0] + 0x184, true);
    const dbCount = view.getUint32(offsets[0] + 0x188, true);
    const objCount = view.getUint32(offsets[0] + 0x18C, true);
    const hashCount = view.getUint32(offsets[0] + 0x190, true);


    const otherNames: string[] = [];
    for (let i = 0; i < hashCount; i++)
        otherNames.push(decodeChunkName(view.getUint32(offsets[0] + 0x194 + i * 4, true)));

    let offsetVec: vec3 | null = null;
    if (infoCount > 1) {
        offsetVec = vec3.fromValues(
            view.getInt32(offsets[1] + 0, true),
            view.getInt32(offsets[1] + 4, true),
            view.getInt32(offsets[1] + 8, true),
        );
    }

    const dbs: SeriesDatabase[] = [];
    for (let i = 0; i < dbCount; i++)
        dbs.push(parseZDATDatabase(view, offsets[i + infoCount]));

    const objPlacements: ObjectPlacement[] = [];
    for (let i = 0; i < objCount; i++) {
        const objDB = parseZDATDatabase(view, offsets[i + infoCount + dbCount]);
        const path = assertExists(objDB.vecSeries.get(DatabaseKey.PATH));
        assert(path.length === 1);
        const fileIndex = singleValue(objDB, DatabaseKey.OBJECT_FILE);
        const id = singleValue(objDB, DatabaseKey.OBJECT_ID);
        const shift = singleValue(objDB, DatabaseKey.PATH_SCALE_SHIFT);
        const lookupIndex = singleValue(objDB, DatabaseKey.LOOKUP_INDEX);
        const geoFormat = singleValueOrDefault(objDB, DatabaseKey.GEOMETRY_FORMAT, 0);

        for (let v of path[0]) {
            vec3.scaleAndAdd(v, assertExists(offsetVec), v, 1 << shift);
            vec3.scale(v, v, 0x100);
        }
        let parameters: number[] = [];
        const raw_param = objDB.scalarSeries.get(DatabaseKey.OBJECT_PARAMETERS);
        if (raw_param !== undefined)
            parameters = raw_param[0];
        objPlacements.push({
            fileIndex,
            file: fileNames[fileIndex],
            id,
            path: path[0],
            geoFormat,
            lookupIndex,
            parameters,
            db: objDB,
        });
    }
    return { dbs, otherNames, objects: objPlacements };
}

function parseZDATDatabase(view: DataView, start: number): SeriesDatabase {
    const seriesCount = view.getUint16(start + 0xC, true);
    let offs = start + 0x10;
    const vecSeries = new Map<number, vec3[][]>();
    const scalarSeries = new Map<number, number[][]>();
    for (let j = 0; j < seriesCount; j++) {
        const key = view.getUint16(offs + 0x0, true);
        const dataStart = start + 0xC + view.getUint16(offs + 0x2, true);
        const format: ValueFormat = view.getUint8(offs + 0x4);
        const valType: ValueFormat = format & ValueFormat.TYPE_MASK;
        const stride = view.getUint8(offs + 0x5);
        const valueCount = view.getUint16(offs + 0x6, true);
        offs += 8;

        switch (valType) {
            case ValueFormat.U8: case ValueFormat.S8:
                assert(stride === 1); break;
            case ValueFormat.S16: case ValueFormat.U16:
                assert(stride === 2); break;
            case ValueFormat.S32_3: case ValueFormat.S32_4:
            case ValueFormat.S32_5: case ValueFormat.S32_13:
                assert(stride === 4); break;
            case ValueFormat.S16_VEC:
                assert(stride === 6); break;
            case ValueFormat.S32_VEC:
                assert(stride === 12); break;
            default:
                throw `bad format ${format.toString(16)}`;
        }

        const valueSizes: number[] = [];
        const times: number[] = [];
        let valOffs = dataStart;
        if (format & ValueFormat.VARIABLE_LENGTH)
            for (let k = 0; k < valueCount; k++) {
                valueSizes.push(view.getUint16(valOffs, true));
                valOffs += 2;
            }
        else {
            const valueSize = view.getUint16(valOffs, true);
            valOffs += 2;
            for (let k = 0; k < valueCount; k++)
                valueSizes.push(valueSize);
        }
        if (format & ValueFormat.TIMES)
            for (let k = 0; k < valueCount; k++) {
                times.push(view.getUint16(valOffs, true));
                valOffs += 2;
            }
        valOffs = align(valOffs, 4);
        const series: (vec3 | number)[][] = [];
        for (let k = 0; k < valueCount; k++) {
            const subValues: (vec3 | number)[] = [];
            for (let subVal = 0; subVal < valueSizes[k]; subVal++) {
                let val: vec3 | number = 0;
                switch (valType) {
                    case ValueFormat.U8:
                        val = view.getUint8(valOffs); break;
                    case ValueFormat.S8:
                        val = view.getInt8(valOffs); break;
                    case ValueFormat.S16:
                        val = view.getInt16(valOffs, true); break;
                    case ValueFormat.U16:
                        val = view.getUint16(valOffs, true); break;
                    case ValueFormat.S32_3: case ValueFormat.S32_4:
                    case ValueFormat.S32_5: case ValueFormat.S32_13:
                        val = view.getInt32(valOffs, true); break;
                    case ValueFormat.S16_VEC:
                        val = vec3.fromValues(
                            view.getInt16(valOffs + 0, true),
                            view.getInt16(valOffs + 2, true),
                            view.getInt16(valOffs + 4, true),
                        ); break;
                    case ValueFormat.S32_VEC:
                        val = vec3.fromValues(
                            view.getInt32(valOffs + 0, true),
                            view.getInt32(valOffs + 4, true),
                            view.getInt32(valOffs + 8, true),
                        ); break;
                }
                subValues.push(val);
                valOffs += stride;
            }
            series.push(subValues);
        }
        if (valType === ValueFormat.S16_VEC || valType === ValueFormat.S32_VEC)
            vecSeries.set(key, series as vec3[][]);
        else
            scalarSeries.set(key, series as number[][]);
    }
    return { vecSeries, scalarSeries, globalIndex: -1 };
}

export type ModelInfo = SpriteInfo | MeshInfo | QuadListInfo;

interface ObjectState {
    motionFlags: number;
    interactFlags: number;
    altName: string;
    script: number;
    onSignal?: number;
    preRun?: number;
}

export interface GOOL {
    name: string,
    index: number,
    lookupIndex: number,
    category: number;
    models: Map<number, ModelInfo>;
    states: ObjectState[];
    signalIndices: number[];
    objectIndices: number[];
    stackStart: number;
    constView: DataView;
    scriptView: DataView;
}

function parseGOOL(name: string, view: DataView, offsets: number[], fileList: string[]): GOOL {
    assert(offsets.length === 7 || offsets.length === 4);
    const signalIndices: number[] = [];
    const objectIndices: number[] = [];
    const category = view.getUint8(offsets[0] + 5);
    assert(category < 0x20);
    const stackStart = view.getUint32(offsets[0] + 0x0C, true);
    const maxSignal = view.getUint32(offsets[0] + 0x10, true);
    for (let i = 0; i < maxSignal; i++)
        signalIndices.push(view.getInt16(offsets[3] + 2 * i, true));
    for (let offs = offsets[3] + 2 * maxSignal; offs < offsets[4]; offs += 2)
        objectIndices.push(view.getInt16(offs, true));
    const states: ObjectState[] = [];
    const models = new Map<number, ModelInfo>();
    if (offsets.length > 4) {
        for (let offs = offsets[4]; offs < offsets[5]; offs += 0x10) {
            const altFileIndex = view.getUint16(offs + 0x08, true);
            // may need to load later
            const altName = decodeChunkName(view.getUint32(offsets[2] + 4 * altFileIndex, true));
            // if (altName !== name)
            //     console.log(name, "requesting", altName);
            const onSignalOffset = view.getUint16(offs + 0xA, true);
            const preRunOffset = view.getUint16(offs + 0xC, true);
            const scriptOffset = view.getUint16(offs + 0xE, true);
            const state: ObjectState = {
                motionFlags: view.getUint32(offs + 0x0, true),
                interactFlags: view.getUint32(offs + 0x4, true),
                altName,
                // TODO: parse and fetch alternate file scripts
                // top bit indicates if it's from the alternate file
                script: scriptOffset & 0x7FFF,
            };
            if (onSignalOffset !== 0x3FFF)
                state.onSignal = onSignalOffset & 0x7FFF;
            if (preRunOffset !== 0x3FFF)
                state.preRun = preRunOffset & 0x7FFF;
            states.push(state);
        }

        let offs = offsets[5];
        while (offs < offsets[6]) {
            const type: ModelType = view.getUint8(offs);
            const startOffs = offs - offsets[5];
            switch (type) {
                case ModelType.MESH: {
                    const maxFrame = view.getUint16(offs + 0x2, true);
                    const flags = view.getUint32(offs + 0x4, true);
                    const geoHash = view.getUint32(offs + 0xC, true);
                    const vtxHash = view.getUint32(offs + 0x10, true);
                    models.set(startOffs, {
                        kind: type,
                        geoName: decodeChunkName(geoHash),
                        vtxName: decodeChunkName(vtxHash),
                        modelIndex: -1,
                        flags,
                        maxFrame,
                        mesh: null!,
                    });
                    offs += 0x14;
                } break;
                case ModelType.SPRITE: {
                    const count = view.getUint16(offs + 0x2, true);
                    const texName = decodeChunkName(view.getUint32(offs + 0x4, true));
                    offs += 8;
                    const frames: SpriteFrame[] = [];
                    for (let i = 0; i < count; i++) {
                        const color = vec3.fromValues(
                            view.getUint8(offs + 0) / 0xFF,
                            view.getUint8(offs + 1) / 0xFF,
                            view.getUint8(offs + 2) / 0xFF,
                        );
                        const code = view.getUint8(offs + 3);
                        const uv = parseUV(view, offs + 4);
                        frames.push({ color, code, uv });
                        offs += 0x10;
                    }
                    models.set(startOffs, { kind: type, texName, frames });
                } break;
                case ModelType.QUAD_LIST: {
                    const frameCount = view.getUint16(offs + 0x2, true);
                    const texName = decodeChunkName(view.getUint32(offs + 0x4, true));
                    const rects = view.getUint32(offs + 0x08, true);
                    const frames: TexQuad[][] = [];
                    offs += 0xC;

                    for (let i = 0; i < frameCount; i++) {
                        const curr: TexQuad[] = [];
                        let commonMode = -1;
                        for (let j = 0; j < rects; j++) {
                            const color = vec3.fromValues(
                                view.getUint8(offs + 0) / 0xFF,
                                view.getUint8(offs + 1) / 0xFF,
                                view.getUint8(offs + 2) / 0xFF,
                            );
                            const mode = view.getUint8(offs + 3);
                            assert((mode & 0xFD) === 0x2C); // textured flat quad (may be XLU)
                            const uv = parseUV(view, offs + 4);
                            const x0 = view.getInt16(offs + 0x10, true);// / 16;
                            const y0 = view.getInt16(offs + 0x12, true);// / 16;
                            const x1 = view.getInt16(offs + 0x14, true);// / 16;
                            const y1 = view.getInt16(offs + 0x16, true);// / 16;
                            curr.push({ xlu: !!(mode & 2), color, uv, x0, y0, x1, y1, texInd: -1 });
                            offs += 0x18;
                        }
                        frames.push(curr);
                    }
                    models.set(startOffs, { kind: type, texName, frames, modelIndex: -1, data: null! });
                } break;
                case ModelType.THREE: {
                    console.log("skipping model 3", name, startOffs.toString(16));

                    const count = view.getUint16(offs + 0x2, true);
                    offs += 0x8 + 0x14 * count;
                } break;
                default:
                    console.log("unhandled model type", type, offs.toString(16));
                    // hexdump(view.buffer, offs)
                    offs = offsets[6];
            }
        }
    }
    return { name, index: fileList.indexOf(name), category, models, states, signalIndices, objectIndices, scriptView: new DataView(view.buffer, offsets[1]), constView: new DataView(view.buffer, offsets[2]), lookupIndex: -1, stackStart };
}
export interface TexturePage {
    data: Uint8Array;
    width: number;
    height: number; // we assume height is 0x80
    name: string;
    bounds: vec4;
    blendMode: XLUBlendMode;
    hasXLU: boolean;
    hasOPA: boolean;
}

function containsUVs(bounds: vec4, uv: UV): boolean {
    return bounds[0] <= uv.minU && bounds[1] >= uv.maxU && bounds[2] <= uv.minV && bounds[3] >= uv.maxV;
}

function extendTexPage(data: ArrayBufferSlice, page: TexturePage, uv: UV): TexturePage {
    page.bounds[0] = Math.min(page.bounds[0], uv.minU);
    page.bounds[1] = Math.max(page.bounds[1], uv.maxU);
    page.bounds[2] = Math.min(page.bounds[2], uv.minV);
    page.bounds[3] = Math.max(page.bounds[3], uv.maxV);
    return parseTexPage(page.name, data, uv, page.bounds);
}

class TextureCache {
    public texList: TexturePage[] = [];
    public keyMap: Map<string, number>;

    constructor(private chunkMap: Map<string, TextureChunk>) {
        this.keyMap = new Map<string, number>();
    }

    public findOrParse(chunkName: string, uvs: UV): number {
        const chunk = this.chunkMap.get(chunkName);
        if (chunk === undefined)
            return -1;
        const name = texPageName(chunkName, uvs);
        let texIndex = this.keyMap.get(name);
        if (texIndex === undefined) {
            const page = parseTexPage(name, chunk.data, uvs);
            texIndex = this.texList.length;
            this.keyMap.set(name, texIndex);
            this.texList.push(page);
        } else {
            const prev = this.texList[texIndex];
            if (!containsUVs(prev.bounds, uvs))
                this.texList[texIndex] = extendTexPage(chunk.data, prev, uvs);
        }
        uvs.texIndex = texIndex;
        return texIndex;
    }
}

function texPageName(chunk: string, uvs: UV): string {
    const blendMode = uvs.texPage & ~TexModeFlags.TEXTURE_INDEX;//(uvs.texPage & (TexModeFlags.BLEND | TexModeFlags.COLOR_DEPTH)) >>> 5;
    return `${chunk}_${blendMode.toString(16)}_${uvs.clut.toString(16)}`;
}

export enum TexModeFlags {
    X_BASE = 0x0F,
    Y_BASE = 0x10,
    BLEND = 0x60,
    COLOR_DEPTH = 0x180,

    // specifically for this format
    TEXTURE_INDEX = 0x1C00,
}

export enum XLUBlendMode {
    // negative ones aren't real
    OPAQUE_ONLY = -2,
    DISABLED = -1,

    AVERAGE = 0,
    ADD = 1,
    SUB = 2,
    ADD_QUARTER = 3,
}

function expand5to8(n: number) {
    return (n << 3) | (n >>> 2);
}

function fillColor(dst: Uint8Array, offs: number, raw: number): number {
    dst[offs + 0] = expand5to8(raw & 0x1F);
    dst[offs + 1] = expand5to8((raw >>> 5) & 0x1F);
    dst[offs + 2] = expand5to8((raw >>> 10) & 0x1F);

    let alpha = 0xFF;
    if (raw === 0)
        alpha = 0;
    else if ((raw & 0x8000) !== 0)
        alpha = 0x80;
    dst[offs + 3] = alpha;
    return alpha;
}

function parseTexPage(name: string, data: ArrayBufferSlice, uv: UV, bounds?: vec4): TexturePage {
    const colorMode = (uv.texPage & TexModeFlags.COLOR_DEPTH) >>> 7;
    const depth = 4 << colorMode;
    const texX = (uv.texPage & TexModeFlags.X_BASE) << 6;

    if (bounds === undefined) {
        bounds = vec4.fromValues(
            uv.minU, uv.maxU,
            uv.minV, uv.maxV,
        );
    }

    const width = bounds[1] - bounds[0] + 1;
    const height = bounds[3] - bounds[2] + 1;

    const out = new Uint8Array(width * height * 4);
    const view = data.createDataView();
    let offs = 0;
    let hasXLU = false, hasOPA = false;
    function fill(value: number) {
        const a = fillColor(out, offs, value);
        if (a === 0xFF)
            hasOPA = true;
        else if (a === 0x80)
            hasXLU = true;
    }

    if (depth === 16) {
        // 16 bit, top bit is transparency
        for (let y = bounds[2]; y <= bounds[3]; y++)
            for (let x = bounds[0]; x <= bounds[1]; x++) {
                const raw = view.getUint16(2 * (texX + x + 0x100 * y), true);
                fill(raw);
                offs += 4;
            }
    } else {
        // fill clut
        const clutX = (uv.clut & 0x000F) << 4;
        const clutY = (uv.clut & 0x1FC0) >>> 6;
        const palette: number[] = [];
        const size = 1 << depth;
        for (let i = 0; i < size; i++) {
            const raw = view.getUint16(2 * (clutX + i + 0x100 * clutY), true);
            palette.push(raw);
        }

        for (let y = bounds[2]; y <= bounds[3]; y++)
            for (let x = bounds[0]; x <= bounds[1]; x++) {
                let index: number;
                if (depth === 8) {
                    index = view.getUint8(x + 2 * texX + 0x200 * y);
                } else {
                    const twoIndex = view.getUint8((x >>> 1) + 2 * texX + 0x200 * y);
                    if ((x & 1) === 0)
                        index = twoIndex & 0xF;
                    else
                        index = twoIndex >>> 4;
                }
                fill(palette[index]);
                offs += 4;
            }
    }
    return { data: out, width, height, name, bounds, blendMode: (uv.texPage & TexModeFlags.BLEND) >>> 5, hasOPA, hasXLU };
}

function parseSLST(view: DataView, offsets: number[]): void {

}

enum TriFlags {
    UV_INDEX        = 0x000000FF,
    TEX_ANIM        = 0x00000100,
    COLOR_INDEX     = 0x0000FE00,
    VERTEX_SOURCE   = 0x00FF0000,
    NO_FOG          = 0x01000000,
    LOAD_VERTEX     = 0x04000000,
    STORED_COLORS   = 0x08000000,
    ONE_SIDED       = 0x10000000,
    FLIPPED         = 0x20000000,
    USE_OLDEST      = 0x40000000,
    NEW_TRIANGLE    = 0x80000000,
}

interface triInfo {
    flags: number;
    texAnim: boolean;
    uvIndex: number;
    vs: number[];
    cs: number[];
}


class SignedBitStream {
    public offs: number = 0;
    public nbits!: number;
    public sink!: number;

    private maxBits = 32;
    private perRead = 16;

    constructor(private view: DataView) {
        this.reset();
    }

    public reset(): void {
        this.nbits = 0;
        this.sink = 0;
    }

    public fill(nbits: number): void {
        while (this.nbits < nbits) {
            const b = this.view.getUint16(this.offs ^ 2, true) >>> 0;
            this.sink = (this.sink | (b << (this.maxBits - this.perRead - this.nbits))) >>> 0;
            this.nbits += this.perRead;
            // JS can only hold 53-bit integers...
            assert(this.nbits < 53);
            this.offs += 0x02;
        }
    }

    public peek(nbits: number): number {
        return this.sink >>> (this.maxBits - nbits);
    }

    public eat(nbits: number): void {
        this.sink = (this.sink << nbits) >>> 0;
        this.nbits -= nbits;
    }

    public read(nbits: number): number {
        if (nbits > 0) {
            this.fill(nbits);
            const val = this.peek(nbits);
            this.eat(nbits);
            return val >= (1 << (nbits - 1)) ? val - (1 << nbits) : val;
        } else {
            return 0;
        }
    }
}

function generateVertices(view: DataView, header: SVTX, comp: CompressedVertex[], scale: vec3, dst: Uint8Array, dstOffset: number): number {
    if (comp.length === 0) {
        let offs = header.start;
        for (let i = 0; i < header.count; i++) {
            // weird ordering for easy conversion into draw command
            dst[dstOffset++] = view.getUint8(offs + 0);
            dst[dstOffset++] = view.getUint8(offs + 2);
            dst[dstOffset++] = view.getUint8(offs + 1);
            offs += 3;
            dstOffset++;
        }
    } else {
        const stream = new SignedBitStream(view);
        stream.offs = header.start;
        const tmpVtx = vec3.create();
        for (let inst of comp) {
            for (let i = 0; i < 3; i++) {
                const val = stream.read(inst.bitCounts[i]);
                if (inst.bitCounts[i] === 8)
                    tmpVtx[i] = val;
                else
                    tmpVtx[i] += val + inst.offsets[i];
                tmpVtx[i] = tmpVtx[i] & 0xFF;
            }
            dst[dstOffset++] = tmpVtx[0];
            dst[dstOffset++] = tmpVtx[1];
            dst[dstOffset++] = tmpVtx[2];
            dstOffset++;
        }
    }
    return dstOffset;
}

const TEX_ANIM_FLAG = 0x100000;

interface VertexAnimationData {
    buffer: Uint8Array;
    vtxCount: number;
    frameCount: number;
    origins: vec3[];
    scale: vec3;
}

function buildModel(view: DataView, geo: TGEO, svtx: SVTX[], textures: number[]): AnimatedMeshGFX | SimpleMeshGFX {
    const storedVerts: number[] = [];
    let vtxIndex = 0;

    const lastVerts = nArray(3, () => -1);
    const lastColors = nArray(3, () => -1);

    const triLists = new Map<number, triInfo[]>();

    function advanceVertex(flags: number, bufferIndex: number) {
        const storeIndex = (flags & TriFlags.VERTEX_SOURCE) >>> 0x10;
        let nextIndex: number;
        if (flags & TriFlags.LOAD_VERTEX) {
            nextIndex = assertExists(storedVerts[storeIndex]);
        } else {
            nextIndex = vtxIndex++;
            storedVerts[storeIndex] = nextIndex;
        }
        lastVerts[bufferIndex] = nextIndex;
        const colorIndex = (flags & TriFlags.COLOR_INDEX) >>> 9;
        lastColors[bufferIndex] = colorIndex;
    }

    function pushTriangle(flags: number): void {
        const uvIndex = flags & TriFlags.UV_INDEX;
        const texAnim = (flags & TriFlags.TEX_ANIM) !== 0;
        const key = texAnim ? TEX_ANIM_FLAG | uvIndex :
            uvIndex >= 1 ? textures[uvIndex - 1] : -1;

        let list = triLists.get(key);
        if (list === undefined) {
            list = [];
            triLists.set(key, list);
        }
        list.push({
            flags,
            uvIndex: texAnim ? uvIndex : uvIndex - 1,
            texAnim,
            vs: lastVerts.slice(),
            cs: lastColors.slice(),
        });
    }

    for (let i = 0; i < geo.triFlags.length; i++) {
        const flags = geo.triFlags[i];
        if (i === 0 || (flags & TriFlags.NEW_TRIANGLE)) {
            for (let j = 0; j < 3; j++)
                advanceVertex(geo.triFlags[i + j], j);
            i += 2;
            pushTriangle(flags);
            continue;
        }
        if ((flags >>> 0x10) === 0) {
            lastColors[1] = (flags >>> 9) & 0x7F;
            lastColors[2] = (flags >>> 2) & 0x7F;
            lastColors[0] = lastColors[1];
        } else {
            if ((flags & TriFlags.USE_OLDEST) === 0) {
                lastColors[0] = lastColors[1];
                lastVerts[0] = lastVerts[1];
            }
            lastColors[1] = lastColors[2];
            lastVerts[1] = lastVerts[2];
            advanceVertex(flags, 2);
            pushTriangle(flags);
        }
    }

    // weirdly these two counts can disagree, this didn't cause issues before
    const animationVertexCount = geo.compression.length || svtx[0].count;
    const animationRowSize = 4 * animationVertexCount;
    const vertexData: VertexAnimationData = {
        buffer: new Uint8Array(animationRowSize * svtx.length),
        vtxCount: animationVertexCount,
        frameCount: svtx.length,
        origins: [],
        scale: geo.scale,
    };
    let vtxCoordOffset = 0;
    for (let header of svtx) {
        generateVertices(view, header, geo.compression, geo.scale, vertexData.buffer, vtxCoordOffset);
        vtxCoordOffset += animationRowSize;
        vertexData.origins.push(header.origin);
    }
    const actuallyAnimated = vertexData.frameCount > 1;

    const INFO_STRIDE = 3 + 2 + (actuallyAnimated ? 1 : 3);
    const attrData = new Float32Array(geo.triCount * INFO_STRIDE * 3);
    const indexData = new Uint16Array(geo.triCount * 3);
    const drawCalls: DrawCall[] = [];
    let infoOffs = 0;
    let indexOffs = 0;
    for (let [key, infos] of triLists.entries()) {
        const newDC: DrawCall = { texAnimIndex: -1, textureIndex: -1, startIndex: indexOffs, indexCount: infos.length * 3, oneSided: false };
        if (key & TEX_ANIM_FLAG)
            newDC.texAnimIndex = key ^ TEX_ANIM_FLAG;
        else
            newDC.textureIndex = key;
        newDC.oneSided = (infos[0].flags & TriFlags.ONE_SIDED) !== 0;
        drawCalls.push(newDC);
        for (let tri = infos.length - 1; tri >= 0; tri--) {
            const info = infos[tri];
            const uv = (info.uvIndex >= 0 && !info.texAnim) ? geo.uvs[info.uvIndex] : null;
            for (let k = 0; k < 3; k++) {
                let i = k;
                if (i > 0 && (info.flags & TriFlags.FLIPPED) === 0) {
                    i = 3 - i;
                }

                attrData[infoOffs + 0] = geo.colors[info.cs[i]][0];
                attrData[infoOffs + 1] = geo.colors[info.cs[i]][1];
                attrData[infoOffs + 2] = geo.colors[info.cs[i]][2];

                if (info.texAnim) {
                    // we'll remap these later
                    attrData[infoOffs + 3] = i === 1 ? 1 : 0;
                    attrData[infoOffs + 4] = i === 2 ? 1 : 0;
                } else if (uv !== null) {
                    attrData[infoOffs + 3] = uv.us[i];
                    attrData[infoOffs + 4] = uv.vs[i];
                }

                if (actuallyAnimated) {
                    attrData[infoOffs + 5] = (info.vs[i] + .5) / animationVertexCount;
                } else {
                    // apply scale and translation now, since we won't do it at render time for simple meshes
                    attrData[infoOffs + 5] = (vertexData.buffer[4 * info.vs[i] + 0] + svtx[0].origin[0]) * geo.scale[0] / 8;
                    attrData[infoOffs + 6] = (vertexData.buffer[4 * info.vs[i] + 1] + svtx[0].origin[1]) * geo.scale[1] / 8;
                    attrData[infoOffs + 7] = (vertexData.buffer[4 * info.vs[i] + 2] + svtx[0].origin[2]) * geo.scale[2] / 8;
                }

                indexData[indexOffs] = indexOffs;
                indexOffs++;
                infoOffs += INFO_STRIDE;
            }
        }
    }
    if (actuallyAnimated)
        return { kind: "animated", vertexData, indexData, drawCalls, attrData };
    else
        return { kind: "simple", vertexData: attrData, indexData, drawCalls };
}

function buildQuadList(frames: TexQuad[][]): QuadListGFX {
    const VTX_STRIDE = 3 + 3 + 2;
    let total = 0;
    for (let f of frames)
        for (let rect of f)
            total++;
    const vertexData = new Float32Array(total * 4 * VTX_STRIDE);
    const indexData = new Uint16Array(total * 6);
    let indOffs = 0, vtxOffs = 0, vtxCount = 0;

    const drawCalls: DrawCall[][] = [];
    for (let f of frames) {
        const frameDCs: DrawCall[] = [];
        let currDC: DrawCall | null = null;
        f.sort((a, b) => a.texInd - b.texInd);
        let prevInd = -1;
        for (let rect of f) {
            if (rect.texInd !== prevInd || currDC === null) {
                currDC = { startIndex: indOffs, indexCount: 0, texAnimIndex: -1, textureIndex: rect.texInd, oneSided: false };
                prevInd = rect.texInd;
                frameDCs.push(currDC);
            }
            for (let i = 0; i < 4; i++) {
                vertexData[vtxOffs + 0] = (i % 2 ? rect.x1 : rect.x0) / 16;
                vertexData[vtxOffs + 1] = (i < 2 ? rect.y1 : rect.y0) / 16;
                vertexData[vtxOffs + 2] = 0;

                vertexData[vtxOffs + 3] = rect.color[0];
                vertexData[vtxOffs + 4] = rect.color[1];
                vertexData[vtxOffs + 5] = rect.color[2];

                vertexData[vtxOffs + 6] = rect.uv.us[i];
                vertexData[vtxOffs + 7] = rect.uv.vs[i];
                vtxOffs += VTX_STRIDE;
            }
            indexData[indOffs++] = vtxCount + 0;
            indexData[indOffs++] = vtxCount + 1;
            indexData[indOffs++] = vtxCount + 2;
            indexData[indOffs++] = vtxCount + 1;
            indexData[indOffs++] = vtxCount + 2;
            indexData[indOffs++] = vtxCount + 3;
            vtxCount += 4;
            currDC.indexCount += 6;
        }
        drawCalls.push(frameDCs);
    }
    return { kind: ModelType.QUAD_LIST, drawCalls, vertexData, indexData };
}

function parseVIDO(fileName: string, view: DataView, offsets: number[], cache: TextureCache): number[] {
    // first part is just image dimensions
    assert((view.getUint8(offsets[0]) >> 6) === 0);
    const width = view.getUint16(offsets[0] + 1);
    const height = view.getUint16(offsets[0] + 3) & 0x1FFF;
    assert((view.getUint8(offsets[0] + 3) >> 5) === 2); // 256 color palette

    const textures: number[] = [];

    assert(width * height <= 0x1000);
    const indices = new Uint8Array(width * height);
    const palette = new Uint8Array(0x200);
    const paletteView = new DataView(palette.buffer);
    let currTextureIndex = 0;
    for (let i = 1; i < offsets.length - 1; i++) {
        const offs = offsets[i];
        const desc = view.getUint8(offs);
        const dataType = desc >> 6;
        const fmt = desc & 7;
        if (dataType === 1) {
            // palette
            decompressVIDOPart(view, offs + 4, fmt, palette);
        } else {
            assert(dataType === 2);
            if (fmt === 0) {
                // just copy...?
                textures.push(textures[textures.length - 1]);
            } else {
                decompressVIDOPart(view, offs + 1, fmt, indices);
                const data = new Uint8Array(width * height * 4);
                for (let j = 0; j < indices.length; j++)
                    fillColor(data, j * 4, paletteView.getUint16(indices[j] * 2, true));
                textures.push(cache.texList.length);
                cache.texList.push({
                    width,
                    height,
                    data,
                    name: `${fileName}_${hexzero(currTextureIndex++, 2)}`,
                    bounds: vec4.create(), // don't care?
                    blendMode: 0, // will copy base texture
                    hasXLU: false,
                    hasOPA: false,
                });
            }
        }
    }
    return textures;
}

function decompressVIDOPart(view: DataView, offset: number, fmt: number, dst: Uint8Array): void {
    switch (fmt) {
        case 1: {
            const len = view.getUint16(offset);
            assert(len === dst.byteLength);
            for (let i = 0; i < len; i++)
                dst[i] = view.getUint8(offset + i + 2);
        } break;
        case 2:
            decompressRLE(view, offset, dst); break;
        case 3:
            decompressLZ(view, offset, dst); break;
        default:
        // assert(false);
    }
}

// LZ-like decompression, but:
//  - command bytes and other data are separated
//  - command bit meaning is flipped
//  - uses a separate ring buffer for the window rather than just an offset (our data is small enough to ignore this)
function decompressLZ(srcView: DataView, start: number, dst: Uint8Array) {
    let cmdOffs = start + 4;
    let srcOffs = cmdOffs + srcView.getUint32(start);
    let dstOffs = 0;
    while (true) {
        const commandByte = srcView.getUint8(cmdOffs++);
        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal
                dst[dstOffs++] = srcView.getUint8(srcOffs++);
            } else {
                const tmp = srcView.getUint16(srcOffs);
                srcOffs += 2;

                let windowOffset = (tmp & 0x0FFF) - 1;
                let windowLength = (tmp >> 12) + 2;
                assert(windowOffset < dstOffs, "copying from future bytes");
                if (windowOffset === -1) {
                    assert(dstOffs === dst.length);
                    return;
                }

                while (windowLength--)
                    dst[dstOffs++] = dst[windowOffset++];
            }
        }
    }
}

function decompressRLE(srcView: DataView, start: number, dst: Uint8Array) {
    let srcOffs = start;
    let dstOffs = 0;
    while (true) {
        const c = srcView.getInt8(srcOffs++);
        if (c < 0) {
            let len = -c;
            if (len === 0x80) {
                len = srcView.getUint16(srcOffs);
                srcOffs += 2;
            }
            while (len--) {
                dst[dstOffs++] = srcView.getUint8(srcOffs++);
            }
        } else {
            let len = c + 1;
            if (len === 1) {
                len = srcView.getUint16(srcOffs);
                srcOffs += 2;
                if (len === 0) {
                    // assert(dstOffs === dst.length);
                    return;
                }
            }
            const rep = srcView.getUint8(srcOffs++);
            while (len--) {
                dst[dstOffs++] = rep;
            }
        }
    }
}

interface BuoyData {
    coords: number[][];
    buoyUVs: UV[];
    waterTexUV: UV;
}

interface JetskiData {
    buoys?: BuoyData;
    waterUV: UV;
    vertexData: Uint8Array;
    indexData: Uint16Array;
    waveTextures: number[];
}

function parseBuoys(view: DataView, offsets: number[], cache: TextureCache): BuoyData {
    // buoys

    const reds: number[] = [];
    const yellows: number[] = [];
    const coords = [reds, yellows];
    for (let z = 0; z < 0xFF; z++) {
        let offs = offsets[0] + view.getUint16(offsets[0] + 2 * z, true);
        const end = offsets[0] + view.getUint16(offsets[0] + 2 * z + 2, true);

        while (offs < end) {
            const x = view.getUint8(offs++);
            const color = view.getUint8(offs++);
            assert(color !== 0);
            const nextX = view.getUint8(offs++);
            const nextColor = view.getUint8(offs++);
            assert(nextX === x + 1); // the parser allows for runs of colors, but everything is isolated
            if (color === 1)
                yellows.push(x, z);
            else
                reds.push(x, z);
            // only ski crazed has consecutive buoys of different colors
            // just move offs back and forget we read it
            if (nextColor !== 0)
                offs -= 2;
        }
    }
    const waterTexUV = parseSingleTexQuad(view, offsets[3], offsets[4], cache);

    const uvCount = view.getUint16(offsets[1] + 2, true);
    const texChunk = decodeChunkName(view.getUint32(offsets[1] + 4, true));
    let offs = offsets[1] + 8;
    const buoyUVs: UV[] = [];
    for (let i = 0; i < uvCount; i++) {
        assert(view.getUint32(offs, true) === 0x808080);
        const uv = parseUV(view, offs + 4);
        buoyUVs.push(uv);
        cache.findOrParse(texChunk, uv);
        offs += 0x10;
    }

    return { coords, buoyUVs, waterTexUV };
}

interface WaterMesh {
    vertexData: Uint8Array;
    indexData: Uint16Array;
}
function parseWaterGrid(view: DataView, offsets: number[]): WaterMesh {
    assert(offsets.length === 2 && offsets[1] - offsets[0] === 255 * 256);
    const VERTEX_STRIDE = 4;
    let triCount = 0;
    for (let offs = offsets[0]; offs < offsets[1]; offs++) {
        const triFlags = view.getUint8(offs) >>> 5;
        if (triFlags & 4)
            triCount++;
        else if (triFlags)
            triCount += 2;
    }

    const indexData = new Uint16Array(triCount * 3);
    const vertexData = new Uint8Array(256 * 256 * VERTEX_STRIDE);

    let offs = offsets[0];
    let indexOffs = 0;
    let vertexOffs = 0;
    for (let z = 0; z < 255; z++) {
        for (let x = 0; x < 256; x++) {
            const vtxInfo = view.getUint8(offs++);
            const triFlags = vtxInfo >>> 5;
            const scale = vtxInfo & 0x1F;
            vertexData[vertexOffs + 0] = x;
            vertexData[vertexOffs + 1] = scale;
            vertexData[vertexOffs + 2] = z;
            vertexOffs += VERTEX_STRIDE;
            // no triangles off of right edge
            if (x === 255)
                continue;
            switch (triFlags) {
                case 3: {
                    indexData[indexOffs++] = 256*z + x;
                    indexData[indexOffs++] = 256*z + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + x;
                    indexData[indexOffs++] = 256*z + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + x;
                    indexData[indexOffs++] = 256*(z + 1) + (x + 1);
                } break;
                case 4: {
                    indexData[indexOffs++] = 256*(z+1) + (x+1);
                    indexData[indexOffs++] = 256*z + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + x;
                } break;
                case 5: {
                    indexData[indexOffs++] = 256*z + x;
                    indexData[indexOffs++] = 256*(z+1) + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + x;
                } break;
                case 6: {
                    indexData[indexOffs++] = 256*z + x;
                    indexData[indexOffs++] = 256*z + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + x;
                } break;
                case 7: {
                    indexData[indexOffs++] = 256*z + x;
                    indexData[indexOffs++] = 256*z + (x + 1);
                    indexData[indexOffs++] = 256*(z + 1) + (x+1);
                } break;
            }
        }
    }
    // last row uses same scales as first (which should be uniform, anyway)
    offs = offsets[0];
    for (let x = 0; x < 256; x++) {
        const vtxInfo = view.getUint8(offs++);
        const scale = vtxInfo & 31;
        vertexData[vertexOffs + 0] = x;
        vertexData[vertexOffs + 1] = scale;
        vertexData[vertexOffs + 2] = 255;
        vertexOffs += VERTEX_STRIDE;
    }
    return { vertexData, indexData };
}

function fakeWaterGrid(): WaterMesh {
    const VERTEX_STRIDE = 4;
    const maxX = 128;
    const maxZ = 128;

    const indexData = new Uint16Array((maxX-1)*(maxZ-1)*6);
    const vertexData = new Uint8Array(maxX*maxZ*VERTEX_STRIDE);

    let indexOffs = 0;
    let vertexOffs = 0;
    for (let z = 0; z < maxZ; z++) {
        for (let x = 0; x < maxX; x++) {
            vertexData[vertexOffs + 0] = x;
            vertexData[vertexOffs + 1] = 0x10;
            vertexData[vertexOffs + 2] = z;
            vertexOffs += VERTEX_STRIDE;
            // no triangles off of edges
            if (x === maxX-1 || z === maxZ - 1)
                continue;
            indexData[indexOffs++] = maxX*z + x;
            indexData[indexOffs++] = maxX*z + (x + 1);
            indexData[indexOffs++] = maxX*(z + 1) + x;
            indexData[indexOffs++] = maxX*z + (x + 1);
            indexData[indexOffs++] = maxX*(z + 1) + x;
            indexData[indexOffs++] = maxX*(z + 1) + (x + 1);
        }
    }
    return { vertexData, indexData };
}

function parseWaveTextures(name: string, view: DataView, offsets: number[], cache: TextureCache): number[] {
    const indices: number[] = [];
    const dataSize = 4 * 32 * 32;
    for (let i = 0; i < offsets.length - 1; i++) {
        if (offsets[i + 1] - offsets[i] !== dataSize) {
            assert(i === offsets.length - 2);
            break;
        }
        const data = new Uint8Array(dataSize);
        let offs = offsets[i];
        for (let dst = 0; dst < dataSize; dst += 4) {
            // prescale uv for a 64 x 64 texture
            data[dst + 0] = view.getUint8(offs++)*4 + 2; // u
            data[dst + 1] = view.getUint8(offs++)*4 + 2; // v
            data[dst + 2] = view.getUint8(offs++); // brightness
            // the last byte is actually signed, shift it now to make the shader simpler
            data[dst + 3] = view.getInt8(offs++) + 0x80;
        }
        indices.push(cache.texList.length);
        cache.texList.push({
            data, width: 32, height: 32,
            name: `${name}_${i.toString(16)}`,
            blendMode: XLUBlendMode.ADD,
            bounds: vec4.create(),
            hasOPA: false,
            hasXLU: false,
        });
    }
    return indices;
}

function parseSingleTexQuad(view: DataView, start: number, end: number, cache: TextureCache): UV {
    assert(end - start === 0x18); // just one water texture
    const texName = decodeChunkName(view.getUint32(start + 4, true));
    const uv = parseUV(view, start + 0xC);
    assert(uv.maxU - uv.minU === 63 && uv.maxV - uv.minV === 63);
    cache.findOrParse(texName, uv);
    return uv;
}

interface TerrainData {
    terrainIndex: number;
    vertexData: Uint8Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[];
}

function parseTerrain(view: DataView, name: string, offsets: number[], cache: TextureCache): TerrainData {
    const rawTexCount = view.getUint16(offsets[0] + 2, true);
    // four lists of textures for the 8x8 subgrid, one for each orientation
    // we'll just assume they match up
    assert(rawTexCount === 8*8*4);
    const texCount = 8*8;
    const texChunk = decodeChunkName(view.getUint32(offsets[0] + 4, true));
    let offs = offsets[0] + 8;
    const textures: number[] = [];
    for (let i = 0; i < texCount; i++) {
        const uv = parseUV(view, offs + 4);
        textures.push(cache.findOrParse(texChunk, uv));
        offs += 0x10;
    }

    assert(offsets.length === 3 && offsets[2] - offsets[1] === 4*64*64);

    const terrainIndex = cache.texList.length;
    const data = new ArrayBufferSlice(view.buffer).createTypedArray(Uint8Array, offsets[1], 64*64*4);
    cache.texList.push({
        data,
        width: 64, height: 64,
        name: `${name}_0`,
        blendMode: XLUBlendMode.DISABLED,
        bounds: vec4.create(),
        hasOPA: false,
        hasXLU: false,
    });

    const VERTEX_STRIDE = 4;
    // TODO: maybe make this smaller and use instancing?
    // tiled 8x8 pattern of textured quads, but different occurrences of a vertex have different UV coords
    const vertexData = new Uint8Array(64*64*4*VERTEX_STRIDE);
    const indexData = new Uint16Array(6*64*64);
    const drawCalls: DrawCall[] = [];

    let indexOffs = 0;
    let vertexOffs = 0;
    let vertexIndex = 0;
    for (let baseZ = 0; baseZ < 8; baseZ++) {
        for (let baseX = 0; baseX < 8; baseX++) {
            const newDrawCall: DrawCall = {
                startIndex: indexOffs,
                indexCount: 0,
                textureIndex: textures[8*baseZ + baseX],
                texAnimIndex: -1,
                oneSided: false,
            };
            for (let dz = 0; dz < 8; dz++) {
                for (let dx = 0; dx < 8; dx++) {
                    const x = baseX + 8*dx;
                    const z = baseZ + 8*dz;
                    vertexData[vertexOffs + 0] = x;
                    vertexData[vertexOffs + 1] = z;
                    vertexData[vertexOffs + 2] = 0;
                    vertexOffs += VERTEX_STRIDE;
                    vertexData[vertexOffs + 0] = x + 1;
                    vertexData[vertexOffs + 1] = z;
                    vertexData[vertexOffs + 2] = 1;
                    vertexOffs += VERTEX_STRIDE;
                    vertexData[vertexOffs + 0] = x;
                    vertexData[vertexOffs + 1] = z + 1;
                    vertexData[vertexOffs + 2] = 2;
                    vertexOffs += VERTEX_STRIDE;
                    vertexData[vertexOffs + 0] = x + 1;
                    vertexData[vertexOffs + 1] = z + 1;
                    vertexData[vertexOffs + 2] = 3;
                    vertexOffs += VERTEX_STRIDE;

                    indexData[indexOffs++] = vertexIndex;
                    indexData[indexOffs++] = vertexIndex + 1;
                    indexData[indexOffs++] = vertexIndex + 2;
                    indexData[indexOffs++] = vertexIndex + 1;
                    indexData[indexOffs++] = vertexIndex + 2;
                    indexData[indexOffs++] = vertexIndex + 3;
                    vertexIndex += 4;
                }
            }
            newDrawCall.indexCount = indexOffs - newDrawCall.startIndex;
            drawCalls.push(newDrawCall);
        }
    }
    return { terrainIndex, vertexData, indexData, drawCalls };
}
