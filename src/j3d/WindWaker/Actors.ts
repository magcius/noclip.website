
import bezier from 'bezier-easing';

import * as Viewer from '../../viewer';
import * as GX_Material from '../../gx/gx_material';
import * as RARC from '../rarc';
import * as JPA from '../../Common/JSYSTEM/JPA';
import * as Yaz0 from '../../Common/Compression/Yaz0';

import * as UI from '../../ui';

import { mat4, vec3 } from "gl-matrix";
import { hexzero, leftPad, nArray, assert } from '../../util';
import { J3DModelInstanceSimple, BMDModelMaterialData, MaterialInstance } from "../../Common/JSYSTEM/J3D/J3DGraphBase";
import { ANK1, BTK, BRK, BCK, TTK1, TRK1, TPT1, BTP, LoopMode, BMT } from "../../Common/JSYSTEM/J3D/J3DLoader";
import AnimationController from "../../AnimationController";
import { KankyoColors, ZWWExtraTextures, WindWakerRenderer, WindWakerRoomRenderer, pathBase, WindWakerPass } from "./zww_scenes";
import * as DZB from './DZB';
import { ColorKind } from "../../gx/gx_render";
import { AABB } from '../../Geometry';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../../Camera';
import { GfxDevice, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgramDescriptorSimple, GfxMegaStateDescriptor, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBlendMode, GfxBlendFactor, GfxBufferUsage, GfxCullMode, GfxFrontFaceMode } from '../../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { colorFromRGBA, Color, colorNew, colorNewCopy, White, colorMult, colorLerp, colorCopy } from '../../Color';
import { GfxRenderInstManager, GfxRendererLayer, GfxRenderInst, makeSortKeyTranslucent } from '../../gfx/render/GfxRenderer';
import { CombineColorInput, RasColorChannelID, TevColorChan } from '../../gx/gx_enum';
import { computeModelMatrixSRT, MathConstants, lerp, clamp } from '../../MathHelpers';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { preprocessProgramObj_GLSL } from '../../gfx/shaderc/GfxShaderCompiler';
import { setAttachmentStateSimple } from '../../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3, fillVec3v, fillColor } from '../../gfx/helpers/UniformBufferHelpers';

export interface ActorInfo { 
    relName: string; 
    subtype: number;
    unknown1: number;
};

export interface Actor {
    name: string;
    info: ActorInfo; 
    parameters: number;
    auxParams1: number;
    auxParams2: number;
    roomIndex: number;
    layer: number;
    pos: vec3;
    scale: vec3;
    rotationY: number;
};

export interface PlacedActor extends Actor {
    // TODO(jstpierre): Remove these fields.
    roomRenderer: WindWakerRoomRenderer;
};

// Special-case actors

export const enum LightTevColorType {
    ACTOR = 0,
    BG0 = 1,
    BG1 = 2,
    BG2 = 3,
    BG3 = 4,
}

const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

// dScnKy_env_light_c::settingTevStruct
export function settingTevStruct(actor: J3DModelInstanceSimple, type: LightTevColorType, colors: KankyoColors): void {
    if (type === LightTevColorType.ACTOR) {
        actor.setColorOverride(ColorKind.C0, colors.actorC0);
        actor.setColorOverride(ColorKind.K0, colors.actorK0);
    } else if (type === LightTevColorType.BG0) {
        actor.setColorOverride(ColorKind.C0, colors.bg0C0);
        actor.setColorOverride(ColorKind.K0, colors.bg0K0);
    } else if (type === LightTevColorType.BG1) {
        actor.setColorOverride(ColorKind.C0, colors.bg1C0);
        actor.setColorOverride(ColorKind.K0, colors.bg1K0);
    } else if (type === LightTevColorType.BG2) {
        actor.setColorOverride(ColorKind.C0, colors.bg2C0);
        actor.setColorOverride(ColorKind.K0, colors.bg2K0);
    } else if (type === LightTevColorType.BG3) {
        actor.setColorOverride(ColorKind.C0, colors.bg3C0);
        actor.setColorOverride(ColorKind.K0, colors.bg3K0);
    }
}

export interface ObjectRenderer {
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
    setKankyoColors(colors: KankyoColors): void;
    setExtraTextures(v: ZWWExtraTextures): void;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    visible: boolean;
    layer: number;
}

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
export class BMDObjectRenderer implements ObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();
    public lightTevColorType = LightTevColorType.ACTOR;
    public layer: number;

    private childObjects: BMDObjectRenderer[] = [];
    private parentJointMatrix: mat4 | null = null;

    constructor(public modelInstance: J3DModelInstanceSimple) {
    }

    public bindANK1(ank1: ANK1, animationController?: AnimationController): void {
        this.modelInstance.bindANK1(ank1, animationController);
    }

    public bindTTK1(ttk1: TTK1, animationController?: AnimationController): void {
        this.modelInstance.bindTTK1(ttk1, animationController);
    }

    public bindTRK1(trk1: TRK1, animationController?: AnimationController): void {
        this.modelInstance.bindTRK1(trk1, animationController);
    }

    public bindTPT1(tpt1: TPT1, animationController?: AnimationController): void {
        this.modelInstance.bindTPT1(tpt1, animationController);
    }

    public setParentJoint(o: BMDObjectRenderer, jointName: string): void {
        this.parentJointMatrix = o.modelInstance.getJointToWorldMatrixReference(jointName);
        o.childObjects.push(this);
    }

    public setMaterialColorWriteEnabled(materialName: string, v: boolean): void {
        this.modelInstance.setMaterialColorWriteEnabled(materialName, v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
        this.childObjects.forEach((child)=> child.setVertexColorsEnabled(v));
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
        this.childObjects.forEach((child)=> child.setTexturesEnabled(v));
    }

    public setExtraTextures(extraTextures: ZWWExtraTextures): void {
        extraTextures.fillExtraTextures(this.modelInstance);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setExtraTextures(extraTextures);
    }

    public setKankyoColors(colors: KankyoColors): void {
        settingTevStruct(this.modelInstance, this.lightTevColorType, colors);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setKankyoColors(colors);
    }

    public lightPos = vec3.fromValues(-1e7, 1.2e7, -2e7);

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.parentJointMatrix !== null) {
            mat4.mul(this.modelInstance.modelMatrix, this.parentJointMatrix, this.modelMatrix);
        } else {
            mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

            // Don't compute screen area culling on child meshes (don't want heads to disappear before bodies.)
            bboxScratch.transform(this.modelInstance.modelData.bbox, this.modelInstance.modelMatrix);
            computeScreenSpaceProjectionFromWorldSpaceAABB(screenProjection, viewerInput.camera, bboxScratch);

            if (screenProjection.getScreenArea() <= 0.0002)
                return;
        }

        const light = this.modelInstance.getGXLightReference(0);
        GX_Material.lightSetWorldPosition(light, viewerInput.camera, this.lightPos[0], this.lightPos[1], this.lightPos[2]);
        // Toon lighting works by setting the color to red.
        colorFromRGBA(light.Color, 1, 0, 0, 0);
        vec3.set(light.CosAtten, 1.075, 0, 0);
        vec3.set(light.DistAtten, 1.075, 0, 0);

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export type SymbolData = { Filename: string, SymbolName: string, Data: ArrayBufferSlice };
export type SymbolMap = { SymbolData: SymbolData[] };

function buildChildModel(context: WindWakerRenderer, rarc: RARC.RARC, modelPath: string, layer: number): BMDObjectRenderer {
    const model = context.modelCache.getModel(context.device, context.renderCache, rarc, modelPath);
    const modelInstance = new J3DModelInstanceSimple(model);
    aup(modelInstance);
    modelInstance.passMask = WindWakerPass.MAIN;
    context.extraTextures.fillExtraTextures(modelInstance);
    modelInstance.name = name;
    modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
    const objectRenderer = new BMDObjectRenderer(modelInstance);
    objectRenderer.layer = layer;
    return objectRenderer;
}

function computeActorModelMatrix(m: mat4, actor: Actor): void {
    computeModelMatrixSRT(m,
        actor.scale[0], actor.scale[1], actor.scale[2],
        0, actor.rotationY, 0,
        actor.pos[0], actor.pos[1], actor.pos[2]);
}

function setModelMatrix(actor: PlacedActor, m: mat4): void {
    computeActorModelMatrix(m, actor);
    mat4.mul(m, actor.roomRenderer.roomToWorldMatrix, m);
}

function buildModel(context: WindWakerRenderer, rarc: RARC.RARC, modelPath: string, actor: PlacedActor): BMDObjectRenderer {
    const objectRenderer = buildChildModel(context, rarc, modelPath, actor.layer);

    // Transform Actor model from room space to world space
    setModelMatrix(actor, objectRenderer.modelMatrix);
    actor.roomRenderer.objectRenderers.push(objectRenderer);
    return objectRenderer;
}

function createEmitter(context: WindWakerRenderer, resourceId: number): JPA.JPABaseEmitter {
    const emitter = context.effectSystem!.createBaseEmitter(context.device, context.renderCache, resourceId);
    // TODO(jstpierre): Scale, Rotation
    return emitter;
}

function parseBCK(rarc: RARC.RARC, path: string) { const g = BCK.parse(rarc.findFileData(path)!); g.loopMode = LoopMode.REPEAT; return g; }
function parseBRK(rarc: RARC.RARC, path: string) { return BRK.parse(rarc.findFileData(path)!); }
function parseBTK(rarc: RARC.RARC, path: string) { return BTK.parse(rarc.findFileData(path)!); }
function parseBTP(rarc: RARC.RARC, path: string) { return BTP.parse(rarc.findFileData(path)!); }
function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }




// -------------------------------------------------------
// Generic Torch
// -------------------------------------------------------
class ATorch implements ActorRel {
    constructor(context: WindWakerRenderer, actor: PlacedActor) {
        const ga = !!((actor.parameters >>> 6) & 0x01);
        const obm = !!((actor.parameters >>> 7) & 0x01);
        let type = (actor.parameters & 0x3F);
        if (type === 0x3F)
            type = 0;

        setModelMatrix(actor, scratchMat4a);
        vec3.set(scratchVec3a, 0, 0, 0);
        if (type === 0 || type === 3) {
            const rarc = context.modelCache.getObjectData(`Ep`);
            const m = buildModel(context, rarc, obm ? `bdl/obm_shokudai1.bdl` : `bdl/vktsd.bdl`, actor);
            scratchVec3a[1] += 140;
        }
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMat4a);

        // Create particle systems.
        const pa = createEmitter(context, 0x0001);
        vec3.copy(pa.globalTranslation, scratchVec3a);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (type !== 2) {
            const pb = createEmitter(context, 0x4004);
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = createEmitter(context, 0x01EA);
        vec3.copy(pc.globalTranslation, scratchVec3a);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga
    }

    public static requestArchives(context: WindWakerRenderer, actor: Actor): void {
        context.modelCache.fetchObjectData(`Ep`);
    }
}

class ATreasureChest implements ActorRel {
    constructor(context: WindWakerRenderer, actor: PlacedActor) {
        const rarc = context.modelCache.getObjectData(`Dalways`);
        const type = (actor.parameters >>> 20) & 0x0F;
        if (type === 0) {
            // Light Wood
            const m = buildModel(context, rarc, `bdli/boxa.bdl`, actor);
        } else if (type === 1) {
            // Dark Wood
            const m = buildModel(context, rarc, `bdli/boxb.bdl`, actor);
        } else if (type === 2) {
            // Metal
            const m = buildModel(context, rarc, `bdli/boxc.bdl`, actor);
            const b = parseBRK(rarc, 'brk/boxc.brk');
            b.loopMode = LoopMode.ONCE;
            m.bindTRK1(b);
        } else if (type === 3) {
            // Big Key
            const m = buildModel(context, rarc, `bdlm/boxd.bdl`, actor);
        } else {
            // Might be something else, not sure.
            console.warn(`Unknown chest type: ${actor.name} / ${actor.roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameters, 8)}`);
        }
    }

    public static requestArchives(context: WindWakerRenderer, actor: Actor): void {
        context.modelCache.fetchObjectData(`Dalways`);
    }
}

// -------------------------------------------------------
// Grass/Flowers/Trees managed by their respective packets
// -------------------------------------------------------
class AGrass implements ActorRel {
    static kSpawnPatterns = [
        { group: 0, count: 1 },
        { group: 0, count: 7 },
        { group: 1, count: 15 },
        { group: 2, count: 3 },
        { group: 3, count: 7 },
        { group: 4, count: 11 },
        { group: 5, count: 7 },
        { group: 6, count: 5 },
    ];
    
    static kSpawnOffsets = [
        [
            [0, 0, 0],
            [3, 0, -50],
            [-2, 0, 50],
            [50, 0, 27],
            [52, 0, -25],
            [-50, 0, 22],
            [-50, 0, -29],
        ],
        [
            [-18, 0, 76],
            [-15, 0, 26],
            [133, 0, 0],
            [80, 0, 23],
            [86, 0, -83],
            [33, 0, -56],
            [83, 0, -27],
            [-120, 0, -26],
            [-18, 0, -65],
            [-20, 0, -21],
            [-73, 0, 1],
            [-67, 0, -102],
            [-21, 0, 126],
            [-120, 0, -78],
            [-70, 0, -49],
            [32, 0, 103],
            [34, 0, 51],
            [-72, 0, 98],
            [-68, 0, 47],
            [33, 0, -5],
            [135, 0, -53],
        ],
        [
            [-75, 0, -50],
            [75, 0, -25],
            [14, 0, 106],
        ],
        [
            [-24, 0, -28],
            [27, 0, -28],
            [-21, 0, 33],
            [-18, 0, -34],
            [44, 0, -4],
            [41, 0, 10],
            [24, 0, 39],
        ],
        [
            [-55, 0, -22],
            [-28, 0, -50],
            [-77, 0, 11],
            [55, 0, -44],
            [83, 0, -71],
            [11, 0, -48],
            [97, 0, -34],
            [-74, 0, -57],
            [31, 0, 58],
            [59, 0, 30],
            [13, 0, 23],
            [-12, 0, 54],
            [55, 0, 97],
            [10, 0, 92],
            [33, 0, -10],
            [-99, 0, -27],
            [40, 0, -87],
        ],
        [
            [0, 0, 3],
            [-26, 0, -29],
            [7, 0, -25],
            [31, 0, -5],
            [-7, 0, 40],
            [-35, 0, 15],
            [23, 0, 32],
        ],
        [
            [-40, 0, 0],
            [0, 0, 0],
            [80, 0, 0],
            [-80, 0, 0],
            [40, 0, 0],
        ]
    ];

