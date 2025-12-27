
/* @preserve The source code to this website is under the MIT license and can be found at https://github.com/magcius/noclip.website */

import { Viewer, SceneGfx, InitErrorCode, makeErrorUI, resizeCanvas, ViewerUpdateInfo, initializeViewerWebGL2, initializeViewerWebGPU } from './viewer.js';

import * as Scenes_BanjoKazooie from './BanjoKazooie/scenes.js';
import * as Scenes_ZeldaTwilightPrincess from './ZeldaTwilightPrincess/Main.js';
import * as Scenes_MarioKartDoubleDash from './j3d/mkdd_scenes.js';
import * as Scenes_ZeldaWindWaker from './ZeldaWindWaker/Main.js';
import * as Scenes_SuperMarioSunshine from './j3d/sms_scenes.js';
import * as Scenes_Pikmin2 from './j3d/pik2_scenes.js';
import * as Scenes_SuperMarioGalaxy1 from './SuperMarioGalaxy/Scenes_SuperMarioGalaxy1.js';
import * as Scenes_SuperMarioGalaxy2 from './SuperMarioGalaxy/Scenes_SuperMarioGalaxy2.js';
import * as Scenes_SuperMario64DS from './SuperMario64DS/scenes.js';
import * as Scenes_Zelda_OcarinaOfTime from './zelview/scenes.js';
import * as Scenes_Zelda_OcarinaOfTime_Beta from './zelview/scenes_beta.js';
import * as Scenes_Zelda_OcarinaOfTime3D from './OcarinaOfTime3D/oot3d_scenes.js';
import * as Scenes_Zelda_MajorasMask3D from './OcarinaOfTime3D/mm3d_scenes.js';
import * as Scenes_LuigisMansion3D from './OcarinaOfTime3D/lm3d_scenes.js';
import * as Scenes_DarkSoulsCollision from './DarkSoulsCollisionData/scenes.js';
import * as Scenes_MetroidPrime from './MetroidPrime/scenes.js';
import * as Scenes_DonkeyKong64 from './DonkeyKong64/scenes.js';
import * as Scenes_DonkeyKongCountryReturns from './MetroidPrime/dkcr_scenes.js';
import * as Scenes_LuigisMansion from './LuigisMansion/scenes.js';
import * as Scenes_PaperMario_TheThousandYearDoor from './PaperMarioTTYD/Scenes_PaperMarioTTYD.js';
import * as Scenes_SuperPaperMario from './PaperMarioTTYD/Scenes_SuperPaperMario.js';
import * as Scenes_MarioKartDS from './nns_g3d/Scenes_MarioKartDS.js';
import * as Scenes_NewSuperMarioBrosDS from './nns_g3d/nsmbds_scenes.js';
import * as Scenes_KingdomHearts from './KingdomHearts/scenes.js';
import * as Scenes_KingdomHeartsIIFinalMix from './KingdomHearts2FinalMix/scenes.js';
import * as Scenes_Psychonauts from './psychonauts/scenes.js';
import * as Scenes_DarkSouls from './DarkSouls/scenes.js';
import * as Scenes_KatamariDamacy from './KatamariDamacy/scenes.js';
import * as Scenes_PaperMario64 from './PaperMario64/scenes.js';
import * as Scenes_Elebits from './rres/Scenes_Elebits.js';
import * as Scenes_KirbysReturnToDreamLand from './rres/Scenes_KirbysReturnToDreamLand.js';
import * as Scenes_Klonoa from './rres/Scenes_Klonoa.js';
import * as Scenes_MarioAndSonicAtThe2012OlympicGames from './rres/Scenes_MarioAndSonicAtTheOlympicGames2012.js';
import * as Scenes_MarioKartWii from './MarioKartWii/Scenes_MarioKartWii.js';
import * as Scenes_Okami from './rres/Scenes_Okami.js';
import * as Scenes_SonicColors from './rres/Scenes_SonicColors.js';
import * as Scenes_SuperSmashBrosBrawl from './rres/Scenes_SuperSmashBrosBrawl.js';
import * as Scenes_Test from './Scenes_Test.js';
import * as Scenes_WiiSports from './WiiSports/Scenes_WiiSports.js';
import * as Scenes_WiiSportsResort from './WiiSports/Scenes_WiiSportsResort.js';
import * as Scenes_Zelda_SkywardSword from './ZeldaSkywardSword/Main.js';
import * as Scenes_InteractiveExamples from './InteractiveExamples/Scenes.js';
import * as Scenes_Pilotwings64 from './Pilotwings64/Scenes.js';
import * as Scenes_Fez from './Fez/Scenes_Fez.js';
import * as Scenes_StarFoxAdventures from './StarFoxAdventures/scenes.js';
import * as Scenes_SuperMarioOdyssey from './fres_nx/smo_scenes.js';
import * as Scenes_GTA from './GrandTheftAuto3/scenes.js';
import * as Scenes_SpongeBobBFBB from './HeavyIron/Scenes_BFBB.js';
import * as Scenes_SpongeBobTSSM from './HeavyIron/Scenes_TSSM.js';
import * as Scenes_SuperSmashBrosMelee from './SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js';
import * as Scenes_PokemonSnap from './PokemonSnap/scenes.js';
import * as Scenes_MetroidPrimeHunters from './MetroidPrimeHunters/Scenes_MetroidPrimeHunters.js';
import * as Scenes_PokemonPlatinum from './nns_g3d/Scenes_PokemonPlatinum.js';
import * as Scenes_PokemonHGSS from './nns_g3d/Scenes_PokemonHGSS.js';
import * as Scenes_WiiUTransferTool from './rres/Scenes_WiiUTransferTool.js';
import * as Scenes_GoldenEye007 from './GoldenEye007/Scenes_GoldenEye007.js';
import * as Scenes_BanjoTooie from './BanjoTooie/scenes.js';
import * as Scenes_SunshineWater from './InteractiveExamples/SunshineWater.js';
import * as Scenes_CounterStrikeSource from './SourceEngine/Scenes_CounterStrikeSource.js';
import * as Scenes_CounterStrikeGO from './SourceEngine/Scenes_CounterStrikeGO.js';
import * as Scenes_HalfLife2 from './SourceEngine/Scenes_HalfLife2.js';
import * as Scenes_HalfLife2DM from './SourceEngine/Scenes_HalfLife2DM.js';
import * as Scenes_HalfLife2LostCoast from './SourceEngine/Scenes_HalfLife2LostCoast.js';
import * as Scenes_HalfLife2Ep1 from './SourceEngine/Scenes_HalfLife2Ep1.js';
import * as Scenes_HalfLife2Ep2 from './SourceEngine/Scenes_HalfLife2Ep2.js';
import * as Scenes_NfsMostWanted from './NeedForSpeedMostWanted/scenes.js';
import * as Scenes_TeamFortress2 from './SourceEngine/Scenes_TeamFortress2.js';
import * as Scenes_Left4Dead2 from './SourceEngine/Scenes_Left4Dead2.js';
import * as Scenes_Portal from './SourceEngine/Scenes_Portal.js';
import * as Scenes_Portal2 from './SourceEngine/Scenes_Portal2.js';
import * as Scenes_TheStanleyParable from './SourceEngine/Scenes_TheStanleyParable.js';
import * as Scenes_Infra from './SourceEngine/Scenes_Infra.js';
import * as Scenes_NeoTokyo from './SourceEngine/Scenes_NeoTokyo.js';
import * as Scenes_BeetleAdventureRacing from './BeetleAdventureRacing/Scenes.js';
import * as Scenes_TheWitness from './TheWitness/Scenes_TheWitness.js';
import * as Scenes_FFX from './FinalFantasyX/scenes.js';
import * as Scenes_WiiBanner from './Common/NW4R/lyt/Scenes_WiiBanner.js';
import * as Scenes_DiddyKongRacing from './DiddyKongRacing/scenes.js';
import * as Scenes_SpongebobRevengeOfTheFlyingDutchman from "./SpongebobRevengeOfTheFlyingDutchman/scenes.js";
import * as Scenes_MarioKart8Deluxe from './MarioKart8Deluxe/Scenes.js';
import * as Scenes_JetSetRadio from './JetSetRadio/Scenes.js';
import * as Scenes_Halo1 from './Halo1/scenes.js';
import * as Scenes_WorldOfWarcraft from './WorldOfWarcraft/scenes.js';
import * as Scenes_Glover from './Glover/scenes.js';
import * as Scenes_HalfLife from './GoldSrc/Scenes_HalfLife.js';
import * as Scenes_SuperMonkeyBall from './SuperMonkeyBall/Scenes_SuperMonkeyBall.js';
import * as Scenes_DragonQuest8 from './DragonQuest8/scenes.js';
import * as Scenes_Morrowind from './Morrowind/Scenes.js';
import * as Scenes_EstrangedActI from './SourceEngine/Scenes_EstrangedActI.js';
import * as Scenes_AShortHike from './AShortHike/Scenes.js';
import * as Scenes_NeonWhite from './NeonWhite/Scenes.js';
import * as Scenes_OuterWilds from './OuterWilds/Scenes.js';
import * as Scenes_CrashWarped from './CrashWarped/scenes.js';
import * as Scenes_PlusForXP from './PlusForXP/scenes.js';
import * as Scenes_MarioKart64 from './MarioKart64/scenes.js';
import * as Scenes_KirbyAirRide from './KirbyAirRide/scenes.js';
import * as Scenes_TokyoMirageSessionsSharpFE from './TokyoMirageSessionsSharpFE/scenes.js';

