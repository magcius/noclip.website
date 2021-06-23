
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import * as GX from "../gx/gx_enum";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { ColorKind, GXMaterialHelperGfx, MaterialParams, PacketParams } from "../gx/gx_render";

import { J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { connectToScene, drawSimpleModel, getEaseInOutValue, getEaseOutValue, initDefaultPos, isOnSwitchB, isValidSwitchB, useStageSwitchWriteB } from "./ActorUtil";
import { JMapInfoIter } from "./JMapInfo";
import { dynamicSpawnZoneAndLayer, LiveActor, LiveActorGroup, makeMtxTRFromActor, ZoneAndLayer } from "./LiveActor";
import { getObjectName, SceneObj, SceneObjHolder } from "./Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "./NameObj";
import { colorFromRGBA8, colorNewFromRGBA8 } from "../Color";
import { Camera } from "../Camera";
import { isGreaterStep, isLessStep } from "./Spine";
import { invlerp, saturate, setMatrixTranslation, Vec3Zero } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/ShaderHelpers";
import { generateBlurFunction } from "./ImageEffect";
import { GfxProgram } from "../gfx/platform/GfxPlatformImpl";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxMegaStateDescriptor, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { TextureMapping } from "../TextureHolder";
import { fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { reverseDepthForDepthOffset } from "../gfx/helpers/ReversedDepthHelpers";
import { isConnectedWithRail } from "./RailRider";
import { MapPartsRailMover, MapPartsRotator } from "./MapParts";
import { addHitSensorMapObj } from "./HitSensor";

const materialParams = new MaterialParams();
const packetParams = new PacketParams();
const scratchVec3a = vec3.create();

abstract class ClipAreaShape {
    public modelData: J3DModelData | null = null;

    constructor(sceneObjHolder: SceneObjHolder, filename: string) {
        const resourceHolder = sceneObjHolder.modelCache.getResourceHolder(filename);
        this.modelData = resourceHolder.getModel(filename);
    }

    public calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        mat4.scale(dst, mtx, scale);
    }

    public drawVolumeShape(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, mtx: ReadonlyMat4, scale: ReadonlyVec3, camera: Camera): void {
        const template = renderInstManager.pushTemplateRenderInst();
        this.calcVolumeMatrix(packetParams.u_PosMtx[0], mtx, scale);
        mat4.mul(packetParams.u_PosMtx[0], camera.viewMatrix, packetParams.u_PosMtx[0]);
        sceneObjHolder.clipAreaHolder!.materialFront.allocatePacketParamsDataOnInst(template, packetParams);
        drawSimpleModel(renderInstManager, this.modelData!);
        renderInstManager.popTemplateRenderInst();
    }
}

class ClipAreaShapeBox extends ClipAreaShape {
    public size: number = 500.0;

    constructor(sceneObjHolder: SceneObjHolder, public isBottom: boolean) {
        super(sceneObjHolder, 'ClipVolumeBox');
    }

    public calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        if (this.isBottom) {
            vec3.set(scratchVec3a, 0.0, this.size * scale[1], 0.0);
            mat4.translate(dst, mtx, scratchVec3a);
        } else {
            mat4.copy(dst, mtx);
        }

        mat4.scale(dst, dst, scale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ClipVolumeBox');
    }
}

class ClipAreaShapeSphere extends ClipAreaShape {
    public size: number = 500.0;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipVolumeSphere');
    }

    public calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        vec3.scale(scratchVec3a, scale, this.size * 0.01);
        mat4.scale(dst, mtx, scale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ClipVolumeSphere');
    }
}

