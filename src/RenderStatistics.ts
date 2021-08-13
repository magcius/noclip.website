
export interface RenderStatistics {
    frameStartCPUTime: number;
    frameCPUTime: number;
    fps: number;
    lines: string[];
}

export class RenderStatisticsTracker {
    public frameStartCPUTime: number = 0;
    public frameCPUTime: number = 0;
    public fps: number = 0;
    public lines: string[] = [];
    public gameLines: string[] = [];

    public addInfoLine(line: string): void {
        this.lines.push(line);
    }

    public beginFrame(): void {
        this.frameStartCPUTime = window.performance.now();
        this.lines.length = 0;
        this.frameCPUTime = 0;
        this.fps = 0;
    }

    public endFrame(): RenderStatistics {
        this.frameCPUTime = window.performance.now() - this.frameStartCPUTime;
        this.fps = 1000 / this.frameCPUTime;
        this.lines.push(`FPS: ${this.fps | 0}`);
        return this;
    }
}
