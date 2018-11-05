
import { GfxSampler, GfxDevice } from "../platform/GfxPlatform";

// An equivalent to the RenderArena but for Gfx types.

export default class GfxArena {
    public samplers: GfxSampler[] = [];

    public trackSampler(g: GfxSampler): GfxSampler { this.samplers.push(g); return g; }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.samplers.length; i++)
            device.destroySampler(this.samplers[i]);
        this.samplers = [];
    }
}