    constructor(context: WindWakerRenderer, actor: Actor) {
        const enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (actor.parameters & 0x00F) >> 0;
        const type: FoliageType = (actor.parameters & 0x030) >> 4;
        const itemIdx = (actor.parameters >> 6) & 0x3f; // Determines which item spawns when this is cut down

        const pattern = AGrass.kSpawnPatterns[spawnPatternId];
        const offsets = AGrass.kSpawnOffsets[pattern.group];
        const count = pattern.count;

        switch (type) {
            case FoliageType.Grass:
                for (let j = 0; j < count; j++) {
                    // @NOTE: Grass does not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos);
                    context.grassPacket.newData(pos, actor.roomIndex, itemIdx);
                }
            break;

            case FoliageType.Tree:
                const rotation = mat4.fromYRotation(scratchMat4a, actor.rotationY);

                for (let j = 0; j < count; j++) {
                    const offset = vec3.transformMat4(scratchVec3a, offsets[j], rotation);
                    const pos = vec3.add(scratchVec3b, offset, actor.pos);
                    context.treePacket.newData(pos, 0, actor.roomIndex);
                }
            break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                for (let j = 0; j < count; j++) {
                    const isPink = (type === FoliageType.PinkFlower);

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos);
                    context.flowerPacket.newData(pos, isPink, actor.roomIndex, itemIdx);
                }
            break;
            default:
                console.warn('Unknown grass actor type');
        }

        return this;
    }
}

class LinkThingRel implements ActorRel {
    constructor(context: WindWakerRenderer, actor: PlacedActor) {
        const modelCache = context.modelCache;
        const roomRenderer = actor.roomRenderer;

        const rarc = modelCache.getObjectData(`Link`);
        const anm = modelCache.getObjectData(`LkAnm`);
    
        const model = modelCache.getModel(context.device, context.renderCache, rarc, `bdl/cl.bdl`);
        const modelInstance = new J3DModelInstanceSimple(model);
        aup(modelInstance);
        modelInstance.passMask = WindWakerPass.MAIN;
        context.extraTextures.fillExtraTextures(modelInstance);
        const cl = new LinkThing(context.device, context.renderCache, modelInstance);
        computeActorMatrix(cl.modelMatrix, actor);
        setToNearestFloor(roomRenderer, cl.modelMatrix, cl.modelMatrix);
        mat4.mul(cl.modelMatrix, roomRenderer.roomToWorldMatrix, cl.modelMatrix);
        roomRenderer.objectRenderers.push(cl);
        (async() => {
            cl.bindANK1(BCK.parse(await Yaz0.decompress(anm.findFileData(`bcks/wait.bck`)!)));
        })();
        cl.layer = actor.layer;
    
        (window as any).cl = cl;
    }

    public static requestArchives(context: WindWakerRenderer, actor: Actor): void {
        context.modelCache.fetchObjectData(`Link`);
        context.modelCache.fetchObjectData(`LkAnm`);
    }
}

// The REL table maps .rel names to our implementations
// @NOTE: Let's just keep this down here for now, for navigability
interface ActorRel {
    // @TODO: Most actors have draw and update functions
}

interface ActorRelConstructor {
    new(context: WindWakerRenderer, actor: PlacedActor): ActorRel;
    requestArchives?(context: WindWakerRenderer, actor: Actor): void;
}

const kRelTable: { [relName: string]: ActorRelConstructor } = {
    'd_a_grass': AGrass,
    'd_a_ep': ATorch,
    'd_a_tbox': ATreasureChest,

    'LinkThing': LinkThingRel,
}

export function requestArchiveForActor(renderer: WindWakerRenderer, actor: Actor): void {
    const relConstructor = kRelTable[actor.info.relName];
    if (relConstructor !== undefined && relConstructor.requestArchives !== undefined)
        relConstructor.requestArchives(renderer, actor);
}

export async function loadActor(renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, worldModelMatrix: mat4, actor: PlacedActor): Promise<void> {
    // Attempt to find an implementation of this Actor in our table
    const relConstructor = kRelTable[actor.info.relName];
    if (relConstructor) {
        const actorObj = new relConstructor(renderer, actor);
        return;
    }

    // Otherwise attempt to load the model(s) and anims for this actor, even if it doesn't have any special logic implemented
    else {
        const modelMatrix = mat4.create();
        computeActorModelMatrix(modelMatrix, actor);
        const loaded = loadGenericActor(renderer, roomRenderer, modelMatrix, worldModelMatrix, actor);
        if (loaded) { return console.warn(`Unimplemented behavior: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameters, 8)}`); }
        else console.warn(`Unknown object: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameters, 8)}`);
    }

    // Doors: TODO(jstpierre)
    // else if (actor.name === 'KNOB00') return;
    // Under-water treasure points. Perhaps spawn at some point?
    // else if (actor.name === 'Salvage' || actor.name === 'Salvag2' || actor.name === 'SalvagE' || actor.name === 'SalvagN' || actor.name === 'SalvFM') return;
    // // Bushes. Procedurally generated by the engine.
    // else if (actor.name === 'woodb' || actor.name === 'woodbx') return;
    // // Rope. Procedurally generated by the engine.
    // else if (actor.name === 'RopeR') return;
    // // Bridges. Procedurally generated by the engine.
    // else if (actor.name === 'bridge') return;
    // // Gyorg spawners.
    // else if (actor.name === 'GyCtrl' || actor.name === 'GyCtrlB') return;
    // // Markers for Tingle Tuner
    // else if (actor.name === 'agbTBOX' || actor.name === 'agbMARK' || actor.name === 'agbF' || actor.name === 'agbA' || actor.name === 'agbAT' || actor.name === 'agbA2' || actor.name === 'agbR' || actor.name === 'agbB' || actor.name === 'agbFA' || actor.name === 'agbCSW') return;
    // // Logic flags used for gameplay, not spawnable objects.
    // else if (actor.name === 'AND_SW0' || actor.name === 'AND_SW1' || actor.name === 'AND_SW2' || actor.name === 'SW_HIT0' || actor.name === 'ALLdie' || actor.name === 'SW_C00') return;
    // // SWitch SaLVaGe?
    // else if (actor.name === 'SwSlvg') return;
    // // EVent SWitch
    // else if (actor.name === 'Evsw') return;
    // // Tags for fishmen?
    // else if (actor.name === 'TagSo' || actor.name === 'TagMSo') return;
    // // Photo tags
    // else if (actor.name === 'TagPo') return;
    // // Light tags?
    // else if (actor.name === 'LTag0' || actor.name === 'LTag1' || actor.name === 'LTagR0') return;
    // // Environment tags (Kankyo)
    // else if (actor.name === 'kytag00' || actor.name === 'ky_tag0' || actor.name === 'ky_tag1' || actor.name === 'ky_tag2' || actor.name === 'kytag5' || actor.name === 'kytag6' || actor.name === 'kytag7') return;
    // // Other tags?
    // else if (actor.name === 'TagEv' || actor.name === 'TagKb' || actor.name === 'TagIsl' || actor.name === 'TagMk' || actor.name === 'TagWp' || actor.name === 'TagMd') return;
    // else if (actor.name === 'TagHt' || actor.name === 'TagMsg' || actor.name === 'TagMsg2' || actor.name === 'ReTag0') return;
    // else if (actor.name === 'AttTag' || actor.name === 'AttTagB') return;
    // else if (actor.name === 'VolTag' || actor.name === 'WindTag') return;
    // // Misc. gameplay data
    // else if (actor.name === 'HyoiKam') return;
    // // Flags (only contains textures)
    // else if (actor.name === 'MtFlag' || actor.name === 'SieFlag' || actor.name === 'Gflag' || actor.name === 'MjFlag') return;
    // // Collision
    // else if (actor.name === 'Akabe') return;
}

