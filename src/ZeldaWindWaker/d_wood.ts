
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

//-----------------------------------------
// Globals
//-----------------------------------------
let globals: dGlobals;

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchMat4a = mat4.create();
const materialParams = new MaterialParams();
const drawParams = new DrawParams();

//-----------------------------------------
// Helpers
//-----------------------------------------
function distanceCull(camPos: ReadonlyVec3, objPos: ReadonlyVec3, maxDist = 20000) {
    const distSq = vec3.squaredDistance(camPos, objPos);
    return distSq >= maxDist ** 2;
}

function setColorFromRoomNo(globals: dGlobals, materialParams: MaterialParams, roomNo: number): void {
    colorCopy(materialParams.u_Color[ColorKind.C0], globals.roomStatus[roomNo].tevStr.colorC0);
    colorCopy(materialParams.u_Color[ColorKind.C1], globals.roomStatus[roomNo].tevStr.colorK0);
}

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
    public shapeShadow: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(globals: dGlobals) {
        const device = globals.modelCache.device, cache = globals.renderer.renderCache;

        // Wood re-uses data from d_tree
        const l_shadowPos = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowPos');
        const l_shadowMatDL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowMatDL');

        const g_dTree_Oba_kage_32DL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_Oba_kage_32DL');
        const l_Txa_kage_32TEX = globals.findExtraSymbolData('d_tree.o', 'l_Txa_kage_32TEX');

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

        // @HACK: The tex coord array is being read as all zero. Hardcode it.
        const l_shadowTexCoord = new ArrayBufferSlice(new Uint8Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer);

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
        shadowVtxArrays[GX.Attr.TEX0] = { buffer: l_shadowTexCoord, offs: 0, stride: getAttributeByteSize(shadowVatFormat, GX.Attr.TEX0) };
        const vtx_l_shadowDL = shadowVtxLoader.runVertices(shadowVtxArrays, g_dTree_Oba_kage_32DL);

        // Bush material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);
        this.bushMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'd_tree::l_matDL'));
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
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [vtx_l_Oba_swood_bDL, vtx_l_shadowDL]);

        // Build an input layout and input state from the vertex layout and data
        const b = this.bufferCoalescer.coalescedBuffers;

        // Build an input layout and input state from the vertex layout and data
        this.shapeMain = new GXShapeHelperGfx(device, cache, b[0].vertexBuffers, b[0].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_bDL);
        this.shapeShadow = new GXShapeHelperGfx(device, cache, b[1].vertexBuffers, b[1].indexBuffer, shadowVtxLoader.loadedVertexLayout, vtx_l_shadowDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
    }
}

//-----------------------------------------
// Types
//-----------------------------------------
const enum UnitFlags {
    Active = 1 << 0,
    FrustumCulled = 1 << 1,
    Cut = 1 << 2,
}

class Room_c {
    mpUnits: Unit_c[] = [];
}

class Anm_c {

}

class Unit_c {
    mPos = vec3.create();
    mFlags: UnitFlags;
    // int mAnmIdx;
    // Mtx field_0x018;
    mShadowMtx: mat4 = mat4.create();
    mModelMtx: mat4 = mat4.create();
    // Mtx field_0x0a8;
    // Unit_c* mpNext;
    // u8 field_0xdc[0x18C - 0xDC];

    public set_ground(): number {
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
        this.mShadowMtx[0] = right[0];
        this.mShadowMtx[1] = right[1];
        this.mShadowMtx[2] = right[2];
        this.mShadowMtx[3] = this.mPos[0];

        this.mShadowMtx[4] = normal[0];
        this.mShadowMtx[5] = normal[1];
        this.mShadowMtx[6] = normal[2];
        this.mShadowMtx[7] = 1.0 + y;

        this.mShadowMtx[8] = forward[0];
        this.mShadowMtx[9] = forward[1];
        this.mShadowMtx[10] = forward[2];
        this.mShadowMtx[11] = this.mPos[2];

        mat4.transpose(this.mShadowMtx, this.mShadowMtx);

        return y;
    }

    public set_mtx(anim: Anm_c): void {
        // @TODO: Set main and show mtxs
        mat4.mul(this.mModelMtx, mat4.fromTranslation(scratchMat4a, this.mPos), mat4.create());
    }

    public clear(): void {

    }

    public cc_hit_before_cut(packet: Packet_c): void {

    }

    public cc_hit_after_cut(packet: Packet_c): void {

    }

    public proc(packet: Packet_c): void {

    }
}

export class Packet_c implements J3DPacket {
    private mUnit: Unit_c[] = [];
    private mRoom: Room_c[] = nArray(64, () => new Room_c());
    private mAnm: Anm_c[] = nArray(72, () => new Anm_c());

