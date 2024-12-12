import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { align, assert, readString } from "../../util.js";
import { Color, colorNewFromRGBA8 } from "../../Color.js";
import { GfxRenderInst, GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import * as GX_Material from '../../gx/gx_material.js';
import * as GX from '../../gx/gx_enum.js';
import { DrawParams, fillSceneParamsData, GXMaterialHelperGfx, MaterialParams, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render.js";
import { GfxClipSpaceNearZ, GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { computeModelMatrixT, projectionMatrixForCuboid } from "../../MathHelpers.js";
import { projectionMatrixConvertClipSpaceNearZ } from "../../gfx/helpers/ProjectionHelpers.js";
import { TSDraw } from "../../SuperMarioGalaxy/DDraw.js";
import { BTIData } from "./JUTTexture.js";
import { GXMaterialBuilder } from "../../gx/GXMaterialBuilder.js";
import { mat4, vec2, vec4 } from "gl-matrix";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";

//#region  Scratch
const materialParams = new MaterialParams();
const drawParams = new DrawParams();

const scratchVec4a = vec4.create();
const scratchMat = mat4.create();
//#endregion

//#region  Helpers
interface ResRef {
    type: number;
    name: string;
}

function parseResourceReference(dst: ResRef, buffer: ArrayBufferSlice, offset: number): number {
    const dataView = buffer.createDataView();
    dst.type = dataView.getUint8(offset + 0);
    const nameLen = dataView.getUint8(offset + 1);
    dst.name = readString(buffer, offset + 2, nameLen);

    if (dst.type == 2 || dst.type == 3 || dst.type == 4) {
        dst.name = "";
    }

    return nameLen + 2;
}
//#endregion

//#region INF1
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
    return {width, height, color: colorNewFromRGBA8(color)};
}
//#endregion

//#region J2DPicture
interface PIC1 extends PAN1 {
    timg: ResRef;
    tlut: ResRef;
    binding: number;
    flags: number;
    colorBlack: Color;
    colorWhite: Color;
    colorCorner: Color;
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
    let colorCorner = 0xFFFFFFFF;

    if( dataCount >= 4) { flags = view.getUint8(offset + 0); }
    if( dataCount >= 6) { colorBlack = view.getUint32(offset + 2); }
    if( dataCount >= 7) { colorWhite = view.getUint32(offset + 6); }
    if( dataCount >= 8) { colorCorner = view.getUint32(offset + 10); }

    return {...pane, timg, tlut, binding, flags, colorBlack: colorNewFromRGBA8(colorBlack), 
        colorWhite: colorNewFromRGBA8(colorWhite), colorCorner: colorNewFromRGBA8(colorCorner) };
}
//#endregion J2DPicture

//#region J2Pane
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
    let alpha = 0;
    let inheritAlpha = true;

    if(dataCount >= 7) { rot = view.getUint16(offset); offset += 2; }
    if(dataCount >= 8) { basePos = view.getUint8(offset); offset += 1; }
    if(dataCount >= 9) { alpha = view.getUint8(offset); offset += 1; }
    if(dataCount >= 10) { inheritAlpha = !!view.getUint8(offset); offset += 1; }

    offset = align(offset, 4);
    return { parent, type, visible, tag, x, y, w, h, rot, basePos, alpha, inheritAlpha, offset, children: [] };
}
//#endregion J2Pane

//#region J2Screen
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
        while(shouldContinue) {
            const magic = readString(buffer, j2d.offs, 4);
            const chunkSize = j2d.view.getUint32(j2d.offs + 4);

            switch(magic) {
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
        for( const pane of panes ) {
            if( pane.parent ) {
                pane.parent.children.push(pane);
            }
        }

        return { inf1, panes };
    }
}

//#endregion J2Screen
// TODO: Move and reorganize
export class J2DGrafContext {
    sceneParams = new SceneParams();

    constructor(device: GfxDevice) {
        projectionMatrixForCuboid(this.sceneParams.u_Projection, 0, 1, 0, 1, -1, 1);
        const clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixConvertClipSpaceNearZ(this.sceneParams.u_Projection, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
    }

    public setOnRenderInst(renderInst: GfxRenderInst) {
        const sceneParamsOffs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams), sceneParamsOffs, this.sceneParams);
    }
}

//#region J2DPane
export class J2DPane {
    public children: J2DPane[] = []; // @TODO: Make private, provide search mechanism
    private parent: J2DPane | null = null;

