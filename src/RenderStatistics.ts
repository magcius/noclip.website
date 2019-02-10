
import { GfxDebugGroup } from "./gfx/platform/GfxPlatform";

export interface RenderStatistics {
    frameStartCPUTime: number;
    drawCallCount: number;
    textureBindCount: number;
    bufferUploadCount: number;
    triangleCount: number;
    frameCPUTime: number;
    fps: number;
}

export class RenderStatisticsTracker {
    public drawCallCount: number = 0;
    public textureBindCount: number = 0;
    public bufferUploadCount: number = 0;
    public triangleCount: number = 0;
    public frameStartCPUTime: number = 0;
    public frameCPUTime: number = 0;
    public fps: number = 0;

    public beginFrame(): void {
        this.frameStartCPUTime = window.performance.now();
        this.drawCallCount = 0;
        this.textureBindCount = 0;
        this.bufferUploadCount = 0;
        this.triangleCount = 0;
        this.frameCPUTime = 0;
        this.fps = 0;
    }

    public endFrame(): RenderStatistics {
        this.frameCPUTime = window.performance.now() - this.frameStartCPUTime;
        this.fps = 1000 / this.frameCPUTime;
        return this;
    }

    public applyDebugGroup(debugGroup: GfxDebugGroup): void {
        this.drawCallCount += debugGroup.drawCallCount;
        this.textureBindCount += debugGroup.textureBindCount;
        this.bufferUploadCount += debugGroup.bufferUploadCount;
        this.triangleCount += debugGroup.triangleCount;
    }
}
