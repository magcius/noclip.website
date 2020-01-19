
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { HSD_JObjRoot_Instance, HSD_JObjRoot_Data } from "./SYSDOLPHIN_Render";
import { ViewerRenderInput, SceneGfx, SceneGroup } from "../viewer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { SceneDesc, SceneContext } from "../SceneBase";
import { HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_Archive_FindPublic, HSD_AObjLoadAnimJoint } from "./SYSDOLPHIN";
import { IS_DEVELOPMENT } from "../BuildVersion";

class ModelCache {
    public data: HSD_JObjRoot_Data[] = [];

    constructor(public device: GfxDevice, public cache: GfxRenderCache) {
    }

    public loadJObjRoot(jobjRoot: HSD_JObjRoot): HSD_JObjRoot_Data {
        for (let i = 0; i < this.data.length; i++)
            if (this.data[i].root === jobjRoot)
                return this.data[i];
        const data = new HSD_JObjRoot_Data(this.device, this.cache, jobjRoot);
        this.data.push(data);
        return data;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.data.length; i++)
            this.data[i].destroy(device);
    }
}

export class MeleeRenderer extends BasicGXRendererHelper {
    public jobjRoots: HSD_JObjRoot_Instance[] = [];
    public modelCache: ModelCache;

    constructor(device: GfxDevice) {
        super(device);

        this.modelCache = new ModelCache(device, this.getCache());
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();

        const deltaTimeInFrames = viewerInput.deltaTime / 1000.0 * 60.0;

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (let i = 0; i < this.jobjRoots.length; i++) {
            const root = this.jobjRoots[i];
            root.calcAnim(deltaTimeInFrames);
            root.calcMtx(viewerInput);
            root.draw(device, this.renderHelper.renderInstManager, viewerInput);
        }

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.modelCache.destroy(device);
    }
}

const pathBase = `SuperSmashBrosMelee`;

class HSDDesc implements SceneDesc {
    constructor(public dataPath: string, public rootIdx: number = 0, public id: string = dataPath, public name: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.dataPath}`));
        // const arc2 = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/PlFxAJ.dat`));
        // console.log(arc2.publics[0]);
        // hexdump(arc2.dataBuffer);
        const scene = new MeleeRenderer(device);
        const rootData = scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(arc, arc.publics[this.rootIdx]));
        const rootInst = new HSD_JObjRoot_Instance(rootData);
        scene.jobjRoots.push(rootInst);
        return scene;
    }
}

