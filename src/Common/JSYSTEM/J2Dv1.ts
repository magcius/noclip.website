// Nintendo 2D rendering, version 1. Used by Wind Waker. 
// Twilight Princess (and likely newer titles), use J2D version 2. 

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { align, assert, readString } from "../../util.js";
import { Color, colorEqual, colorNewFromRGBA8, OpaqueBlack, TransparentBlack, White } from "../../Color.js";
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
import { mat4, vec2 } from "gl-matrix";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";

const materialParams = new MaterialParams();
const drawParams = new DrawParams();

const scratchMat = mat4.create();

export const enum JUTResType {
    TIMG, TLUT, FONT,
}

export type JUTResAssetType<T extends JUTResType> =
    T extends JUTResType.TIMG ? BTIData :
    T extends JUTResType.TLUT ? null :
    T extends JUTResType.FONT ? null :
    unknown;

// TODO: Find a better home for this
export type ResourceResolver<T extends JUTResType> = (resType: T, resName: string) => JUTResAssetType<T> | null;

interface ResRef {
    refType: number;
    resType: JUTResType;
    resName: string;
    arcName: string | null;
    _nextOffset: number;
}

function parseResourceReference(buffer: ArrayBufferSlice, offset: number, resType: JUTResType, arcName: string | null): ResRef {
    const dataView = buffer.createDataView();
    const refType = dataView.getUint8(offset + 0);
    const nameLen = dataView.getUint8(offset + 1);
    const resName = readString(buffer, offset + 2, nameLen);

    const nextOffset = offset + nameLen + 2;
    return { refType, resType, resName, arcName, _nextOffset: nextOffset };
}

/**
 * If set, the UVs for a quad will be pinned (bound) to the quad edge. If not set, the UVs will be clipped by the quad. 
 * For instance, if the texture is 200 pixels wide, but the quad is 100 pixels wide and Right is not set, the texture 
 * will be clipped by half. If both Left and Right are set, the texture will be squashed to fit within the quad.
 */
const enum J2DUVBinding {
    Bottom = (1 << 0),
    Top = (1 << 1),
    Right = (1 << 2),
    Left = (1 << 3),
};

export class J2DGrafContext {
    public sceneParams = new SceneParams();
    public aspectRatio: number;

    constructor(device: GfxDevice, x: number, y: number, private w: number, private h: number, far: number, near: number) {
        this.aspectRatio = w / h;
        // NOTE: Y axis is inverted here (bottom = height), to match the original J2D convention
        projectionMatrixForCuboid(this.sceneParams.u_Projection, x, w, h, y, near, far);
        const clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixConvertClipSpaceNearZ(this.sceneParams.u_Projection, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
    }

    public setupView(backbufferWidth: number, backbufferHeight: number): void {
        const screenAspect = backbufferWidth / backbufferHeight;
        const grafAspect = this.w / this.h;
        this.aspectRatio = grafAspect / screenAspect;
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        const d = renderInst.allocateUniformBufferF32(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, this.sceneParams);
    }
}

//#region Loading/INF1
export interface INF1 {
    width: number;
    height: number;
    color: Color;
}

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    const width = view.getUint16(0x08, false);
    const height = view.getUint16(0x0A, false);
    const color = colorNewFromRGBA8(view.getUint32(0x0C, false));
    return { width, height, color };
}
//#endregion

//#region Loading/J2DPicture
interface PIC1 extends PAN1 {
    timg: ResRef;
    tlut: ResRef;
    uvBinding: number;
    flags: number;
    colorBlack: Color;
    colorWhite: Color;
    colorCorners: Color[];
}