import { DroppedFileSceneDesc, traverseFileSystemDataTransfer } from './Scenes_FileDrops.js';

import { UI, Panel } from './ui.js';
import { serializeCamera, deserializeCamera, FPSCameraController } from './Camera.js';
import { assertExists, assert, arrayRemoveIfExist } from './util.js';
import { loadRustLib } from './rustlib.js';
import { DataFetcher } from './DataFetcher.js';
import { atob, btoa } from './Ascii85.js';
import { mat4 } from 'gl-matrix';
import { GlobalSaveManager, SaveStateLocation } from './SaveManager.js';
import { RenderStatistics } from './RenderStatistics.js';
import { Color } from './Color.js';
import { standardFullClearRenderPassDescriptor } from './gfx/helpers/RenderGraphHelpers.js';

import { SceneDesc, SceneGroup, SceneContext, Destroyable } from './SceneBase.js';
import { prepareFrameDebugOverlayCanvas2D } from './DebugJunk.js';
import { downloadBlob } from './DownloadUtils.js';
import { DataShare } from './DataShare.js';
import InputManager from './InputManager.js';
import { WebXRContext } from './WebXR.js';
import { debugJunk } from './DebugJunk.js';
import { IS_DEVELOPMENT } from './BuildVersion.js';
import { GfxPlatform } from './gfx/platform/GfxPlatform.js';

