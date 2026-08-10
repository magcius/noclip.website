
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
