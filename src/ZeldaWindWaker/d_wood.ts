
import { dGlobals } from './Main.js';
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { ViewerRenderInput } from '../viewer.js';
import { mat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { dBgS_GndChk } from './d_bg.js';
import { nArray } from '../gfx/platform/GfxPlatformUtil.js';
import { dKy_GxFog_set } from './d_kankyo.js';
import { colorCopy, colorFromRGBA } from '../Color.js';
import { ColorKind, DrawParams, GXMaterialHelperGfx, GXShapeHelperGfx, loadedDataCoalescerComboGfx, MaterialParams } from '../gx/gx_render.js';
import { BTI_Texture, BTIData } from '../Common/JSYSTEM/JUTTexture.js';
import { TextureMapping } from '../TextureHolder.js';
import { GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { compileVtxLoader, DisplayListRegisters, displayListRegistersInitGX, displayListRegistersRun, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc } from '../gx/gx_displaylist.js';
import { parseMaterial } from '../gx/gx_material.js';
import { Endianness } from '../endian.js';
import * as GX from '../gx/gx_enum.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { dKyw_get_wind_pow, dKyw_get_wind_vec } from './d_kankyo_wether.js';
import { cLib_chaseF, cM__Short2Rad, cM_atan2s } from './SComponent.js';
import { dStage_roomStatus_c } from './d_stage.js';
import { mDoMtx_copy, mDoMtx_XrotM, mDoMtx_YrotM, mDoMtx_YrotS, MtxTrans } from './m_do_mtx.js';
import { assert } from '../util.js';
import { scaleMatrix, setMatrixAxis, setMatrixTranslation } from '../MathHelpers.js';

//-----------------------------------------
// Types
//-----------------------------------------
const enum UnitState_e {
    Inactive = 0,
    Active = 1 << 0,
    IsFrustumCulled = 1 << 1,
    IsCut = 1 << 2,
}

const enum AnimMode_e {
    Cut = 0,      // Chopping down
    PushInto = 1, // Attacked or collided with, but not chopped
    PushBack = 2, // Second half of PushInto, returning to normal
    Fan = 3,      // When hit with fan (does nothing)
    Norm = 4,     // Idle animation
    ToNorm = 5,   // Blend back to the normal animation

    _Max
};

enum AttrSway_e {
    Light,
    Medium,
    Strong,
    Extreme,
};

//-----------------------------------------
// Globals
//-----------------------------------------
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchMat4a = mat4.create();
const materialParams = new MaterialParams();
const drawParams = new DrawParams();

const kUnitCount = 200;
const kRoomCount = 64;
const kAnimCount = 72;

const kAlphaCutoff = 0x80 / 0xFF;
const kClipCenterYOffset = 40.0;
const kClipRadius = 100.0;

let sAnimInitNum = 0;
let sAnmNormNum = 0;

//-----------------------------------------
// Extracted Data
//-----------------------------------------
const kSwayAttrs: {
    phaseVelY: number;
    ampY: number;
    phaseVelX: number;
    ampX: number;
    phaseBiasX: number;
}[][] =
    [[{
        phaseVelY: 0x00C8,
        ampY: 0x50,
        phaseVelX: 0x5DC,
        ampX: 0x32,
        phaseBiasX: 0.6
    }, {
        phaseVelY: 0x00B4,
        ampY: 0x1E,
        phaseVelX: 0xC80,
        ampX: 0xA,
        phaseBiasX: 0.2,
    }], [{
        phaseVelY: 0x01f4,
        ampY: 0x96,
        phaseVelX: 0x4B0,
        ampX: 0x96,
        phaseBiasX: 0.6,
    }, {
        phaseVelY: 0x02BC,
        ampY: 0x32,
        phaseVelX: 0x898,
        ampX: 0x1E,
        phaseBiasX: 0.2,
    }], [{
        phaseVelY: 0x0258,
        ampY: 0xC8,
        phaseVelX: 0x898,
        ampX: 0x12C,
        phaseBiasX: 0.6,
    }, {
        phaseVelY: 0x01BC,
        ampY: 0x1E,
        phaseVelX: 0xFA0,
        ampX: 0x32,
        phaseBiasX: 0.2,
    }], [{
        phaseVelY: 0x0258,
        ampY: 0xC8,
        phaseVelX: 0x1838,
        ampX: 0x1F4,
        phaseBiasX: 0.6,
    }, {
        phaseVelY: 0x01BC,
        ampY: 0x1E,
        phaseVelX: 0x3E8,
        ampX: 0x32,
        phaseBiasX: 0.2,
    }]]

//-----------------------------------------
// Helpers
//-----------------------------------------
interface J3DPacket {
    draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
}

//-----------------------------------------
// NoClip Rendering (TODO: Cleanup)
//-----------------------------------------
function parseGxVtxAttrFmtV(buffer: ArrayBufferSlice) {
    const attrFmts = buffer.createTypedArray(Uint32Array, 0, buffer.byteLength / 4, Endianness.BIG_ENDIAN);
    const result: GX_VtxAttrFmt[] = [];
    for (let i = 0; attrFmts[i + 0] !== 255; i += 4) {
        const attr = attrFmts[i + 0];
        const cnt = attrFmts[i + 1];
        const type = attrFmts[i + 2];
        const frac = attrFmts[i + 3];
        result[attr] = { compCnt: cnt, compShift: frac, compType: type };
    }
    return result;
}

function parseGxVtxDescList(buffer: ArrayBufferSlice) {
    const attrTypePairs = buffer.createTypedArray(Uint32Array, 0, buffer.byteLength / 4, Endianness.BIG_ENDIAN);
    const vtxDesc: GX_VtxDesc[] = [];
    for (let i = 0; attrTypePairs[i + 0] !== 255; i += 2) {
        const attr = attrTypePairs[i + 0];
        const type = attrTypePairs[i + 1];
        vtxDesc[attr] = { type };
    }
    return vtxDesc;
}

function createTexture(r: DisplayListRegisters, data: ArrayBufferSlice, name: string): BTI_Texture {
    const minFilterTable = [
        GX.TexFilter.NEAR,
        GX.TexFilter.NEAR_MIP_NEAR,
        GX.TexFilter.NEAR_MIP_LIN,
        GX.TexFilter.NEAR,
        GX.TexFilter.LINEAR,
        GX.TexFilter.LIN_MIP_NEAR,
        GX.TexFilter.LIN_MIP_LIN,
    ];

    const image0 = r.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
    const width = ((image0 >>> 0) & 0x3FF) + 1;
    const height = ((image0 >>> 10) & 0x3FF) + 1;
    const format: GX.TexFormat = (image0 >>> 20) & 0x0F;
    const mode0 = r.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
    const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
    const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;
    const magFilter: GX.TexFilter = (mode0 >>> 4) & 0x01;
    const minFilter: GX.TexFilter = minFilterTable[(mode0 >>> 5) & 0x07];
    const lodBias = ((mode0 >>> 9) & 0x05) * 32.0;
    const maxAnisotropy = (mode0 >>> 19) & 0x03;
    const mode1 = r.bp[GX.BPRegister.TX_SETMODE1_I0_ID];
    const minLOD = (mode1 >>> 0) & 0xF;
    const maxLOD = (mode1 >>> 8) & 0xF;
    console.assert(minLOD === 0);
    console.assert(lodBias === 0, 'Non-zero LOD bias. This is untested');

    const texture: BTI_Texture = {
        name,
        width, height, format,
        data,
        mipCount: 1 + maxLOD - minLOD,
        paletteFormat: GX.TexPalette.RGB565,
        paletteData: null,
        wrapS, wrapT,
        minFilter, magFilter,
        minLOD, maxLOD, lodBias, maxAnisotropy,
    };

    return texture;
}

class WoodModel {
    public shadowTextureMapping = nArray(1, () => new TextureMapping());
    public shadowTextureData: BTIData;
    public shadowMaterial: GXMaterialHelperGfx;

    public bushTextureMapping = new TextureMapping();
    public bushTextureData: BTIData;
    public bushMaterial: GXMaterialHelperGfx;

    public shapeMain: GXShapeHelperGfx;
    public shapeTrunk: GXShapeHelperGfx;
    public shapeShadow: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(globals: dGlobals) {
        const device = globals.modelCache.device, cache = globals.renderer.renderCache;

        // Wood re-uses data from d_tree
        const l_shadowPos = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowPos');
        const l_shadowMatDL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowMatDL');
        const g_dTree_Oba_kage_32DL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_Oba_kage_32DL');
        const l_Txa_kage_32TEX = globals.findExtraSymbolData('d_tree.o', 'l_Txa_kage_32TEX');
        const g_dTree_shadowTexCoord = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowTexCoord');

        const l_matDL = globals.findExtraSymbolData('d_wood.o', 'l_matDL__Q25dWood20@unnamed@d_wood_cpp@');
        const l_Oba_swood_b_cutDL = globals.findExtraSymbolData('d_wood.o', 'l_Oba_swood_b_cutDL__Q25dWood20@unnamed@d_wood_cpp@');
        const l_Oba_swood_bDL = globals.findExtraSymbolData('d_wood.o', 'l_Oba_swood_bDL__Q25dWood20@unnamed@d_wood_cpp@');
        const l_texCoord = globals.findExtraSymbolData('d_wood.o', 'l_texCoord__Q25dWood20@unnamed@d_wood_cpp@');
        const l_color = globals.findExtraSymbolData('d_wood.o', 'l_color__Q25dWood20@unnamed@d_wood_cpp@');
        const l_pos = globals.findExtraSymbolData('d_wood.o', 'l_pos__Q25dWood20@unnamed@d_wood_cpp@');
        const l_Txa_swood_bTEX = globals.findExtraSymbolData('d_wood.o', 'l_Txa_swood_bTEX__Q25dWood20@unnamed@d_wood_cpp@');
        const l_shadowVtxDescList = globals.findExtraSymbolData('d_wood.o', 'l_shadowVtxDescList$5139');
        const l_shadowVtxAttrFmtList = globals.findExtraSymbolData('d_wood.o', 'l_shadowVtxAttrFmtList$5140');
        const l_vtxDescList = globals.findExtraSymbolData('d_wood.o', 'l_vtxDescList$5156');
        const l_vtxAttrFmtList = globals.findExtraSymbolData('d_wood.o', 'l_vtxAttrFmtList$5157');

        const matRegisters = new DisplayListRegisters();

        // Shadow material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_shadowMatDL);
        const shadowMat = parseMaterial(matRegisters, 'd_tree::l_shadowMatDL');

        this.shadowMaterial = new GXMaterialHelperGfx(shadowMat);
        const shadowTexture = createTexture(matRegisters, l_Txa_kage_32TEX, 'l_Txa_kage_32TEX');
        this.shadowTextureData = new BTIData(device, cache, shadowTexture);
        this.shadowTextureData.fillTextureMapping(this.shadowTextureMapping[0]);

        // Shadow vert format
        const shadowVatFormat = parseGxVtxAttrFmtV(l_shadowVtxAttrFmtList);
        const shadowVcd = parseGxVtxDescList(l_shadowVtxDescList);
        const shadowVtxLoader = compileVtxLoader(shadowVatFormat, shadowVcd);

        // Shadow verts
        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS] = { buffer: l_shadowPos, offs: 0, stride: getAttributeByteSize(shadowVatFormat, GX.Attr.POS) };
        shadowVtxArrays[GX.Attr.TEX0] = { buffer: g_dTree_shadowTexCoord, offs: 0, stride: getAttributeByteSize(shadowVatFormat, GX.Attr.TEX0) };
        const vtx_l_shadowDL = shadowVtxLoader.runVertices(shadowVtxArrays, g_dTree_Oba_kage_32DL);

        // Bush material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);

        const material = parseMaterial(matRegisters, 'd_tree::l_matDL');
        material.alphaTest.op = GX.AlphaOp.OR;
        material.alphaTest.compareA = GX.CompareType.GREATER;
        material.alphaTest.compareB = GX.CompareType.GREATER;
        material.alphaTest.referenceA = kAlphaCutoff;
        material.alphaTest.referenceB = kAlphaCutoff;
        material.hasDynamicAlphaTest = true;
        this.bushMaterial = new GXMaterialHelperGfx(material);

        const bushTexture = createTexture(matRegisters, l_Txa_swood_bTEX, 'l_Txa_swood_bTEX');
        this.bushTextureData = new BTIData(device, cache, bushTexture);
        this.bushTextureData.fillTextureMapping(this.bushTextureMapping);

        // Bush Vert Format
        const vatFormat = parseGxVtxAttrFmtV(l_vtxAttrFmtList);
        const vcd = parseGxVtxDescList(l_vtxDescList);
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Tree Verts
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS] = { buffer: l_pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: l_color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: l_texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };

        const vtx_l_Oba_swood_bDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_bDL);
        const vtx_l_Oba_swood_b_cutDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_b_cutDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [vtx_l_Oba_swood_bDL, vtx_l_Oba_swood_b_cutDL, vtx_l_shadowDL]);

        // Build an input layout and input state from the vertex layout and data
        const b = this.bufferCoalescer.coalescedBuffers;

        // Build an input layout and input state from the vertex layout and data
        this.shapeMain = new GXShapeHelperGfx(device, cache, b[0].vertexBuffers, b[0].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_bDL);
        this.shapeTrunk = new GXShapeHelperGfx(device, cache, b[1].vertexBuffers, b[1].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_b_cutDL);
        this.shapeShadow = new GXShapeHelperGfx(device, cache, b[2].vertexBuffers, b[2].indexBuffer, shadowVtxLoader.loadedVertexLayout, vtx_l_shadowDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
    }
}

