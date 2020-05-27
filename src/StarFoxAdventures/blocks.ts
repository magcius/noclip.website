import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import * as Viewer from '../viewer';
import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GX_VtxDesc, GX_VtxAttrFmt, GX_Array } from '../gx/gx_displaylist';
import { nArray } from '../util';
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { ColorTexture } from '../gfx/helpers/RenderTargetHelpers';

import { TextureFetcher, FakeTextureFetcher } from './textures';
import { getSubdir, loadRes } from './resource';
import { GameInfo } from './scenes';
import { Shader, SFAMaterial, makeMaterialTexture, MaterialFactory, ShaderAttrFlags, ShaderFlags } from './shaders';
import { Shape, Model, ModelInstance, ModelViewState, ModelVersion } from './models';
import { LowBitReader } from './util';
import { SFAAnimationController } from './animation';
import { DataFetcher } from '../DataFetcher';

export abstract class BlockFetcher {
    public abstract async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<BlockRenderer | null>;
}

export abstract class BlockRenderer {
    public abstract getMaterials(): (SFAMaterial | undefined)[];
    public abstract getNumDrawSteps(): number;
    public abstract prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, drawStep: number, modelViewState: ModelViewState): void;
    public abstract prepareToRenderWaters(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, modelViewState: ModelViewState): void;
    public abstract prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, modelViewState: ModelViewState): void;
}

export class BlockCollection {
    private tab: DataView;
    private bin: ArrayBufferSlice;
    private blockRenderers: BlockRenderer[] = [];

    private constructor(private device: GfxDevice, private materialFactory: MaterialFactory, private animController: SFAAnimationController, private texFetcher: TextureFetcher, private modelVersion: ModelVersion, private isCompressed: boolean, private isAncient: boolean) {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, tabPath: string, binPath: string, device: GfxDevice, materialFactory: MaterialFactory, animController: SFAAnimationController, texFetcher: TextureFetcher, modelVersion: ModelVersion = ModelVersion.Final, isCompressed: boolean = true, isAncient: boolean = false): Promise<BlockCollection> {
        const self = new BlockCollection(device, materialFactory, animController, texFetcher, modelVersion, isCompressed, isAncient);

        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${tabPath}`),
            dataFetcher.fetchData(`${pathBase}/${binPath}`),
        ]);
        self.tab = tab.createDataView();
        self.bin = bin;

        return self;
    }

    public getBlockRenderer(num: number): BlockRenderer | null {
        if (this.blockRenderers[num] === undefined) {
            const tabValue = this.tab.getUint32(num * 4);
            if (!(tabValue & 0x10000000)) {
                return null;
            }

            const blockOffset = tabValue & 0xffffff;
            const blockBin = this.bin.subarray(blockOffset);
            const uncomp = this.isCompressed ? loadRes(blockBin) : blockBin;

            if (uncomp === null)
                return null;
            if (this.isAncient) {
                this.blockRenderers[num] = new AncientBlockRenderer(this.device, uncomp, this.texFetcher, this.animController);
            } else {
                this.blockRenderers[num] = new ModelInstance(new Model(this.device, this.materialFactory, uncomp, this.texFetcher, this.animController, this.modelVersion));
            }
        }

        return this.blockRenderers[num];
    }
}

function getModFileNum(mod: number): number {
    if (mod < 5) { // This is strange, but it matches the original game.
        return mod;
    } else {
        return mod + 1;
    }
}

export class SFABlockFetcher implements BlockFetcher {
    private trkblkTab: DataView;
    private blockColls: BlockCollection[] = [];
    private texFetcher: TextureFetcher;

    private constructor(private gameInfo: GameInfo, private device: GfxDevice, private materialFactory: MaterialFactory, private animController: SFAAnimationController) {
    }

    private async init(dataFetcher: DataFetcher, texFetcherPromise: Promise<TextureFetcher>) {
        const pathBase = this.gameInfo.pathBase;
        const [trkblk, texFetcher] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`),
            texFetcherPromise,
        ]);
        this.trkblkTab = trkblk.createDataView();
        this.texFetcher = texFetcher;
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, device: GfxDevice, materialFactory: MaterialFactory, animController: SFAAnimationController, texFetcherPromise: Promise<TextureFetcher>) {
        const self = new SFABlockFetcher(gameInfo, device, materialFactory, animController);
        await self.init(dataFetcher, texFetcherPromise);
        return self;
    }

    public async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<BlockRenderer | null> {
        if (mod < 0 || mod * 2 >= this.trkblkTab.byteLength) {
            return null;
        }

        const blockColl = await this.fetchBlockCollection(mod, dataFetcher);
        const trkblk = this.trkblkTab.getUint16(mod * 2);
        const blockNum = trkblk + sub;
        return blockColl.getBlockRenderer(blockNum);
    }

    private async fetchBlockCollection(mod: number, dataFetcher: DataFetcher): Promise<BlockCollection> {
        if (this.blockColls[mod] === undefined) {
            const subdir = getSubdir(mod, this.gameInfo);
            const modNum = getModFileNum(mod);
            const tabPath = `${subdir}/mod${modNum}.tab`;
            const binPath = `${subdir}/mod${modNum}.zlb.bin`;
            const [blockColl, _] = await Promise.all([
                BlockCollection.create(this.gameInfo, dataFetcher, tabPath, binPath, this.device, this.materialFactory, this.animController, this.texFetcher),
                this.texFetcher.loadSubdirs([subdir], dataFetcher),
            ]);
            this.blockColls[mod] = blockColl;
        }

        return this.blockColls[mod];
    }
}