    public drawMtx = mat4.create();
    public drawAlpha = 1.0;
    public drawPos = vec2.create();
    public drawRange = vec2.create();

    constructor(public data: PAN1, cache: GfxRenderCache, parent: J2DPane | null = null ) {
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
    }

    // NOTE: Overwritten by child classes 
    public drawSelf(renderInstManager: GfxRenderInstManager, offsetX: number, offsetY: number, ctx: J2DGrafContext) {}

    public draw(ctx: J2DGrafContext, renderInstManager: GfxRenderInstManager, offsetX: number = 0, offsetY: number = 0, clip: boolean = true): void {
        const boundsValid = this.data.w > 0 && this.data.h > 0;

        if(this.data.visible && boundsValid) {
            // Src data is in GameCube pixels (640x480), convert to normalized screen coordinates [0-1]. 
            vec2.set(this.drawPos, this.data.x / 640, this.data.y / 480);
            vec2.set(this.drawRange, this.data.w / 480 /* TODO: Multiply by aspect */ , this.data.h / 480);
            this.drawAlpha = this.data.alpha / 0xFF;

            if(this.parent) {
                this.makeMatrix();
                mat4.mul(this.drawMtx, this.parent.drawMtx, this.drawMtx );
                if(this.data.inheritAlpha) {
                    this.drawAlpha *= this.parent.drawAlpha;
                }
            } else {
                // Offsets only affect the root pane
                this.drawPos[0] += offsetX;
                this.drawPos[1] += offsetY;
                this.makeMatrix();
            }

            if(this.drawRange[0] > 0 && this.drawRange[1] > 0) {
                this.drawSelf(renderInstManager, offsetX, offsetY, ctx);
                for (const pane of this.children) {
                    pane.draw(ctx, renderInstManager, offsetX, offsetY, clip);
                }
            }
        }
    }

    public destroy(device: GfxDevice): void {
        // TODO: Destroy children
    }

    private makeMatrix() {
        if (this.data.rot != 0) {
            debugger; // Untested
            // TODO:
            // MTXTrans(stack1, -mBasePosition.x, -mBasePosition.y, 0.0f);
            // f32 rot = mRotationAxis == ROTATE_Z ? -mRotation : mRotation;
            // MTXRotDeg(stack2, mRotationAxis, rot);
            // MTXTrans(stack3, mBasePosition.x + x, mBasePosition.y + y, 0.0f);
            // MTXConcat(stack2, stack1, mMtx);
            // MTXConcat(stack3, mMtx, mMtx);
        } else {
            computeModelMatrixT(this.drawMtx, this.drawPos[0], this.drawPos[1], 0 );
        }
    }
}
//#endregion

//#region J2DPicture
export class J2DPicture extends J2DPane {
    private sdraw = new TSDraw(); // TODO: Time to move TSDraw out of Mario Galaxy?
    private materialHelper: GXMaterialHelperGfx;
    public tex: BTIData; // TODO: Make private

    constructor(data: PAN1, cache: GfxRenderCache, parent: J2DPane | null ) {
        super(data, cache, parent);
        
        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxDesc(GX.Attr.TEX0, true);

        this.sdraw.beginDraw(cache);
        this.sdraw.begin(GX.Command.DRAW_QUADS, 4);
        this.sdraw.position3f32(0, 0, 0);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
        this.sdraw.position3f32(0, 1, 0);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, 0, 0);
        this.sdraw.position3f32(1, 1, 0);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, 1, 0);
        this.sdraw.position3f32(1, 0, 0);
        this.sdraw.texCoord2f32(GX.Attr.TEX0, 1, 1);
        this.sdraw.end();
        this.sdraw.endDraw(cache);

        const mb = new GXMaterialBuilder('J2DPane');
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public override drawSelf(renderInstManager: GfxRenderInstManager, offsetX: number, offsetY: number, ctx2D: J2DGrafContext): void {
        renderInstManager.pushTemplate();
        const renderInst = renderInstManager.newRenderInst();

        ctx2D.setOnRenderInst(renderInst);
        this.sdraw.setOnRenderInst(renderInst);
        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        
        const scale = mat4.fromScaling(scratchMat, [this.drawRange[0], this.drawRange[1], 1])
        mat4.mul(drawParams.u_PosMtx[0], this.drawMtx, scale);
        this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public override destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}
//#endregion