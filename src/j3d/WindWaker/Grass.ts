import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assertExists } from '../../util';
import { mat4, vec3 } from 'gl-matrix';
import * as GX from '../../gx/gx_enum';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { SymbolMap } from './Actors';
import { Actor } from './Actors';
import { WwContext } from './zww_scenes';

import { BTIData, BTI_Texture } from '../../Common/JSYSTEM/JUTTexture';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, getAttributeByteSize } from '../../gx/gx_displaylist';
import { parseMaterial } from '../../gx/gx_material';
import { DisplayListRegisters, displayListRegistersRun, displayListRegistersInitGX } from '../../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from '../../gfx/helpers/BufferHelpers';
import { ColorKind, PacketParams, MaterialParams, ub_MaterialParams, loadedDataCoalescerComboGfx } from "../../gx/gx_render";
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../../gx/gx_render';
import * as GX_Material from '../../gx/gx_material';
import { TextureMapping } from '../../TextureHolder';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderer';
import { ViewerRenderInput } from '../../viewer';
import { computeViewMatrix } from '../../Camera';
import { colorCopy, White } from '../../Color';

// @TODO: This belongs somewhere else
function findSymbol(symbolMap: SymbolMap, filename: string, symbolName: string): ArrayBufferSlice {
    const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symbolName));
    return entry.Data;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const packetParams = new PacketParams();
const materialParams = new MaterialParams();

// ---------------------------------------------
// Flower Packet
// ---------------------------------------------
enum FlowerType {
    WHITE,
    PINK,
    BESSOU,
};

enum FlowerFlags {
    isFrustumCulled = 1 << 0,
}

interface FlowerData {
    flags: number,
    type: FlowerType,
    animIdx: number,
    itemIdx: number,
    particleLifetime: number,
    pos: vec3,
    modelMatrix: mat4,
    nextData: FlowerData,
}

const kMaxFlowerDatas = 200;

class FlowerModel {
    public pinkTextureMapping = new TextureMapping();
    public pinkTextureData: BTIData;
    public pinkMaterial: GXMaterialHelperGfx;
    public whiteTextureMapping = new TextureMapping();
    public whiteTextureData: BTIData;
    public whiteMaterial: GXMaterialHelperGfx;
    public bessouTextureMapping = new TextureMapping();
    public bessouTextureData: BTIData;
    public bessouMaterial: GXMaterialHelperGfx;

    public shapeWhiteUncut: GXShapeHelperGfx;
    public shapeWhiteCut: GXShapeHelperGfx;
    public shapePinkUncut: GXShapeHelperGfx;
    public shapePinkCut: GXShapeHelperGfx;
    public shapeBessouUncut: GXShapeHelperGfx;
    public shapeBessouCut: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL = findSymbol(symbolMap, `d_flower.o`, `l_matDL`);
        const l_matDL2 = findSymbol(symbolMap, `d_flower.o`, `l_matDL2`);
        const l_matDL3 = findSymbol(symbolMap, `d_flower.o`, `l_matDL3`);
        const l_Txo_ob_flower_pink_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
        const l_Txo_ob_flower_white_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
        const l_Txq_bessou_hanaTEX = findSymbol(symbolMap, `d_flower.o`, `l_Txq_bessou_hanaTEX`);        

        const matRegisters = new DisplayListRegisters();

        const materialFromDL = (displayList: ArrayBufferSlice) => {
            displayListRegistersInitGX(matRegisters);
            displayListRegistersRun(matRegisters, displayList);
    
            const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
            const numTexGens = (genMode >>> 0) & 0x0F;
            const numTevs = ((genMode >>> 10) & 0x0F) + 1;
            const numInds = ((genMode >>> 16) & 0x07);
    
            const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
            const cullMode = hw2cm[((genMode >>> 14)) & 0x03];
    
            const gxMaterial = parseMaterial(matRegisters, 'l_matDL');
            gxMaterial.cullMode = cullMode;
            
            // TODO(jstpierre): light channels
            gxMaterial.lightChannels.push({
                colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
                alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            });

            return gxMaterial;
        }

        const createTextureData = (data: ArrayBufferSlice, name: string) => {
            const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
            const width  = ((image0 >>>  0) & 0x3FF) + 1;
            const height = ((image0 >>> 10) & 0x3FF) + 1;
            const format: GX.TexFormat = (image0 >>> 20) & 0x0F;
            const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
            const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
            const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;
    
            const texture: BTI_Texture = {
                name,
                width, height, format,
                data,
                // TODO(jstpierre): do we have mips?
                mipCount: 1,
                paletteFormat: GX.TexPalette.RGB565,
                paletteData: null,
                wrapS, wrapT,
                minFilter: GX.TexFilter.LINEAR, magFilter: GX.TexFilter.LINEAR,
                minLOD: 1, maxLOD: 1, lodBias: 0,
            };

            return new BTIData(device, cache, texture);
        }

