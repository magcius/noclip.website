
import * as Viewer from '../../viewer';
import * as GX_Material from '../../gx/gx_material';
import * as RARC from '../rarc';
import * as JPA from '../../Common/JSYSTEM/JPA';

import { mat4, vec3 } from "gl-matrix";
import { hexzero, leftPad } from '../../util';
import { J3DModelInstanceSimple, BMDModelMaterialData } from "../../Common/JSYSTEM/J3D/J3DGraphBase";
import { ANK1, BTK, BRK, BCK, TTK1, TRK1, LoopMode, BMT } from "../../Common/JSYSTEM/J3D/J3DLoader";
import AnimationController from "../../AnimationController";
import { KyankoColors, ZWWExtraTextures, WindWakerRenderer, WindWakerRoomRenderer, pathBase, WindWakerPass } from "./zww_scenes";
import { ColorKind } from "../../gx/gx_render";
import { AABB } from '../../Geometry';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../../Camera';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { colorFromRGBA } from '../../Color';
import { GfxRenderInstManager, GfxRendererLayer } from '../../gfx/render/GfxRenderer';

import { AGrass } from './Grass';

export interface ActorInfo { 
    relName: string, 
    subtype: number, 
    unknown1: number 
};

export interface Actor {
    name: string;
    info: ActorInfo; 
    parameters: number;
    roomIndex: number;
    layer: number;
    pos: vec3;
    scale: vec3;
    rotationY: number;
};

// Special-case actors

