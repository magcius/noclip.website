
import * as BFRES from '../fres/bfres';
import * as SARC from '../fres/sarc';
import * as Yaz0 from '../compression/Yaz0';
import { Area, LoadedTerrainArea, TerrainAreaRenderer, TerrainRenderer } from './render';
import { AreaInfo, TSCB } from './tscb';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { vec3 } from 'gl-matrix';
import { assertExists, assert, nArray } from '../util';
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxTexture } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { AABB } from '../Geometry';

// Terrain System

// The field (MainField at least) is 10000x10000, centered at 0,0 (so -5000 to 5000).

// Just about whether the chunk files itself have been loaded.
const enum AreaLoadState {
    Unloaded, Loading, Loaded
}

class TeraRenderAreaInfo {
    public loadState = AreaLoadState.Unloaded;
    // Whether we want this chunk to be visible or not. Independent of loadState.
    public shouldBeVisible: boolean = false;
    public terrainAreaRenderer: TerrainAreaRenderer | null = null;
    public unloadTimer: number = 0;
}

class QuadTreeNode {
    public children: QuadTreeNode[] = nArray(4, () => null);
    public areaInfo: AreaInfo;

    // Invariant: if *any* children are visible, isVisible will be as well. It is, however, possible
    // for isVisible to be true but all children are invisible -- this happens if we don't need the
    // level of detail that a child chunk would give us.
    public isVisible: boolean = false;

    // The QuadTree can contain four children, but always will have a lower-detail model "to itself".
    // TeraRenderAreaInfo is information *solely* about the node's self-render state.
    // It is possible (and expected!) that a node will be unloaded while all its children are loaded.
    public renderInfo = new TeraRenderAreaInfo();
}

function makeStaticDataTexture(device: GfxDevice, data: Uint8Array, width: number, height: number): GfxTexture {
    const texture = device.createTexture(GfxFormat.U8_RGBA, width, height, 1);
    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(texture, 0, [data]);
    device.submitPass(hostAccessPass);
    return texture;
}

const WORLD_SCALE = 50000;
// TODO(jstpierre): something more sensible.
const Y_SCALE = WORLD_SCALE * 0.01 / 255;

function computeAreaAABB(area: Area): AABB {
    const areaInfo = area.areaInfo;
    const hs = areaInfo.areaSize / 2;
    const minX = areaInfo.x - hs, maxX = areaInfo.x + hs;
    const minZ = areaInfo.z - hs, maxZ = areaInfo.z + hs;
    const maxY = 65535 * Y_SCALE;
    return new AABB(
        minX * WORLD_SCALE, -maxY, minZ * WORLD_SCALE,
        maxX * WORLD_SCALE, maxY, maxZ * WORLD_SCALE,
    );
}

function makePositionBuffer(area: Area, xMax: number, zMax: number): Float32Array {
    const overallScale = WORLD_SCALE;
    const areaInfo = area.areaInfo;
    const scaleXZ = overallScale * areaInfo.areaSize / 255;
    const scaleX = scaleXZ, scaleZ = scaleXZ;
    const biasX = overallScale * (areaInfo.x - areaInfo.areaSize/2);
    const biasZ = overallScale * (areaInfo.z - areaInfo.areaSize/2);

    // input X/Z = [0,255], input Y = [0-65535].
    // output X/Z = overallScale*[areaInfo.x-areaInfo.areaSize,areaInfo.x+areaInfo.areaSize]
    const scaleY = Y_SCALE, biasY = 0;

    // X/Y/Z are pretransformed into world position.
    const pos = new Float32Array(xMax*zMax*3);
    let i = 0;
    for (let z = 0; z < zMax; z++) {
        for (let x = 0; x < xMax; x++) {
            const y = area.hghtData[z*zMax+x];
            pos[i++] = (scaleX*x)+biasX;
            pos[i++] = (scaleY*y)+biasY;
            pos[i++] = (scaleZ*z)+biasZ;
        }
    }
    return pos;
}