    private _mModel: WoodModel;

    // void delete_room(s32 room_no);
    // void calc_cc();
    // void update();
    // s32 search_empty_UnitID() const;
    // s32 search_anm(Anm_c::Mode_e mode);

    constructor(lGlobals: dGlobals) {
        globals = lGlobals;
        this._mModel = new WoodModel(lGlobals);
    }

    destroy(device: GfxDevice) {
        this._mModel.destroy(device);
    }

    put_unit(pos: vec3, room_no: number): number {
        const unit = new Unit_c();
        unit.mFlags = UnitFlags.Active;
        vec3.copy(unit.mPos, pos);
        // TODO: assign anm
        const groundY = unit.set_ground();
        if (groundY) {
            this.mRoom[room_no].mpUnits.push(unit);
            return this.mUnit.push(unit);
        }
        return -1;
    }

    public calc(frameCount: number) {

    }

    public update() {
        for (let i = 0; i < this.mUnit.length; i++) {
            const unit = this.mUnit[i];
            if (unit.mFlags & UnitFlags.Active) {
                // TODO: Frustum Culling
                // unit.mFlags |= UnitFlags.FrustumCulled;
                unit.set_mtx(this.mAnm);
            }
        }

        // TODO: Add to the Render List
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // for (s32 i = 0; i < (s32)ARRAY_SIZE(mRoom); room++, i++) {
        //     for (Unit_c *data = room->mpUnit; data != NULL; data = data->mpNext) {
        //       if ((pUnit->mFlags & 2) == 0) {
        //         GFLoadPosMtxImm(pUnit->field_0x0a8, 0);
        //         GXCallDisplayList(dl, dlSize);
        //       }
        //     }
        //   }

        const worldToView = viewerInput.camera.viewMatrix;
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);

        // Draw shadows
        let template = renderInstManager.pushTemplate();
        {
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);
            // Set the shadow color. Pulled from d_tree::l_shadowColor$4656
            colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, 0x64 / 0xFF);
            this._mModel.shadowMaterial.allocateMaterialParamsDataOnInst(template, materialParams);
            this._mModel.shadowMaterial.setOnRenderInst(renderInstManager.gfxRenderCache, template);
            template.setSamplerBindingsFromTextureMappings(this._mModel.shadowTextureMapping);


            for (let r = 0; r < this.mRoom.length; r++) {
                const units = this.mRoom[r].mpUnits;
                for (let i = 0; i < units.length; i++) {
                    const unit = units[i];

                    if (unit.mFlags & UnitFlags.FrustumCulled)
                        continue;
                    if (distanceCull(worldCamPos, unit.mPos))
                        continue;

                    // @TODO: Fix this
                    setColorFromRoomNo(globals, materialParams, r);

                    const shadowRenderInst = renderInstManager.newRenderInst();
                    this._mModel.shapeShadow.setOnRenderInst(shadowRenderInst);
                    mat4.mul(drawParams.u_PosMtx[0], worldToView, unit.mShadowMtx);
                    this._mModel.shadowMaterial.allocateDrawParamsDataOnInst(shadowRenderInst, drawParams);
                    renderInstManager.submitRenderInst(shadowRenderInst);
                }
            }
        }
        renderInstManager.popTemplate();

        // Draw bushes
        template = renderInstManager.pushTemplate();
        {
            template.setSamplerBindingsFromTextureMappings([this._mModel.bushTextureMapping]);
            const materialParamsOffs = this._mModel.bushMaterial.allocateMaterialParamsDataOnInst(template, materialParams);
            this._mModel.bushMaterial.setOnRenderInst(renderInstManager.gfxRenderCache, template);

            colorFromRGBA(materialParams.u_Color[ColorKind.C2], 1, 1, 1, 1);

            for (let r = 0; r < this.mRoom.length; r++) {
                const units = this.mRoom[r].mpUnits;
                for (let i = 0; i < units.length; i++) {
                    const unit = units[i];

                    if (unit.mFlags & UnitFlags.FrustumCulled)
                        continue;
                    if (distanceCull(worldCamPos, unit.mPos))
                        continue;

                    // @TODO: Fix this
                    setColorFromRoomNo(globals, materialParams, r);

                    const renderInst = renderInstManager.newRenderInst();
                    this._mModel.shapeMain.setOnRenderInst(renderInst);
                    mat4.mul(drawParams.u_PosMtx[0], worldToView, unit.mModelMtx);
                    this._mModel.bushMaterial.allocateDrawParamsDataOnInst(renderInst, drawParams);
                    renderInstManager.submitRenderInst(renderInst);
                }
            }
        }
        renderInstManager.popTemplate();
    }
}
