
import { lerp, saturate } from "../MathHelpers";
import { SceneObjHolder } from "./Main";
import { assert } from "../util";

interface SpineHost {
    spine: Spine | null;
}

export function isFirstStep(host: SpineHost): boolean {
    return host.spine!.getNerveStep() === 0;
}

export function isGreaterStep(host: SpineHost, v: number): boolean {
    return host.spine!.getNerveStep() > v;
}

export function isGreaterEqualStep(host: SpineHost, v: number): boolean {
    return host.spine!.getNerveStep() >= v;
}

export function isLessStep(host: SpineHost, v: number): boolean {
    return host.spine!.getNerveStep() < v;
}

function crossedTime(oldTime: number, newTime: number, thresh: number): boolean {
    return oldTime <= thresh && newTime > thresh;
}

export function isCrossedStep(host: SpineHost, thresh: number): boolean {
    return crossedTime(host.spine!.getLastNerveStep(), host.spine!.getNerveStep(), thresh);
}

export function isCrossedRepeatStep(host: SpineHost, interval: number, startTime: number = 0): boolean {
    if (host.spine!.getNerveStep() < startTime)
        return false;

    const base = startTime + (((host.spine!.getNerveStep() - startTime) / interval) | 0) * interval;
    return isCrossedStep(host, base);
}

export function calcNerveRate(host: SpineHost, v: number): number {
    return saturate(host.spine!.getNerveStep() / v);
}

export function calcNerveValue(host: SpineHost, nerveStepMax: number, a: number, b: number): number {
    const t = nerveStepMax > 0 ? (host.spine!.getNerveStep() / nerveStepMax) : 1.0;
    return lerp(a, b, t);
}

export function getStep(host: SpineHost): number {
    return host.spine!.getNerveStep();
}

export class Spine<Nerve extends number = number> {
    private currentNerve: Nerve;
    private nextNerve: Nerve | null = null;
    private tick: number = 0;
    private lastDeltaTime: number = 0;

    public initNerve(nerve: Nerve): void {
        assert(this.currentNerve === undefined);
        this.currentNerve = nerve;
        this.tick = 0;
    }

    public setNerve(nerve: Nerve): void {
        this.nextNerve = nerve;
        this.tick = -1;
    }

    public getLastNerveStep(): number {
        return this.tick - this.lastDeltaTime;
    }

    public getNerveStep(): number {
        return this.tick;
    }

    public changeNerve(): void {
        if (this.nextNerve !== null) {
            this.currentNerve = this.nextNerve;
            this.nextNerve = null;
            this.tick = 0;
        }
    }

    public updateTick(deltaTimeFrames: number): void {
        this.lastDeltaTime = deltaTimeFrames;
        if (this.tick === 0.0 && deltaTimeFrames < 0.01) {
            // If we have paused on a isFirstStep, increment the counter just
            // a bit so we don't get stuck in a loop.
            this.tick = 0.01;
        } else {
            this.tick += deltaTimeFrames;
        }
    }

    public getCurrentNerve(): Nerve {
        if (this.nextNerve !== null)
            return this.nextNerve;
        return this.currentNerve;
    }
}

// Basic SpineHost
export abstract class NerveExecutor<Nerve extends number> implements SpineHost {
    public spine = new Spine<Nerve>();

    public initNerve(nerve: Nerve): void {
        this.spine.initNerve(nerve);
    }

    public isNerve(nerve: Nerve): boolean {
        return this.spine.getCurrentNerve() === nerve;
    }

    public getNerveStep(): number {
        return this.spine.getNerveStep();
    }

    public setNerve(nerve: Nerve): void {
        this.spine.setNerve(nerve);
    }

    protected abstract updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: Nerve, deltaTimeFrames: number): void;

    protected updateNerveExecutor(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.spine.changeNerve();
        this.updateSpine(sceneObjHolder, this.spine.getCurrentNerve(), deltaTimeFrames);
        this.spine.updateTick(deltaTimeFrames);
        this.spine.changeNerve();
    }
}
