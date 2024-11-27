
/* @preserve The source code to this website is under the MIT license and can be found at https://github.com/magcius/noclip.website */

import { Viewer, SceneGfx, InitErrorCode, initializeViewer, makeErrorUI, resizeCanvas, ViewerUpdateInfo } from './viewer.js';

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
import * as Scenes_Subnautica from './Subnautica/scenes.js';
import * as Scenes_Halo1 from './Halo1/scenes.js';
import * as Scenes_WorldOfWarcraft from './WorldOfWarcraft/scenes.js';
import * as Scenes_Glover from './Glover/scenes.js';
import * as Scenes_HalfLife from './GoldSrc/Scenes_HalfLife.js';
import * as Scenes_SuperMonkeyBall from './SuperMonkeyBall/Scenes_SuperMonkeyBall.js';
import * as Scenes_DragonQuest8 from './DragonQuest8/scenes.js';
import * as Scenes_Morrowind from './Morrowind/Scenes.js';
import * as Scenes_EstrangedActI from './SourceEngine/Scenes_EstrangedActI.js';

import { DroppedFileSceneDesc, traverseFileSystemDataTransfer } from './Scenes_FileDrops.js';

import { UI, Panel } from './ui.js';
import { serializeCamera, deserializeCamera, FPSCameraController } from './Camera.js';
import { assertExists, assert } from './util.js';
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
    "Experimental",
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
    Scenes_Subnautica.sceneGroup,
    Scenes_WorldOfWarcraft.bcSceneGroup,
    Scenes_WorldOfWarcraft.wotlkSceneGroup,
    Scenes_HalfLife.sceneGroup,
    Scenes_Left4Dead2.sceneGroup,
    Scenes_NeoTokyo.sceneGroup,
    Scenes_Morrowind.sceneGroup,
    Scenes_EstrangedActI.sceneGroup,
];

function convertCanvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(assertExists(b)), 'image/png'));
}

const enum SaveStatesAction {
    Load,
    LoadDefault,
    Save,
    Delete
};

class AnimationLoop implements ViewerUpdateInfo {
    public time: number = 0;
    public webXRContext: WebXRContext | null = null;

    public onupdate: ((updateInfo: ViewerUpdateInfo) => void);

    // https://hackmd.io/lvtOckAtSrmIpZAwgtXptw#Use-requestPostAnimationFrame-not-requestAnimationFrame
    // https://github.com/WICG/requestPostAnimationFrame
    // https://github.com/gpuweb/gpuweb/issues/596#issuecomment-596769356

    // XXX(jstpierre): Disabled for now. https://bugs.chromium.org/p/chromium/issues/detail?id=1065012
    public useRequestPostAnimationFrame = false;

    private _timeoutCallback = (): void => {
        this.onupdate(this);
    };

    // Call this from within your requestAnimationFrame handler.
    public requestPostAnimationFrame = (): void => {
        this.time = window.performance.now();
        if (this.useRequestPostAnimationFrame)
            setTimeout(this._timeoutCallback, 0);
        else
            this.onupdate(this);
    };
}

