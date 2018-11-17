
import * as BFRES from '../fres/bfres';
import * as SARC from '../fres/sarc';
import * as Yaz0 from '../compression/Yaz0';
import { Area, LoadedTerrainArea } from './render';
import { AreaInfo, TSCB } from './tscb';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera } from '../Camera';
import { vec3, mat4 } from 'gl-matrix';
import { assertExists, assert } from '../util';
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxTexture } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';

// Terrain System

// The field (MainField at least) is 10000x10000, centered at 0,0 (so -5000 to 5000).
// The camera frustum decides what chunks we should display, and at what detail levels.

class QuadTreeNode {
    public children: QuadTreeNode[] = [];
    public areaInfo: AreaInfo;
}

function makeStaticDataTexture(device: GfxDevice, data: Uint8Array, width: number, height: number): GfxTexture {
    const texture = device.createTexture(GfxFormat.U8_RGBA, width, height, 1);
    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(texture, 0, [data]);
    device.submitPass(hostAccessPass);
    return texture;
}

function makePositionBuffer(hghtData: Uint16Array, width: number, height: number): Uint16Array {
    // X/Z is from 0-255, Y is height.
    const pos = new Uint16Array(width*height*3);
    let i = 0;
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            pos[i++] = x;
            pos[i++] = hghtData[z*width+x];
            pos[i++] = z;
        }
    }
    return pos;
}

function makeNBTBuffer(hghtData: Uint16Array, width: number, height: number): Int16Array {
    const n = vec3.create();
    const b = vec3.create();
    const t = vec3.create();

    // tangent is left to the shader to calculate.
    const nb = new Int16Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const h11 = hghtData[y*width + x];
            const h01 = hghtData[y*width + x-1] || h11;
            const h21 = hghtData[y*width + x+1] || h11;
            const h10 = hghtData[(y-1)*width + x] || h11;
            const h12 = hghtData[(y+1)*width + x] || h11;
            const i = (y*width + x) * 3;
            vec3.set(t, 2, h21-h01, 0);
            vec3.set(b, 0, h12-h10, 2);
            vec3.cross(n, t, b);
            nb[i+0] = n[0] * 0x7FFF;
            nb[i+1] = n[1] * 0x7FFF;
            nb[i+2] = n[2] * 0x7FFF;
        }
    }

    return nb;
}

const scratchVec3 = vec3.create();
export class TerrainManager {
    public quadTreeRoot: QuadTreeNode;

    // Maps from material ID (stored in MATE files) to which texture layer to use (FRES)
    public materialArrayIndexPalette: Uint8Array;

    constructor(public tscb: TSCB, public terrainFRES: BFRES.FRES, public teraPath: string) {
        this.quadTreeRoot = this.buildQuadTree(0);

        const materialAlb = terrainFRES.ftex.find((e) => e.name === 'MaterialAlb');
        this.materialArrayIndexPalette = this.buildArrayIndexPalette(materialAlb);
    }

    public buildArrayIndexPalette(ftex: BFRES.FTEXEntry): Uint8Array {
        const userData = ftex.ftex.userData;
        const arrayIndexEntry = assertExists(userData.entries.find((e) => e.name === 'array_index'));
        assert(arrayIndexEntry.kind === BFRES.ResUserDataEntryKind.Int32);
        return new Uint8Array(arrayIndexEntry.values as number[]);
    }

    public loadArea(device: GfxDevice, area: Area): LoadedTerrainArea {
        const loadedArea = new LoadedTerrainArea();
        loadedArea.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, makePositionBuffer(area.hghtData, area.width, area.height).buffer);
        loadedArea.nbtBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, makeNBTBuffer(area.hghtData, area.width, area.height).buffer);
        loadedArea.mateTexture = this.buildAreaRenderMateTexture(device, area);
        return loadedArea;
    }

    public buildAreaRenderMateTexture(device: GfxDevice, area: Area): GfxTexture {
        const mateData = area.mateData;
        const textureData = new Uint8Array(mateData.length);
        for (let i = 0; i < mateData.length; i += 4) {
            textureData[i + 0] = this.materialArrayIndexPalette[mateData[i + 0]];
            textureData[i + 1] = this.materialArrayIndexPalette[mateData[i + 1]];
            textureData[i + 2] = mateData[i + 2];
            textureData[i + 3] = mateData[i + 3];
        }
        return makeStaticDataTexture(device, textureData, area.width, area.height);
    }

    public buildQuadTree(i: number): QuadTreeNode {
        const areaInfo = this.tscb.areaInfos[i];

        const node = new QuadTreeNode();
        node.areaInfo = areaInfo;

        const hs = areaInfo.areaSize / 2;
        const qs = areaInfo.areaSize / 4;

        const x1 = areaInfo.x - qs, x2 = areaInfo.x + qs;
        const y1 = areaInfo.y - qs, y2 = areaInfo.y + qs;

        for (let j = i + 1; j < this.tscb.areaInfos.length; j++) {
            const possibleChild = this.tscb.areaInfos[j];
            if (possibleChild.areaSize > hs)
                continue;
            if (possibleChild.areaSize < hs)
                break;

            if (possibleChild.x === x1 && possibleChild.y === y1)
                node.children[0] = this.buildQuadTree(j);
            else if (possibleChild.x === x2 && possibleChild.y === y1)
                node.children[1] = this.buildQuadTree(j);
            else if (possibleChild.x === x1 && possibleChild.y === y2)
                node.children[2] = this.buildQuadTree(j);
            else if (possibleChild.x === x2 && possibleChild.y === y2)
                node.children[3] = this.buildQuadTree(j);
        }

        return node;
    }

    public cameraToTerrainWorld(v: vec3, camera: Camera): void {
        mat4.getTranslation(v, camera.viewMatrix);
    }

    public loadAreasFromCamera(camera: Camera): void {
        this.cameraToTerrainWorld(scratchVec3, camera);
    }
}

function decodeSSTERA(buffer: ArrayBufferSlice): Promise<SARC.SARC> {
    return Yaz0.decompress(buffer).then((buffer) => SARC.parse(buffer));
}

export interface AreaArchive {
    hghtArc: SARC.SARC;
    mateArc: SARC.SARC;
}

export function fetchAreaArchive(teraPath: string, areaInfo: AreaInfo): Progressable<AreaArchive> {
    // Area archives are grouped in groups of 4.
    const lastChar = parseInt(areaInfo.filename[9], 16);
    const newLastChar = '000044448888CCCC'[lastChar];
    const archiveName = areaInfo.filename.slice(0, 9) + newLastChar;
    console.log(areaInfo.filename, archiveName);
    const hght = fetchData(`${teraPath}/${archiveName}.hght.sstera`).then(decodeSSTERA);
    const mate = fetchData(`${teraPath}/${archiveName}.mate.sstera`).then(decodeSSTERA);
    return Progressable.all([hght, mate]).then(([hghtArc, mateArc]) => {
        return { hghtArc, mateArc };
    });
}

export function fetchAreaData(teraPath: string, areaInfo: AreaInfo): Progressable<Area> {
    const width = 256, height = 256;

    return fetchAreaArchive(teraPath, areaInfo).then((arc) => {
        const hghtFile = arc.hghtArc.files.find((n) => n.name === `${areaInfo.filename}.hght`);
        const mateFile = arc.mateArc.files.find((n) => n.name === `${areaInfo.filename}.mate`);
        const hghtData = hghtFile.buffer.createTypedArray(Uint16Array);
        const mateData = mateFile.buffer.createTypedArray(Uint8Array);
        const area: Area = { areaInfo, hghtData, mateData, width, height };
        return area;
    });
}
