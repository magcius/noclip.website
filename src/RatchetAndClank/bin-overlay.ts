import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";

/*
'Overlay' is a custom dynamic linked library format
*/

export interface OverlaySectionHeader {
    addr: number;
    size: number;
    type: number;
    entry: number;
}
export function readOverlaySectionHeader(view: DataViewExt) {
    return {
        addr: view.getUint32(0x0),
        size: view.getUint32(0x4),
        type: view.getUint32(0x8),
        entry: view.getUint32(0xC),
    }
}

export interface OverlaySection {
    header: OverlaySectionHeader;
    data: DataViewExt;
}
export function readOverlaySections(view: DataViewExt): OverlaySection[] {
    /*
    struct {
        // 0x0
        Header header;
        // 0x10
        u8 data[header.size];
    } sections[until end of file];
    */
    const sections: OverlaySection[] = [];
    let ptr = 0;
    while (ptr < view.byteLength) {
        const header = readOverlaySectionHeader(view.subview(ptr));
        const data = view.subview(ptr + 0x10, header.size);
        sections.push({ header, data });
        ptr += 0x10 + header.size;
    }
    return sections;
}

// takes an overlay file and snips the last section off (which is the game code)
export function snipOverlay(view: DataViewExt): DataViewExt {
    const sectionCount = readOverlaySections(view).length;
    let i = 0;
    let ptr = 0;
    while (ptr < view.byteLength) {
        const header = readOverlaySectionHeader(view.subview(ptr));
        ptr += 0x10 + header.size;
        if (i >= sectionCount - 1) return view.subview(0, ptr);
        i++;
    }
    assert(false);
}

export function readOverlayVMem(sections: OverlaySection[], addr: number, size: number): DataViewExt {
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (addr >= section.header.addr && addr + size <= section.header.addr + section.header.size) {
            const offset = addr - section.header.addr;
            return section.data.subview(offset, size);
        }
    }
    assert(false);
}

export interface WaterMesh_KindA {
    descriptor: ReturnType<typeof readWaterMeshDescriptor_KindA>;
    positions: Float32Array;
    texcoords: Float32Array;
}
export function readWaterMesh_KindA(sections: OverlaySection[], addr: number): WaterMesh_KindA {
    const descriptor = readWaterMeshDescriptor_KindA(readOverlayVMem(sections, addr, SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A));
    const positions = readOverlayVMem(sections, descriptor.verticesVaddr, descriptor.vertexCount * 4 * 4).getTypedArrayView(Float32Array);
    const texcoords = readOverlayVMem(sections, descriptor.texcoordsVaddr, descriptor.vertexCount * 4 * 2).getTypedArrayView(Float32Array);
    return { descriptor, positions, texcoords };
}

export const SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A = 0x60;
export function readWaterMeshDescriptor_KindA(view: DataViewExt) {
    return {
        verticesVaddr: view.getUint32(0x0),
        texcoordsVaddr: view.getUint32(0x4),
        bphereVaddr: view.getUint32(0x8),
        vertexCount: view.getInt32(0xC),
        scrollSpeed1: view.getFloat32(0x10),
        scrollSpeed2: view.getFloat32(0x14),
        wobbleAmplitude: view.getFloat32(0x18),
        phaseStep: view.getInt32(0x1C),
        direction1: view.getFloat32_Xy(0x20),
        direction2: view.getFloat32_Xy(0x28),
        rgba: view.getUint8_Rgba(0x30),
        fxTexture1: view.getInt32(0x34),
        fxTexture2: view.getInt32(0x38),
        fix1: view.getUint8(0x3c),
        fix2: view.getUint8(0x3d),
        runtimeScroll1: view.getFloat32_Xy(0x40),
        runtimeScroll2: view.getFloat32_Xy(0x48),
        phase: view.getInt32(0x50),
        zBlend: view.getFloat32(0x5C),
    }
}

