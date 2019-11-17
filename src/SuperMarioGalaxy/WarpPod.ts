
import { vec3, mat4 } from "gl-matrix";
import { colorNewFromRGBA8, colorCopy, Color } from "../Color";
import { GfxInputState, GfxInputLayout, GfxDevice, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { getVertexAttribLocation, TevStage, IndTexStage, TexGen, ColorChannelControl, GXMaterial } from "../gx/gx_material";
import * as GX from "../gx/gx_enum";
import { LiveActor, startBck, startBrkIfExist, ZoneAndLayer } from "./LiveActor";
import { SceneObjHolder, getObjectName } from "./Main";
import { JMapInfoIter, getJMapInfoArg1, getJMapInfoArg3, getJMapInfoArg4, getJMapInfoArg6, getJMapInfoGroupId, getJMapInfoBool } from "./JMapInfo";
import { BTIData } from "../j3d/render";
import { LoopMode } from "../j3d/j3d";
import { RARC } from "../j3d/rarc";
import { assertExists, fallback } from "../util";
import { DrawBufferType, DrawType } from "./NameObj";
import { connectToScene, calcUpVec, loadBTIData, emitEffect, setEffectEnvColor, getCamZdir } from "./Actors";
import { MathConstants, lerp, normToLength } from "../MathHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { makeTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers";
import { Camera } from "../Camera";
import { setTevOrder, setTevColorIn, setTevColorOp, setTevAlphaIn, setTevAlphaOp, autoOptimizeMaterial, GXMaterialHelperGfx, ub_MaterialParams, u_PacketParamsBufferSize, ub_PacketParams, MaterialParams, PacketParams, fillPacketParamsData, ColorKind } from "../gx/gx_render";

const warpPodColorTable = [
    colorNewFromRGBA8(0x0064C8FF),
    colorNewFromRGBA8(0x2CFF2AFF),
    colorNewFromRGBA8(0xFF3C3CFF),
    colorNewFromRGBA8(0xC4A600FF),
    colorNewFromRGBA8(0x00FF00FF),
    colorNewFromRGBA8(0xFF00FFFF),
    colorNewFromRGBA8(0xFFFF00FF),
    colorNewFromRGBA8(0xFFFFFFFF),
];

function compareVec3(a: vec3, b: vec3): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create(), scratchVec3b = vec3.create(), scratchVec3c = vec3.create();

function vecKillElement(dst: vec3, a: vec3, b: vec3): void {
    const m = vec3.dot(a, b);
    dst[0] = a[0] - b[0]*m;
    dst[1] = a[1] - b[1]*m;
    dst[2] = a[2] - b[2]*m;
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

// TODO(jstpierre): Would be nice to have a better way to do dynamic drawing so we don't
// have to set this up every time...
class WarpPodPathDrawer {
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private testColor: BTIData;
    private testMask: BTIData;
    private materialHelper: GXMaterialHelperGfx;

    private shadowBufferF32: Float32Array;
    private shadowBufferU8: Uint8Array;

    constructor(sceneObjHolder: SceneObjHolder, arc: RARC, private points: vec3[], private color: Color) {
        const device = sceneObjHolder.modelCache.device;
        const cache = sceneObjHolder.modelCache.cache;

        this.testColor = loadBTIData(sceneObjHolder, arc, `TestColor.bti`);
        this.testMask = loadBTIData(sceneObjHolder, arc, `TestMask.bti`);

        const oneStripVertexCount = this.points.length * 2;
        const totalVertexCount = oneStripVertexCount * 2;
        const totalWordCount = totalVertexCount * 5;

        const indexData = makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, totalVertexCount);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        this.vertexBuffer = device.createBuffer(totalWordCount, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.DYNAMIC);

        this.shadowBufferF32 = new Float32Array(totalWordCount);
        this.shadowBufferU8 = new Uint8Array(this.shadowBufferF32.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: getVertexAttribLocation(GX.VertexAttribute.POS), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0, },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX0), format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 0x04*3, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0x04*5, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });

        // Material.
        const lightChannel: ColorChannelControl = {
            lightingEnabled: false,
            ambColorSource: GX.ColorSrc.VTX,
            matColorSource: GX.ColorSrc.VTX,
            litMask: 0,
            diffuseFunction: GX.DiffuseFunction.NONE,
            attenuationFunction: GX.AttenuationFunction.NONE,
        };

        // GXSetTexCoordGen2(GX_TEXCOORD0,GX_TG_MTX2x4,GX_TG_TEX0,GX_TEXMTX0,false,GX_PTIDENTITY);
        const texGens: TexGen[] = [];
        texGens.push({ type: GX.TexGenType.MTX3x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.IDENTITY, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });

        const indTexStages: IndTexStage[] = [];

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
            // GXSetTevOrder(0,0,0,0xff);
            // GXSetTevColorIn(0,8,0xf,0xf,0xf);
            // GXSetTevColorOp(0,0,0,0,0,0);
            // GXSetTevAlphaIn(0,4,7,7,7);
            // GXSetTevAlphaOp(0,0,0,0,0,0);
            ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
            ... setTevColorIn(GX.CombineColorInput.C0, GX.CombineColorInput.ONE, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
            ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
            ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.KONST, GX.CombineAlphaInput.ZERO),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV),
            konstColorSel: GX.KonstColorSel.KCSEL_1_4,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
            ... noIndTex,
        });

        const material: GXMaterial = {
            index: 0,
            name: 'WarpPodPathDrawer',

            cullMode: GX.CullMode.NONE,
            alphaTest: { op: GX.AlphaOp.OR, compareA: GX.CompareType.ALWAYS, compareB: GX.CompareType.ALWAYS, referenceA: 0, referenceB: 0 },
            ropInfo: {
                blendMode: { type: GX.BlendMode.BLEND, srcFactor: GX.BlendFactor.SRCALPHA, dstFactor: GX.BlendFactor.ONE, logicOp: GX.LogicOp.NOOP },
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

    private updateStripeBuffer(device: GfxDevice, camera: Camera): void {
        let idx0 = 0, idx1 = (this.points.length * 10);
        for (let i = 0; i < this.points.length - 1; i++) {
            vec3.sub(scratchVec3a, this.points[i + 1], this.points[i]);
            getCamZdir(scratchVec3b, camera);
            vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3c, scratchVec3c);

            vec3.cross(scratchVec3a, scratchVec3c, scratchVec3b);
            vec3.normalize(scratchVec3a, scratchVec3a);

            vec3.cross(scratchVec3b, scratchVec3a, scratchVec3c);
            vec3.normalize(scratchVec3b, scratchVec3b);

            normToLength(scratchVec3b, 30);
            normToLength(scratchVec3a, 30);

            const texCoordY = Math.abs((2.0 * (i / this.points.length)) - 1.0);

            vec3.add(scratchVec3c, this.points[i], scratchVec3a);
            this.shadowBufferF32[idx0++] = scratchVec3c[0];
            this.shadowBufferF32[idx0++] = scratchVec3c[1];
            this.shadowBufferF32[idx0++] = scratchVec3c[2];
            this.shadowBufferF32[idx0++] = 0.0;
            this.shadowBufferF32[idx0++] = texCoordY;

            vec3.sub(scratchVec3c, this.points[i], scratchVec3a);
            this.shadowBufferF32[idx0++] = scratchVec3c[0];
            this.shadowBufferF32[idx0++] = scratchVec3c[1];
            this.shadowBufferF32[idx0++] = scratchVec3c[2];
            this.shadowBufferF32[idx0++] = 1.0;
            this.shadowBufferF32[idx0++] = texCoordY;

            vec3.add(scratchVec3c, this.points[i], scratchVec3b);
            this.shadowBufferF32[idx1++] = scratchVec3c[0];
            this.shadowBufferF32[idx1++] = scratchVec3c[1];
            this.shadowBufferF32[idx1++] = scratchVec3c[2];
            this.shadowBufferF32[idx1++] = 0.0;
            this.shadowBufferF32[idx1++] = texCoordY;

            vec3.sub(scratchVec3c, this.points[i], scratchVec3b);
            this.shadowBufferF32[idx1++] = scratchVec3c[0];
            this.shadowBufferF32[idx1++] = scratchVec3c[1];
            this.shadowBufferF32[idx1++] = scratchVec3c[2];
            this.shadowBufferF32[idx1++] = 1.0;
            this.shadowBufferF32[idx1++] = texCoordY;
        }

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadBufferData(this.vertexBuffer, 0, this.shadowBufferU8);
        device.submitPass(hostAccessPass);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.updateStripeBuffer(device, viewerInput.camera);

        this.testColor.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        const offs = template.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        this.materialHelper.fillMaterialParamsDataOnInst(template, offs, materialParams);

        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        template.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(template.mapUniformBufferF32(ub_PacketParams), template.getUniformBufferOffset(ub_PacketParams), packetParams);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const oneStripVertexCount = (this.points.length - 1) * 2;
        const oneStripIndexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, oneStripVertexCount);

        const renderInst1 = renderInstManager.pushRenderInst();
        renderInst1.drawIndexes(oneStripIndexCount);
        const renderInst2 = renderInstManager.pushRenderInst();
        renderInst2.drawIndexes(oneStripIndexCount, oneStripIndexCount + 12);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        this.testColor.destroy(device);
        this.testMask.destroy(device);
    }
}

