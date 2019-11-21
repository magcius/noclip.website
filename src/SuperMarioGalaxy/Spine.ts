
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
    private nerveStack: Nerve[] = [];
    private tick: number = 0;

    public pushNerve(nerve: Nerve): void {
        this.nerveStack.unshift(nerve);
        this.tick = -1;
    }

    public popNerve(nerve: Nerve): void {
        this.nerveStack.shift();
        this.tick = -1;
    }

    public setNerve(nerve: Nerve): void {
        this.nerveStack.length = 0;
        this.nerveStack.push(nerve);
        this.tick = -1;
    }

    public getNerveStep(): number {
        return this.tick;
    }

    public update(deltaTime: number): void {
        // First tick is special.
        if (this.tick < 0)
            this.tick = 0;
        else
            this.tick += clamp(deltaTime, 0.0, 1.5);
    }

    public getCurrentNerve(): Nerve {
        return this.nerveStack[0];
    }
}
