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

        rw.renderState.setTextureFilter(RwTextureFilterMode.LINEAR);
        camera.setFogRenderStates(rw);
        rw.renderState.setVertexAlphaEnabled(true);
        rw.renderState.setCullMode(RwCullMode.NONE);
        rw.renderState.setTextureAddressU(RwTextureAddressMode.WRAP);
        rw.renderState.setTextureAddressV(RwTextureAddressMode.WRAP);
        rw.renderState.setSrcBlend(RwBlendFunction.SRCALPHA);
        rw.renderState.setDstBlend(RwBlendFunction.INVSRCALPHA);
        rw.renderState.setShadeMode(RwShadeMode.GOURAUD);
        rw.renderState.setZWriteEnabled(true);
        rw.renderState.setZTestEnabled(true);

        switch (rs) {
        case HIRenderState.Particles:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setShadeMode(RwShadeMode.FLAT);
            break;
        case HIRenderState.OpaqueModels:
            rw.renderState.setVertexAlphaEnabled(false);
            break;
        case HIRenderState.Environment:
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setCullMode(RwCullMode.BACK);
            break;
        case HIRenderState.Lightning:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setDstBlend(RwBlendFunction.ONE);
            break;
        case HIRenderState.Streak:
            rw.renderState.setZWriteEnabled(false);
            break;
        case HIRenderState.NPCVisual:
            rw.renderState.setZWriteEnabled(false);
            break;
        case HIRenderState.Glare:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setDstBlend(RwBlendFunction.ONE);
            break;
        case HIRenderState.Font:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setSrcBlend(RwBlendFunction.ONE);
            rw.renderState.setDstBlend(RwBlendFunction.ZERO);
            break;
        case HIRenderState.HUD:
            rw.renderState.setFogEnabled(false);
            break;
        case HIRenderState.Bubble:
            rw.renderState.setFogEnabled(false);
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setCullMode(RwCullMode.BACK);
            break;
        case HIRenderState.SkyBack:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            break;
        case HIRenderState.Fill:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setSrcBlend(RwBlendFunction.ONE);
            rw.renderState.setDstBlend(RwBlendFunction.ZERO);
            rw.renderState.setShadeMode(RwShadeMode.FLAT);
            break;
        case HIRenderState.OOBFade:
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setShadeMode(RwShadeMode.FLAT);
            break;
        case HIRenderState.OOBPlayerZ:
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setShadeMode(RwShadeMode.FLAT);
            rw.renderState.setSrcBlend(RwBlendFunction.ONE);
            rw.renderState.setDstBlend(RwBlendFunction.ZERO);
            break;
        case HIRenderState.OOBPlayerAlpha:
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setDstBlend(RwBlendFunction.ONE);
            break;
        case HIRenderState.OOBHand:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setSrcBlend(RwBlendFunction.ONE);
            rw.renderState.setDstBlend(RwBlendFunction.ZERO);
            break;
        case HIRenderState.Newsfish:
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            rw.renderState.setVertexAlphaEnabled(false);
            rw.renderState.setSrcBlend(RwBlendFunction.ONE);
            rw.renderState.setDstBlend(RwBlendFunction.ZERO);
            break;
        case HIRenderState.CruiseHUD:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setFogEnabled(false);
            break;
        case HIRenderState.DiscoFloorGlow:
            rw.renderState.setZWriteEnabled(false);
            rw.renderState.setZTestEnabled(false);
            rw.renderState.setDstBlend(RwBlendFunction.ONE);
            break;
        }
    }
}