abstract class ClipArea<TNerve extends number = number> extends LiveActor<TNerve> {
    public mtx: mat4 = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objectName: string, infoIter: JMapInfoIter | null, private shape: ClipAreaShape) {
        super(zoneAndLayer, sceneObjHolder, objectName);

        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(this.mtx, this);

        sceneObjHolder.create(SceneObj.ClipAreaHolder);
        sceneObjHolder.clipAreaHolder!.registerActor(this);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        const clipAreaHolder = sceneObjHolder.clipAreaHolder!;
        const cache = renderInstManager.gfxRenderCache;

        const template = renderInstManager.pushTemplateRenderInst();

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x00000004);
        clipAreaHolder.materialFront.allocateMaterialParamsDataOnInst(template, materialParams);

        clipAreaHolder.materialFront.setOnRenderInst(cache.device, cache, template);
        this.shape.drawVolumeShape(sceneObjHolder, renderInstManager, this.mtx, this.scale, viewerInput.camera);

        clipAreaHolder.materialBack.setOnRenderInst(cache.device, cache, template);
        this.shape.drawVolumeShape(sceneObjHolder, renderInstManager, this.mtx, this.scale, viewerInput.camera);

        renderInstManager.popTemplateRenderInst();
    }
}

class ClipAreaMovable extends ClipArea {
    private railMover: MapPartsRailMover | null = null;
    private rotator: MapPartsRotator | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, shape: ClipAreaShape) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter), infoIter, shape);
        connectToScene(sceneObjHolder, this, MovementType.ClippedMapParts, CalcAnimType.None, DrawBufferType.None, DrawType.ClipArea);
        this.initMoveFunction(sceneObjHolder, infoIter);
        this.initHitSensor();
        addHitSensorMapObj(sceneObjHolder, this, 'body', 0, 0.0, Vec3Zero);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        // addBaseMatrixFollowTarget
        this.makeActorAppeared(sceneObjHolder);
    }

    private initMoveFunction(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
        }

        this.rotator = new MapPartsRotator(sceneObjHolder, this, infoIter);
    }

    private startMoveFunction(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.start();
        if (this.railMover !== null)
            this.railMover.start();
    }

    private endMoveFunction(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.end();
        if (this.railMover !== null)
            this.railMover.end();
    }

    private movementMoveFunction(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.rotator !== null)
            this.rotator.movement(sceneObjHolder, viewerInput);
        if (this.railMover !== null)
            this.railMover.movement(sceneObjHolder, viewerInput);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (!isValidSwitchB(this) || isOnSwitchB(sceneObjHolder, this))
            this.movementMoveFunction(sceneObjHolder, viewerInput);

        this.updateMatrix();
    }

    private updateMatrix(): void {
        if (this.railMover !== null)
            setMatrixTranslation(this.mtx, this.railMover.translation);
        if (this.rotator !== null)
            mat4.mul(this.mtx, this.mtx, this.rotator.mtx);
}

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.startMoveFunction(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        this.endMoveFunction(sceneObjHolder);
    }
}

export function createClipAreaCenterBox(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeBox(sceneObjHolder, false);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function createClipAreaBottomBox(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeBox(sceneObjHolder, true);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function requestArchivesClipAreaBox(sceneObjHolder: SceneObjHolder): void {
    ClipAreaShapeBox.requestArchives(sceneObjHolder);
}

export function createClipAreaSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeSphere(sceneObjHolder);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function requestArchivesClipAreaSphere(sceneObjHolder: SceneObjHolder): void {
    ClipAreaShapeSphere.requestArchives(sceneObjHolder);
}

function calcNerveEaseInOutValue(actor: LiveActor, minStep: number, maxStep: number, minValue: number, maxValue: number): number {
    const t = saturate(invlerp(minStep, maxStep, actor.getNerveStep()));
    return getEaseInOutValue(t, minValue, maxValue);
}

function calcNerveEaseOutValue(actor: LiveActor, maxStep: number, minValue: number, maxValue: number): number {
    const t = saturate(invlerp(0.0, maxStep, actor.getNerveStep()));
    return getEaseOutValue(t, minValue, maxValue);
}

const enum ClipAreaDropNrv { Wait }
class ClipAreaDrop extends ClipArea<ClipAreaDropNrv> {
    private baseSize: number;
    private sphere: ClipAreaShapeSphere;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        const shape = new ClipAreaShapeSphere(sceneObjHolder);
        super(zoneAndLayer, sceneObjHolder, 'ClipAreaDrop', null, shape);
        connectToScene(sceneObjHolder, this, MovementType.ClippedMapParts, CalcAnimType.None, DrawBufferType.None, DrawType.ClipArea);

        this.sphere = shape;

        this.baseSize = 500.0;
        this.initNerve(ClipAreaDropNrv.Wait);
        this.makeActorDead(sceneObjHolder);
    }

    public setBaseSize(v: number): void {
        this.baseSize = v;
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.sphere.size = 0.0;
        this.setNerve(ClipAreaDropNrv.Wait);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);
        mat4.identity(this.mtx);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ClipAreaDropNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ClipAreaDropNrv.Wait) {
            if (isLessStep(this, 15))
                this.sphere.size = calcNerveEaseInOutValue(this, 60, 240, this.baseSize, 0.0);
            else
                this.sphere.size = calcNerveEaseOutValue(this, 15, 0.0, this.baseSize);

            if (isGreaterStep(this, 240))
                this.makeActorDead(sceneObjHolder);
        }
    }
}

