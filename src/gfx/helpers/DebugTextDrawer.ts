
import { SceneContext } from "../../SceneBase";
import { GfxDevice } from "../platform/GfxPlatform";

import { decompress } from "../../Common/Compression/Yaz0";
import * as JKRArchive from "../../Common/JSYSTEM/JKRArchive";
import * as GX from '../../gx/gx_enum';
import { CharWriter, parseBRFNT, ResFont } from "../../Common/NW4R/lyt/Font";
import { GfxRenderInst, GfxRenderInstManager } from "../render/GfxRenderInstManager";
import { TDDraw } from "../../SuperMarioGalaxy/DDraw";
import { GX_Program } from "../../gx/gx_material";
import { fillMatrix4x3 } from "./UniformBufferHelpers";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillSceneParamsData, gxBindingLayouts, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render";
import { computeProjectionMatrixFromCuboid } from "../../MathHelpers";
import { GfxrRenderTargetDescription } from "../render/GfxRenderGraph";
import { Color, colorCopy, colorNewCopy, White } from "../../Color";

const scratchMatrix = mat4.create();
const scratchVec4 = vec4.create();
const sceneParams = new SceneParams();

export class DebugTextDrawer {
    private charWriter = new CharWriter();
    private ddraw = new TDDraw();

    public textColor = colorNewCopy(White);

    constructor(context: SceneContext, private fontData: ResFont) {
        this.charWriter.setFont(fontData, 0, 0);

        const ddraw = this.ddraw;
        ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        ddraw.setVtxDesc(GX.Attr.POS, true);
        ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        ddraw.setVtxDesc(GX.Attr.CLR0, true);
        ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        ddraw.setVtxDesc(GX.Attr.TEX0, true);
    }

    private setSceneParams(renderInst: GfxRenderInst, w: number, h: number): void {
        let offs = renderInst.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(GX_Program.ub_SceneParams);
        computeProjectionMatrixFromCuboid(sceneParams.u_Projection, 0, w, 0, h, -10000.0, 10000.0);
        fillSceneParamsData(d, offs, sceneParams);
    }

    private setPacketParams(renderInst: GfxRenderInst): void {
        let offs = renderInst.allocateUniformBuffer(GX_Program.ub_DrawParams, 16);
        const d = renderInst.mapUniformBufferF32(GX_Program.ub_DrawParams);
        mat4.identity(scratchMatrix);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
    }

    public drawString(renderInstManager: GfxRenderInstManager, desc: GfxrRenderTargetDescription, str: string, x: number, y: number): void {
        this.ddraw.beginDraw();

        this.charWriter.calcRect(scratchVec4, str);

        // Center align
        const rx0 = scratchVec4[0], rx1 = scratchVec4[2];
        const w = rx1 - rx0;
        x -= w / 2;

        colorCopy(this.charWriter.color1, this.textColor);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        this.setSceneParams(template, desc.width, desc.height);
        this.setPacketParams(template);
        vec3.set(this.charWriter.cursor, x, desc.height - y, 0);
        this.charWriter.drawString(renderInstManager.device, renderInstManager, this.ddraw, str);
        renderInstManager.popTemplateRenderInst();

        this.ddraw.endAndUpload(renderInstManager.device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.fontData.destroy(device);
        this.ddraw.destroy(device);
    }
}

export async function makeDebugTextDrawer(context: SceneContext): Promise<DebugTextDrawer> {
    return context.dataShare.ensureObject<DebugTextDrawer>(`DebugTextDrawer`, async () => {
        const fontArcData = await context.dataFetcher.fetchData(`SuperMarioGalaxy/LayoutData/Font.arc`);
        const fontArc = JKRArchive.parse(await decompress(fontArcData));
        const fontData = new ResFont(context.device, parseBRFNT(fontArc.findFileData(`messagefont26.brfnt`)!));
        return new DebugTextDrawer(context, fontData);
    });
}