function readPIC1Chunk(buffer: ArrayBufferSlice, parent: PAN1 | null): PIC1 {
    const view = buffer.createDataView();

    const pane = readPAN1Chunk(buffer, parent);

    const dataCount = view.getUint8(pane.offset + 0x00);
    let offset = pane.offset + 1;

    const timg = parseResourceReference(buffer, offset, JUTResType.TIMG, null);
    const tlut = parseResourceReference(buffer, timg._nextOffset, JUTResType.TLUT, null);
    const binding = view.getUint8(tlut._nextOffset);
    offset = tlut._nextOffset + 1;

    let flags = 0;
    let colorBlack = TransparentBlack;
    let colorWhite = White;
    let colorCorners = [White, White, White, White];

    if (dataCount >= 4) { flags = view.getUint8(offset + 0x00); }
    if (dataCount >= 6) { colorBlack = colorNewFromRGBA8(view.getUint32(offset + 0x02)); }
    if (dataCount >= 7) { colorWhite = colorNewFromRGBA8(view.getUint32(offset + 0x06)); }
    if (dataCount >= 8) { colorCorners[0] = colorNewFromRGBA8(view.getUint32(offset + 0x0A)); }
    if (dataCount >= 9) { colorCorners[1] = colorNewFromRGBA8(view.getUint32(offset + 0x0E)); }
    if (dataCount >= 10) { colorCorners[2] = colorNewFromRGBA8(view.getUint32(offset + 0x12)); }
    if (dataCount >= 11) { colorCorners[3] = colorNewFromRGBA8(view.getUint32(offset + 0x16)); }

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
    let tag = readString(buffer, offset + 4, 4, false);
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
export interface SCRN extends PAN1 {
    color: Color
}

export class BLO {
    public static parse(buffer: ArrayBufferSlice): SCRN {
        const j2d = new JSystemFileReaderHelper(buffer);
        assert(j2d.magic === 'SCRNblo1');

        const inf1 = readINF1Chunk(j2d.nextChunk('INF1'));
        const panes: PAN1[] = [];

        const screen: SCRN = {
            parent: null, type: 'SCRN', children: [], visible: true, 
            x: 0, y: 0, w: inf1.width, h: inf1.height, color: inf1.color, rot: 0, tag: '', basePos: 0, 
            alpha: inf1.color.a, inheritAlpha: false, offset: 0,
        };

        let parentStack: (PAN1 | null)[] = [screen];
        outer: while (true) {
            const magic = readString(buffer, j2d.offs, 4);
            const chunkSize = j2d.view.getUint32(j2d.offs + 4);

            switch (magic) {
                // Panel Types
                case 'PAN1': panes.push(readPAN1Chunk(j2d.nextChunk('PAN1'), parentStack[parentStack.length - 1])); break;
                case 'PIC1': panes.push(readPIC1Chunk(j2d.nextChunk('PIC1'), parentStack[parentStack.length - 1])); break;
                // case 'WIN1': readWIN1Chunk(j2d.nextChunk('WIN1')); break;
                // case 'TBX1': readTBX1Chunk(j2d.nextChunk('TBX1')); break;

                // Hierarchy
                case 'EXT1': break outer;
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

        return screen;
    }
}

//#endregion Loading/J2Screen

//#region J2DPane
export class J2DPane {
    public children: J2DPane[] = []; // @TODO: Make private, provide search mechanism
    private parent: J2DPane | null = null;

    protected drawMtx = mat4.create();
    protected drawAlpha = 1.0;
    protected drawPos = vec2.create();
    protected drawDimensions = vec2.create();

    constructor(public data: PAN1, cache: GfxRenderCache, parent: J2DPane | null = null) {
        this.parent = parent;
        for (const pane of data.children) {
            switch (pane.type) {
                case 'PAN1': this.children.push(new J2DPane(pane, cache, this)); break;
                case 'PIC1': this.children.push(new J2DPicture(pane, cache, this)); break;
                // case 'WIN1': this.children.push(new J2DWindow(pane)); break;
                // case 'TBX1': this.children.push(new J2DTextBox(pane)); break;
                default: console.warn('Unsupported J2D type:', pane.type); break;
            }
        }

        if (this.data.basePos !== 0)
            console.warn(`Untested J2D feature: basePosition ${this.data.basePos}`);
        if (this.data.rot !== 0)
            console.warn(`Untested J2D feature: rot ${this.data.rot}`);
    }

    public show(): void {
        this.data.visible = true;
    }

    public hide(): void {
        this.data.visible = false;
    }

    public setAlpha(alpha: number) { 
        this.data.alpha = alpha * 0xFF; 
    }
    
    public getAlpha(alpha: number) { 
        this.data.alpha = alpha / 0xFF; 
    }

    // NOTE: Overwritten by child classes which actually do some rendering, such as J2DPicture
    public drawSelf(renderInstManager: GfxRenderInstManager, ctx2D: J2DGrafContext, offsetX: number, offsetY: number) {
    }

    public draw(renderInstManager: GfxRenderInstManager, ctx2D: J2DGrafContext, offsetX: number = 0, offsetY: number = 0, clip: boolean = true): void {
        const boundsValid = this.data.w > 0 && this.data.h > 0;

        if (this.data.visible && boundsValid) {
            // To support dynamic aspect ratios, we keep the original screenspace height and the original aspect ratio. 
            // So changing the window width will not cause 2D elements to scale, but changing the window height will. 
            vec2.set(this.drawPos, this.data.x, this.data.y);
            vec2.set(this.drawDimensions, this.data.w * ctx2D.aspectRatio, this.data.h);
            this.drawAlpha = this.data.alpha / 0xFF;

            if (this.parent) {
                this.makeMatrix();
                mat4.mul(this.drawMtx, this.parent.drawMtx, this.drawMtx);
                if (this.data.inheritAlpha)
                    this.drawAlpha *= this.parent.drawAlpha;
            } else {
                // Offsets only affect the root pane
                this.drawPos[0] += offsetX;
                this.drawPos[1] += offsetY;
                this.makeMatrix();
            }

            if (this.drawDimensions[0] > 0 && this.drawDimensions[1] > 0) {
                this.drawSelf(renderInstManager, ctx2D, offsetX, offsetY);
                for (let i = 0; i < this.children.length; i++)
                    this.children[i].draw(renderInstManager, ctx2D, offsetX, offsetY, clip);
            }
        }
    }
    
    public search(tag: string): J2DPane | null {
        if (this.data.tag === tag)
            return this;

        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            const res = child.search(tag);
            if (res !== null)
                return res;
        }

        return null;
    }

    private makeMatrix(): void {
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

    protected resolveReferences(resolver: ResourceResolver<JUTResType>): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].resolveReferences(resolver);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}
//#endregion

//#region J2DPicture
export class J2DPicture extends J2DPane {
    public override data: PIC1;

    private sdraw: TSDraw | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private tex: BTIData | null = null;

    constructor(data: PAN1, private cache: GfxRenderCache, parent: J2DPane | null) {
        super(data, cache, parent);

        if (this.data.uvBinding !== 15) { console.warn('Untested J2D feature'); }
        if (this.data.flags !== 0) { console.warn('Untested J2D feature'); }
        if (!colorEqual(this.data.colorCorners[0], White) || !colorEqual(this.data.colorCorners[1], White) || !colorEqual(this.data.colorCorners[2], White) || !colorEqual(this.data.colorCorners[3], White))
            console.warn(`Untested J2D feature colorCorners ${this.data.colorCorners}`);
    }

    public setTexture(tex: BTIData) {
        this.tex = tex;
        this.prepare();
    }

    public override drawSelf(renderInstManager: GfxRenderInstManager, ctx2D: J2DGrafContext, offsetX: number, offsetY: number): void {
        if (this.tex === null || this.sdraw === null)
            return;

        renderInstManager.pushTemplate();
        const renderInst = renderInstManager.newRenderInst();

        ctx2D.setOnRenderInst(renderInst);
        this.sdraw.setOnRenderInst(renderInst);
        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        materialParams.u_Color[ColorKind.C0] = this.data.colorBlack;
        materialParams.u_Color[ColorKind.C1] = this.data.colorWhite;
        materialParams.u_Color[ColorKind.C2].a = this.drawAlpha;

        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        const scale = mat4.fromScaling(scratchMat, [this.drawDimensions[0], this.drawDimensions[1], 1]);
        mat4.mul(drawParams.u_PosMtx[0], this.drawMtx, scale);
        this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public override destroy(device: GfxDevice): void {
        if (this.sdraw !== null) {
            this.sdraw.destroy(device);
            this.sdraw = null;
        }
    }

    private prepare() {
        assert(this.tex !== null);

        if (this.sdraw !== null)
            this.sdraw.destroy(this.cache.device);
        this.sdraw = new TSDraw();

        let u0, v0, v1, u1;
        const texDimensions = [this.tex.btiTexture.width, this.tex.btiTexture.height];
        const bindLeft = this.data.uvBinding & J2DUVBinding.Left;
        const bindRight = this.data.uvBinding & J2DUVBinding.Right;
        const bindTop = this.data.uvBinding & J2DUVBinding.Top;
        const bindBottom = this.data.uvBinding & J2DUVBinding.Bottom;

        const aspectX = (this.drawDimensions[0] / texDimensions[0]);
        const aspectY = (this.drawDimensions[1] / texDimensions[1]);

        if (bindLeft) {
            u0 = 0.0;
            u1 = bindRight ? 1.0 : aspectX;
        } else if (bindRight) {
            u0 = 1.0 - aspectX;
            u1 = 1.0;
        } else {
            u0 = 0.5 - aspectX / 2.0;
            u1 = 0.5 + aspectX / 2.0;
        }

        if (bindTop) {
            v0 = 0.0;
            v1 = bindBottom ? 1.0 : aspectY;
        } else if (bindBottom) {
            v0 = 1.0 - aspectY;
            v1 = 1.0;
        } else {
            v0 = 0.5 - aspectY / 2.0;
            v1 = 0.5 + aspectY / 2.0;
        }

        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxDesc(GX.Attr.TEX0, true);
        this.sdraw.setVtxDesc(GX.Attr.CLR0, true);

        this.sdraw.beginDraw(this.cache);
        this.sdraw.begin(GX.Command.DRAW_QUADS, 4);
        this.sdraw.position3f32(0, 0, 0);
        this.sdraw.color4color(GX.Attr.CLR0, this.data.colorCorners[0]);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u0, v0);
        this.sdraw.position3f32(1, 0, 0);
        this.sdraw.color4color(GX.Attr.CLR0, this.data.colorCorners[2]);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u1, v0);
        this.sdraw.position3f32(1, 1, 0);
        this.sdraw.color4color(GX.Attr.CLR0, this.data.colorCorners[3]);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u1, v1);
        this.sdraw.position3f32(0, 1, 0);
        this.sdraw.color4color(GX.Attr.CLR0, this.data.colorCorners[1]);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, u0, v1);
        this.sdraw.end();
        this.sdraw.endDraw(this.cache);

        const mb = new GXMaterialBuilder('J2DPane');
        let tevStage = 0;

        // Assume alpha is enabled. This is byte 1 on a JUTTexture, but noclip doesn't read it
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        
        // 0: Multiply tex and vertex colors and alpha
        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        tevStage += 1;

        // 1: Lerp between the Black and White colors based on previous stage result
        if (!colorEqual(this.data.colorBlack, TransparentBlack) || !colorEqual(this.data.colorWhite, White)) {
            mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
            mb.setTevColorIn(tevStage, GX.CC.C0, GX.CC.C1, GX.CC.CPREV, GX.CC.ZERO);
            mb.setTevAlphaIn(tevStage, GX.CA.A0, GX.CA.A1, GX.CA.APREV, GX.CA.ZERO);
            mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            tevStage += 1;
        }

        // 2: Multiply result alpha by dynamic alpha (this.drawAlpha)
        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(tevStage, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.APREV, GX.CA.A2, GX.CA.ZERO);
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        tevStage += 1;

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.SET);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    protected override resolveReferences(resolver: ResourceResolver<JUTResType.TIMG>): void {
        const timg = this.data.timg;
         if (timg.refType > 1) {
            if (timg.refType !== 2)
                console.warn(`Untested J2D feature refType ${timg.refType}`);
            this.tex = resolver(JUTResType.TIMG, timg.resName);
            if (this.tex !== null)
                this.prepare();
        }

        assert(this.data.tlut.refType === 0, 'TLUT references currently unsupported');
    }
}
//#endregion

//#region J2DScreen
export class J2DScreen extends J2DPane {
    public color: Color;

    constructor(data: SCRN, cache: GfxRenderCache, resolver: ResourceResolver<JUTResType>) {
        super(data, cache, null);
        this.color = data.color;
        this.resolveReferences(resolver);
    }

    public override draw(renderInstManager: GfxRenderInstManager, ctx2D: J2DGrafContext, offsetX?: number, offsetY?: number): void {
        super.draw(renderInstManager, ctx2D, offsetX, offsetY);
    }

    public override search(tag: string) {
        if (tag === '')
            return null;
        return super.search(tag);
    }
}

//#endregion