//-----------------------------------------
// Classes
//-----------------------------------------
class Anm_c {
    /* 0x00 */ mModelMtx: mat4 = mat4.create();
    /* 0x30 */ mTrunkModelMtx: mat4 = mat4.create();

    /* 0x60 */ mMode: AnimMode_e = AnimMode_e._Max;

    /* 0x64 */ mCountdown: number;
    /* 0x66 */ mWindDir: number;   // The direction towards the actor who instigated this animation
    /* 0x68 */ mWindPow: number;   // 0.0 - 1.0
    /* 0x6c */ mPosOffsetY: number;
    /* 0x70 */ mPosOffsetZ: number;
    /* 0x74 */ mVelY: number;

    /* 0x78 */ mPhaseY: number[] = [0, 0];
    /* 0x7c */ mPhaseX: number[] = [0, 0];
    /* 0x80 */ mAmpY: number[] = [0, 0];
    /* 0x84 */ mAmpX: number[] = [0, 0];

    /* 0x88 */ mNextAnimIdx: number; // Corresponds to the index in Packet_c::mAnm;

    /* 0x8A */ mAlpha: number = 0xFF;

    public play(packet: Packet_c): void {
        switch (this.mMode) {
            case AnimMode_e.Cut: return this.mode_cut(packet);
            case AnimMode_e.PushInto: return this.mode_push_into(packet);
            case AnimMode_e.PushBack: return this.mode_push_back(packet);
            case AnimMode_e.Fan: return this.mode_fan(packet);
            case AnimMode_e.Norm: return this.mode_norm(packet);
            case AnimMode_e.ToNorm: return this.mode_to_norm(packet);
            default: return;
        }
    }