export class WarpPod extends LiveActor {
    private visible: boolean;
    private groupId: number;
    private pairedWarpPod: WarpPod | null = null;
    private isPairPrimary: boolean = false;
    private warpPathPoints: vec3[] | null = null;
    private pathDrawer: WarpPodPathDrawer | null = null;
    private color: Color;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WarpPod");

        this.visible = fallback(getJMapInfoArg1(infoIter), 1) !== 0;
        const hasSaveFlag = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        const astroDomeNum = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        const colorIndex = fallback(getJMapInfoArg6(infoIter), 0);
        
        let color = warpPodColorTable[colorIndex];
        if (color === undefined) {
            // Seems to happen in SMG2 sometimes; they might have expanded the color table.
            color = warpPodColorTable[0];
        }
        this.color = color;

        this.initEffectKeeper(sceneObjHolder, null);

        if (this.visible) {
            startBck(this, 'Active');
            startBrkIfExist(this.modelInstance!, this.arc, 'Active');
            // This is a bit hokey, but we don't have an XanimePlayer, so this is our solution...
            this.modelInstance!.ank1Animator!.ank1.loopMode = LoopMode.ONCE;
        }

        // The game normally will check a few different save file bits
        // or the highest unlocked AstroDome, but we just declare all
        // WarpPods are active.
        const inactive = false;

