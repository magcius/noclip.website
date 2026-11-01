
export const RAC1_SKY_ROTATION = new Map([
    [9, [{ shell: 3, rotation: { x: 0, y: 0.3, z: 0 } }]],
]);

const zVelocity = (v: number) => ({
    x: 0,
    y: 0,
    z: 2 * Math.PI * 60 * v * 0x100
});

export const RAC1_SKY_ANGULAR_VELOCITY = new Map([
    [0, [{ shell: 3, angularVelocity: zVelocity(1 / 0x8000) }]],
    [1, [
        { shell: 2, angularVelocity: zVelocity(1 / 0x40000) },
        { shell: 3, angularVelocity: zVelocity(1 / 0x20000) },
        { shell: 4, angularVelocity: zVelocity(1 / 0x10000) },
    ]],
    [3, [
        { shell: 1, angularVelocity: zVelocity(1 / 0x10000) },
        { shell: 2, angularVelocity: zVelocity(1 / 0x20000) },
    ]],
    [4, [
        { shell: 1, angularVelocity: zVelocity(1 / 0x10000) },
        { shell: 2, angularVelocity: zVelocity(1 / 0x20000) },
    ]],
    [5, [{ shell: 1, angularVelocity: zVelocity(1 / 50000) }]],
    [7, [{ shell: 2, angularVelocity: zVelocity(1 / 50000) }]],
    [8, [{ shell: 1, angularVelocity: zVelocity(1 / 40000) }]],
    [9, [{ shell: 3, angularVelocity: zVelocity(1 / 25000) }]],
    [10, [
        { shell: 0, angularVelocity: zVelocity(1 / (0x20000 * 2)) },
        { shell: 1, angularVelocity: zVelocity(1 / (0x20000 * 5)) },
        { shell: 2, angularVelocity: zVelocity(1 / (0x40000 * 10)) },
        { shell: 3, angularVelocity: zVelocity(1 / (0x20000 * 10)) },
    ]],
    [11, [
        { shell: 1, angularVelocity: zVelocity(1 / 0x40000) },
        { shell: 2, angularVelocity: zVelocity(1 / 0x20000) },
        { shell: 3, angularVelocity: zVelocity(1 / 0x10000) },
    ]],
    [12, [
        { shell: 1, angularVelocity: zVelocity(1 / 0x40000) },
        { shell: 2, angularVelocity: zVelocity(1 / 0x20000) },
        { shell: 3, angularVelocity: zVelocity(1 / 0x10000) },
    ]],
    [14, [
        { shell: 1, angularVelocity: zVelocity(1 / 50000) },
        { shell: 2, angularVelocity: zVelocity(1 / 100000) },
    ]],
    [16, [
        { shell: 1, angularVelocity: zVelocity(1 / 0x40000) },
        { shell: 2, angularVelocity: zVelocity(1 / 0x20000) },
        { shell: 3, angularVelocity: zVelocity(1 / 0x10000) },
    ]],
    [18, [
        { shell: 4, angularVelocity: zVelocity(1 / 40000) },
        { shell: 5, angularVelocity: zVelocity(1 / 60000) },
    ]],
]);

// novalis
export const RAC1_WATER_KIND_A = new Map([
    [676, { vaddr: 0x1e2fc0, count: 8 }],
    [678, { vaddr: 0x1e3380, count: 2 }],
    [761, { vaddr: 0x1fbc80, count: 4 }],
    [1225, { vaddr: 0x202d80, count: 3 }]
]);

// gaspar
export const RAC1_WATER_KIND_B = new Map<number, { vaddr: number; count: number }>([
    [317, { vaddr: 0x1f3080, count: 108 }],
]);