    public copy_angamp(anm: Anm_c): void {

    }

    // Animations are assigned from the Packet to specific Wood instances (Bushes) when a new animation starts
    // Each animation mode has an mode_*_init() function which is called when the animation is started
    // The mode_*() function is called to update the animation each frame, until finished

    public mode_cut_init(anm: Anm_c, targetAngle: number): void {
        for (let i = 0; i < 2; i++) {
            this.mPhaseY[i] = 0;
            this.mPhaseX[i] = 0;
            this.mAmpY[i] = 0;
            this.mAmpX[i] = 0;
        }

        this.mWindDir = targetAngle;
        this.mVelY = 18.0;
        this.mPosOffsetY = 0.0;
        this.mPosOffsetZ = 0.0;
        this.mAlpha = 0xff;
        this.mCountdown = 20;
        this.mMode = AnimMode_e.Cut;
    }

    // Animate when cut with a weapon 
    public mode_cut(packet: Packet_c): void {
        this.mVelY = this.mVelY - 3.0;
        if (this.mVelY < -40.0) {
            this.mVelY = -40.0;
        }

        this.mPosOffsetY = this.mPosOffsetY + this.mVelY;
        this.mPosOffsetZ = this.mPosOffsetZ + 2.5;
        this.mPhaseX[0] = this.mPhaseX[0] - 200;

        mDoMtx_YrotS(scratchMat4a, this.mWindDir);
        MtxTrans([0.0, this.mPosOffsetY, this.mPosOffsetZ], true, scratchMat4a);
        mDoMtx_XrotM(scratchMat4a, this.mPhaseX[0]);
        mDoMtx_YrotM(scratchMat4a, -this.mWindDir);
        mDoMtx_copy(scratchMat4a, this.mModelMtx);

        // Fade out the bush as it falls
        if (this.mCountdown < 20) {
            let alphaScale = this.mAlpha - 14;
            if (alphaScale < 0) {
                alphaScale = 0;
            }
            this.mAlpha = alphaScale;
        }

        if (this.mCountdown > 0) {
            this.mCountdown = this.mCountdown + -1;
        }
    }

