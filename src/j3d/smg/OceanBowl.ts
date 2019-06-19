
import { vec3, mat4, vec2 } from "gl-matrix";
import { LiveActor, SceneObjHolder, ZoneAndLayer, getObjectName, SMGPass } from "./smg_scenes";
import { connectToScene } from "./Actors";
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxInputLayout, GfxInputState, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxCullMode } from "../../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../../viewer";
import { JMapInfoIter } from "./JMapInfo";
import { computeModelMatrixSRT, texProjPerspMtx, clamp } from "../../MathHelpers";
import AnimationController from "../../AnimationController";
import { colorFromRGBA8 } from "../../Color";
import { BTIData } from "../render";
import { BTI } from "../j3d";
import { assert } from "../../util";
import { makeStaticDataBuffer } from "../../gfx/helpers/BufferHelpers";
import { getVertexAttribLocation, GXMaterial, ColorChannelControl, TexGen, IndTexStage, TevStage } from "../../gx/gx_material";
import * as GX from "../../gx/gx_enum";
import { GXRenderHelperGfx, GXMaterialHelperGfx, autoOptimizeMaterial } from "../../gx/gx_render_2";
import { fillPacketParamsData, ub_PacketParams, u_PacketParamsBufferSize, MaterialParams, PacketParams, ub_MaterialParams, u_MaterialParamsBufferSize, fillMaterialParamsData, ColorKind, setTevOrder, setTevColorIn, setTevColorOp, setTevAlphaIn, setTevAlphaOp, setTevIndWarp, setIndTexOrder, setIndTexCoordScale } from "../../gx/gx_render";
import { Camera } from "../../Camera";
import { makeSortKey, GfxRendererLayer } from "../../gfx/render/GfxRenderer";

function calcHeightStatic(wave1Time: number, wave2Time: number, x: number, z: number): number {
    const wave1 = 40 * Math.sin(wave1Time + 0.003 * z);
    const wave2 = 30 * Math.sin(wave2Time + 0.003 * x + 0.003 * z);
    return wave1 + wave2;
}

class OceanBowlPoint {
    public drawPosition: vec3 = vec3.create();
    public gridPosition: vec3 = vec3.create();
    public heightScale: number = 1.0;

    public updatePos(wave1Time: number, wave2Time: number): void {
        const height = this.heightScale * calcHeightStatic(wave1Time, wave2Time, this.gridPosition[0], this.gridPosition[2]);
        // The original code is written really bizarrely but it seems to boil down to this.
        vec3.copy(this.drawPosition, this.gridPosition);
        this.drawPosition[1] += height;
    }
}

function setTextureMatrixST(m: mat4, scale: number, v: vec2): void {
    mat4.identity(m);
    m[0] = scale;
    m[5] = scale;
    m[10] = scale;
    if (v !== null) {
        m[12] = v[0];
        m[13] = v[1];
    }
}

function loadTexProjectionMtx(m: mat4, camera: Camera): void {
    texProjPerspMtx(m, camera.fovY, camera.aspect, 0.5, -0.5 * -1, 0.5, 0.5);
    mat4.mul(m, m, camera.viewMatrix);
}

const scratchMatrix = mat4.create();
const materialParams = new MaterialParams();
const packetParams = new PacketParams();
export class OceanBowl extends LiveActor {
    private points: OceanBowlPoint[] = [];
    private animationController = new AnimationController(60);
    private water: BTIData;
    private waterIndirect: BTIData;
    private mask: BTIData;
    private positionBuffer: GfxBuffer;
    private positionDataF32: Float32Array;
    private positionDataU8: Uint8Array;
    private colorBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private texCoord0Buffer: GfxBuffer;
    private indexCount: number;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private materialHelper: GXMaterialHelperGfx;
    private gridAxisPointCount: number;
    private gridSpacing: number;
    private tex0Trans = vec2.create();
    private tex1Trans = vec2.create();
    private tex2Trans = vec2.create();
    private tex4Scale = 0.04;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        connectToScene(sceneObjHolder, this, 0x22, -1, -1, 0x07);
        this.initDefaultPos(sceneObjHolder, infoIter);

