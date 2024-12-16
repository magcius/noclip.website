// Nintendo 2D rendering, version 1. Used by Wind Waker. 
// Twilight Princess (and likely newer titles), use J2D version 2. 

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { align, assert, readString } from "../../util.js";
import { Color, colorNewFromRGBA8 } from "../../Color.js";
import { GfxRenderInst, GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import * as GX_Material from '../../gx/gx_material.js';
import * as GX from '../../gx/gx_enum.js';
import { ColorKind, DrawParams, fillSceneParamsData, GXMaterialHelperGfx, MaterialParams, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render.js";
import { GfxClipSpaceNearZ, GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { computeModelMatrixT, projectionMatrixForCuboid } from "../../MathHelpers.js";
import { projectionMatrixConvertClipSpaceNearZ } from "../../gfx/helpers/ProjectionHelpers.js";
import { TSDraw } from "../../SuperMarioGalaxy/DDraw.js";
import { BTIData } from "./JUTTexture.js";
import { GXMaterialBuilder } from "../../gx/GXMaterialBuilder.js";
import { mat4, vec2, vec4 } from "gl-matrix";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { ViewerRenderInput } from "../../viewer.js";

const materialParams = new MaterialParams();
const drawParams = new DrawParams();

const scratchMat = mat4.create();

interface ResRef {
    type: number;
    name: string;
}

function parseResourceReference(dst: ResRef, buffer: ArrayBufferSlice, offset: number): number {
    const dataView = buffer.createDataView();
    dst.type = dataView.getUint8(offset + 0);
    const nameLen = dataView.getUint8(offset + 1);
    dst.name = readString(buffer, offset + 2, nameLen);

    if (dst.type === 2 || dst.type === 3 || dst.type === 4) {
        dst.name = "";
    }

    return nameLen + 2;
}

/**
 * If set, the UVs for a quad will be pinned (bound) to the quad edge. If not set, the UVs will be clipped by the quad. 
 * For instance, if the texture is 200 pixels wide, but the quad is 100 pixels wide and Right is not set, the texture 
 * will be clipped by half. If both Left and Right are set, the texture will be squashed to fit within the quad.
 */
enum J2DUVBinding {
    Bottom = (1 << 0),
    Top = (1 << 1),
    Right = (1 << 2),
    Left = (1 << 3),
};


// TODO: Move and reorganize
export class J2DGrafContext {
    private sceneParams = new SceneParams();
    public aspectRatio: number;

    constructor(device: GfxDevice, x: number, y: number, w: number, h: number, far: number, near: number) {
        this.aspectRatio = w / h;
        // NOTE: Y axis is inverted here (bottom = height), to match the original J2D convention
        projectionMatrixForCuboid(this.sceneParams.u_Projection, x, w, h, y, near, far);
        const clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixConvertClipSpaceNearZ(this.sceneParams.u_Projection, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
    }

    public setOnRenderInst(renderInst: GfxRenderInst) {
        const sceneParamsOffs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams), sceneParamsOffs, this.sceneParams);
    }
}

//#region Loading/INF1
export interface INF1 {
    width: number;
    height: number;
    color: Color
}

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    const width = view.getUint16(8);
    const height = view.getUint16(10);
    const color = view.getUint32(12);
    return { width, height, color: colorNewFromRGBA8(color) };
}
//#endregion

//#region Loading/J2DPicture
interface PIC1 extends PAN1 {
    timg: ResRef;
    tlut: ResRef;
    uvBinding: number;
    flags: number;
    colorBlack: number;
    colorWhite: number;
    colorCorners: number[];
}

function readPIC1Chunk(buffer: ArrayBufferSlice, parent: PAN1 | null): PIC1 {
    const view = buffer.createDataView();

    const pane = readPAN1Chunk(buffer, parent);

    const dataCount = view.getUint8(pane.offset + 0);
    let offset = pane.offset + 1;

    const timg = { type: 0, name: "" };
    const tlut = { type: 0, name: "" };
    offset += parseResourceReference(timg, buffer, offset);
    offset += parseResourceReference(tlut, buffer, offset);
    const binding = view.getUint8(offset);
    offset += 1;

    let flags = 0;
    let colorBlack = 0x0;
    let colorWhite = 0xFFFFFFFF;
    let colorCorners = [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF];

    if (dataCount >= 4) { flags = view.getUint8(offset + 0); }
    if (dataCount >= 6) { colorBlack = view.getUint32(offset + 2); }
    if (dataCount >= 7) { colorWhite = view.getUint32(offset + 6); }
    if (dataCount >= 8) { colorCorners[0] = view.getUint32(offset + 10); }
    if (dataCount >= 9) { colorCorners[1] = view.getUint32(offset + 10); }
    if (dataCount >= 10) { colorCorners[2] = view.getUint32(offset + 10); }
    if (dataCount >= 11) { colorCorners[3] = view.getUint32(offset + 10); }

    return { ...pane, timg, tlut, uvBinding: binding, flags, colorBlack, colorWhite, colorCorners };
}
//#endregion Loading/J2DPicture

//#region Loading/J2Pane
interface PAN1 {
    parent: PAN1 | null;
    type: string;
    children: PAN1[];
    visible: boolean;
    tag: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rot: number;
    basePos: number;
    alpha: number;
    inheritAlpha: boolean;

    offset: number; // For parsing only
}

function readPAN1Chunk(buffer: ArrayBufferSlice, parent: PAN1 | null): PAN1 {
    const view = buffer.createDataView();
    const type = readString(buffer, 0, 4);
    let offset = 8;

    const dataCount = view.getUint8(offset + 0);

    const visible = !!view.getUint8(offset + 1);
    const tag = readString(buffer, offset + 4, 4);
    const x = view.getInt16(offset + 8);
    const y = view.getInt16(offset + 10);
    const w = view.getInt16(offset + 12);
    const h = view.getInt16(offset + 14);
    offset += 16;

    let rot = 0;
    let basePos = 0;
    let alpha = 0xFF;
    let inheritAlpha = true;

    if (dataCount >= 7) { rot = view.getUint16(offset); offset += 2; }
    if (dataCount >= 8) { basePos = view.getUint8(offset); offset += 1; }
    if (dataCount >= 9) { alpha = view.getUint8(offset); offset += 1; }
    if (dataCount >= 10) { inheritAlpha = !!view.getUint8(offset); offset += 1; }

    offset = align(offset, 4);
    return { parent, type, visible, tag, x, y, w, h, rot, basePos, alpha, inheritAlpha, offset, children: [] };
}
//#endregion Loading/J2Pane

//#region Loading/J2Screen
export interface SCRN {
    inf1: INF1;
    panes: PAN1[];
}

export class BLO {
    public static parse(buffer: ArrayBufferSlice): SCRN {
        const j2d = new JSystemFileReaderHelper(buffer);
        assert(j2d.magic === 'SCRNblo1');

        const inf1 = readINF1Chunk(j2d.nextChunk('INF1'))
        const panes: PAN1[] = [];

        let parentStack: (PAN1 | null)[] = [null];
        let shouldContinue = true;
        while (shouldContinue) {
            const magic = readString(buffer, j2d.offs, 4);
            const chunkSize = j2d.view.getUint32(j2d.offs + 4);

            switch (magic) {
                // Panel Types
                case 'PAN1': panes.push(readPAN1Chunk(j2d.nextChunk('PAN1'), parentStack[parentStack.length - 1])); break;
                case 'PIC1': panes.push(readPIC1Chunk(j2d.nextChunk('PIC1'), parentStack[parentStack.length - 1])); break;
                // case 'WIN1': readWIN1Chunk(j2d.nextChunk('WIN1')); break;
                // case 'TBX1': readTBX1Chunk(j2d.nextChunk('TBX1')); break;

                // Hierarchy
                case 'EXT1': shouldContinue = false; break;
                case 'BGN1': j2d.offs += chunkSize; parentStack.push(panes[panes.length - 1]); break;
                case 'END1': j2d.offs += chunkSize; parentStack.pop(); break;

                default:
                    console.warn('Unsupported SCRN block:', magic);
                    j2d.offs += chunkSize;
                    break;
            }
        }

        // Generate 'children' lists for each pane
        for (const pane of panes) {
            if (pane.parent) {
                pane.parent.children.push(pane);
            }
        }

        return { inf1, panes };
    }
}

//#endregion Loading/J2Screen

//#region J2DPane
export class J2DPane {
    public children: J2DPane[] = []; // @TODO: Make private, provide search mechanism
    private parent: J2DPane | null = null;

    public drawMtx = mat4.create();
    public drawAlpha = 1.0;
    public drawPos = vec2.create();
    public drawDimensions = vec2.create();

    constructor(public data: PAN1, cache: GfxRenderCache, parent: J2DPane | null = null) {
        this.parent = parent;
        for (const pane of data.children) {
            switch (pane.type) {
                case 'PAN1': this.children.push(new J2DPane(pane, cache, this)); break;
                case 'PIC1': this.children.push(new J2DPicture(pane, cache, this)); break;
                // case 'WIN1': this.children.push(new J2DWindow(pane)); break;
                // case 'TBX1': this.children.push(new J2DTextbox(pane)); break;
                default: console.warn('Unsupported J2D type:', pane.type); break;
            }
        }

        if (this.data.basePos !== 0) { console.warn('Untested J2D feature'); }
        if (this.data.rot !== 0) { console.warn('Untested J2D feature'); }
    }

    // NOTE: Overwritten by child classes which actually do some rendering, such as J2DPicture
    public drawSelf(renderInstManager: GfxRenderInstManager, viewerRenderInput: ViewerRenderInput, ctx2D: J2DGrafContext, offsetX: number, offsetY: number) { }

    public draw(renderInstManager: GfxRenderInstManager, viewerRenderInput: ViewerRenderInput, ctx2D: J2DGrafContext, offsetX: number = 0, offsetY: number = 0, clip: boolean = true): void {
        const boundsValid = this.data.w > 0 && this.data.h > 0;

        if (this.data.visible && boundsValid) {
            // To support dynamic aspect ratios, we keep the original screenspace height and the original aspect ratio. 
            // So changing the window width will not cause 2D elements to scale, but changing the window height will. 
            vec2.set(this.drawPos, this.data.x, this.data.y);
            vec2.set(this.drawDimensions, this.data.w * (ctx2D.aspectRatio / viewerRenderInput.camera.aspect), this.data.h);
            this.drawAlpha = this.data.alpha / 0xFF;

            if (this.parent) {
                this.makeMatrix();
                mat4.mul(this.drawMtx, this.parent.drawMtx, this.drawMtx);
                if (this.data.inheritAlpha) {
                    this.drawAlpha *= this.parent.drawAlpha;
                }
            } else {
                // Offsets only affect the root pane
                this.drawPos[0] += offsetX;
                this.drawPos[1] += offsetY;
                this.makeMatrix();
            }

            if (this.drawDimensions[0] > 0 && this.drawDimensions[1] > 0) {
                this.drawSelf(renderInstManager, viewerRenderInput, ctx2D, offsetX, offsetY);
                for (const pane of this.children) {
                    pane.draw(renderInstManager, viewerRenderInput, ctx2D, offsetX, offsetY, clip);
                }
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (const pane of this.children) {
            pane.destroy(device);
        }
    }

    private makeMatrix() {
        if (this.data.rot !== 0) {
            debugger; // Untested
            // TODO:
            // MTXTrans(stack1, -mBasePosition.x, -mBasePosition.y, 0.0f);
            // f32 rot = mRotationAxis === ROTATE_Z ? -mRotation : mRotation;
            // MTXRotDeg(stack2, mRotationAxis, rot);
            // MTXTrans(stack3, mBasePosition.x + x, mBasePosition.y + y, 0.0f);
            // MTXConcat(stack2, stack1, mMtx);
            // MTXConcat(stack3, mMtx, mMtx);
        } else {
            computeModelMatrixT(this.drawMtx, this.drawPos[0], this.drawPos[1], 0);
        }
    }
}
//#endregion

//#region J2DPicture
export class J2DPicture extends J2DPane {
    public override data: PIC1;

    private sdraw = new TSDraw(); // TODO: Time to move TSDraw out of Mario Galaxy?
    private materialHelper: GXMaterialHelperGfx;
    private tex: BTIData | null = null;

    constructor(data: PAN1, private cache: GfxRenderCache, parent: J2DPane | null) {
        super(data, cache, parent);
        // @TODO: If type > 4, load the image on construction
        if (this.data.timg.type !== 0 && this.data.timg.type !== 2) { console.warn('Untested J2D feature'); }

        if (this.data.tlut.type !== 0) { console.warn('Untested J2D feature'); }
        if (this.data.uvBinding !== 15) { console.warn('Untested J2D feature'); }
        if (this.data.flags !== 0) { console.warn('Untested J2D feature'); }
        if (this.data.colorBlack !== 0 || this.data.colorWhite !== 0xFFFFFFFF) { console.warn('Untested J2D feature'); }
        if (this.data.colorCorners[0] !== 0xFFFFFFFF || this.data.colorCorners[1] !== 0xFFFFFFFF
            || this.data.colorCorners[2] !== 0xFFFFFFFF || this.data.colorCorners[3] !== 0xFFFFFFFF) { console.warn('Untested J2D feature'); }
    }

    public setTexture(tex: BTIData) {
        this.tex = tex;
        this.prepare();
    }

    public override drawSelf(renderInstManager: GfxRenderInstManager, viewerRenderInput: ViewerRenderInput, ctx2D: J2DGrafContext, offsetX: number, offsetY: number): void {
        if (!this.tex) { return; }

        renderInstManager.pushTemplate();
        const renderInst = renderInstManager.newRenderInst();

        ctx2D.setOnRenderInst(renderInst);
        this.sdraw.setOnRenderInst(renderInst);
        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        materialParams.u_Color[ColorKind.C0].a = this.drawAlpha;
        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        const scale = mat4.fromScaling(scratchMat, [this.drawDimensions[0], this.drawDimensions[1], 1])
        mat4.mul(drawParams.u_PosMtx[0], this.drawMtx, scale);
        this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public override destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }

    private prepare() {
        assert(!!this.tex);

        let u0, v0, v1, u1;
        const texDimensions = [this.tex.btiTexture.width, this.tex.btiTexture.height];
        const bindLeft = this.data.uvBinding & J2DUVBinding.Left;
        const bindRight = this.data.uvBinding & J2DUVBinding.Right;
        const bindTop = this.data.uvBinding & J2DUVBinding.Top;
        const bindBottom = this.data.uvBinding & J2DUVBinding.Bottom;

        if (bindLeft) {
            u0 = 0.0;
            u1 = bindRight ? 1.0 : (this.drawDimensions[0] / texDimensions[0]);
        } else if (bindRight) {
            u0 = 1.0 - (this.drawDimensions[0] / texDimensions[0]);
            u1 = 1.0;
        } else {
            u0 = 0.5 - (this.drawDimensions[0] / texDimensions[0]) / 2.0;
            u1 = 0.5 + (this.drawDimensions[0] / texDimensions[0]) / 2.0;
        }

        if (bindTop) {
            v0 = 0.0;
            v1 = bindBottom ? 1.0 : (this.drawDimensions[1] / texDimensions[1]);
        } else if (bindBottom) {
            v0 = 1.0 - (this.drawDimensions[1] / texDimensions[1]);
            v1 = 1.0;
        } else {
            v0 = 0.5 - (this.drawDimensions[1] / texDimensions[1]) / 2.0;
            v1 = 0.5 + (this.drawDimensions[1] / texDimensions[1]) / 2.0;
        }


        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxDesc(GX.Attr.TEX0, true);
        this.sdraw.setVtxDesc(GX.Attr.CLR0, true);

        this.sdraw.beginDraw(this.cache);
        this.sdraw.begin(GX.Command.DRAW_QUADS, 4);
        this.sdraw.position3f32(0, 0, 0);
        this.sdraw.color4color(GX.Attr.CLR0, colorNewFromRGBA8(this.data.colorCorners[0]));
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u0, v0); // 0
        this.sdraw.position3f32(1, 0, 0);
        this.sdraw.color4color(GX.Attr.CLR0, colorNewFromRGBA8(this.data.colorCorners[2]));
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u1, v0); // 1
        this.sdraw.position3f32(1, 1, 0);
        this.sdraw.color4color(GX.Attr.CLR0, colorNewFromRGBA8(this.data.colorCorners[3]));
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u1, v1); // 0
        this.sdraw.position3f32(0, 1, 0);
        this.sdraw.color4color(GX.Attr.CLR0, colorNewFromRGBA8(this.data.colorCorners[1]));
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u0, v1); // 0
        this.sdraw.end();
        this.sdraw.endDraw(this.cache);

        const mb = new GXMaterialBuilder('J2DPane');
        // Assume alpha is enabled. This is byte 1 on a JUTTexture, but noclip doesn't read it
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        // 0: Multiply tex and vertex colors and alpha
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        // 1: Multiply result alpha by dynamic alpha (this.drawAlpha)
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.A0, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.SET);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }
}
//#endregion

//#region J2DScreen
export class J2DScreen extends J2DPane {
    public color: Color
    private static defaultCtx: J2DGrafContext;

    constructor(data: SCRN, cache: GfxRenderCache) {
        super(data.panes[0], cache, null);
        this.color = data.inf1.color;
    }

    override draw(renderInstManager: GfxRenderInstManager, viewerRenderInput: ViewerRenderInput, ctx2D: J2DGrafContext | null, offsetX?: number, offsetY?: number): void {
        if (ctx2D !== null) {
            super.draw(renderInstManager, viewerRenderInput, ctx2D, offsetX, offsetY);
        } else {
            if(!J2DScreen.defaultCtx) { 
                J2DScreen.defaultCtx = new J2DGrafContext(renderInstManager.gfxRenderCache.device, 0.0, 0.0, 640.0, 480.0, -1.0, 0.0);
            }
            super.draw(renderInstManager, viewerRenderInput, J2DScreen.defaultCtx, offsetX, offsetY);
        }
    }
}

//#endregion