        if (inactive) {
            startBck(this, 'Wait');
            startBrkIfExist(this.modelInstance!, this.arc, 'Wait');
        } else {
            this.glowEffect(sceneObjHolder);
        }

        this.groupId = assertExists(getJMapInfoGroupId(infoIter));
        // Look for the pair. If it's spawned, then init.
        const pairedWarpPod = this.lookForPair(sceneObjHolder);
        if (pairedWarpPod !== null) {
            this.initPair(sceneObjHolder, pairedWarpPod);
            pairedWarpPod.initPair(sceneObjHolder, this);
        }

        // This isn't quite the same as original, which has a WarpPodMgr which draws all of the paths...
        if (this.visible) {
            connectToScene(sceneObjHolder, this, 0x22, 5, DrawBufferType.MAP_OBJ, DrawType.WARP_POD_PATH);
        } else {
            connectToScene(sceneObjHolder, this, 0x22, -1, -1, -1);
        }
    }

    private initPair(sceneObjHolder: SceneObjHolder, pairedWarpPod: WarpPod): void {
        this.pairedWarpPod = pairedWarpPod;

        // The primary pod is whichever of the two has the lowest translation.
        this.isPairPrimary = compareVec3(this.translation, this.pairedWarpPod.translation) < 0;

        if (this.isPairPrimary)
            this.initDraw(sceneObjHolder);
    }

    private initDraw(sceneObjHolder: SceneObjHolder): void {
        if (this.pairedWarpPod === null || !this.isPairPrimary)
            return;

        const numPoints = 60;
        this.warpPathPoints = [];

        const delta = vec3.create();
        vec3.sub(delta, this.pairedWarpPod.translation, this.translation);
        const mag = vec3.length(delta);

        const upVec = vec3.create();
        calcUpVec(upVec, this);
        const negUpVec = vec3.create();
        vec3.negate(negUpVec, upVec);

        const crossA = vec3.create(), crossB = vec3.create();
        vec3.cross(crossA, delta, negUpVec);
        vec3.normalize(crossA, crossA);
        vec3.cross(crossB, crossA, delta);
        vec3.normalize(crossB, crossB);

        const halfway = vec3.create();
        vec3.scale(halfway, delta, 0.5);
        vec3.add(halfway, this.translation, halfway);

        const mag2 = 0.5 * mag;
        const b = mag2 / Math.sin(MathConstants.TAU / 8);
        let a = (b * b) - (mag2 * mag2);
        if (a >= 0) {
            const norm = 1 / Math.sqrt(a);
            const anorm = a * norm;
            const cubic = (anorm * norm) - 3.0;
            a = -cubic * anorm * 0.5;
        }

        const ca = vec3.create(), cb = vec3.create();
        vec3.scaleAndAdd(ca, halfway, crossB, a);
        vec3.scale(cb, crossB, -b);

        for (let i = 0; i < numPoints; i++) {
            const v = vec3.create();
            const ha = 1.0 - ((i - numPoints / 2) / numPoints);
            const c = (Math.sin(Math.PI * ha) + 1.0) * 0.5;
            const rad = lerp(-MathConstants.TAU / 8, MathConstants.TAU / 8, c);
            mat4.fromRotation(scratchMatrix, rad, crossA);

            vec3.transformMat4(v, cb, scratchMatrix);
            vec3.add(v, v, ca);
            vec3.scaleAndAdd(v, v, upVec, 200);

            this.warpPathPoints.push(v);
        }

        this.pathDrawer = new WarpPodPathDrawer(sceneObjHolder, this.arc, this.warpPathPoints, this.color);
    }

    private lookForPair(sceneObjHolder: SceneObjHolder): WarpPod | null {
        // In the original code, there's a WarpPodMgr which manages a LiveActorGroup
        // so we don't need to search the whole thing.
        for (let i = 0; i < sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++) {
            const nameObj = sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj;
            if (nameObj !== this && nameObj instanceof WarpPod) {
                const warpPod = nameObj as WarpPod;
                if (warpPod.groupId === this.groupId)
                    return warpPod;
            }
        }

        return null;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.visibleScenario || !this.visibleAlive)
            return;

        if (this.pathDrawer !== null)
            this.pathDrawer.draw(sceneObjHolder.modelCache.device, renderInstManager, viewerInput);
    }

    private glowEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.visible) {
            emitEffect(sceneObjHolder, this, 'EndGlow');
            setEffectEnvColor(this, 'EndGlow', this.color);
        }
    }
    
    public destroy(device: GfxDevice): void {
        super.destroy(device);

        if (this.pathDrawer !== null)
            this.pathDrawer.destroy(device);
    }
}
