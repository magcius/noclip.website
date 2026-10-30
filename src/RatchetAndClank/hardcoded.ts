import { vec3 } from "gl-matrix";
import { OverlaySection, readWaterGrid_KindE, readWaterGrid_KindF, readWaterMesh_KindA, readWaterMeshes_KindB, readWaterMeshes_KindC, readWaterMeshes_KindD, SIZEOF_WATER_GRID_KIND_E, SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A } from "./bin-overlay";
import { getBits, noclipSpaceFromRatchetSpace } from "./utils";
import { White } from "../Color";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { assert } from "../util";

export const RAC1_SKY_ROTATION = new Map([
    [9, [{ shell: 3, rotation: { x: 0, y: 0.3, z: 0 } }]],
]);

const ySpin = (v: number) => ({
    x: 0,
    y: 0,
    z: 2 * Math.PI * 60 * v * 0x100
});

export const RAC1_SKY_ANGULAR_VELOCITY = new Map([
    [0, [{ shell: 3, angularVelocity: ySpin(1 / 0x8000) }]],
    [1, [
        { shell: 2, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 4, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [3, [
        { shell: 1, angularVelocity: ySpin(1 / 0x10000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
    ]],
    [4, [
        { shell: 1, angularVelocity: ySpin(1 / 0x10000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
    ]],
    [5, [{ shell: 1, angularVelocity: ySpin(1 / 50000) }]],
    [7, [{ shell: 2, angularVelocity: ySpin(1 / 50000) }]],
    [8, [{ shell: 1, angularVelocity: ySpin(1 / 40000) }]],
    [9, [{ shell: 3, angularVelocity: ySpin(1 / 25000) }]],
    [10, [
        { shell: 0, angularVelocity: ySpin(1 / (0x20000 * 2)) },
        { shell: 1, angularVelocity: ySpin(1 / (0x20000 * 5)) },
        { shell: 2, angularVelocity: ySpin(1 / (0x40000 * 10)) },
        { shell: 3, angularVelocity: ySpin(1 / (0x20000 * 10)) },
    ]],
    [11, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [12, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [14, [
        { shell: 1, angularVelocity: ySpin(1 / 50000) },
        { shell: 2, angularVelocity: ySpin(1 / 100000) },
    ]],
    [16, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [18, [
        { shell: 4, angularVelocity: ySpin(1 / 40000) },
        { shell: 5, angularVelocity: ySpin(1 / 60000) },
    ]],
]);

const RAC1_WATER_KIND_A = new Map<number, { vaddr: number; count: number }[]>([
    [1, [
        { vaddr: 0x1e2fc0, count: 8 },
        { vaddr: 0x1e3380, count: 2 },
        { vaddr: 0x1fbc80, count: 4 },
        { vaddr: 0x202d80, count: 3 },
    ]],
]);

const RAC1_WATER_KIND_B = new Map<number, { vaddr: number; count: number }[]>([
    [9, [
        { vaddr: 0x1f3080, count: 108 },
    ]],
]);

const RAC1_WATER_KIND_C = new Map<number, { vaddr: number; count: number; hasNormals: boolean }[]>([
    [9, [{ vaddr: 0x1f63c0, count: 10, hasNormals: false }]],
    [12, [{ vaddr: 0x1f5480, count: 47, hasNormals: true }]],
    [14, [{ vaddr: 0x1f5f80, count: 19, hasNormals: true }]],
]);

const RAC1_WATER_KIND_D = new Map<number, { positionsVaddr: number; texcoordsVaddr: number; ambientVaddr: number; vertexCountsVaddr: number; count: number }[]>([
    [12, [
        { positionsVaddr: 0x2059e0, texcoordsVaddr: 0x205a08, ambientVaddr: 0x205a58, vertexCountsVaddr: 0x1fbd10, count: 10 },
        { positionsVaddr: 0x208a98, texcoordsVaddr: 0x208ab0, ambientVaddr: 0x208ae0, vertexCountsVaddr: 0x205a80, count: 5 },
    ]],
]);

const RAC1_WATER_KIND_E = new Map<number, { dataVaddr: number; masksVaddr: number | null; maskSize: number; count: number }>([
    [1, { dataVaddr: 0x1e34c0, masksVaddr: 0x1fa590, maskSize: 4, count: 21 }],
    [5, { dataVaddr: 0x1d6880, masksVaddr: 0x20b380, maskSize: 2, count: 48 }],
    [7, { dataVaddr: 0x1dce40, masksVaddr: 0x204680, maskSize: 2, count: 36 }],
    [11, { dataVaddr: 0x1da880, masksVaddr: null, maskSize: 2, count: 20 }],
    [12, { dataVaddr: 0x1cbf40, masksVaddr: null, maskSize: 2, count: 17 }],
    [13, { dataVaddr: 0x1d9bc0, masksVaddr: 0x1f1e20, maskSize: 2, count: 22 }],
]);

const RAC1_WATER_KIND_F = new Map<number, { vaddrs: number[] }>([
    [2, { vaddrs: [0x1f3c00, 0x1f3cd0, 0x1f3d30, 0x1f3d90, 0x1f3dd0, 0x1f3e10, 0x1f3c60] }],
    [3, { vaddrs: [0x1dc1a0] }],
    [5, { vaddrs: [0x211b20] }],
    [7, { vaddrs: [0x1d3400, 0x208560] }],
    [8, { vaddrs: [0x1d7060] }],
    [9, { vaddrs: [0x1fc740] }],
    [14, { vaddrs: [0x1e9c60] }],
]);

export function renderWaterMeshes_KindA(sections: OverlaySection[], vaddr: number, count: number, renderHelper: GfxRenderHelper) {
    for (let i = 0; i < count; i++) {
        const waterMesh = readWaterMesh_KindA(sections, vaddr + i * SIZEOF_WATER_MESH_DESCRIPTOR_KIND_A);
        const positions = waterMesh.positions.subdivide(0, 0xFFFF, 0x10).map(view => view.getFloat32_Xyz(0));

        for (let j = 0; j < positions.length; j++) {
            const pos = vec3.fromValues(positions[j].x, positions[j].y, positions[j].z);
            vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
            renderHelper.debugDraw.drawLocator(pos, 0.3, White);
        }
    }
}

export function renderWaterMeshes_KindB(sections: OverlaySection[], vaddr: number, count: number, renderHelper: GfxRenderHelper) {
    const waterMeshes = readWaterMeshes_KindB(sections, vaddr, count);
    for (let i = 0; i < waterMeshes.length; i++) {
        const waterMesh = waterMeshes[i];
        const positions = waterMesh.positions.subdivide(0, 0xFFFF, 4 * 3).map(view => view.getFloat32_Xyz(0));
        for (let j = 0; j < waterMesh.descriptor.stripCount; j++) {
            let vertexPtr = waterMesh.descriptor.stripStarts[j];
            while (vertexPtr !== waterMesh.descriptor.stripStarts[j + 1]) {
                const pos = vec3.fromValues(positions[vertexPtr].x, positions[vertexPtr].y, positions[vertexPtr].z);
                vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                vertexPtr++;
            }
        }
    }
}

export function renderWaterMeshes_KindC(sections: OverlaySection[], addrs: number, count: number, hasNormals: boolean, renderHelper: GfxRenderHelper) {
    const waterMeshes = readWaterMeshes_KindC(sections, addrs, count, hasNormals);
    for (let i = 0; i < waterMeshes.length; i++) {
        const waterMesh = waterMeshes[i];
        const positions = waterMesh.positions.subdivide(0, 0xFFFF, 4 * 3).map(view => view.getFloat32_Xyz(0));
        for (let j = 0; j < positions.length; j++) {
            const pos = vec3.fromValues(positions[j].x, positions[j].y, positions[j].z);
            vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
            renderHelper.debugDraw.drawLocator(pos, 0.3, White);
        }
    }
}

export function renderWaterMeshes_KindD(sections: OverlaySection[], positionsVaddr: number, texcoordsVaddr: number, ambientVaddr: number, vertexCountsVaddr: number, count: number, renderHelper: GfxRenderHelper) {
    const waterMesh = readWaterMeshes_KindD(sections, positionsVaddr, texcoordsVaddr, ambientVaddr, vertexCountsVaddr, count);
    for (let i = 0; i < waterMesh.stripCount; i++) {
        const vertexCount = waterMesh.vertexCounts[i];
        const positions = waterMesh.positions[i].subdivide(0, 0xFFFF, 4 * 3).map(view => view.getFloat32_Xyz(0));
        for (let j = 0; j < vertexCount; j++) {
            const pos = vec3.fromValues(positions[j].x, positions[j].y, positions[j].z);
            vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
            renderHelper.debugDraw.drawLocator(pos, 0.3, White);
        }
    }
}

export function renderWaterGrid_KindE(sections: OverlaySection[], dataVaddr: number, maskVaddr: number | null, renderHelper: GfxRenderHelper) {
    const waterGrid = readWaterGrid_KindE(sections, dataVaddr, maskVaddr);
    const basePosition = waterGrid.descriptor.center;

    for (let sx = 0; sx < 4; sx++) {
        for (let sy = 0; sy < 4; sy++) {
            const subblock = (sy << 2) | sx;
            if ((waterGrid.descriptor.activeMask & (1 << subblock)) === 0) continue;
            for (let x = 0; x <= 4; x++) {
                for (let y = 0; y <= 4; y++) {
                    const pos = vec3.fromValues(
                        basePosition.x - 8 + sx * 4 + x,
                        basePosition.y - 8 + sy * 4 + y,
                        basePosition.z
                    );
                    vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                    renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                }
            }
        }
    }
}

export function renderWaterGrid_KindF(sections: OverlaySection[], dataVaddr: number, renderHelper: GfxRenderHelper) {
    const waterGrid = readWaterGrid_KindF(sections, dataVaddr);

    const basePosition = waterGrid.descriptor.origin;

    assert(waterGrid.descriptor.cellsX % 7 == 0);
    assert(waterGrid.descriptor.cellsY % 7 == 0);

    const blockCountX = waterGrid.descriptor.cellsX / 7;
    const blockCountY = waterGrid.descriptor.cellsY / 7;

    for (let sx = 0; sx < blockCountX; sx++) {
        for (let sy = 0; sy < blockCountY; sy++) {
            const subblock = sy * blockCountX + sx;
            if (waterGrid.mask.getUint8(subblock) === 0) continue;
            for (let x = 0; x <= 7; x++) {
                for (let y = 0; y <= 7; y++) {
                    const pos = vec3.fromValues(
                        basePosition.x + (sx * 7 + x) * waterGrid.descriptor.cellSize.x,
                        basePosition.y + (sy * 7 + y) * waterGrid.descriptor.cellSize.y,
                        basePosition.z
                    );
                    vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                    renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                }
            }
        }
    }
}

export function renderWaterMeshes_Rac1(levelNumber: number, sections: OverlaySection[], renderHelper: GfxRenderHelper) {
    const kindA = RAC1_WATER_KIND_A.get(levelNumber);
    if (kindA) {
        for (const { vaddr, count } of kindA)
            renderWaterMeshes_KindA(sections, vaddr, count, renderHelper);
    }

    const kindB = RAC1_WATER_KIND_B.get(levelNumber);
    if (kindB) {
        for (const { vaddr, count } of kindB)
            renderWaterMeshes_KindB(sections, vaddr, count, renderHelper);
    }

    const kindC = RAC1_WATER_KIND_C.get(levelNumber);
    if (kindC) {
        for (const { vaddr, count, hasNormals } of kindC)
            renderWaterMeshes_KindC(sections, vaddr, count, hasNormals, renderHelper);
    }

    const kindD = RAC1_WATER_KIND_D.get(levelNumber);
    if (kindD) {
        for (const { positionsVaddr, texcoordsVaddr, ambientVaddr, vertexCountsVaddr, count } of kindD)
            renderWaterMeshes_KindD(sections, positionsVaddr, texcoordsVaddr, ambientVaddr, vertexCountsVaddr, count, renderHelper);
    }

    const kindE = RAC1_WATER_KIND_E.get(levelNumber);
    if (kindE) {
        for (let i = 0; i < kindE.count; i++) {
            const dataVaddr = kindE.dataVaddr + i * SIZEOF_WATER_GRID_KIND_E;
            const maskVaddr = kindE.masksVaddr !== null ? kindE.masksVaddr + i * kindE.maskSize : null;
            renderWaterGrid_KindE(sections, dataVaddr, maskVaddr, renderHelper);
        }
    }

    const kindF = RAC1_WATER_KIND_F.get(levelNumber);
    if (kindF) {
        for (let i = 0; i < kindF.vaddrs.length; i++) {
            const dataVaddr = kindF.vaddrs[i];
            renderWaterGrid_KindF(sections, dataVaddr, renderHelper);
        }
    }
}
