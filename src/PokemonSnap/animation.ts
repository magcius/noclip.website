import { Path, PathKind, AnimationTrack, EntryKind } from './room';
import { vec4, vec3 } from "gl-matrix";
import { getPointHermite, getPointBezier, getPointBasis } from '../Spline';
import { lerp } from '../MathHelpers';
import { assertExists, nArray } from '../util';

export const enum AObjTarget {
    Pitch,
    Yaw,
    Roll,
    Path,
    X,
    Y,
    Z,
    ScaleX,
    ScaleY,
    ScaleZ,
}

export const enum AObjOP {
    NOP,
    STEP,
    LERP,
    SPLINE,
}

class AObj {
    public op = AObjOP.NOP;
    public start = 0;
    public len = 1;
    public p0 = 0;
    public p1 = 0;
    public v0 = 0;
    public v1 = 0;
    public path: Path | null = null;

    public compute(t: number): number {
        switch (this.op) {
            case AObjOP.NOP: return 0;
            case AObjOP.STEP: return (t - this.start) > this.len ? this.p1 : this.p0;
            case AObjOP.LERP: return this.p0 + (t - this.start) * this.v0;
            case AObjOP.SPLINE: return getPointHermite(this.p0, this.p1, this.v0 / this.len, this.v1 / this.len, (t - this.start) * this.len);
        }
    }

    public reset(): void {
        this.op = AObjOP.NOP;
        this.start = 0;
        this.len = 1;
        this.p0 = 0;
        this.p1 = 0;
        this.v0 = 0;
        this.v1 = 0;
    }
}

class ColorAObj {
    public op = AObjOP.NOP;
    public start = 0;
    public len = 1;
    public c0 = vec4.create();
    public c1 = vec4.create();

    public compute(t: number, dst: vec4): void {
        switch (this.op) {
            case AObjOP.STEP:
                vec4.copy(dst, (t - this.start) > this.len ? this.c1 : this.c0);
                break;
            case AObjOP.LERP:
                vec4.lerp(dst, this.c0, this.c1, t / this.len);
        }
    }

    public reset(): void {
        this.op = AObjOP.NOP;
        this.start = 0;
        this.len = 1;
        vec4.scale(this.c0, this.c0, 0);
        vec4.scale(this.c1, this.c1, 0);
    }
}


export function getPathPoint(dst: vec3, path: Path, t: number): void {
    let segment = 0;
    while (segment + 1 < path.length && t > path.times[segment + 1])
        segment++;
    // TODO: modify this using quartics
    const frac = (t - path.times[segment]) / (path.times[segment + 1] - path.times[segment]);

    const offs = segment * (path.kind === PathKind.Bezier ? 9 : 3);
    switch (path.kind) {
        case PathKind.Linear: {
            for (let i = 0; i < 3; i++)
                dst[i] = lerp(path.points[offs + i], path.points[offs + 3 + i], frac);
        } break;
        case PathKind.Bezier: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointBezier(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.BSpline: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointBasis(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.Hermite: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointHermite(path.points[offs + 3 + i], path.points[offs + 6 + i],
                    (path.points[offs + 6 + i] - path.points[offs + i]) * path.segmentRate, (path.points[offs + 9 + i] - path.points[offs + 3 + i]) * path.segmentRate, frac);
        } break;
    }
}


export class Animator {
    public track: AnimationTrack | null = null;
    public interpolators = nArray(10, () => new AObj());
    public colors: ColorAObj[] = [];
    public stateFlags = 0;

    private trackIndex = 0;
    private nextUpdate = 0;

    constructor(useColor = false) {
        if (useColor)
            this.colors = nArray(5, () => new ColorAObj());
    }

    public reset(time: number): void {
        this.trackIndex = 0;
        this.nextUpdate = time;
        for (let i = 0; i < this.interpolators.length; i++)
            this.interpolators[i].reset();
        for (let i = 0; i < this.colors.length; i++)
            this.colors[i].reset();
    }

    public update(time: number): void {
        if (this.track === null)
            return;
        const entries = this.track.entries;
        while (this.nextUpdate <= time) {
            if (this.trackIndex === entries.length) {
                if (this.track.loopStart >= 0)
                    this.trackIndex = this.track.loopStart;
                else {
                    // not actually a looping animation, force reset
                    this.reset(time);
                }
            }

            const entry = entries[this.trackIndex++];
            let offs = 0;
            switch (entry.kind) {
                case EntryKind.Lerp:
                case EntryKind.LerpBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.LERP;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v1 = 0;
                            if (entry.increment !== 0)
                                this.interpolators[i].v0 = (this.interpolators[i].p1 - this.interpolators[i].p0) / entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
                case EntryKind.SplineVel:
                case EntryKind.SplineVelBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.SPLINE;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v0 = this.interpolators[i].v1;
                            this.interpolators[i].v1 = entry.data[offs++];
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
                case EntryKind.SplineEnd: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i))
                            this.interpolators[i].v1 = entry.data[offs++];
                    }
                } break;
                case EntryKind.Spline:
                case EntryKind.SplineBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.SPLINE;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v0 = this.interpolators[i].v1;
                            this.interpolators[i].v1 = 0;
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
                case EntryKind.Step:
                case EntryKind.StepBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.STEP;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v1 = 0;
                            this.interpolators[i].len = entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
                case EntryKind.Skip: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i))
                            this.interpolators[i].start -= entry.increment;
                    }
                } break;
                case EntryKind.SetFlags: {
                    this.stateFlags = entry.flags;
                } break;
                case EntryKind.Path: {
                    this.interpolators[AObjTarget.Path].path = entry.path;
                } break;
                case EntryKind.ColorStep:
                case EntryKind.ColorStepBlock: {
                    for (let i = 0; i < 5; i++) {
                        if (entry.flags & (1 << i)) {
                            this.colors[i].op = AObjOP.STEP;
                            this.colors[i].c0 = this.colors[i].c1;
                            this.colors[i].c1 = assertExists(entry.colors[offs++]);
                            this.interpolators[i].len = entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
                case EntryKind.ColorLerp:
                case EntryKind.ColorLerpBlock: {
                    for (let i = 0; i < 5; i++) {
                        if (entry.flags & (1 << i)) {
                            this.colors[i].op = AObjOP.LERP;
                            this.colors[i].c0 = this.colors[i].c1;
                            this.colors[i].c1 = assertExists(entry.colors[offs++]);
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = time;
                        }
                    }
                } break;
            }
            if (entry.block)
                this.nextUpdate += entry.increment;
        }
        return;
    }
}
