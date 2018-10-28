
import { Camera } from "../../Camera";

// The "Render" subsystem is a high-level scene graph, built on top of gfx/platform and gfx/helpers.
// Similar to bgfx and T3, it implements a bare minimum set of features for high performance graphics.

export enum GfxRenderTransparencyMode {
    // Transparency modes for sorting draws.
    Opaque,
    AlphaTest,
    AlphaBlend,
}

export class GfxRenderView {
    public camera: Camera;
}

export class GfxRenderInst {
    public sortKey: number;
}

export class GfxRenderInstList {
    public renderInsts: GfxRenderInst[] = [];
}
