
import { ViewerRenderInput } from "./viewer";

export default class AnimationController {
    private timeInFrames: number = 0;
    public phaseFrames: number = 0;

    constructor(public fps: number = 30) {}

    public getTimeInFrames(): number {
        return this.timeInFrames + this.phaseFrames;
    }

    public getTimeInSeconds(): number {
        return this.getTimeInFrames() / this.fps;
    }

    public setTimeInMilliseconds(ms: number): void {
        this.setTimeInFrames(getTimeInFrames(ms, this.fps));
    }

    public setTimeInFrames(newTime: number): void {
        this.timeInFrames = newTime;
    }

    public setTimeFromViewerInput(viewerInput: ViewerRenderInput): void {
        this.setTimeInMilliseconds(viewerInput.time);
    }

    public setPhaseInMilliseconds(ms: number): void {
        this.phaseFrames = getTimeInFrames(ms, this.fps);
    }

    public setPhaseToCurrent(): void {
        this.phaseFrames = -this.timeInFrames;
    }

    public adjustTimeToNewFPS(newFPS: number): void {
        if (this.fps !== 0) {
            this.timeInFrames *= newFPS / this.fps;
            this.phaseFrames *= newFPS / this.fps;
        }
        this.fps = newFPS;
    }
}

export function getTimeInFrames(milliseconds: number, fps: number): number {
    const fpsRate = fps / 1000;
    return milliseconds * fpsRate;
}