function makeNBTBuffer(hghtData: Uint16Array, width: number, height: number): Int16Array {
    const n = vec3.create();
    const b = vec3.create();
    const t = vec3.create();

    // tangent is left to the shader to calculate.
    const nb = new Int16Array(width * height * 6);
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
            vec3.normalize(n, n);
            vec3.normalize(b, b);
            nb[i+0] = n[0] * 0x7FFF;
            nb[i+1] = n[1] * 0x7FFF;
            nb[i+2] = n[2] * 0x7FFF;
            nb[i+3] = b[0] * 0x7FFF;
            nb[i+4] = b[1] * 0x7FFF;
            nb[i+5] = b[2] * 0x7FFF;
        }
    }

    return nb;
}

function makeGridAttributesBuffer(areaInfo: AreaInfo): Float32Array {
    const v = new Float32Array(4);
    // Offset in terrain coords.
    v[0] = areaInfo.x - areaInfo.areaSize / 2;
    v[1] = areaInfo.z - areaInfo.areaSize / 2;
    v[2] = 1;
    v[3] = areaInfo.areaSize;
    return v;
}

function decodeSSTERA(buffer: ArrayBufferSlice): Promise<SARC.SARC> {
    return Yaz0.decompress(buffer).then((buffer) => SARC.parse(buffer));
}

export interface AreaArchive {
    hghtArc: SARC.SARC;
    mateArc: SARC.SARC;
}

export class TerrainManager {
    public archiveCache = new Map<string, Progressable<AreaArchive>>();

    public quadTreeRoot: QuadTreeNode;

    // Maps from material ID (stored in MATE files) to which texture layer to use (FRES)
    public materialArrayIndexPalette: Uint8Array;

    public terrainRenderer: TerrainRenderer;

    constructor(public device: GfxDevice, public tscb: TSCB, public terrainFRES: BFRES.FRES, public teraPath: string) {
        this.quadTreeRoot = this.buildQuadTree(0);

        const materialAlb = terrainFRES.ftex.find((e) => e.name === 'MaterialAlb');
        this.materialArrayIndexPalette = this.buildArrayIndexPalette(materialAlb);
    }

    public destroy(device: GfxDevice): void {
        // Unload the quad tree.
        const unloadQuadTreeNode = (node: QuadTreeNode) => {
            for (let i = 0; i < node.children.length; i++) {
                if (node.children[i] === null)
                    continue;
                unloadQuadTreeNode(node.children[i]);
            }
            this.unloadArea(node);
        };
    }

    public buildArrayIndexPalette(ftex: BFRES.FTEXEntry): Uint8Array {
        const userData = ftex.ftex.userData;
        const arrayIndexEntry = assertExists(userData.entries.find((e) => e.name === 'array_index'));
        assert(arrayIndexEntry.kind === BFRES.ResUserDataEntryKind.Int32);
        return new Uint8Array(arrayIndexEntry.values as number[]);
    }

