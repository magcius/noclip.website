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
import { drawWorldSpacePoint, getDebugOverlayCanvas2D, hexdump } from '../DebugJunk.js';
import { CTFileLoc, CTFileStore, CTShape } from '../../rust/pkg/noclip_support.js';
import { compilePartialVtxLoader, compileVtxLoader, compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VtxLoader } from '../gx/gx_displaylist.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { assert } from '../util.js';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { mat4, vec3 } from 'gl-matrix';
import { TextureHolder } from '../TextureHolder.js';
import { CameraController } from '../Camera.js';
import { addVelocityAwayFromTarget } from '../SuperMarioGalaxy/ActorUtil.js';

interface GX {
    vat: GX_VtxAttrFmt[][];
    vcd: GX_VtxDesc[];
    vtxLoader: VtxLoader;
}

function addVAT(vats: GX_VtxAttrFmt[][], fmt: GX.VtxFmt, pos: GX_VtxAttrFmt, nrm: GX_VtxAttrFmt, clr0: GX_VtxAttrFmt, clr1: GX_VtxAttrFmt, tex0?: GX_VtxAttrFmt) {
    let vat = [];
    vat[GX.Attr.POS] = pos;
    vat[GX.Attr.NRM] = nrm;
    vat[GX.Attr.CLR0] = clr0;
    vat[GX.Attr.CLR1] = clr1;
    if (tex0)
        vat[GX.Attr.TEX0] = tex0;
    vats[fmt] = vat;
}

function createVATs(): GX_VtxAttrFmt[][] {
    const vats: GX_VtxAttrFmt[][] = [];
    addVAT(
        vats,
        GX.VtxFmt.VTXFMT0,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 }
    );

    // VTXFMT1-4 are used widely
    addVAT(
        vats,
        GX.VtxFmt.VTXFMT1,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT2,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 8 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 7 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT3,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 14 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 7 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT4,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 8 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT5,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT6,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 6 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 8 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT7,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 6 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 },
    );

    return vats;
}

const VATS = createVATs();

interface Shape {
    vertexData: LoadedVertexData[],
    vertexLayouts: LoadedVertexLayout[],
    vertexFormats: Set<GX.VtxFmt>,
    scale: number,
    textures: string[],
}

const drawParams = new DrawParams();

class ShapeRenderer {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public indexBufferDescriptors: GfxIndexBufferDescriptor[] = [];
    public inputLayouts: GfxInputLayout[] = [];
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffers: GfxBuffer[] = [];
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();

    constructor(private cache: GfxRenderCache, private textureHolder: GXTextureHolder, public shape: Shape, public loadedVertexLayouts: LoadedVertexLayout[], public loadedVertexData: LoadedVertexData[]) {
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

        for (const layout of this.loadedVertexLayouts) {
            this.inputLayouts.push(createInputLayout(cache, layout));
        }

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
            if (this.loadedVertexData[i].totalIndexCount === 0)
                continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            mat4.copy(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
            mat4.scale(drawParams.u_PosMtx[0], drawParams.u_PosMtx[0], vec3.fromValues(this.shape.scale, this.shape.scale, this.shape.scale));
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
            this.textureHolder.fillTextureMapping(this.materialParams.m_TextureMapping[0], this.shape.textures[i]);
            renderInst.setVertexInput(this.inputLayouts[i], this.vertexBufferDescriptors, this.indexBufferDescriptors[i]);
            renderInst.setDrawCount(this.loadedVertexData[i].totalIndexCount);
            renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
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
    private renderHelper: GXRenderHelperGfx;
    private renderInstListMain = new GfxRenderInstList();

    private shapes: ShapeRenderer[] = [];

    constructor(device: GfxDevice, private manager: FileManager, public textureHolder: GXTextureHolder) {
        this.renderHelper = new GXRenderHelperGfx(device);
        const shapeNames: string[] = [
            "course_4b_055_a.shp",
            // "course_dc3b_031k.shp",
            // "ANIME_FUNSUI_001.shp",
            // "Chair.shp",
        ];

        for (const name of shapeNames) {
            const shape = this.manager.createShape(name);
            const renderer = new ShapeRenderer(
                this.renderHelper.renderCache,
                this.textureHolder,
                shape,
                shape.vertexLayouts,
                shape.vertexData
            );
            this.shapes.push(renderer);
        }
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);

        const template = this.renderHelper.pushTemplateRenderInst();

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (const shape of this.shapes) {
            shape.prepareToRender(renderInstManager, viewerInput);

            for (let i = 0; i < shape.shape.vertexData.length; i++) {
                const data = shape.shape.vertexData[i];
                const layout = shape.shape.vertexLayouts[i];
                if (data.totalVertexCount === 217) {
                    const stride = layout.vertexBufferStrides[0] / 4;
                    const offs = layout.vertexAttributeOffsets[GX.Attr.POS];
                    const buf = new Float32Array(data.vertexBuffers[0].slice(offs));
                    for (let j = 0; j < 100; j++) {
                        const v0 = buf[j * stride];
                        const v1 = buf[j * stride + 1];
                        const v2 = buf[j * stride + 2];
                        const p = vec3.fromValues(v0, v1, v2);
                        vec3.scale(p, p, shape.shape.scale);
                        drawWorldSpacePoint(
                            getDebugOverlayCanvas2D(),
                            viewerInput.camera.clipFromWorldMatrix,
                            p,
                            undefined,
                            10,
                        );
                    }
                }
            }
        }

        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.1);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.1);
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

