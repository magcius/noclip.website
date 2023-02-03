
import { ReadonlyVec4, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { convertToTrianglesRange, getTriangleIndexCountForTopologyIndexCount, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { LightmapPackerPage } from "../SourceEngine/BSPFile";
import { pairs2obj, ValveKeyValueParser, VKFPair } from "../SourceEngine/VMT";
import { assert, decodeString, readString } from "../util";

const enum LumpType {
    ENTITIES = 0,
    PLANES = 1,
    TEXTURES = 2,
    VERTEXES = 3,
    VISIBILITY = 4,
    NODES = 5,
    TEXINFO = 6,
    FACES = 7,
    LIGHTING = 8,
    CLIPNODES = 9,
    LEAFS = 10,
    MARKSURFACES = 11,
    EDGES = 12,
    SURFEDGES = 13,
    MODELS = 14,
};

interface TexinfoMapping {
    s: ReadonlyVec4;
    t: ReadonlyVec4;
}

interface Texinfo {
    textureMapping: TexinfoMapping;
    miptex: number;
    flags: number;
}

export interface SurfaceLightmapData {
    faceIndex: number;
    // Size of a single lightmap.
    width: number;
    height: number;
    styles: number[];
    samples: Uint8Array | null;
    // Dynamic allocation
    pageIndex: number;
    pagePosX: number;
    pagePosY: number;
}

export interface Surface {
    texName: string;
    startIndex: number;
    indexCount: number;
    lightmapData: SurfaceLightmapData[];
}

export interface BSPEntity {
    classname: string;
    [k: string]: string;
}

function parseEntitiesLump(str: string): BSPEntity[] {
    const p = new ValveKeyValueParser(str);
    const entities: BSPEntity[] = [];
    while (p.hastok()) {
        entities.push(pairs2obj(p.unit() as VKFPair[]) as BSPEntity);
        p.skipwhite();
    }
    return entities;
}

export class BSPFile {
    public version: number;

    private entitiesStr: string; // For debugging.
    public entities: BSPEntity[] = [];
    public indexData: ArrayBuffer;
    public vertexData: ArrayBuffer;
    public surfaces: Surface[] = [];
    public extraTexData: ArrayBufferSlice[] = [];
    public lightmapPackerPage = new LightmapPackerPage(2048, 2048);

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        this.version = view.getUint32(0x00, true);
        assert(this.version === 30);

        function getLumpData(lumpType: LumpType): ArrayBufferSlice {
            const lumpsStart = 0x04;
            const idx = lumpsStart + lumpType * 0x08;
            const offs = view.getUint32(idx + 0x00, true);
            const size = view.getUint32(idx + 0x04, true);
            return buffer.subarray(offs, size);
        }

        // Parse out entities.
        this.entitiesStr = decodeString(getLumpData(LumpType.ENTITIES));
        this.entities = parseEntitiesLump(this.entitiesStr);

        function readVec4(view: DataView, offs: number): vec4 {
            const x = view.getFloat32(offs + 0x00, true);
            const y = view.getFloat32(offs + 0x04, true);
            const z = view.getFloat32(offs + 0x08, true);
            const w = view.getFloat32(offs + 0x0C, true);
            return vec4.fromValues(x, y, z, w);
        }

        const texinfoa: Texinfo[] = [];

        const texinfo = getLumpData(LumpType.TEXINFO).createDataView();
        const texinfoCount = texinfo.byteLength / 0x28;
        for (let i = 0; i < texinfoCount; i++) {
            const infoOffs = i * 0x28;
            const textureMappingS = readVec4(texinfo, infoOffs + 0x00);
            const textureMappingT = readVec4(texinfo, infoOffs + 0x10);
            const textureMapping: TexinfoMapping = { s: textureMappingS, t: textureMappingT };
            const miptex = texinfo.getUint32(infoOffs + 0x20, true);
            const flags = texinfo.getUint32(infoOffs + 0x24, true);
            texinfoa.push({ textureMapping, miptex, flags });
        }

        // Parse miptex.
        const textures = getLumpData(LumpType.TEXTURES);
        const texturesView = textures.createDataView();
        const nummiptex = texturesView.getUint32(0x00, true);
        const textureNames: string[] = [];
        for (let i = 0; i < nummiptex; i++) {
            const miptexOffs = texturesView.getUint32(0x04 + i * 0x04, true);
            const texName = readString(textures, miptexOffs + 0x00, 0x10, true);
            const hasTextureData = texturesView.getUint32(miptexOffs + 0x18) !== 0;
            if (hasTextureData)
                this.extraTexData.push(textures.slice(miptexOffs));
            textureNames.push(texName);
        }

        // Parse out edges / surfedges.
        const edges = getLumpData(LumpType.EDGES).createTypedArray(Uint16Array);
        const surfedges = getLumpData(LumpType.SURFEDGES).createTypedArray(Int32Array);
        const vertindices = new Uint32Array(surfedges.length);
        for (let i = 0; i < surfedges.length; i++) {
            const surfedge = surfedges[i];
            if (surfedges[i] >= 0)
                vertindices[i] = edges[surfedge * 2 + 0];
            else
                vertindices[i] = edges[-surfedge * 2 + 1];
        }

        // Parse out faces, sort by texinfo.
        const facelist = getLumpData(LumpType.FACES).createDataView();

        interface Face {
            index: number;
            texinfo: number;
            texName: string;
        }
        const faces: Face[] = [];

        let numVertexData = 0, numIndexData = 0;
        for (let i = 0; i < facelist.byteLength / 0x14; i++) {
            const idx = i * 0x14;
            const numedges = facelist.getUint16(idx + 0x08, true);
            const texinfo = facelist.getUint16(idx + 0x0A, true);

            const texName = textureNames[texinfoa[texinfo].miptex];
            faces.push({ index: i, texinfo, texName });

            numVertexData += numedges;
            numIndexData += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, numedges);
        }

        faces.sort((a, b) => a.texName.localeCompare(b.texName));

        const vertexData = new Float32Array(numVertexData * 7);
        let dstOffsVertex = 0;

        const indexData = new Uint16Array(numIndexData);
        let dstOffsIndex = 0;
        let dstIndexBase = 0;

        // Build surface meshes
        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const lighting = getLumpData(LumpType.LIGHTING);
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const idx = face.index * 0x14;
            const planenum = facelist.getUint16(idx + 0x00, true);
            const side = facelist.getUint16(idx + 0x02, true);
            const firstedge = facelist.getUint32(idx + 0x04, true);
            const numedges = facelist.getUint16(idx + 0x08, true);

            const styles: number[] = [];
            for (let j = 0; j < 4; j++) {
                const style = facelist.getUint8(idx + 0x0C + j);
                if (style === 0xFF)
                    break;
                styles.push(style);
            }

            const lightofs = facelist.getUint32(idx + 0x10, true);

            let mergeSurface: Surface | null = null;
            if (i > 0) {
                const prevFace = faces[i - 1];
                let canMerge = true;

                if (face.texName !== prevFace.texName)
                    canMerge = false;

                if (canMerge)
                    mergeSurface = this.surfaces[this.surfaces.length - 1];
                // TODO(jstpierre): models
            }

            const m = texinfoa[face.texinfo].textureMapping;
            let minTexCoordS = Infinity, minTexCoordT = Infinity;
            let maxTexCoordS = -Infinity, maxTexCoordT = -Infinity;

            const dstOffsVertexBase = dstOffsVertex;
            for (let j = 0; j < numedges; j++) {
                const vertIndex = vertindices[firstedge + j];
                const px = vertexes[vertIndex * 3 + 0];
                const py = vertexes[vertIndex * 3 + 1];
                const pz = vertexes[vertIndex * 3 + 2];

                const texCoordS = Math.fround(px*m.s[0] + py*m.s[1] + pz*m.s[2] + m.s[3]);
                const texCoordT = Math.fround(px*m.t[0] + py*m.t[1] + pz*m.t[2] + m.t[3]);

                vertexData[dstOffsVertex++] = px;
                vertexData[dstOffsVertex++] = py;
                vertexData[dstOffsVertex++] = pz;

                vertexData[dstOffsVertex++] = texCoordS;
                vertexData[dstOffsVertex++] = texCoordT;

                // Dummy lightmap data for now, will compute after the loop.
                vertexData[dstOffsVertex++] = 0;
                vertexData[dstOffsVertex++] = 0;

                minTexCoordS = Math.min(minTexCoordS, texCoordS);
                minTexCoordT = Math.min(minTexCoordT, texCoordT);
                maxTexCoordS = Math.max(maxTexCoordS, texCoordS);
                maxTexCoordT = Math.max(maxTexCoordT, texCoordT);
            }

            const lightmapScale = 1 / 16;
            const surfaceW = Math.ceil((maxTexCoordS * lightmapScale)) - Math.floor(minTexCoordS * lightmapScale) + 1;
            const surfaceH = Math.ceil((maxTexCoordT * lightmapScale)) - Math.floor(minTexCoordT * lightmapScale) + 1;

            const lightmapSamplesSize = (surfaceW * surfaceH * styles.length * 3);
            const samples = lightofs !== 0xFFFFFFFF ? lighting.subarray(lightofs, lightmapSamplesSize).createTypedArray(Uint8Array) : null;

            const lightmapData: SurfaceLightmapData = {
                faceIndex: face.index,
                width: surfaceW, height: surfaceH,
                pageIndex: 0, pagePosX: 0, pagePosY: 0,
                styles, samples,
            };
            assert(this.lightmapPackerPage.allocate(lightmapData));

            // Fill in UV
            for (let j = 0; j < numedges; j++) {
                let offs = dstOffsVertexBase + (j * 7) + 3;

                const texCoordS = vertexData[offs++];
                const texCoordT = vertexData[offs++];

                const lightmapCoordS = (texCoordS * lightmapScale) - Math.floor(minTexCoordS * lightmapScale) + 0.5;
                const lightmapCoordT = (texCoordT * lightmapScale) - Math.floor(minTexCoordT * lightmapScale) + 0.5;
                vertexData[offs++] = lightmapData.pagePosX + lightmapCoordS;
                vertexData[offs++] = lightmapData.pagePosY + lightmapCoordT;
            }

            const indexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, numedges);
            convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TriFans, dstIndexBase, numedges);

            let surface = mergeSurface;

            if (surface === null) {
                surface = { texName: face.texName, startIndex: dstOffsIndex, indexCount: 0, lightmapData: [] };
                this.surfaces.push(surface);
            }

            surface.lightmapData.push(lightmapData);
            surface.indexCount += indexCount;

            dstOffsIndex += indexCount;
            dstIndexBase += numedges;
        }

        this.vertexData = vertexData.buffer as ArrayBuffer;
        this.indexData = indexData.buffer as ArrayBuffer;
    }

    public getWadList(): string[] {
        const worldspawn = this.entities[0];
        assert(worldspawn.classname === 'worldspawn');

        const wad = worldspawn.wad;
        return wad.split(';').map((v) => {
            // Replace the initial mount name.
            assert(v.startsWith('\\'));
            const x = v.split('\\');
            x.shift();
            x.shift();
            return x.join('/');
        }).filter((v) => {
            // remove non-existent files
            if (v === 'valve/sample.wad')
                return false;

            return true;
        });
    }
}