const sceneGroups: (string | SceneGroup)[] = [
    "Wii",
    Scenes_MarioKartWii.sceneGroup,
    Scenes_KirbysReturnToDreamLand.sceneGroup,
    Scenes_Klonoa.sceneGroup,
    Scenes_Zelda_SkywardSword.sceneGroup,
    Scenes_Okami.sceneGroup,
    Scenes_SuperMarioGalaxy1.sceneGroup,
    Scenes_SuperMarioGalaxy2.sceneGroup,
    Scenes_SuperPaperMario.sceneGroup,
    Scenes_SuperSmashBrosBrawl.sceneGroup,
    Scenes_WiiSports.sceneGroup,
    Scenes_WiiSportsResort.sceneGroup,
    "GameCube",
    Scenes_LuigisMansion.sceneGroup,
    Scenes_MarioKartDoubleDash.sceneGroup,
    Scenes_MetroidPrime.sceneGroupMP1,
    Scenes_MetroidPrime.sceneGroupMP2,
    Scenes_PaperMario_TheThousandYearDoor.sceneGroup,
    Scenes_Pikmin2.sceneGroup,
    Scenes_StarFoxAdventures.sceneGroup,
    Scenes_SuperMonkeyBall.sceneGroup,
    Scenes_SuperMarioSunshine.sceneGroup,
    Scenes_ZeldaTwilightPrincess.sceneGroup,
    Scenes_ZeldaWindWaker.sceneGroup,
    "Nintendo 3DS",
    Scenes_LuigisMansion3D.sceneGroup,
    Scenes_Zelda_MajorasMask3D.sceneGroup,
    Scenes_Zelda_OcarinaOfTime3D.sceneGroup,
    "Nintendo DS",
    Scenes_MarioKartDS.sceneGroup,
    Scenes_MetroidPrimeHunters.sceneGroup,
    Scenes_NewSuperMarioBrosDS.sceneGroup,
    Scenes_PokemonPlatinum.sceneGroup,
    Scenes_PokemonHGSS.sceneGroup,
    Scenes_SuperMario64DS.sceneGroup,
    "Nintendo 64",
    Scenes_BanjoKazooie.sceneGroup,
    Scenes_BanjoTooie.sceneGroup,
    Scenes_BeetleAdventureRacing.sceneGroup,
    Scenes_DiddyKongRacing.sceneGroup,
    Scenes_Glover.sceneGroup,
    Scenes_MarioKart64.sceneGroup,
    Scenes_PaperMario64.sceneGroup,
    Scenes_Pilotwings64.sceneGroup,
    Scenes_PokemonSnap.sceneGroup,
    Scenes_Zelda_OcarinaOfTime.sceneGroup,
    "PlayStation 2",
    Scenes_DragonQuest8.sceneGroup,
    Scenes_FFX.sceneGroup,
    Scenes_GTA.sceneGroup.iii,
    Scenes_KatamariDamacy.sceneGroup,
    Scenes_KingdomHearts.sceneGroup,
    Scenes_KingdomHeartsIIFinalMix.sceneGroup,
    "Xbox",
    Scenes_SpongeBobBFBB.sceneGroup,
    Scenes_SpongeBobTSSM.sceneGroup,
    "PC",
    Scenes_DarkSouls.sceneGroup,
    Scenes_DarkSoulsCollision.sceneGroup,
    Scenes_Fez.sceneGroup,
    Scenes_CounterStrikeSource.sceneGroup,
    Scenes_HalfLife2.sceneGroup,
    Scenes_HalfLife2DM.sceneGroup,
    Scenes_Halo1.sceneGroup,
    Scenes_NfsMostWanted.sceneGroup,
    Scenes_TeamFortress2.sceneGroup,
    Scenes_Portal.sceneGroup,
    Scenes_Portal2.sceneGroup,
    Scenes_WorldOfWarcraft.vanillaSceneGroup,
    Scenes_WorldOfWarcraft.bcSceneGroup,
    Scenes_WorldOfWarcraft.wotlkSceneGroup,
    "Experimental",
    Scenes_CrashWarped.sceneGroup,
    Scenes_PlusForXP.sceneGroup,
    Scenes_DonkeyKong64.sceneGroup,
    Scenes_DonkeyKongCountryReturns.sceneGroup,
    Scenes_Elebits.sceneGroup,
    Scenes_GTA.sceneGroup.vc,
    Scenes_GTA.sceneGroup.sa,
    Scenes_MarioAndSonicAtThe2012OlympicGames.sceneGroup,
    Scenes_MetroidPrime.sceneGroupMP3,
    Scenes_Psychonauts.sceneGroup,
    Scenes_SpongebobRevengeOfTheFlyingDutchman.sceneGroup,
    Scenes_SonicColors.sceneGroup,
    Scenes_SuperMarioOdyssey.sceneGroup,
    Scenes_SuperSmashBrosMelee.sceneGroup,
    Scenes_KirbyAirRide.sceneGroup,
    Scenes_WiiUTransferTool.sceneGroup,
    Scenes_GoldenEye007.sceneGroup,
    Scenes_Test.sceneGroup,
    Scenes_InteractiveExamples.sceneGroup,
    Scenes_SunshineWater.sceneGroup,
    Scenes_TheWitness.sceneGroup,
    Scenes_WiiBanner.sceneGroup,
    Scenes_Zelda_OcarinaOfTime_Beta.sceneGroup,
    Scenes_CounterStrikeGO.sceneGroup,
    Scenes_HalfLife2LostCoast.sceneGroup,
    Scenes_HalfLife2Ep1.sceneGroup,
    Scenes_HalfLife2Ep2.sceneGroup,
    Scenes_MarioKart8Deluxe.sceneGroup,
    Scenes_TheStanleyParable.sceneGroup,
    Scenes_Infra.sceneGroup,
    Scenes_JetSetRadio.sceneGroup,
    Scenes_HalfLife.sceneGroup,
    Scenes_Left4Dead2.sceneGroup,
    Scenes_NeoTokyo.sceneGroup,
    Scenes_Morrowind.sceneGroup,
    Scenes_EstrangedActI.sceneGroup,
    Scenes_AShortHike.sceneGroup,
    Scenes_NeonWhite.sceneGroup,
    Scenes_OuterWilds.sceneGroup,
    Scenes_TokyoMirageSessionsSharpFE.sceneGroup,
];