function loadGenericActor(renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, localModelMatrix: mat4, worldModelMatrix: mat4, actor: Actor) {
    const modelCache = renderer.modelCache;
    const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

    function fetchArchive(objArcName: string): Promise<RARC.RARC> {
        return renderer.modelCache.fetchArchive(`${pathBase}/Object/${objArcName}`);
    }

    function buildChildModel(rarc: RARC.RARC, modelPath: string): BMDObjectRenderer {
        const model = modelCache.getModel(renderer.device, cache, rarc, modelPath);
        const modelInstance = new J3DModelInstanceSimple(model);
        aup(modelInstance);
        modelInstance.passMask = WindWakerPass.MAIN;
        renderer.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.name = name;
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        objectRenderer.layer = actor.layer;
        return objectRenderer;
    }

    function setModelMatrix(m: mat4): void {
        mat4.mul(m, worldModelMatrix, localModelMatrix);
    }

    function buildModel(rarc: RARC.RARC, modelPath: string): BMDObjectRenderer {
        const objectRenderer = buildChildModel(rarc, modelPath);
        setModelMatrix(objectRenderer.modelMatrix);
        roomRenderer.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelBMT(rarc: RARC.RARC, modelPath: string, bmtPath: string): BMDObjectRenderer {
        const objectRenderer = buildModel(rarc, modelPath);
        const bmt = BMT.parse(rarc.findFileData(bmtPath)!);
        objectRenderer.modelInstance.setModelMaterialData(new BMDModelMaterialData(renderer.device, cache, bmt));
        renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
        return objectRenderer;
    }

    function setToNearestFloor(dstMatrix: mat4, localModelMatrix: mat4) {
        mat4.getTranslation(scratchVec3a, localModelMatrix);
        vec3.set(scratchVec3b, 0, -1, 0);
        const found = DZB.raycast(scratchVec3b, roomRenderer.dzb, scratchVec3a, scratchVec3b);
        if (found)
            dstMatrix[13] = scratchVec3b[1];
    }

    // Tremendous special thanks to LordNed, Sage-of-Mirrors & LagoLunatic for their work on actor mapping
    // Heavily based on https://github.com/LordNed/Winditor/blob/master/Editor/resources/ActorDatabase.json

    if (actor.name === 'item') {
        // Item table provided with the help of the incredible LagoLunatic <3.
        const itemId = (actor.parameters & 0x000000FF);

        // Heart
        if (itemId === 0x00) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/vhrtl.bdl`));
        // Rupee (Green)
        else if (itemId === 0x01) fetchArchive(`Always.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(0));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Blue)
        else if (itemId === 0x02) fetchArchive(`Always.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(1));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Yellow)
        else if (itemId === 0x03) fetchArchive(`Always.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(2));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Red)
        else if (itemId === 0x04) fetchArchive(`Always.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(3));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Purple})
        else if (itemId === 0x05) fetchArchive(`Always.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(4));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Small magic jar
        else if (itemId === 0x09) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/mpoda.bdl`));
        // Large magic jar
        else if (itemId === 0x0A) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/mpodb.bdl`));
        // Small key
        else if (itemId === 0x15) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/vkeyl.bdl`));
        // Joy pendant
        else if (itemId === 0x1F) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/vhapl.bdl`));
        else console.warn(`Unknown item: ${hexzero(itemId, 2)}`);
    }
    // Heart Container
    else if (actor.name === 'Bitem') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/vhutl.bdl`).bindTTK1(parseBTK(rarc, `btk/vhutl.btk`)));
    // Forsaken Fortress warp to Ganon's tower
    else if (actor.name === 'Warpmj') fetchArchive(`Gmjwp.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
        m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
    });
    // NPCs
    // Aryll
    else if (actor.name === 'Ls' || actor.name === 'Ls1') fetchArchive(`Ls.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ls.bdl`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handL`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handR`);
        m.bindANK1(parseBCK(rarc, `bcks/ls_wait01.bck`));
    });
    // Beedle
    else if (actor.name === 'Bs1') fetchArchive(`Bs.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Beedle (this time with helmet)
    else if (actor.name === 'Bs2') fetchArchive(`Bs.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        buildChildModel(rarc, `bdlm/bs_met.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Tingle
    else if (actor.name === 'Tc') fetchArchive(`Tc.arc`).then((rarc) => buildModel(rarc, `bdlm/tc.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Grandma
    else if (actor.name === 'Ba1') {
        // Only allow the sleeping grandma through, because how else can you live in life...
        if (actor.parameters === 0x03) {
            fetchArchive(`Ba.arc`).then(rarc => {
                const m = buildModel(rarc, `bdlm/ba.bdl`);
                m.bindANK1(parseBCK(rarc, `bcks/wait02.bck`));
            });
        }
    }
    // Salvatore
    else if (actor.name === 'Kg1' || actor.name === 'Kg2') fetchArchive(`Kg.arc`).then((rarc) => buildModel(rarc, `bdlm/kg.bdl`).bindANK1(parseBCK(rarc, `bcks/kg_wait01.bck`)));
    // Orca
    else if (actor.name === 'Ji1') fetchArchive(`Ji.arc`).then((rarc) => buildModel(rarc, `bdlm/ji.bdl`).bindANK1(parseBCK(rarc, `bck/ji_wait01.bck`)));
    // Medli
    else if (actor.name === 'Md1') {
        fetchArchive(`Md.arc`).then(rarc => {
            const m = buildModel(rarc, `bdlm/md.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/md_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armL.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armL.modelInstance.setShapeVisible(1, false);
            armL.setParentJoint(m, `armL`);
            const armR = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armR.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armR.modelInstance.setShapeVisible(0, false);
            armR.setParentJoint(m, `armR`);
        });
    }
    // Makar
    else if (actor.name === 'Cb1') fetchArchive(`Cb.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/cb.bdl`);
        buildChildModel(rarc, `bdl/cb_face.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // The King of Hyrule
    else if (actor.name === 'Hi1') fetchArchive(`Hi.arc`).then((rarc) => buildModel(rarc, `bdlm/hi.bdl`).bindANK1(parseBCK(rarc, `bcks/hi_wait01.bck`)));
    // Princess Zelda
    else if (actor.name === 'p_zelda') fetchArchive(`Pz.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/pz.bdl`);            
        m.setMaterialColorWriteEnabled("m_pz_eyeLdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeLdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuLdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuLdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeRdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeRdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuRdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuRdamB", false);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // The Great Deku Tree
    else if (actor.name === 'De1') fetchArchive(`De.arc`).then((rarc) => buildModel(rarc, `bdl/de.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Prince Komali (Small Childe)
    else if (actor.name === 'Co1') fetchArchive(`Co.arc`).then((rarc) => buildModel(rarc, `bdlm/co.bdl`).bindANK1(parseBCK(rarc, `bcks/co_wait00.bck`)));
    // Adult Komali
    else if (actor.name === 'Ac1') fetchArchive(`Ac.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ac.bdl`);
        const armL = buildChildModel(rarc, `bdl/acarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdl/acarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/ac_wait01.bck`));
    });
    // Rito Chieftan
    else if (actor.name === 'Zk1') fetchArchive(`Zk.arc`).then((rarc) => buildModel(rarc, `bdlm/zk.bdl`).bindANK1(parseBCK(rarc, `bcks/zk_wait01.bck`)));
    // Rose
    else if (actor.name === 'Ob1') fetchArchive(`Ob.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ob.bdl`);
        buildChildModel(rarc, `bdlm/oba_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Mesa
    else if (actor.name === 'Ym1') fetchArchive(`Ym.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ym.bdl`);
        buildChildModel(rarc, `bdlm/ymhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Abe
    else if (actor.name === 'Ym2') fetchArchive(`Ym.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ym.bdl`, `bmt/ym2.bmt`);
        buildChildModel(rarc, `bdlm/ymhead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Sturgeon
    else if (actor.name === 'Aj1') fetchArchive(`Aj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/aj.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Quill
    else if (actor.name === 'Bm1') fetchArchive(`Bm.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead01.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm2') fetchArchive(`Bm.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead02.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm3') fetchArchive(`Bm.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead03.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm4') fetchArchive(`Bm.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead04.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm5') fetchArchive(`Bm.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead05.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Baito (Sorting Game)
    else if (actor.name === 'Btsw2') fetchArchive(`Btsw.arc`).then((rarc) => buildModel(rarc, `bdlm/bn.bdl`).bindANK1(parseBCK(rarc, `bcks/bn_wait01.bck`)));
    // Koboli (Sorting Game)
    else if (actor.name === 'Bmsw') fetchArchive(`Bmsw.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead11.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`))
    });
    // Obli
    else if (actor.name === 'Bmcon1') fetchArchive(`Bmcon1.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead08.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Obli
    else if (actor.name === 'Bmcon2') fetchArchive(`Bmcon1.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead10.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Zill
    else if (actor.name === 'Ko1') fetchArchive(`Ko.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ko.bdl`);
        buildChildModel(rarc, `bdlm/kohead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Joel
    else if (actor.name === 'Ko2') fetchArchive(`Ko.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ko.bdl`, `bmt/ko02.bmt`);
        buildChildModel(rarc, `bdlm/kohead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Sue-Belle
    else if (actor.name === 'Yw1') fetchArchive(`Yw.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/yw.bdl`);
        buildChildModel(rarc, `bdlm/ywhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Tetra
    else if (actor.name === 'Zl1') fetchArchive(`Zl.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/zl.bdl`);
        m.setMaterialColorWriteEnabled("eyeLdamA", false);
        m.setMaterialColorWriteEnabled("eyeLdamB", false);
        m.setMaterialColorWriteEnabled("mayuLdamA", false);
        m.setMaterialColorWriteEnabled("mayuLdamB", false);
        m.setMaterialColorWriteEnabled("eyeRdamA", false);
        m.setMaterialColorWriteEnabled("eyeRdamB", false);
        m.setMaterialColorWriteEnabled("mayuRdamA", false);
        m.setMaterialColorWriteEnabled("mayuRdamB", false);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Gonzo
    else if (actor.name === 'P1a') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p1.bdl`);
        buildChildModel(rarc, `bdlm/p1a_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Senza
    else if (actor.name === 'P1b') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1b_body.bmt`);
        buildChildModel(rarc, `bdlm/p1b_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Nudge
    else if (actor.name === 'P1c') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1c_body.bmt`);
        buildChildModel(rarc, `bdlm/p1c_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Zuko
    else if (actor.name === 'P2a') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p2.bdl`);
        buildChildModel(rarc, `bdlm/p2head01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Niko
    else if (actor.name === 'P2b') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2b.bmt`);
        buildChildModel(rarc, `bdlm/p2head02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Mako
    else if (actor.name === 'P2c') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2c.bmt`);
        buildChildModel(rarc, `bdlm/p2head03.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Old Man Ho-Ho
    else if (actor.name === 'Ah') fetchArchive(`Ah.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ah.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/ah_wait01.bck`));
    });
    // Helmarock King
    else if (actor.name === 'Dk') fetchArchive(`Dk.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/dk.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/fly1.bck`));
    });
    // Zunari
    else if (actor.name === 'Rsh1') fetchArchive(`Rsh.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/rs.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/rs_wait01.bck`));
    });
    // ???
    else if (actor.name === 'Sa1') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/sa.bdl`);
        buildChildModel(rarc, `bdlm/sa01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Gummy
    else if (actor.name === 'Sa2') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa02.bmt`);
        buildChildModel(rarc, `bdlm/sa02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Kane
    else if (actor.name === 'Sa3') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa03.bmt`);
        buildChildModel(rarc, `bdlm/sa03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Candy
    else if (actor.name === 'Sa4') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa04.bmt`);
        buildChildModel(rarc, `bdlm/sa04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Dampa
    else if (actor.name === 'Sa5') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa05.bmt`);
        buildChildModel(rarc, `bdlm/sa05_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Potova
    else if (actor.name === 'Ug1') fetchArchive(`Ug.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ug.bdl`);
        buildChildModel(rarc, `bdlm/ug01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Joanna
    else if (actor.name === 'Ug2') fetchArchive(`Ug.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ug.bdl`, `bmt/ug02.bmt`);
        buildChildModel(rarc, `bdlm/ug02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Jin
    else if (actor.name === 'UkB') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/uk.bdl`);
        buildChildModel(rarc, `bdl/ukhead_b.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jan
    else if (actor.name === 'UkC') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_c.bmt`);
        buildChildModel(rarc, `bdlm/ukhead_c.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jun-Roberto
    else if (actor.name === 'UkD') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_d.bmt`);
        buildChildModel(rarc, `bdl/ukhead_d.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Gilligan
    else if (actor.name === 'Uw1') fetchArchive(`Uw.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uw.bdl`);
        buildChildModel(rarc, `bdlm/uw01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Linda
    else if (actor.name === 'Uw2') fetchArchive(`Uw.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uw.bdl`, `bmt/uw02.bmt`);
        buildChildModel(rarc, `bdlm/uw02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Kreeb
    else if (actor.name === 'Um1') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/um.bdl`);
        buildChildModel(rarc, `bdlm/um01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Anton
    else if (actor.name === 'Um2') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um02.bmt`);
        buildChildModel(rarc, `bdlm/um02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Kamo
    else if (actor.name === 'Um3') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um03.bmt`);
        buildChildModel(rarc, `bdlm/um03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Sam
    else if (actor.name === 'Uo1') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uo.bdl`);
        buildChildModel(rarc, `bdlm/uo01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Gossack
    else if (actor.name === 'Uo2') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo02.bmt`);
        buildChildModel(rarc, `bdlm/uo02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Garrickson
    else if (actor.name === 'Uo3') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo03.bmt`);
        buildChildModel(rarc, `bdlm/uo03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Vera
    else if (actor.name === 'Ub1') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ub.bdl`);
        buildChildModel(rarc, `bdlm/ub01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Pompie
    else if (actor.name === 'Ub2') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub02.bmt`);
        buildChildModel(rarc, `bdlm/ub02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Missy
    else if (actor.name === 'Ub3') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub03.bmt`);
        buildChildModel(rarc, `bdlm/ub03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Mineco
    else if (actor.name === 'Ub4') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub04.bmt`);
        buildChildModel(rarc, `bdlm/ub04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (actor.name === 'Bms1') fetchArchive(`Bms.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by1.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by1_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (actor.name === 'Bms2') fetchArchive(`Bms.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by2.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by2_wait00.bck`));
    });
    // Mrs. Marie
    else if (actor.name === 'Ho') fetchArchive(`Ho.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ho.bdl`);
        buildChildModel(rarc, `bdl/ho_pend.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/ho_wait01.bck`));
    });
    // Tott
    else if (actor.name === 'Tt') fetchArchive(`Tt.arc`).then((rarc) => buildModel(rarc, `bdlm/tt.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    // Maggie's Father (Rich)
    else if (actor.name === 'Gp1') fetchArchive(`Gp.arc`).then((rarc) => buildModel(rarc, `bdlm/gp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie's Father (Poor)
    else if (actor.name === 'Pf1') fetchArchive(`Pf.arc`).then((rarc) => buildModel(rarc, `bdlm/pf.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie (Rich)
    else if (actor.name === 'Kp1') fetchArchive(`Kp.arc`).then((rarc) => buildModel(rarc, `bdlm/kp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Mila (Poor)
    else if (actor.name === 'Kk1') fetchArchive(`Kk.arc`).then((rarc) => buildModel(rarc, `bdlm/kk.bdl`).bindANK1(parseBCK(rarc, `bcks/kk_wait01.bck`)));
    // Mila's Father (Rich)
    else if (actor.name === 'Kf1') fetchArchive(`Kf.arc`).then((rarc) => buildModel(rarc, `bdlm/kf.bdl`).bindANK1(parseBCK(rarc, `bcks/kf_wait01.bck`)));
    // Mila's Father (Poor)
    else if (actor.name === 'Gk1') fetchArchive(`Gk.arc`).then((rarc) => buildModel(rarc, `bdlm/gk.bdl`).bindANK1(parseBCK(rarc, `bcks/gk_wait01.bck`)));
    // Ivan
    else if (actor.name === 'Mk') fetchArchive(`Mk.arc`).then((rarc) => buildModel(rarc, `bdlm/mk.bdl`).bindANK1(parseBCK(rarc, `bcks/mk_wait.bck`)));
    // Lorenzo
    else if (actor.name === 'Po') fetchArchive(`Po.arc`).then((rarc) => buildModel(rarc, `bdlm/po.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Doc Bandam
    else if (actor.name === 'Ds1') fetchArchive(`Ds.arc`).then((rarc) => buildModel(rarc, `bdlm/ck.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Jabun
    else if (actor.name === 'Jb1') fetchArchive(`Jb.arc`).then((rarc) => buildModel(rarc, `bdlm/jb.bdl`).bindANK1(parseBCK(rarc, `bcks/jb_wait01.bck`)));
    // Zephos
    else if (actor.name === 'Hr') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Cyclos (same as Zephos)
    else if (actor.name === 'Hr2') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Valoo
    else if (actor.name === 'dragon') fetchArchive(`Dr.arc`).then((rarc) => buildModel(rarc, `bmd/dr1.bmd`).bindANK1(parseBCK(rarc, `bck/dr_wait1.bck`)));
    // Olivio (Korok)
    else if (actor.name === 'Bj1') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj1_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Aldo (Korok)
    else if (actor.name === 'Bj2') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj2_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Oakin (Korok)
    else if (actor.name === 'Bj3') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj3_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Drona (Korok)
    else if (actor.name === 'Bj4') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj4_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Irch (Korok)
    else if (actor.name === 'Bj5') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj5_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Rown (Korok)
    else if (actor.name === 'Bj6') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj6_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Hollo (Korok)
    else if (actor.name === 'Bj7') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj7_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Elma (Korok)
    else if (actor.name === 'Bj8') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj8_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Linder (Korok)
    else if (actor.name === 'Bj9') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj9_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Manny
    else if (actor.name === 'Mn') fetchArchive(`Mn.arc`).then((rarc) => buildModel(rarc, `bdlm/mn.bdl`).bindANK1(parseBCK(rarc, `bcks/mn_wait01.bck`)));
    // Carlov
    else if (actor.name === 'Mt') fetchArchive(`Niten.arc`).then((rarc) => buildModel(rarc, `bdlm/mt.bdl`).bindANK1(parseBCK(rarc, `bcks/mt_wait01.bck`)));
    // Great Fairy
    else if (actor.name === 'BigElf') fetchArchive(`bigelf.arc`).then((rarc) => buildModel(rarc, `bdlm/dy.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Fairy
    else if (actor.name === 'Sfairy') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/fa.bdl`).bindANK1(parseBCK(rarc, `bck/fa.bck`)));
    // Goron Merchants
    else if (actor.name === 'RotenA') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (actor.name === 'RotenB') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat2.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (actor.name === 'RotenC') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat3.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    // Hyrule Ocean Warp
    else if (actor.name === 'Ghrwp') fetchArchive(`Ghrwp.arc`).then((rarc) => {
        const a00 = buildModel(rarc, `bdlm/ghrwpa00.bdl`);
        a00.bindTTK1(parseBTK(rarc, `btk/ghrwpa00.btk`));
        const b00 = buildModel(rarc, `bdlm/ghrwpb00.bdl`);
        b00.bindTTK1(parseBTK(rarc, `btk/ghrwpb00.btk`));
        b00.bindTRK1(parseBRK(rarc, `brk/ghrwpb00.brk`));
    });
    // Various liftable objects
    else if (
        actor.name === 'kotubo' || actor.name === 'ootubo1' || actor.name === 'Kmtub' ||
        actor.name === 'Ktaru'  || actor.name === 'Ostool'  || actor.name === 'Odokuro' ||
        actor.name === 'Okioke'  || actor.name === 'Kmi02'   || actor.name === 'Ptubo' ||
        actor.name === 'KkibaB'   || actor.name === 'Kmi00'   || actor.name === 'Hbox2S'
    ) {
        const type = (actor.parameters & 0x0F000000) >> 24;
        let model;
        switch (type) {
        case 0:
            // Small Pot
            fetchArchive(`Always.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/obm_kotubo1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 1:
            // Large Pot
            fetchArchive(`Always.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/obm_ootubo1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 2:
            // Water Pot
            fetchArchive(`Kmtub_00.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmtub_00.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 3:
            // Barrel
            fetchArchive(`Ktaru_01.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/ktaru_01.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 4:
            // Stool
            fetchArchive(`Okmono.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/ostool.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 5:
            // Skull
            fetchArchive(`Odokuro.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/odokuro.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 6:
            // Bucket
            fetchArchive(`Okioke.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/okioke.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 7:
            // Nut
            fetchArchive(`Kmi00x.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmi_00x.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 8:
            // Golden Crate
            fetchArchive(`Hbox2.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/hbox2.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 13:
            // Seed
            fetchArchive(`Sitem.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmi_02.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 14:
            // Fancy Pot
            fetchArchive(`Ptubo.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/ptubo.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 15:
            // Wooden Crate
            fetchArchive(`Kkiba_00.arc`).then((rarc) => {
                model = buildModel(rarc, `bdl/kkiba_00.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        default:
            // Blue Tower of the Gods Pillar Statue
            fetchArchive(`Hseki.arc`).then((rarc) => {
                model = buildModel(rarc, `bdlm/hmon1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        }
    }
    // Outset Island: Jabun's barrier (six parts)
    else if (actor.name === 'Ajav') fetchArchive(`Ajav.arc`).then((rarc) => {
        // Seems like there's one texture that's shared for all parts in ajava.bdl
        // ref. daObjAjav::Act_c::set_tex( (void))
        const ja = buildModel(rarc, `bdl/ajava.bdl`);
        const txa = ja.modelInstance.getTextureMappingReference('Txa_jav_a')!;
        const jb = buildModel(rarc, `bdl/ajavb.bdl`);
        jb.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jc = buildModel(rarc, `bdl/ajavc.bdl`);
        jc.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jd = buildModel(rarc, `bdl/ajavd.bdl`);
        jd.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const je = buildModel(rarc, `bdl/ajave.bdl`);
        je.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jf = buildModel(rarc, `bdl/ajavf.bdl`);
        jf.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
    });
    else if (actor.name === 'koisi1') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
    // Bigger trees
    else if (actor.name === 'lwood') fetchArchive(`Lwood.arc`).then((rarc) => {
        const b = buildModel(rarc, `bdl/alwd.bdl`);
        b.lightTevColorType = LightTevColorType.BG0;
    });
    else if (actor.name === 'Oyashi') fetchArchive(`Oyashi.arc`).then((rarc) => buildModel(rarc, `bdl/oyashi.bdl`));
    else if (actor.name === 'Vyasi') fetchArchive(`Vyasi.arc`).then((rarc) => buildModel(rarc, `bdl/vyasi.bdl`));
    // Barrels
    else if (actor.name === 'Ktarux') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    else if (actor.name === 'Ktaruo') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    // Breakable shelves
    else if (actor.name === 'Otana') fetchArchive(`Otana.arc`).then((rarc) => buildModel(rarc, `bdl/otana.bdl`));
    // Mailbox
    else if (actor.name === 'Tpost') fetchArchive(`Toripost.arc`).then((rarc) => buildModel(rarc, `bdl/vpost.bdl`).bindANK1(parseBCK(rarc, `bcks/post_wait.bck`)));
    // Sign
    else if (actor.name === 'Kanban') fetchArchive(`Kanban.arc`).then((rarc) => {
        const b = buildModel(rarc, `bdl/kanban.bdl`);
        b.lightTevColorType = LightTevColorType.BG0;
    });
    // Doors: TODO(jstpierre)
    else if (actor.name === 'KNOB00') return;
    // Forsaken Fortress door
    else if (actor.name === 'SMBdor') fetchArchive(`Mbdoor.arc`).then((rarc) => {
        // Frame
        const fu = buildModel(rarc, `bdl/s_mbdfu.bdl`);
        fu.lightTevColorType = LightTevColorType.BG0;
        // Left door
        const l = buildModel(rarc, `bdl/s_mbd_l.bdl`);
        l.lightTevColorType = LightTevColorType.BG0;
        // Right door
        const r = buildModel(rarc, `bdl/s_mbd_r.bdl`);
        r.lightTevColorType = LightTevColorType.BG0;
        // Barricade. Not set to the correct default unlocked position.
        const to = buildModel(rarc, `bdl/s_mbdto.bdl`);
        to.lightTevColorType = LightTevColorType.BG0;
    });
    // Forsaken Fortress water gate
    else if (actor.name === 'MjDoor') fetchArchive(`S_MSPDo.arc`).then((rarc) => buildModel(rarc, `bdl/s_mspdo.bdl`));
    // Holes you can fall into
    else if (actor.name === 'Pitfall') fetchArchive(`Aana.arc`).then((rarc) => buildModel(rarc, `bdl/aana.bdl`));
    // Warp Pot
    else if (actor.name === 'Warpt' || actor.name === 'Warpnt' || actor.name === 'Warpts1' || actor.name === 'Warpts2' || actor.name === 'Warpts3') fetchArchive(`ltubw.arc`).then((rarc) => buildModel(rarc, `bdl/itubw.bdl`));
    else if (actor.name === 'Warpgm') fetchArchive(`Gmjwp.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gmjwp01.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gmjwp01.brk`));
    });
    // Hookshot Target (wtf Nintendo)
    else if (actor.name === 'Hfuck1') fetchArchive(`Hfuck1.arc`).then((rarc) => buildModel(rarc, `bdl/hfuck1.bdl`));
    // Ladders
    else if (actor.name === 'Mhsg4h') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg4h.bdl`));
    else if (actor.name === 'Mhsg9') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg9.bdl`));
    else if (actor.name === 'Mhsg15') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg15.bdl`));
    // Bombable rock
    else if (actor.name === 'Ebrock') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock.bdl`));
    else if (actor.name === 'Ebrock2') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock2.bdl`));
    else if (actor.name === 'Eskban') fetchArchive(`Eskban.arc`).then((rarc) => buildModel(rarc, `bdl/eskban.bdl`));
    else if (actor.name === 'Esekh') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh.bdl`));
    else if (actor.name === 'Esekh2') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh2.bdl`));
    else if (actor.name === 'Ebomzo') fetchArchive(`Ebomzo.arc`).then((rarc) => buildModel(rarc, `bdl/ebomzo.bdl`));
    // Stone head rock
    else if (actor.name === 'Ekao') fetchArchive(`Ekao.arc`).then((rarc) => buildModel(rarc, `bdl/ekao.bdl`));
    // Whirlpool
    else if (actor.name === 'Auzu') fetchArchive(`Auzu.arc`).then((rarc) => buildModel(rarc, `bdlm/auzu.bdl`).bindTTK1(parseBTK(rarc, `btk/auzu.btk`)));
    // Floor Switch
    else if (actor.name === 'Kbota_A' || actor.name === 'Kbota_B' || actor.name === 'KbotaC') fetchArchive(`Kbota_00.arc`).then((rarc) => buildModel(rarc, `bdl/kbota_00.bdl`));
    // Iron Boots Switch
    else if (actor.name === 'Hhbot1' || actor.name === 'Hhbot1N') fetchArchive(`Hhbot.arc`).then((rarc) => {
        buildModel(rarc, `bdl/hhbot1.bdl`);
        buildModel(rarc, `bdl/hhbot2.bdl`);
    });
    // Spike Trap
    else if (actor.name === 'Trap') fetchArchive(`Trap.arc`).then((rarc) => buildModel(rarc, `bdlm/htora1.bdl`));
    // Floor Spikes
    else if (actor.name === 'Htoge1') fetchArchive(`Htoge1.arc`).then((rarc) => buildModel(rarc, `bdl/htoge1.bdl`));
    // Grapple Point
    else if (actor.name === 'Kui') fetchArchive(`Kui.arc`).then((rarc) => buildModel(rarc, `bdl/obi_ropetag.bdl`));
    // Various pushable objects
    else if (
        actor.name === 'osiBLK0' || actor.name === 'osiBLK1' || actor.name === 'Kkiba' ||
        actor.name === 'Hseki2'  || actor.name === 'Hseki7'  || actor.name === 'Mmrr' ||
        actor.name === 'MkieBB'  || actor.name === 'Ecube'   || actor.name === 'Hjump1' ||
        actor.name === 'Hbox1'   || actor.name === 'MpwrB'   || actor.name === 'DBLK0' ||
        actor.name === 'DBLK1'   || actor.name === 'DKkiba'  || actor.name === 'Hbox2'
    ) {
        const type = (actor.parameters & 0x0F000000) >> 24;
        switch (type) {
        case 0:
        case 4:
        case 8:
        case 9:
            // Wooden Crate
            fetchArchive(`Kkiba_00.arc`).then((rarc) => {
                buildModel(rarc, `bdl/kkiba_00.bdl`);
            });
            break;
        case 1:
        case 11:
            // Black Box
            fetchArchive(`Osiblk.arc`).then((rarc) => {
                buildModel(rarc, `bdl/obm_osihikiblk1.bdl`);
            });
            break;
        case 2:
            // Black Box With Statue on Top
            fetchArchive(`Osiblk.arc`).then((rarc) => {
                buildModel(rarc, `bdl/obm_osihikiblk2.bdl`);
            });
            break;
        case 3:
            // Big Black Box
            fetchArchive(`MpwrB.arc`).then((rarc) => {
                buildModel(rarc, `bdl/mpwrb.bdl`);
            });
            break;
        case 5:
            // Golden Crate
            fetchArchive(`Hbox2.arc`).then((rarc) => {
                buildModel(rarc, `bdl/hbox2.bdl`);
            });
            break;
        case 6:
            // Pushable Metal Box
            fetchArchive(`Hjump.arc`).then((rarc) => {
                buildModel(rarc, `bdl/hbox1.bdl`);
            });
            break;
        case 7:
            // Pushable Metal Box With Spring
            fetchArchive(`Hjump.arc`).then((rarc) => {
                buildModel(rarc, `bdl/hjump1.bdl`);
            });
            break;
        case 10:
            // Mirror
            fetchArchive(`Mmirror.arc`).then((rarc) => {
                buildModel(rarc, `bdlm/mmrr.bdl`).bindTTK1(parseBTK(rarc, `btk/mmrr.btk`));
            });
            break;
        case 12:
            // Mossy Black Box
            fetchArchive(`Ecube.arc`).then((rarc) => {
                buildModel(rarc, `bdl/ecube.bdl`);
            });
            break;
        }
    }
    // Korok Tree
    else if (actor.name === 'FTree') fetchArchive(`Vmr.arc`).then((rarc) => buildModel(rarc, `bdlm/vmrty.bdl`).bindANK1(parseBCK(rarc, `bck/vmrty.bck`)));
    // Animals
    else if (actor.name === 'DmKmm') fetchArchive(`Demo_Kmm.arc`).then((rarc) => buildModel(rarc, `bmd/ka.bmd`).bindANK1(parseBCK(rarc, `bcks/ka_wait1.bck`)));
    else if (actor.name === 'Kamome') fetchArchive(`Kamome.arc`).then((rarc) => buildModel(rarc, `bdl/ka.bdl`).bindANK1(parseBCK(rarc, `bck/ka_wait2.bck`)));
    else if (actor.name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`));
    else if (actor.name === 'Pig') fetchArchive(`Kb.arc`).then((rarc) => buildModel(rarc, `bdlm/pg.bdl`));
    else if (actor.name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    else if (actor.name === 'NpcSo') fetchArchive(`So.arc`).then((rarc) => buildModel(rarc, `bdlm/so.bdl`).bindANK1(parseBCK(rarc, `bcks/so_wait01.bck`)));
    // Enemies
    // Phantom Ganon
    else if (actor.name === 'Fganon') fetchArchive(`Fganon.arc`).then((rarc) => buildModel(rarc, `bdlm/bpg.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    // Gohma
    else if (actor.name === 'Btd') fetchArchive(`btd.arc`).then((rarc) => {
        const m = buildModel(rarc, `bmdm/btd.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/btd_pose.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/btd.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/btd.btk`));
    });
    // Kalle Demos
    else if (actor.name === 'Bkm') fetchArchive(`Bmd.arc`).then((rarc) => {
        buildModel(rarc, `bmdm/bkm.bmd`).bindANK1(parseBCK(rarc, `bck/hiraku_wait.bck`))
        buildModel(rarc, `bmdm/bkm_coa.bmd`).bindANK1(parseBCK(rarc, `bck/coa_wait.bck`))
    });
    // Gohdan
    else if (actor.name === 'Bst') fetchArchive(`Bst.arc`).then((rarc) => {
        const type = (actor.parameters & 0x000000FF);
        switch (type) {
        case 0:
            // Head
            buildModel(rarc, `bdlm/bst.bdl`).bindTTK1(parseBTK(rarc, `btk/bst.btk`))
        break;
        case 1:
            // Left hand
            buildModel(rarc, `bdlm/lhand.bdl`).bindTTK1(parseBTK(rarc, `btk/lhand.btk`))
            break;
        case 2:
            // Right hand
            buildModel(rarc, `bdlm/rhand.bdl`).bindTTK1(parseBTK(rarc, `btk/rhand.btk`))
            break;
        }
    });
    // Jalhalla
    else if (actor.name === 'big_pow') fetchArchive(`Bpw.arc`).then((rarc) => {
        const mainModel = buildModel(rarc, `bdlm/bpw.bdl`);
        mainModel.bindANK1(parseBCK(rarc, `bck/wait1.bck`))
        mat4.translate(mainModel.modelMatrix, mainModel.modelMatrix, [0, 400, 0]); // Bump him up a bit so he's not halfway inside the floor
        const lanternModel = buildChildModel(rarc, `bdlm/bpw_kan1.bdl`);
        lanternModel.setParentJoint(mainModel, `j_bpw_item`);
        mat4.rotateZ(lanternModel.modelMatrix, lanternModel.modelMatrix, Math.PI);
        // TODO: add flame particle emitter to lantern
    });
    // Molgera
    else if (actor.name === 'Bwd') fetchArchive(`Bwd.arc`).then((rarc) => {
        const mainModel = buildModel(rarc, `bdlm/bwd.bdl`);
        mainModel.bindTRK1(parseBRK(rarc, `brk/bwd.brk`), animFrame(0));

        // Add the parts of Molgera's tail. It's procedurally animated ingame, but for now just give it a static pose.
        let lastModel = mainModel;
        for (let i = 0; i < 20; i++) {
            let tailModel;
            if (i == 19) {
                tailModel = buildChildModel(rarc, `bdlm/bwd_shippob.bdl`);
                tailModel.bindTRK1(parseBRK(rarc, `brk/bwd_shippob.brk`), animFrame(0));
            } else {
                tailModel = buildChildModel(rarc, `bdlm/bwd_shippoa.bdl`);
                tailModel.bindTRK1(parseBRK(rarc, `brk/bwd_shippoa.brk`), animFrame(0));
            }
            if (i == 0) {
                tailModel.setParentJoint(lastModel, `hara`);
                mat4.rotateY(tailModel.modelMatrix, tailModel.modelMatrix, Math.PI * 1.5);
            } else {
                tailModel.setParentJoint(lastModel, `bwd`);
            }
            mat4.rotateX(tailModel.modelMatrix, tailModel.modelMatrix, -Math.PI / 40);
            mat4.translate(tailModel.modelMatrix, tailModel.modelMatrix, [0, 0, -200]);
            lastModel = tailModel;
        }
    });
    else if (actor.name === 'keeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/ki.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Fkeeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/fk.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Puti') fetchArchive(`Pt.arc`).then((rarc) => buildModel(rarc, `bdlm/pt.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'Rdead1' || actor.name === 'Rdead2') fetchArchive(`Rd.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/rd.bdl`);
        const idleAnimType = (actor.parameters & 0x00000001);
        if (idleAnimType == 0) {
            m.bindANK1(parseBCK(rarc, `bcks/tachip.bck`));
        } else {
            m.bindANK1(parseBCK(rarc, `bcks/suwarip.bck`));
        }
    });
    else if (actor.name === 'wiz_r') fetchArchive(`Wz.arc`).then((rarc) => buildModel(rarc, `bdlm/wz.bdl`).bindANK1(parseBCK(rarc, `bck/s_demo_wait1.bck`)));
    else if (actor.name === 'gmos') fetchArchive(`Gm.arc`).then((rarc) => buildModel(rarc, `bdlm/gm.bdl`).bindANK1(parseBCK(rarc, `bck/fly.bck`)));
    else if (actor.name === 'mo2') fetchArchive(`Mo2.arc`).then((rarc) => buildModel(rarc, `bdlm/mo.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'pow') fetchArchive(`Pw.arc`).then(async (rarc) => {
        let color = (actor.parameters & 0x0000FE00) >> 9;
        if (color > 5)
            color = 0;

        const mainModel = buildModel(rarc, `bdlm/pw.bdl`);
        mainModel.bindANK1(parseBCK(rarc, `bck/wait1.bck`));
        mainModel.bindTPT1(parseBTP(rarc, `btp/irogae1.btp`), animFrame(color));

        const lanternRarc = await fetchArchive(`Kantera.arc`);
        const lanternModel = buildChildModel(lanternRarc, `bmdm/mk_kantera.bmd`);
        lanternModel.bindTRK1(parseBRK(lanternRarc, `brk/mk_kantera.brk`));
        lanternModel.setParentJoint(mainModel, `j_pw_item_r1`);
        mat4.rotateX(lanternModel.modelMatrix, lanternModel.modelMatrix, Math.PI / 4);
    });
    else if (actor.name === 'Bb') fetchArchive(`Bb.arc`).then((rarc) => buildModel(rarc, `bdlm/bb.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'Bk') fetchArchive(`Bk.arc`).then((rarc) => buildModel(rarc, `bdlm/bk.bdl`).bindANK1(parseBCK(rarc, `bck/bk_wait.bck`)));
    else if (actor.name === 'Oq') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/oq.bmd`).bindANK1(parseBCK(rarc, `bck/nom_wait.bck`)));
    else if (actor.name === 'Oqw') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/red_oq.bmd`).bindANK1(parseBCK(rarc, `bck/umi_new_wait.bck`)));
    else if (actor.name === 'Daiocta') fetchArchive(`Daiocta.arc`).then((rarc) => buildModel(rarc, `bdlm/do_main1.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Fmastr1' || name == 'Fmastr2') fetchArchive(`fm.arc`).then((rarc) => { 
        buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        const holeModel = buildModel(rarc, `bdlm/ypit00.bdl`);
        holeModel.bindTTK1(parseBTK(rarc, `btk/ypit00.btk`));
        // Move the hole just slightly up to prevent z-fighting with the ground.
        mat4.translate(holeModel.modelMatrix, holeModel.modelMatrix, [0, 0.1, 0]);
    });
    else if (actor.name === 'magtail') fetchArchive(`Mt.arc`).then((rarc) => buildModel(rarc, `bdlm/mg_head.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    // Red and Blue Bubbles
    else if (name === 'bable') fetchArchive(`Bl.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bl.bdl`);

        const bubbleType = (actor.parameters & 0x000000FF);
        
        if (bubbleType == 0x80) {
            m.bindTTK1(parseBTK(rarc, 'btk/off.btk'));
        } else {
            m.bindANK1(parseBCK(rarc, 'bck/fly.bck'));

            // TODO: particles (0x8124 for red, 0x8123 for blue)
        }
    });
    else if (actor.name === 'nezumi') fetchArchive(`Nz.arc`).then((rarc) => buildModel(rarc, `bdlm/nz.bdl`));
    else if (actor.name === 'moZOU') fetchArchive(`Mozo.arc`).then((rarc) => buildModel(rarc, `bdlm/moz.bdl`));
    else if (actor.name === 'MtoriSU') fetchArchive(`MtoriSU.arc`).then((rarc) => buildModel(rarc, `bdl/mtorisu.bdl`));
    // Darknut
    else if (actor.name === 'Tn') fetchArchive(`Tn.arc`).then(async (rarc) => {
        const equipmentType = (actor.auxParams1 & 0x00E0) >>> 5;
        const armorColor = (actor.parameters & 0x000000F0) >>> 4;
        
        const mainModel = buildModel(rarc, `bmdm/tn_main.bmd`);
        const mainAnim = parseBCK(rarc, `bck/aniou1.bck`);
        mainModel.bindTRK1(parseBRK(rarc, `brk/tn_main.brk`), animFrame(armorColor));

        const weaponRarc = await fetchArchive(`Tkwn.arc`);
        const swordModel = buildChildModel(weaponRarc, `bdlc/tn_ken1.bdl`);
        swordModel.setParentJoint(mainModel, `j_tn_item_r1`);
        mat4.translate(swordModel.modelMatrix, swordModel.modelMatrix, [0, 0, 85]);
        
        const armorModel = buildChildModel(rarc, `bmdm/tn_yoroi1.bmd`);
        armorModel.setParentJoint(mainModel, `j_tn_mune1`);
        armorModel.bindTRK1(parseBRK(rarc, `brk/tn_yoroi1.brk`), animFrame(armorColor));
        // Translate to simulate the armor model being centered on the j_yoroi_main1 bone instead of tn_yoroi_allroot.
        mat4.translate(armorModel.modelMatrix, armorModel.modelMatrix, [-120, 0, 0]);
        mat4.rotateZ(armorModel.modelMatrix, armorModel.modelMatrix, Math.PI * 1.5);

        // Rotate both the ears by 180 degrees on all anim frames so they're hidden inside the head instead of poking out of the helmet.
        [30, 32].forEach((ear_joint_index) => {
            const earJointAnimEntry = mainAnim.jointAnimationEntries[ear_joint_index];
            for (let i = 0; i < earJointAnimEntry.rotationY.frames.length; i++) {
                const anim_frame = earJointAnimEntry.rotationY.frames[i];
                anim_frame.value += Math.PI;
            }
        });
        if (equipmentType >= 2) { // Has shield
            const shieldModel = buildChildModel(rarc, `bmdm/tn_tate1.bmd`);
            shieldModel.setParentJoint(mainModel, `j_tn_item_l1`);
            shieldModel.bindTRK1(parseBRK(rarc, `brk/tn_tate1.brk`), animFrame(armorColor));

            const shieldAnim = parseBCK(rarc, `bck/atate_on1.bck`);
            // If the Darknut has a shield, then the left arm joints (11-17) use anim atate_on1.bck, while the rest still use aniou1.bck.
            for (let joint_index = 11; joint_index < 18; joint_index++) {
                mainAnim.jointAnimationEntries[joint_index] = shieldAnim.jointAnimationEntries[joint_index];
            }
        }
        mainModel.bindANK1(mainAnim);

        let helmetModel;
        if (equipmentType == 1 || equipmentType == 3 || equipmentType >= 5) { // Has full face helmet
            helmetModel = buildChildModel(rarc, `bmdm/tn_kabuto2.bmd`);
            helmetModel.bindTRK1(parseBRK(rarc, `brk/tn_kabuto2.brk`), animFrame(armorColor));
        } else {
            helmetModel = buildChildModel(rarc, `bmdm/tn_kabuto1.bmd`);
            helmetModel.bindTRK1(parseBRK(rarc, `brk/tn_kabuto1.brk`), animFrame(armorColor));
        }
        helmetModel.setParentJoint(mainModel, `j_tn_atama1`);

        // TODO: The armor should look specular.

        if (equipmentType >= 5) { // Has a cape
            // TODO: Cape is procedurally animated. Also, the cape's textures are inside d_a_mant.rel.
        }
    });
    // Stalfos
    else if (actor.name === 'Stal') fetchArchive(`St.arc`).then((rarc) => {
        const skeletonModel = buildModel(rarc, `bdlm/st.bdl`);
        skeletonModel.bindANK1(parseBCK(rarc, 'bck/wait.bck'));
        buildChildModel(rarc, `bdlm/st_hara.bdl`).setParentJoint(skeletonModel, `hara`);
        buildChildModel(rarc, `bdlm/st_mune.bdl`).setParentJoint(skeletonModel, `mune`);
        buildChildModel(rarc, `bdlm/st_katal.bdl`).setParentJoint(skeletonModel, `kataL`);
        buildChildModel(rarc, `bdlm/st_udel.bdl`).setParentJoint(skeletonModel, `udeL`);
        buildChildModel(rarc, `bdlm/st_handl.bdl`).setParentJoint(skeletonModel, `handL`);
        buildChildModel(rarc, `bdlm/st_yubi1l.bdl`).setParentJoint(skeletonModel, `yubi1L`);
        buildChildModel(rarc, `bdlm/st_yubi2l.bdl`).setParentJoint(skeletonModel, `yubi2L`);
        buildChildModel(rarc, `bdlm/st_katar.bdl`).setParentJoint(skeletonModel, `kataR`);
        buildChildModel(rarc, `bdlm/st_uder.bdl`).setParentJoint(skeletonModel, `udeR`);
        buildChildModel(rarc, `bdlm/st_handr.bdl`).setParentJoint(skeletonModel, `handR`);
        buildChildModel(rarc, `bdlm/st_buki.bdl`).setParentJoint(skeletonModel, `buki`);
        buildChildModel(rarc, `bdlm/st_yubi1r.bdl`).setParentJoint(skeletonModel, `yubi1R`);
        buildChildModel(rarc, `bdlm/st_yubi2r.bdl`).setParentJoint(skeletonModel, `yubi2R`);
        buildChildModel(rarc, `bdlm/st_kubi.bdl`).setParentJoint(skeletonModel, `kubi`);
        buildChildModel(rarc, `bdlm/st_head.bdl`).setParentJoint(skeletonModel, `head`);
        buildChildModel(rarc, `bdlm/st_ago.bdl`).setParentJoint(skeletonModel, `ago`);
        buildChildModel(rarc, `bdlm/st_hat.bdl`).setParentJoint(skeletonModel, `hat`);
        buildChildModel(rarc, `bdlm/st_kotuban.bdl`).setParentJoint(skeletonModel, `kotuban`);
        buildChildModel(rarc, `bdlm/st_momol.bdl`).setParentJoint(skeletonModel, `momoL`);
        buildChildModel(rarc, `bdlm/st_sunel.bdl`).setParentJoint(skeletonModel, `suneL`);
        buildChildModel(rarc, `bdlm/st_asil.bdl`).setParentJoint(skeletonModel, `asiL`);
        buildChildModel(rarc, `bdlm/st_momor.bdl`).setParentJoint(skeletonModel, `momoR`);
        buildChildModel(rarc, `bdlm/st_suner.bdl`).setParentJoint(skeletonModel, `suneR`);
        buildChildModel(rarc, `bdlm/st_asir.bdl`).setParentJoint(skeletonModel, `asiR`);
        // Set a fake bbox for the main invisible skeleton model so it doesn't get culled when the camera isn't right on top of it.
        skeletonModel.modelInstance.modelData.bbox = new AABB(-80, -80, -80, 80, 80, 80);
    });
    // Peahats and Seahats
    else if (actor.name === 'p_hat') {
        const type = (actor.parameters & 0x000000FF);
        if (type == 1) {
            fetchArchive(`Sh.arc`).then((rarc) => {
                const mainModel = buildModel(rarc, `bmdm/shb.bmd`);
                mainModel.bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
                mat4.scale(mainModel.modelMatrix, mainModel.modelMatrix, [9, 9, 9]);
                const propellerModel = buildModel(rarc, `bmdm/shp.bmd`);
                propellerModel.bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
                mat4.scale(propellerModel.modelMatrix, propellerModel.modelMatrix, [9, 9, 9]);
                mat4.translate(propellerModel.modelMatrix, propellerModel.modelMatrix, [0, 50, 0]); // Estimated Y offset
            });
        } else {
            fetchArchive(`Ph.arc`).then((rarc) => {
                const mainModel = buildModel(rarc, `bdlm/phb.bdl`);
                mainModel.bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
                const propellerModel = buildModel(rarc, `bdlm/php.bdl`);
                propellerModel.bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
                mat4.translate(propellerModel.modelMatrix, propellerModel.modelMatrix, [0, 50, 0]); // Estimated Y offset
            });
        }
    }
    else if (actor.name === 'bbaba') fetchArchive(`Bo.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bo_sita1.bdl`);
        // TODO(jstpierre): animation?
    });
    // ChuChus
    else if (actor.name === 'c_green' || actor.name === 'c_red' || actor.name === 'c_blue' || name == 'c_black' || name == 'c_kiiro') fetchArchive(`Cc.arc`).then((rarc) => {
        const cc = buildModel(rarc, `bmdm/cc.bmd`);
        cc.bindANK1(parseBCK(rarc, `bck/tachi_walk.bck`));

        const chuchuType = (actor.parameters & 0x0000FF00) >>> 8;
        let frameNum;
        switch (chuchuType) {
        case 0:
        case 10:
            // Green
            frameNum = 0;
            break;
        case 1:
        case 11:
        case 15:
            // Red
            frameNum = 1;
            break;
        case 2:
        case 12:
            // Blue
            frameNum = 2;
            break;
        case 3:
        case 13:
            // Dark
            frameNum = 3;
            break;
        case 4:
        case 14:
            // Yellow
            frameNum = 4;
            break;
        default:
            frameNum = 0;
            break;
        }
        cc.bindTRK1(parseBRK(rarc, `brk/cc.brk`), animFrame(frameNum));
    });
    // Beedle's Shop Ship (in Tip Top Shape)
    else if (actor.name === 'ikada_h') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp.bdl`));
    // Helmeted Beedle's Shop Ship
    else if (actor.name === 'ikada_u') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp2.bdl`));
    // The Great Sea
    else if (actor.name === 'Svsp') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vsvsp.bdl`));
    else if (actor.name === 'Vtil1') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil1.bdl`));
    else if (actor.name === 'Vtil2') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil2.bdl`));
    else if (actor.name === 'Vtil3') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil3.bdl`));
    else if (actor.name === 'Vtil4') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil4.bdl`));
    else if (actor.name === 'Vtil5') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil5.bdl`));
    else if (actor.name === 'Ekskz') fetchArchive(`Ekskz.arc`).then((rarc) => {
        buildModel(rarc, `bdl/ekskz.bdl`);
        const yocwd00 = buildModel(rarc, `bdlm/yocwd00.bdl`);
        yocwd00.bindANK1(parseBCK(rarc, `bck/yocwd00.bck`));
        yocwd00.bindTRK1(parseBRK(rarc, `brk/yocwd00.brk`));
        yocwd00.bindTTK1(parseBTK(rarc, `btk/yocwd00.btk`));
    });
    else if (actor.name === 'Ocanon') fetchArchive(`WallBom.arc`).then((rarc) => buildModel(rarc, `bdl/wallbom.bdl`));
    else if (actor.name === 'Canon') fetchArchive(`Bomber.arc`).then((rarc) => buildModel(rarc, `bdl/vcank.bdl`));
    else if (actor.name === 'Aygr') fetchArchive(`Aygr.arc`).then((rarc) => {
        buildModel(rarc, `bdl/aygr.bdl`);
        buildModel(rarc, `bdl/aygrh.bdl`);
    });
    else if (actor.name === 'Ayush') fetchArchive(`Ayush.arc`).then((rarc) => buildModel(rarc, `bdlm/ayush.bdl`).bindTTK1(parseBTK(rarc, `btk/ayush.btk`)));
    else if (actor.name === 'Ikada') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikae.bdl`));
    else if (actor.name === 'ikadaS') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikah.bdl`));
    else if (actor.name === 'Oship') fetchArchive(`Oship.arc`).then((rarc) => buildModel(rarc, `bdl/vbtsp.bdl`));
    else if (actor.name === 'GiceL') fetchArchive(`GiceL.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdli/gicel00.bdl`);
        m.bindTTK1(parseBTK(rarc, `btk/gicel00_01.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gicel00.brk`));
    });
    else if (actor.name === 'Qdghd') fetchArchive(`Qdghd.arc`).then((rarc) => buildModel(rarc, `bdl/qdghd.bdl`));
    else if (actor.name === 'Qtkhd') fetchArchive(`Qtkhd.arc`).then((rarc) => buildModel(rarc, `bdl/qtkhd.bdl`));
    else if (actor.name === 'Ylsic') fetchArchive(`Ylsic.arc`).then((rarc) => buildModel(rarc, `bdl/ylsic.bdl`));
    else if (actor.name === 'Yllic') fetchArchive(`Yllic.arc`).then((rarc) => buildModel(rarc, `bdl/yllic.bdl`));
    else if (actor.name === 'Ykzyg') fetchArchive(`Ykzyg.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/qkzyg.bdl`).bindTTK1(parseBTK(rarc, `btk/qkzyg.btk`));
        // TODO(jstpierre): ymnkz00
    });
    else if (actor.name === 'Ygush00' || actor.name === 'Ygush01' || actor.name === 'Ygush02') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygush00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygush00.btk`)));
    else if (actor.name === 'Yboil00') fetchArchive(`Yboil.arc`).then((rarc) => buildModel(rarc, `bdlm/yboil00.bdl`).bindTTK1(parseBTK(rarc, `btk/yboil00.btk`)));
    else if (actor.name === 'Ygstp00') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygstp00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygstp00.btk`)));
    else if (actor.name === 'Ytrnd00') fetchArchive(`Trnd.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/ytrnd00.bdl`).bindTTK1(parseBTK(rarc, `btk/ytrnd00.btk`));
        buildModel(rarc, `bdlm/ywuwt00.bdl`).bindTTK1(parseBTK(rarc, `btk/ywuwt00.btk`));
    });
    else if (actor.name === 'Sarace') fetchArchive(`Sarace.arc`).then((rarc) => buildModel(rarc, `bdl/sa.bdl`));
    else if (actor.name === 'Ocloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)));
    // Triangle Island Statue: TODO(jstpierre): finish the submodels
    else if (actor.name === 'Doguu') fetchArchive(`Doguu.arc`).then((rarc) => {
        const which = actor.parameters & 0xFF;
        const bmtPaths = ['bmt/vgsmd.bmt', 'bmt/vgsmf.bmt', 'bmt/vgsmn.bmt'];
        const brkPaths = ['brk/vgsmd.brk', 'brk/vgsmf.brk', 'brk/vgsmn.brk'];
        const m = buildModelBMT(rarc, `bdlm/vgsma.bdl`, bmtPaths[which]);
        m.bindTRK1(parseBRK(rarc, brkPaths[which]));
    });
    // Outset Island
    else if (actor.name === 'Lamp') fetchArchive(`Lamp.arc`).then((rarc) => {
        const m = buildModel(rarc, `bmd/lamp_00.bmd`);
        const scale = 0.5;
        mat4.scale(m.modelMatrix, m.modelMatrix, [scale, scale, scale]);
    });
    else if (actor.name === 'MKoppu') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/koppu.bdl`));
    else if (actor.name === 'MOsara') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/osara.bdl`));
    else if (actor.name === 'MPot') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/pot.bdl`));
    else if (actor.name === 'Branch') fetchArchive(`Kwood_00.arc`).then((rarc) => buildModel(rarc, `bmdc/ws.bmd`));
    else if (actor.name === 'Otble') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otable.bdl`));
    else if (actor.name === 'OtbleL') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otablel.bdl`));
    else if (actor.name === 'AjavW') {
        fetchArchive(`AjavW.arc`).then(rarc => {
            const m = buildModel(rarc, `bdlm/ajavw.bdl`);
            m.lightTevColorType = LightTevColorType.BG1;
            m.bindTTK1(parseBTK(rarc, `btk/ajavw.btk`));
        });
    } else if (actor.name === 'Vdora') fetchArchive(`Vdora.arc`).then((rarc) => buildModel(rarc, `bdl/vdora.bdl`));
    // Windfall Island
    else if (actor.name === 'Roten2') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten02.bdl`));
    else if (actor.name === 'Roten3') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten03.bdl`));
    else if (actor.name === 'Roten4') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten04.bdl`));
    else if (actor.name === 'Fdai') fetchArchive(`Fdai.arc`).then((rarc) => buildModel(rarc, `bdl/fdai.bdl`));
    else if (actor.name === 'GBoard') fetchArchive(`Kaisen_e.arc`).then((rarc) => buildModel(rarc, `bdl/akbod.bdl`));
    else if (actor.name === 'Nzfall') fetchArchive(`Pfall.arc`).then((rarc) => buildModel(rarc, `bdl/nz.bdl`).bindANK1(parseBCK(rarc, `bcks/nz_wait.bck`)));
    else if (actor.name === 'Paper') fetchArchive(`Opaper.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/opaper.bdl`);
        mat4.rotateX(m.modelMatrix, m.modelMatrix, Math.PI / 2);
    });
    else if (actor.name === 'Cafelmp') fetchArchive(`Cafelmp.arc`).then((rarc) => buildModel(rarc, `bdl/ylamp.bdl`));
    else if (actor.name === 'Pbka') fetchArchive(`Pbka.arc`).then((rarc) => buildModel(rarc, `bdl/pbka.bdl`));
    else if (actor.name === 'Plant') fetchArchive(`Plant.arc`).then((rarc) => buildModel(rarc, `bdl/yrmwd.bdl`));
    else if (actor.name === 'Table') fetchArchive(`Table.arc`).then((rarc) => buildModel(rarc, `bdl/ytble.bdl`));
    else if (actor.name === 'Ppos') fetchArchive(`Ppos.arc`).then((rarc) => buildModel(rarc, `bdl/ppos.bdl`));
    else if (actor.name === 'Rflw') fetchArchive(`Rflw.arc`).then((rarc) => buildModel(rarc, `bdl/phana.bdl`));
    else if (actor.name === 'Skanran') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/skanran.bdl`));
    else if (actor.name === 'Stoudai') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/stoudai.bdl`));
    // Pirate stuff
    else if (actor.name === 'Pirates') fetchArchive(`Kaizokusen.arc`).then((rarc) => buildModel(rarc, `bdl/oba_kaizoku_a.bdl`));
    else if (actor.name === 'Ashut') fetchArchive(`Ashut.arc`).then((rarc) => buildModel(rarc, `bdl/ashut.bdl`));
    else if (actor.name === 'Ospbox') fetchArchive(`Ospbox.arc`).then((rarc) => buildModel(rarc, `bdl/ospbox.bdl`));
    // The platforms in the pirate ship which go up and down.
    else if (actor.name === 'Hlift') fetchArchive(`Hlift.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hlift.bdl`);
        m.modelMatrix[13] += 350;
    });
    else if (actor.name === 'Hliftb') fetchArchive(`Hlift.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hliftb.bdl`);
        m.modelMatrix[13] += 300;
    });
    // Beedle's Ship
    else if (actor.name === 'Ptco') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptco.bdl`));
    else if (actor.name === 'Ptcu') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptcu.bdl`));
    // Forsaken Fortress
    else if (actor.name === 'Gaship1') fetchArchive(`GaShip.arc`).then((rarc) => buildModel(rarc, `bdl/gaship.bdl`));
    else if (actor.name === 'Gaship2') fetchArchive(`YakeRom.arc`).then((rarc) => buildModel(rarc, `bdl/yakerom.bdl`));
    else if (actor.name === 'dmgroom') fetchArchive(`dmgroom.arc`).then((rarc) => buildModel(rarc, `bdlm/dmgroom.bdl`));
    else if (actor.name === 'nezuana') fetchArchive(`Nzg.arc`).then((rarc) => buildModel(rarc, `bdl/kana_00.bdl`));
    else if (actor.name === 'Shmrgrd') fetchArchive(`Shmrgrd.arc`).then((rarc) => buildModel(rarc, `bdl/shmrgrd.bdl`));
    else if (actor.name === 'ATdoor') fetchArchive(`Atdoor.arc`).then((rarc) => buildModel(rarc, `bdl/sdoor01.bdl`));
    else if (actor.name === 'Search') fetchArchive(`Search.arc`).then((rarc) => buildModel(rarc, `bdl/s_search.bdl`));
    else if (actor.name === 'Ikari') fetchArchive(`Ikari.arc`).then((rarc) => buildModel(rarc, `bdl/s_ikari2.bdl`));
    else if (actor.name === 'SMtoge') fetchArchive(`Mtoge.arc`).then((rarc) => buildModel(rarc, `bmd/s_mtoge.bmd`));
    // Dragon Roost Island
    else if (actor.name === 'BFlower' || actor.name === 'VbakH') fetchArchive(`VbakH.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/vbakh.bdl`);
        buildModel(rarc, `bdlm/vbakm.bdl`);
    });
    else if (actor.name === 'Rcloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)))
    else if (actor.name === 'TrFlag') fetchArchive(`Trflag.arc`).then((rarc) => buildModel(rarc, `bdl/ethata.bdl`));
    else if (actor.name === 'Piwa') fetchArchive(`Piwa.arc`).then((rarc) => buildModel(rarc, `bdl/piwa.bdl`));
    else if (actor.name === 'Gryw00') fetchArchive(`Gryw00.arc`).then((rarc) => buildModel(rarc, `bdlm/gryw00.bdl`));
    else if (actor.name === 'Eayogn') fetchArchive(`Eayogn.arc`).then((rarc) => buildModel(rarc, `bdl/eayogn.bdl`));
    else if (actor.name === 'Mswing') fetchArchive(`Msw.arc`).then((rarc) => buildModel(rarc, `bdl/mswng.bdl`));
    else if (actor.name === 'Dsaku') fetchArchive(`Knsak_00.arc`).then((rarc) => buildModel(rarc, `bdl/knsak_00.bdl`));
    else if (actor.name === 'Ksaku') fetchArchive(`Ksaku_00.arc`).then((rarc) => buildModel(rarc, `bdl/ksaku_00.bdl`));
    else if (actor.name === 'Mflft') fetchArchive(`Mflft.arc`).then((rarc) => buildModel(rarc, `bdl/mflft.bdl`));
    else if (actor.name === 'Yfire00') fetchArchive(`Yfire_00.arc`).then((rarc) => {
        buildModel(rarc, `bmdm/yfire_00.bmd`);
        buildModel(rarc, `bmdm/yfirb_00.bmd`).bindTTK1(parseBTK(rarc, `btk/yfirb_00.btk`));
    });
    else if (actor.name === 'Zenfire') {
        // Create particle emitters
        const burningGroundEmitter = createEmitter(renderer, 0x461);
        const ringOfFlamesEmitter = createEmitter(renderer, 0x462);
        setModelMatrix(scratchMat4a);
        vec3.set(scratchVec3a, 0, 0, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMat4a);
        vec3.copy(burningGroundEmitter.globalTranslation, scratchVec3a);
        vec3.copy(ringOfFlamesEmitter.globalTranslation, scratchVec3a);
    }
    // Forest Haven
    else if (actor.name === 'Ohatch') fetchArchive(`Ohatch.arc`).then((rarc) => buildModel(rarc, `bdl/ohatch.bdl`));
    else if (actor.name === 'Ojtree') fetchArchive(`Ojtree.arc`).then((rarc) => buildModel(rarc, `bdl/ojtree.bdl`));
    else if (actor.name === 'Olift') fetchArchive(`Olift.arc`).then((rarc) => buildModel(rarc, `bdl/olift.bdl`));
    else if (actor.name === 'itemDek') fetchArchive(`Deku.arc`).then((rarc) => buildModel(rarc, `bdlm/vlfdm.bdl`));
    else if (actor.name === 'ho') fetchArchive(`Ff.arc`).then((rarc) => {
        const fireflyModel = buildModel(rarc, `bmd/ho.bmd`);
        fireflyModel.bindTRK1(parseBRK(rarc, `brk/ho.brk`));
        const glowModel = buildChildModel(rarc, `bmd/hop.bmd`);
        glowModel.setParentJoint(fireflyModel, `ho_B`);
        glowModel.bindTRK1(parseBRK(rarc, `brk/hop.brk`));
        mat4.translate(fireflyModel.modelMatrix, fireflyModel.modelMatrix, [0, 50, 0]);
    });
    else if (actor.name === 'jbaba') fetchArchive(`Jbo.arc`).then((rarc) => buildModel(rarc, `bmdm/jh.bmd`));
    else if (actor.name === 'VigaH') fetchArchive(`VigaH.arc`).then((rarc) => buildModel(rarc, `bdl/vigah.bdl`));
    else if (actor.name === 'Ss') fetchArchive(`Ss.arc`).then((rarc) => buildModel(rarc, `bdl/sw.bdl`));
    else if (actor.name === 'Sss') fetchArchive(`Sss.arc`).then((rarc) => buildModel(rarc, `bmd/sss_hand.bmd`));
    else if (actor.name === 'Turu') fetchArchive(`Sk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_00.bdl`));
    else if (actor.name === 's_turu') fetchArchive(`Ssk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_02.bdl`));
    else if (actor.name === 'Turu2') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_00.bdl`));
    else if (actor.name === 'Turu3') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_01.bdl`));
    else if (actor.name === 'Kita') fetchArchive(`kita.arc`).then((rarc) => buildModel(rarc, `bdl/vhlif_00.bdl`));
    else if (actor.name === 'Klft') fetchArchive(`Klft.arc`).then((rarc) => buildModel(rarc, `bdlm/lift_00.bdl`));
    else if (actor.name === 'Kokiie') fetchArchive(`Kokiie.arc`).then((rarc) => buildModel(rarc, `bdl/koki_00.bdl`));
    else if (actor.name === 'Vpbot') fetchArchive(`Vpbot_00.arc`).then((rarc) => buildModel(rarc, `bdl/vpbot_00.bdl`));
    else if (actor.name === 'Vochi') fetchArchive(`Vochi.arc`).then((rarc) => buildModel(rarc, `bdl/vochi.bdl`));
    else if (actor.name === 'Kanat') fetchArchive(`Kanat.arc`).then((rarc) => buildModel(rarc, `bdl/kanat.bdl`));
    else if (actor.name === 'Kryu00') fetchArchive(`Kryu.arc`).then((rarc) => buildModel(rarc, `bdl/ryu_00.bdl`));
    // Tower of the Gods
    else if (actor.name === 'X_tower') fetchArchive(`X_tower.arc`).then((rarc) => buildModel(rarc, `bdl/x_tower.bdl`));
    else if (actor.name === 'Wall') fetchArchive(`Hbw1.arc`).then((rarc) => buildModel(rarc, `bdl/hbw1.bdl`));
    else if (actor.name === 'Hmon1d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon1.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon1.brk`)));
    else if (actor.name === 'Hmon2d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon2.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon2.brk`)));
    else if (actor.name === 'Hmos1') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos1.bdl`));
    else if (actor.name === 'Hmos2') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos2.bdl`));
    else if (actor.name === 'Hmos3') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos3.bdl`));
    else if (actor.name === 'amos') fetchArchive(`Am.arc`).then((rarc) => buildModel(rarc, `bdl/am.bdl`));
    else if (actor.name === 'amos2') fetchArchive(`Am2.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/am2.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/wait.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/am2.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/am2.brk`));
    });
    else if (actor.name === 'Hha') fetchArchive(`Hha.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/hha1.bdl`);
        buildModel(rarc, `bdlm/hha2.bdl`);
    });
    else if (actor.name === 'Gkai00') fetchArchive(`Gkai00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gkai00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gkai00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/gkai00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gkai00.btk`));
    });
    else if (actor.name === 'Gbrg00') fetchArchive(`Gbrg00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gbrg00.bdl`);
        m.bindTRK1(parseBRK(rarc, `brk/gbrg00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gbrg00.btk`));
    });
    else if (actor.name === 'Humi0z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi0.bdl`).bindTTK1(parseBTK(rarc, `btk/humi0.btk`)));
    else if (actor.name === 'Humi2z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi2.bdl`).bindTTK1(parseBTK(rarc, `btk/humi2.btk`)));
    else if (actor.name === 'Humi3z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi3.bdl`).bindTTK1(parseBTK(rarc, `btk/humi3.btk`)));
    else if (actor.name === 'Humi4z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi4.bdl`).bindTTK1(parseBTK(rarc, `btk/humi4.btk`)));
    else if (actor.name === 'Humi5z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi5.bdl`).bindTTK1(parseBTK(rarc, `btk/humi5.btk`)));
    else if (actor.name === 'Htetu1') fetchArchive(`Htetu1.arc`).then((rarc) => buildModel(rarc, `bdl/htetu1.bdl`));
    else if (actor.name === 'Htobi1') fetchArchive(`Htobi1.arc`).then((rarc) => buildModel(rarc, `bdl/htobi1.bdl`));
    else if (actor.name === 'Hmlif') fetchArchive(`Hmlif.arc`).then((rarc) => buildModel(rarc, `bdlm/hmlif.bdl`));
    else if (actor.name === 'Hdai1') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hdai2') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hdai3') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hsh') fetchArchive(`Hsehi1.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi1.bdl`));
    else if (actor.name === 'Hsh2') fetchArchive(`Hsehi2.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi2.bdl`));
    else if (actor.name === 'Hyuf1') fetchArchive(`Hyuf1.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf1.bdl`));
    else if (actor.name === 'Hyuf2') fetchArchive(`Hyuf2.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf2.bdl`));
    else if (actor.name === 'Blift') fetchArchive(`Hten1.arc`).then((rarc) => buildModel(rarc, `bdl/hten1.bdl`));
    else if (actor.name === 'Hcbh') fetchArchive(`Hcbh.arc`).then((rarc) => {
        buildModel(rarc, `bdl/hcbh1a.bdl`);
        buildModel(rarc, `bdl/hcbh1b.bdl`);
        buildModel(rarc, `bdl/hcbh1c.bdl`);
        buildModel(rarc, `bdl/hcbh1d.bdl`);
        buildModel(rarc, `bdl/hcbh2.bdl`);
    });
    else if (actor.name === 'Hfbot1B') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (actor.name === 'Hfbot1C') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (actor.name === 'Hys') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (actor.name === 'Hys2') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (actor.name === 'Ywarp00') fetchArchive(`Ywarp00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bmdm/ywarp00.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/ywarp00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/ywarp00.brk`));
    });
    // Hyrule.
    else if (actor.name === 'YLzou') fetchArchive(`YLzou.arc`).then((rarc) => buildModel(rarc, `bdl/ylzou.bdl`));
    else if (actor.name === 'MtryB') fetchArchive(`MtryB.arc`).then((rarc) => buildModel(rarc, `bdl/mtryb.bdl`));
    else if (actor.name === 'zouK' || actor.name === 'zouK1' || actor.name === 'zouK2' || actor.name === 'zouK3' || actor.name === 'zouK4') fetchArchive(`VzouK.arc`).then((rarc) => buildModel(rarc, `bdl/vzouk.bdl`));
    else if (actor.name === 'VmsDZ') fetchArchive(`VmsDZ.arc`).then((rarc) => buildModel(rarc, `bdl/vmsdz.bdl`));
    else if (actor.name === 'VmsMS') fetchArchive(`VmsMS.arc`).then((rarc) => buildModel(rarc, `bdl/vmsms.bdl`));
    else if (actor.name === 'Yswdr00') fetchArchive(`Yswdr00.arc`).then((rarc) => buildModel(rarc, `bdlm/yswdr00.bdl`).bindTTK1(parseBTK(rarc, `btk/yswdr00.btk`)));
    // Earth Temple.
    else if (actor.name === 'MhmrSW0') fetchArchive(`MhmrSW.arc`).then((rarc) => buildModel(rarc, `bdl/mhmrsw.bdl`));
    else if (actor.name === 'Vds') fetchArchive(`Vds.arc`).then((rarc) => {
        const rightHalfModel = buildModel(rarc, `bdlm/vdswt0.bdl`);
        rightHalfModel.bindANK1(parseBCK(rarc, `bck/vdswt0.bck`));
        rightHalfModel.bindTRK1(parseBRK(rarc, `brk/vdswt0.brk`));
        const leftHalfModel = buildModel(rarc, `bdlm/vdswt1.bdl`);
        leftHalfModel.bindANK1(parseBCK(rarc, `bck/vdswt1.bck`));
        leftHalfModel.bindTRK1(parseBRK(rarc, `brk/vdswt1.brk`));
    });
    else if (actor.name === 'MsuSWB') fetchArchive(`Mmirror.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/msusw.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/msusw.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/msusw.btk`));
    });
    // Nintendo Gallery
    else if (actor.name === 'Figure') {
        fetchArchive(`Figure.arc`).then((rarc) => buildModel(rarc, `bdlm/vf_bs.bdl`))
        const figureId = actor.parameters & 0x000000FF;
        const baseFilename = `vf_${leftPad(''+figureId, 3)}`;
        const base = `bdl/${baseFilename}`;

        // Outset Island
        if (figureId >= 0x00 && figureId <= 0x0D) fetchArchive(`Figure0.arc`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Windfall Island
        else if (figureId >= 0x0E && figureId <= 0x28) fetchArchive(`Figure1.arc`).then((rarc) => {
            if (figureId === 16 || figureId === 18) {
                buildModel(rarc, `${base}b.bdl`).modelMatrix[13] += 100;
            } else {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            }
        });
        else if (figureId >= 0x29 && figureId <= 0x40) fetchArchive(`Figure2.arc`).then((rarc) => {
            // Nintendo is REALLY cool.
            if (figureId === 61) {
                buildModel(rarc, `bdlm/${baseFilename}.bdl`).modelMatrix[13] += 100;
            } else {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            }

            // TODO(jstpierre): What are Figure2a/b for? 
            // fetchArchive(`Figure2a.arc`).then((rarc) => console.log("2a", rarc));
            // fetchArchive(`Figure2b.arc`).then((rarc) => console.log("2b", rarc));
        });
        // Dragon Roost Island
        else if (figureId >= 0x41 && figureId <= 0x52) fetchArchive(`Figure3.arc`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Forest Haven
        else if (figureId >= 0x53 && figureId <= 0x60) fetchArchive(`Figure4.arc`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Secret Cavern
        else if (figureId >= 0x61 && figureId <= 0x73) fetchArchive(`Figure5.arc`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Forsaken Fortress
        else if (figureId >= 0x74 && figureId <= 0xFF) fetchArchive(`Figure6.arc`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
    }
    else {
        return false;
    }

    return true;
}

function aup(modelInstance: J3DModelInstanceSimple): void {
    for (let i = 0; i < modelInstance.materialInstances.length; i++)
        modelInstance.materialInstances[i].setAlphaWriteEnabled(false);
}

function setToNearestFloor(roomRenderer: WindWakerRoomRenderer, dstMatrix: mat4, localModelMatrix: mat4) {
    mat4.getTranslation(scratchVec3a, localModelMatrix);
    vec3.set(scratchVec3b, 0, -1, 0);
    const found = DZB.raycast(scratchVec3b, roomRenderer.dzb, scratchVec3a, scratchVec3b);
    if (found)
        dstMatrix[13] = scratchVec3b[1];
}

function computeActorMatrix(m: mat4, actor: Actor): void {
    computeModelMatrixSRT(m,
        actor.scale[0], actor.scale[1], actor.scale[2],
        0, actor.rotationY, 0,
        actor.pos[0], actor.pos[1], actor.pos[2]);
}

class NormalArrowProgram {
    public static ub_SceneParams = 0;

    public both = `
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_BoneMatrix[1];
    vec4 u_LightDirection;
    vec4 u_Color[2];
};
`;

    public vert: string = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;

out vec3 v_Normal;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Normal = normalize(Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Normal, 0.0)).xyz);
}
`;

    public frag: string = `
in vec3 v_Normal;

void main() {
    float t_LightIntensity = max(dot(v_Normal, normalize(u_LightDirection.xyz)), 0.0);
    vec4 t_Color = mix(u_Color[0], u_Color[1], t_LightIntensity);
    if (t_Color.a <= 0.1)
        discard;
    gl_FragColor.rgba = t_Color;
}
`;
}

function modm(n: number, a: number, m: number): number {
    if (n >= a+m)
        return a+(n-a)%m;
    else
        return n;
}

class NormalArrowData {
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    @UI.dfHide()
    private indexCount: number;
    private program: GfxProgramDescriptorSimple;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    public arrowLightAmount: number = 1.0;
    public arrowColor: Color = colorNew(0.8, 1.0, 1.5);
    @UI.dfRange(0, 10, 0.01)
    public baseScale = 0.3;
    @UI.dfRange(3, 24, 1)
    public numSegments = 16;
    @UI.dfRange(0, 100, 0.01)
    public tailHeight = 10;
    @UI.dfRange(0, 100, 0.01)
    public coneHeight = 6;
    @UI.dfRange(0, 32, 0.01)
    public tailWidth = 1;
    @UI.dfRange(0, 32, 0.01)
    public coneWidth = 3;
    @UI.dfRange(0, 100, 0.01)
    public gapHeight = 0;

    constructor(private device: GfxDevice, private cache: GfxRenderCache) {
        this.program = preprocessProgramObj_GLSL(device, new NormalArrowProgram());

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, }, // Position
            { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 3*0x04, }, // Normal
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 6*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.BACK;

        this.generate();

        const observer = new Proxy(this, { set: (obj, prop, value) => {
            (obj as any)[prop] = value;
            if (prop === 'numSegments')
                this.generate();
            return true;
        }});
        return observer;
    }

    private generate(): void {
        const numSegments = this.numSegments;

        const vertexData = new Float32Array((numSegments * 4) * 6);
        const indexData = new Uint16Array(numSegments * 5 * 3);
        this.indexCount = indexData.length;

        const y0 = 0, y1 = 1;

        let offs: number;

        for (let i = 0; i < numSegments; i++) {
            const theta = MathConstants.TAU * (i / numSegments);
            const sin = Math.sin(theta), cos = Math.cos(theta);

            // tail bottom
            const tailBottomIdx = (numSegments * 0 + i);
            offs = tailBottomIdx * 6;
            vertexData[offs++] = y0;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;
            // normal
            vertexData[offs++] = 0;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;

            // tail top
            const tailTopIdx = (numSegments * 1 + i);
            offs = tailTopIdx * 6;
            vertexData[offs++] = y1;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;
            // normal
            vertexData[offs++] = 0;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;

            // cone bottom
            const coneBottomIdx = (numSegments * 2 + i);
            offs = coneBottomIdx * 6;
            vertexData[offs++] = 0;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;
            // normal
            vertexData[offs++] = 0;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;
            // cone top
            const coneTopIdx = (numSegments * 3 + i);
            offs = coneTopIdx * 6;
            vertexData[offs++] = y1;
            vertexData[offs++] = 0;
            vertexData[offs++] = 0;
            // normal
            vertexData[offs++] = 0.6;
            vertexData[offs++] = cos;
            vertexData[offs++] = sin;

            // tail triangles
            offs = ((numSegments * 0 * 2) + (i * 2)) * 3;
            indexData[offs++] = tailBottomIdx + 0;
            indexData[offs++] = tailTopIdx + 0;
            indexData[offs++] = modm(tailBottomIdx + 1, numSegments*0, numSegments);
            indexData[offs++] = modm(tailBottomIdx + 1, numSegments*0, numSegments);
            indexData[offs++] = tailTopIdx + 0;
            indexData[offs++] = modm(tailTopIdx + 1, numSegments*1, numSegments);
            // shield triangles
            offs = ((numSegments * 1 * 2) + (i * 2)) * 3;
            indexData[offs++] = tailTopIdx + 0;
            indexData[offs++] = coneBottomIdx + 0;
            indexData[offs++] = modm(tailTopIdx + 1, numSegments*1, numSegments);
            indexData[offs++] = modm(tailTopIdx + 1, numSegments*1, numSegments);
            indexData[offs++] = coneBottomIdx + 0;
            indexData[offs++] = modm(coneBottomIdx + 1, numSegments*2, numSegments);
            // cone triangles
            offs = ((numSegments * 2 * 2) + (i * 1)) * 3;
            indexData[offs++] = coneBottomIdx + 0;
            indexData[offs++] = coneTopIdx + 0;
            indexData[offs++] = modm(coneBottomIdx + 1, numSegments*2, numSegments);
        }

        const device = this.device;

        if (this.vertexBuffer !== undefined)
            device.destroyBuffer(this.vertexBuffer);
        if (this.indexBuffer !== undefined)
            device.destroyBuffer(this.indexBuffer);
        if (this.inputState !== undefined)
            device.destroyInputState(this.inputState);

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        const gfxProgram = cache.createProgramSimple(device, this.program);
        renderInst.setBindingLayouts([{ numSamplers: 0, numUniformBuffers: 1 }]);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.setMegaStateFlags(this.megaStateFlags);
    }

    public drawTail(renderInst: GfxRenderInst): void {
        renderInst.drawIndexes(this.numSegments * 4 * 3, 0);
    }

    public drawCone(renderInst: GfxRenderInst): void {
        renderInst.drawIndexes(this.numSegments * 1 * 3, this.numSegments * 4 * 3);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

const aeanim = bezier(0.8, 0.0, 0.2, 1.0);

type Callback = (t: number) => boolean | void;

function forever(): Promise<void> {
    return new Promise(() => {});
}

class animsched {
    public time = 0;
    public idx = 0;
    public test = -1;

    public callbacks: Callback[] = [];

    public reset(): void {
        this.time = 0;
        this.idx = 0;
        this.callbacks.length = 0;
    }

    public update(dt: number): void {
        for (let i = this.callbacks.length - 1; i >= 0; i--)
            this.callbacks[i](dt);
    }

    private animate(duration: number, callback: Callback): Promise<void> {
        let time = 0;
        return new Promise((resolve, reject) => {
            const cb = (dt: number) => {
                time += dt;
                const t = time / duration;
                const res = callback(clamp(t, 0.0, 1.0));
                if (res === false || t > 1.0) {
                    this.callbacks.splice(this.callbacks.indexOf(cb), 1);
                    resolve();
                }
            };
            this.callbacks.push(cb);
        });
    }

    private wait(duration: number): Promise<void> {
        return this.animate(duration, () => {});
    }

    public async anim(startTimeInSeconds: number, durationInSeconds: number, callback: Callback): Promise<void> {
        const startTime = startTimeInSeconds * 1000, duration = durationInSeconds * 1000;

        if (this.test > -1) {
            const thisidx = this.idx++;
            if (thisidx === this.test) {
                this.time = startTime;
            } else if (thisidx < this.test) {
                callback(1.0);
                return;
            } else {
                await forever();
            }
        }

        const waitTime = startTime - this.time;
        assert(waitTime >= 0);
        if (waitTime > 0)
            await this.wait(waitTime);
        await this.animate(duration, callback);
        this.time = startTime + duration;
    }
}

const posArr = nArray(1024, () => vec3.create());
const nrmArr = nArray(1024, () => vec3.create());

function colorMultLerp(dst: Color, a: Color, b: Color, t: number): void {
    colorMult(dst, a, b);
    colorLerp(dst, a, dst, t);
}

const enum LinkMatMode { vlight, toonify, paletteify }
const scratchColor = colorNewCopy(White);
const scratchMatrix = mat4.create();
class LinkThing extends BMDObjectRenderer {
    public bodyMatInsts: MaterialInstance[] = [];
    private wireDepth = 0.0;
    private posAmt = 0.0;
    private posTime = 0.0;
    private txcAmt = 0.0;
    private colorAmt = 0.0;
    private wireBlendWhite = 0.0;
    private wireClip = 1.5;
    private normalArrowData: NormalArrowData;
    private animsched = new animsched();

    public arrowCallback: ((modelViewMatrix: mat4, pos: vec3, nrm: vec3) => void) | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, modelInstance: J3DModelInstanceSimple) {
        super(modelInstance);

        this.modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 5, false);

        this.setupDam('eyeL');
        this.setupDam('eyeR');
        this.setupDam('mayuL');
        this.setupDam('mayuR');

        this.bodyMatInsts = this.modelInstance.materialInstances.filter((g) => !g.name.startsWith('eye') && !g.name.startsWith('mayu'));

        this.normalArrowData = new NormalArrowData(device, cache);
        this.normalArrowData.baseScale = 0.0;

        this.setMode(LinkMatMode.vlight);
    }

    private patchMat(inst: MaterialInstance, mode: LinkMatMode): void {
        const m = inst.materialHelper.material;
        // m.tevStages.length = 1;
        if (mode === LinkMatMode.vlight) {
            // Vertex Lighting.
            m.tevStages[0].colorInA = CombineColorInput.ZERO;
            m.tevStages[0].colorInB = CombineColorInput.ONE;
            m.tevStages[0].colorInC = CombineColorInput.RASC;
            m.tevStages[0].channelId = RasColorChannelID.COLOR0A0;
            m.tevStages[0].rasSwapTable = [TevColorChan.R, TevColorChan.R, TevColorChan.R, TevColorChan.R];
        } else if (mode === LinkMatMode.toonify) {
            // Toonification
            m.tevStages[0].colorInA = CombineColorInput.ZERO;
            m.tevStages[0].colorInB = CombineColorInput.ONE;
            m.tevStages[0].colorInC = CombineColorInput.TEXC;
        } else if (mode === LinkMatMode.paletteify) {
            m.tevStages[0].colorInA = CombineColorInput.C0;
            m.tevStages[0].colorInB = CombineColorInput.KONST;
            m.tevStages[0].colorInC = CombineColorInput.TEXC;
        }
        inst.materialHelper.createProgram();
    }

    public setMode(mode: LinkMatMode): void {
        this.bodyMatInsts.forEach((v) => this.patchMat(v, mode));
    }

    private prepareToRenderArrow(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelViewMatrix: mat4): void {
        const data = this.normalArrowData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = WindWakerPass.MAIN;
        template.sortKey = makeSortKeyTranslucent(GfxRendererLayer.TRANSLUCENT + 5);
        data.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        {
            mat4.copy(scratchMat4a, modelViewMatrix);

            vec3.set(scratchVec3a, data.baseScale * (data.gapHeight), 0, 0);
            mat4.translate(scratchMat4a, scratchMat4a, scratchVec3a);
    
            vec3.set(scratchVec3a,
                data.baseScale * data.tailHeight,
                data.baseScale * data.tailWidth,
                data.baseScale * data.tailWidth);
            mat4.scale(scratchMat4a, scratchMat4a, scratchVec3a);

            const renderInst = renderInstManager.pushRenderInst();
            data.drawTail(renderInst);
            let offs = renderInst.allocateUniformBuffer(NormalArrowProgram.ub_SceneParams, 16+12+4+4*2);
            const d = renderInst.mapUniformBufferF32(NormalArrowProgram.ub_SceneParams);

            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
            offs += fillMatrix4x3(d, offs, scratchMat4a);
            offs += fillVec3v(d, offs, this.modelInstance.getGXLightReference(0).Position);
            colorMultLerp(scratchColor, data.arrowColor, this.modelInstance.materialInstanceState.colorOverrides[ColorKind.C0], data.arrowLightAmount);
            offs += fillColor(d, offs, scratchColor);
            colorMultLerp(scratchColor, data.arrowColor, this.modelInstance.materialInstanceState.colorOverrides[ColorKind.K0], data.arrowLightAmount);
            offs += fillColor(d, offs, scratchColor);
        }

        {
            mat4.copy(scratchMat4a, modelViewMatrix);

            vec3.set(scratchVec3a, data.baseScale * (data.gapHeight + data.tailHeight), 0, 0);
            mat4.translate(scratchMat4a, scratchMat4a, scratchVec3a);

            vec3.set(scratchVec3a,
                data.baseScale * data.coneHeight,
                data.baseScale * data.coneWidth,
                data.baseScale * data.coneWidth);
            mat4.scale(scratchMat4a, scratchMat4a, scratchVec3a);

            const renderInst = renderInstManager.pushRenderInst();
            data.drawCone(renderInst);
            let offs = renderInst.allocateUniformBuffer(NormalArrowProgram.ub_SceneParams, 16+12+4+4*2);
            const d = renderInst.mapUniformBufferF32(NormalArrowProgram.ub_SceneParams);

            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
            offs += fillMatrix4x3(d, offs, scratchMat4a);
            offs += fillVec3v(d, offs, this.modelInstance.getGXLightReference(0).Position);
            colorMultLerp(scratchColor, data.arrowColor, this.modelInstance.materialInstanceState.colorOverrides[ColorKind.C0], data.arrowLightAmount);
            offs += fillColor(d, offs, scratchColor);
            colorMultLerp(scratchColor, data.arrowColor, this.modelInstance.materialInstanceState.colorOverrides[ColorKind.K0], data.arrowLightAmount);
            offs += fillColor(d, offs, scratchColor);
        }

        renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderArrows(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, i: number): void {
        const nv = this.modelInstance.shapeInstances[i].skinCPU(posArr, nrmArr, this.modelInstance.shapeInstanceState);
        for (let i = 0; i < nv; i++) {
            const p = posArr[i];
            const n = nrmArr[i];
            const yaw = Math.atan2(n[1], n[0]);
            const pitch = Math.atan2(n[2], Math.hypot(n[0], n[1]));

            computeModelMatrixSRT(scratchMatrix,
                1.0, 1.0, 1.0,
                0, -pitch, yaw,
                p[0], p[1], p[2]);

            if (this.arrowCallback !== null)
                this.arrowCallback(scratchMatrix, p, n);

            this.prepareToRenderArrow(device, renderInstManager, viewerInput, scratchMatrix);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.animsched.update(viewerInput.deltaTime);

        const l7 = this.modelInstance.getGXLightReference(7);
        l7.DistAtten[0] = viewerInput.time / 1000;
        l7.DistAtten[1] = this.posAmt;
        l7.DistAtten[2] = this.posTime;
        l7.CosAtten[0] = 1.0 - this.wireDepth;
        l7.CosAtten[1] = this.colorAmt;
        l7.CosAtten[2] = this.txcAmt;

        const l6 = this.modelInstance.getGXLightReference(6);
        l6.DistAtten[1] = this.wireBlendWhite;
        l6.DistAtten[2] = this.wireClip;

        super.prepareToRender(device, renderInstManager, viewerInput);

        this.prepareToRenderArrows(device, renderInstManager, viewerInput, 0);
        this.prepareToRenderArrows(device, renderInstManager, viewerInput, 1);
        this.prepareToRenderArrows(device, renderInstManager, viewerInput, 2);
        this.prepareToRenderArrows(device, renderInstManager, viewerInput, 4);
    }

    private setupDam(pref: string): void {
        const matInstA = this.modelInstance.materialInstances.find((m) => m.name === `${pref}damA`)!;
        const matInstB = this.modelInstance.materialInstances.find((m) => m.name === `${pref}damB`)!;
        // Needs to render before Link.
        matInstA.setSortKeyLayer(GfxRendererLayer.OPAQUE + 4, false);
        matInstA.setColorWriteEnabled(false);
        matInstA.setAlphaWriteEnabled(true);
        matInstB.setSortKeyLayer(GfxRendererLayer.OPAQUE + 6, false);
        matInstB.setColorWriteEnabled(false);
        matInstB.setAlphaWriteEnabled(true);
    }

    public async animateVlight(test: number = -1): Promise<void> {
        this.setMode(LinkMatMode.vlight);

        const sch = this.animsched;
        sch.reset();
        sch.test = test;

        // reset defaults
        this.wireDepth = 0.0;
        this.posAmt = 0.0;
        this.posTime = 0.0;
        this.txcAmt = 0.0;
        this.colorAmt = 0.0;
        this.wireBlendWhite = 0.0;
        this.wireClip = 1.5;

        await sch.anim(12, 1, (t) => {
            this.wireDepth = lerp(0.7, 1.0, aeanim(t));
        });

        // "the individual points on these triangles"
        this.normalArrowData.arrowLightAmount = 0.0;
        this.normalArrowData.baseScale = 0.45;
        colorCopy(this.normalArrowData.arrowColor, White);
        this.normalArrowData.arrowColor.a = 0.0;

        this.normalArrowData.tailHeight = 0.0;
        this.normalArrowData.tailWidth = 0.0;
        this.normalArrowData.coneWidth = 5.0;
        this.normalArrowData.coneHeight = 0.0;

        {
            let arrowTime: number = 0;
            this.arrowCallback = (mtx) => {
                const key = (-mtx[12] + mtx[13]) / 100.0;
                const time = aeanim(clamp(lerp(-0.5, 1.2, arrowTime) + key, 0.0, 1.0));
                this.normalArrowData.arrowColor.a = time;
                this.normalArrowData.baseScale = lerp(0.45, 0.2, time);
                this.normalArrowData.tailHeight = lerp(10.0, 1.0, time);
            };
            await sch.anim(16.5, 2, (t) => {
                arrowTime = t;
            });
            this.arrowCallback = null;
        }

        // "each one has quite a bit of information"
        {
            this.normalArrowData.tailHeight = 1.0;
            await sch.anim(21, 1, (t) => {
                this.wireDepth = lerp(1.0, 0.98, aeanim(t));
                this.wireBlendWhite = lerp(0.0, 0.7, aeanim(t));
                this.wireClip = lerp(1.5, 30.0, aeanim(t));
                this.normalArrowData.arrowColor.a = lerp(1.0, 0.0, aeanim(t));
                this.normalArrowData.baseScale = lerp(0.2, 0.0, aeanim(t));
            });
        }

        this.posAmt = 10.0;
        await sch.anim(26, 2, (t) => {
            this.posTime = lerp(0.2, 2.8, t);
        });
        this.posAmt = 0.0;

        // texture coordinates
        this.txcAmt = 0.4;
        await sch.anim(29, 4, (t) => {
            const t2 = Math.sin(t * Math.PI);
            this.posTime = lerp(0.2, 2.4, t2);
        });
        this.txcAmt = 0.0;

        // additional color information
        await sch.anim(35.5, 1, (t) => {
            this.colorAmt = lerp(0.0, 0.8, aeanim(t));
        });
        await sch.anim(43.5, 1, (t) => {
            this.colorAmt = lerp(0.8, 0.0, aeanim(t));
        });

        // vertex normal
        {
            colorFromRGBA(this.normalArrowData.arrowColor, 0.8, 1.0, 1.5);
            this.normalArrowData.tailWidth = 1;
            this.normalArrowData.coneWidth = 3;
            this.normalArrowData.arrowLightAmount = 1.0;
            this.normalArrowData.gapHeight = 6;

            let arrowTime: number = 0;
            this.arrowCallback = (mtx) => {
                const key = (-mtx[12] + mtx[13]) / 100.0;
                const time = aeanim(clamp(lerp(-0.5, 1.2, arrowTime) + key, 0.0, 1.0));
                this.normalArrowData.baseScale = lerp(0.0, 0.3, time);
                this.normalArrowData.tailHeight = lerp(0.0, 10.0, time);
                this.normalArrowData.coneHeight = lerp(0.0, 6.0, time);
                this.normalArrowData.gapHeight = lerp(6.0, 3.0, time);
            };
            await sch.anim(46.5, 2, (t) => {
                arrowTime = t;
                this.wireBlendWhite = lerp(0.6, 0.0, aeanim(t));
            });
            this.arrowCallback = null;
        }

        {
            this.normalArrowData.baseScale = 0.3;
            this.normalArrowData.tailHeight = 10.0;
            this.normalArrowData.coneHeight = 6.0;
            this.normalArrowData.gapHeight = 3.0;

            let arrowTime = 0;
            let dotMul = 1;
            let dotMulCutoff = 0.8;
            let dotScaleMax = 2.0;
            const l0 = this.modelInstance.getGXLightReference(0);
            this.arrowCallback = (mtx, p, n) => {
                vec3.sub(scratchVec3a, l0.Position, p);
                vec3.normalize(scratchVec3a, scratchVec3a);
                const dot1 = clamp(vec3.dot(scratchVec3a, n), 0.0, 1.0);
                const dot = clamp((dot1 - dotMulCutoff) * dotMul + dotMulCutoff, 0.0, 1.0);
                const dotColor = lerp(0.4, 1.5, dot);
                const clr = this.normalArrowData.arrowColor;
                colorFromRGBA(clr, 0.8, 1.0, 1.5);
                clr.r = lerp(clr.r, clr.r * dotColor, arrowTime);
                clr.g = lerp(clr.g, clr.g * dotColor, arrowTime);
                clr.b = lerp(clr.b, clr.b * dotColor, arrowTime);
                clr.a = clamp(lerp(clr.a, clr.a *  lerp(0.0, 1.0, dot), arrowTime), 0.0, 1.0);
                const dotScale = lerp(0.4, 1.0, dot) * dotScaleMax;
                const t = aeanim(arrowTime);
                this.normalArrowData.tailWidth = lerp(1.0, 1.0 * dotScale, t);
                this.normalArrowData.coneHeight = lerp(6.0, 6.0 * dotScale, t);
                this.normalArrowData.coneWidth = lerp(3.0, 3.0 * dotScale, t);
                this.normalArrowData.gapHeight = lerp(3.0, Math.pow(3.0, dotScale), t);
            };
            await sch.anim(73.5, 1, (t) => {
                arrowTime = t;
            });

            await sch.anim(86, 1.5, (t) => {
                dotMul = lerp(1.0, 5.0, aeanim(t));
                dotScaleMax = lerp(2.0, 3.0, aeanim(t));
            });

            await sch.anim(88, 3, (t) => {
                this.lightPos[0] = lerp(-1e7, 1e7, aeanim(t));
                this.lightPos[1] = lerp(1.2e7, 1.2e7, aeanim(t));
                this.lightPos[2] = lerp(-2e7, 0, aeanim(t));
            });
            await sch.anim(91, 3, (t) => {
                this.lightPos[0] = lerp(1e7, -1e5, aeanim(t));
                this.lightPos[1] = lerp(1.2e7, -1.2e7, aeanim(t));
                this.lightPos[2] = lerp(0, -1e6, aeanim(t));
            });
        }
    }
}
