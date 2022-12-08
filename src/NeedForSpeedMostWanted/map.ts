import { vec2 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { DataFetcher } from '../DataFetcher';
import { AABB } from '../Geometry';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { assert } from '../util';
import { NfsNode, NodeType } from './datanode';
import { NfsRegion, NfsModel, NfsTexture, DataSection, RegionType } from './region';

export class NfsMap {
    public regions: {[id: number]: NfsRegion};
    public modelCache: {[id: number]: NfsModel} = { };
    public textureCache: {[id: number]: NfsTexture} = { };
    public ingameStreamingMode: boolean = false;
    private pathVertices: PathVertex[];
    private regionsToRender: Set<NfsRegion> = new Set<NfsRegion>();
    private regionOverridesIn: {[id: number]: RegionRenderOverride} = { };
    private regionOverridesVisible: {[id: number]: RegionRenderOverride} = { };

    private viewDistance: number = 500;

    public constructor(public dataFetcher: DataFetcher, public streamingFilePath: string) {
        regionOverrides.forEach(override => {
            override.regionsIn?.forEach(r => this.regionOverridesIn[r] = override);
            override.regionsVisible?.forEach(r => this.regionOverridesVisible[r] = override);
        });
    }

    public async parse(device: GfxDevice, renderHelper: GfxRenderHelper, baseFile: ArrayBufferSlice, ...otherFiles: ArrayBufferSlice[]) {
        const baseFileNode = new NfsNode(baseFile);
        baseFileNode.parseChildren();
        otherFiles.forEach(file => {
            const fileNode = new NfsNode(file);
            fileNode.parseChildren();
            const region: NfsRegion = new NfsRegion(2601);
            region.dataSections = [{node: fileNode, length: file.byteLength, offset: 0}];
            region.parseTextures(device, renderHelper, this);
            region.parseModels(device, this);
        });
        const regionDefNode = baseFileNode.children.filter(node => node.type == NodeType.RegionDefinitions)[0];
        const dataSectionDefNode = baseFileNode.children.filter(node => node.type == NodeType.DataSectionDefinitions)[0];
        this.regions = this.parseRegions(regionDefNode, dataSectionDefNode);
        const pathNode = baseFileNode.children.filter(node => node.type == NodeType.AiPaths)[0];
        this.pathVertices = this.parsePathVertices(pathNode);

        // Load global data sections immediately
        await this.regions[2500].load(this);
        const globalRegions = [];
        for(let id in this.regions) {
            if(this.regions[id].regionType == RegionType.Global)
                globalRegions.push(this.regions[id]);
        }
        let coll = globalRegions.map(async region => {
            await region.load(this);
            region.parseTextures(device, renderHelper, this)
        });
        await Promise.all(coll);

        globalRegions.forEach(region => region.parseModels(device, this));
        globalRegions.forEach(region => region.parseInstances(this));
    }

    private parseRegions(regionDefNode: NfsNode, dataSectionNode: NfsNode) {
        const regionMap: {[id: number]: NfsRegion} = {};

        // Read data section definitions
        let offset = 0;
        const dsnDataView = dataSectionNode.dataView;
        const dataSections: {[id: number]: DataSection} = {};
        while(offset < dsnDataView.byteLength) {
            const dataSection: DataSection = {
                offset: dsnDataView.getInt32(offset + 0x14, true),
                length: dsnDataView.getInt32(offset + 0x18, true)
            };
            const regionId = dsnDataView.getInt32(offset + 8, true);
            // Put in separate list first to make sure they're ordered by region ID
            dataSections[regionId] = dataSection;
            offset += 0x5C;
        }
        for(const regionId in dataSections) {
            const baseRegionId = toBaseRegionId(Number(regionId));
            if(!(baseRegionId in regionMap)) {
                regionMap[baseRegionId] = new NfsRegion(baseRegionId);
            }
            regionMap[baseRegionId].dataSections.push(dataSections[regionId]);
        }

        // Read region boundaries
        offset = 0;
        const rbnDataView = regionDefNode.children[1].dataView;
        while(offset < rbnDataView.byteLength) {
            const regionId = rbnDataView.getInt16(offset + 8, true);
            if(!(regionId in regionMap)) {
                regionMap[regionId] = new NfsRegion(regionId);
            }
            const region = regionMap[regionId];
            region.boundingBox = new AABB(
                rbnDataView.getFloat32(offset + 0xC, true), rbnDataView.getFloat32(offset + 0x10, true), Infinity,
                rbnDataView.getFloat32(offset + 0x14, true), rbnDataView.getFloat32(offset + 0x18, true), -Infinity
            );
            const vertexCount = rbnDataView.getUint8(offset + 0xA);
            const areaVertices: vec2[] = [];
            offset += 0x24;
            for(let i = 0; i < vertexCount; i++) {
                areaVertices.push([ rbnDataView.getFloat32(offset, true), rbnDataView.getFloat32(offset + 4, true) ]);
                offset += 8;
            }
            region.areaVertices = areaVertices;
        }

        // Read region dependencies
        offset = 0;
        const rdnDataView = regionDefNode.children[3].dataView;
        while(offset < rdnDataView.byteLength - 0x10) {
            // Skip useless data at start of entry
            while(rdnDataView.getInt16(offset) == 0) {
                offset += 2;
            }
            offset += 0xC;
            const regionId = toBaseRegionId(rdnDataView.getInt16(offset, true));
            const depCount = rdnDataView.getInt16(offset + 4, true);
            const region = regionMap[regionId];
            assert(region !== undefined);
            const dependentRegions: number[] = [];
            offset += 6;
            for(let i = 0; i < depCount; i++) {
                dependentRegions.push(rdnDataView.getInt16(offset, true));
                offset += 2;
            }
            const dependencies: NfsRegion[] = [];
            const connections: RegionConnections[] = [];
            for(let i = 0; i < depCount; i++) {
                const depRegionId = dependentRegions[i];
                const baseRegionId = toBaseRegionId(depRegionId);
                const baseRegion = regionMap[baseRegionId];
                if(baseRegion === undefined)
                    continue;
                if(baseRegion.regionType == RegionType.Dependency) {
                    dependencies.push(baseRegion);
                    continue;
                }
                if(baseRegionId == depRegionId) {
                    connections.push({region: baseRegion, upperPartOnly: false});
                }
                else if(!dependentRegions.includes(baseRegionId)) {
                    connections.push({region: baseRegion, upperPartOnly: true});
                }
            }
            region.connections = connections;
            region.dependencies = dependencies;
        }

        return regionMap;
    }

    public getRegionsToRender(pos: vec2, activeRegion: NfsRegion): RegionConnections[] {
        if(this.ingameStreamingMode)
            return activeRegion.connections!;

        this.regionsToRender.clear();
        activeRegion.connections!.forEach((r => this.regionsToRender.add(r.region)));
        for(const regionId in this.regions) {
            const r = this.regions[regionId];
            if(r.regionType == RegionType.Regular && isCloseToRegion(r, pos, this.viewDistance))
            this.regionsToRender.add(r);
        }

        const thisRegionOverride = this.regionOverridesIn[activeRegion.id];
        if(thisRegionOverride !== undefined) {
            thisRegionOverride.forceHide?.forEach(r => this.regionsToRender.delete(this.regions[r]));
            thisRegionOverride.forceShow?.forEach(r => this.regionsToRender.add(this.regions[r]));
        }
        this.regionsToRender.forEach(r => {
            const overrides = this.regionOverridesVisible[r.id];
            if(overrides === undefined)
                return;
            overrides.forceHide?.forEach(r => this.regionsToRender.delete(this.regions[r]));
            overrides.forceShow?.forEach(r => this.regionsToRender.add(this.regions[r]));
        });

        return Array.from(this.regionsToRender).map(r => {return {region: r, upperPartOnly: false}});
    }

    public getClosestPathVertex(pos: vec2): PathVertex {
        // The game decides which regions to load based on the current camera position.
        // However, moving out of bounds leads to weird behaviour since the camera is usually not supposed to be there.
        // Therefore I snap the assumed camera position to the nearest AI pathfinding vertex (which will always be on a road).

        let closest = Infinity;
        let closestIndex = -1;
        for(let i = 0; i < this.pathVertices.length; i++) {
            let distSquared = vec2.sqrDist(this.pathVertices[i].position, pos);
            if(distSquared < closest) {
                closest = distSquared;
                closestIndex = i;
            }
        }
        return this.pathVertices[closestIndex];
    }

    private parsePathVertices(pathNode: NfsNode): PathVertex[] {
        const pathDataView = pathNode.dataView;
        let offset = pathDataView.getInt32(0x7c, true) + 0x70;
        const vertCount = pathDataView.getInt16(offset + 2, true);
        offset += 0x10;
        const pathVertices: PathVertex[] = [];
        let lastRegion = undefined;
        for(let i = 0; i < vertCount; i++) {
            const position: vec2 = [
                pathDataView.getFloat32(offset + 8, true),
                -pathDataView.getFloat32(offset, true)
            ];
            offset += 0x20;
            const region: NfsRegion = this.getRegionFromPoint(position, lastRegion);
            lastRegion = region;
            pathVertices.push({position, region});
        }
        return pathVertices;
    }

    private getRegionFromPoint(pos: vec2, lastRegion?: NfsRegion): NfsRegion {
        if(lastRegion) {
            // First check if we're still in the same region
            if(pointInRegion(lastRegion, pos))
            return lastRegion;

            // Then check if we're in any of the neighboring regions
            for(let i = 0; i < lastRegion.connections!.length; i++) {
            const r = lastRegion.connections![i];
            if(r.region.regionType == RegionType.Regular && pointInRegion(r.region, pos))
                return r.region;
            }
        }

        // Otherwise check in all regions
        for(let id in this.regions) {
            const r = this.regions[id];
            if(r.regionType == RegionType.Regular && pointInRegion(r, pos))
                return r;
        }
        throw 'Path vertex not in any region';
    }

    public destroy(device: GfxDevice) {
        for(const modelId in this.modelCache) {
            this.modelCache[modelId].destroy(device);
        }
        for(const textureId in this.textureCache) {
            this.textureCache[textureId].destroy(device);
        }
    }
}

export type RegionConnections = {
    region: NfsRegion,
    upperPartOnly: boolean
}

interface RegionRenderOverride {
    regionsIn?: number[];
    regionsVisible?: number[];
    forceShow?: number[];
    forceHide?: number[];
}

// My custom streaming method looks a bit ugly in some parts of the map so here are a few tweaks where certain regions
// are forced to be shown/hidden based on either the region you're in or other regions that are currently visible.
const regionOverrides: RegionRenderOverride[] = [
    // Oceans
    { regionsVisible: [ 416, 1814, 1813, 1836, 1637, 1709, 1625, 1915 ], forceShow: [1888, 1889, 1891]},
    { regionsVisible: [ 1888, 1889, 1891 ], forceShow: [1888, 1889, 1891]},

    // Shipyard
    { regionsIn: [416, 1815], forceHide: [ 1896 ], forceShow: [ 1913, 1813, 1620, 1830, 1920, 1537, 1911 ] },
    { regionsVisible: [ 1627 ], forceShow: [ 1599 ] },
    { regionsVisible: [ 1510 ], forceShow: [ 1882 ] },

    // Lighthouse Island
    { regionsIn: [ 1630 ], forceHide: [ 1892 ], forceShow: [ 1584 ] },
    { regionsVisible: [ 1583 ], forceHide: [ 1895 ], forceShow: [ 1629, 1630, 1920 ]},

    // Refinery
    { regionsIn: [1704], forceHide: [1594]},
]

function toBaseRegionId(id: number) {
    if(id < 2200 && id % 100 > 40 && id % 100 < 80)
        return id - 40;
    return id;
}

function pointInRegion(r: NfsRegion, p: vec2): boolean {
    if(r.boundingBox === undefined)
        return false;
    if(p[0] < r.boundingBox!.minX || p[1] < r.boundingBox!.minY || p[0] > r.boundingBox!.maxX || p[1] > r.boundingBox!.maxY)
        return false;

    return pointInPolygon(r.areaVertices!, p);
}

function pointInPolygon(vertices: vec2[], p: vec2): boolean {
    let count = 0;
    let i = 0;
    const infPoint: vec2 = [100000, p[1]];
    do {
        const next = (i + 1) % vertices.length;
        if(linesIntersect(vertices[i], vertices[next], p, infPoint)) {
            if(orientation(vertices[i], p, vertices[next]) == 0) {
                return onSegment(vertices[i], p, vertices[next]);
            }
            count++;
        }
        i = next;
    } while(i != 0);
    return (count % 2) == 1;
}

function linesIntersect(a1: vec2, b1: vec2, a2: vec2, b2: vec2) {
    const o1 = orientation(a1, b1, a2);
    const o2 = orientation(a1, b1, b2);
    const o3 = orientation(a2, b2, a1);
    const o4 = orientation(a2, b2, b1);

    if(o1 != o2 && o3 != o4)
        return true;

    return o1 == 0 && onSegment(a1, b1, a2)
        || o2 == 0 && onSegment(a1, b1, b2)
        || o3 == 0 && onSegment(a2, b2, a1)
        || o4 == 0 && onSegment(a2, b2, b1);
}

function orientation(a: vec2, b: vec2, c: vec2) {
    const val = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if(val == 0)
        return 0;
    return (val > 0) ? 1 : 2;
}

function onSegment(a: vec2, b: vec2, c: vec2) {
    return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.max(a[0], c[0]) &&
        b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

export function isCloseToRegion(r: NfsRegion, p: vec2, distance: number): boolean {
    if(r.boundingBox === undefined)
        return false;
    if(distanceToRegionBoundingBox(r.boundingBox!, p) > distance)
        return false;

    return distanceToRegionPolygon(r.areaVertices!, p) <= distance;
}

export function distanceToRegionBoundingBox(aabb: AABB, p: vec2) {
    if(aabb === undefined)
        return Infinity;
    if(p[0] > aabb.minX && p[1] > aabb.minY && p[0] < aabb.maxX && p[1] < aabb.maxY)
        return 0;
    if(p[0] < aabb.minX) {
        if(p[1] < aabb.minY)
            return vec2.dist(p, [aabb.minX, aabb.minY]);
        else if(p[1] > aabb.maxY)
            return vec2.dist(p, [aabb.minX, aabb.maxY]);
        else
            return aabb.minX - p[0];
    }
    else if(p[0] > aabb.maxX) {
        if(p[1] < aabb.minY)
            return vec2.dist(p, [aabb.maxX, aabb.minY]);
        else if(p[1] > aabb.maxY)
            return vec2.dist(p, [aabb.maxX, aabb.maxY]);
        else
            return p[0] - aabb.maxX;
    }
    else if(p[1] < aabb.minY) {
        return aabb.minY - p[1];
    }
    else {
        return p[1] - aabb.maxY;
    }
}

function distanceToRegionPolygon(poly: vec2[], p: vec2): number {
    if(poly === undefined)
        return Infinity;

    let minDist = Infinity;
    let i = 0;
    do {
        const next = (i + 1) % poly.length;
        const x = vec2.dot([poly[next][0] - poly[i][0], poly[next][1] - poly[i][1]], p) / vec2.dist(poly[i], poly[next]);
        const s: vec2 = x <= 0 ? poly[i] : x >= 1 ? poly[next] : [(poly[next][0] - poly[i][0]) * x, (poly[next][1] - poly[i][1]) * x];
        const d = vec2.dist(s, p);
        if(d < minDist)
            minDist = d;
        i = next
    } while(i != 0);
    return minDist;
}

export type PathVertex = {
    position: vec2,
    region: NfsRegion
};