    public mode_push_into_init(anm: Anm_c, targetAngle: number): void {

    }

    // Animate when pushed into
    public mode_push_into(packet: Packet_c): void {

    }

    public mode_push_back_init(): void {

    }

    // Second half of the push into animation
    public mode_push_back(packet: Packet_c): void {

    }


    // Animate when hit with the fan item (does nothing)
    public mode_fan(packet: Packet_c): void {

    }

    public mode_norm_init(): void {
        this.mMode = AnimMode_e.Norm;

        for (let i = 0; i < 2; i++) {
            this.mPhaseY[i] = (sAnimInitNum << 0xd);
            this.mPhaseX[i] = (sAnimInitNum << 0xd);
            this.mAmpY[i] = kSwayAttrs[0][i].ampY;
            this.mAmpX[i] = kSwayAttrs[0][i].ampX;
        }

        this.mAlpha = 0xff;

        sAnimInitNum = (sAnimInitNum + 1) % 8;
    }

    // Animate normally (not interacting with character)
    public mode_norm(packet: Packet_c): void {
        let phase;
        if (this.mWindPow < 0.33) {
            phase = AttrSway_e.Light;
        } else {
            if (this.mWindPow < 0.66) {
                phase = AttrSway_e.Medium;
            } else {
                phase = AttrSway_e.Strong;
            }
        }

        let fVar1 = 0.0;
        let fVar6 = fVar1;
        for (let i = 0; i < 2; i++) {
            const swayAttr = kSwayAttrs[phase][i];
            this.mPhaseY[i] += swayAttr.phaseVelY;
            this.mPhaseX[i] += swayAttr.phaseVelX;
            this.mAmpY[i] = cLib_chaseF(this.mAmpY[i], swayAttr.ampY, 2);
            this.mAmpX[i] = cLib_chaseF(this.mAmpX[i], swayAttr.ampX, 2);

            fVar1 += this.mAmpY[i] * Math.cos(cM__Short2Rad((this.mPhaseY[i])));
            fVar6 += this.mAmpX[i] * (swayAttr.phaseBiasX + Math.cos(cM__Short2Rad((this.mPhaseX[i]))));
        }

        mDoMtx_YrotS(this.mModelMtx, fVar1 + this.mWindDir);
        mDoMtx_XrotM(this.mModelMtx, fVar6);
        mDoMtx_YrotM(this.mModelMtx, -this.mWindDir);
    }

