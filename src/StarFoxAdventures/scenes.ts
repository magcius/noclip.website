import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';

import { hexzero } from '../util';
import * as GX from '../gx/gx_enum';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoader, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { mat4 } from 'gl-matrix';

const pathBase = 'sfa';

class ModelInstance {
    verts: Int16Array;
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
    shapeHelper: GXShapeHelperGfx | null = null;
    materialHelper: GXMaterialHelperGfx;

    constructor(verts: Int16Array) {
        this.verts = verts;

        const gxMaterial: GX_Material.GXMaterial = {
            name: "sfa-material",
            lightChannels: [],
            texGens: [],
            tevStages: [
                {
                    colorInA: GX.CombineColorInput.ONE,
                    colorInB: GX.CombineColorInput.ONE,
                    colorInC: GX.CombineColorInput.ONE,
                    colorInD: GX.CombineColorInput.ONE,
                    colorOp: GX.TevOp.ADD,
                    colorRegId: GX.Register.PREV,
                    alphaInA: GX.CombineAlphaInput.ZERO,
                    alphaInB: GX.CombineAlphaInput.ZERO,
                    alphaInC: GX.CombineAlphaInput.ZERO,
                    alphaInD: GX.CombineAlphaInput.ZERO,
                    alphaOp: GX.TevOp.ADD,
                    alphaRegId: GX.Register.PREV,
                    texCoordId: GX.TexCoordID.TEXCOORD_NULL,
                    texMap: GX.TexMapID.TEXMAP_NULL,
                    channelId: GX.RasColorChannelID.COLOR_ZERO,
                    konstColorSel: GX.KonstColorSel.KCSEL_1,
                    konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
                },
            ],
            indTexStages: [],
            alphaTest: {
                op: GX.AlphaOp.AND,
                compareA: GX.CompareType.ALWAYS,
                referenceA: 0,
                compareB: GX.CompareType.ALWAYS,
                referenceB: 0,
            },
            ropInfo: {
                blendMode: {
                    type: GX.BlendMode.NONE,
                    srcFactor: GX.BlendFactor.ONE,
                    dstFactor: GX.BlendFactor.ZERO,
                    logicOp: GX.LogicOp.COPY,
                },
                depthTest: true,
                depthFunc: GX.CompareType.LESS,
                depthWrite: true,
            },
        };
        this.materialHelper = new GXMaterialHelperGfx(gxMaterial);

        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = [[]];
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            vat[0][i] = { compType: GX.CompType.F32, compShift: 0, compCnt: 0 };
        }
        vcd[GX.Attr.POS].type = GX.AttrType.DIRECT;
        vat[0][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };

        const vtxLoader = compileVtxLoader(vat[0], vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;

        const vtxArrays: GX_Array[] = [];
        const vertsBuffer = new ArrayBufferSlice(verts.buffer);
        vtxArrays[GX.Attr.POS] = { buffer: vertsBuffer, offs: 0, stride: getAttributeByteSize(vat[0], GX.Attr.POS) };
        const numVerts = (this.verts.length / 3)|0;
        const dl = new DataView(new ArrayBuffer(3 + 3*2*numVerts + 1));
        dl.setUint8(0, GX.Command.DRAW_TRIANGLES | 0); // Command
        dl.setUint16(1, this.verts.length / 3); // Vertex count
        for (let i = 0; i < this.verts.length; i++) {
            dl.setInt16(3 + i*2, this.verts[i]);
        }
        dl.setUint8(3 + this.verts.length*2, 0); // End
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, new ArrayBufferSlice(dl.buffer));
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
    model: ModelInstance;

    constructor(device: GfxDevice, verts: Int16Array) {
        super(device);
        this.model = new ModelInstance(verts);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.model.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

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
        
        const verts = new Int16Array(posCount * 3);
        offs = posOffset;
        for (let i = 0; i < posCount; i++) {
            verts[i * 3 + 0] = uncompDv.getInt16(offs + 0x00, false);
            verts[i * 3 + 1] = uncompDv.getInt16(offs + 0x02, false);
            verts[i * 3 + 2] = uncompDv.getInt16(offs + 0x04, false);
            offs += 0x06;
        }

        const renderer = new SFARenderer(device, verts);
        
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