    public buildLoadedTerrainArea(device: GfxDevice, area: Area): LoadedTerrainArea {
        const loadedArea = new LoadedTerrainArea();
        loadedArea.aabb = computeAreaAABB(area);
        loadedArea.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, makePositionBuffer(area, area.xMax, area.zMax).buffer);
        loadedArea.nbtBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, makeNBTBuffer(area.hghtData, area.xMax, area.zMax).buffer);
        loadedArea.gridAttributesBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, makeGridAttributesBuffer(area.areaInfo).buffer);
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
        return makeStaticDataTexture(device, textureData, area.xMax, area.zMax);
    }

    public prepareToRender(): void {
        // TODO(jstpierre): Merge / simplify this function.
        const loadAreas = (node: QuadTreeNode) => {
            this.manageQuadTreeLoaded(node);

            for (let i = 0; i < node.children.length; i++) {
                if (node.children[i] === null)
                    continue;
                loadAreas(node.children[i]);
            }
        };
        loadAreas(this.quadTreeRoot);

        function updateVisibility(node: QuadTreeNode) {
            let hasVisibleChild = false;
            let allChildrenVisible = true;
            for (let i = 0; i < node.children.length; i++) {
                if (node.children[i] === null)
                    continue;
                updateVisibility(node.children[i]);
                hasVisibleChild = hasVisibleChild || node.children[i].isVisible;
                allChildrenVisible = allChildrenVisible && node.children[i].isVisible;
            }

            // If *some* children are visible, then we need to show our lower LOD versions for the other
            // chunks. If all children are visible, then we don't, and we don't need to be loaded.
            const chunkCanBeVisible = node.renderInfo.loadState === AreaLoadState.Loaded || allChildrenVisible;
            node.isVisible = chunkCanBeVisible && (node.renderInfo.shouldBeVisible || hasVisibleChild);
        }
        updateVisibility(this.quadTreeRoot);

        // Set our render masks.
        function setRenderMasks(node: QuadTreeNode) {
            // If a child is visible, it masks the parent.
            if (node.renderInfo.loadState === AreaLoadState.Loaded) {
                const renderer = node.renderInfo.terrainAreaRenderer;

                if (node.isVisible) {
                    renderer.chunkRenderMask = 0x0F;
                    for (let i = 0; i < node.children.length; i++) {
                        if (node.children[i] === null)
                            continue;
                        // Kill our own chunk if a child has it coverered...
                        if (node.children[i].isVisible)
                            node.renderInfo.terrainAreaRenderer.chunkRenderMask &= ~(1 << i);
                    }
                } else {
                    renderer.chunkRenderMask = 0;
                }
            }

            for (let i = 0; i < node.children.length; i++) {
                if (node.children[i] === null)
                    continue;
                setRenderMasks(node.children[i]);
            }
        }

        setRenderMasks(this.quadTreeRoot);
    }

    public fetchAreaArchive(archiveName: string): Progressable<AreaArchive> {
        if (this.archiveCache.has(archiveName))
            return this.archiveCache.get(archiveName);

        const hght = fetchData(`${this.teraPath}/${archiveName}.hght.sstera`).then(decodeSSTERA);
        const mate = fetchData(`${this.teraPath}/${archiveName}.mate.sstera`).then(decodeSSTERA);
        const p = Progressable.all([hght, mate]).then(([hghtArc, mateArc]) => {
            return { hghtArc, mateArc };
        });
        this.archiveCache.set(archiveName, p);
        return p;
    }

    public fetchAreaData(areaInfo: AreaInfo): Progressable<Area> {
        const xMax = 256, zMax = 256;

        const lastChar = parseInt(areaInfo.filename[9], 16);
        const newLastChar = '000044448888CCCC'[lastChar];
        const archiveName = areaInfo.filename.slice(0, 9) + newLastChar;
        return this.fetchAreaArchive(archiveName).then((arc) => {
            const hghtFile = arc.hghtArc.files.find((n) => n.name === `${areaInfo.filename}.hght`);
            const mateFile = arc.mateArc.files.find((n) => n.name === `${areaInfo.filename}.mate`);
            const hghtData = hghtFile.buffer.createTypedArray(Uint16Array);
            const mateData = mateFile.buffer.createTypedArray(Uint8Array);
            const area: Area = { areaInfo, hghtData, mateData, xMax, zMax };
            return area;
        });
    }

    public loadArea(quadTreeNode: QuadTreeNode): void {
        if (quadTreeNode.renderInfo.loadState === AreaLoadState.Unloaded) {
            quadTreeNode.renderInfo.loadState = AreaLoadState.Loading;
            this.fetchAreaData(quadTreeNode.areaInfo).then((area) => {
                // If we were unloaded in the meantime, then kill it. Unfortunately, we can't cancel the fetch quite yet...
                if (quadTreeNode.renderInfo.loadState !== AreaLoadState.Loading)
                    return;

                const loadedArea = this.buildLoadedTerrainArea(this.device, area);
                quadTreeNode.renderInfo.terrainAreaRenderer = this.terrainRenderer.addTerrainArea(this.device, quadTreeNode.areaInfo, loadedArea);
                quadTreeNode.renderInfo.loadState = AreaLoadState.Loaded;
            });
        }
    }

    public unloadArea(quadTreeNode: QuadTreeNode): void {
        // Kill our renderer if it exists...
        if (quadTreeNode.renderInfo.loadState === AreaLoadState.Loaded) {
            quadTreeNode.renderInfo.terrainAreaRenderer.destroy(this.device);
            quadTreeNode.renderInfo.terrainAreaRenderer = null;
        }

        quadTreeNode.renderInfo.loadState = AreaLoadState.Unloaded;
    }

    public manageQuadTreeLoaded(node: QuadTreeNode): void {
        const shouldBeLoaded = node.renderInfo.shouldBeVisible;

        if (shouldBeLoaded) {
            node.renderInfo.unloadTimer = 0;
            this.loadArea(node);
        } else if (node.renderInfo.loadState !== AreaLoadState.Unloaded) {
            // Tick up. If we haven't seen it for more than N draws, kill it.
            node.renderInfo.unloadTimer++;
            if (node.renderInfo.unloadTimer > 120) {
                this.unloadArea(node);
                node.renderInfo.unloadTimer = 0;
            }
        }
    }

    public setWorldPosition(posX: number, posZ: number) {
        // TODO(jstpierre): Find a good, sensible value for this?
        const shouldLoadRadius = 1;
        const shouldLoadRadiusSq = shouldLoadRadius*shouldLoadRadius;

        function clamp(v: number, min: number, max: number) {
            return Math.max(Math.min(v, max), min);
        }

        // Traverse down the quad tree, looking for the right LOD to load.
        function traverseNode(node: QuadTreeNode, mightBeVisible: boolean = true) {
            const areaInfo = node.areaInfo;

            let isVisible = mightBeVisible;

            if (isVisible) {
                const hs = areaInfo.areaSize / 2;
                const xMin = areaInfo.x - hs, xMax = areaInfo.x + hs;
                const zMin = areaInfo.z - hs, zMax = areaInfo.z + hs;
                // Nearest point on rect.
                const nearX = clamp(posX, xMin, xMax), nearZ = clamp(posZ, zMin, zMax);
                const distSq = (nearX-posX)*(nearX-posX) + (nearZ-posZ)*(nearZ-posZ);
                isVisible = (distSq <= shouldLoadRadiusSq);
            }

            if (isVisible) {
                let hasInvisibleChild = false;
                for (let i = 0; i < node.children.length; i++) {
                    if (node.children[i] === null) {
                        // Null children are considered "invisible" (they're covered by this chunk.)
                        hasInvisibleChild = true;
                        continue;
                    }

                    traverseNode(node.children[i], true);
                    if (!node.children[i].renderInfo.shouldBeVisible)
                        hasInvisibleChild = true;
                }

                // If all children are visible, we're not visible.
                node.renderInfo.shouldBeVisible = hasInvisibleChild;
            } else {
                // If not in distance, then we should not be visible. Recursively set children invisible.
                for (let i = 0; i < node.children.length; i++) {
                    if (node.children[i] === null)
                        continue;
                    traverseNode(node.children[i], false);
                }

                node.renderInfo.shouldBeVisible = false;
            }
        }

        traverseNode(this.quadTreeRoot, true);
    }

    public setCameraPosition(x: number, z: number): void {
        this.setWorldPosition(x / WORLD_SCALE, z / WORLD_SCALE);
    }

    public buildQuadTree(i: number): QuadTreeNode {
        const areaInfo = this.tscb.areaInfos[i];

        const node = new QuadTreeNode();
        node.areaInfo = areaInfo;

        const hs = areaInfo.areaSize / 2;
        const qs = areaInfo.areaSize / 4;

        const x1 = areaInfo.x - qs, x2 = areaInfo.x + qs;
        const z1 = areaInfo.z - qs, z2 = areaInfo.z + qs;

        for (let j = i + 1; j < this.tscb.areaInfos.length; j++) {
            const possibleChild = this.tscb.areaInfos[j];
            if (possibleChild.areaSize > hs)
                continue;
            if (possibleChild.areaSize < hs)
                break;

            if (possibleChild.x === x1 && possibleChild.z === z1)
                node.children[0] = this.buildQuadTree(j);
            else if (possibleChild.x === x2 && possibleChild.z === z1)
                node.children[1] = this.buildQuadTree(j);
            else if (possibleChild.x === x1 && possibleChild.z === z2)
                node.children[2] = this.buildQuadTree(j);
            else if (possibleChild.x === x2 && possibleChild.z === z2)
                node.children[3] = this.buildQuadTree(j);
        }

        return node;
    }
}
