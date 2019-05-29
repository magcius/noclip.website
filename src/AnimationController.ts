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
        this.setTimeInFrames((ms / 1000) * this.fps);
    }

    public setTimeInFrames(newTime: number): void {
        this.timeInFrames = newTime;
    }

    public setTimeFromViewerInput(viewerInput: ViewerRenderInput): void {
        this.setTimeInMilliseconds(viewerInput.time);
    }
}
