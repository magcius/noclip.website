
export default class AnimationController {
    public fps: number = 30;
    private timeMilliseconds: number;

    public getTimeInFrames(): number {
        const ms = this.timeMilliseconds;
        return (ms / 1000) * this.fps;
    }

    public updateTime(newTime: number): void {
        this.timeMilliseconds = newTime;
    }
}
