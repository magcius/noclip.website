import * as Viewer from '../viewer.js';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxProgram, GfxTexture, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { rust } from '../rustlib.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as GX from '../gx/gx_enum.js';
import * as GXTexture from '../gx/gx_texture.js';
import { DataFetcher, NamedArrayBufferSlice } from '../DataFetcher.js';
import { createInputLayout, DrawParams, fillSceneParamsData, fillSceneParamsDataOnTemplate, GXMaterialHelperGfx, GXRenderHelperGfx, GXTextureHolder, MaterialParams } from '../gx/gx_render.js';
import { hexdump } from '../DebugJunk.js';
import { CTFileLoc, CTFileStore, CTShape } from '../../rust/pkg/noclip_support.js';
import { compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VtxLoader } from '../gx/gx_displaylist.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { assert } from '../util.js';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { mat4 } from 'gl-matrix';

interface GX {
    vat: GX_VtxAttrFmt[][];
    vcd: GX_VtxDesc[];
    vtxLoader: VtxLoader;
}

function createVtxLoader(): GX {
    const vat: GX_VtxAttrFmt[][] = [];
    // VTXFMT1-4 are used widely
    // vat[GX.VtxFmt.VTXFMT1] = [];
    // vat[GX.VtxFmt.VTXFMT2] = [];
    vat[GX.VtxFmt.VTXFMT3] = [];
    vat[GX.VtxFmt.VTXFMT3][GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 0 };
    vat[GX.VtxFmt.VTXFMT3][GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB8, compShift: 0 };
    vat[GX.VtxFmt.VTXFMT3][GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S8, compShift: 6 }; // ?
    // vat[GX.VtxFmt.VTXFMT4] = [];
    const vcd: GX_VtxDesc[] = [];
    vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX16 };
    vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX16 };
    vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX16 };
    return {
        vcd, vat,
        vtxLoader: compileVtxLoaderMultiVat(vat, vcd),
    };
}

interface Shape {
    vertexData: LoadedVertexData[],
    vertexLayout: LoadedVertexLayout,
    scale: number,
    textures: string[],
}

const materialParams = new MaterialParams();
const drawParams = new DrawParams();

class ShapeRenderer {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public indexBufferDescriptors: GfxIndexBufferDescriptor[] = [];
    public inputLayout: GfxInputLayout;
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffers: GfxBuffer[] = [];
    private materialHelper: GXMaterialHelperGfx;

    constructor(private cache: GfxRenderCache, private textureHolder: GXTextureHolder, private shape: Shape, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData[]) {
        const device = cache.device;
        for (const data of this.loadedVertexData) {
            for (let i = 0; i < data.vertexBuffers.length; i++) {
                const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex,
                    GfxBufferFrequencyHint.Static,
                    data.vertexBuffers[i]);
                device.uploadBufferData(vertexBuffer, 0, new Uint8Array(data.vertexBuffers[i]));
                this.vertexBuffers.push(vertexBuffer);
                this.vertexBufferDescriptors.push({ buffer: vertexBuffer });
            }
            const indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, data.indexData);
            this.indexBuffers.push(indexBuffer);
            this.indexBufferDescriptors.push({ buffer: indexBuffer });
        }

        this.inputLayout = createInputLayout(cache, loadedVertexLayout);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.indexBuffers.length; i++) {
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            mat4.copy(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
            renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptors[i]);
            renderInst.setDrawCount(this.loadedVertexData[i].totalIndexCount);
            this.textureHolder.fillTextureMapping(materialParams.m_TextureMapping[0], this.shape.textures[i]);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice): void {
        // Do not destroy inputLayout; it is owned by the render cache.
        for (let buffer of this.vertexBuffers)
            device.destroyBuffer(buffer);
        for (let buffer of this.indexBuffers)
            device.destroyBuffer(buffer);
    }
}

export class Scene implements Viewer.SceneGfx {
    private gx: GX;
    private renderHelper: GXRenderHelperGfx;
    private renderInstListMain = new GfxRenderInstList();
    public textureHolder = new GXTextureHolder();

    private shapes: ShapeRenderer[] = [];

    constructor(device: GfxDevice, private manager: FileManager) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.gx = createVtxLoader();
        const shapeNames = [
            "ANIME_FUNSUI_001.shp",
        ];

        for (const name of shapeNames) {
            const shape = this.manager.createShape(name, this.gx);
            console.log(shape.vertexData);
            const renderer = new ShapeRenderer(this.renderHelper.renderCache, this.textureHolder, shape, shape.vertexLayout, shape.vertexData);
            this.shapes.push(renderer);
        }
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);

        const template = this.renderHelper.pushTemplateRenderInst();

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (const shape of this.shapes)
            shape.prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        this.prepareToRender(device, viewerInput);
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");

        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}