export class ClipAreaDropHolder extends LiveActorGroup<ClipAreaDrop> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipAreaDropHolder', 0x20);

        for (let i = 0; i < 0x20; i++) {
            const area = new ClipAreaDrop(dynamicSpawnZoneAndLayer, sceneObjHolder);
            this.registerActor(area);
        }
    }
}

function appearClipAreaDrop(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, baseSize: number): void {
    const drop = sceneObjHolder.clipAreaDropHolder!.getDeadActor();
    if (drop === null)
        return;

    vec3.copy(drop.translation, pos);
    drop.setBaseSize(baseSize);
    drop.makeActorAppeared(sceneObjHolder);
}

const enum ClipAreaDropLaserNrv { Wait, Move }
export class ClipAreaDropLaser extends LiveActor<ClipAreaDropLaserNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ClipAreaDropLaser');
        // TODO(jstpierre): The rest of this whole thing.
    }
}

export class ClipAreaHolder extends LiveActorGroup<ClipArea> {
    public isActive: boolean = true;

    public materialFront: GXMaterialHelperGfx;
    public materialBack: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipAreaHolder', 0x40);

        const mb = new GXMaterialBuilder();
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.A0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        mb.setZMode(true, GX.CompareType.GEQUAL, false);
        mb.setUsePnMtxIdx(false);
        // We use an R8 target instead of framebuffer alpha... maybe shadows should do the same thing too...
        mb.setColorUpdate(true);
        mb.setAlphaUpdate(false);

        mb.setCullMode(GX.CullMode.FRONT);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ONE);
        this.materialFront = new GXMaterialHelperGfx(mb.finish('ClipArea Front'));

        mb.setCullMode(GX.CullMode.BACK);
        mb.setBlendMode(GX.BlendMode.SUBTRACT, GX.BlendFactor.ZERO, GX.BlendFactor.ZERO);
        this.materialBack = new GXMaterialHelperGfx(mb.finish('ClipArea Back'));
    }
}