    public mode_norm_set_wind(pow: number, dir: number): void {
        this.mWindDir = dir;
        this.mWindPow = pow;
    }

    public mode_to_norm_init(anmIdx: number): void {

    }

    // Blend back to the normal animation
    public mode_to_norm(packet: Packet_c): void {

    }
}

class Unit_c {
    mPos = vec3.create();
    mFlags: UnitState_e = 0;
    mAnmIdx: number = 0;
    mModelViewMtx: mat4 = mat4.create();
    mTrunkModelViewMtx: mat4 = mat4.create();
    mShadowModelMtx: mat4 = mat4.create();
    mShadowModelViewMtx: mat4 = mat4.create();

    public set_ground(globals: dGlobals): number {
        // @TODO: This is copied from d_tree. Should actually implement the d_wood version.

        const chk = new dBgS_GndChk();
        vec3.copy(chk.pos, this.mPos);
        chk.pos[1] += 50;

        const y = globals.scnPlay.bgS.GroundCross(chk);
        if (y > -Infinity) {
            this.mPos[1] = y;
            const pla = globals.scnPlay.bgS.GetTriPla(chk.polyInfo.bgIdx, chk.polyInfo.triIdx)
            vec3.copy(scratchVec3a, pla.n);
        } else {
            this.mPos[1] = y;
            vec3.set(scratchVec3a, 0, 1, 0);
        }

        const normal = scratchVec3a;
        const right = vec3.set(scratchVec3c, 1, 0, 0);
        const forward = vec3.cross(scratchVec3d, normal, right);
        vec3.cross(right, normal, forward);

        // Get the normal from the raycast, rotate shadow to match surface
        setMatrixAxis(this.mShadowModelMtx, right, normal, forward);
        setMatrixTranslation(this.mShadowModelMtx, [this.mPos[0], y + 1.0, this.mPos[2]]);
        scaleMatrix(this.mShadowModelMtx, this.mShadowModelMtx, 1.5, 1.0, 1.5);

        return y;
    }