class FileManager {
    public fileStore: CTFileStore;
    private fileData: NamedArrayBufferSlice[] = [];

    constructor(public dataFetcher: DataFetcher, public fileNames: string[]) {
        this.fileStore = rust.CTFileStore.new();
    }

    private debugShape(name: string) {
        const shape = this.fileStore.get_shape(name)!;
        const posData = this.getData(shape.pos_loc());
        const displayListData = this.getData(shape.display_list_loc()!);
        const vtxCmd = (displayListData.createDataView().getUint8(0) & 0xF8);
        const vtxFmt = (displayListData.createDataView().getUint8(0) & 0x07);
        console.log(`DL cmd 0x${vtxCmd.toString(16)} fmt ${vtxFmt}`)
        const otherData: [string, CTFileLoc | undefined][] = [
            ['nrm', shape.nrm_loc()],
            ['clr0', shape.clr_loc(0)],
            ['clr1', shape.clr_loc(1)],
            ['tex0', shape.tex_loc(0)],
            ['tex1', shape.tex_loc(1)],
            ['tex2', shape.tex_loc(2)],
            ['tex3', shape.tex_loc(3)],
            ['tex4', shape.tex_loc(4)],
            ['tex5', shape.tex_loc(5)],
            ['tex6', shape.tex_loc(6)],
            ['tex7', shape.tex_loc(7)],
        ];
        for (let [tag, loc] of otherData) {
            if (loc !== undefined) {
                console.log(`${tag}:`);
                hexdump(this.getData(loc));
            } else {
                console.log(`${tag}: N/A`);
            }
        }
    }

    public createShape(name: string, gx: GX): Shape {
        this.debugShape(name);
        const shape = this.fileStore.get_shape(name)!;
        // each shape has several display lists concatenated together and
        // aligned on 0x20 blocks
        const displayListData = this.getData(shape.display_list_loc()!);
        let offs = 0;
        const vertexData: LoadedVertexData[] = [];

        // assume it's the same VTXFMT for all displaylists?
        const vertexFormat = (displayListData.createDataView().getUint8(0) & 0x07);
        const fmtVat = gx.vat[vertexFormat];
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS] = { buffer: this.getData(shape.pos_loc()), offs: 0, stride: getAttributeByteSize(fmtVat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: this.getData(shape.clr_loc(0)!), offs: 0, stride: getAttributeByteSize(fmtVat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: this.getData(shape.tex_loc(0)!), offs: 0, stride: getAttributeByteSize(fmtVat, GX.Attr.TEX0) };

        // parse each display list
        while (true) {
            console.log(`parsing list ${vertexData.length}`);
            const data = gx.vtxLoader.runVertices(vtxArrays, displayListData.slice(offs));
            const newFormat = (displayListData.slice(offs).createDataView().getUint8(0) & 0x07);
            assert(newFormat === vertexFormat, `non-homogenous VTXFMTs in ${name}`);
            vertexData.push(data);
            assert(data.endOffs !== null);
            offs += data.endOffs + (0x20 - (data.endOffs % 0x20));
            if (offs >= displayListData.byteLength) {
                break;
            }
        }

        const vertexLayout = gx.vtxLoader.loadedVertexLayout;
        const scale = shape.scale();
        const textures = shape.textures.map((x) => x.slice(0, -1));
        return { vertexData, vertexLayout, scale, textures };
    }

    public createTexture(name: string): GXTexture.TextureInputGX {
        const texture = this.fileStore.get_texture(name)!;
        const data = this.getData(texture.data_loc());
        return {
            name,
            width: texture.width(),
            height: texture.height(),
            mipCount: 1, // ???
            format: texture.format(),
            data,
        };
    }

    public getData(loc: CTFileLoc): ArrayBufferSlice {
        const data = this.fileData[loc.file_id];
        return data.slice(loc.offset, loc.offset + loc.length);
    }

    async fetch() {
        const basePath = "CrazyTaxi/files/ct";
        for (const fileName of this.fileNames) {
            const data = await this.dataFetcher.fetchData(`${basePath}/${fileName}`);
            this.fileStore.append_archive(fileName, data.createTypedArray(Uint8Array));
            this.fileData.push(data);
        }
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const manager = new FileManager(context.dataFetcher, [
            "polDC0.all",
            "texDC0.all",
            "polDC1.all",
            "texDC1.all",
        ]);
        await manager.fetch();

        const textures: GXTexture.TextureInputGX[] = [];
        for (const filename of manager.fileStore.list_textures()) {
            textures.push(manager.createTexture(filename));
        }
        const scene = new Scene(gfxDevice, manager);
        scene.textureHolder.addTextures(gfxDevice, textures);
        return scene;
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('level0', 'Main Level'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
