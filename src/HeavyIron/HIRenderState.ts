import { HICamera } from "./HICamera.js";
import { RwBlendFunction, RwCullMode, RwEngine, RwShadeMode, RwTextureAddressMode, RwTextureFilterMode } from "./rw/rwcore.js";

export const enum HIRenderState {
    Unknown,
    Default,
    OpaqueModels,
    AlphaModels,
    Bubble,
    Projectile,
    Font,
    HUD,
    Particles,
    Lightning,
    Streak,
    SkyBack,
    Environment,
    Fill,
    NPCVisual,
    OOBFade,
    OOBPlayerZ,
    OOBPlayerAlpha,
    OOBHand,
    Glare,
    Newsfish,
    CruiseHUD,
    DiscoFloorGlow
}

export class HIRenderStateManager {
    private rs = HIRenderState.Unknown;

    public get() {
        return this.rs;
    }

    public set(rs: HIRenderState, camera: HICamera, rw: RwEngine) {
        if (rs === this.rs) return;

        this.rs = rs;

        rw.renderState.textureFilter = RwTextureFilterMode.LINEAR;
        camera.setFogRenderStates(rw);
        rw.renderState.vertexAlphaEnable = true;
        rw.renderState.cullMode = RwCullMode.NONE;
        rw.renderState.textureAddressU = RwTextureAddressMode.WRAP;
        rw.renderState.textureAddressV = RwTextureAddressMode.WRAP;
        rw.renderState.srcBlend = RwBlendFunction.SRCALPHA;
        rw.renderState.destBlend = RwBlendFunction.INVSRCALPHA;
        rw.renderState.shadeMode = RwShadeMode.GOURAUD;
        rw.renderState.zWriteEnable = true;
        rw.renderState.zTestEnable = true;

        switch (rs) {
        case HIRenderState.Particles:
            rw.renderState.zWriteEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.shadeMode = RwShadeMode.FLAT;
            break;
        case HIRenderState.OpaqueModels:
            rw.renderState.vertexAlphaEnable = false;
            break;
        case HIRenderState.Environment:
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.cullMode = RwCullMode.BACK;
            break;
        case HIRenderState.Lightning:
            rw.renderState.zWriteEnable = false;
            rw.renderState.destBlend = RwBlendFunction.ONE;
            break;
        case HIRenderState.Streak:
            rw.renderState.zWriteEnable = false;
            break;
        case HIRenderState.NPCVisual:
            rw.renderState.zWriteEnable = false;
            break;
        case HIRenderState.Glare:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.destBlend = RwBlendFunction.ONE;
            break;
        case HIRenderState.Font:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.srcBlend = RwBlendFunction.ONE;
            rw.renderState.destBlend = RwBlendFunction.ZERO;
            break;
        case HIRenderState.HUD:
            rw.renderState.fogEnable = false;
            break;
        case HIRenderState.Bubble:
            rw.renderState.fogEnable = false;
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.cullMode = RwCullMode.BACK;
            break;
        case HIRenderState.SkyBack:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            break;
        case HIRenderState.Fill:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.srcBlend = RwBlendFunction.ONE;
            rw.renderState.destBlend = RwBlendFunction.ZERO;
            rw.renderState.shadeMode = RwShadeMode.FLAT;
            break;
        case HIRenderState.OOBFade:
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.shadeMode = RwShadeMode.FLAT;
            break;
        case HIRenderState.OOBPlayerZ:
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.shadeMode = RwShadeMode.FLAT;
            rw.renderState.srcBlend = RwBlendFunction.ONE;
            rw.renderState.destBlend = RwBlendFunction.ZERO;
            break;
        case HIRenderState.OOBPlayerAlpha:
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.destBlend = RwBlendFunction.ONE;
            break;
        case HIRenderState.OOBHand:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.srcBlend = RwBlendFunction.ONE;
            rw.renderState.destBlend = RwBlendFunction.ZERO;
            break;
        case HIRenderState.Newsfish:
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            rw.renderState.vertexAlphaEnable = false;
            rw.renderState.srcBlend = RwBlendFunction.ONE;
            rw.renderState.destBlend = RwBlendFunction.ZERO;
            break;
        case HIRenderState.CruiseHUD:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.fogEnable = false;
            break;
        case HIRenderState.DiscoFloorGlow:
            rw.renderState.zWriteEnable = false;
            rw.renderState.zTestEnable = false;
            rw.renderState.destBlend = RwBlendFunction.ONE;
            break;
        }
    }
}