class FullscreenBlitProgram extends DeviceProgram {
    public vert = GfxShaderLibrary.fullscreenVS;
    public frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

class FallOutFieldDrawThresholdProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_Texture;
`;

    public vert = `
${FallOutFieldDrawThresholdProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public frag = `
${FallOutFieldDrawThresholdProgram.Common}
${GfxShaderLibrary.saturate}

in vec2 v_TexCoord;

void main() {
    gl_FragColor = vec4(texture(SAMPLER_2D(u_Texture), v_TexCoord).r > 0.0 ? 1.0 : 0.0);
}
`;
}

class FallOutFieldDrawBlurProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_Texture;
`;

    public vert = `
${FallOutFieldDrawBlurProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public frag = `
${FallOutFieldDrawBlurProgram.Common}
${GfxShaderLibrary.saturate}
${generateBlurFunction('Blur', 5, '0.004', glslGenerateFloat(1.0))}

in vec2 v_TexCoord;

vec2 BlurAspect(PD_SAMPLER_2D(t_Texture)) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Aspect = vec2((t_Size.y / t_Size.x) / (3.0/4.0), 1.0);
    return t_Aspect;
}

void main() {
    vec2 t_Aspect = BlurAspect(PP_SAMPLER_2D(u_Texture));
    float t_BlurredMask = saturate(Blur(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect).r);
    gl_FragColor = vec4(t_BlurredMask);
}
`;
}

class FallOutFieldDrawCompositeBlurProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureMask;
`;

    public vert = `
${FallOutFieldDrawCompositeBlurProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public frag = `
${FallOutFieldDrawCompositeBlurProgram.Common}

in vec2 v_TexCoord;

layout(std140) uniform ub_Params {
    vec4 u_EdgeColor;
};

void main() {
    float t_BlurredMask = texture(SAMPLER_2D(u_TextureMask), v_TexCoord).r;
    vec4 t_Color = u_EdgeColor;
    t_Color.a *= t_BlurredMask;
    gl_FragColor = t_Color;
}
`;
}

class FallOutFieldDrawMaskProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureMask;
`;

    public vert = `
${FallOutFieldDrawMaskProgram.Common}
${GfxShaderLibrary.makeFullscreenVS(reverseDepthForDepthOffset(1.0), 1.0)}
`;

    public frag = `
${FallOutFieldDrawMaskProgram.Common}

in vec2 v_TexCoord;

void main() {
    if (texture(SAMPLER_2D(u_TextureMask), v_TexCoord).r <= 0.0)
        discard;

    gl_FragColor = vec4(0.0);
}
`;
}

export class FallOutFieldDraw extends NameObj {
    private thresholdProgram: GfxProgram;
    private blurProgram: GfxProgram;
    private compositeBlurProgram: GfxProgram;
    private maskProgram: GfxProgram;
    private blitProgram: GfxProgram;

    private edgeColor = colorNewFromRGBA8(0x002EC880);

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    }), fullscreenMegaState);

    private maskMegaState: GfxMegaStateDescriptor = makeMegaState({
        depthWrite: true,
        depthCompare: GfxCompareMode.Always,
    }, fullscreenMegaState);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'FallOutFieldDraw');

        const cache = sceneObjHolder.modelCache.cache;
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.thresholdProgram = cache.createProgram(new FallOutFieldDrawThresholdProgram());
        this.blurProgram = cache.createProgram(new FallOutFieldDrawBlurProgram());
        this.compositeBlurProgram = cache.createProgram(new FallOutFieldDrawCompositeBlurProgram());
        this.maskProgram = cache.createProgram(new FallOutFieldDrawMaskProgram());
        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillColor(d, offs, this.edgeColor);
    }

    public pushPasses(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, mainDepthTargetID: number, clipAreaMaskTargetID: number): void {
        const clipAreaMaskTargetDesc = builder.getRenderTargetDescription(clipAreaMaskTargetID);

        this.target2ColorDesc.setDimensions(clipAreaMaskTargetDesc.width >>> 1, clipAreaMaskTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);

        const downsample2TargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Clip Area Downsample 1/2');
        const downsample4TargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Clip Area Downsample 1/4');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        const clipAreaMaskTextureID = builder.resolveRenderTarget(clipAreaMaskTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2TargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.attachResolveTexture(clipAreaMaskTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(clipAreaMaskTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4TargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample2TargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/4 Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4TargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample4TargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blurProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
            
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Composite Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const downsample4TextureID = builder.resolveRenderTarget(downsample4TargetID);
            pass.attachResolveTexture(downsample4TextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.compositeBlurProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4TextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Mask');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.attachResolveTexture(clipAreaMaskTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.maskProgram);
                renderInst.setMegaStateFlags(this.maskMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(clipAreaMaskTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

export function createFallOutFieldDraw(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    sceneObjHolder.create(SceneObj.FallOutFieldDraw);
}
