
import * as Viewer from '../viewer.js';
import * as RARC from '../Common/JSYSTEM/JKRArchive.js';

import { TwilightPrincessRenderer, dGlobals } from "./ztp_scenes.js";
import { mat4, vec3 } from "gl-matrix";
import { J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase.js';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple.js';
import { GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { LoopMode, ANK1, TTK1, TRK1, TPT1 } from '../Common/JSYSTEM/J3D/J3DLoader.js';
import { assertExists, hexzero, leftPad } from '../util.js';
import { ResType, ResEntry, ResAssetType } from './d_resorce.js';
import AnimationController from '../AnimationController.js';
import { AABB } from '../Geometry.js';
import { computeModelMatrixSRT, scaleMatrix } from '../MathHelpers.js';
import { LightType, dKy_tevstr_init, dKy_tevstr_c, settingTevStruct, setLightTevColorType_MAJI } from './d_kankyo.js';
import { JPABaseEmitter } from '../Common/JSYSTEM/JPA.js';
import { fpc__ProcessName, fopAcM_prm_class, fopAc_ac_c, cPhs__Status, fGlobals, fpcPf__RegisterFallback, fopAcM_GetParamBit } from './framework.js';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { cBgS_GndChk } from '../WindWaker/d_bg.js';
import { ColorKind } from '../gx/gx_render.js';
import { colorNewFromRGBA8 } from '../Color.js';
import { mDoExt_setupStageTexture, mDoExt_setIndirectTex } from './m_do_ext.js'

const scratchVec3a = vec3.create();

function animFrame(frame: number): AnimationController {
    const a = new AnimationController();
    a.setTimeInFrames(frame);
    return a;
}

function computeActorModelMatrix(m: mat4, actor: fopAcM_prm_class): void {
    const rotationY = actor.rot![1] / 0x7FFF * Math.PI;
    computeModelMatrixSRT(m,
        actor.scale![0], actor.scale![1], actor.scale![2],
        0, rotationY, 0,
        actor.pos![0], actor.pos![1], actor.pos![2]);
}

const chk = new cBgS_GndChk();

// "Legacy actor" for noclip
class d_a_noclip_legacy extends fopAc_ac_c {
    private phase = cPhs__Status.Started;
    public objectRenderers: BMDObjectRenderer[] = [];

    public override subload(globals: dGlobals, prm: fopAcM_prm_class): cPhs__Status {
        if (this.phase === cPhs__Status.Started) {
            this.phase = cPhs__Status.Loading;

            spawnLegacyActor(globals, this, prm).then(() => {
                this.phase = cPhs__Status.Next;
            });
        }

        return this.phase;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const device = globals.modelCache.device;

        renderInstManager.setCurrentRenderInstList(globals.dlst.main[0]);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public override delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

function spawnLegacyActor(globals: dGlobals, legacy: d_a_noclip_legacy, actor: fopAcM_prm_class): Promise<void> {
    const modelCache = globals.modelCache;
    const renderer = globals.renderer;
    const resCtrl = modelCache.resCtrl;

    const actorName = globals.dStage__searchNameRev(legacy.processName, legacy.subtype);
    if (actorName === null) {
        throw new Error('wtf! could not find actor name');
    }

    const promises: Promise<any>[] = [];

    function fetchArchive(objArcName: string): Promise<RARC.JKRArchive> {
        const p = modelCache.fetchObjectData(objArcName);
        promises.push(p);
        return p;
    }

    function fetchStageArchive(): Promise<RARC.JKRArchive> {
        const p = modelCache.fetchStageData(`STG_00`);
        promises.push(p);
        return p;
    }

    function getResData<T extends ResType>(resType: T, archive: RARC.JKRArchive, modelPath: string) {
        if (archive.root.name === "stg_00") {
            const resInfo = assertExists(resCtrl.findResInfoByArchive(archive, resCtrl.resStg));
            const resEntry = assertExists(resInfo.res.find((g) => modelPath.endsWith(g.file.name))) as ResEntry<ResAssetType<T>>;
            return resEntry.res;
        } else {
            const resInfo = assertExists(resCtrl.findResInfoByArchive(archive, resCtrl.resObj));
            const resEntry = assertExists(resInfo.res.find((g) => modelPath.endsWith(g.file.name))) as ResEntry<ResAssetType<T>>;
            return resEntry.res;
        }
    }

    function buildChildModelRes(model: J3DModelData): BMDObjectRenderer {
        const modelInstance = new J3DModelInstanceSimple(model);
       //  renderer.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.name = actorName!;
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        dKy_tevstr_init(objectRenderer.tevstr, actor.roomNo);
        objectRenderer.layer = actor.layer;
        return objectRenderer;
    }

    function buildChildModel(rarc: RARC.JKRArchive, modelPath: string): BMDObjectRenderer {
        const model = getResData(ResType.Model, rarc, modelPath);
        return buildChildModelRes(model);
    }

    function setModelMatrix(m: mat4): void {
        computeActorModelMatrix(m, actor);
    }

    function buildModel(rarc: RARC.JKRArchive, modelPath: string, isTag: boolean = false): BMDObjectRenderer {
        const objectRenderer = buildChildModel(rarc, modelPath);
        if (isTag)
            objectRenderer.isTag = true;

        setModelMatrix(objectRenderer.modelMatrix);
        legacy.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelRes(modelData: J3DModelData): BMDObjectRenderer {
        const objectRenderer = buildChildModelRes(modelData);
        setModelMatrix(objectRenderer.modelMatrix);
        legacy.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelBMT(rarc: RARC.JKRArchive, modelPath: string, bmtPath: string): BMDObjectRenderer {
        const objectRenderer = buildModel(rarc, modelPath);
        objectRenderer.modelInstance.setModelMaterialData(getResData(ResType.Bmt, rarc, bmtPath));
       //  renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
        return objectRenderer;
    }

    function setToNearestFloor(dstMatrix: mat4, localModelMatrix: mat4): void {
        chk.Reset();
        mat4.getTranslation(chk.pos, localModelMatrix);
        chk.pos[1] += 10.0;
        const y = globals.scnPlay.bgS.GroundCross(chk);
        // if (y === -Infinity)
        //     debugger;
        dstMatrix[13] = y;
    }

    function parseBCK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        const g = resInfo.lazyLoadResource(ResType.Bck, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
        g.loopMode = LoopMode.Repeat;
        return g;
    }

    function parseBRK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Brk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTP(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btp, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function createEmitter(context: TwilightPrincessRenderer, resourceId: number): JPABaseEmitter {
        return globals.particleCtrl.set(globals, 0, resourceId, null)!;
    }

    const enum TagShape {
        Cube,
        Cylinder,
    }

    function createTag(shape: TagShape, rgba8Color: number, scale: vec3): void {
        if (shape === TagShape.Cube) {
            fetchArchive(`K_cube00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/k_size_cube.bmd`, true);
    
                m.modelInstance.setBaseScale(scale);
                m.modelInstance.setColorOverride(ColorKind.K3, colorNewFromRGBA8(rgba8Color));
            });
        } else if (shape === TagShape.Cylinder) {
            fetchArchive(`K_cyli00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/k_size_cylinder.bmd`, true);
    
                m.modelInstance.setBaseScale(scale);
                m.modelInstance.setColorOverride(ColorKind.MAT0, colorNewFromRGBA8(rgba8Color));
                m.modelInstance.setColorOverride(ColorKind.AMB0, colorNewFromRGBA8(rgba8Color));
            });
        }
    }

    const objName = assertExists(globals.dStage_searchName(actorName));
    const pcName = objName.pcName;

    // Treasure Chest
    if (pcName === fpc__ProcessName.d_a_tbox || pcName === fpc__ProcessName.d_a_tbox2) {
        const model_type = ((actor.parameters >> 0x14) & 0xF);

        // Small Chest
        if (model_type === 0x00) fetchArchive(`Dalways`).then((rarc) => {
            const m = buildModel(rarc, `bmdr/boxa.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/boxa.brk`), animFrame(0));
            m.bindTTK1(parseBTK(rarc, `btk/boxa.btk`));
            m.lightTevColorType = LightType.UNK_16;
        });
        // Big Chest
        else if (model_type === 0x01) fetchArchive(`Dalways`).then((rarc) => {
            const m = buildModel(rarc, `bmdr/boxb.bmd`);
            m.lightTevColorType = LightType.UNK_16;
        });
        // Boss Chest
        else if (model_type === 0x02) fetchArchive(`BoxC`).then((rarc) => {
            const m = buildModel(rarc, `bmdv/boxc.bmd`);
            m.lightTevColorType = LightType.UNK_16;
        });
    }
    // Pots
    else if (pcName === fpc__ProcessName.d_a_obj_carry) {
        const type = (actor.rot![2] >> 1) & 0x1F;

        switch (type) {
        case 0:
            fetchArchive(`J_tubo_00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_tubo_00.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 1:
            fetchArchive(`J_tubo_01`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_tubo_01.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 2:
            fetchArchive(`Kkiba_00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_hako_00.bmd`);
                m.lightTevColorType = LightType.UNK_8;

                scaleMatrix(m.modelMatrix, m.modelMatrix, 0.5);
            });
            break;
        case 3:
            fetchArchive(`Y_ironbal`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/yironball.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 4:
            fetchArchive(`J_taru00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_taru_00.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 5:
            fetchArchive(`J_doku00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_doku_00.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 6:
            fetchArchive(`Obj_bkl`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/k_hb00.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 7:
            fetchArchive(`K_tubo02`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/k_tubo02.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 8:
            fetchArchive(`Obj_ballS`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/lv8_obj_hikaris.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 9:
            fetchArchive(`Obj_ballS`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/lv8_obj_hikaris.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 10:
            fetchArchive(`D_aotubo0`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/d_aotubo00.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 11:
            fetchArchive(`Obj_tama`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/lv8_tama.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 12:
            fetchArchive(`O_tuboS`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/o_tubos_lv8.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        case 13:
            fetchArchive(`O_tuboB`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/o_tubob_lv8.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
            break;
        } 
    } 
    // Door (Knob type)
    else if (actorName === 'kdoor') {
        const door_type = ((actor.parameters >> 5) & 7);
        const res_name = `door-knob_0${door_type}`;

        fetchStageArchive().then((rarc) => {
            const m = buildModel(rarc, `bmdp/${res_name}.bmd`);
            m.lightTevColorType = LightType.UNK_16;

            mat4.translate(m.modelMatrix, m.modelMatrix, [-69, 0, 0]);  // adjust door to frame
        });
    }
    // Door (Shutter type)
    else if (actorName === 'door' || actorName === 'ndoor' || actorName === 'tadoor' || actorName === 'yodoor' || actorName === 'nadoor' || actorName === 'l9door' || actorName === 'l7door' || actorName === 'bigdoor') {
        const door_type = (actor.parameters & 0x1F);
        const model = ((actor.parameters >> 5) & 7);

        let bmdName = ``;
        switch (door_type) {
        default:
        case 10:
            bmdName = `door-shutter_${leftPad(''+model, 2)}`;
            break;
        case 9:
            bmdName = `door-knob_${leftPad(''+model, 2)}`;
            break;
        }

        if (bmdName !== ``) {
            fetchStageArchive().then((rarc) => {
                const m = buildModel(rarc, `bmdr/${bmdName}.bmd`);
                m.lightTevColorType = LightType.UNK_16;

                const m2 = buildModel(rarc, `bmdr/${bmdName}.bmd`);
                m2.lightTevColorType = LightType.UNK_16;

                if (door_type === 9) {
                    mat4.rotateY(m2.modelMatrix, m2.modelMatrix, Math.PI);
                    mat4.translate(m.modelMatrix, m.modelMatrix, [150, 0, 0]);
                    mat4.translate(m2.modelMatrix, m2.modelMatrix, [150, 0, 0]);
                }
            });
        }
    }
    // Door Shutter
    else if (actorName === 'kshtr00' || actorName === 'vshuter' || actorName === 'L3Bdoor') {
        const type = fopAcM_GetParamBit(legacy, 8, 8);
        console.log(`Shutter: ${actorName} - ${type}`);
        let idx = (type + 1) & 0xFF;

        const l_arcName = ["S_shut00", "S_shut00", "Lv3shut00", "K_l3bdoor", "V_Shutter"];
        const bmdName = ["s_shut_rou", "s_shut_rou", "door-shutter_00", "k_l3bdoor", "v_shutter"];

        fetchArchive(l_arcName[idx]).then((rarc) => {
            const m = buildModel(rarc, `bmdr/${bmdName[idx]}.bmd`);
            m.lightTevColorType = LightType.UNK_16;
        });
    }
    // Sign
    else if (actorName === 'Obj_kn2') {
        const sign_type = (actor.parameters & 0x3FFFF);

        if (sign_type === 0x3FFFF) {
            fetchArchive(`Obj_kn2`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_kanban00.bmd`);
                m.lightTevColorType = LightType.UNK_20;
            });
        }
    }
    // Ordon Nameplate
    else if (actorName === 'Obj_nmp') fetchArchive(`J_Hyosatu`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_hyousatu.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Fyer Cannon
    else if (actorName === 'thouse') fetchArchive(`U_THouse`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/u_tobyhouse_tup.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // FBF Platform
    else if (actorName === 'tkrDai') fetchArchive(`M_TakaraD`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_takaradai_base.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const top = buildChildModel(rarc, `bmdr/m_takaradai_top.bmd`);
        top.setParentJoint(m, `world_root`);

        mat4.translate(top.modelMatrix, top.modelMatrix, [-1235, 2050, -1235]);
    });
    // Raft
    else if (actorName === 'Ikada') fetchArchive(`M_Ikada`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_ikada.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Ordon Tie
    else if (actorName === 'Obj_Tie') fetchArchive(`J_Necktie`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_necktie.bmd`);
        m.bindTTK1(parseBTK(rarc, `btk/j_necktie.btk`));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Pumpkin
    else if (actorName === 'Pumpkin') fetchArchive(`pumpkin`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/pumpkin.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    // Pumpkin Leaf
    else if (actorName === 'Pleaf') fetchArchive(`J_Hatake`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_hatake00.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    // Bee Nest
    else if (actorName === 'E_nest') fetchArchive(`E_nest`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/o_hachinosu_01.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    // Weathervane
    else if (actorName === 'Obj_knk') fetchArchive(`J_Kazami`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/arm.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmdr/pole.bmd`);
        m2.lightTevColorType = LightType.UNK_16;
    });
    // Sera's Cat Door
    else if (actorName === 'Obj_nd') fetchArchive(`Obj_ndoor`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_nekodoor.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Ordon Shield
    else if (actorName === 'wshield') fetchArchive(`CWShd`).then((rarc) => {
        const m = buildModel(rarc, `bmwr/al_shb.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Master Sword
    else if (actorName === 'mstrsrd') fetchArchive(`MstrSword`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/o_al_swm.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Moving Wood Stairs
    else if (actorName === 'mvstair') fetchArchive(`K_mvkai00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_mvkai00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Moving Wood Bridge
    else if (actorName === 'Mbrid15') fetchArchive(`P_Mbridge`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/p_mbridge_15.bmd`);
        // m.bindANK1(parseBCK(rarc, `bck/p_mbridge_15.bck`));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Forest Temple Totem
    else if (actorName === 'hasi00') fetchArchive(`K_mbhasi0`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_hasikage00.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmdr/k_mbhasi00.bmd`);
        m2.lightTevColorType = LightType.UNK_16;
    });
    // Small Rock
    else if (actorName === 'stone') fetchArchive(`D_Srock`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_srock.bmd`);
        m.lightTevColorType = LightType.UNK_8;
    });
    // Big Rock
    else if (actorName === 'stoneB') fetchArchive(`D_Brock`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_brock.bmd`);
        m.lightTevColorType = LightType.UNK_8;
    });
    // Mirror Chamber Pole
    else if (actorName === 'MR_Pole') fetchArchive(`MR-6Pole`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/u_mr_6pole.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Mirror Screw
    else if (actorName === 'MR_Scrw') fetchArchive(`MR-Screw`).then((rarc) => {
        /* const m = buildModel(rarc, `bmdr/u_mr_twistpole.bmd`);
        m.lightTevColorType = LightType.UNK_16; */
    });
    // Mirror Chain
    else if (actorName === 'MR_Chin') fetchArchive(`MR-Chain`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/u_mr_monoana.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        m.bindTRK1(parseBRK(rarc, `brk/u_mr_monoana.brk`), animFrame(0));

        const m2 = buildModel(rarc, `bmdr/u_mr_hole.bmd`);
        m2.lightTevColorType = LightType.UNK_16;

        m2.bindANK1(parseBCK(rarc, `bck/u_mr_hole.bck`));
        m2.bindTRK1(parseBRK(rarc, `brk/u_mr_hole.brk`), animFrame(0));
    });
    // Mirror Chamber Sand
    else if (actorName === 'MR_Sand') fetchArchive(`MR-Sand`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/u_mr_sand.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Mirror Chamber Table
    else if (actorName === 'MR_Tble') fetchArchive(`MR-Table`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/u_mr_table.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        mat4.translate(m.modelMatrix, m.modelMatrix, [0, 570, 0]);

        //const m_light = buildModel(rarc, `bmdr/u_mr_light.bmd`);
        //m_light.bindTTK1(parseBTK(rarc, `btk/u_mr_light.btk`));
        //m_light.lightTevColorType = LightType.UNK_16;

        const m_mirror = buildChildModel(rarc, `bmde/u_mr_mirror.bmd`);
        m_mirror.setParentJoint(m, `mirror`);
    });
    // City in the Sky Falling Block
    else if (actorName === 'PDtile') {
        let type = actor.parameters & 0xF;
    
        if (type === 0) {
            fetchArchive(`P_Dtile`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/p_dtile_s.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
        } else if (type === 2) {
            fetchArchive(`P_Dtile00`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/k_dtile00.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
        } else if (type === 4) {
            fetchArchive(`Lv9_Dtile`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/lv9_dtile00.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
        } else {
            fetchArchive(`P_Dtile`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/p_dtile_l.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
        }
    }
    // Arbiter's Grounds gate
    else if (actorName === 'L4Gate') fetchArchive(`L4Gate`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/p_lv4gate.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Arbiter's Grounds Poe gate
    else if (actorName === 'L4Pgate') fetchArchive(`L4R02Gate`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/p_lv4r02_gate.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Arbiter's Chandeliers
    else if (actorName === 'l4chand') fetchArchive(`P_Lv4Chan`).then((rarc) => {
        actor.pos![1] -= 800;

        const m = buildModel(rarc, `bmdr/lv4_chandelier.bmd`);
        buildModel(rarc, `bmdr/p_chain.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // City in the Sky Propeller
    else if (actorName === 'L7Prop') fetchArchive(`L7Prop`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/s_lv7prop_01.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // City in the Sky Big Propeller
    else if (actorName === 'propy') fetchArchive(`stickwl00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_stickwall_00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Goron Mines Bridges
    else if (actorName === 'L_RopeB' || actorName === 'L_RopeS') {
        const type = (actor.parameters >> 0x10) & 3;

        switch (type) {
        case 0:
            fetchArchive(`L_RopeB_S`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/l_ropeb_s.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
            break;
        case 1:
            fetchArchive(`L_RopeB_L`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/l_ropeb_l.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
            break;
        }
    }
    // Boss Doors
    else if (actorName === 'L1Bdoor' || actorName === 'L2Bdoor' || actorName === 'L4Bdoor' || actorName === 'L6Bdoor' || actorName === 'L7Bdoor' || actorName === 'L8Bdoor' || actorName === 'L9Bdoor') {
        const l_stageName = ["D_MN05", "D_MN05A", "D_MN04", "D_MN04A", "D_MN01", "D_MN01A", "D_MN10", "D_MN10A", "D_MN11", 
                             "D_MN11A", "D_MN06", "D_MN06A", "D_MN07", "D_MN07A", "D_MN08", "D_MN08A", "D_MN09", "D_MN09A"];

        let stage_idx = -1;
        for (let i = 0; i < 18; i++) {
            if (globals.stageName === l_stageName[i]) {
                stage_idx = Math.floor((i / 2)) + 1;
                break;
            }
        }

        if (stage_idx !== -1) {
            let arcName = ``;
            if (stage_idx === 0) {
                arcName = "L1Bdoor";
            } else {
                arcName = `L${stage_idx}Bdoor`;
            }
            
            fetchArchive(arcName).then((rarc) => {
                const m = buildModel(rarc, `bmdr/door_shutterboss.bmd`);
                m.lightTevColorType = LightType.UNK_16;
            });
        }
    }
    // Heavy Switch
    else if (actorName === 'hswitch') fetchArchive(`Hswitch`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/p_hswitch.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Heavy Switch (Iron Boots)
    else if (actorName === 'hvySw') fetchArchive(`D_Hfsw00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_hfswitch.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Heavy Switch (Iron Boots)
    else if (actorName === 'marm') fetchArchive(`D_Marm`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_marm_a.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const mb = buildModel(rarc, `bmdr/d_marm_b.bmd`);
        mb.lightTevColorType = LightType.UNK_16;

        const mc = buildModel(rarc, `bmdr/d_marm_c.bmd`);
        mc.lightTevColorType = LightType.UNK_16;

        const md = buildModel(rarc, `bmdr/d_marm_d.bmd`);
        md.lightTevColorType = LightType.UNK_16;

        const me = buildModel(rarc, `bmdr/d_marm_e.bmd`);
        me.lightTevColorType = LightType.UNK_16;

        const mf = buildModel(rarc, `bmdr/d_marm_f.bmd`);
        mf.lightTevColorType = LightType.UNK_16;
    });
    // Eldin Bridge
    else if (actorName === 'Obj_ih') fetchArchive(`Obj_ihasi`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/i_bajyohasiparts.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    
        const m2 = buildModel(rarc, `bmdr/i_bajyohasiparts_ef.bmd`);
        m2.lightTevColorType = LightType.UNK_16;
        m.bindTTK1(parseBTK(rarc, `btk/i_bajyohasiparts_ef.btk`));
    });
    // Kakariko Gorge Bridge
    else if (actorName === 'WarpOB2') fetchArchive(`Obj_kbrgD`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/ni_kakarikobridge.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        mat4.translate(m.modelMatrix, m.modelMatrix, [0, -1880, 0]);
    });
    // Rider Gate
    else if (actorName === 'R_Gate') fetchArchive(`M_RGate00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_ridergate.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Wind Stone
    else if (actorName === 'WdStone') fetchArchive(`WindStone`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/model0.bmd`);
        m.lightTevColorType = LightType.UNK_8;
    });
    // Upper Zora's River Bridge
    else if (actorName === 'Bhhashi') fetchArchive(`BHBridge`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_bhbridge.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Howling Cliff
    else if (actorName === 'tgake') fetchArchive(`A_TGake`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/a_touboegake.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Owl Statue
    else if (actorName === 'CstaF') {
        if (globals.stageName === "R_SP209") {
            fetchArchive(`CstaFB`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/cs_f_b.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
        } else {
            fetchArchive(`CstaF`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/cs_f_a.bmd`);
                m.lightTevColorType = LightType.UNK_8;
            });
        }
    }
    // Crystal Switch
    else if (actorName === 'swHit') fetchArchive(`S_swHit00`).then((rarc) => {
        let type = Math.abs(actor.parameters >> 0x1E);
        if (type > 3) {
            type = 0;
        }

        const colors = [1, 0, 2, 3, 3, 2, 0, 1];
        // 0 = yellow
        // 1 = blue
        // 2 = red
        // 3 = green
        const color = colors[type];

        const m = buildModel(rarc, `bmdr/s_swhit00.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/s_swhit00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/s_swhit00.brk`), animFrame(color));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Epona
    else if (actorName === 'Horse') fetchArchive(`Horse`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/hs.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/hs_wait_01.bck`));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Bo
    else if (actorName === 'Bou') fetchArchive(`Bou`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/bou.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/bou_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/bou.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/bou.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Uli
    else if (actorName === 'Uri') fetchArchive(`Uri`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/uri.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/uri_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/uri.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/uri.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Hanjo
    else if (actorName === 'Hanjo') fetchArchive(`Hanjo`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/hanjo.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/hanjo_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/hanjo.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/hanjo.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Jaggle
    else if (actorName === 'Jagar') fetchArchive(`Jagar`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/jagar.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/jagar_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/jaga.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/jaga.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Monkey
    else if (actorName === 'Npc_ks') fetchArchive(`Npc_ks`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/saru.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/saru_kago_jump.bck`));
        m.bindTPT1(parseBTP(rarc, `btp/saru.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Goats
    else if (actorName === 'Cow') fetchArchive(`Cow`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/cow.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/cow_wait_a.bck`));
        m.bindTPT1(parseBTP(rarc, `btp/cow.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Goron Adult
    else if (actorName === 'grA' || actorName === 'Obj_grA') {
        fetchArchive(`grA_mdl`).then((rarc) => {
            const m = buildModel(rarc, `bmdr/gra_a.bmd`);
            m.lightTevColorType = LightType.UNK_0;

            fetchArchive(`grA_base`).then((rarc) => {
                m.bindANK1(parseBCK(rarc, `bck/gra_wait_a.bck`));
            });
        });
    }
    // Blizzeta / Blizzeta room objects
    else if (actorName === 'B_yo') fetchArchive(`L5_R50`).then((rarc) => {
        const floorMdl = buildModel(rarc, `bmdr/r50_p1.bmd`);
        floorMdl.lightTevColorType = LightType.UNK_16;

        const furnitureMdl = buildModel(rarc, `bmdr/t_r50furniture.bmd`);
        furnitureMdl.lightTevColorType = LightType.UNK_16;
    });
    // Normal Beamos
    else if (actorName === 'Obj_bm') fetchArchive(`Obj_bm`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/bm.bmd`);
        m.bindTRK1(parseBRK(rarc, `brk/turn.brk`), animFrame(0));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Temple of Time Beamos
    else if (actorName === 'E_bm6') fetchArchive(`E_bm6`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/bm6.bmd`);
        m.bindTRK1(parseBRK(rarc, `brk/bm6_turn.brk`), animFrame(0));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Forest Temple Torch
    else if (actorName === 'Cldst00') fetchArchive(`lv1cdl00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_lv1candl_00.bmd`);
        m.lightTevColorType = LightType.UNK_64;
    });
    // Web 0
    else if (actorName === 'Obj_w0') fetchArchive(`Obj_web0`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_kum_kabe00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Web 1
    else if (actorName === 'Obj_w1') fetchArchive(`Obj_web1`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_kum_yuka00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Morpheel water
    else if (actorName === 'l3watB') fetchArchive(`L3_bwater`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/lv3boss_water.bmd`);
        m.bindTTK1(parseBTK(rarc, `btk/lv3boss_water.btk`));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Lakebed central room water
    else if (actorName === 'l3wat02') fetchArchive(`Kr03wat04`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_r03water04.bmd`);
        m.bindTTK1(parseBTK(rarc, `btk/k_r03water04.btk`));
        m.lightTevColorType = LightType.UNK_16;
    });
    // Lakebed stairs
    else if (actorName === 'rstair') fetchArchive(`K_spkai00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_spkaidan_00.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        // flip stairs to default orientation in original
        mat4.rotateY(m.modelMatrix, m.modelMatrix, Math.PI);
    });
    // Forest Temple Torch
    else if (actorName === 'Cldst01') fetchArchive(`lv1cdl01`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_lv1candl_01.bmd`);
        m.lightTevColorType = LightType.UNK_64;

        let particlePos = vec3.create();
        vec3.set(particlePos, actor.pos![0], actor.pos![1] + 120, actor.pos![2]);
        globals.particleCtrl.set(globals, 0, 0x83A6, particlePos)!;
        globals.particleCtrl.set(globals, 0, 0x83A7, particlePos)!;
        // globals.particleCtrl.set(globals, 0, 0x103, particlePos)!;
    });
    // Deku Like
    else if (actorName === 'E_df') fetchArchive(`E_DF`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/df.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/df_wait.bck`));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Temple of Time Door of Time
    else if (actorName === 'szGate') fetchArchive(`L6SzGate`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/lv6_obj_skzogate.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmdr/lv6_obj_skzogate.bmd`);
        m2.lightTevColorType = LightType.UNK_16;

        mat4.rotateY(m2.modelMatrix, m2.modelMatrix, Math.PI);
        mat4.translate(m.modelMatrix, m.modelMatrix, [-200, 0, 0]);
        mat4.translate(m2.modelMatrix, m2.modelMatrix, [-200, 0, 0]);
    });
    else if (actorName === 'l6SwGt') fetchArchive(`L6SwGate`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/lv6_obj_swgate.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmdr/lv6_obj_swgate.bmd`);
        m2.lightTevColorType = LightType.UNK_16;

        mat4.rotateY(m2.modelMatrix, m2.modelMatrix, Math.PI);
        mat4.translate(m.modelMatrix, m.modelMatrix, [-150, 0, 0]);
        mat4.translate(m2.modelMatrix, m2.modelMatrix, [-150, 0, 0]);
    });
    else if (actorName === 'Tenbin') fetchArchive(`L6Tenbin`).then((rarc) => {
        const m = buildModel(rarc, `bmde/lv6_obj_tenbin.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmde/lv6_obj_tenbin_r.bmd`);
        m2.lightTevColorType = LightType.UNK_16;

        mat4.translate(m.modelMatrix, m.modelMatrix, [480, 0, 0]);
        mat4.translate(m2.modelMatrix, m2.modelMatrix, [-480, 0, 0]);
    });
    // Armos
    else if (actorName === 'E_ai') fetchArchive(`E_ai`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/ai.bmd`);
        m.bindTRK1(parseBRK(rarc, `brk/ai_stop.brk`), animFrame(0));
        m.lightTevColorType = LightType.UNK_8;
    });
    // Armor Suit
    else if (actorName === 'E_MD') fetchArchive(`E_md`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/md.bmd`);
        m.lightTevColorType = LightType.UNK_8;
    });
    // Lizalfos
    else if (actorName === 'E_dn') fetchArchive(`E_dn`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/dn.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/dn_wait01.bck`));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Dynalfos
    else if (actorName === 'E_mf') fetchArchive(`E_mf`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/mf.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/mf_wait01.bck`));
        m.lightTevColorType = LightType.UNK_0;
    });
    // Deku Baba
    else if (actorName === 'E_db') fetchArchive(`E_db`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/db.bmd`);
        m.lightTevColorType = LightType.UNK_0;
        m.bindANK1(parseBCK(rarc, `bck/db_defaultpose.bck`));
        buildModel(rarc, `bmdr/dl.bmd`);
        buildModel(rarc, `bmdr/dt.bmd`);

        mat4.rotateX(m.modelMatrix, m.modelMatrix, -(Math.PI / 2));
    });
    // Big Baba
    else if (actorName === 'E_gb') fetchArchive(`E_gb`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/gb.bmd`);
        m.lightTevColorType = LightType.UNK_0;
        m.bindANK1(parseBCK(rarc, `bck/gb_wait.bck`));

        const gf = buildModel(rarc, `bmdr/gf.bmd`);
        gf.bindANK1(parseBCK(rarc, `bck/gf_wait.bck`));

        buildModel(rarc, `bmdr/gs.bmd`);
    });
    // Redead
    else if (actorName === 'E_gi') fetchArchive(`E_gi`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/gi.bmd`);
        m.lightTevColorType = LightType.UNK_0;
        const bck = parseBCK(rarc, `bck/gi_get_up.bck`);
        bck.loopMode = LoopMode.OnceAndReset;

        m.bindANK1(bck);
    });
    // Darknut
    else if (actorName === 'B_tn') fetchArchive(`B_tnp`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/tn.bmd`);
        m.lightTevColorType = LightType.UNK_0;

        const arm_l = buildChildModel(rarc, `bmdr/tn_armor_arm_l.bmd`);
        arm_l.setParentJoint(m, `arm_L_2`);

        const arm_r = buildChildModel(rarc, `bmdr/tn_armor_arm_r.bmd`);
        arm_r.setParentJoint(m, `arm_R_2`);

        const chest_b = buildChildModel(rarc, `bmdr/tn_armor_chest_b.bmd`);
        chest_b.setParentJoint(m, `backbone_3`);
    
        const chest_f = buildChildModel(rarc, `bmdr/tn_armor_chest_f.bmd`);
        chest_f.setParentJoint(m, `backbone_3`);
    
        const head_b = buildChildModel(rarc, `bmdr/tn_armor_head_b.bmd`);
        head_b.setParentJoint(m, `head`);

        const head_f = buildChildModel(rarc, `bmdr/tn_armor_head_f.bmd`);
        head_f.setParentJoint(m, `head`);

        const shoulder_l = buildChildModel(rarc, `bmdr/tn_armor_shoulder_l.bmd`);
        shoulder_l.setParentJoint(m, `sholder_armor_L`);

        const shoulder_r = buildChildModel(rarc, `bmdr/tn_armor_shoulder_r.bmd`);
        shoulder_r.setParentJoint(m, `sholder_armor_R`);

        const waist_b = buildChildModel(rarc, `bmdr/tn_armor_waist_b.bmd`);
        waist_b.setParentJoint(m, `waist_armor_Back`);

        const waist_f = buildChildModel(rarc, `bmdr/tn_armor_waist_f.bmd`);
        waist_f.setParentJoint(m, `tn_armor_waist_F`);

        const waist_l = buildChildModel(rarc, `bmdr/tn_armor_waist_l.bmd`);
        waist_l.setParentJoint(m, `waist_armor_L`);

        const waist_r = buildChildModel(rarc, `bmdr/tn_armor_waist_r.bmd`);
        waist_r.setParentJoint(m, `waist_armor_R`);

        const shield = buildChildModel(rarc, `bmdr/tn_shield.bmd`);
        shield.setParentJoint(m, `hand_L`);

        const sword = buildChildModel(rarc, `bmdr/tn_sword_a.bmd`);
        sword.setParentJoint(m, `hand_R`);

        fetchArchive(`B_tn`).then((rarc) => {
            m.bindANK1(parseBCK(rarc, `bck/tnb_wait.bck`));
        });
    });
    else if (actorName === 'Cstatue') fetchArchive(`CStatue`).then((rarc) => {
        let type = (actor.parameters >> 8) & 0xF;
        
        if (type === 2) {
            type = 1;
        } else if (type === 3) {
            type = 0;
        } else if (type > 2) {
            type -= 2;

            if (type > 4) {
                type = 0;
            }
        }

        switch (type) {
        case 0:
            const m = buildModel(rarc, `bmdr/cs.bmd`);
            m.lightTevColorType = LightType.UNK_8;
            m.modelInstance.setBaseScale([1.6,1.6,1.6]);
            const bck = parseBCK(rarc, `bck/cs_stop.bck`);
            bck.loopMode = LoopMode.Once;
            m.bindANK1(bck);
            break;
        case 1:
            const m2 = buildModel(rarc, `bmdr/cs_b.bmd`);
            m2.lightTevColorType = LightType.UNK_8;
            break;
        }
    });
    else if (actorName === 'E_fb') fetchArchive(`E_fl`).then((rarc) => {
        const m = buildModel(rarc, `bmde/fl_model.bmd`);
        const bck = parseBCK(rarc, `bck/fl_wait.bck`);
        m.lightTevColorType = LightType.UNK_0;

        const prm0 = actor.parameters & 0xFF;
        let scale = 1.5;
        if (prm0 === 1)
            scale = 1.3;

        vec3.set(scratchVec3a, scale, scale, scale);
        m.modelInstance.setBaseScale(scratchVec3a);

        m.bindANK1(bck);
    });
    else if (actorName === 'E_fz') fetchArchive(`E_fz`).then((rarc) => {
        const m = buildModel(rarc, `bmde/fz.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'l5icewl') fetchArchive(`l5IceWall`).then((rarc) => {
        const m = buildModel(rarc, `bmde/yicewall_01.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const scale_x = (actor.parameters >> 0x10) & 0x1F;
        const scale_y = (actor.parameters >> 0x15) & 0x1F;
        const scale_z = (actor.parameters >> 0x1A) & 0x1F;
        vec3.set(scratchVec3a, scale_x * 0.1, scale_y * 0.1, scale_z * 0.1);

        m.modelInstance.setBaseScale(scratchVec3a);
    });
    else if (actorName === 'spnGear') fetchArchive(`P_Sswitch`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/p_sswitch_a.bmd`);
        buildModel(rarc, `bmdr/p_sswitch_b.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Lakebed wheel
    else if (actorName === 'swhel01') fetchArchive(`S_wheel00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/s_wheel00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'kwhel00') fetchArchive(`K_wheel00`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_wheel00.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'kwhel01') fetchArchive(`K_wheel01`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_wheel01.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Stalactites
    else if (actorName === 'syRock') fetchArchive(`syourock`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/k_syourock_01.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    // Lakebed Hang Switches
    else if (actorName === 'buraA') fetchArchive(`S_bura_A`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/s_bura_swia.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'buraB') fetchArchive(`S_bura_B`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/s_bura_swib.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    // Lakebed gates
    else if (actorName === 'bsGate') fetchArchive(`S_Zgate`).then((rarc) => {
        if (((actor.parameters >> 8) & 0xFF) == 1) {
            actor.rot![1] -= 0x8000;
        }

        const m = buildModel(rarc, `bmdr/s_zgate.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });

    // Experimental Tag view
    // Horse Spawn
    else if (actorName === 'Hinit') {
        createTag(TagShape.Cube, 0xFF000050, [0.2,0.2,0.2]);
    }
    // Link Spawn
    else if (actorName === 'Gstart') {
        createTag(TagShape.Cube, 0x00FF0050, [0.2,0.2,0.2]);
    }
    // Scene Change
    else if (actorName === 'scnChg') {
        createTag(TagShape.Cube, 0x20202000, [1.5,1.5,1.5]);
    }
    // Room Back 
    else if (actorName === 'RMback0') {
        createTag(TagShape.Cube, 0x50000000, [2,10,0.1]);
    }
    // Midna Stop
    else if (actorName === 'Mstop') {
        createTag(TagShape.Cylinder, 0x500050FF, [1,1,1]);
    }
    // Midna Stop
    else if (actorName === 'ClearB') {
        createTag(TagShape.Cube, 0x000000FF, [2,1,2]);
    }

    else {
        const dbgName = globals.objNameGetDbgName(objName);
        console.warn(`Unknown obj: ${actorName} / ${dbgName} / Room ${actor.roomNo} Layer ${actor.layer}`);
    }

    const p = Promise.all(promises);
    return p as unknown as Promise<void>;
}

// Special-case actors

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
class BMDObjectRenderer {
    public visible = true;
    public isTag = false;
    public modelMatrix: mat4 = mat4.create();
    public lightTevColorType = LightType.UNK_16;
    public layer: number;
    public tevstr = new dKy_tevstr_c();

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

    public prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible || (this.isTag && !globals.renderHacks.tagsVisible))
            return;

        if (globals.renderHacks.renderHacksChanged) {
            this.modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
            this.modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
        }

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

        mat4.getTranslation(scratchVec3a, this.modelMatrix);
        settingTevStruct(globals, this.lightTevColorType, scratchVec3a, this.tevstr);
        setLightTevColorType_MAJI(globals, this.modelInstance, this.tevstr, viewerInput.camera);

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export function LegacyActor__RegisterFallbackConstructor(globals: fGlobals): void {
    fpcPf__RegisterFallback(globals, d_a_noclip_legacy);
}