export interface WaterMesh_KindB {
    descriptor: ReturnType<typeof readWaterMeshDescriptor_KindB>,
    vertexCount: number;
    positions: DataViewExt;
    texcoords: DataViewExt;
}
export function readWaterMeshes_KindB(sections: OverlaySection[], addrs: number, count: number): WaterMesh_KindB[] {
    const meshes: WaterMesh_KindB[] = [];
    for (let i = 0; i < count; i++) {
        const addr = addrs + i * SIZEOF_WATER_MESH_DESCRIPTOR_KIND_B;
        const descriptor = readWaterMeshDescriptor_KindB(readOverlayVMem(sections, addr, SIZEOF_WATER_MESH_DESCRIPTOR_KIND_B));
        const vertexCount = descriptor.stripStarts[descriptor.stripCount];
        const positions = readOverlayVMem(sections, descriptor.verticesVaddr, vertexCount * 4 * 3);
        const texcoords = readOverlayVMem(sections, descriptor.texcoordsVaddr, vertexCount * 4 * 2);
        meshes.push({
            descriptor,
            vertexCount,
            positions,
            texcoords,
        });
    }
    return meshes;
}

export const SIZEOF_WATER_MESH_DESCRIPTOR_KIND_B = 0x40;
export function readWaterMeshDescriptor_KindB(view: DataViewExt) {
    return {
        bsphere: view.getFloat32_Xyzw(0x00),
        verticesVaddr: view.getUint32(0x10),
        texcoordsVaddr: view.getUint32(0x14),
        unknown18: view.getUint32(0x18),
        stripCount: view.getInt32(0x1C),
        stripStarts: view.getArrayOfNumbers(0x20, 16, Int16Array),
    }
}

export interface WaterMesh_KindC {
    descriptor: ReturnType<typeof readWaterMeshDescriptor_KindC>,
    positions: DataViewExt;
    texcoords: DataViewExt;
    normals: DataViewExt | null;
}
export const readWaterMeshes_KindC = (sections: OverlaySection[], addrs: number, count: number, hasNormals: boolean): WaterMesh_KindC[] => {
    const meshes: WaterMesh_KindC[] = [];
    for (let i = 0; i < count; i++) {
        const addr = addrs + i * SIZEOF_WATER_MESH_DESCRIPTOR_KIND_C;
        const descriptor = readWaterMeshDescriptor_KindC(readOverlayVMem(sections, addr, SIZEOF_WATER_MESH_DESCRIPTOR_KIND_C));
        const positions = readOverlayVMem(sections, descriptor.positionsVaddr, descriptor.vertexCount * 4 * 3);
        const texcoords = readOverlayVMem(sections, descriptor.texcoordsVaddr, descriptor.vertexCount * 4 * 2);
        const normals = hasNormals ? readOverlayVMem(sections, descriptor.normalsVaddr, descriptor.vertexCount * 4 * 3) : null;
        meshes.push({
            descriptor,
            positions,
            texcoords,
            normals,
        });
    }
    return meshes;
}

export const SIZEOF_WATER_MESH_DESCRIPTOR_KIND_C = 0x20;
export function readWaterMeshDescriptor_KindC(view: DataViewExt) {
    return {
        bsphere: view.getFloat32_Xyzw(0x00),
        positionsVaddr: view.getUint32(0x10),
        texcoordsVaddr: view.getUint32(0x14),
        normalsVaddr: view.getUint32(0x18),
        vertexCount: view.getInt32(0x1C),
    };
}

