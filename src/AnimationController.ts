
export default class AnimationController {
    private timeMilliseconds: number;
    public phaseFrames: number = 0;

    constructor(public fps: number = 30) {}

    public getTimeInFrames(): number {
        const ms = this.timeMilliseconds;
        return (ms / 1000) * this.fps + this.phaseFrames;
    }

    public updateTime(newTime: number): void {
        this.timeMilliseconds = newTime;
    }
}