        this.whiteMaterial = new GXMaterialHelperGfx(materialFromDL(l_matDL));
        this.whiteTextureData = createTextureData(l_Txo_ob_flower_white_64x64TEX, 'l_Txo_ob_flower_white_64x64TEX');
        this.whiteTextureData.fillTextureMapping(this.whiteTextureMapping);

        this.pinkMaterial = new GXMaterialHelperGfx(materialFromDL(l_matDL2));
        this.pinkTextureData = createTextureData(l_Txo_ob_flower_pink_64x64TEX, 'l_Txo_ob_flower_pink_64x64TEX');
        this.pinkTextureData.fillTextureMapping(this.pinkTextureMapping);

        this.bessouMaterial = new GXMaterialHelperGfx(materialFromDL(l_matDL2));
        this.bessouTextureData = createTextureData(l_Txq_bessou_hanaTEX, 'l_Txq_bessou_hanaTEX');
        this.bessouTextureData.fillTextureMapping(this.bessouTextureMapping);

        // White
        const l_pos = findSymbol(symbolMap, `d_flower.o`, `l_pos`);
        const l_color = findSymbol(symbolMap, `d_flower.o`, `l_color`);
        const l_texCoord = findSymbol(symbolMap, `d_flower.o`, `l_texCoord`);

