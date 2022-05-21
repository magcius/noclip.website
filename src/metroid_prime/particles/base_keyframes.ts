import { InputStream } from '../stream';
import { GetRealElement, RealElement } from './real_element';
import { ParticleGlobals } from './base_generator';

export abstract class BaseKeyframeEmitter<T, U> {
    percent: number;
    loop: boolean;
    loopEnd: number;
    loopStart: number;
    keys: T[];

    public constructor(stream: InputStream) {
        this.percent = stream.readUint32();
        stream.readUint32();
        this.loop = stream.readBool();
        stream.readBool();
        this.loopEnd = stream.readUint32();
        this.loopStart = stream.readUint32();

        const keyCount = stream.readUint32();
        this.keys = new Array(keyCount);
        for (let i = 0; i < keyCount; ++i) {
            this.keys[i] = this.ReadKey(stream);
        }
    }

    private CalcLoopKey(globals: ParticleGlobals): number {
        const emitterTime = globals.emitterTime;
        let calcKey = emitterTime;
        if (this.loop) {
            if (emitterTime >= this.loopEnd) {
                const v1 = emitterTime - this.loopStart;
                const v2 = this.loopEnd - this.loopStart;
                calcKey = v1 % v2;
                calcKey += this.loopStart;
            }
        } else {
            const v1 = this.loopEnd - 1;
            if (v1 < emitterTime)
                calcKey = v1;
        }
        return calcKey;
    }

    abstract ReadKey(stream: InputStream): T;
    abstract AssignValue(valOut: U, key: T): void;
    abstract LerpValue(valOut: U, keyA: T, keyB: T, t: number): void;

    public GetValue(frame: number, globals: ParticleGlobals, valOut: U): boolean {
        if (!this.percent) {
            this.AssignValue(valOut, this.keys[this.CalcLoopKey(globals)]);
        } else {
            const ltPerc = globals.particleLifetimePercentage;
            const ltPercRem = globals.particleLifetimePercentageRemainder;
            if (ltPerc === 100)
                this.AssignValue(valOut, this.keys[100]);
            else
                this.LerpValue(valOut, this.keys[ltPerc], this.keys[ltPerc + 1], ltPercRem);
        }
        return false;
    }
}

export abstract class BaseKeyframeFunction<T, U> {
    x4: number;
    x8: number;
    xc: boolean;
    xd: boolean;
    x10: number;
    x14: number;
    x18f: number;
    x1cf: number;
    keys: T[];
    x2c: RealElement;

    constructor(stream: InputStream) {
        this.x4 = stream.readUint32(); // 2
        this.x8 = stream.readUint32(); // 0
        this.xc = stream.readBool(); // true
        this.xd = stream.readBool(); // false
        this.x10 = stream.readUint32(); // 101
        this.x14 = stream.readUint32(); // 0
        this.x18f = stream.readFloat32(); // 0.0
        this.x1cf = stream.readFloat32(); // 1.0
        const keyCount = stream.readUint32(); // 101
        this.keys = new Array(keyCount);
        for (let i = 0; i < keyCount; ++i) {
            this.keys[i] = this.ReadKey(stream);
        }
        this.x2c = GetRealElement(stream)!;
    }

    abstract ReadKey(stream: InputStream): T;
    abstract AssignValue(valOut: U, key: T): void;
    abstract LerpValue(valOut: U, keyA: T, keyB: T, t: number): void;

    public GetValue(frame: number, globals: ParticleGlobals, valOut: U): boolean {
        if (this.x4 === 2) {
            const x2c = { value: 0.0 };
            this.x2c.GetValue(frame, globals, x2c);
            let key = Math.max(0, Math.trunc(this.x1cf * (x2c.value - this.x18f)));
            if (!this.xc) {
                key = Math.min(this.x10 - 1, key);
            } else if (this.x10 <= key) {
                key = (key - this.x14) % (this.x10 - this.x14) + this.x14;
            }
            if (key > 0 && key < this.x10 - 1) {
                const t = (x2c.value - this.x18f) - key / this.x1cf;
                this.LerpValue(valOut, this.keys[key], this.keys[key + 1], t);
            } else {
                this.AssignValue(valOut, this.keys[key]);
            }
        }
        return false;
    }
}