export interface WaterMesh_KindD {
    stripCount: number;
    uvScrollSpeeds: { x: number; y: number }[];
    vertexCounts: number[];
    positions: DataViewExt[];
    texcoords: DataViewExt[];
    colors: DataViewExt[];
}
export const readWaterMeshes_KindD = (sections: OverlaySection[], positionsVaddr: number, texcoordsVaddr: number, colorsVaddr: number, vertexCountsVaddr: number, uvScrollSpeedVaddr: number, uvScrollSpeedCount: number, count: number): WaterMesh_KindD => {
    // input addresses point to arrays of pointers (except count which is an array of ints)
    const waterMeshes: WaterMesh_KindD = {
        stripCount: count,
        uvScrollSpeeds: [],
        vertexCounts: [],
        positions: [],
        texcoords: [],
        colors: [],
    }
    for (let i = 0; i < uvScrollSpeedCount; i++) {
        waterMeshes.uvScrollSpeeds.push(readOverlayVMem(sections, uvScrollSpeedVaddr + i * 8, 8).getFloat32_Xy(0));
    }
    for (let i = 0; i < count; i++) {
        const vertexCount = readOverlayVMem(sections, vertexCountsVaddr + i * 4, 4).getInt32(0);
        waterMeshes.vertexCounts.push(vertexCount);
        const positionsIndirectVaddr = readOverlayVMem(sections, positionsVaddr + i * 4, 4).getUint32(0);
        const texcoordsIndirectVaddr = readOverlayVMem(sections, texcoordsVaddr + i * 4, 4).getUint32(0);
        const colorsIndirectVaddr = readOverlayVMem(sections, colorsVaddr + i * 4, 4).getUint32(0);
        waterMeshes.positions.push(readOverlayVMem(sections, positionsIndirectVaddr, vertexCount * 4 * 3));
        waterMeshes.texcoords.push(readOverlayVMem(sections, texcoordsIndirectVaddr, vertexCount * 4 * 2));
        waterMeshes.colors.push(readOverlayVMem(sections, colorsIndirectVaddr, vertexCount * 4));
    }
    return waterMeshes;
}

export interface WaterGrid_KindE {
    descriptor: ReturnType<typeof readWaterGridDescriptor_KindE>;
    data: DataViewExt;
}

export const SIZEOF_WATER_GRID_KIND_E = 0x1190;

// reads one item from the arrays (each moby instance usually only cares about one entry)
export function readWaterGrid_KindE(sections: OverlaySection[], dataVaddr: number, maskVaddr: number | null, maskStride: number = 2, index: number): WaterGrid_KindE {
    const gridVaddr = dataVaddr + index * SIZEOF_WATER_GRID_KIND_E;
    const view = readOverlayVMem(sections, gridVaddr, SIZEOF_WATER_GRID_DESCRIPTOR_KIND_E);
    const descriptor = readWaterGridDescriptor_KindE(view);
    if (maskVaddr !== null) {
        descriptor.activeMask = readOverlayVMem(sections, maskVaddr + index * maskStride, 2).getUint16(0);
    } else {
        descriptor.activeMask = 0xFFFF;
    }
    const data = readOverlayVMem(sections, gridVaddr + SIZEOF_WATER_GRID_DESCRIPTOR_KIND_E, SIZEOF_WATER_GRID_KIND_E - SIZEOF_WATER_GRID_DESCRIPTOR_KIND_E);
    return { descriptor, data };
}

export const SIZEOF_WATER_GRID_DESCRIPTOR_KIND_E = 0x50;
export function readWaterGridDescriptor_KindE(view: DataViewExt) {
    return {
        center: view.getFloat32_Xyz(0x00),
        links: view.getArrayOfNumbers(0x0c, 8, Uint8Array),
        fxEnv: view.getInt32(0x14),
        fxWater: view.getInt32(0x18),
        fixEnv: view.getUint8(0x1C),
        fixWater: view.getUint8(0x1D),
        activeMask: view.getUint16(0x1E),
        uvScroll: view.getFloat32_Xy(0x20),
        uvSpeed: view.getFloat32_Xy(0x28),
        wobbleAngle: view.getFloat32_Xy(0x30),
        wobbleStep: view.getFloat32_Xy(0x38),
        wobbleRadius: view.getFloat32(0x40),
        edgePins: view.getUint32(0x44),
    }
}

export interface WaterGrid_KindF {
    descriptor: ReturnType<typeof readWaterGrid_KindF>;
    mask: DataViewExt;
};