class MeleeTitleDesc implements SceneDesc {
    constructor(public id: string = `Title`, public name: string = `Title`) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/GmTtAll.usd`));

        const scene = new MeleeRenderer(device);

        const bg = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(arc, HSD_Archive_FindPublic(arc, `TtlBg_Top_joint`))));
        bg.addAnimAll(HSD_AObjLoadAnimJoint(arc, HSD_Archive_FindPublic(arc, `TtlBg_Top_animjoint`)), null, null);
        scene.jobjRoots.push(bg);

        const moji = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(arc, HSD_Archive_FindPublic(arc, `TtlMoji_Top_joint`))));
        moji.addAnimAll(HSD_AObjLoadAnimJoint(arc, HSD_Archive_FindPublic(arc, `TtlMoji_Top_animjoint`)), null, null);
        scene.jobjRoots.push(moji);

        return scene;
    }
}

const sceneDescs = [
    new MeleeTitleDesc(),
    new HSDDesc(`PlFxNr.dat`),
    new HSDDesc(`PlKbNr.dat`),
    new HSDDesc(`MnExtAll.usd`, 1),

    new HSDDesc(`TyZkPair.dat`),
    new HSDDesc(`TyZkWmen.dat`),
    new HSDDesc(`TmBox.dat`),
    new HSDDesc(`TyAligat.dat`),
    new HSDDesc(`Tyandold.dat`),
    new HSDDesc(`TyAndruf.dat`),
    new HSDDesc(`TyAnnie.dat`),
    new HSDDesc(`TyArwing.dat`),
    new HSDDesc(`TyAyumi.dat`),
    new HSDDesc(`TyBacket.dat`),
    new HSDDesc(`TyBalf.dat`),
    new HSDDesc(`TyBancho.dat`),
    new HSDDesc(`TyBarCan.dat`),
    new HSDDesc(`TyBaritm.dat`),
    new HSDDesc(`TyBayone.dat`),
    new HSDDesc(`TyBField.dat`),
    new HSDDesc(`TyBKoopa.dat`),
    new HSDDesc(`TyBMario.dat`),
    new HSDDesc(`TyBox.dat`),
    new HSDDesc(`TyBrdian.dat`),
    new HSDDesc(`TyBSword.dat`),
    new HSDDesc(`TyBTrper.dat`),
    new HSDDesc(`TyCaptan.dat`),
    new HSDDesc(`TyCaptnR.dat`),
    new HSDDesc(`TyCaptR2.dat`),
    new HSDDesc(`TyCathar.dat`),
    new HSDDesc(`TyCerebi.dat`),
    new HSDDesc(`TyChico.dat`),
    new HSDDesc(`TyClink.dat`),
    new HSDDesc(`TyClinkR.dat`),
    new HSDDesc(`TyClnkR2.dat`),
    new HSDDesc(`TyCoin.dat`),
    new HSDDesc(`TyCpeacch.dat`),
    new HSDDesc(`TyCpR2Us.dat`),
    new HSDDesc(`TyCrobat.dat`),
    new HSDDesc(`TyCulCul.dat`),
    new HSDDesc(`TyCupsul.dat`),
    new HSDDesc(`TyDaikon.dat`),
    new HSDDesc(`TyDaisy.dat`),
    new HSDDesc(`TyDataf.dat`),
    new HSDDesc(`TyDatai.dat`),
    new HSDDesc(`TyDatai.usd`),
    new HSDDesc(`TyDedede.dat`),
    new HSDDesc(`TyDiskun.dat`),
    new HSDDesc(`TyDixKng.dat`),
    new HSDDesc(`TyDkJr.dat`),
    new HSDDesc(`TyDLight.dat`),
    new HSDDesc(`TyDMario.dat`),
    new HSDDesc(`TyDnkyR2.dat`),
    new HSDDesc(`TyDonkey.dat`),
    new HSDDesc(`TyDonkyR.dat`),
    new HSDDesc(`TyDosei.dat`),
    new HSDDesc(`TyDosin.dat`),
    new HSDDesc(`TyDossun.dat`),
    new HSDDesc(`TyDrMriR.dat`),
    new HSDDesc(`TyDrMrR2.dat`),
    new HSDDesc(`TyDuck.dat`),
    new HSDDesc(`TyEgg.dat`),
    new HSDDesc(`TyEievui.dat`),
    new HSDDesc(`TyEntei.dat`),
    new HSDDesc(`TyEtcA.dat`),
    new HSDDesc(`TyEtcB.dat`),
    new HSDDesc(`TyEtcC.dat`),
    new HSDDesc(`TyEtcD.dat`),
    new HSDDesc(`TyEtcE.dat`),
    new HSDDesc(`TyExbike.dat`),
    new HSDDesc(`TyFalco.dat`),
    new HSDDesc(`TyFalcoR.dat`),
    new HSDDesc(`TyFalcR2.dat`),
    new HSDDesc(`TyFFlowr.dat`),
    new HSDDesc(`TyFFlyer.dat`),
    new HSDDesc(`TyFire.dat`),
    new HSDDesc(`TyFirest.dat`),
    new HSDDesc(`TyFliper.dat`),
    new HSDDesc(`TyFood.dat`),
    new HSDDesc(`TyFounta.dat`),
    new HSDDesc(`TyFox.dat`),
    new HSDDesc(`TyFoxR.dat`),
    new HSDDesc(`TyFoxR2.dat`),
    new HSDDesc(`TyFreeze.dat`),
    new HSDDesc(`TyFrezer.dat`),
    new HSDDesc(`TyFubana.dat`),
    new HSDDesc(`TyFudane.dat`),
    new HSDDesc(`TyFzero.dat`),
    new HSDDesc(`TyFZone.dat`),
    new HSDDesc(`TyGanond.dat`),
    new HSDDesc(`TyGanonR.dat`),
    new HSDDesc(`TyGanonR2.dat`),
    new HSDDesc(`TyGKoopa.dat`),
    new HSDDesc(`TyGldFox.dat`),
    new HSDDesc(`TyGmCube.dat`),
    new HSDDesc(`TyGooie.dat`),
    new HSDDesc(`TyGoron.dat`),
    new HSDDesc(`TyGrtfox.dat`),
    new HSDDesc(`TyGShell.dat`),
    new HSDDesc(`TyGWatch.dat`),
    new HSDDesc(`TyGWathR.dat`),
    new HSDDesc(`TyGWatR2.dat`),
    new HSDDesc(`TyGwfeld.dat`),
    new HSDDesc(`TyHagane.dat`),
    new HSDDesc(`TyHammer.dat`),
    new HSDDesc(`TyHarise.dat`),
    new HSDDesc(`TyHassam.dat`),
    new HSDDesc(`TyHDosin.dat`),
    new HSDDesc(`TyHeart.dat`),
    new HSDDesc(`TyHecros.dat`),
    new HSDDesc(`TyHeiho.dat`),
    new HSDDesc(`TyHeriri.dat`),
    new HSDDesc(`TyHinoar.dat`),
    new HSDDesc(`TyHitode.dat`),
    new HSDDesc(`TyHomBat.dat`),
    new HSDDesc(`TyHotRly.dat`),
    new HSDDesc(`TyHouou.dat`),
    new HSDDesc(`TyIceclm.dat`),
    new HSDDesc(`TyIceclR.dat`),
    new HSDDesc(`TyIcecR2.dat`),
    new HSDDesc(`TyItemA.dat`),
    new HSDDesc(`TyItemB.dat`),
    new HSDDesc(`TyItemC.dat`),
    new HSDDesc(`TyItemD.dat`),
    new HSDDesc(`TyItemE.dat`),
    new HSDDesc(`TyJeff.dat`),
    new HSDDesc(`TyJugemu.dat`),
    new HSDDesc(`TyKabigo.dat`),
    new HSDDesc(`TyKamex.dat`),
    new HSDDesc(`TyKamiwa.dat`),
    new HSDDesc(`TyKart.dat`),
    new HSDDesc(`TyKasumi.dat`),
    new HSDDesc(`TyKbBall.dat`),
    new HSDDesc(`TyKbFigt.dat`),
    new HSDDesc(`TyKbFire.dat`),
    new HSDDesc(`TyKbHat1.dat`),
    new HSDDesc(`TyKbHat2.dat`),
    new HSDDesc(`TyKbHat3.dat`),
    new HSDDesc(`TyKbHat4.dat`),
    new HSDDesc(`TyKbHat5.dat`),
    new HSDDesc(`TyKiller.dat`),
    new HSDDesc(`TyKingCr.dat`),
    new HSDDesc(`TyKinopi.dat`),
    new HSDDesc(`TyKirbR2.dat`),
    new HSDDesc(`TyKirby.dat`),
    new HSDDesc(`TyKirbyR.dat`),
    new HSDDesc(`TyKirei.dat`),
    new HSDDesc(`TyKoopa.dat`),
    new HSDDesc(`TyKoopaR.dat`),
    new HSDDesc(`TyKopaR2.dat`),
    new HSDDesc(`TyKpMobl.dat`),
    new HSDDesc(`TyKraid.dat`),
    new HSDDesc(`TyKuribo.dat`),
    new HSDDesc(`TyKusuda.dat`),
    new HSDDesc(`TyLandms.dat`),
    new HSDDesc(`TyLeaded.dat`),
    new HSDDesc(`TyLight.dat`),
    new HSDDesc(`TyLikeli.dat`),
    new HSDDesc(`TyLink.dat`),
    new HSDDesc(`TyLinkR.dat`),
    new HSDDesc(`TyLinkR2.dat`),
    new HSDDesc(`TyLipSti.dat`),
    new HSDDesc(`TyLizdon.dat`),
    new HSDDesc(`TyLucky.dat`),
    new HSDDesc(`TyLugia.dat`),
    new HSDDesc(`TyLuigi.dat`),
    new HSDDesc(`TyLuigiM.dat`),
    new HSDDesc(`TyLuigiR.dat`),
    new HSDDesc(`TyLuigR2.dat`),
    new HSDDesc(`TyMajora.dat`),
    new HSDDesc(`TyMapA.dat`),
    new HSDDesc(`TyMapB.dat`),
    new HSDDesc(`TyMapC.dat`),
    new HSDDesc(`TyMapD.dat`),
    new HSDDesc(`TyMapE.dat`),
    new HSDDesc(`TyMaril.dat`),
    new HSDDesc(`TyMarin.dat`),
    new HSDDesc(`TyMario.dat`),
    new HSDDesc(`TyMarioR.dat`),
    new HSDDesc(`TyMariR2.dat`),
    new HSDDesc(`TyMars.dat`),
    new HSDDesc(`TyMarsR.dat`),
    new HSDDesc(`TyMarsR2.dat`),
    new HSDDesc(`TyMarumi.dat`),
    new HSDDesc(`TyMatado.dat`),
    new HSDDesc(`TyMbombJ.dat`),
    new HSDDesc(`TyMBombU.dat`),
    new HSDDesc(`TyMCapsu.dat`),
    new HSDDesc(`TyMcCmDs.dat`),
    new HSDDesc(`TyMcR1Ds.dat`),
    new HSDDesc(`TyMcR2Ds.dat`),
    new HSDDesc(`TyMetamo.dat`),
    new HSDDesc(`TyMetoid.dat`),
    new HSDDesc(`TyMew.dat`),
    new HSDDesc(`TyMew2.dat`),
    new HSDDesc(`TyMew2R.dat`),
    new HSDDesc(`TyMew2R2.dat`),
    new HSDDesc(`TyMHandL.dat`),
    new HSDDesc(`TyMhandR.dat`),
    new HSDDesc(`TyMHige.dat`),
    new HSDDesc(`TyMKnigt.dat`),
    new HSDDesc(`TyMMario.dat`),
    new HSDDesc(`TyMnBg.dat`),
    new HSDDesc(`TyMnDisp.dat`),
    new HSDDesc(`TyMnDisp.usd`),
    new HSDDesc(`TyMnFigp.dat`),
    new HSDDesc(`TyMnFigp.usd`),
    new HSDDesc(`TyMnInfo.dat`),
    new HSDDesc(`TyMnInfo.usd`),
    new HSDDesc(`TyMnView.dat`),
    new HSDDesc(`TyMnView.usd`),
    new HSDDesc(`TyMoon.dat`),
    new HSDDesc(`TyMrCoin.dat`),
    new HSDDesc(`TyMRider.dat`),
    new HSDDesc(`TyMrMant.dat`),
    new HSDDesc(`TyMrTail.dat`),
    new HSDDesc(`TyMsBall.dat`),
    new HSDDesc(`TyMSword.dat`),
    new HSDDesc(`TyMtlbox.dat`),
    new HSDDesc(`TyMTomat.dat`),
    new HSDDesc(`TyMucity.dat`),
    new HSDDesc(`TyMuroom.dat`),
    new HSDDesc(`TyMycCmA.dat`),
    new HSDDesc(`TyMycCmB.dat`),
    new HSDDesc(`TyMycCmC.dat`),
    new HSDDesc(`TyMycCmD.dat`),
    new HSDDesc(`TyMycCmE.dat`),
    new HSDDesc(`TyMycR1A.dat`),
    new HSDDesc(`TyMycR1B.dat`),
    new HSDDesc(`TyMycR1C.dat`),
    new HSDDesc(`TyMycR1D.dat`),
    new HSDDesc(`TyMycR1E.dat`),
    new HSDDesc(`TyMycR2A.dat`),
    new HSDDesc(`TyMycR2B.dat`),
    new HSDDesc(`TyMycR2C.dat`),
    new HSDDesc(`TyMycR2D.dat`),
    new HSDDesc(`TyMycR2E.dat`),
    new HSDDesc(`TyNasubi.dat`),
    new HSDDesc(`TyNess.dat`),
    new HSDDesc(`TyNessR.dat`),
    new HSDDesc(`TyNessR2.dat`),
    new HSDDesc(`TyNoko.dat`),
    new HSDDesc(`TyNyathR.dat`),
    new HSDDesc(`TyNyoroz.dat`),
    new HSDDesc(`TyOcarin.dat`),
    new HSDDesc(`TyOctaro.dat`),
    new HSDDesc(`TyOni.dat`),
    new HSDDesc(`TyOokido.dat`),
    new HSDDesc(`TyOrima.dat`),
    new HSDDesc(`TyOtosei.dat`),
    new HSDDesc(`TyParaso.dat`),
    new HSDDesc(`TyPatapa.dat`),
    new HSDDesc(`TyPchuR2.dat`),
    new HSDDesc(`TyPeach.dat`),
    new HSDDesc(`TyPeachR.dat`),
    new HSDDesc(`TyPeacR2.dat`),
    new HSDDesc(`TyPeppy.dat`),
    new HSDDesc(`TyPichu.dat`),
    new HSDDesc(`TyPichuR.dat`),
    new HSDDesc(`TyPikacR.dat`),
    new HSDDesc(`TyPikacu.dat`),
    new HSDDesc(`TyPikaR2.dat`),
    new HSDDesc(`TyPikmin.dat`),
    new HSDDesc(`TyPippi.dat`),
    new HSDDesc(`TyPit.dat`),
    new HSDDesc(`TyPlum.dat`),
    new HSDDesc(`TyPMario.dat`),
    new HSDDesc(`TyPMurom.dat`),
    new HSDDesc(`TyPokeA.dat`),
    new HSDDesc(`TyPokeB.dat`),
    new HSDDesc(`TyPokeC.dat`),
    new HSDDesc(`TyPokeD.dat`),
    new HSDDesc(`TyPokeE.dat`),
    new HSDDesc(`TyPola.dat`),
    new HSDDesc(`TyPoo.dat`),
    new HSDDesc(`TyPorgn2.dat`),
    new HSDDesc(`TyPupuri.dat`),
    new HSDDesc(`TyPurin.dat`),
    new HSDDesc(`TyPurinR.dat`),
    new HSDDesc(`TyPuriR2.dat`),
    new HSDDesc(`TyPy.dat`),
    new HSDDesc(`TyQChan.dat`),
    new HSDDesc(`TyQuesD.dat`),
    new HSDDesc(`TyRaikou.dat`),
    new HSDDesc(`TyRaygun.dat`),
    new HSDDesc(`TyRayMk2.dat`),
    new HSDDesc(`TyReset.dat`),
    new HSDDesc(`TyRick.dat`),
    new HSDDesc(`TyRidley.dat`),
    new HSDDesc(`TyRodori.dat`),
    new HSDDesc(`TyRoMilk.dat`),
    new HSDDesc(`TyRoy.dat`),
    new HSDDesc(`TyRoyR.dat`),
    new HSDDesc(`TyRoyR2.dat`),
    new HSDDesc(`TyRShell.dat`),
    new HSDDesc(`TySamuR2.dat`),
    new HSDDesc(`TySamus.dat`),
    new HSDDesc(`TySamusM.dat`),
    new HSDDesc(`TySamusR.dat`),
    new HSDDesc(`TyScBall.dat`),
    new HSDDesc(`TySeak.dat`),
    new HSDDesc(`TySeakR.dat`),
    new HSDDesc(`TySeakR2.dat`),
    new HSDDesc(`TySeirei.dat`),
    new HSDDesc(`TySeriA.dat`),
    new HSDDesc(`TySeriB.dat`),
    new HSDDesc(`TySeriC.dat`),
    new HSDDesc(`TySeriD.dat`),
    new HSDDesc(`TySeriE.dat`),
    new HSDDesc(`TySherif.dat`),
    new HSDDesc(`TySlippy.dat`),
    new HSDDesc(`TySmShip.dat`),
    new HSDDesc(`TySndbag.dat`),
    new HSDDesc(`TySnZero.dat`),
    new HSDDesc(`TySonans.dat`),
    new HSDDesc(`TySpyclJ.dat`),
    new HSDDesc(`TySpyclU.dat`),
    new HSDDesc(`TySScope.dat`),
    new HSDDesc(`TyStand.dat`),
    new HSDDesc(`TyStandD.dat`),
    new HSDDesc(`TyStar.dat`),
    new HSDDesc(`TyStarod.dat`),
    new HSDDesc(`TyStdiam.dat`),
    new HSDDesc(`TyStnley.dat`),
    new HSDDesc(`TyStrman.dat`),
    new HSDDesc(`TySuikun.dat`),
    new HSDDesc(`TyTamagn.dat`),
    new HSDDesc(`TyTanuki.dat`),
    new HSDDesc(`TyTarget.dat`),
    new HSDDesc(`TyTenEit.dat`),
    new HSDDesc(`TyTeresa.dat`),
    new HSDDesc(`TyThnder.dat`),
    new HSDDesc(`TyTogepy.dat`),
    new HSDDesc(`TyToppi.dat`),
    new HSDDesc(`TyTosaki.dat`),
    new HSDDesc(`TyTosanz.dat`),
    new HSDDesc(`TyTotake.dat`),
    new HSDDesc(`TyTwinkl.dat`),
    new HSDDesc(`TyUfo.dat`),
    new HSDDesc(`TyUKnown.dat`),
    new HSDDesc(`TyUsahat.dat`),
    new HSDDesc(`TyUsokie.dat`),
    new HSDDesc(`TyVirus.dat`),
    new HSDDesc(`TyWalugi.dat`),
    new HSDDesc(`TyWanino.dat`),
    new HSDDesc(`TyWario.dat`),
    new HSDDesc(`TyWaveRc.dat`),
    new HSDDesc(`TyWdldee.dat`),
    new HSDDesc(`TyWolfen.dat`),
    new HSDDesc(`TyWpStar.dat`),
    new HSDDesc(`TyWtBear.dat`),
    new HSDDesc(`TyWtCat.dat`),
    new HSDDesc(`TyWvRcUs.dat`),
    new HSDDesc(`TyWwoods.dat`),
    new HSDDesc(`TyYoshi.dat`),
    new HSDDesc(`TyYoshiR.dat`),
    new HSDDesc(`TyYoshR2.dat`),
    new HSDDesc(`TyZelda.dat`),
    new HSDDesc(`TyZeldaR.dat`),
    new HSDDesc(`TyZeldR2.dat`),
    new HSDDesc(`TyZeniga.dat`),
    new HSDDesc(`TyZkMen.dat`),
];

const id = `SuperSmashBrosMelee`;
const name = "Super Smash Bros. Melee";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
