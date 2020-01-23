import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";

import { hexzero, nArray } from '../util';
import * as GX from '../gx/gx_enum';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { mat4 } from 'gl-matrix';

const pathBase = 'sfa';

class ModelInstance {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
    shapeHelper: GXShapeHelperGfx | null = null;
    materialHelper: GXMaterialHelperGfx;

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const mb = new GXMaterialBuilder('Basic');
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(true, GX.CompareType.LESS, true);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.RASC);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;

        // const vtxArrays: GX_Array[] = [];
        // const vertsBuffer = new ArrayBufferSlice(verts.buffer);
        // vtxArrays[GX.Attr.POS] = { buffer: vertsBuffer, offs: 0, stride: getAttributeByteSize(vat[0], GX.Attr.POS) };
        // this.loadedVertexData = vtxLoader.runVertices(vtxArrays, new ArrayBufferSlice(dl.buffer));
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
        console.log(`loaded vertex data ${JSON.stringify(this.loadedVertexData, null, '\t')}`);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        // mat4.mul(dst, dst, this.sceneGraphNode.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }

        // const template = renderInstManager.pushTemplateRenderInst();
        // this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        // const materialParams = new MaterialParams();
        // this.materialHelper.fillMaterialParamsDataOnInst(template, 0, materialParams);
        //this.materialHelper.fillMaterialParamsData(renderInstManager, 0, materialParams);

        // const packetParams = new PacketParams();
        // packetParams.clear();
        // for (let p = 0; p < this.shapeHelper.loadedVertexData.packets.length; p++) {
        //     const packet = this.shapeHelper.loadedVertexData.packets[p];

        //     const renderInst = this.shapeHelper.pushRenderInst(renderInstManager, packet);
        //     this.shapeHelper.fillPacketParams(packetParams, renderInst);
        // }
        
        const materialParams = new MaterialParams();
        const packetParams = new PacketParams();
        packetParams.clear();

        const renderInst = this.shapeHelper.pushRenderInst(renderInstManager);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);
        // this.materialCommand.fillMaterialParams(materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, materialParams);
        this.computeModelView(packetParams.u_PosMtx[0], viewerInput.camera);
        this.shapeHelper.fillPacketParams(packetParams, renderInst);

        // renderInstManager.popTemplateRenderInst();
    }
}

class SFARenderer extends BasicGXRendererHelper {
    models: ModelInstance[] = [];

    public addModel(model: ModelInstance) {
        this.models.push(model);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }
}

class ZLBHeader {
    static readonly SIZE = 16;

    magic: number;
    unk4: number;
    unk8: number;
    size: number;

    constructor(dv: DataView) {
        this.magic = dv.getUint32(0x0);
        this.unk4 = dv.getUint32(0x4);
        this.unk8 = dv.getUint32(0x8);
        this.size = dv.getUint32(0xC);
    }
}

function stringToFourCC(s: string): number {
    return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
}

// Reads bitfields by pulling from the low bits of each byte in sequence
class LowBitReader {
    dv: DataView
    offs: number
    num: number
    buf: number

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    peek(bits: number): number {
        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << this.num
            this.offs++;
            this.num += 8;
        }
        return this.buf & ((1<<bits)-1);
    }

    drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf >>>= bits
        this.num -= bits
    }

    get(bits: number): number {
        const x = this.peek(bits)
        this.drop(bits)
        return x
    }
}

class SFASceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const sceneData = await dataFetcher.fetchData(`${pathBase}/${this.id}`);

        console.log(`Creating SFA scene for ${this.id} ...`);

        let offs = 0;
        const dv = sceneData.createDataView();
        const header = new ZLBHeader(dv);
        offs += ZLBHeader.SIZE;

        if (header.magic != stringToFourCC('ZLB\0')) {
            throw Error(`Invalid magic identifier 0x${hexzero(header.magic, 8)}`);
        }

        const uncompressed = pako.inflate(new Uint8Array(sceneData.copyToBuffer(ZLBHeader.SIZE, header.size)));
        const uncompDv = new DataView(uncompressed.buffer);

        const posOffset = uncompDv.getUint32(0x58);
        const posCount = uncompDv.getUint16(0x90);
        console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const vertBuffer = new ArrayBufferSlice(uncompDv.buffer, posOffset, posCount * 3*2);

        const clrOffset = uncompDv.getUint32(0x5C);
        const clrCount = uncompDv.getUint16(0x94);
        console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = new ArrayBufferSlice(uncompDv.buffer, clrOffset, clrCount * 2);

        const polyOffset = uncompDv.getUint32(0x64);
        const polyCount = uncompDv.getUint8(0xA1);
        console.log(`Loading ${polyCount} polygons from 0x${polyOffset.toString(16)}`);

        interface PolygonType {
            hasNormal: boolean;
            hasColor: boolean;
            hasTexCoord: boolean[];
        }

        const polyTypes: PolygonType[] = [];
        offs = polyOffset;
        for (let i = 0; i < polyCount; i++) {
            const polyType = {
                hasNormal: false,
                hasColor: false,
                hasTexCoord: nArray(8, () => false),
            };
            console.log(`parsing polygon attributes ${i}`);
            const unk8 = uncompDv.getUint32(offs + 8);
            console.log(`unk8 (flag 0x1): ${unk8}`);
            const unk14 = uncompDv.getUint32(offs + 0x14);
            console.log(`unk14 (flag 0x2): ${unk14}`);
            const attrFlags = uncompDv.getUint8(offs + 0x40);
            polyType.hasNormal = (attrFlags & 1) != 0;
            polyType.hasColor = (attrFlags & 2) != 0;
            const numTexCoords = uncompDv.getUint8(offs + 0x41);
            if (attrFlags & 4) {
                for (let j = 0; j < numTexCoords; j++) {
                    polyType.hasTexCoord[j] = true;
                }
            }
            const unk42 = uncompDv.getUint8(offs + 0x42);
            console.log(`attrFlags 0x${hexzero(attrFlags, 2)}, numTexCoords ${numTexCoords}, unk42 0x${hexzero(unk42, 2)}`);
            polyTypes.push(polyType);
            offs += 0x44;
        }
        
        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            for (let j = 0; j < 8; j++) {
                vat[j][i] = { compType: GX.CompType.F32, compShift: 0, compCnt: 0 };
            }
        }
        vcd[GX.Attr.POS].type = GX.AttrType.INDEX16;
        for (let i = 0; i < 8; i++) {
            vat[i][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
            vat[i][GX.Attr.CLR0] = { compType: GX.CompType.RGB565, compShift: 0, compCnt: GX.CompCnt.CLR_RGB };
            vat[i][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
        }

        const chunkOffset = uncompDv.getUint32(0x68);
        console.log(`chunkOffset 0x${chunkOffset.toString(16)}`);

        const bitsOffset = uncompDv.getUint32(0x78);
        const bitsCount = uncompDv.getUint16(0x84);
        console.log(`Loading ${bitsCount} bits from 0x${bitsOffset.toString(16)}`);

        let displayList = new ArrayBufferSlice(new ArrayBuffer(1));

        const renderer = new SFARenderer(device);

        const bits = new LowBitReader(uncompDv, bitsOffset);
        let done = false;
        let curPolyType = 0;
        // setPolyType(curPolyType);
        while (!done) {
            const opcode = bits.get(4);
            switch (opcode) {
            case 1: // Set polygon type
                curPolyType = bits.get(6);
                // setPolyType(curPolyType);
                console.log(`setting poly type ${curPolyType}`);
                break;
            case 2: // Geometry
                const chunkNum = bits.get(8);
                console.log(`geometry chunk #${chunkNum}`);
                offs = chunkOffset + chunkNum * 0x1C;
                const dlOffset = uncompDv.getUint32(offs);
                const dlSize = uncompDv.getUint16(offs + 4);
                displayList = new ArrayBufferSlice(uncompDv.buffer, dlOffset, dlSize);
                // displayList = uncompDv.buffer.slice(dlOffset, dlOffset + dlSize);
                console.log(`DL offset 0x${dlOffset.toString(16)} size 0x${dlSize.toString(16)}`);

                const vtxArrays: GX_Array[] = [];
                vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
                vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
                vtxArrays[GX.Attr.TEX0] = { buffer: new ArrayBufferSlice(new ArrayBuffer(0x10000)), offs: 0, stride: getAttributeByteSize(vat[0], GX.Attr.TEX0) };
                console.log(`Using VCD ${JSON.stringify(vcd, null, '\t')}`);
                try {
                    const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList);
                    renderer.addModel(newModel);
                } catch (e) {
                    console.error(e);
                }
                // renderer.addModel(new ModelInstance(vtxArrays, vcd, vat, displayList));

                // XXX: finish now
                // done = true;
                break;
            case 3: // Set vertex attributes
                const posDesc = bits.get(1);
                console.log(`posDesc ${posDesc}`);
                vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                if (polyTypes[curPolyType].hasNormal) {
                    const normalDesc = bits.get(1);
                    console.log(`normalDesc ${normalDesc}`);
                    vcd[GX.Attr.NRM].type = normalDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                } else {
                    vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                }
                if (polyTypes[curPolyType].hasColor) {
                    const colorDesc = bits.get(1);
                    console.log(`colorDesc ${colorDesc}`);
                    vcd[GX.Attr.CLR0].type = colorDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                } else {
                    vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
                }
                if (polyTypes[curPolyType].hasTexCoord[0]) {
                    const texCoordDesc = bits.get(1);
                    console.log(`texCoordDesc: ${texCoordDesc}`);
                    // Note: texCoordDesc applies to all texture coordinates in the vertex
                    for (let t = 0; t < 8; t++) {
                        if (polyTypes[curPolyType].hasTexCoord[t]) {
                            vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                        } else {
                            vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
                        }
                    }
                }
                break;
            case 4: // Set weights
                const numWeights = bits.get(4);
                for (let i = 0; i < numWeights; i++) {
                    const weight = bits.get(8);
                    console.log(`weight ${i}: ${weight}`);
                }
                break;
            case 5: // End
                done = true;
                break;
            default:
                throw Error(`Unknown model bits opcode ${opcode}`);
            }
        }
        
        return renderer;
    }
}

const sceneDescs = [
    'Test',
    new SFASceneDesc('mod48.zlb.bin', 'Cape Claw'),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
