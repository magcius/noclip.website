
import { lerp } from "../MathHelpers";

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

export function calcNerveRate(host: SpineHost, v: number): number {
    return host.spine!.getNerveStep() / v;
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

    public setNerve(nerve: Nerve): void {
        this.nextNerve = nerve;
        this.tick = -1;
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

    public updateTick(deltaTime: number): void {
        if (this.tick === 0.0 && deltaTime < 0.01) {
            // If we have paused on a isFirstStep, increment the counter just
            // a bit so we don't get stuck in a loop.
            this.tick = 0.01;
        } else {
            this.tick += deltaTime;
        }
    }

    public getCurrentNerve(): Nerve {
        if (this.nextNerve !== null)
            return this.nextNerve;
        return this.currentNerve;
    }
}