        // Pink
        const l_pos2 = findSymbol(symbolMap, `d_flower.o`, `l_pos2`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);
        const l_texCoord2 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord2`);
        
        // Bessou
        const l_pos3 = findSymbol(symbolMap, `d_flower.o`, `l_pos3`);
        const l_color3 = findSymbol(symbolMap, `d_flower.o`, `l_color3`);
        const l_texCoord3 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord3`);

        const l_Ohana_highDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_highDL`);
        const l_Ohana_high_gutDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_high_gutDL`);
        const l_OhanaDL = findSymbol(symbolMap, `d_flower.o`, `l_OhanaDL`);
        const l_Ohana_gutDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_gutDL`);
        const l_QbsafDL = findSymbol(symbolMap, `d_flower.o`, `l_QbsafDL`);
        const l_QbsfwDL = findSymbol(symbolMap, `d_flower.o`, `l_QbsfwDL`);

        // All flowers share the same vertex format
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
         const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Compute a CPU-side ArrayBuffers of indexes and interleaved vertices for each display list
        const vtxArrays: GX_Array[] = [];
        const loadFlowerVerts = (pos: ArrayBufferSlice, color: ArrayBufferSlice, texCoord: ArrayBufferSlice, displayList: ArrayBufferSlice) => {
            vtxArrays[GX.Attr.POS]  = { buffer: pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
            vtxArrays[GX.Attr.CLR0] = { buffer: color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
            vtxArrays[GX.Attr.TEX0] = { buffer: texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
            return vtxLoader.runVertices(vtxArrays, displayList);
        }

        // Each flower type has a unique set of attribute buffers, and a cut and uncut display list
        const lWhiteUncut = loadFlowerVerts(l_pos, l_color, l_texCoord, l_OhanaDL);
        const lWhiteCut = loadFlowerVerts(l_pos, l_color, l_texCoord, l_Ohana_gutDL);
        const lPinkUncut = loadFlowerVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_highDL);
        const lPinkCut = loadFlowerVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_high_gutDL);
        const lBessouUncut = loadFlowerVerts(l_pos3, l_color3, l_texCoord3, l_QbsafDL);
        const lBessouCut = loadFlowerVerts(l_pos3, l_color3, l_texCoord3, l_QbsfwDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ lWhiteUncut, lWhiteCut, lPinkUncut, lPinkCut ]);

        // Build an input layout and input state from the vertex layout and data
        this.shapeWhiteUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, lWhiteUncut);
        this.shapeWhiteCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[1], vtxLoader.loadedVertexLayout, lWhiteCut);
        this.shapePinkUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[2], vtxLoader.loadedVertexLayout, lPinkUncut);
        this.shapePinkCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[3], vtxLoader.loadedVertexLayout, lPinkCut);
        this.shapeBessouUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[2], vtxLoader.loadedVertexLayout, lBessouUncut);
        this.shapeBessouCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[3], vtxLoader.loadedVertexLayout, lBessouCut);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeWhiteUncut.destroy(device);
        this.shapeWhiteCut.destroy(device);
        this.shapePinkUncut.destroy(device);
        this.shapePinkCut.destroy(device);

        this.whiteTextureData.destroy(device);
        this.pinkTextureData.destroy(device);
    }
}

export class FlowerPacket {
    datas: FlowerData[] = new Array(kMaxFlowerDatas);
    dataCount: number = 0;
    
    private flowerModel: FlowerModel;

    constructor(private context: WwContext) {
        this.flowerModel = new FlowerModel(context.device, context.symbolMap, context.cache);
    }

    newData(pos: vec3, type: FlowerType, roomIdx: number, itemIdx: number): FlowerData {
        const dataIdx = this.datas.findIndex(d => d === undefined);
        if (dataIdx === -1) console.warn('Failed to allocate flower data');
        return this.setData(dataIdx, pos, type, roomIdx, itemIdx);
    }

    setData(index: number, pos: vec3, type: FlowerType, roomIdx: number, itemIdx: number): FlowerData {
        const animIdx = Math.floor(Math.random() * 8);
        
        // Island 0x21 uses the Bessou flower (the game does this check here as well)
        if (this.context.stage === 'sea' && roomIdx === 0x21) {
            type = FlowerType.BESSOU;
        }

        return this.datas[index] = {
            flags: 0,
            type,
            animIdx,
            itemIdx,
            particleLifetime: 0,
            pos: vec3.clone(pos),
            modelMatrix: mat4.create(),
            nextData: null!,
        }
    }

    calc() {
        // @TODO: Idle animation updates
        // @TODO: Hit checks
    }

    update() {
        // @TODO: Update all animation matrices

        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;

            // @TODO: Perform ground checks for some limited number of flowers
            // @TODO: Frustum culling

            if (!(data.flags & FlowerFlags.isFrustumCulled)) {
                // Update model matrix for all non-culled objects
                // @TODO: Include anim rotation matrix
                mat4.fromTranslation(data.modelMatrix, data.pos);
            }
        }
    }

    draw(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice) {
        // @TODO: Set up the vertex pipeline and shared material 
        // @TODO: Render flowers in all rooms
        // @NOTE: It appears that flowers are drawn for all rooms all the time
        // @TODO: Set the kyanko colors for each room
        colorCopy(materialParams.u_Color[ColorKind.C0], White);
        colorCopy(materialParams.u_Color[ColorKind.C1], White);

        // Draw white flowers
        // @TODO: Only loop over flowers in this room (using the linked list)
        materialParams.m_TextureMapping[0].copy(this.flowerModel.whiteTextureMapping);
        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;
            if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.WHITE) continue;

            const renderInst = this.flowerModel.shapeWhiteUncut.pushRenderInst(renderInstManager);
            const materialParamsOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.whiteMaterial.materialParamsBufferSize);
            this.flowerModel.whiteMaterial.fillMaterialParamsDataOnInst(renderInst, materialParamsOffs, materialParams);
            this.flowerModel.whiteMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, data.modelMatrix);
            this.flowerModel.shapeWhiteUncut.fillPacketParams(packetParams, renderInst);
        }

        // Draw pink flowers
        // @TODO: Only loop over flowers in this room (using the linked list)
        materialParams.m_TextureMapping[0].copy(this.flowerModel.pinkTextureMapping);
        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;
            if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.PINK) continue;

            const renderInst = this.flowerModel.shapePinkUncut.pushRenderInst(renderInstManager);
            const materialParamsOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.pinkMaterial.materialParamsBufferSize);
            this.flowerModel.pinkMaterial.fillMaterialParamsDataOnInst(renderInst, materialParamsOffs, materialParams);
            this.flowerModel.pinkMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, data.modelMatrix);
            this.flowerModel.shapePinkUncut.fillPacketParams(packetParams, renderInst);
        }

        // Draw bessou flowers
        // @TODO: Only loop over flowers in this room (using the linked list)
        materialParams.m_TextureMapping[0].copy(this.flowerModel.pinkTextureMapping);
        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;
            if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.BESSOU) continue;

            const renderInst = this.flowerModel.shapeBessouUncut.pushRenderInst(renderInstManager);
            const materialParamsOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.bessouMaterial.materialParamsBufferSize);
            this.flowerModel.bessouMaterial.fillMaterialParamsDataOnInst(renderInst, materialParamsOffs, materialParams);
            this.flowerModel.bessouMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, data.modelMatrix);
            this.flowerModel.shapeBessouUncut.fillPacketParams(packetParams, renderInst);
        }
    }
}

// ---------------------------------------------
// Grass Actor
// ---------------------------------------------
const kGrassSpawnPatterns = [
    { group: 0, count: 1},
    { group: 0, count: 7},
    { group: 1, count: 15},
    { group: 2, count: 3},
    { group: 3, count: 7},
    { group: 4, count: 11},
    { group: 5, count: 7},
    { group: 6, count: 5},
];

const kGrassSpawnOffsets = [
    [
        [0,0,0],
        [3,0,-0x32],
        [-2,0,0x32],
        [0x32,0,0x1b],
        [0x34,0,-0x19],
        [-0x32,0,0x16],
        [-0x32,0,-0x1d],
    ],
    [
        [-0x12,0,0x4c],
        [-0xf,0,0x1a],
        [0x85,0,0],
        [0x50,0,0x17],
        [0x56,0,-0x53],
        [0x21,0,-0x38],
        [0x53,0,-0x1b],
        [-0x78,0,-0x1a],
        [-0x12,0,-0x4a],
        [-0x14,0,-0x15],
        [-0x49,0,1],
        [-0x43,0,-0x66],    
        [-0x15,0,0x7e],
        [-0x78,0,-0x4e],
        [-0x46,0,-0x31],
        [0x20,0,0x67],
        [0x22,0,0x33],
        [-0x48,0,0x62],
        [-0x44,0,0x2f],
        [0x21,0,-5],
        [0x87,0,-0x35],
    ],
    [
        [-0x4b,0,-0x32],
        [0x4b,0,-0x19],
        [0xe,0,0x6a],
    ],
    [
        [-0x18,0,-0x1c],
        [0x1b,0,-0x1c],
        [-0x15,0,0x21],
        [-0x12,0,-0x22],
        [0x2c,0,-4],
        [0x29,0,10],
        [0x18,0,0x27],
    ],
    [
        [-0x37,0,-0x16],
        [-0x1c,0,-0x32],
        [-0x4d,0,0xb],
        [0x37,0,-0x2c],
        [0x53,0,-0x47],
        [0xb,0,-0x30],
        [0x61,0,-0x22],
        [-0x4a,0,-0x39],
        [0x1f,0,0x3a],
        [0x3b,0,0x1e],
        [0xd,0,0x17],
        [-0xc,0,0x36],
        [0x37,0,0x61],
        [10,0,0x5c],
        [0x21,0,-10],
        [-99,0,-0x1b],
        [0x28,0,-0x57],
    ],
    [
        [0,0,3],
        [-0x1a,0,-0x1d],
        [7,0,-0x19],
        [0x1f,0,-5],
        [-7,0,0x28],
        [-0x23,0,0xf],
        [0x17,0,0x20],
    ],
    [
        [-0x28,0,0],
        [0,0,0],
        [0x50,0,0],
        [-0x50,0,0],
        [0x28,0,0],
    ]
];

export class AGrass {
    static create(context: WwContext, actor: Actor) {
        enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (actor.parameters & 0x00F) >> 0;
        const type: FoliageType = (actor.parameters & 0x030) >> 4;

        const pattern = kGrassSpawnPatterns[spawnPatternId];
        const offsets = kGrassSpawnOffsets[pattern.group];
        const count = pattern.count;

        switch (type) {
            case FoliageType.Grass:

            break;

            case FoliageType.Tree:
                // for (let j = 0; j < count; j++) {
                //     const objectRenderer = buildSmallTreeModel(symbolMap);

                //     const x = offsets[j][0];
                //     const y = offsets[j][1];
                //     const z = offsets[j][2];
                //     const offset = vec3.set(scratchVec3a, x, y, z);

                //     setModelMatrix(objectRenderer.modelMatrix);
                //     mat4.translate(objectRenderer.modelMatrix, objectRenderer.modelMatrix, offset);
                //     setToNearestFloor(objectRenderer.modelMatrix, objectRenderer.modelMatrix);
                //     roomRenderer.objectRenderers.push(objectRenderer);
                //     objectRenderer.layer = layer;
                // }
            break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                if (!context.flowerPacket) context.flowerPacket = new FlowerPacket(context);

                const itemIdx = (actor.parameters >> 6) & 0x3f; // Determines which item spawns when this is cut down

                for (let j = 0; j < count; j++) {
                    const flowerType = (type == FoliageType.WhiteFlower) ? FlowerType.WHITE : FlowerType.PINK; 

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos); 

                    const data = context.flowerPacket.newData(pos, flowerType, actor.roomIndex, itemIdx);
                }
            break;
        }
        return;
    }
}