    /**
     * Compute modelView matrices for the body, trunk, and drop shadow
     * @param anim 
     */
    public set_mtx(globals: dGlobals, anims: Anm_c[]): void {
        mDoMtx_copy(anims[this.mAnmIdx].mModelMtx, scratchMat4a);
        scratchMat4a[12] += this.mPos[0];
        scratchMat4a[13] += this.mPos[1];
        scratchMat4a[14] += this.mPos[2];
        mat4.mul(this.mModelViewMtx, globals.camera.viewMatrix, scratchMat4a);

        mDoMtx_copy(anims[this.mAnmIdx].mTrunkModelMtx, scratchMat4a);
        scratchMat4a[12] += this.mPos[0];
        scratchMat4a[13] += this.mPos[1];
        scratchMat4a[14] += this.mPos[2];
        mat4.mul(this.mTrunkModelViewMtx, globals.camera.viewMatrix, scratchMat4a);

        mat4.mul(this.mShadowModelViewMtx, globals.camera.viewMatrix, this.mShadowModelMtx);
    }

    public clear(): void {
        this.mFlags = UnitState_e.Inactive;
    }

    public cc_hit_before_cut(packet: Packet_c): void {

    }

    public cc_hit_after_cut(packet: Packet_c): void {
        // Does nothing
    }

    public proc(packet: Packet_c): void {
        // If this unit is active, and performing a non-normal animation...
        if (this.mFlags & UnitState_e.Active) {
            if (this.mAnmIdx >= 8) {
                const anim = packet.get_anm(this.mAnmIdx);
                if (anim.mMode == AnimMode_e.ToNorm) {
                    if (anim.mCountdown <= 0) {
                        this.mAnmIdx = anim.mNextAnimIdx;
                        anim.mMode = AnimMode_e._Max;
                    }
                } else if (anim.mMode == AnimMode_e.Cut) {
                    if (anim.mCountdown <= 0) {
                        const newAnimIdx = packet.search_anm(AnimMode_e.Norm);
                        this.mAnmIdx = newAnimIdx;
                        anim.mMode = AnimMode_e._Max;
                        this.mFlags |= UnitState_e.IsCut;
                    }
                } else if (anim.mMode == AnimMode_e._Max) {
                    this.mAnmIdx = packet.search_anm(AnimMode_e.Norm);
                }
            }
        }
    }
}

export class Packet_c implements J3DPacket {
    private mUnit: Unit_c[][] = nArray(kRoomCount, () => []);
    private mAnm: Anm_c[] = nArray(kAnimCount, () => new Anm_c());

    private _mModel: WoodModel;

    // void delete_room(s32 room_no);

    constructor(lGlobals: dGlobals) {
        this._mModel = new WoodModel(lGlobals);

        for (let i = 0; i < 8; i++) {
            this.mAnm[i].mode_norm_init();
        }
    }

    public destroy(device: GfxDevice) {
        this._mModel.destroy(device);
    }

    public get_anm(idx: number): Anm_c {
        return this.mAnm[idx];
    }

