// Shared by: weather, wind schedules, cloud/rain/snow/leaf fields and pasture variants

export class Rng {
    constructor(private state: number = 1) { }

    public next(): number {
        const s1 = (Math.imul(this.state, 0x41c64e6d) + 0x3039) >>> 0;
        const s2 = (Math.imul(s1, 0x41c64e6d) + 0x3039) >>> 0;
        this.state = s2;
        return ((s2 & 0xffff0000) | (s1 >>> 16)) >>> 0;
    }

    public range(min: number, max: number): number {
        return min + (this.next() % (max - min + 1));
    }
}
