
import { clamp } from "../../MathHelpers";
import { LiveActor } from "./LiveActor";

export type Nerve = number;

export function isFirstStep(actor: LiveActor): boolean {
    return actor.spine.getNerveStep() === 0;
}

export function isGreaterStep(actor: LiveActor, v: number): boolean {
    return actor.spine.getNerveStep() > v;
}

export function calcNerveRate(actor: LiveActor, v: number): number {
    return actor.spine.getNerveStep() / v;
}

export class Spine {
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
