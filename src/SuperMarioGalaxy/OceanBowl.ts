
import { vec3, mat4, vec2 } from "gl-matrix";
import { SceneObjHolder, getObjectName } from "./Main";
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxInputLayout, GfxInputState, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { JMapInfoIter } from "./JMapInfo";
import { clamp } from "../MathHelpers";
import AnimationController from "../AnimationController";
import { colorFromRGBA8 } from "../Color";
import { assert } from "../util";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { getVertexAttribLocation } from "../gx/gx_material";
import * as GX from "../gx/gx_enum";
import { GXMaterialHelperGfx } from "../gx/gx_render";
import { MaterialParams, PacketParams, ColorKind, ub_MaterialParams, u_PacketParamsBufferSize, ub_PacketParams, fillPacketParamsData } from "../gx/gx_render";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from "../gfx/render/GfxRenderer";
import { DrawType } from "./NameObj";
import { LiveActor, ZoneAndLayer } from "./LiveActor";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { initDefaultPos, connectToScene, loadBTIData, loadTexProjectionMtx, setTextureMatrixST, isValidDraw } from "./ActorUtil";
import { calcActorAxis } from "./MiscActor";

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

const scratchVec3 = vec3.create();
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
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToScene(sceneObjHolder, this, 0x22, -1, -1, DrawType.OCEAN_BOWL);
        initDefaultPos(sceneObjHolder, this, infoIter);
        calcActorAxis(this.axisX, this.axisY, this.axisZ, this);

        const device = sceneObjHolder.modelCache.device;
        const cache = sceneObjHolder.modelCache.cache;
        this.initPoints(device, cache);

        const waterWaveArc = sceneObjHolder.modelCache.getObjectData('WaterWave')!;
        this.water = loadBTIData(sceneObjHolder, waterWaveArc, `Water.bti`);
        this.waterIndirect = loadBTIData(sceneObjHolder, waterWaveArc, `WaterIndirect.bti`);
        this.mask = loadBTIData(sceneObjHolder, waterWaveArc, `Mask.bti`);
    }

    public isInWater(v: vec3): boolean {
        vec3.sub(scratchVec3, this.translation, v);

        const mag = vec3.squaredLength(scratchVec3);
        const radius = this.scale[0] * 100;
        const radiusSq = radius * radius;
        if (mag < radiusSq) {
            const dot = vec3.dot(scratchVec3, this.axisY);
            if (dot < 0.0)
                return true;
        }

        return false;
    }

    private initPoints(device: GfxDevice, cache: GfxRenderCache): void {
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
                vec3.scaleAndAdd(point.gridPosition, point.gridPosition, this.axisX, scaleX);
                vec3.scaleAndAdd(point.gridPosition, point.gridPosition, this.axisZ, scaleZ);
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
            { location: getVertexAttribLocation(GX.Attr.POS), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.Attr.CLR0), format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.Attr.TEX0), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.Attr.TEX1), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.Attr.TEX2), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.Attr.TEX3), format: GfxFormat.S16_RG_NORM, bufferIndex: 2, bufferByteOffset: 0, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4*3, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.positionBuffer, byteOffset: 0, },
            { buffer: this.colorBuffer, byteOffset: 0, },
            { buffer: this.texCoord0Buffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });

        // Material.
        const mb = new GXMaterialBuilder('OceanBowl');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX1, GX.TexGenMatrix.TEXMTX1);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX2, GX.TexGenMatrix.TEXMTX2);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS,  GX.TexGenMatrix.TEXMTX3);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD4, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX3, GX.TexGenMatrix.TEXMTX4, true);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.CPREV, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, false, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, false, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD4, GX.TexMapID.TEXMAP3, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CombineColorInput.CPREV, GX.CombineColorInput.A0, GX.CombineColorInput.C0, GX.CombineColorInput.CPREV);
        mb.setTevColorOp(2, GX.TevOp.COMP_R8_EQ, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(3, GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(3, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.C1, GX.CombineColorInput.CPREV);
        mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(3, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2);
        mb.setTevIndWarp(3, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
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

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

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

        const camera = viewerInput.camera;

        setTextureMatrixST(materialParams.u_TexMtx[0], scale0, this.tex0Trans);
        setTextureMatrixST(materialParams.u_TexMtx[1], scale0, this.tex1Trans);
        setTextureMatrixST(materialParams.u_TexMtx[2], scale2, this.tex2Trans);
        loadTexProjectionMtx(materialParams.u_TexMtx[3], camera, viewerInput.viewport);
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
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indexCount);

        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT, this.materialHelper.programKey);

        const offs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);

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
        device.destroyBuffer(this.texCoord0Buffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('WaterWave');
    }
}
