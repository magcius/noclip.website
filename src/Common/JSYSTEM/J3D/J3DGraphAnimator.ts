
// Animation support.

import { LoopMode } from './J3DLoader';

export class J3DFrameCtrl {
    public currentTimeInFrames: number = 0;
    public loopMode: LoopMode = LoopMode.ONCE;

    public speedInFrames: number = 1.0;
    public startFrame: number = 0;
    public endFrame: number = -1;
    public repeatStartFrame: number = 0;

    constructor(duration: number) {
        this.endFrame = duration;
    }

    public update(deltaTimeFrames: number): void {
        this.currentTimeInFrames += (this.speedInFrames * deltaTimeFrames);

        if (this.loopMode === LoopMode.ONCE) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.endFrame - 0.001;
            }
        } else if (this.loopMode === LoopMode.ONCE_AND_RESET) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame;
            }
        } else if (this.loopMode === LoopMode.REPEAT) {
            while (this.currentTimeInFrames > this.endFrame)
                this.currentTimeInFrames -= (this.endFrame - this.repeatStartFrame);
        } else if (this.loopMode === LoopMode.MIRRORED_ONCE) {
            if (this.currentTimeInFrames > this.endFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
            }
        } else if (this.loopMode === LoopMode.MIRRORED_REPEAT) {
            if (this.currentTimeInFrames > this.endFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
            }
        }
    }
}