    public search_anm(i_mode: AnimMode_e): number {
        let animIdx: number;

        assert((i_mode >= 0) && (i_mode < AnimMode_e._Max));

        if (i_mode == AnimMode_e.Norm) {
            animIdx = sAnmNormNum++;
            sAnmNormNum = sAnmNormNum % 8;
        } else {
            // Return the first anim slot which has an unset mode
            animIdx = 8;
            for (let i = 0; i < 64; i++) {
                if (this.mAnm[animIdx].mMode == AnimMode_e._Max) {
                    return animIdx;
                }
                animIdx++;
            }

            // If none are available, return the first one which has a higher mode
            animIdx = 8;
            for (let i = 0; i < 64; i++) {
                if (i_mode < this.mAnm[animIdx].mMode) {
                    return animIdx;
                }
                animIdx++;
            }

            // If no available anim slot is found, return -1
            animIdx = -1;
        }

        return animIdx;
    }

    public put_unit(globals: dGlobals, pos: vec3, room_no: number) {
        const unit = new Unit_c();
        unit.mFlags = UnitState_e.Active;

        vec3.copy(unit.mPos, pos);

        unit.mAnmIdx = this.search_anm(AnimMode_e.Norm);

        const groundY = unit.set_ground(globals);
        if (groundY) {
            this.mUnit[room_no].push(unit);
        } else {
            unit.clear();
        }
    }

    // Calculate collisions
    public calc_cc(globals: dGlobals) {
        const roomIdx = globals.mStayNo;

        if ((roomIdx >= 0) && (roomIdx < kRoomCount)) {
            //     dComIfG_Ccsp() -> SetMassAttr(L_attr.kCollisionRad1, L_attr.kCollisionHeight1, (u8)0x13, 1);
            for (let unit of this.mUnit[roomIdx]) {
                if ((unit.mFlags & UnitState_e.IsCut) == 0) {
                    unit.cc_hit_before_cut(this);
                }
            }

            //     dComIfG_Ccsp() -> SetMassAttr(L_attr.kCollisionRad2, L_attr.kCollisionHeight2, (u8)0x12, 1);
            for (let unit of this.mUnit[roomIdx]) {
                if ((unit.mFlags & UnitState_e.IsCut) != 0) {
                    unit.cc_hit_after_cut(this);
                }
            }
        }
    }

    public calc(globals: dGlobals, frameCount: number) {
        this.calc_cc(globals);

        const windVec = dKyw_get_wind_vec(globals.g_env_light);
        const windPow = dKyw_get_wind_pow(globals.g_env_light);
        const windAngle = cM_atan2s(windVec[0], windVec[2]);

        for (let i = 0; i < 8; i++) {
            this.mAnm[i].mode_norm_set_wind(0.2, windAngle);
        }

        for (let i = 0; i < kAnimCount; i++) {
            this.mAnm[i].play(this);
        }

        for (let i = 0; i < kRoomCount; i++) {
            for (let unit of this.mUnit[i]) {
                unit.proc(this);
            }
        }
    }

    public update(globals: dGlobals) {
        for (let i = 0; i < kRoomCount; i++) {
            for (let unit of this.mUnit[i]) {
                if (unit.mFlags & UnitState_e.Active) {
                    // Frustum culling
                    const clipPos = vec3.set(scratchVec3a, unit.mPos[0], unit.mPos[1] + kClipCenterYOffset, unit.mPos[2]);

                    // s32 res = mDoLib_clipper::clip(j3dSys.getViewMtx(), clipPos, kClipRadius);
                    const culled = !globals.camera.frustum.containsSphere(clipPos, kClipRadius);

                    if (culled) {
                        unit.mFlags |= UnitState_e.IsFrustumCulled;
                    } else {
                        unit.mFlags &= ~UnitState_e.IsFrustumCulled;
                        unit.set_mtx(globals, this.mAnm);
                    }
                }
            }
        }
        // TODO: Add to the Render List
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const worldToView = viewerInput.camera.viewMatrix;
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);

        // Render to the XLU BG display list (after the bg terrain). We want to render late since we are alpha tested.
        renderInstManager.setCurrentList(globals.dlst.bg[1]);