export class SwapcircleBlockFetcher implements BlockFetcher {
    private blockColl: BlockCollection;

    private constructor(private gameInfo: GameInfo, private device: GfxDevice, private materialFactory: MaterialFactory, private animController: SFAAnimationController, private texFetcher: TextureFetcher) {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, device: GfxDevice, materialFactory: MaterialFactory, animController: SFAAnimationController, texFetcher: TextureFetcher) {
        const self = new SwapcircleBlockFetcher(gameInfo, device, materialFactory, animController, texFetcher);

        const subdir = `swapcircle`;
        const tabPath = `${subdir}/mod22.tab`;
        const binPath = `${subdir}/mod22.bin`;
        self.blockColl = await BlockCollection.create(self.gameInfo, dataFetcher, tabPath, binPath, self.device, self.materialFactory, self.animController, self.texFetcher, ModelVersion.BetaMap, false);

        return self;
    }

    public async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<BlockRenderer | null> {
        console.log(`fetching swapcircle block ${mod}.${sub}`);
        return this.blockColl.getBlockRenderer(0x21c + sub);
    }
}

export class AncientBlockRenderer implements BlockRenderer {
    public shapes: Shape[] = [];
    public yTranslate: number = 0;

    // TODO: move this stuff to models.ts
    constructor(device: GfxDevice, blockData: ArrayBufferSlice, texFetcher: TextureFetcher, private animController: SFAAnimationController) {
        let offs = 0;
        const blockDv = blockData.createDataView();

        const fields = {
            texOffset: 0x58,
            posOffset: 0x5c,
            clrOffset: 0x60,
            texcoordOffset: 0x64,
            shaderOffset: 0x68,
            listOffsets: 0x6c,
            listSizes: 0x70,
            bitstreamOffset: 0x7c, // Whoa...
            texCount: 0xa0,
            posCount: 0x90,
            clrCount: 0x94,
            texcoordCount: 0x96,
            shaderCount: 0x9a, // Polygon attributes and material information
            shaderSize: 0x3c,
            listCount: 0x99,
            numListBits: 6,
            numLayersOffset: 0x3b,
            // FIXME: There are three bitstreams, probably for opaque and transparent objects
            bitstreamByteCount: 0x86,
            hasYTranslate: false,
            oldShaders: true,
        };

        // @0x8: data size
        // @0xc: 4x3 matrix (placeholder; always zeroed in files)
        // @0x8e: y translation (up/down)

        //////////// TEXTURE STUFF TODO: move somewhere else

        const texOffset = blockDv.getUint32(fields.texOffset);
        const texCount = blockDv.getUint8(fields.texCount);
        // console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
        const texIds: number[] = [];
        for (let i = 0; i < texCount; i++) {
            const texIdFromFile = blockDv.getUint32(texOffset + i * 4);
            // console.log(`texid ${i} = 0x${texIdFromFile.toString(16)}`);
            texIds.push(texIdFromFile);
        }
        // console.log(`tex ids: ${JSON.stringify(texIds)}`);

        //////////////////////////

        const posOffset = blockDv.getUint32(fields.posOffset);
        // const posCount = blockDv.getUint16(fields.posCount);
        // console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const vertBuffer = blockData.subarray(posOffset);

        const clrOffset = blockDv.getUint32(fields.clrOffset);
        // const clrCount = blockDv.getUint16(fields.clrCount);
        // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = blockData.subarray(clrOffset);

        const texcoordOffset = blockDv.getUint32(fields.texcoordOffset);
        // const texcoordCount = blockDv.getUint16(fields.texcoordCount);
        // console.log(`Loading ${coordCount} texcoords from 0x${coordOffset.toString(16)}`);
        const texcoordBuffer = blockData.subarray(texcoordOffset);

        const shaderOffset = blockDv.getUint32(fields.shaderOffset);
        const shaderCount = blockDv.getUint8(fields.shaderCount);
        // console.log(`Loading ${polyCount} polytypes from 0x${polyOffset.toString(16)}`);

        const shaders: Shader[] = [];
        offs = shaderOffset;
        for (let i = 0; i < shaderCount; i++) {
            const shader: Shader = {
                layers: [{ // 1 layer (fake)
                    texId: texIds[blockDv.getUint32(offs + 0x24)], // ???
                    tevMode: 0,
                    enableTexChainStuff: 0,
                    scrollingTexMtx: undefined,
                }],
                flags: ShaderFlags.CullBackface,
                attrFlags: ShaderAttrFlags.CLR,
                hasAuxTex0: false,
                hasAuxTex1: false,
                hasAuxTex2: false,
                auxTex2Num: -1,
                furRegionsTexId: -1,
            };
            
            // shader.tex1Num = blockDv.getUint32(offs + 0x24 + 8); // ???
            shader.flags = blockDv.getUint32(offs + 0x3c);
            
            shaders.push(shader);
            offs += fields.shaderSize;
        }
        
        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            for (let j = 0; j < 8; j++) {
                vat[j][i] = { compType: GX.CompType.U8, compShift: 0, compCnt: 0 };
            }
        }

        // vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.POS].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.CLR0].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.TEX0].type = GX.AttrType.DIRECT;

        // TODO: Implement normals and lighting
        vat[0][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[0][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[0][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };
        
        vat[1][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 2, compCnt: GX.CompCnt.POS_XYZ };
        vat[1][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[1][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
        
        vat[2][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[2][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[2][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
        vat[2][GX.Attr.TEX1] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

        vat[3][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
        vat[3][GX.Attr.NBT] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_NBT };
        vat[3][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[3][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        
        vat[4][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[4][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[4][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

        vat[5][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[5][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[5][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };

        vat[6][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
        vat[6][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[6][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

        vat[7][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[7][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[7][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

        const listOffsets = blockDv.getUint32(fields.listOffsets);
        const listSizes = blockDv.getUint32(fields.listSizes);
        const listCount = blockDv.getUint8(fields.listCount);
        // console.log(`Loading ${listCount} display lists from 0x${listOffsets.toString(16)} (sizes at 0x${listSizes.toString(16)})`);

        const bitstreamOffset = blockDv.getUint32(fields.bitstreamOffset);
        const bitstreamByteCount = blockDv.getUint16(fields.bitstreamByteCount);
        // console.log(`Loading ${bitstreamByteCount} bitstream bytes from 0x${bitstreamOffset.toString(16)}`);

        if (fields.hasYTranslate) {
            this.yTranslate = blockDv.getInt16(0x8e);
        } else {
            this.yTranslate = 0;
        }

        const bits = new LowBitReader(blockDv, bitstreamOffset);
        let done = false;
        let curShader = 0;
        while (!done) {
            const opcode = bits.get(4);
            switch (opcode) {
            case 1: // Set polygon type
                curShader = bits.get(6);
                // console.log(`setting poly type ${curPolyType}`);
                break;
            case 2: // Geometry
                const listNum = bits.get(fields.numListBits);
                // console.log(`Drawing display list #${chunkNum}`);
                if (listNum >= listCount) {
                    console.warn(`Can't draw display list #${listNum} (out of range)`);
                    continue;
                }
                offs = listOffsets + listNum * 4;
                const dlOffset = blockDv.getUint32(offs);
                offs = listSizes + listNum * 2
                const dlSize = blockDv.getUint16(offs);
                // console.log(`DL offset 0x${dlOffset.toString(16)} size 0x${dlSize.toString(16)}`);
                const displayList = blockData.subarray(dlOffset, dlSize);

                const vtxArrays: GX_Array[] = [];
                vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
                vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
                for (let t = 0; t < 8; t++) {
                    vtxArrays[GX.Attr.TEX0 + t] = { buffer: texcoordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
                }

                try {
                    const shader = shaders[curShader];
                    const newShape = new Shape(device, vtxArrays, vcd, vat, displayList, this.animController, false, false);

                    const mb = new GXMaterialBuilder('Basic');
                    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
                    mb.setZMode(true, GX.CompareType.LESS, true);
                    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                    mb.setCullMode((shader.flags & ShaderFlags.CullBackface) ? GX.CullMode.BACK : GX.CullMode.NONE);
                    let tevStage = 0;
                    let texcoordId = GX.TexCoordID.TEXCOORD0;
                    let texmapId = GX.TexMapID.TEXMAP0;
                    let texGenSrc = GX.TexGenSrc.TEX0;
                    for (let i = 0; i < shader.layers.length; i++) {
                        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.IDENTITY);

                        // mb.setTevKColor (does not exist)
                        // mb.setTevKColorSel(tevStage, GX.KonstColorSel.KCSEL_K0);
                        mb.setTevDirect(tevStage);
                        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
                        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.ONE /*GX.CombineColorInput.KONST*/, GX.CC.RASC, GX.CC.ZERO);
                        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
                        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

                        mb.setTevDirect(tevStage + 1);
                        mb.setTevOrder(tevStage + 1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
                        mb.setTevColorIn(tevStage + 1, GX.CC.CPREV, GX.CC.RASC, GX.CC.RASA, GX.CC.ZERO);
                        mb.setTevAlphaIn(tevStage + 1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
                        mb.setTevColorOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                        mb.setTevAlphaOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

                        mb.setTevDirect(tevStage + 2);
                        mb.setTevOrder(tevStage + 2, texcoordId, texmapId, GX.RasColorChannelID.COLOR_ZERO /* GX_COLOR_NULL */);
                        mb.setTevColorIn(tevStage + 2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
                        mb.setTevAlphaIn(tevStage + 2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
                        mb.setTevColorOp(tevStage + 2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                        mb.setTevAlphaOp(tevStage + 2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

                        tevStage += 3;
                        texcoordId++;
                        texmapId++;
                        texGenSrc++;
                    }

                    const gxMat = mb.finish();
                    const texture = makeMaterialTexture(texFetcher.getTexture(device, shader.layers[0].texId!, true));
                    const material: SFAMaterial = {
                        factory: new MaterialFactory(device),
                        shader,
                        getGXMaterial: () => gxMat,
                        getTexture: () => texture,
                        setupMaterialParams: () => {},
                        rebuild: () => {},
                    }
                    newShape.setMaterial(material);

                    this.shapes.push(newShape);
                } catch (e) {
                    console.error(e);
                }
                break;
            case 3: // Set vertex attributes
                const posDesc = bits.get(1);
                const colorDesc = bits.get(1);
                const texCoordDesc = bits.get(1);
                vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                vcd[GX.Attr.NRM].type = GX.AttrType.NONE; // Normal is not used in Star Fox Adventures (?)
                vcd[GX.Attr.CLR0].type = colorDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                if (shaders[curShader].layers[0] !== undefined) {
                    // Note: texCoordDesc applies to all texture coordinates in the vertex
                    for (let t = 0; t < 8; t++) {
                        if (shaders[curShader].layers[t] !== undefined) {
                            vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                        } else {
                            vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
                        }
                    }
                }
                break;
            case 4: // Set weights (skipped by SFA block renderer)
                const numWeights = bits.get(4);
                for (let i = 0; i < numWeights; i++) {
                    bits.get(8);
                }
                break;
            case 5: // End
                done = true;
                break;
            default:
                console.warn(`Skipping unknown model bits opcode ${opcode}`);
                break;
            }
        }
    }

    public getMaterials() {
        return [];
    }

    public getNumDrawSteps() {
        return 1;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, drawStep: number, modelViewState: ModelViewState) {
        if (drawStep !== 0) {
            return;
        }

        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].prepareToRender(device, renderInstManager, viewerInput, matrix, sceneTexture, [mat4.create()], modelViewState);
        }
    }
    
    public prepareToRenderWaters(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture) {
    }

    public prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture) {
    }
}

// Maps mod numbers to block numbers. Values are hand-crafted. 
const ANCIENT_TRKBLK: {[key: number]: number} = {
    1: 0x16, // mod1.0..12
    2: 0x23, // mod2.0..21
    3: 0x39, // mod3.0..29
    4: 0x57, // mod4.0..54
    5: 0x0, // mod5.0..21
    6: 0x8e, // mod6.0..21
    7: 0xa4, // mod7.0..21
    8: 0xba, // mod8.0..21
    9: 0xd0, // mod9.0..21
    10: 0xe6, // mod10.0..21
    11: 0xfc, // mod11.0..22
    12: 0x113, // mod12.0..21
    13: 0x129, // mod13.0..25
    14: 0x143, // mod14.0..21
    15: 0x159, // mod15.0..38
    16: 0x180, // mod16.0..63
    17: 0x1c0, // mod17.0..4
    18: 0x1c5, // mod18.0..21
    19: 0x1db, // mod19.0..34
    20: 0x1fe, // mod20.0..21
    21: 0x214, // mod21.0..21
    22: 0x22a, // mod22.0..21
    23: 0x240, // mod23.0..21
    24: 0x256, // mod24.0..21
    25: 0x26c, // mod25.0..21
    26: 0x282, // mod26.0..21
    27: 0x298, // mod27.0..43
    28: 0x2c4, // mod28.0..21
    29: 0x2da, // mod29.0..21
    30: 0x2f0, // mod30.0..21
    31: 0x306, // mod31.0..13
    32: 0x314, // mod32.0..16
    33: 0x325, // mod33.0..15
    34: 0x335, // mod34.0..21
    35: 0x34b, // mod35.0..23
    36: 0x363, // mod36.0..4
    37: 0x368, // mod37.0..21
    38: 0x37e, // mod38.0..21
    39: 0x394, // mod39.0..21
    40: 0x3aa, // mod40.0..21
    41: 0x3c0, // mod41.0..21
    42: 0x3d6, // mod42.0..21
    43: 0x3ec, // mod43.0..21
    44: 0x402, // mod44.0..21
    45: 0x418, // mod45.0..21
    46: 0x42e, // mod46.0
    47: 0x42f, // mod47.0..21
    48: 0x445, // mod48.0..21
    49: 0x45b, // mod49.0..21
    50: 0x471, // mod50.0..21
    51: 0x487, // mod51.0..23
    52: 0x49f, // mod52.0..21
    53: 0x4b5, // mod53.0..21
    54: 0x4cb, // mod54.0..15
    55: 0x4db, // mod55.0..21
};

export class AncientBlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    texFetcher: TextureFetcher;

    private constructor(private device: GfxDevice, private animController: SFAAnimationController) {
        this.texFetcher = new FakeTextureFetcher();
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, device: GfxDevice, animController: SFAAnimationController): Promise<AncientBlockFetcher> {
        const self = new AncientBlockFetcher(device, animController);

        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/BLOCKS.tab`),
            dataFetcher.fetchData(`${pathBase}/BLOCKS.bin`),
        ]);
        self.blocksTab = tab.createDataView();
        self.blocksBin = bin;

        return self;
    }

    public async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<BlockRenderer | null> {
        const num = ANCIENT_TRKBLK[mod] + sub;
        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }

        const blockOffset = this.blocksTab.getUint32(num * 4);
        console.log(`Loading block ${num} from BLOCKS.bin offset 0x${blockOffset.toString(16)}`);
        const blockData = this.blocksBin.slice(blockOffset);

        return new AncientBlockRenderer(this.device, blockData, this.texFetcher, this.animController)
    }
}