enum SaveStatesAction {
    Load,
    LoadDefault,
    Save,
    Delete
};

class SceneDatabase {
    private sceneDescToGroup = new Map<SceneDesc, SceneGroup>();
    private sceneDescToId = new Map<SceneDesc, string>();
    private idToSceneDesc = new Map<string, SceneDesc>();

    public onchanged: (() => void) | null = null;

    constructor(public sceneGroups: (SceneGroup | string)[]) {
        for (const sceneGroup of sceneGroups) {
            if (typeof sceneGroup !== "object")
                continue;

            for (const sceneDesc of sceneGroup.sceneDescs)
                if (typeof sceneDesc === "object")
                    this.addSceneDesc(sceneGroup, sceneDesc);

            if (sceneGroup.sceneIdMap !== undefined) {
                for (const [altSceneId, sceneId] of sceneGroup.sceneIdMap) {
                    const altSceneDescId = `${sceneGroup.id}/${altSceneId}`;
                    const sceneDescId = `${sceneGroup.id}/${sceneId}`;
                    const sceneDesc = assertExists(this.idToSceneDesc.get(sceneDescId));
                    this.idToSceneDesc.set(altSceneDescId, sceneDesc);
                }
            }
        }
    }

    private _makeSceneDescId(sceneGroup: SceneGroup, sceneDesc: SceneDesc): string {
        return `${sceneGroup.id}/${sceneDesc.id}`;
    }

    public getSceneDescId(sceneDesc: SceneDesc): string {
        return this.sceneDescToId.get(sceneDesc)!;
    }

    public getSceneDescGroup(sceneDesc: SceneDesc): SceneGroup {
        return this.sceneDescToGroup.get(sceneDesc)!;
    }

    public getSceneDescForId(sceneDescId: string): SceneDesc | null {
        return this.idToSceneDesc.get(sceneDescId) ?? null;
    }

    public addSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc): void {
        assert(sceneGroup.sceneDescs.includes(sceneDesc));
        const id = this._makeSceneDescId(sceneGroup, sceneDesc);
        this.sceneDescToGroup.set(sceneDesc, sceneGroup);
        this.sceneDescToId.set(sceneDesc, id);
        this.idToSceneDesc.set(id, sceneDesc);

        if (this.onchanged !== null)
            this.onchanged();
    }
}

type TimeState = { isPlaying: boolean, sceneTimeScale: number, sceneTime: number };

class AnimationLoop {
    public time: number = 0.0;
    public fpsLimit: number = -1;

    // Callback that will be called when we should render a frame.
    public onupdate!: () => void;