    public debugShape(name: string) {
        const shape = this.fileStore.get_shape(name)!;
        const displayListData = this.getData(shape.display_list_loc()!);
        const vtxCmd = (displayListData.createDataView().getUint8(0) & 0xF8);
        const vtxFmt = (displayListData.createDataView().getUint8(0) & 0x07);
        console.log(`${name} DL cmd 0x${vtxCmd.toString(16)} fmt ${vtxFmt}`)
        console.log(`pos:`);
        hexdump(this.getData(shape.pos_loc()));
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

    public createShape(name: string): Shape {
        const shape = this.fileStore.get_shape(name)!;
        // each shape has several display lists concatenated together and
        // aligned on 0x20 blocks
        const displayListData = this.getData(shape.display_list_loc()!);
        let offs = 0;
        const vertexData: LoadedVertexData[] = [];

        const attrs: [GX.Attr, CTFileLoc | undefined][] = [
            [GX.Attr.POS, shape.pos_loc()],
            [GX.Attr.NRM, shape.nrm_loc()],
            [GX.Attr.CLR0, shape.clr_loc(0)],
            [GX.Attr.CLR1, shape.clr_loc(1)],
            [GX.Attr.TEX0, shape.tex_loc(0)],
            [GX.Attr.TEX1, shape.tex_loc(1)],
            [GX.Attr.TEX2, shape.tex_loc(2)],
            [GX.Attr.TEX3, shape.tex_loc(3)],
            [GX.Attr.TEX4, shape.tex_loc(4)],
            [GX.Attr.TEX5, shape.tex_loc(5)],
            [GX.Attr.TEX6, shape.tex_loc(6)],
            [GX.Attr.TEX7, shape.tex_loc(7)],
        ];

        const textures = shape.textures;
        const filaIdx = textures.indexOf('TT_Fila_ad_tr.tex');
        console.log(`fila ${filaIdx}`);

        // parse each display list
        const vertexLayouts = [];
        const vertexFormats: Set<GX.VtxFmt> = new Set();
        while (true) {
            const vtxFormat = (displayListData.slice(offs).createDataView().getUint8(0) & 0x07);
            vertexFormats.add(vtxFormat);
            const fmtVat = VATS[vtxFormat];
            const vcd: GX_VtxDesc[] = [];
            const vtxArrays: GX_Array[] = [];
            for (const [attr, loc] of attrs) {
                if (loc === undefined)
                    continue;
                vcd[attr] = { type: GX.AttrType.INDEX16 };
                vtxArrays[attr] = { buffer: this.getData(loc), offs: 0, stride: getAttributeByteSize(fmtVat, attr) };
            }
            // awkward hack
            let foo = [];
            foo[vtxFormat] = fmtVat;
            const vtxLoader = compileVtxLoaderMultiVat(foo, vcd);
            vertexLayouts.push(vtxLoader.loadedVertexLayout);
            const data = vtxLoader.runVertices(vtxArrays, displayListData.slice(offs));
            // for (const [attr, loc] of attrs) {
            //     if (loc === undefined)
            //         continue;
            //     const oldStride = vtxArrays[attr].stride;
            //     const newStride = getAttributeByteSize(VATS[newFormat], attr);
            //     assert(oldStride === newStride, 'difference in VTXFMT strides???')
            // }
            vertexData.push(data);
            assert(data.endOffs !== null);
            offs += data.endOffs + (0x20 - (data.endOffs % 0x20));
            if (offs >= displayListData.byteLength) {
                break;
            }
        }

        const scale = shape.scale();
        return { vertexData, vertexLayouts, vertexFormats, scale, textures };
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
            if (fileName.endsWith('.all')) {
                this.fileStore.append_archive(fileName, data.createTypedArray(Uint8Array));
            } else {
                this.fileStore.append_file(fileName, data.createTypedArray(Uint8Array));
            }
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
            "poldc1.all",
            "poldc1_stream.all",
            "poldc2.all",
            "poldc2_stream.all",
            "poldc3.all",
            "poldc3_stream.all",
            "texDC0.all",
            "texDC1.all",
            "texDC2.all",
            "texdc3.all",
            "cube0.shp",
            "white.tex",
        ]);
        await manager.fetch();

        // manager.debugShape('course_4_154.shp'); // FMT1
        // manager.debugShape('CT_train.shp'); // FMT2
        // manager.debugShape('ANIME_FUNSUI_001.shp'); // FMT3
        // manager.debugShape('course_4c_043.shp'); // FMT4

        // FILA havers
        // manager.debugShape('course_4b_055_a.shp');
        // manager.debugShape('course_dc3b_031k.shp'); // in poldc2_stream.all

        const textures: GXTexture.TextureInputGX[] = [];
        for (const filename of manager.fileStore.list_textures()) {
            textures.push(manager.createTexture(filename));
        }
        const textureHolder = new GXTextureHolder();
        textureHolder.addTextures(gfxDevice, textures);
        const scene = new Scene(gfxDevice, manager, textureHolder);
        return scene;
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('level0', 'Main Level'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