// gaspar, hoven, oltanis
export const RAC1_WATER_KIND_C = new Map<number, { vaddr: number; count: number; hasNormals: boolean }>([
    [317, { vaddr: 0x1f63c0, count: 10, hasNormals: false }],
    [293, { vaddr: 0x1f5480, count: 47, hasNormals: true }],
    [1418, { vaddr: 0x1f5f80, count: 19, hasNormals: true }],
]);

// hoven, pokitaru, batalia
export const RAC1_WATER_KIND_D = new Map<number, { positionsVaddr: number; texcoordsVaddr: number; ambientVaddr: number; vertexCountsVaddr: number; count: number, textureId?: number }[]>([
    [1901, [
        { positionsVaddr: 0x2059e0, texcoordsVaddr: 0x205a08, ambientVaddr: 0x205a58, vertexCountsVaddr: 0x1fbd10, textureId: 0x2c, count: 10 },
        { positionsVaddr: 0x208a98, texcoordsVaddr: 0x208ab0, ambientVaddr: 0x208ae0, vertexCountsVaddr: 0x205a80, textureId: 0x2f, count: 5 },
    ]],
    [1903, [
        { positionsVaddr: 0x162540, texcoordsVaddr: 0x162550, ambientVaddr: 0x162570, vertexCountsVaddr: 0x162530, textureId: 0x2c, count: 4 },
        { positionsVaddr: 0x1ff6d0, texcoordsVaddr: 0x1ff6f0, ambientVaddr: 0x1ff730, vertexCountsVaddr: 0x1f9a78, textureId: 0x2a, count: 8 },
        { positionsVaddr: 0x1f99b8, texcoordsVaddr: 0x1f99e8, ambientVaddr: 0x1f9a48, vertexCountsVaddr: 0x1f4978, textureId: 0x2b, count: 11 },
    ]],
    [1919, [
        { positionsVaddr: 0x215148, texcoordsVaddr: 0x215190, ambientVaddr: 0x215220, vertexCountsVaddr: 0x207900, textureId: 0x2c, count: 17 },
        { positionsVaddr: 0x207860, texcoordsVaddr: 0x207888, ambientVaddr: 0x2078d8, vertexCountsVaddr: 0x200728, textureId: 0x2a, count: 9 },
        { positionsVaddr: 0x2176f8, texcoordsVaddr: 0x217710, ambientVaddr: 0x217740, vertexCountsVaddr: 0x215268, textureId: 0x2b, count: 5 },
    ]],
    [600, [
        { positionsVaddr: 0x1e8268, texcoordsVaddr: 0x1e82a0, ambientVaddr: 0x1e8310, vertexCountsVaddr: 0x1e2858, textureId: 0x3d, count: 13 },
        { positionsVaddr: 0x1e2798, texcoordsVaddr: 0x1e27c8, ambientVaddr: 0x1e2828, vertexCountsVaddr: 0x1ddf40, textureId: 0x3c, count: 11 },
        { positionsVaddr: 0x1ddec0, texcoordsVaddr: 0x1ddee0, ambientVaddr: 0x1ddf20, vertexCountsVaddr: 0x1db518, textureId: 0x3a, count: 8 },
    ]],
    [1649, [
        { positionsVaddr: 0x1f84c8, texcoordsVaddr: 0x1f84e8, ambientVaddr: 0x1f8528, vertexCountsVaddr: 0x1f4c60, textureId: 0x3d, count: 8, },
        { positionsVaddr: 0x1f4c00, texcoordsVaddr: 0x1f4c18, ambientVaddr: 0x1f4c48, vertexCountsVaddr: 0x1f01c8, textureId: 0x3c, count: 6, },
        { positionsVaddr: 0x1623d0, texcoordsVaddr: 0x1623d8, ambientVaddr: 0x1623e8, vertexCountsVaddr: 0x1623c8, textureId: 0x3a, count: 2, },
    ]],
]);