        // Draw drop shadows
        let template = renderInstManager.pushTemplate();
        {
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            // Set the shadow color. Pulled from d_tree::l_shadowColor$4656
            colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, 0x64 / 0xFF);
            this._mModel.shadowMaterial.allocateMaterialParamsDataOnInst(template, materialParams);
            this._mModel.shadowMaterial.setOnRenderInst(renderInstManager.gfxRenderCache, template);
            template.setSamplerBindingsFromTextureMappings(this._mModel.shadowTextureMapping);

            for (let i = 0; i < kRoomCount; i++) {
                for (let unit of this.mUnit[i]) {
                    if (unit.mFlags & UnitState_e.IsFrustumCulled)
                        continue;

                    const shadowRenderInst = renderInstManager.newRenderInst();
                    this._mModel.shapeShadow.setOnRenderInst(shadowRenderInst);
                    mat4.copy(drawParams.u_PosMtx[0], unit.mShadowModelViewMtx);
                    this._mModel.shadowMaterial.allocateDrawParamsDataOnInst(shadowRenderInst, drawParams);
                    renderInstManager.submitRenderInst(shadowRenderInst);
                }
            }
        }
        renderInstManager.popTemplate();

        // Draw bushes
        template = renderInstManager.pushTemplate();
        {
            // Enable alpha testing at 50%
            materialParams.u_DynamicAlphaRefA = kAlphaCutoff;
            materialParams.u_DynamicAlphaRefB = kAlphaCutoff;

            template.setSamplerBindingsFromTextureMappings([this._mModel.bushTextureMapping]);
            const materialParamsOffs = this._mModel.bushMaterial.allocateMaterialParamsDataOnInst(template, materialParams);
            this._mModel.bushMaterial.setOnRenderInst(renderInstManager.gfxRenderCache, template);

            // Set alpha color
            colorFromRGBA(materialParams.u_Color[ColorKind.C2], 1, 1, 1, 1);

            for (let r = 0; r < kRoomCount; r++) {
                // Set the room color and fog params
                colorCopy(materialParams.u_Color[ColorKind.C0], globals.roomStatus[r].tevStr.colorC0);
                colorCopy(materialParams.u_Color[ColorKind.C1], globals.roomStatus[r].tevStr.colorK0);
                dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);

                for (let unit of this.mUnit[r]) {
                    if (unit.mFlags & UnitState_e.IsFrustumCulled)
                        continue;

                    // If this bush is not chopped down, draw the main body
                    if ((unit.mFlags & UnitState_e.IsCut) == 0) {
                        // The cut animation reduces alpha over time
                        const cutAlpha = this.mAnm[unit.mAnmIdx].mAlpha;
                        colorFromRGBA(materialParams.u_Color[ColorKind.C2], 1, 1, 1, cutAlpha / 0xFF);

                        // If this bush is fading out, disable alpha testing
                        if (cutAlpha != 0xff) {
                            materialParams.u_DynamicAlphaRefA = 0;
                            materialParams.u_DynamicAlphaRefB = 0;
                        }

                        const renderInst = renderInstManager.newRenderInst();
                        this._mModel.shapeMain.setOnRenderInst(renderInst);
                        mat4.copy(drawParams.u_PosMtx[0], unit.mModelViewMtx);
                        this._mModel.bushMaterial.allocateDrawParamsDataOnInst(renderInst, drawParams);
                        renderInstManager.submitRenderInst(renderInst);

                        // Return alpha test to normal (50%)
                        if (cutAlpha != 0xff) {
                            materialParams.u_DynamicAlphaRefA = kAlphaCutoff;
                            materialParams.u_DynamicAlphaRefB = kAlphaCutoff;
                        }
                    }

                    // Always draw the trunk
                    const renderInst = renderInstManager.newRenderInst();
                    this._mModel.shapeTrunk.setOnRenderInst(renderInst);
                    mat4.copy(drawParams.u_PosMtx[0], unit.mTrunkModelViewMtx);
                    this._mModel.bushMaterial.allocateDrawParamsDataOnInst(renderInst, drawParams);
                    renderInstManager.submitRenderInst(renderInst);
                }
            }
        }
        renderInstManager.popTemplate();
    }
}