export const enum LightTevColorType {
    ACTOR = 0,
    BG0 = 1,
    BG1 = 2,
    BG2 = 3,
    BG3 = 4,
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();

// dScnKy_env_light_c::settingTevStruct
export function settingTevStruct(actor: J3DModelInstanceSimple, type: LightTevColorType, colors: KyankoColors): void {
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
    setKyankoColors(colors: KyankoColors): void;
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

    public setKyankoColors(colors: KyankoColors): void {
        settingTevStruct(this.modelInstance, this.lightTevColorType, colors);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setKyankoColors(colors);
    }

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
        GX_Material.lightSetWorldPosition(light, viewerInput.camera, 250, 250, 250);
        GX_Material.lightSetWorldDirection(light, viewerInput.camera, -250, -250, -250);
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

export async function spawnObjectsForActor(device: GfxDevice, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, name: string, parameters: number, layer: number, localModelMatrix: mat4, worldModelMatrix: mat4, actor: Actor): Promise<void> {
    // TODO(jstpierre): Better actor implementations
    const modelCache = renderer.modelCache;
    const roomIdx = roomRenderer.roomIdx;
    const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

    function fetchArchive(objArcName: string): Promise<RARC.RARC> {
        return renderer.modelCache.fetchArchive(`${pathBase}/Object/${objArcName}`);
    }

    function buildChildModel(rarc: RARC.RARC, modelPath: string): BMDObjectRenderer {
        const model = modelCache.getModel(device, cache, rarc, modelPath);
        const modelInstance = new J3DModelInstanceSimple(model);
        modelInstance.passMask = WindWakerPass.MAIN;
        renderer.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.name = name;
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        objectRenderer.layer = layer;
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
        objectRenderer.modelInstance.setModelMaterialData(new BMDModelMaterialData(device, cache, bmt));
        renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
        return objectRenderer;
    }

    function createEmitter(resourceId: number): JPA.JPABaseEmitter {
        const emitter = renderer.effectSystem!.createBaseEmitter(device, cache, resourceId);
        // TODO(jstpierre): Scale, Rotation
        return emitter;
    }

    function parseBCK(rarc: RARC.RARC, path: string) { const g = BCK.parse(rarc.findFileData(path)!); g.loopMode = LoopMode.REPEAT; return g; }
    function parseBRK(rarc: RARC.RARC, path: string) { return BRK.parse(rarc.findFileData(path)!); }
    function parseBTK(rarc: RARC.RARC, path: string) { return BTK.parse(rarc.findFileData(path)!); }
    function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

    // Tremendous special thanks to LordNed, Sage-of-Mirrors & LugoLunatic for their work on actor mapping
    // Heavily based on https://github.com/LordNed/Winditor/blob/master/Editor/resources/ActorDatabase.json

    if (name === 'item') {
        // Item table provided with the help of the incredible LugoLunatic <3.
        const itemId = (parameters & 0x000000FF);

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
        // Small magic jar
        else if (itemId === 0x09) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/mpoda.bdl`));
        else console.warn(`Unknown item: ${hexzero(itemId, 2)}`);
    }
    // Generic Torch
    else if (name === 'bonbori') {
        const rarc = await fetchArchive(`Ep.arc`);
        const ga = !!((parameters >>> 6) & 0x01);
        const obm = !!((parameters >>> 7) & 0x01);
        let type = (parameters & 0x3F);
        if (type === 0x3F)
            type = 0;

        setModelMatrix(scratchMatrix);
        vec3.set(scratchVec3a, 0, 0, 0);
        if (type === 0 || type === 3) {
            const m = buildModel(rarc, obm ? `bdl/obm_shokudai1.bdl` : `bdl/vktsd.bdl`);
            scratchVec3a[1] += 140;
        }
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);

        // Create particle systems.
        const pa = createEmitter(0x0001);
        vec3.copy(pa.globalTranslation, scratchVec3a);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (type !== 2) {
            const pb = createEmitter(0x4004);
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = createEmitter(0x01EA);
        vec3.copy(pc.globalTranslation, scratchVec3a);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga
    }
    // Hyrule Ocean Warp
    else if (name === 'Ghrwp') {
        const rarc = await fetchArchive(`Ghrwp.arc`);
        const a00 = buildModel(rarc, `bdlm/ghrwpa00.bdl`);
        a00.bindTTK1(parseBTK(rarc, `btk/ghrwpa00.btk`));
        const b00 = buildModel(rarc, `bdlm/ghrwpb00.bdl`);
        b00.bindTTK1(parseBTK(rarc, `btk/ghrwpb00.btk`));
        b00.bindTRK1(parseBRK(rarc, `brk/ghrwpb00.brk`));
    }
    // Outset Island: Jabun's barrier (six parts)
    else if (name === 'Ajav') fetchArchive(`Ajav.arc`).then((rarc) => {
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
    // NPCs
    // Aryll
    else if (name === 'Ls' || name === 'Ls1') fetchArchive(`Ls.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ls.bdl`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handL`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handR`);
        m.bindANK1(parseBCK(rarc, `bcks/ls_wait01.bck`));
    });
    // Beedle
    else if (name === 'Bs1') fetchArchive(`Bs.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Beedle (this time with helmet)
    else if (name === 'Bs2') fetchArchive(`Bs.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        buildChildModel(rarc, `bdlm/bs_met.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Tingle
    else if (name === 'Tc') fetchArchive(`Tc.arc`).then((rarc) => buildModel(rarc, `bdlm/tc.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Grandma
    else if (name === 'Ba1') {
        // Only allow the sleeping grandma through, because how else can you live in life...
        if (parameters === 0x03) {
            const rarc = await fetchArchive(`Ba.arc`);
            const m = buildModel(rarc, `bdlm/ba.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/wait02.bck`));
        }
    }
    // Salvatore
    else if (name === 'Kg1' || name === 'Kg2') fetchArchive(`Kg.arc`).then((rarc) => buildModel(rarc, `bdlm/kg.bdl`).bindANK1(parseBCK(rarc, `bcks/kg_wait01.bck`)));
    // Orca
    else if (name === 'Ji1') fetchArchive(`Ji.arc`).then((rarc) => buildModel(rarc, `bdlm/ji.bdl`).bindANK1(parseBCK(rarc, `bck/ji_wait01.bck`)));
    // Medli
    else if (name === 'Md1') {
        const rarc = await fetchArchive(`Md.arc`);
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
    }
    // Makar
    else if (name === 'Cb1') fetchArchive(`Cb.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/cb.bdl`);
        buildChildModel(rarc, `bdl/cb_face.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // The King of Hyrule
    else if (name === 'Hi1') fetchArchive(`Hi.arc`).then((rarc) => buildModel(rarc, `bdlm/hi.bdl`).bindANK1(parseBCK(rarc, `bcks/hi_wait01.bck`)));
    // Princess Zelda
    else if (name === 'p_zelda') fetchArchive(`Pz.arc`).then((rarc) => {
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
    else if (name === 'De1') fetchArchive(`De.arc`).then((rarc) => buildModel(rarc, `bdl/de.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Prince Komali (Small Childe)
    else if (name === 'Co1') fetchArchive(`Co.arc`).then((rarc) => buildModel(rarc, `bdlm/co.bdl`).bindANK1(parseBCK(rarc, `bcks/co_wait00.bck`)));
    // Adult Komali
    else if (name === 'Ac1') fetchArchive(`Ac.arc`).then((rarc) => {
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
    else if (name === 'Zk1') fetchArchive(`Zk.arc`).then((rarc) => buildModel(rarc, `bdlm/zk.bdl`).bindANK1(parseBCK(rarc, `bcks/zk_wait01.bck`)));
    // Rose
    else if (name === 'Ob1') fetchArchive(`Ob.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ob.bdl`);
        buildChildModel(rarc, `bdlm/oba_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Mesa
    else if (name === 'Ym1') fetchArchive(`Ym.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ym.bdl`);
        buildChildModel(rarc, `bdlm/ymhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Abe
    else if (name === 'Ym2') fetchArchive(`Ym.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ym.bdl`, `bmt/ym2.bmt`);
        buildChildModel(rarc, `bdlm/ymhead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Sturgeon
    else if (name === 'Aj1') fetchArchive(`Aj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/aj.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Quill
    else if (name === 'Bm1') fetchArchive(`Bm.arc`).then((rarc) => {
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
    else if (name === 'Bm2') fetchArchive(`Bm.arc`).then((rarc) => {
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
    else if (name === 'Bm3') fetchArchive(`Bm.arc`).then((rarc) => {
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
    else if (name === 'Bm4') fetchArchive(`Bm.arc`).then((rarc) => {
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
    else if (name === 'Bm5') fetchArchive(`Bm.arc`).then((rarc) => {
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
    else if (name === 'Btsw2') fetchArchive(`Btsw.arc`).then((rarc) => buildModel(rarc, `bdlm/bn.bdl`).bindANK1(parseBCK(rarc, `bcks/bn_wait01.bck`)));
    // Koboli (Sorting Game)
    else if (name === 'Bmsw') fetchArchive(`Bmsw.arc`).then((rarc) => {
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
    else if (name === 'Bmcon1') fetchArchive(`Bmcon1.arc`).then((rarc) => {
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
    else if (name === 'Bmcon2') fetchArchive(`Bmcon1.arc`).then((rarc) => {
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
    else if (name === 'Ko1') fetchArchive(`Ko.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ko.bdl`);
        buildChildModel(rarc, `bdlm/kohead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Joel
    else if (name === 'Ko2') fetchArchive(`Ko.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ko.bdl`, `bmt/ko02.bmt`);
        buildChildModel(rarc, `bdlm/kohead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Sue-Belle
    else if (name === 'Yw1') fetchArchive(`Yw.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/yw.bdl`);
        buildChildModel(rarc, `bdlm/ywhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Tetra
    else if (name === 'Zl1') fetchArchive(`Zl.arc`).then((rarc) => {
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
    else if (name === 'P1a') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p1.bdl`);
        buildChildModel(rarc, `bdlm/p1a_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Senza
    else if (name === 'P1b') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1b_body.bmt`);
        buildChildModel(rarc, `bdlm/p1b_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Nudge
    else if (name === 'P1c') fetchArchive(`P1.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1c_body.bmt`);
        buildChildModel(rarc, `bdlm/p1c_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Zuko
    else if (name === 'P2a') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p2.bdl`);
        buildChildModel(rarc, `bdlm/p2head01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Niko
    else if (name === 'P2b') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2b.bmt`);
        buildChildModel(rarc, `bdlm/p2head02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Mako
    else if (name === 'P2c') fetchArchive(`P2.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2c.bmt`);
        buildChildModel(rarc, `bdlm/p2head03.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Old Man Ho-Ho
    else if (name === 'Ah') fetchArchive(`Ah.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ah.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/ah_wait01.bck`));
    });
    // Helmarock King
    else if (name === 'Dk') fetchArchive(`Dk.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/dk.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/fly1.bck`));
    });
    // Zunari
    else if (name === 'Rsh1') fetchArchive(`Rsh.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/rs.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/rs_wait01.bck`));
    });
    // ???
    else if (name === 'Sa1') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/sa.bdl`);
        buildChildModel(rarc, `bdlm/sa01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Gummy
    else if (name === 'Sa2') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa02.bmt`);
        buildChildModel(rarc, `bdlm/sa02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Kane
    else if (name === 'Sa3') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa03.bmt`);
        buildChildModel(rarc, `bdlm/sa03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Candy
    else if (name === 'Sa4') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa04.bmt`);
        buildChildModel(rarc, `bdlm/sa04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Dampa
    else if (name === 'Sa5') fetchArchive(`Sa.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa05.bmt`);
        buildChildModel(rarc, `bdlm/sa05_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Potova
    else if (name === 'Ug1') fetchArchive(`Ug.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ug.bdl`);
        buildChildModel(rarc, `bdlm/ug01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Joanna
    else if (name === 'Ug2') fetchArchive(`Ug.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ug.bdl`, `bmt/ug02.bmt`);
        buildChildModel(rarc, `bdlm/ug02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Jin
    else if (name === 'UkB') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/uk.bdl`);
        buildChildModel(rarc, `bdl/ukhead_b.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jan
    else if (name === 'UkC') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_c.bmt`);
        buildChildModel(rarc, `bdlm/ukhead_c.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jun-Roberto
    else if (name === 'UkD') fetchArchive(`Uk.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_d.bmt`);
        buildChildModel(rarc, `bdl/ukhead_d.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Gilligan
    else if (name === 'Uw1') fetchArchive(`Uw.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uw.bdl`);
        buildChildModel(rarc, `bdlm/uw01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Linda
    else if (name === 'Uw2') fetchArchive(`Uw.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uw.bdl`, `bmt/uw02.bmt`);
        buildChildModel(rarc, `bdlm/uw02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Kreeb
    else if (name === 'Um1') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/um.bdl`);
        buildChildModel(rarc, `bdlm/um01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Anton
    else if (name === 'Um2') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um02.bmt`);
        buildChildModel(rarc, `bdlm/um02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Kamo
    else if (name === 'Um3') fetchArchive(`Um.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um03.bmt`);
        buildChildModel(rarc, `bdlm/um03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Sam
    else if (name === 'Uo1') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uo.bdl`);
        buildChildModel(rarc, `bdlm/uo01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Gossack
    else if (name === 'Uo2') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo02.bmt`);
        buildChildModel(rarc, `bdlm/uo02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Garrickson
    else if (name === 'Uo3') fetchArchive(`Uo.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo03.bmt`);
        buildChildModel(rarc, `bdlm/uo03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Vera
    else if (name === 'Ub1') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ub.bdl`);
        buildChildModel(rarc, `bdlm/ub01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Pompie
    else if (name === 'Ub2') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub02.bmt`);
        buildChildModel(rarc, `bdlm/ub02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Missy
    else if (name === 'Ub3') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub03.bmt`);
        buildChildModel(rarc, `bdlm/ub03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Mineco
    else if (name === 'Ub4') fetchArchive(`Ub.arc`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub04.bmt`);
        buildChildModel(rarc, `bdlm/ub04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (name === 'Bms1') fetchArchive(`Bms.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by1.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by1_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (name === 'Bms2') fetchArchive(`Bms.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by2.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by2_wait00.bck`));
    });
    // Mrs. Marie
    else if (name === 'Ho') fetchArchive(`Ho.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ho.bdl`);
        buildChildModel(rarc, `bdl/ho_pend.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/ho_wait01.bck`));
    });
    // Tott
    else if (name === 'Tt') fetchArchive(`Tt.arc`).then((rarc) => buildModel(rarc, `bdlm/tt.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    // Maggie's Father (Rich)
    else if (name === 'Gp1') fetchArchive(`Gp.arc`).then((rarc) => buildModel(rarc, `bdlm/gp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie's Father (Poor)
    else if (name === 'Pf1') fetchArchive(`Pf.arc`).then((rarc) => buildModel(rarc, `bdlm/pf.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie (Rich)
    else if (name === 'Kp1') fetchArchive(`Kp.arc`).then((rarc) => buildModel(rarc, `bdlm/kp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Mila (Poor)
    else if (name === 'Kk1') fetchArchive(`Kk.arc`).then((rarc) => buildModel(rarc, `bdlm/kk.bdl`).bindANK1(parseBCK(rarc, `bcks/kk_wait01.bck`)));
    // Mila's Father (Rich)
    else if (name === 'Kf1') fetchArchive(`Kf.arc`).then((rarc) => buildModel(rarc, `bdlm/kf.bdl`).bindANK1(parseBCK(rarc, `bcks/kf_wait01.bck`)));
    // Mila's Father (Poor)
    else if (name === 'Gk1') fetchArchive(`Gk.arc`).then((rarc) => buildModel(rarc, `bdlm/gk.bdl`).bindANK1(parseBCK(rarc, `bcks/gk_wait01.bck`)));
    // Ivan
    else if (name === 'Mk') fetchArchive(`Mk.arc`).then((rarc) => buildModel(rarc, `bdlm/mk.bdl`).bindANK1(parseBCK(rarc, `bcks/mk_wait.bck`)));
    // Lorenzo
    else if (name === 'Po') fetchArchive(`Po.arc`).then((rarc) => buildModel(rarc, `bdlm/po.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Doc Bandam
    else if (name === 'Ds1') fetchArchive(`Ds.arc`).then((rarc) => buildModel(rarc, `bdlm/ck.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Jabun
    else if (name === 'Jb1') fetchArchive(`Jb.arc`).then((rarc) => buildModel(rarc, `bdlm/jb.bdl`).bindANK1(parseBCK(rarc, `bcks/jb_wait01.bck`)));
    // Zephos
    else if (name === 'Hr') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Cyclos (same as Zephos)
    else if (name === 'Hr2') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Valoo
    else if (name === 'dragon') fetchArchive(`Dr.arc`).then((rarc) => buildModel(rarc, `bmd/dr1.bmd`).bindANK1(parseBCK(rarc, `bck/dr_wait1.bck`)));
    // Olivio (Korok)
    else if (name === 'Bj1') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj1_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Aldo (Korok)
    else if (name === 'Bj2') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj2_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Oakin (Korok)
    else if (name === 'Bj3') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj3_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Drona (Korok)
    else if (name === 'Bj4') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj4_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Irch (Korok)
    else if (name === 'Bj5') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj5_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Rown (Korok)
    else if (name === 'Bj6') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj6_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Hollo (Korok)
    else if (name === 'Bj7') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj7_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Elma (Korok)
    else if (name === 'Bj8') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj8_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Linder (Korok)
    else if (name === 'Bj9') fetchArchive(`Bj.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj9_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Manny
    else if (name === 'Mn') fetchArchive(`Mn.arc`).then((rarc) => buildModel(rarc, `bdlm/mn.bdl`).bindANK1(parseBCK(rarc, `bcks/mn_wait01.bck`)));
    // Carlov
    else if (name === 'Mt') fetchArchive(`Niten.arc`).then((rarc) => buildModel(rarc, `bdlm/mt.bdl`).bindANK1(parseBCK(rarc, `bcks/mt_wait01.bck`)));
    // Great Fairy
    else if (name === 'BigElf') fetchArchive(`bigelf.arc`).then((rarc) => buildModel(rarc, `bdlm/dy.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Fairy
    else if (name === 'Sfairy') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/fa.bdl`).bindANK1(parseBCK(rarc, `bck/fa.bck`)));
    // Goron Merchants
    else if (name === 'RotenA') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (name === 'RotenB') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat2.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (name === 'RotenC') fetchArchive(`Ro.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat3.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    // Small decoration (Always)
    else if (name === 'kotubo') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_kotubo1.bdl`));
    else if (name === 'ootubo1') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
    else if (name === 'koisi1') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
    // Bigger trees
    else if (name === 'lwood') fetchArchive(`Lwood.arc`).then((rarc) => {
        const b = buildModel(rarc, `bdl/alwd.bdl`);
        b.lightTevColorType = LightTevColorType.BG0;
    });
    else if (name === 'Oyashi') fetchArchive(`Oyashi.arc`).then((rarc) => buildModel(rarc, `bdl/oyashi.bdl`));
    else if (name === 'Vyasi') fetchArchive(`Vyasi.arc`).then((rarc) => buildModel(rarc, `bdl/vyasi.bdl`));
    // Barrels
    else if (name === 'Ktaru') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    else if (name === 'Ktarux') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    else if (name === 'Ktaruo') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    // Wooden Crates
    else if (name === 'Kkiba') fetchArchive(`Kkiba_00.arc`).then((rarc) => buildModel(rarc, `bdl/kkiba_00.bdl`));
    else if (name === 'KkibaB') fetchArchive(`Kkiba_00.arc`).then((rarc) => buildModel(rarc, `bdl/kkiba_00.bdl`));
    // Breakable shelves
    else if (name === 'Otana') fetchArchive(`Otana.arc`).then((rarc) => buildModel(rarc, `bdl/otana.bdl`));
    // Fancy pots
    else if (name === 'Ptubo') fetchArchive(`Ptubo.arc`).then((rarc) => buildModel(rarc, `bdl/ptubo.bdl`));
    else if (name === 'Kmtub') fetchArchive(`Kmtub_00.arc`).then((rarc) => buildModel(rarc, `bdl/kmtub_00.bdl`));
    // Skull
    else if (name === 'Odokuro') fetchArchive(`Odokuro.arc`).then((rarc) => buildModel(rarc, `bdl/odokuro.bdl`));
    // Mailbox
    else if (name === 'Tpost') fetchArchive(`Toripost.arc`).then((rarc) => buildModel(rarc, `bdl/vpost.bdl`).bindANK1(parseBCK(rarc, `bcks/post_wait.bck`)));
    // Sign
    else if (name === 'Kanban') fetchArchive(`Kanban.arc`).then((rarc) => {
        const b = buildModel(rarc, `bdl/kanban.bdl`);
        b.lightTevColorType = LightTevColorType.BG0;
    });
    // Doors: TODO(jstpierre)
    else if (name === 'KNOB00') return;
    // Forsaken Fortress door
    else if (name === 'SMBdor') fetchArchive(`Mbdoor.arc`).then((rarc) => {
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
    else if (name === 'MjDoor') fetchArchive(`S_MSPDo.arc`).then((rarc) => buildModel(rarc, `bdl/s_mspdo.bdl`));
    // Holes you can fall into
    else if (name === 'Pitfall') fetchArchive(`Aana.arc`).then((rarc) => buildModel(rarc, `bdl/aana.bdl`));
    // Warp Pot
    else if (name === 'Warpt' || name === 'Warpnt' || name === 'Warpts1' || name === 'Warpts2' || name === 'Warpts3') fetchArchive(`ltubw.arc`).then((rarc) => buildModel(rarc, `bdl/itubw.bdl`));
    else if (name === 'Warpgm') fetchArchive(`Gmjwp.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gmjwp01.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gmjwp01.brk`));
    });
    // Hookshot Target (wtf Nintendo)
    else if (name === 'Hfuck1') fetchArchive(`Hfuck1.arc`).then((rarc) => buildModel(rarc, `bdl/hfuck1.bdl`));
    // Ladders
    else if (name === 'Mhsg4h') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg4h.bdl`));
    else if (name === 'Mhsg9') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg9.bdl`));
    else if (name === 'Mhsg15') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg15.bdl`));
    // Bombable rock
    else if (name === 'Ebrock') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock.bdl`));
    else if (name === 'Ebrock2') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock2.bdl`));
    else if (name === 'Eskban') fetchArchive(`Eskban.arc`).then((rarc) => buildModel(rarc, `bdl/eskban.bdl`));
    else if (name === 'Esekh') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh.bdl`));
    else if (name === 'Esekh2') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh2.bdl`));
    else if (name === 'Ebomzo') fetchArchive(`Ebomzo.arc`).then((rarc) => buildModel(rarc, `bdl/ebomzo.bdl`));
    // Stone head rock
    else if (name === 'Ekao') fetchArchive(`Ekao.arc`).then((rarc) => buildModel(rarc, `bdl/ekao.bdl`));
    // Whirlpool
    else if (name === 'Auzu') fetchArchive(`Auzu.arc`).then((rarc) => buildModel(rarc, `bdlm/auzu.bdl`).bindTTK1(parseBTK(rarc, `btk/auzu.btk`)));
    // Floor Switch
    else if (name === 'Kbota_A' || name === 'Kbota_B' || name === 'KbotaC') fetchArchive(`Kbota_00.arc`).then((rarc) => buildModel(rarc, `bdl/kbota_00.bdl`));
    // Iron Boots Switch
    else if (name === 'Hhbot1' || name === 'Hhbot1N') fetchArchive(`Hhbot.arc`).then((rarc) => {
        buildModel(rarc, `bdl/hhbot1.bdl`);
        buildModel(rarc, `bdl/hhbot2.bdl`);
    });
    // Grapple Point
    else if (name === 'Kui') fetchArchive(`Kui.arc`).then((rarc) => buildModel(rarc, `bdl/obi_ropetag.bdl`));
    // Korok Tree
    else if (name === 'FTree') fetchArchive(`Vmr.arc`).then((rarc) => buildModel(rarc, `bdlm/vmrty.bdl`).bindANK1(parseBCK(rarc, `bck/vmrty.bck`)));
    // Animals
    else if (name === 'DmKmm') fetchArchive(`Demo_Kmm.arc`).then((rarc) => buildModel(rarc, `bmd/ka.bmd`).bindANK1(parseBCK(rarc, `bcks/ka_wait1.bck`)));
    else if (name === 'Kamome') fetchArchive(`Kamome.arc`).then((rarc) => buildModel(rarc, `bdl/ka.bdl`).bindANK1(parseBCK(rarc, `bck/ka_wait2.bck`)));
    else if (name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`));
    else if (name === 'Pig') fetchArchive(`Kb.arc`).then((rarc) => buildModel(rarc, `bdlm/pg.bdl`));
    else if (name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    else if (name === 'NpcSo') fetchArchive(`So.arc`).then((rarc) => buildModel(rarc, `bdlm/so.bdl`).bindANK1(parseBCK(rarc, `bcks/so_wait01.bck`)));
    // Enemies
    else if (name === 'Fganon') fetchArchive(`Fganon.arc`).then((rarc) => buildModel(rarc, `bdlm/bpg.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (name === 'keeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/ki.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (name === 'Fkeeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/fk.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (name === 'Puti') fetchArchive(`Pt.arc`).then((rarc) => buildModel(rarc, `bdlm/pt.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (name === 'Rdead1') fetchArchive(`Rd.arc`).then((rarc) => buildModel(rarc, `bdlm/rd.bdl`).bindANK1(parseBCK(rarc, `bcks/walk.bck`)));
    else if (name === 'Rdead2') fetchArchive(`Rd.arc`).then((rarc) => buildModel(rarc, `bdlm/rd.bdl`).bindANK1(parseBCK(rarc, `bcks/walk.bck`)));
    else if (name === 'wiz_r') fetchArchive(`Wz.arc`).then((rarc) => buildModel(rarc, `bdlm/wz.bdl`).bindANK1(parseBCK(rarc, `bck/s_demo_wait1.bck`)));
    else if (name === 'gmos') fetchArchive(`Gm.arc`).then((rarc) => buildModel(rarc, `bdlm/gm.bdl`).bindANK1(parseBCK(rarc, `bck/fly.bck`)));
    else if (name === 'mo2') fetchArchive(`Mo2.arc`).then((rarc) => buildModel(rarc, `bdlm/mo.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (name === 'Bb') fetchArchive(`Bb.arc`).then((rarc) => buildModel(rarc, `bdlm/bb.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (name === 'Bk') fetchArchive(`Bk.arc`).then((rarc) => buildModel(rarc, `bdlm/bk.bdl`).bindANK1(parseBCK(rarc, `bck/bk_wait.bck`)));
    else if (name === 'Oq') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/oq.bmd`).bindANK1(parseBCK(rarc, `bck/nom_wait.bck`)));
    else if (name === 'Oqw') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/red_oq.bmd`).bindANK1(parseBCK(rarc, `bck/umi_new_wait.bck`)));
    else if (name === 'Daiocta') fetchArchive(`Daiocta.arc`).then((rarc) => buildModel(rarc, `bdlm/do_main1.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (name === 'Fmastr1') fetchArchive(`fm.arc`).then((rarc) => buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`)));
    else if (name === 'Fmastr2') fetchArchive(`fm.arc`).then((rarc) => buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`)));
    else if (name === 'magtail') fetchArchive(`Mt.arc`).then((rarc) => buildModel(rarc, `bdlm/mg_head.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (name === 'bable') fetchArchive(`Bl.arc`).then((rarc) => buildModel(rarc, `bdlm/bl.bdl`));
    else if (name === 'nezumi') fetchArchive(`Nz.arc`).then((rarc) => buildModel(rarc, `bdlm/nz.bdl`));
    else if (name === 'moZOU') fetchArchive(`Mozo.arc`).then((rarc) => buildModel(rarc, `bdlm/moz.bdl`));
    else if (name === 'MtoriSU') fetchArchive(`MtoriSU.arc`).then((rarc) => buildModel(rarc, `bdl/mtorisu.bdl`));
    else if (name === 'Tn') fetchArchive(`Tn.arc`).then((rarc) => buildModel(rarc, `bmdm/tn_main.bmd`).bindANK1(parseBCK(rarc, `bck/await1.bck`)));
    else if (name === 'Stal') fetchArchive(`St.arc`).then((rarc) => buildModel(rarc, `bdlm/headb.bdl`));
    else if (name === 'p_hat') fetchArchive(`Ph.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/phb.bdl`).bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
        buildModel(rarc, `bdlm/php.bdl`).bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
    });
    else if (name === 'bbaba') fetchArchive(`Bo.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bo_sita1.bdl`);
        // TODO(jstpierre): animation?
    });
    else if (name === 'c_green' || name === 'c_red' || name === 'c_blue') fetchArchive(`Cc.arc`).then((rarc) => {
        // TODO(jstpierre): Colors?
        const cc = buildModel(rarc, `bmdm/cc.bmd`);
        cc.bindANK1(parseBCK(rarc, `bck/tachi_walk.bck`));
    });
    // Beedle's Shop Ship (in Tip Top Shape)
    else if (name === 'ikada_h') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp.bdl`));
    // Helmeted Beedle's Shop Ship
    else if (name === 'ikada_u') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp2.bdl`));
    // The Great Sea
    else if (name === 'Svsp') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vsvsp.bdl`));
    else if (name === 'Vtil1') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil1.bdl`));
    else if (name === 'Vtil2') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil2.bdl`));
    else if (name === 'Vtil3') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil3.bdl`));
    else if (name === 'Vtil4') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil4.bdl`));
    else if (name === 'Vtil5') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil5.bdl`));
    else if (name === 'Ekskz') fetchArchive(`Ekskz.arc`).then((rarc) => {
        buildModel(rarc, `bdl/ekskz.bdl`);
        const yocwd00 = buildModel(rarc, `bdlm/yocwd00.bdl`);
        yocwd00.bindANK1(parseBCK(rarc, `bck/yocwd00.bck`));
        yocwd00.bindTRK1(parseBRK(rarc, `brk/yocwd00.brk`));
        yocwd00.bindTTK1(parseBTK(rarc, `btk/yocwd00.btk`));
    });
    else if (name === 'Ocanon') fetchArchive(`WallBom.arc`).then((rarc) => buildModel(rarc, `bdl/wallbom.bdl`));
    else if (name === 'Canon') fetchArchive(`Bomber.arc`).then((rarc) => buildModel(rarc, `bdl/vcank.bdl`));
    else if (name === 'Aygr') fetchArchive(`Aygr.arc`).then((rarc) => {
        buildModel(rarc, `bdl/aygr.bdl`);
        buildModel(rarc, `bdl/aygrh.bdl`);
    });
    else if (name === 'Ayush') fetchArchive(`Ayush.arc`).then((rarc) => buildModel(rarc, `bdlm/ayush.bdl`).bindTTK1(parseBTK(rarc, `btk/ayush.btk`)));
    else if (name === 'Ikada') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikae.bdl`));
    else if (name === 'ikadaS') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikah.bdl`));
    else if (name === 'Oship') fetchArchive(`Oship.arc`).then((rarc) => buildModel(rarc, `bdl/vbtsp.bdl`));
    else if (name === 'GiceL') fetchArchive(`GiceL.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdli/gicel00.bdl`);
        m.bindTTK1(parseBTK(rarc, `btk/gicel00_01.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gicel00.brk`));
    });
    else if (name === 'Qdghd') fetchArchive(`Qdghd.arc`).then((rarc) => buildModel(rarc, `bdl/qdghd.bdl`));
    else if (name === 'Qtkhd') fetchArchive(`Qtkhd.arc`).then((rarc) => buildModel(rarc, `bdl/qtkhd.bdl`));
    else if (name === 'Ylsic') fetchArchive(`Ylsic.arc`).then((rarc) => buildModel(rarc, `bdl/ylsic.bdl`));
    else if (name === 'Yllic') fetchArchive(`Yllic.arc`).then((rarc) => buildModel(rarc, `bdl/yllic.bdl`));
    else if (name === 'Ykzyg') fetchArchive(`Ykzyg.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/qkzyg.bdl`).bindTTK1(parseBTK(rarc, `btk/qkzyg.btk`));
        // TODO(jstpierre): ymnkz00
    });
    else if (name === 'Ygush00' || name === 'Ygush01' || name === 'Ygush02') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygush00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygush00.btk`)));
    else if (name === 'Yboil00') fetchArchive(`Yboil.arc`).then((rarc) => buildModel(rarc, `bdlm/yboil00.bdl`).bindTTK1(parseBTK(rarc, `btk/yboil00.btk`)));
    else if (name === 'Ygstp00') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygstp00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygstp00.btk`)));
    else if (name === 'Ytrnd00') fetchArchive(`Trnd.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/ytrnd00.bdl`).bindTTK1(parseBTK(rarc, `btk/ytrnd00.btk`));
        buildModel(rarc, `bdlm/ywuwt00.bdl`).bindTTK1(parseBTK(rarc, `btk/ywuwt00.btk`));
    });
    else if (name === 'Sarace') fetchArchive(`Sarace.arc`).then((rarc) => buildModel(rarc, `bdl/sa.bdl`));
    else if (name === 'Ocloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)));
    // Triangle Island Statue: TODO(jstpierre): finish the submodels
    else if (name === 'Doguu') fetchArchive(`Doguu.arc`).then((rarc) => {
        const which = parameters & 0xFF;
        const bmtPaths = ['bmt/vgsmd.bmt', 'bmt/vgsmf.bmt', 'bmt/vgsmn.bmt'];
        const brkPaths = ['brk/vgsmd.brk', 'brk/vgsmf.brk', 'brk/vgsmn.brk'];
        const m = buildModelBMT(rarc, `bdlm/vgsma.bdl`, bmtPaths[which]);
        m.bindTRK1(parseBRK(rarc, brkPaths[which]));
    });
    // Outset Island
    else if (name === 'Lamp') fetchArchive(`Lamp.arc`).then((rarc) => {
        const m = buildModel(rarc, `bmd/lamp_00.bmd`);
        const scale = 0.5;
        mat4.scale(m.modelMatrix, m.modelMatrix, [scale, scale, scale]);
    });
    else if (name === 'MKoppu') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/koppu.bdl`));
    else if (name === 'MOsara') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/osara.bdl`));
    else if (name === 'MPot') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/pot.bdl`));
    else if (name === 'Branch') fetchArchive(`Kwood_00.arc`).then((rarc) => buildModel(rarc, `bmdc/ws.bmd`));
    else if (name === 'Okioke') fetchArchive(`Okioke.arc`).then((rarc) => buildModel(rarc, `bdl/okioke.bdl`));
    else if (name === 'Ostool') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/ostool.bdl`));
    else if (name === 'Otble') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otable.bdl`));
    else if (name === 'OtbleL') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otablel.bdl`));
    else if (name === 'AjavW') {
        const rarc = await fetchArchive(`AjavW.arc`);
        const m = buildModel(rarc, `bdlm/ajavw.bdl`);
        m.lightTevColorType = LightTevColorType.BG1;
        m.bindTTK1(parseBTK(rarc, `btk/ajavw.btk`));
    } else if (name === 'Vdora') fetchArchive(`Vdora.arc`).then((rarc) => buildModel(rarc, `bdl/vdora.bdl`));
    // Windfall Island
    else if (name === 'Roten2') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten02.bdl`));
    else if (name === 'Roten3') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten03.bdl`));
    else if (name === 'Roten4') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten04.bdl`));
    else if (name === 'Fdai') fetchArchive(`Fdai.arc`).then((rarc) => buildModel(rarc, `bdl/fdai.bdl`));
    else if (name === 'GBoard') fetchArchive(`Kaisen_e.arc`).then((rarc) => buildModel(rarc, `bdl/akbod.bdl`));
    else if (name === 'Nzfall') fetchArchive(`Pfall.arc`).then((rarc) => buildModel(rarc, `bdl/nz.bdl`).bindANK1(parseBCK(rarc, `bcks/nz_wait.bck`)));
    else if (name === 'Paper') fetchArchive(`Opaper.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/opaper.bdl`);
        mat4.rotateX(m.modelMatrix, m.modelMatrix, Math.PI / 2);
    });
    else if (name === 'Cafelmp') fetchArchive(`Cafelmp.arc`).then((rarc) => buildModel(rarc, `bdl/ylamp.bdl`));
    else if (name === 'Pbka') fetchArchive(`Pbka.arc`).then((rarc) => buildModel(rarc, `bdl/pbka.bdl`));
    else if (name === 'Plant') fetchArchive(`Plant.arc`).then((rarc) => buildModel(rarc, `bdl/yrmwd.bdl`));
    else if (name === 'Table') fetchArchive(`Table.arc`).then((rarc) => buildModel(rarc, `bdl/ytble.bdl`));
    else if (name === 'Ppos') fetchArchive(`Ppos.arc`).then((rarc) => buildModel(rarc, `bdl/ppos.bdl`));
    else if (name === 'Rflw') fetchArchive(`Rflw.arc`).then((rarc) => buildModel(rarc, `bdl/phana.bdl`));
    else if (name === 'Skanran') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/skanran.bdl`));
    else if (name === 'Stoudai') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/stoudai.bdl`));
    // Pirate stuff
    else if (name === 'Pirates') fetchArchive(`Kaizokusen.arc`).then((rarc) => buildModel(rarc, `bdl/oba_kaizoku_a.bdl`));
    else if (name === 'Ashut') fetchArchive(`Ashut.arc`).then((rarc) => buildModel(rarc, `bdl/ashut.bdl`));
    else if (name === 'Ospbox') fetchArchive(`Ospbox.arc`).then((rarc) => buildModel(rarc, `bdl/ospbox.bdl`));
    // The platforms in the pirate ship which go up and down.
    else if (name === 'Hlift') fetchArchive(`Hlift.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hlift.bdl`);
        m.modelMatrix[13] += 350;
    });
    else if (name === 'Hliftb') fetchArchive(`Hlift.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hliftb.bdl`);
        m.modelMatrix[13] += 300;
    });
    // Beedle's Ship
    else if (name === 'Ptco') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptco.bdl`));
    else if (name === 'Ptcu') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptcu.bdl`));
    // Forsaken Fortress
    else if (name === 'Gaship1') fetchArchive(`GaShip.arc`).then((rarc) => buildModel(rarc, `bdl/gaship.bdl`));
    else if (name === 'Gaship2') fetchArchive(`YakeRom.arc`).then((rarc) => buildModel(rarc, `bdl/yakerom.bdl`));
    else if (name === 'dmgroom') fetchArchive(`dmgroom.arc`).then((rarc) => buildModel(rarc, `bdlm/dmgroom.bdl`));
    else if (name === 'nezuana') fetchArchive(`Nzg.arc`).then((rarc) => buildModel(rarc, `bdl/kana_00.bdl`));
    else if (name === 'Shmrgrd') fetchArchive(`Shmrgrd.arc`).then((rarc) => buildModel(rarc, `bdl/shmrgrd.bdl`));
    else if (name === 'ATdoor') fetchArchive(`Atdoor.arc`).then((rarc) => buildModel(rarc, `bdl/sdoor01.bdl`));
    else if (name === 'Search') fetchArchive(`Search.arc`).then((rarc) => buildModel(rarc, `bdl/s_search.bdl`));
    else if (name === 'Ikari') fetchArchive(`Ikari.arc`).then((rarc) => buildModel(rarc, `bdl/s_ikari2.bdl`));
    else if (name === 'SMtoge') fetchArchive(`Mtoge.arc`).then((rarc) => buildModel(rarc, `bmd/s_mtoge.bmd`));
    // Dragon Roost Island
    else if (name === 'BFlower' || name === 'VbakH') fetchArchive(`VbakH.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/vbakh.bdl`);
        buildModel(rarc, `bdlm/vbakm.bdl`);
    });
    else if (name === 'Rcloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)))
    else if (name === 'TrFlag') fetchArchive(`Trflag.arc`).then((rarc) => buildModel(rarc, `bdl/ethata.bdl`));
    else if (name === 'Ecube') fetchArchive(`Ecube.arc`).then((rarc) => buildModel(rarc, `bdl/ecube.bdl`));
    else if (name === 'Piwa') fetchArchive(`Piwa.arc`).then((rarc) => buildModel(rarc, `bdl/piwa.bdl`));
    else if (name === 'osiBLK0') fetchArchive(`Osiblk.arc`).then((rarc) => buildModel(rarc, `bdl/obm_osihikiblk1.bdl`));
    else if (name === 'osiBLK1') fetchArchive(`Osiblk.arc`).then((rarc) => buildModel(rarc, `bdl/obm_osihikiblk2.bdl`));
    else if (name === 'Gryw00') fetchArchive(`Gryw00.arc`).then((rarc) => buildModel(rarc, `bdlm/gryw00.bdl`));
    else if (name === 'Eayogn') fetchArchive(`Eayogn.arc`).then((rarc) => buildModel(rarc, `bdl/eayogn.bdl`));
    else if (name === 'Mswing') fetchArchive(`Msw.arc`).then((rarc) => buildModel(rarc, `bdl/mswng.bdl`));
    else if (name === 'Dsaku') fetchArchive(`Knsak_00.arc`).then((rarc) => buildModel(rarc, `bdl/knsak_00.bdl`));
    else if (name === 'Ksaku') fetchArchive(`Ksaku_00.arc`).then((rarc) => buildModel(rarc, `bdl/ksaku_00.bdl`));
    else if (name === 'Mflft') fetchArchive(`Mflft.arc`).then((rarc) => buildModel(rarc, `bdl/mflft.bdl`));
    else if (name === 'Yfire00') fetchArchive(`Yfire_00.arc`).then((rarc) => {
        buildModel(rarc, `bmdm/yfire_00.bmd`);
        buildModel(rarc, `bmdm/yfirb_00.bmd`).bindTTK1(parseBTK(rarc, `btk/yfirb_00.btk`));
    });
    // Forest Haven
    else if (name === 'Ohatch') fetchArchive(`Ohatch.arc`).then((rarc) => buildModel(rarc, `bdl/ohatch.bdl`));
    else if (name === 'Ojtree') fetchArchive(`Ojtree.arc`).then((rarc) => buildModel(rarc, `bdl/ojtree.bdl`));
    else if (name === 'Olift') fetchArchive(`Olift.arc`).then((rarc) => buildModel(rarc, `bdl/olift.bdl`));
    else if (name === 'itemDek') fetchArchive(`Deku.arc`).then((rarc) => buildModel(rarc, `bdlm/vlfdm.bdl`));
    else if (name === 'ho') fetchArchive(`Himo3.arc`).then((rarc) => buildModel(rarc, `bmd/h3_ga.bmd`));
    else if (name === 'jbaba') fetchArchive(`Jbo.arc`).then((rarc) => buildModel(rarc, `bmdm/jh.bmd`));
    else if (name === 'VigaH') fetchArchive(`VigaH.arc`).then((rarc) => buildModel(rarc, `bdl/vigah.bdl`));
    else if (name === 'Ss') fetchArchive(`Ss.arc`).then((rarc) => buildModel(rarc, `bdl/sw.bdl`));
    else if (name === 'Sss') fetchArchive(`Sss.arc`).then((rarc) => buildModel(rarc, `bmd/sss_hand.bmd`));
    else if (name === 'Turu') fetchArchive(`Sk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_00.bdl`));
    else if (name === 's_turu') fetchArchive(`Ssk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_02.bdl`));
    else if (name === 'Turu2') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_00.bdl`));
    else if (name === 'Turu3') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_01.bdl`));
    else if (name === 'Kita') fetchArchive(`kita.arc`).then((rarc) => buildModel(rarc, `bdl/vhlif_00.bdl`));
    else if (name === 'Klft') fetchArchive(`Klft.arc`).then((rarc) => buildModel(rarc, `bdlm/lift_00.bdl`));
    else if (name === 'Kmi000x') fetchArchive(`Kmi00x.arc`).then((rarc) => buildModel(rarc, `bdlm/kmi_00x.bdl`));
    else if (name === 'Kmi02') fetchArchive(`Kmi00x.arc`).then((rarc) => buildModel(rarc, `bdlm/kmi_00x.bdl`));
    else if (name === 'Kokiie') fetchArchive(`Kokiie.arc`).then((rarc) => buildModel(rarc, `bdl/koki_00.bdl`));
    else if (name === 'Vpbot') fetchArchive(`Vpbot_00.arc`).then((rarc) => buildModel(rarc, `bdl/vpbot_00.bdl`));
    else if (name === 'Vochi') fetchArchive(`Vochi.arc`).then((rarc) => buildModel(rarc, `bdl/vochi.bdl`));
    else if (name === 'Kanat') fetchArchive(`Kanat.arc`).then((rarc) => buildModel(rarc, `bdl/kanat.bdl`));
    else if (name === 'Kryu00') fetchArchive(`Kryu.arc`).then((rarc) => buildModel(rarc, `bdl/ryu_00.bdl`));
    // Tower of the Gods
    else if (name === 'X_tower') fetchArchive(`X_tower.arc`).then((rarc) => buildModel(rarc, `bdl/x_tower.bdl`));
    else if (name === 'Wall') fetchArchive(`Hbw1.arc`).then((rarc) => buildModel(rarc, `bdl/hbw1.bdl`));
    else if (name === 'Hmon1d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon1.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon1.brk`)));
    else if (name === 'Hmon2d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon2.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon2.brk`)));
    else if (name === 'Hmos1') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos1.bdl`));
    else if (name === 'Hmos2') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos2.bdl`));
    else if (name === 'Hmos3') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos3.bdl`));
    else if (name === 'amos') fetchArchive(`Am.arc`).then((rarc) => buildModel(rarc, `bdl/am.bdl`));
    else if (name === 'amos2') fetchArchive(`Am2.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/am2.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/wait.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/am2.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/am2.brk`));
    });
    else if (name === 'Hha') fetchArchive(`Hha.arc`).then((rarc) => {
        buildModel(rarc, `bdlm/hha1.bdl`);
        buildModel(rarc, `bdlm/hha2.bdl`);
    });
    else if (name === 'Gkai00') fetchArchive(`Gkai00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gkai00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gkai00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/gkai00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gkai00.btk`));
    });
    else if (name === 'Gbrg00') fetchArchive(`Gbrg00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gbrg00.bdl`);
        m.bindTRK1(parseBRK(rarc, `brk/gbrg00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gbrg00.btk`));
    });
    else if (name === 'Humi0z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi0.bdl`).bindTTK1(parseBTK(rarc, `btk/humi0.btk`)));
    else if (name === 'Humi2z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi2.bdl`).bindTTK1(parseBTK(rarc, `btk/humi2.btk`)));
    else if (name === 'Humi3z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi3.bdl`).bindTTK1(parseBTK(rarc, `btk/humi3.btk`)));
    else if (name === 'Humi4z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi4.bdl`).bindTTK1(parseBTK(rarc, `btk/humi4.btk`)));
    else if (name === 'Humi5z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi5.bdl`).bindTTK1(parseBTK(rarc, `btk/humi5.btk`)));
    else if (name === 'Htetu1') fetchArchive(`Htetu1.arc`).then((rarc) => buildModel(rarc, `bdl/htetu1.bdl`));
    else if (name === 'Htobi1') fetchArchive(`Htobi1.arc`).then((rarc) => buildModel(rarc, `bdl/htobi1.bdl`));
    else if (name === 'Hbox2') fetchArchive(`Hbox2.arc`).then((rarc) => buildModel(rarc, `bdl/hbox2.bdl`));
    else if (name === 'Hbox2S') fetchArchive(`Hbox2.arc`).then((rarc) => buildModel(rarc, `bdl/hbox2.bdl`));
    else if (name === 'Hmlif') fetchArchive(`Hmlif.arc`).then((rarc) => buildModel(rarc, `bdlm/hmlif.bdl`));
    else if (name === 'Hdai1') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (name === 'Hdai2') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (name === 'Hdai3') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (name === 'Hsh') fetchArchive(`Hsehi1.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi1.bdl`));
    else if (name === 'Hsh2') fetchArchive(`Hsehi2.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi2.bdl`));
    else if (name === 'Hyuf1') fetchArchive(`Hyuf1.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf1.bdl`));
    else if (name === 'Hyuf2') fetchArchive(`Hyuf2.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf2.bdl`));
    else if (name === 'Blift') fetchArchive(`Hten1.arc`).then((rarc) => buildModel(rarc, `bdl/hten1.bdl`));
    else if (name === 'Hcbh') fetchArchive(`Hcbh.arc`).then((rarc) => {
        buildModel(rarc, `bdl/hcbh1a.bdl`);
        buildModel(rarc, `bdl/hcbh1b.bdl`);
        buildModel(rarc, `bdl/hcbh1c.bdl`);
        buildModel(rarc, `bdl/hcbh1d.bdl`);
        buildModel(rarc, `bdl/hcbh2.bdl`);
    });
    else if (name === 'Hfbot1B') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (name === 'Hfbot1C') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (name === 'Hys') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (name === 'Hys2') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (name === 'Ywarp00') fetchArchive(`Ywarp00.arc`).then((rarc) => {
        const m = buildModel(rarc, `bmdm/ywarp00.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/ywarp00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/ywarp00.brk`));
    });
    // Hyrule.
    else if (name === 'YLzou') fetchArchive(`YLzou.arc`).then((rarc) => buildModel(rarc, `bdl/ylzou.bdl`));
    else if (name === 'MtryB') fetchArchive(`MtryB.arc`).then((rarc) => buildModel(rarc, `bdl/mtryb.bdl`));
    else if (name === 'zouK' || name === 'zouK1' || name === 'zouK2' || name === 'zouK3' || name === 'zouK4') fetchArchive(`VzouK.arc`).then((rarc) => buildModel(rarc, `bdl/vzouk.bdl`));
    else if (name === 'VmsDZ') fetchArchive(`VmsDZ.arc`).then((rarc) => buildModel(rarc, `bdl/vmsdz.bdl`));
    else if (name === 'VmsMS') fetchArchive(`VmsMS.arc`).then((rarc) => buildModel(rarc, `bdl/vmsms.bdl`));
    else if (name === 'Yswdr00') fetchArchive(`Yswdr00.arc`).then((rarc) => buildModel(rarc, `bdlm/yswdr00.bdl`).bindTTK1(parseBTK(rarc, `btk/yswdr00.btk`)));
    // Earth Temple.
    else if (name === 'MhmrSW0') fetchArchive(`MhmrSW.arc`).then((rarc) => buildModel(rarc, `bdl/mhmrsw.bdl`));
    // Nintendo Gallery
    else if (name === 'Figure') {
        fetchArchive(`Figure.arc`).then((rarc) => buildModel(rarc, `bdlm/vf_bs.bdl`))
        const figureId = parameters & 0x000000FF;
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
    // Treasure chests
    else if (name === 'takara' || name === 'takara2' || name === 'takara3' || name === 'takara4' || name === 'takara5' || name === 'takara6' || name === 'takara7' || name === 'takara8' ||
             name === 'takaraK' || name === 'takaraI' || name === 'takaraM' || name === 'tkrASw' || name === 'tkrAGc' || name === 'tkrAKd' || name === 'tkrASw' || name === 'tkrAIk' ||
             name === 'tkrBMs' || name === 'tkrCTf' || name === 'tkrAOc' || name === 'tkrAOs' || name === 'Bitem') {
        // The treasure chest name does not matter, everything is in the parameters.
        // https://github.com/LordNed/Winditor/blob/master/Editor/Editor/Entities/TreasureChest.cs
        const rarc = await fetchArchive('Dalways.arc');
        const type = (parameters >>> 20) & 0x0F;
        if (type === 0) {
            // Light Wood
            const m = buildModel(rarc, `bdli/boxa.bdl`);
        } else if (type === 1) {
            // Dark Wood
            const m = buildModel(rarc, `bdli/boxb.bdl`);
        } else if (type === 2) {
            // Metal
            const m = buildModel(rarc, `bdli/boxc.bdl`);
            const b = parseBRK(rarc, 'brk/boxc.brk');
            b.loopMode = LoopMode.ONCE;
            m.bindTRK1(b);
        } else if (type === 3) {
            // Big Key
            const m = buildModel(rarc, `bdli/boxd.bdl`);
        } else {
            // Might be something else, not sure.
            console.warn(`Unknown chest type: ${name} / ${roomRenderer.name} Layer ${layer} / ${hexzero(parameters, 8)}`);
        }
    }
    // Under-water treasure points. Perhaps spawn at some point?
    else if (name === 'Salvage' || name === 'Salvag2' || name === 'SalvagE' || name === 'SalvagN' || name === 'SalvFM') return;
    // Grass/Flowers/Small Trees. Procedurally generated by the engine.
    // https://github.com/LagoLunatic/WW-Hacking-Docs/blob/6e1ecdadbdf5124e7f6ff037106deb29a5f7238b/Entity%20DZx%20Formats.txt#L695
    else if (
        name === 'kusax1' || name === 'kusax7'  || name === 'kusax21' ||
        name === 'flower' || name === 'flwr7'   || name === 'flwr17' ||
        name === 'pflower'|| name === 'pflwrx7' || 
        name === 'swood'  || name === 'swood3'  || name === 'swood5'
    ) {
        if (actor.layer === -1 || actor.layer === 0)
            return AGrass.create(renderer, actor);
    }
    // Bushes. Procedurally generated by the engine.
    else if (name === 'woodb' || name === 'woodbx') return;
    // Rope. Procedurally generated by the engine.
    else if (name === 'RopeR') return;
    // Bridges. Procedurally generated by the engine.
    else if (name === 'bridge') return;
    // Gyorg spawners.
    else if (name === 'GyCtrl' || name === 'GyCtrlA' || name === 'GyCtrlB') return;
    // Markers for Tingle Tuner
    else if (name === 'agbTBOX' || name === 'agbMARK' || name === 'agbF' || name === 'agbA' || name === 'agbAT' || name === 'agbA2' || name === 'agbR' || name === 'agbB' || name === 'agbFA' || name === 'agbCSW') return;
    // Logic flags used for gameplay, not spawnable objects.
    else if (name === 'AND_SW0' || name === 'AND_SW1' || name === 'AND_SW2' || name === 'SW_HIT0' || name === 'ALLdie' || name === 'SW_C00') return;
    // SWitch SaLVaGe?
    else if (name === 'SwSlvg') return;
    // EVent SWitch
    else if (name === 'Evsw') return;
    // Tags for fishmen?
    else if (name === 'TagSo' || name === 'TagMSo') return;
    // Photo tags
    else if (name === 'TagPo') return;
    // Light tags?
    else if (name === 'LTag0' || name === 'LTag1' || name === 'LTagR0') return;
    // Environment tags (Kyanko)
    else if (name === 'kytag00' || name === 'ky_tag0' || name === 'ky_tag1' || name === 'ky_tag2' || name === 'kytag5' || name === 'kytag6' || name === 'kytag7') return;
    // Other tags?
    else if (name === 'TagEv' || name === 'TagKb' || name === 'TagIsl' || name === 'TagMk' || name === 'TagWp' || name === 'TagMd') return;
    else if (name === 'TagHt' || name === 'TagMsg' || name === 'TagMsg2' || name === 'ReTag0') return;
    else if (name === 'AttTag' || name === 'AttTagB') return;
    else if (name === 'VolTag' || name === 'WindTag') return;
    // Misc. gameplay data
    else if (name === 'HyoiKam') return;
    // Flags (only contains textures)
    else if (name === 'MtFlag' || name === 'SieFlag' || name === 'Gflag' || name === 'MjFlag') return;
    // Collision
    else if (name === 'Akabe') return;
    else
        console.warn(`Unknown object: ${name} / ${roomRenderer.name} Layer ${layer} / ${hexzero(parameters, 8)}`);
}
