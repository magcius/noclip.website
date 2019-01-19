
export default class AnimationController {
    private timeMilliseconds: number = 0;
    public phaseFrames: number = 0;

    constructor(public fps: number = 30) {}

    public getTimeInFrames(): number {
        const ms = this.timeMilliseconds;
        return (ms / 1000) * this.fps + this.phaseFrames;
    }

    public getTimeInSeconds(): number {
        return this.getTimeInFrames() / this.fps;
    }

    public updateTime(newTime: number): void {
        this.timeMilliseconds = newTime;
    }
}