const SIZEOF_WATER_GRID_KIND_F = 0x40;
export function readWaterGrid_KindF(sections: OverlaySection[], dataVaddr: number) {
    const view = readOverlayVMem(sections, dataVaddr, SIZEOF_WATER_GRID_KIND_F);

    const descriptor = {
        origin: view.getFloat32_Xyz(0x00),
        cullDistSquared: view.getFloat32(0x0C),
        cellSize: view.getFloat32_Xy(0x10),
        cellsX: view.getUint16(0x18),
        cellsY: view.getUint16(0x1A),
        generatedTextureVaddr: view.getUint32(0x1C),
        fogNear: view.getFloat32(0x20),
        fogFar: view.getFloat32(0x24),
        fogNearIntensity: view.getFloat32(0x28),
        fogFarIntensity: view.getFloat32(0x2C),
        fogColor: view.getUint8_Rgb(0x30),
        ticksPerFrame: view.getUint8(0x33),
        colorsVaddr: view.getUint32(0x34),
        maskVaddr: view.getUint32(0x38),
        firstFx: view.getUint16(0x3C),
        frameCount: view.getUint8(0x3E),
        fix: view.getUint8(0x3F),
    };

    const maskSize = (descriptor.cellsX / 7) * (descriptor.cellsY / 7);

    return {
        descriptor,
        mask: readOverlayVMem(sections, descriptor.maskVaddr, maskSize),
    };
}

export function readWaterMesh_KindG(sections: OverlaySection[], positionVaddr: number, texcoordsVaddr: number, vertexCount: number, scale: number) {
    const positions = readOverlayVMem(sections, positionVaddr, vertexCount * 0x0C).getTypedArrayView(Float32Array);
    const texcoords = readOverlayVMem(sections, texcoordsVaddr, vertexCount * 0x08).getTypedArrayView(Float32Array);

    return {
        positions,
        texcoords,
        scale
    };
}

export interface WaterMesh_KindH {
    quadCount: number;
    positions: { x: number; y: number; z: number }[];
    texcoords: { x: number; y: number }[];
}
export function readWaterMesh_KindH(sections: OverlaySection[], vertexRecordsVaddr: number, quadIndicesVaddr: number, texcoordsVaddr: number, quadCount: number): WaterMesh_KindH {
    const indicesView = readOverlayVMem(sections, quadIndicesVaddr, quadCount * 8 * 2);
    const positionIndices: number[] = [];
    const texcoordIndices: number[] = [];

    // find max index value for positions and texcoords
    let positionCount = 0;
    let texcoordCount = 0;
    for (let i = 0; i < quadCount * 4; i++) {
        const positionIndex = indicesView.getUint16(i * 4);
        const texcoordIndex = indicesView.getUint16(i * 4 + 2);
        positionIndices.push(positionIndex);
        texcoordIndices.push(texcoordIndex);
        positionCount = Math.max(positionCount, positionIndex + 1);
        texcoordCount = Math.max(texcoordCount, texcoordIndex + 1);
    }

    // remove index buffer
    // we cannot use use two interleaved index buffers...
    const positionRecords = readOverlayVMem(sections, vertexRecordsVaddr, positionCount * 0x10)
        .subdivide(0, positionCount, 0x10)
        .map(view => view.getFloat32_Xyz(0));
    const texcoordRecords = readOverlayVMem(sections, texcoordsVaddr, texcoordCount * 0x08)
        .subdivide(0, texcoordCount, 0x08)
        .map(view => view.getFloat32_Xy(0));
    const positions = [];
    const texcoords = [];
    for (let quad = 0; quad < quadCount; quad++) {
        for (let corner = 0; corner < 4; corner++) {
            const index = quad * 4 + corner;
            positions.push(positionRecords[positionIndices[index]]);
            texcoords.push(texcoordRecords[texcoordIndices[index]]);
        }
    }

    return { quadCount, positions, texcoords };
}
