
import { clamp, lerp } from "../MathHelpers";

interface SpineHost {
    spine: Spine | null;
}

export function isFirstStep(host: SpineHost): boolean {
    return host.spine!.getNerveStep() === 0;
}

export function isGreaterStep(host: SpineHost, v: number): boolean {
    return host.spine!.getNerveStep() > v;
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
    private tick: number = 0;

    public setNerve(nerve: Nerve): void {
        this.currentNerve = nerve;
        this.tick = -1;
    }

    public getNerveStep(): number {
        return this.tick;
    }

    public update(deltaTime: number): void {
        // First tick is special.
        if (this.tick < 0) {
            this.tick = 0;
        } else if (this.tick === 0.0 && deltaTime < 0.01) {
            // If we have paused on a isFirstStep, increment the counter just
            // a bit so we don't get stuck in a loop.
            this.tick = 0.01;
        } else {
            this.tick += deltaTime;
        }
    }

    public getCurrentNerve(): Nerve {
        return this.currentNerve;
    }
}
