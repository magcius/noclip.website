
import { SceneContext } from "../../SceneBase";
import { GfxDevice } from "../platform/GfxPlatform";

import * as GX from '../../gx/gx_enum';
import { GfxRenderInst, GfxRenderInstManager } from "../render/GfxRenderInstManager";
import { fillMatrix4x3 } from "./UniformBufferHelpers";
import { mat4, vec3, vec4 } from "gl-matrix";
import { computeProjectionMatrixFromCuboid, MathConstants } from "../../MathHelpers";
import { colorCopy, colorNewCopy, OpaqueBlack, White } from "../../Color";

// TODO(jstpierre): Don't use the Super Mario Galaxy system for this... use our own font data,
// or use HTML5 canvas? It would be helpful to have in any case...
import { CharWriter, parseBRFNT, ResFont } from "../../Common/NW4R/lyt/Font";
import { decompress } from "../../Common/Compression/Yaz0";
import * as JKRArchive from "../../Common/JSYSTEM/JKRArchive";
import { TDDraw } from "../../SuperMarioGalaxy/DDraw";
import { GX_Program } from "../../gx/gx_material";
import { fillSceneParamsData, gxBindingLayouts, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render";

const scratchMatrix = mat4.create();
const scratchVec4 = vec4.create();
const sceneParams = new SceneParams();

export class DebugTextDrawer {
    private charWriter = new CharWriter();
    private ddraw = new TDDraw();

    public textColor = colorNewCopy(White);
    public strokeColor = colorNewCopy(OpaqueBlack);

    constructor(private fontData: ResFont) {
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

    public beginDraw(): void {
        this.ddraw.beginDraw();
    }

    public endDraw(renderInstManager: GfxRenderInstManager): void {
        this.ddraw.endAndUpload(renderInstManager);
    }

    public setFontScale(scale: number): void {
        this.charWriter.scale[0] = scale;
        this.charWriter.scale[1] = scale;
    }

    public drawString(renderInstManager: GfxRenderInstManager, vw: number, vh: number, str: string, x: number, y: number, strokeWidth = 1, strokeNum = 4): void {
        this.charWriter.calcRect(scratchVec4, str);

        // Center align
        const rx0 = scratchVec4[0], rx1 = scratchVec4[2];
        const w = rx1 - rx0;
        x -= w / 2;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        this.setSceneParams(template, vw, vh);
        this.setPacketParams(template);

        // Stroke
        colorCopy(this.charWriter.color1, this.strokeColor);
        for (let i = 0; i < strokeNum; i++) {
            const theta = i * MathConstants.TAU / strokeNum;
            const sy = strokeWidth * Math.sin(theta), sx = strokeWidth * Math.cos(theta);
            vec3.set(this.charWriter.cursor, x + sx, y + sy, 0);
            this.charWriter.drawString(renderInstManager, this.ddraw, str);
        }

        // Main fill
        colorCopy(this.charWriter.color1, this.textColor);
        vec3.set(this.charWriter.cursor, x, y, 0);
        this.charWriter.drawString(renderInstManager, this.ddraw, str);

        renderInstManager.popTemplateRenderInst();
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
        return new DebugTextDrawer(fontData);
    });
}