    // Call when a frame is requested from the underlying API.
    public frameRequested = (): void => {
        const newTime = window.performance.now();

        if (this.fpsLimit > 0) {
            const millisecondsPerFrame = 1000 / this.fpsLimit;
            const millisecondsSinceLastFrame = newTime - this.time;

            // Allow up to half a frame early.
            const minNextFrameTime = millisecondsPerFrame / 2;

            if (millisecondsSinceLastFrame < minNextFrameTime)
                return;
        }

        this.time = newTime;
        this.onupdate();
    };
}

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public ui: UI;
    public saveManager = GlobalSaveManager;

    private preferredPlatforms: GfxPlatform[] = [];

    private droppedFileGroup: SceneGroup;
    private sceneDatabase = new SceneDatabase(sceneGroups);

    private currentSceneDesc: SceneDesc | null = null;

    private loadingSceneDesc: SceneDesc | null = null;
    private destroyablePool: Destroyable[] = [];
    private dataShare = new DataShare();
    private dataFetcher: DataFetcher;
    private lastUpdatedURLTimeSeconds: number = -1;

    private webXRContext: WebXRContext;
    private animationLoop = new AnimationLoop();

    private updateInfo: ViewerUpdateInfo = {
        time: 0.0,
        webXRContext: null,
    };

    public sceneTimeScale = 1.0;
    private isPlaying = false;
    private isFrameStep = false;

    public isEmbedMode = false;
    private pixelSize = 1;

    // Link to debugJunk so we can reference it from the DevTools.
    private debugJunk = debugJunk;

    constructor() {
        this.init();
    }

    public async init() {
        this.isEmbedMode = window.location.pathname === '/embed.html';

        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);

        this.toplevel.ondragover = (e) => {
            if (!e.dataTransfer || !e.dataTransfer.types.includes('Files'))
                return;
            this.ui.dragHighlight.style.display = 'block';
            e.preventDefault();
        };
        this.toplevel.ondragleave = (e) => {
            this.ui.dragHighlight.style.display = 'none';
            e.preventDefault();
        };
        this.toplevel.ondrop = this._onDrop.bind(this);

        await loadRustLib();

        this.initializePlatforms();
        if (!await this.initializeViewer()) {
            return;
        }

        window.onresize = this._onResize.bind(this);

        this.animationLoop.onupdate = this.animationLoopOnUpdate.bind(this);

        this._makeUI();

        this.dataFetcher = new DataFetcher(this.ui.sceneSelect);
        await this.dataFetcher.init();

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        sceneGroups.push('Other');
        sceneGroups.push(this.droppedFileGroup);

        this.ui.sceneSelect.setSceneDatabase(this.sceneDatabase);

        window.onhashchange = this._onHashChange.bind(this);

        if (this.currentSceneDesc === null)
            this._loadInitialStateFromHash();

        if (this.currentSceneDesc === null) {
            // Make the user choose a scene if there's nothing loaded by default...
            this.ui.sceneSelect.setExpanded(true);
        }

        this._onRequestAnimationFrame();
    }

    private _reloadCurrentSceneDesc(sceneSaveState: string | null = null): void {
        if (sceneSaveState === null)
            sceneSaveState = this._getSceneSaveState();
        if (this.currentSceneDesc !== null)
            this._loadSceneDesc(this.currentSceneDesc, sceneSaveState, true);
    }

    private initializePlatforms(): void {
        let defaultPlatform = GfxPlatform.WebGL2;
        if (location.search.includes('webgpu'))
            defaultPlatform = GfxPlatform.WebGPU;

        this.preferredPlatforms = [];
        this.preferredPlatforms.push(defaultPlatform);
        this.preferredPlatforms.push(defaultPlatform === GfxPlatform.WebGPU ? GfxPlatform.WebGL2 : GfxPlatform.WebGPU);
    }

    private async initializeViewer(): Promise<boolean> {
        const platformsToTry = this.preferredPlatforms;
        assert(platformsToTry.length !== 0);

        // Create a new canvas.
        const canvas = document.createElement('canvas');
        const currentPlatform = this.viewer !== undefined ? this.viewer.gfxDevice.queryVendorInfo().platform : null;

        // No sense in trying to recreate the current platform.
        let error = InitErrorCode.SUCCESS;
        for (let i = 0; i < platformsToTry.length; i++) {
            const platform = platformsToTry[i];

            // Already good.
            if (platform === currentPlatform)
                return true;

            const ret = platform === GfxPlatform.WebGL2 ?
                await initializeViewerWebGL2(canvas) :
                await initializeViewerWebGPU(canvas);

            error = ret.error;
            if (error !== InitErrorCode.SUCCESS)
                continue;

            // Success; initialize.
            if (this.canvas !== undefined)
                this.toplevel.removeChild(this.canvas);

            this.canvas = canvas;
            this.canvas.style.imageRendering = 'pixelated';
            this.canvas.style.outline = 'none';
            this.canvas.style.touchAction = 'none';

            // Immediately resize the canvas.
            this._onResize();

            this.toplevel.appendChild(this.canvas);

            if (this.viewer !== undefined)
                this._destroyScene();

            assert(ret.viewer !== undefined);
            this.viewer = ret.viewer;

            this.webXRContext = new WebXRContext(this.viewer.gfxSwapChain);
            this.webXRContext.onframe = this.animationLoop.frameRequested;
            this.webXRContext.onsupportedchanged = this._syncWebXRSettingsVisible.bind(this);

            this.viewer.onstatistics = (statistics: RenderStatistics): void => {
                this.ui.statisticsPanel.addRenderStatistics(statistics);
            };
            this.viewer.oncamerachanged = (force: boolean) => {
                this._autoSaveState(force);
            };
            this.viewer.inputManager.ondraggingmodechanged = () => {
                this.ui.setDraggingMode(this.viewer.inputManager.getDraggingMode());
            };

            // HACK(jstpierre): Change the initialization here.
            if (this.ui !== undefined) {
                this.ui.setViewer(this.viewer);
                this._syncWebXRSettingsVisible();
            }

            return true;
        }

        assert(error !== InitErrorCode.SUCCESS);
        this.toplevel.appendChild(makeErrorUI(error));
        return false;
    }

    private async _swapPlatforms() {
        if (this.preferredPlatforms.length <= 1)
            return;

        const sceneSaveState = this._getSceneSaveState();

        this._destroyScene();

        // Wipe DataShare, since the data in there might be for the existing device/platform/
        this.dataShare.pruneOldObjects(this.viewer.gfxDevice, 0);

        // Shuffle around.
        const platform = this.preferredPlatforms.shift()!;
        this.preferredPlatforms.push(platform);
        await this.initializeViewer();

        this._reloadCurrentSceneDesc(sceneSaveState);
    }

    private setIsPlaying(v: boolean): void {
        if (this.isPlaying === v)
            return;

        this.isPlaying = v;
        this.ui.playPauseButton.setIsPlaying(v);

        if (IS_DEVELOPMENT)
            this._saveCurrentTimeState(this._getCurrentSceneDescId()!);
    }

    private _decodeHashString(hashString: string): [string, string] {
        let sceneDescId: string = '', sceneSaveState: string = '';
        const firstSemicolon = hashString.indexOf(';');
        if (firstSemicolon >= 0) {
            sceneDescId = hashString.slice(0, firstSemicolon);
            sceneSaveState = hashString.slice(firstSemicolon + 1);
        } else {
            sceneDescId = hashString;
        }

        return [sceneDescId, sceneSaveState];
    }

    private _decodeHash(): [string, string] {
        const hash = window.location.hash;
        if (hash.startsWith('#')) {
            return this._decodeHashString(decodeURIComponent(hash.slice(1)));
        } else {
            return ['', ''];
        }
    }

    private _onHashChange(): void {
        const [sceneDescId, sceneSaveState] = this._decodeHash();
        const sceneDesc = this.sceneDatabase.getSceneDescForId(sceneDescId);
        if (sceneDesc !== null)
            this._loadSceneDesc(sceneDesc, sceneSaveState);
    }

    private _loadInitialStateFromHash(): void {
        const [sceneDescId, sceneSaveState] = this._decodeHash();
        const sceneDesc = this.sceneDatabase.getSceneDescForId(sceneDescId);
        if (sceneDesc !== null) {
            // Load save slot 0 from session storage.
            const key = this.saveManager.getSaveStateSlotKey(sceneDescId, 0);
            const sceneState = this.saveManager.loadState(key) ?? sceneSaveState;
            this._loadSceneDesc(sceneDesc, sceneState);
        }
    }

    private _exportSaveData() {
        const saveData = this.saveManager.export();
        const date = new Date();
        downloadBlob(`noclip_export_${date.toISOString()}.nclsp`, new Blob([saveData]));
    }

    private _pickSaveStatesAction(inputManager: InputManager): SaveStatesAction {
        if (inputManager.isKeyDown('ShiftLeft'))
            return SaveStatesAction.Save;
        else if (inputManager.isKeyDown('AltLeft'))
            return SaveStatesAction.Delete;
        else
            return SaveStatesAction.Load;
    }

    private _checkKeyShortcuts() {
        const inputManager = this.viewer.inputManager;
        if (inputManager.isKeyDownEventTriggered('KeyZ'))
            this._toggleUI();
        if (inputManager.isKeyDownEventTriggered('KeyT'))
            this.ui.sceneSelect.expandAndFocus();
        for (let i = 1; i <= 9; i++) {
            if (inputManager.isKeyDownEventTriggered('Digit'+i)) {
                if (this.currentSceneDesc) {
                    const key = this._getSaveStateSlotKey(i);
                    const action = this._pickSaveStatesAction(inputManager);
                    this.doSaveStatesAction(action, key);
                }
            }
        }

        if (inputManager.isKeyDownEventTriggered('Numpad3'))
            this._exportSaveData();
        if (inputManager.isKeyDownEventTriggered('Period'))
            this.setIsPlaying(!this.isPlaying);
        if (inputManager.isKeyDown('Comma')) {
            this.setIsPlaying(false);
            this.isFrameStep = true;
        }
        if (inputManager.isKeyDownEventTriggered('F4'))
            this._swapPlatforms();
        if (inputManager.isKeyDownEventTriggered('F9'))
            this._reloadCurrentSceneDesc();
    }

    private async _onWebXRStateRequested(state: boolean) {
        if (!this.webXRContext)
            return;

        if (state) {
            try {
                await this.webXRContext.start();
                if (!this.webXRContext.xrSession) {
                    return;
                }
                mat4.getTranslation(this.viewer.xrCameraController.offset, this.viewer.camera.worldMatrix);
                this.webXRContext.xrSession.addEventListener('end', () => {
                    this.ui.toggleWebXRCheckbox(false);
                });
            } catch(e) {
                console.error("Failed to start XR");
                this.ui.toggleWebXRCheckbox(false);
            }
        } else {
            this.webXRContext.end();
        }
    }

    private animationLoopOnUpdate(): void {
        this._checkKeyShortcuts();

        prepareFrameDebugOverlayCanvas2D();

        if (!this.viewer.externalControl) {
            this.updateInfo.time = this.animationLoop.time;
            this.updateInfo.webXRContext = this.webXRContext.xrSession !== null ? this.webXRContext : null;

            let sceneTimeScale = this.sceneTimeScale;
            if (this.isFrameStep) {
                sceneTimeScale /= 4.0;
                this.isFrameStep = false;
            } else if (!this.isPlaying) {
                sceneTimeScale = 0.0;
            }

            this.viewer.sceneTimeScale = sceneTimeScale;
            this.viewer.update(this.updateInfo);
        }

        this.ui.update();
    };

    private _onRequestAnimationFrame = (): void => {
        if (this.webXRContext.xrSession !== null) {
            // Currently presenting to XR. Skip the canvas render.
        } else {
            this.animationLoop.frameRequested();
        }

        window.requestAnimationFrame(this._onRequestAnimationFrame);
    };

    private async _onDrop(e: DragEvent) {
        this.ui.dragHighlight.style.display = 'none';

        if (!e.dataTransfer || e.dataTransfer.files.length === 0)
            return;

        e.preventDefault();
        const transfer = e.dataTransfer;
        const files = await traverseFileSystemDataTransfer(transfer);
        const sceneDesc = new DroppedFileSceneDesc(files);
        this.droppedFileGroup.sceneDescs.push(sceneDesc);
        this.sceneDatabase.addSceneDesc(this.droppedFileGroup, sceneDesc);
        this._loadSceneDesc(sceneDesc);
    }

    private _onResize() {
        resizeCanvas(this.canvas, window.innerWidth, window.innerHeight, window.devicePixelRatio / this.pixelSize);
    }

    private _saveStateTmp = new Uint8Array(512);
    private _saveStateView = new DataView(this._saveStateTmp.buffer);
    // TODO(jstpierre): Save this in main instead of having this called 8 bajillion times...
    private _getSceneSaveState() {
        let byteOffs = 0;

        const optionsBits = 0;
        this._saveStateView.setUint8(byteOffs, optionsBits);
        byteOffs++;

        byteOffs += serializeCamera(this._saveStateView, byteOffs, this.viewer.camera);

        // TODO(jstpierre): Pass DataView into serializeSaveState
        if (this.viewer.scene !== null && this.viewer.scene.serializeSaveState)
            byteOffs = this.viewer.scene.serializeSaveState(this._saveStateTmp.buffer as ArrayBuffer, byteOffs);

        const s = btoa(this._saveStateTmp, byteOffs);
        return `ShareData=${s}`;
    }

    private _loadSceneSaveStateVersion2(state: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, state);

        let byteOffs = 0;
        this.viewer.sceneTime = this._saveStateView.getFloat32(byteOffs + 0x00, true);
        byteOffs += 0x04;
        byteOffs += deserializeCamera(this.viewer.camera, this._saveStateView, byteOffs);
        if (this.viewer.scene !== null && this.viewer.scene.deserializeSaveState)
            byteOffs = this.viewer.scene.deserializeSaveState(this._saveStateTmp.buffer as ArrayBuffer, byteOffs, byteLength);

        if (this.viewer.cameraController !== null)
            this.viewer.cameraController.cameraUpdateForced();

        return true;
    }

    private _loadSceneSaveStateVersion3(state: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, state);

        let byteOffs = 0;
        const optionsBits = this._saveStateView.getUint8(byteOffs + 0x00);
        assert(optionsBits === 0);
        byteOffs++;

        byteOffs += deserializeCamera(this.viewer.camera, this._saveStateView, byteOffs);
        if (this.viewer.scene !== null && this.viewer.scene.deserializeSaveState)
            byteOffs = this.viewer.scene.deserializeSaveState(this._saveStateTmp.buffer as ArrayBuffer, byteOffs, byteLength);

        if (this.viewer.cameraController !== null)
            this.viewer.cameraController.cameraUpdateForced();

        return true;
    }

    private _tryLoadSceneSaveState(state: string): boolean {
        // Version 2 starts with ZNCA8, which is Ascii85 for 'NC\0\0'
        if (state.startsWith('ZNCA8') && state.endsWith('='))
            return this._loadSceneSaveStateVersion2(state.slice(5, -1));

        // Version 3 starts with 'A' and has no '=' at the end.
        if (state.startsWith('A'))
            return this._loadSceneSaveStateVersion3(state.slice(1));

        if (state.startsWith('ShareData='))
            return this._loadSceneSaveStateVersion3(state.slice(10));

        return false;
    }

    private _loadSceneSaveState(state: string | null): boolean {
        if (state === '' || state === null)
            return false;

        if (this._tryLoadSceneSaveState(state)) {
            // Force an update of the URL whenever we successfully load state...
            this._saveStateAndUpdateURL();
            return true;
        } else {
            return false;
        }
    }

    private _getCurrentSceneDescId() {
        if (this.currentSceneDesc === null)
            return null;

        return this.sceneDatabase.getSceneDescId(this.currentSceneDesc);
    }

    private _applyTimeState(timeState: TimeState): void {
        this.setIsPlaying(timeState.isPlaying);
        this.sceneTimeScale = timeState.sceneTimeScale;
        this.viewer.sceneTime = timeState.sceneTime;
    }

    private _loadTimeState(sceneDescId: string): TimeState | null {
        const timeStateKey = `TimeState/${sceneDescId}`;
        const timeStateStr = this.saveManager.loadStateFromLocation(timeStateKey, SaveStateLocation.SessionStorage);
        if (!timeStateStr)
            return null;

        const timeState = JSON.parse(timeStateStr) as TimeState;
        return timeState;
    }

    private _saveCurrentTimeState(sceneDescId: string): void {
        const timeState: TimeState = { isPlaying: this.isPlaying, sceneTimeScale: this.sceneTimeScale, sceneTime: this.viewer.sceneTime };
        const timeStateStr = JSON.stringify(timeState);
        const timeStateKey = `TimeState/${sceneDescId}`;
        this.saveManager.saveTemporaryState(timeStateKey, timeStateStr);
    }

    private _autoSaveState(forceUpdateURL: boolean = false) {
        if (this.currentSceneDesc === null)
            return;

        const sceneStateStr = this._getSceneSaveState();
        const currentSceneDescId = this._getCurrentSceneDescId()!;
        const key = this.saveManager.getSaveStateSlotKey(currentSceneDescId, 0);
        this.saveManager.saveTemporaryState(key, sceneStateStr);

        if (IS_DEVELOPMENT)
            this._saveCurrentTimeState(currentSceneDescId);

        const saveState = `${currentSceneDescId};${sceneStateStr}`;
        this.ui.setShareSaveState(saveState);

        let shouldUpdateURL = forceUpdateURL;
        if (!shouldUpdateURL) {
            const timeSeconds = window.performance.now() / 1000;
            const secondsElapsedSinceLastUpdatedURL = timeSeconds - this.lastUpdatedURLTimeSeconds;

            if (secondsElapsedSinceLastUpdatedURL >= 2)
                shouldUpdateURL = true;
        }

        if (shouldUpdateURL) {
            window.history.replaceState('', document.title, `#${saveState}`);

            const timeSeconds = window.performance.now() / 1000;
            this.lastUpdatedURLTimeSeconds = timeSeconds;
        }
    }

    private _saveStateAndUpdateURL(): void {
        this._autoSaveState(true);
    }

    private _getSaveStateSlotKey(slotIndex: number): string {
        return this.saveManager.getSaveStateSlotKey(assertExists(this._getCurrentSceneDescId()), slotIndex);
    }

    private _onSceneChanged(scene: SceneGfx, sceneStateStr: string | null, timeState: TimeState | null): void {
        scene.onstatechanged = () => {
            this._saveStateAndUpdateURL();
        };

        let scenePanels: Panel[] = [];
        if (scene.createPanels)
            scenePanels = scene.createPanels();
        this.ui.setScenePanels(scenePanels);

        // Force time to play when loading a map.
        this.setIsPlaying(true);

        const sceneDescId = this._getCurrentSceneDescId()!;
        this.saveManager.setCurrentSceneDescId(sceneDescId);

        if (scene.createCameraController !== undefined)
            this.viewer.setCameraController(scene.createCameraController());
        if (this.viewer.cameraController === null)
            this.viewer.setCameraController(new FPSCameraController());

        if (timeState !== null)
            this._applyTimeState(timeState);

        if (!this._loadSceneSaveState(sceneStateStr)) {
            const camera = this.viewer.camera;

            const key = this.saveManager.getSaveStateSlotKey(sceneDescId, 1);
            const didLoadCameraState = this._loadSceneSaveState(this.saveManager.loadState(key));

            if (!didLoadCameraState) {
                if (scene.getDefaultWorldMatrix !== undefined)
                    scene.getDefaultWorldMatrix(camera.worldMatrix);
                else
                    mat4.identity(camera.worldMatrix);
            }

            mat4.getTranslation(this.viewer.xrCameraController.offset, camera.worldMatrix);
        }

        this._saveStateAndUpdateURL();
        this.ui.sceneChanged();
    }

    private _onSceneDescSelected(sceneDesc: SceneDesc) {
        this._loadSceneDesc(sceneDesc);
    }

    private doSaveStatesAction(action: SaveStatesAction, key: string): void {
        if (action === SaveStatesAction.Save) {
            this.saveManager.saveState(key, this._getSceneSaveState());
        } else if (action === SaveStatesAction.Delete) {
            this.saveManager.deleteState(key);
        } else if (action === SaveStatesAction.Load) {
            const state = this.saveManager.loadState(key);
            this._loadSceneSaveState(state);
        } else if (action === SaveStatesAction.LoadDefault) {
            const state = this.saveManager.loadStateFromLocation(key, SaveStateLocation.Defaults);
            this._loadSceneSaveState(state);
        }
    }

    // How many previous scenes of data share contents to keep? Set it to 0 for leak checking.
    private get loadSceneDelta(): number {
        return this.saveManager.loadSetting("LoadSceneDelta", 1);
    }

    private set loadSceneDelta(v: number) {
        this.saveManager.saveSetting("LoadSceneDelta", v);
    }

    private _destroyScene(): void {
        const device = this.viewer.gfxDevice;

        // Tear down old scene.
        if (this.dataFetcher !== null)
            this.dataFetcher.abort();
        this.ui.destroyScene();
        if (this.viewer.scene && !this.destroyablePool.includes(this.viewer.scene))
            this.destroyablePool.push(this.viewer.scene);
        this.viewer.setScene(null);
        for (let i = 0; i < this.destroyablePool.length; i++)
            this.destroyablePool[i].destroy(device);
        this.destroyablePool.length = 0;
    }

    private _loadSceneDesc(sceneDesc: SceneDesc, sceneStateStr: string | null = null, force: boolean = false): void {
        if (this.currentSceneDesc === sceneDesc && !force) {
            this._loadSceneSaveState(sceneStateStr);
            return;
        }

        this._destroyScene();
        const sceneGroup = this.sceneDatabase.getSceneDescGroup(sceneDesc);

        // Unhide any hidden scene groups upon being loaded.
        if (sceneGroup.hidden)
            sceneGroup.hidden = false;

        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(sceneGroup, this.currentSceneDesc);

        this.ui.sceneSelect.setProgress(0);

        const device = this.viewer.gfxDevice;
        const dataFetcher = this.dataFetcher;
        dataFetcher.reset();
        const dataShare = this.dataShare;
        const uiContainer: HTMLElement = document.createElement('div');
        this.ui.sceneUIContainer.appendChild(uiContainer);
        const destroyablePool: Destroyable[] = this.destroyablePool;
        const inputManager = this.viewer.inputManager;
        inputManager.reset();
        const viewerInput = this.viewer.viewerRenderInput;

        const timeState = IS_DEVELOPMENT ? this._loadTimeState(this.sceneDatabase.getSceneDescId(sceneDesc)) : null;
        const initialSceneTime = timeState !== null ? timeState.sceneTime : 0;

        const context: SceneContext = {
            device, dataFetcher, dataShare, uiContainer, destroyablePool, inputManager, viewerInput, initialSceneTime,
        };

        // We save loadSceneDelta's worth of old objects -- the idea being that if you're navigating between similar
        // scenes, we want to keep stuff in the data share (e.g. going between two Mario Kart tracks, you want to
        // keep the models for the same objects so we don't need to redownload them). Any objects that haven't been
        // touched since then will get eliminated eventually.
        this.dataShare.pruneOldObjects(device, this.loadSceneDelta);

        if (this.loadSceneDelta === 0)
            this.viewer.gfxDevice.checkForLeaks();

        this.dataShare.loadNewScene();
        window.dispatchEvent(new Event('loadNewScene'));

        this.loadingSceneDesc = sceneDesc;
        const promise = sceneDesc.createScene(device, context);

        if (promise === null) {
            console.error(`Cannot load ${sceneDesc.id}. Probably an unsupported file extension.`);
            throw "whoops";
        }

        promise.then((scene: SceneGfx) => {
            if (this.loadingSceneDesc === sceneDesc) {
                dataFetcher.setProgress();
                this.loadingSceneDesc = null;
                this.viewer.setScene(scene);
                this._onSceneChanged(scene, sceneStateStr, timeState);
            }
        });

        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - noclip`;
    }

    private _makeUI() {
        this.ui = new UI(this.viewer);
        this.ui.setEmbedMode(this.isEmbedMode);
        this.toplevel.appendChild(this.ui.elem);
        this.ui.sceneSelect.onscenedescselected = this._onSceneDescSelected.bind(this);
        this.ui.xrSettings.onWebXRStateRequested = this._onWebXRStateRequested.bind(this);
        this.ui.playPauseButton.onplaypause = this.setIsPlaying.bind(this);
        this._syncWebXRSettingsVisible();
    }

    private _syncWebXRSettingsVisible(): void {
        this.ui.xrSettings.setVisible(this.webXRContext.isSupported);
    }

    private _toggleUI(visible?: boolean) {
        this.ui.toggleUI(visible);
    }

    private _getSceneDownloadPrefix() {
        const sceneGroup = this.sceneDatabase.getSceneDescGroup(this.currentSceneDesc!);
        const sceneId = this.currentSceneDesc!.id;
        const date = new Date();
        return `${sceneGroup.id}_${sceneId}_${date.toISOString()}`;
    }

    // Hooks for people who want to mess with stuff.
    public getStandardClearColor(): Color {
        return standardFullClearRenderPassDescriptor.clearColor as Color;
    }

    public get scene() {
        return this.viewer.scene;
    }
}

// Declare a "main" object for easy access.
declare global {
    interface Window {
        main: Main;
    }
}

window.main = new Main();

// Debug utilities.
declare global {
    interface Window {
        debug: any;
        debugObj: any;
        gl: any;
    }
}
