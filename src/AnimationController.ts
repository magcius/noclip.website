
export default class AnimationController {
    private timeMilliseconds: number;

    constructor(public fps: number = 30) {}

    public getTimeInFrames(): number {
        const ms = this.timeMilliseconds;
        return (ms / 1000) * this.fps;
    }

    public updateTime(newTime: number): void {
        this.timeMilliseconds = newTime;
    }
}
