
// Utilities for various actor implementations.

import { LiveActor } from "./LiveActor";
import { LoopMode, ANK1 } from "../Common/JSYSTEM/J3D/J3DLoader";

export function isBckStopped(actor: LiveActor): boolean {
    const animator = actor.modelInstance!.ank1Animator!;
    if (animator.ank1.loopMode !== LoopMode.ONCE)
        return false;
    return animator.animationController.getTimeInFrames() >= animator.ank1.duration;
}

export function getBckFrameMax(actor: LiveActor): number {
    const animator = actor.modelInstance!.ank1Animator;
    if (animator !== null)
        return animator.ank1.duration;
    else
        return -1;
}

export function setLoopMode(actor: LiveActor, loopMode: LoopMode): void {
    const ank1 = actor.modelInstance!.ank1Animator!.ank1;
    ank1.loopMode = loopMode;
}