        const device = sceneObjHolder.modelCache.device;
        this.initPoints(device);

        const waterWaveArc = sceneObjHolder.modelCache.getObjectData('WaterWave');
        this.water = new BTIData(device, BTI.parse(waterWaveArc.findFileData('Water.bti'), "Water").texture);
        this.waterIndirect = new BTIData(device, BTI.parse(waterWaveArc.findFileData('WaterIndirect.bti'), "WaterIndirect").texture);
        this.mask = new BTIData(device, BTI.parse(waterWaveArc.findFileData('Mask.bti'), "Mask").texture);
    }

    public initPoints(device: GfxDevice): void {
        const m = scratchMatrix;

        computeModelMatrixSRT(m,
            1, 1, 1,
            this.rotation[0], this.rotation[1], this.rotation[2],
            this.translation[0], this.translation[1], this.translation[2]);

        const axisX = vec3.fromValues(m[0], m[4], m[8]);
        const axisZ = vec3.fromValues(m[2], m[6], m[10]);

        // The original code uses a grid of 25x25 surrounding the player camera, spaced 200 units apart.
        // We use a grid big enough to cover scaleX * 100 units.
        const gridRadius = Math.ceil(this.scale[0]) * 100;
        const gridSpacing = 200;
        const gridAxisPointCount = gridRadius * 2 / gridSpacing;

        this.gridSpacing = gridSpacing;
        this.gridAxisPointCount = gridAxisPointCount;

        for (let z = 0; z < gridAxisPointCount; z++) {
            for (let x = 0; x < gridAxisPointCount; x++) {
                // Center inside the grid.
                const scaleX = gridSpacing / 2 + ((gridSpacing * x) - gridAxisPointCount * gridSpacing / 2);
                const scaleZ = gridSpacing / 2 + ((gridSpacing * z) - gridAxisPointCount * gridSpacing / 2);

                const point = new OceanBowlPoint();
                vec3.copy(point.gridPosition, this.translation);
                vec3.scaleAndAdd(point.gridPosition, point.gridPosition, axisX, scaleX);
                vec3.scaleAndAdd(point.gridPosition, point.gridPosition, axisZ, scaleZ);
                const dist = clamp((gridRadius - vec3.distance(point.gridPosition, this.translation)) / 500, 0, 1);
                point.heightScale = dist;
                this.points.push(point);
            }
        }

        const pointCount = this.points.length;
        this.positionBuffer = device.createBuffer(pointCount * 3, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.DYNAMIC);
        this.positionDataF32 = new Float32Array(pointCount * 3);
        this.positionDataU8 = new Uint8Array(this.positionDataF32.buffer);

        const colorData = new Uint8Array(pointCount * 4);
        let colorIdx = 0;
        for (let i = 0; i < this.points.length; i++) {
            colorData[colorIdx++] = 0xFF;
            colorData[colorIdx++] = 0xFF;
            colorData[colorIdx++] = 0xFF;
            colorData[colorIdx++] = this.points[i].heightScale * 0xFF;
        }
        this.colorBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, colorData.buffer);

        // Texture coordinate buffer
        const texCoordData = new Int16Array(this.points.length * 2);
        let texCoordIdx = 0;
        for (let z = 0; z < gridAxisPointCount; z++) {
            for (let x = 0; x < gridAxisPointCount; x++) {
                texCoordData[texCoordIdx++] = (z / (gridAxisPointCount - 1)) * 0x7FFF;
                texCoordData[texCoordIdx++] = (x / (gridAxisPointCount - 1)) * 0x7FFF;
            }
        }
        this.texCoord0Buffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, texCoordData.buffer);
        assert(texCoordIdx === texCoordData.length);

        // Create the index buffer. We have (N-1)*(N-1) quads, N being gridAxisPointCount, and we have 6 indices per quad...
        const indexBufferCount = (gridAxisPointCount - 1) * (gridAxisPointCount - 1) * 6;
        this.indexCount = indexBufferCount;
        const indexData = new Uint16Array(indexBufferCount);
        let indexIdx = 0;
        for (let z = 1; z < gridAxisPointCount; z++) {
            for (let x = 1; x < gridAxisPointCount; x++) {
                const x1 = x - 1, x2 = x;
                const z1 = z - 1, z2 = z;

                // Now get the indexes of the four points.
                const i0 = z1*gridAxisPointCount + x1;
                const i1 = z2*gridAxisPointCount + x1;
                const i2 = z1*gridAxisPointCount + x2;
                const i3 = z2*gridAxisPointCount + x2;

                indexData[indexIdx++] = i0;
                indexData[indexIdx++] = i1;
                indexData[indexIdx++] = i2;

                indexData[indexIdx++] = i2;
                indexData[indexIdx++] = i1;
                indexData[indexIdx++] = i3;
            }
        }
        assert(indexIdx === indexBufferCount);

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: getVertexAttribLocation(GX.VertexAttribute.POS), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.CLR0), format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX0), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX1), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX2), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX3), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.positionBuffer, byteOffset: 0, byteStride: 4*3 },
            { buffer: this.colorBuffer, byteOffset: 0, byteStride: 4 },
            { buffer: this.texCoord0Buffer, byteOffset: 0, byteStride: 4 },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 2 });

        // Material.
        const lightChannel: ColorChannelControl = {
            lightingEnabled: false,
            ambColorSource: GX.ColorSrc.VTX,
            matColorSource: GX.ColorSrc.VTX,
            litMask: 0,
            diffuseFunction: GX.DiffuseFunction.NONE,
            attenuationFunction: GX.AttenuationFunction.NONE,
        };

        // GXSetTexCoordGen2(0,1,4,0x1e,0,0x7d);
        // GXSetTexCoordGen2(1,1,5,0x21,0,0x7d);
        // GXSetTexCoordGen2(2,1,6,0x24,0,0x7d);
        // GXSetTexCoordGen2(3,0,0,0x27,0,0x7d);
        // GXSetTexCoordGen2(4,0,7,0x2a,0,0x7d);
        // GXSetTexCoordGen2(4,1,7,0x2a,1,0x7d);
        // Don't ask me why GXSetTexCoordGen2 is called twice for texgen 4.
        const texGens: TexGen[] = [];
        texGens.push({ index: 0, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.TEXMTX0, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        texGens.push({ index: 1, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX1, matrix: GX.TexGenMatrix.TEXMTX1, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        texGens.push({ index: 2, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX2, matrix: GX.TexGenMatrix.TEXMTX2, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        texGens.push({ index: 3, type: GX.TexGenType.MTX3x4, source: GX.TexGenSrc.POS,  matrix: GX.TexGenMatrix.TEXMTX3, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        texGens.push({ index: 4, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX3, matrix: GX.TexGenMatrix.TEXMTX4, normalize: true, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });

        const indTexStages: IndTexStage[] = [];
        // GXSetIndTexOrder(0,2,2);
        indTexStages.push({
            index: GX.IndTexStageID.STAGE0,
            ... setIndTexOrder(GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2),
            ... setIndTexCoordScale(GX.IndTexScale._1, GX.IndTexScale._1),
        });

        const noIndTex = {
            // We don't use indtex.
            indTexStage: GX.IndTexStageID.STAGE0,
            indTexMatrix: GX.IndTexMtxID.OFF,
            indTexFormat: GX.IndTexFormat._8,
            indTexBiasSel: GX.IndTexBiasSel.NONE,
            indTexWrapS: GX.IndTexWrap.OFF,
            indTexWrapT: GX.IndTexWrap.OFF,
            indTexAddPrev: false,
            indTexUseOrigLOD: false,
        };

        const tevStages: TevStage[] = [];
        tevStages.push({
            index: 0,
            // GXSetTevOrder(0,0,0,0xff);
            // GXSetTevColorIn(0,8,0xf,0xf,0xf);
            // GXSetTevColorOp(0,0,0,0,0,0);
            // GXSetTevAlphaIn(0,4,7,7,7);
            // GXSetTevAlphaOp(0,0,0,0,0,0);
            ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
            ... setTevColorIn(GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO),
            ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV),
            ... setTevAlphaIn(GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV),
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
            ... noIndTex,
        });
        tevStages.push({
            index: 1,
            // GXSetTevOrder(1,1,0,0xff);
            // GXSetTevColorIn(1,0xf,8,0,0xf);
            // GXSetTevColorOp(1,0,0,3,0,0);
            // GXSetTevAlphaIn(1,7,4,0,7);
            // GXSetTevAlphaOp(1,0,0,1,0,0);
            ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
            ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.CPREV, GX.CombineColorInput.ZERO),
            ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, false, GX.Register.PREV),
            ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, false, GX.Register.PREV),
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
            ... noIndTex,
        });

        tevStages.push({
            index: 2,
            // GXSetTevOrder(2,4,3,4);
            // GXSetTevColorIn(2,0,3,2,0);
            // GXSetTevColorOp(2,9,0,0,0,0);
            // GXSetTevAlphaIn(2,7,5,4,7);
            // GXSetTevAlphaOp(2,0,0,0,0,0);
            ... setTevOrder(GX.TexCoordID.TEXCOORD4, GX.TexMapID.TEXMAP3, GX.RasColorChannelID.COLOR0A0),
            ... setTevColorIn(GX.CombineColorInput.CPREV, GX.CombineColorInput.A0, GX.CombineColorInput.C0, GX.CombineColorInput.CPREV),
            ... setTevColorOp(GX.TevOp.COMP_R8_EQ, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV),
            ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV),
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
            ... noIndTex,
        });

        tevStages.push({
            index: 3,
            // GXSetTevOrder(3,3,1,0xff);
            // GXSetTevColorIn(3,0xf,8,4,0);
            // GXSetTevColorOp(3,0,0,0,1,0);
            // GXSetTevAlphaIn(3,0,7,7,7);
            // GXSetTevAlphaOp(3,0,0,0,0,0);
            ... setTevOrder(GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
            ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.C1, GX.CombineColorInput.CPREV),
            ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
            ... setTevAlphaIn(GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV),
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
            // GXSetTevIndWarp(3,0,1,0,1);
            ... setTevIndWarp(GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0),
        });

        const material: GXMaterial = {
            index: 0,
            name: 'OceanBowl',

            cullMode: GX.CullMode.NONE,
            alphaTest: { op: GX.AlphaOp.OR, compareA: GX.CompareType.ALWAYS, compareB: GX.CompareType.ALWAYS, referenceA: 0, referenceB: 0 },
            ropInfo: {
                blendMode: { type: GX.BlendMode.BLEND, srcFactor: GX.BlendFactor.SRCALPHA, dstFactor: GX.BlendFactor.INVSRCALPHA, logicOp: GX.LogicOp.NOOP },
                depthTest: true,
                depthFunc: GX.CompareType.LEQUAL,
                depthWrite: false,
            },
            lightChannels: [ { colorChannel: lightChannel, alphaChannel: lightChannel }, ],
            texGens,
            indTexStages,
            tevStages,

            usePnMtxIdx: false,
            useTexMtxIdx: [],
        };

        autoOptimizeMaterial(material);

        this.materialHelper = new GXMaterialHelperGfx(material);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Every frame, we add -0.04 onto the counter.
        this.animationController.setTimeFromViewerInput(viewerInput);
        const time = this.animationController.getTimeInFrames();

        const posTime = time * -0.04;
        for (let i = 0; i < this.points.length; i++)
            this.points[i].updatePos(posTime, posTime);

        this.tex0Trans[0] = (1.0 + time * -0.0008) % 1.0;
        this.tex0Trans[1] = (1.0 + time * -0.0008) % 1.0;

        this.tex1Trans[0] = (1.0 + time * -0.001) % 1.0;
        this.tex1Trans[1] = (1.0 + time * 0.0008) % 1.0;

        this.tex2Trans[0] = (1.0 + time * -0.003) % 1.0;
        this.tex2Trans[1] = (1.0 + time * -0.001) % 1.0;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderHelper: GXRenderHelperGfx, viewerInput: ViewerRenderInput): void {
        const device = sceneObjHolder.modelCache.device;
        const cache = sceneObjHolder.modelCache.cache;

        const hostAccessPass = device.createHostAccessPass();
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            let offs = i * 3;
            this.positionDataF32[offs++] = p.drawPosition[0];
            this.positionDataF32[offs++] = p.drawPosition[1];
            this.positionDataF32[offs++] = p.drawPosition[2];
        }
        hostAccessPass.uploadBufferData(this.positionBuffer, 0, this.positionDataU8);
        device.submitPass(hostAccessPass);

        // Fill in our material params.
        this.water.fillTextureMapping(materialParams.m_TextureMapping[0]);
        sceneObjHolder.captureSceneDirector.fillTextureMappingOpaqueSceneTexture(materialParams.m_TextureMapping[1]);
        this.waterIndirect.fillTextureMapping(materialParams.m_TextureMapping[2]);
        this.mask.fillTextureMapping(materialParams.m_TextureMapping[3]);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x28282814);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xC8E6D2FF);

        // The original code set up texture coordinate buffers that increased by 0.05 for every
        // grid point. This mesh would be 25 grid points big -- so the 0th point had texture coordinate 0
        // and the 24th point had 1.20. The math below will recreate the same mapping.

        const scale0 = 0.05 * this.gridAxisPointCount;
        const scale2 = 0.1 * this.gridAxisPointCount;
        const scale4 = this.tex4Scale * this.gridAxisPointCount;

        setTextureMatrixST(materialParams.u_TexMtx[0], scale0, this.tex0Trans);
        setTextureMatrixST(materialParams.u_TexMtx[1], scale0, this.tex1Trans);
        setTextureMatrixST(materialParams.u_TexMtx[2], scale2, this.tex2Trans);
        const camera = viewerInput.camera;
        loadTexProjectionMtx(materialParams.u_TexMtx[3], camera);
        setTextureMatrixST(materialParams.u_IndTexMtx[0], 0.1, null);

        setTextureMatrixST(materialParams.u_TexMtx[4], scale4, null);
        // The original code centers around the player. We center around the camera.
        const playerX = camera.worldMatrix[12];
        const playerZ = camera.worldMatrix[14];
        // The position of the point which has texture coordinate 0.
        const zeroTexX = this.points[0].gridPosition[0];
        const zeroTexZ = this.points[0].gridPosition[2];
        const gridAxisSize = this.gridAxisPointCount * this.gridSpacing;
        // Position the camera is along X/Z against the edges, but unclamped.
        const normPosX = (playerX - zeroTexX) / gridAxisSize;
        const normPosZ = (playerZ - zeroTexZ) / gridAxisSize;
        // Place our texture centered in this scale.
        materialParams.u_TexMtx[4][12] = (-normPosZ * scale4) + 0.5;
        materialParams.u_TexMtx[4][13] = (-normPosX * scale4) + 0.5;

        // Now create our draw instance.
        const renderInst = renderHelper.renderInstManager.pushRenderInst();
        renderInst.filterKey = SMGPass.INDIRECT;
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indexCount);

        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT, this.materialHelper.programKey);
        renderInst.allocateUniformBuffer(ub_MaterialParams, u_MaterialParamsBufferSize);

        let offs = renderInst.getUniformBufferOffset(ub_MaterialParams);
        this.materialHelper.fillMaterialParamsData(renderHelper, offs, materialParams);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], camera.viewMatrix);
        fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
    }

    public destroy(device: GfxDevice): void {
        this.water.destroy(device);
        this.waterIndirect.destroy(device);
        this.mask.destroy(device);
        device.destroyBuffer(this.positionBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('WaterWave');
    }
}