// patch water on many levels
// keyed by level number not moby class - each moby selects which patch to control based on pvars - the one controlling the first patch draws all of them
export const RAC1_WATER_KIND_E = new Map<number, { dataVaddr: number; masksVaddr: number | null; maskSize: number; count: number }>([
    [1, { dataVaddr: 0x1e34c0, masksVaddr: 0x1fa590, maskSize: 4, count: 21 }],
    [5, { dataVaddr: 0x1d6880, masksVaddr: 0x20b380, maskSize: 2, count: 48 }],
    [7, { dataVaddr: 0x1dce40, masksVaddr: 0x204680, maskSize: 2, count: 36 }],
    [11, { dataVaddr: 0x1da880, masksVaddr: null, maskSize: 2, count: 20 }],
    [12, { dataVaddr: 0x1cbf40, masksVaddr: null, maskSize: 2, count: 17 }],
    [13, { dataVaddr: 0x1d9bc0, masksVaddr: 0x1f1e20, maskSize: 2, count: 22 }],
]);

// oceans on many levels
export const RAC1_WATER_KIND_F = new Map<number, { vaddrs: number[] }>([
    [317, { vaddrs: [0x1fc740] }],
    [327, { vaddrs: [0x1d7060] }],
    [460, { vaddrs: [0x1d3400] }],
    [854, { vaddrs: [0x1f3c00, 0x1f3cd0, 0x1f3d30, 0x1f3d90, 0x1f3dd0, 0x1f3e10, 0x1f3c60] }],
    [879, { vaddrs: [0x211b20] }],
    [994, { vaddrs: [0x1dc1a0] }],
    [1018, { vaddrs: [0x208560] }],
    [1260, { vaddrs: [0x1e9c60] }],
]);

// quartu and veldin orbit
export const RAC1_WATER_KIND_G = new Map<number, { positionVaddr: number; texcoordsVaddr: number; vertexCount: number, scale: number }[]>([
    [1405, [
        { positionVaddr: 0x1da040, texcoordsVaddr: 0x1da7b8, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1da730, texcoordsVaddr: 0x1dac58, vertexCount: 11, scale: 1 },
    ]],
    [1406, [{ positionVaddr: 0x1dbe20, texcoordsVaddr: 0x1dc250, vertexCount: 89, scale: 1 }]],
    [1407, [{ positionVaddr: 0x1dcee0, texcoordsVaddr: 0x1dd100, vertexCount: 45, scale: 1 }]],
    [1408, [
        { positionVaddr: 0x1d9e40, texcoordsVaddr: 0x1dad98, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1da530, texcoordsVaddr: 0x1db238, vertexCount: 148, scale: 1 },
        { positionVaddr: 0x1dac20, texcoordsVaddr: 0x1db6d8, vertexCount: 31, scale: 1 },
    ]],
    [1409, [{ positionVaddr: 0x1ddba0, texcoordsVaddr: 0x1dded0, vertexCount: 68, scale: 1 }]],
    [1565, [{ positionVaddr: 0x1de860, texcoordsVaddr: 0x1dea88, vertexCount: 46, scale: 0.5 }]],
    [1567, [{ positionVaddr: 0x1df100, texcoordsVaddr: 0x1df520, vertexCount: 88, scale: 1 }]],
]);

// veldin finale
export const RAC1_WATER_KIND_H = new Map<number, { quadCount: number; vertexRecordsVaddr: number; quadIndicesVaddr: number; texcoordsVaddr: number }[]>([
    [1402, [
        { quadCount: 22, vertexRecordsVaddr: 0x1db030, quadIndicesVaddr: 0x1db240, texcoordsVaddr: 0x1db3a0 },
        { quadCount: 25, vertexRecordsVaddr: 0x1da3c0, quadIndicesVaddr: 0x1da610, texcoordsVaddr: 0x1da7a0 },
        { quadCount: 38, vertexRecordsVaddr: 0x1da8d0, quadIndicesVaddr: 0x1dac20, texcoordsVaddr: 0x1dae80 },
    ]],
]);