function getSceneDescs(sceneGroup: SceneGroup): SceneDesc[] {
    return sceneGroup.sceneDescs.filter((g) => typeof g !== 'string') as SceneDesc[];
}

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public groups: (string | SceneGroup)[];
    public ui: UI;
    public saveManager = GlobalSaveManager;

    private droppedFileGroup: SceneGroup;

    private currentSceneGroup: SceneGroup | null = null;
    private currentSceneDesc: SceneDesc | null = null;

    private loadingSceneDesc: SceneDesc | null = null;
    private destroyablePool: Destroyable[] = [];
    private dataShare = new DataShare();
    private dataFetcher: DataFetcher;
    private lastUpdatedURLTimeSeconds: number = -1;

    private postAnimFrameCanvas = new AnimationLoop();
    private postAnimFrameWebXR = new AnimationLoop();
    private webXRContext: WebXRContext;

    public sceneTimeScale = 1.0;
    public isEmbedMode = false;
    private isFrameStep = false;
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

        this.canvas = document.createElement('canvas');
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.outline = 'none';
        this.canvas.style.touchAction = 'none';

        this.toplevel.appendChild(this.canvas);
        window.onresize = this._onResize.bind(this);
        this._onResize();

        await loadRustLib();

        const errorCode = await initializeViewer(this, this.canvas);
        if (errorCode !== InitErrorCode.SUCCESS) {
            this.toplevel.appendChild(makeErrorUI(errorCode));
            return;
        }

        this.webXRContext = new WebXRContext(this.viewer.gfxSwapChain);
        this.webXRContext.onframe = this.postAnimFrameWebXR.requestPostAnimationFrame;

        this.postAnimFrameCanvas.onupdate = this._onPostAnimFrameUpdate;

        // requestPostAnimationFrame breaks WebXR.
        this.postAnimFrameWebXR.webXRContext = this.webXRContext;
        this.postAnimFrameWebXR.useRequestPostAnimationFrame = false;
        this.postAnimFrameWebXR.onupdate = this._onPostAnimFrameUpdate;

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

        this.viewer.onstatistics = (statistics: RenderStatistics): void => {
            this.ui.statisticsPanel.addRenderStatistics(statistics);
        };
        this.viewer.oncamerachanged = (force: boolean) => {
            this._saveState(force);
        };
        this.viewer.inputManager.ondraggingmodechanged = () => {
            this.ui.setDraggingMode(this.viewer.inputManager.getDraggingMode());
        };

        this._makeUI();

        this.dataFetcher = new DataFetcher(this.ui.sceneSelect);
        await this.dataFetcher.init();

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push('Other');
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        window.onhashchange = this._onHashChange.bind(this);

        if (this.currentSceneDesc === null)
            this._onHashChange();

        if (this.currentSceneDesc === null) {
            // Load the state from session storage.
            const currentDescId = this.saveManager.getCurrentSceneDescId();
            if (currentDescId !== null) {
                // Load save slot 0.
                const key = this.saveManager.getSaveStateSlotKey(currentDescId, 0);
                const sceneState = this.saveManager.loadState(key);
                this._loadSceneDescById(currentDescId, sceneState);
            }
        }

        if (this.currentSceneDesc === null) {
            // Make the user choose a scene if there's nothing loaded by default...
            this.ui.sceneSelect.setExpanded(true);
        }

        this._onRequestAnimationFrameCanvas();
    }

    private _onHashChange(): void {
        const hash = window.location.hash;
        if (hash.startsWith('#'))
            this._loadState(decodeURIComponent(hash.slice(1)));
    }

    private _exportSaveData() {
        const saveData = this.saveManager.export();
        const date = new Date();
        downloadBlob(`noclip_export_${date.toISOString()}.nclsp`, new Blob([saveData]));
    }

    private pickSaveStatesAction(inputManager: InputManager): SaveStatesAction {
        if (inputManager.isKeyDown('ShiftLeft'))
            return SaveStatesAction.Save;
        else if (inputManager.isKeyDown('AltLeft'))
            return SaveStatesAction.Delete;
        else
            return SaveStatesAction.Load;
    }

    private checkKeyShortcuts() {
        const inputManager = this.viewer.inputManager;
        if (inputManager.isKeyDownEventTriggered('KeyZ'))
            this._toggleUI();
        if (inputManager.isKeyDownEventTriggered('KeyT'))
            this.ui.sceneSelect.expandAndFocus();
        for (let i = 1; i <= 9; i++) {
            if (inputManager.isKeyDownEventTriggered('Digit'+i)) {
                if (this.currentSceneDesc) {
                    const key = this._getSaveStateSlotKey(i);
                    const action = this.pickSaveStatesAction(inputManager);
                    this.doSaveStatesAction(action, key);
                }
            }
        }

        if (inputManager.isKeyDownEventTriggered('Numpad3'))
            this._exportSaveData();
        if (inputManager.isKeyDownEventTriggered('Period'))
            this.ui.togglePlayPause();
        if (inputManager.isKeyDown('Comma')) {
            this.ui.togglePlayPause(false);
            this.isFrameStep = true;
        }
        if (inputManager.isKeyDownEventTriggered('F9'))
            this._loadSceneDesc(this.currentSceneGroup!, this.currentSceneDesc!, this._getSceneSaveState(), true);
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

    private _onPostAnimFrameUpdate = (updateInfo: ViewerUpdateInfo): void => {
        this.checkKeyShortcuts();

        prepareFrameDebugOverlayCanvas2D();

        // Needs to be called before this.viewer.update()
        const shouldTakeScreenshot = this.viewer.inputManager.isKeyDownEventTriggered('Numpad7') || this.viewer.inputManager.isKeyDownEventTriggered('BracketRight');

        let sceneTimeScale = this.sceneTimeScale;
        if (!this.ui.isPlaying) {
            if (this.isFrameStep) {
                sceneTimeScale /= 4.0;
                this.isFrameStep = false;
            } else {
                sceneTimeScale = 0.0;
            }
        }

        if (!this.viewer.externalControl) {
            this.viewer.sceneTimeScale = sceneTimeScale;
            this.viewer.update(updateInfo);
        }

        if (shouldTakeScreenshot)
            this._takeScreenshot();

        this.ui.update();
    };

    private _onRequestAnimationFrameCanvas = (): void => {
        if (this.webXRContext.xrSession !== null) {
            // Currently presenting to XR. Skip the canvas render.
        } else {
            this.postAnimFrameCanvas.requestPostAnimationFrame();
        }

        window.requestAnimationFrame(this._onRequestAnimationFrameCanvas);
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
        this._loadSceneGroups();
        this._loadSceneDesc(this.droppedFileGroup, sceneDesc);
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

    private _loadSceneDescById(id: string, sceneState: string | null): void {
        const [groupId, ...sceneRest] = id.split('/');
        let sceneId = decodeURIComponent(sceneRest.join('/'));

        const group = this.groups.find((g) => typeof g !== 'string' && g.id === groupId) as SceneGroup;
        if (!group)
            return;

        if (group.sceneIdMap !== undefined && group.sceneIdMap.has(sceneId))
            sceneId = group.sceneIdMap.get(sceneId)!;

        const desc = getSceneDescs(group).find((d) => d.id === sceneId);
        if (!desc)
            return;

        this._loadSceneDesc(group, desc, sceneState);
    }

    private _loadState(state: string) {
        let sceneDescId: string = '', sceneSaveState: string = '';
        const firstSemicolon = state.indexOf(';');
        if (firstSemicolon >= 0) {
            sceneDescId = state.slice(0, firstSemicolon);
            sceneSaveState = state.slice(firstSemicolon + 1);
        } else {
            sceneDescId = state;
        }

        return this._loadSceneDescById(sceneDescId, sceneSaveState);
    }

    private _getCurrentSceneDescId() {
        if (this.currentSceneGroup === null || this.currentSceneDesc === null)
            return null;

        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        return `${groupId}/${sceneId}`;
    }

    private _saveState(forceUpdateURL: boolean = false) {
        if (this.currentSceneGroup === null || this.currentSceneDesc === null)
            return;

        const sceneStateStr = this._getSceneSaveState();
        const currentDescId = this._getCurrentSceneDescId()!;
        const key = this.saveManager.getSaveStateSlotKey(currentDescId, 0);
        this.saveManager.saveTemporaryState(key, sceneStateStr);

        const saveState = `${currentDescId};${sceneStateStr}`;
        this.ui.setSaveState(saveState);

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
        this._saveState(true);
    }

    private _getSaveStateSlotKey(slotIndex: number): string {
        return this.saveManager.getSaveStateSlotKey(assertExists(this._getCurrentSceneDescId()), slotIndex);
    }

    private _onSceneChanged(scene: SceneGfx, sceneStateStr: string | null): void {
        scene.onstatechanged = () => {
            this._saveStateAndUpdateURL();
        };

        let scenePanels: Panel[] = [];
        if (scene.createPanels)
            scenePanels = scene.createPanels();
        this.ui.setScenePanels(scenePanels);
        // Force time to play when loading a map.
        this.ui.togglePlayPause(true);

        const sceneDescId = this._getCurrentSceneDescId()!;
        this.saveManager.setCurrentSceneDescId(sceneDescId);
        this._saveStateAndUpdateURL();

        if (scene.createCameraController !== undefined)
            this.viewer.setCameraController(scene.createCameraController());
        if (this.viewer.cameraController === null)
            this.viewer.setCameraController(new FPSCameraController());

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

        this.ui.sceneChanged();
    }

    private _onSceneDescSelected(sceneGroup: SceneGroup, sceneDesc: SceneDesc) {
        this._loadSceneDesc(sceneGroup, sceneDesc);
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

    private loadSceneDelta = 1;

    private _loadSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, sceneStateStr: string | null = null, force: boolean = false): void {
        if (this.currentSceneDesc === sceneDesc && !force) {
            this._loadSceneSaveState(sceneStateStr)
            return;
        }

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

        // Unhide any hidden scene groups upon being loaded.
        if (sceneGroup.hidden)
            sceneGroup.hidden = false;

        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(this.currentSceneGroup, this.currentSceneDesc);

        this.ui.sceneSelect.setProgress(0);

        const dataShare = this.dataShare;
        const dataFetcher = this.dataFetcher;
        dataFetcher.reset();
        const uiContainer: HTMLElement = document.createElement('div');
        this.ui.sceneUIContainer.appendChild(uiContainer);
        const destroyablePool: Destroyable[] = this.destroyablePool;
        const inputManager = this.viewer.inputManager;
        inputManager.reset();
        const viewerInput = this.viewer.viewerRenderInput;
        const context: SceneContext = {
            device, dataFetcher, dataShare, uiContainer, destroyablePool, inputManager, viewerInput,
        };

        // The age delta on pruneOldObjects determines whether any resources will be shared at all.
        // delta = 0 means that we destroy the set of resources used by the previous scene, before
        // we increment the age below fore the "new" scene, which is the only proper way to do leak
        // checking. Typically, we allow one old scene's worth of contents.
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
                this._onSceneChanged(scene, sceneStateStr);
            }
        });

        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - noclip`;
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setSceneGroups(this.groups);
    }

    private _makeUI() {
        this.ui = new UI(this.viewer);
        this.ui.setEmbedMode(this.isEmbedMode);
        this.toplevel.appendChild(this.ui.elem);
        this.ui.sceneSelect.onscenedescselected = this._onSceneDescSelected.bind(this);
        this.ui.xrSettings.onWebXRStateRequested = this._onWebXRStateRequested.bind(this);

        this.webXRContext.onsupportedchanged = () => {
            this._syncWebXRSettingsVisible();
        };
        this._syncWebXRSettingsVisible();
    }

    private _syncWebXRSettingsVisible(): void {
        this.ui.xrSettings.setVisible(this.webXRContext.isSupported);
    }

    private _toggleUI(visible?: boolean) {
        this.ui.toggleUI(visible);
    }

    private _getSceneDownloadPrefix() {
        const groupId = this.currentSceneGroup!.id;
        const sceneId = this.currentSceneDesc!.id;
        const date = new Date();
        return `${groupId}_${sceneId}_${date.toISOString()}`;
    }

    private _takeScreenshot(opaque: boolean = true) {
        const canvas = this.viewer.takeScreenshotToCanvas(opaque);
        const filename = `${this._getSceneDownloadPrefix()}.png`;
        convertCanvasToPNG(canvas).then((blob) => downloadBlob(filename, blob));
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
