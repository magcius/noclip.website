
/* @preserve The source code to this website is under the MIT license and can be found at https://github.com/magcius/noclip.website */

import { Viewer, SceneGfxBase, InitErrorCode, initializeViewer, makeErrorUI, resizeCanvas, ViewerUpdateInfo } from './viewer';

import ArrayBufferSlice from './ArrayBufferSlice';

import * as Scenes_BanjoKazooie from './BanjoKazooie/scenes';
import * as Scenes_Zelda_TwilightPrincess from './j3d/ztp_scenes';
import * as Scenes_MarioKartDoubleDash from './j3d/mkdd_scenes';
import * as Scenes_Zelda_TheWindWaker from './WindWaker/zww_scenes';
import * as Scenes_SuperMarioSunshine from './j3d/sms_scenes';
import * as Scenes_Pikmin2 from './j3d/pik2_scenes';
import * as Scenes_SuperMarioGalaxy1 from './SuperMarioGalaxy/Scenes_SuperMarioGalaxy1';
import * as Scenes_SuperMarioGalaxy2 from './SuperMarioGalaxy/Scenes_SuperMarioGalaxy2';
import * as Scenes_SuperMario64DS from './SuperMario64DS/scenes';
import * as Scenes_Zelda_OcarinaOfTime from './zelview/scenes';
import * as Scenes_Zelda_OcarinaOfTime3D from './oot3d/oot3d_scenes';
import * as Scenes_Zelda_MajorasMask3D from './oot3d/mm3d_scenes';
import * as Scenes_LuigisMansion3D from './oot3d/lm3d_scenes';
import * as Scenes_DarkSoulsCollision from './DarkSoulsCollisionData/scenes';
import * as Scenes_MetroidPrime from './metroid_prime/scenes';
import * as Scenes_DonkeyKong64 from './DonkeyKong64/scenes';
import * as Scenes_DonkeyKongCountryReturns from './metroid_prime/dkcr_scenes';
import * as Scenes_LuigisMansion from './luigis_mansion/scenes';
import * as Scenes_PaperMario_TheThousandYearDoor from './PaperMarioTTYD/Scenes_PaperMarioTTYD';
import * as Scenes_SuperPaperMario from './PaperMarioTTYD/Scenes_SuperPaperMario';
import * as Scenes_MarioKartDS from './nns_g3d/Scenes_MarioKartDS';
import * as Scenes_NewSuperMarioBrosDS from './nns_g3d/nsmbds_scenes';
import * as Scenes_KingdomHearts from './kh/scenes';
import * as Scenes_KingdomHeartsIIFinalMix from './kh2fm/scenes';
import * as Scenes_Psychonauts from './psychonauts/scenes';
import * as Scenes_DarkSouls from './DarkSouls/scenes';
import * as Scenes_KatamariDamacy from './KatamariDamacy/scenes';
import * as Scenes_PaperMario64 from './PaperMario64/scenes';
import * as Scenes_Elebits from './rres/Scenes_Elebits';
import * as Scenes_KirbysReturnToDreamLand from './rres/Scenes_KirbysReturnToDreamLand';
import * as Scenes_Klonoa from './rres/Scenes_Klonoa';
import * as Scenes_MarioAndSonicAtThe2012OlympicGames from './rres/Scenes_MarioAndSonicAtTheOlympicGames2012';
import * as Scenes_MarioKartWii from './rres/Scenes_MarioKartWii';
import * as Scenes_Okami from './rres/Scenes_Okami';
import * as Scenes_SonicColors from './rres/Scenes_SonicColors';
import * as Scenes_SuperSmashBrosBrawl from './rres/Scenes_SuperSmashBrosBrawl';
import * as Scenes_Test from './Scenes_Test';
import * as Scenes_WiiSportsResort from './rres/Scenes_WiiSportsResort';
import * as Scenes_Zelda_SkywardSword from './rres/Scenes_Zelda_SkywardSword';
import * as Scenes_InteractiveExamples from './InteractiveExamples/Scenes';
import * as Scenes_Pilotwings64 from './Pilotwings64/Scenes';
import * as Scenes_Fez from './Fez/Scenes_Fez';
import * as Scenes_StarFoxAdventures from './StarFoxAdventures/scenes';
import * as Scenes_SuperMarioOdyssey from './fres_nx/smo_scenes';
import * as Scenes_GTA from './GrandTheftAuto3/scenes';
import * as Scenes_SpongeBobBFBB from './SpongeBobBFBB/scenes'
import * as Scenes_SuperSmashBrosMelee from './SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee';
import * as Scenes_PokemonSnap from './PokemonSnap/scenes';
import * as Scenes_MetroidPrimeHunters from './MetroidPrimeHunters/Scenes_MetroidPrimeHunters';
import * as Scenes_PokemonPlatinum from './nns_g3d/Scenes_PokemonPlatinum';
import * as Scenes_PokemonSoulSilver from './nns_g3d/Scenes_PokemonSoulSilver';
import * as Scenes_WiiUTransferTool from './rres/Scenes_WiiUTransferTool';
import * as Scenes_GoldenEye007 from './GoldenEye007/Scenes_GoldenEye007';
import * as Scenes_BanjoTooie from './BanjoTooie/scenes';
import * as Scenes_SunshineWater from './InteractiveExamples/SunshineWater';
import * as Scenes_HalfLife2 from './SourceEngine/Scenes_HalfLife2';
import * as Scenes_TeamFortress2 from './SourceEngine/Scenes_TeamFortress2';
import * as Scenes_Portal from './SourceEngine/Scenes_Portal';

import { DroppedFileSceneDesc, traverseFileSystemDataTransfer } from './Scenes_FileDrops';

import { UI } from './ui';
import { hexdump, assertExists, magicstr, assert } from './util';
import { DataFetcher } from './DataFetcher';
import { ZipFileEntry, makeZipFile } from './ZipFile';
import { GlobalSaveManager } from './SaveManager';
import { RenderStatistics } from './RenderStatistics';
import { Color } from './Color';
import { standardFullClearRenderPassDescriptor } from './gfx/helpers/RenderTargetHelpers';

import * as Sentry from '@sentry/browser';
import { debugJunk } from './DebugJunk';

import { GIT_REVISION, IS_DEVELOPMENT } from './BuildVersion';
import { SceneDesc, SceneGroup, Destroyable } from './SceneBase';
import { prepareFrameDebugOverlayCanvas2D } from './DebugJunk';
import { downloadBlob, downloadBuffer } from './DownloadUtils';
import { DataShare } from './DataShare';
import { WebXRContext } from './WebXR';
import { LocationLoadContext, LocationBase, LocationLoader, LocationCameraSettings } from './AAA_NewUI/SceneBase2';
import { SceneDescLocationLoader, SceneDescLocationCreator } from './AAA_NewUI/SceneDescLoader';
import { FPSCameraController } from './Camera';
import { mat4 } from 'gl-matrix';
import { GfxDevice } from './gfx/platform/GfxPlatform';

const sceneGroups = [
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
    Scenes_WiiSportsResort.sceneGroup,
    "GameCube",
    Scenes_LuigisMansion.sceneGroup,
    Scenes_MarioKartDoubleDash.sceneGroup,
    Scenes_MetroidPrime.sceneGroupMP1,
    Scenes_MetroidPrime.sceneGroupMP2,
    Scenes_PaperMario_TheThousandYearDoor.sceneGroup,
    Scenes_Pikmin2.sceneGroup,
    Scenes_SuperMarioSunshine.sceneGroup,
    Scenes_Zelda_TwilightPrincess.sceneGroup,
    Scenes_Zelda_TheWindWaker.sceneGroup,
    "Nintendo 3DS",
    Scenes_Zelda_MajorasMask3D.sceneGroup,
    Scenes_Zelda_OcarinaOfTime3D.sceneGroup,
    "Nintendo DS",
    Scenes_MarioKartDS.sceneGroup,
    Scenes_NewSuperMarioBrosDS.sceneGroup,
    Scenes_SuperMario64DS.sceneGroup,
    "Nintendo 64",
    Scenes_BanjoKazooie.sceneGroup,
    Scenes_PaperMario64.sceneGroup,
    Scenes_Pilotwings64.sceneGroup,
    Scenes_PokemonSnap.sceneGroup,
    "PlayStation 2",
    Scenes_GTA.sceneGroup.iii,
    Scenes_KatamariDamacy.sceneGroup,
    Scenes_KingdomHearts.sceneGroup,
    Scenes_KingdomHeartsIIFinalMix.sceneGroup,
    "Xbox",
    Scenes_SpongeBobBFBB.sceneGroup,
    "Experimental",
    Scenes_BanjoTooie.sceneGroup,
    Scenes_DarkSouls.sceneGroup,
    Scenes_DarkSoulsCollision.sceneGroup,
    Scenes_DonkeyKong64.sceneGroup,
    Scenes_DonkeyKongCountryReturns.sceneGroup,
    Scenes_Elebits.sceneGroup,
    Scenes_Fez.sceneGroup,
    Scenes_GTA.sceneGroup.vc,
    Scenes_GTA.sceneGroup.sa,
    Scenes_HalfLife2.sceneGroup,
    Scenes_LuigisMansion3D.sceneGroup,
    Scenes_MarioAndSonicAtThe2012OlympicGames.sceneGroup,
    Scenes_MetroidPrime.sceneGroupMP3,
    Scenes_MetroidPrimeHunters.sceneGroup,
    Scenes_PokemonPlatinum.sceneGroup,
    Scenes_PokemonSoulSilver.sceneGroup,
    Scenes_Psychonauts.sceneGroup,
    Scenes_SonicColors.sceneGroup,
    Scenes_StarFoxAdventures.sceneGroup,
    Scenes_SuperMarioOdyssey.sceneGroup,
    Scenes_SuperSmashBrosMelee.sceneGroup,
    Scenes_WiiUTransferTool.sceneGroup,
    Scenes_Zelda_OcarinaOfTime.sceneGroup,
    Scenes_GoldenEye007.sceneGroup,
    Scenes_Test.sceneGroup,
    Scenes_InteractiveExamples.sceneGroup,
    Scenes_SunshineWater.sceneGroup,
    Scenes_TeamFortress2.sceneGroup,
    Scenes_Portal.sceneGroup,
];

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Response(blob).arrayBuffer();
}

function convertCanvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(assertExists(b)), 'image/png'));
}

function getSceneGroups(sceneGroups: (SceneGroup | string)[]): SceneGroup[] {
    return sceneGroups.filter((g) => typeof g !== 'string') as SceneGroup[];
}

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

class SceneLoadContext implements LocationLoadContext {
    public oldLocation: LocationBase | null;

    public device: GfxDevice;
    public destroyablePool: Destroyable[] = [];
    public dataShare: DataShare;
    public dataFetcher: DataFetcher;
    public uiContainer: HTMLElement;
    public legacyUI: UI;
    public scene: SceneGfxBase | null = null;

    public onabort: ((context: LocationLoadContext) => void) | null = null;

    constructor(private main: Main, public location: LocationBase) {
        this.oldLocation = this.main.currentScene !== null ? this.main.currentScene.location : null;

        this.device = this.main.viewer.gfxDevice;
        this.dataShare = this.main.dataShare;
        this.dataFetcher = this.main.dataFetcher;
        this.legacyUI = this.main.ui;

        this.uiContainer = document.createElement('div');
    }

    public setScene(scene: SceneGfxBase): void {
        this.scene = scene;
        this.main.setCurrentScene(this, false);
    }

    public setOldScene(): void {
        this.scene = assertExists(this.main.currentScene).scene;
        this.main.setCurrentScene(this, true);
    }

    public setViewerLocation(location: LocationBase): void {
        this.main.setViewerLocation(location);
    }

    public destroy(): void {
        if (this.scene && !this.destroyablePool.includes(this.scene))
            this.destroyablePool.push(this.scene);
        for (let i = 0; i < this.destroyablePool.length; i++)
            this.destroyablePool[i].destroy(this.device);
        this.destroyablePool.length = 0;
    }

    public abort(): void {
        // Call the abort hook first, if necessary.
        if (this.scene === null && this.onabort !== null)
            this.onabort(this);
        this.destroy();
    }
}

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public groups: (string | SceneGroup)[];
    public ui: UI;
    public saveManager = GlobalSaveManager;
    public paused: boolean = false;

    private droppedFileGroup: SceneGroup;

    public dataShare = new DataShare();
    public dataFetcher: DataFetcher;

    // Generates locations from scene descs.
    private sceneDescLocationCreator: SceneDescLocationCreator;

    public loadingScene: SceneLoadContext | null = null;
    public currentScene: SceneLoadContext | null = null;
    public _locationRecommendations: LocationBase[] = [];

    private lastUpdatedURLTimeSeconds: number = -1;

    private postAnimFrameCanvas = new AnimationLoop();
    private postAnimFrameWebXR = new AnimationLoop();
    private webXRContext: WebXRContext;

    public sceneTimeScale = 1.0;
    public isEmbedMode = false;

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

        this.toplevel.appendChild(this.canvas);
        window.onresize = this._onResize.bind(this);
        this._onResize();

        this.viewer.onstatistics = (statistics: RenderStatistics): void => {
            this.ui.statisticsPanel.addRenderStatistics(statistics);
        };
        this.viewer.oncamerachanged = () => {
        };
        this.viewer.inputManager.onisdraggingchanged = () => {
            this.ui.setIsDragging(this.viewer.inputManager.isDragging());
        };

        this._makeUI();

        this.dataFetcher = new DataFetcher(this.ui.sceneSelect);
        await this.dataFetcher.init();

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push('Other');
        this.groups.push(this.droppedFileGroup);

        this.sceneDescLocationCreator = new SceneDescLocationCreator(this.groups, this.saveManager);
        this.registerLocationLoader(new SceneDescLocationLoader());

        this._loadSceneGroups();

        window.onhashchange = this._onHashChange.bind(this);

        this.ui.sceneSelect.setExpanded(true);

        this._onRequestAnimationFrameCanvas();

        if (!IS_DEVELOPMENT) {
            Sentry.init({
                dsn: 'https://a3b5f6c50bc04555835f9a83d6e76b23@sentry.io/1448331',
                beforeSend: (event) => {
                    // Filter out aborted XHRs.
                    if (event.exception!.values!.length) {
                        const exc = event.exception!.values![0];
                        if (exc.type === 'AbortedError')
                            return null;
                    }

                    return event;
                },
            });

            Sentry.configureScope((scope) => {
                scope.setExtra('git-revision', GIT_REVISION);
            });
        }
    }

    private _onHashChange(): void {
        // TODO(jstpierre): Load location by URL
    }

    private _exportSaveData() {
        const saveData = this.saveManager.export();
        const date = new Date();
        downloadBlob(`noclip_export_${date.toISOString()}.nclsp`, new Blob([saveData]));
    }

    private checkKeyShortcuts() {
        const inputManager = this.viewer.inputManager;
        if (inputManager.isKeyDownEventTriggered('KeyZ'))
            this._toggleUI();
        if (inputManager.isKeyDownEventTriggered('Numpad9'))
            this._downloadTextures();
        if (inputManager.isKeyDownEventTriggered('KeyT'))
            this.ui.sceneSelect.expandAndFocus();
        for (let i = 1; i <= 9; i++) {
            if (inputManager.isKeyDownEventTriggered('Digit'+i))
                if (this._locationRecommendations[i] !== undefined)
                    this._loadLocation(this._locationRecommendations[i]);
        }
        if (inputManager.isKeyDownEventTriggered('Numpad3'))
            this._exportSaveData();
        if (inputManager.isKeyDownEventTriggered('Period'))
            this.ui.togglePlayPause();
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

    public setPaused(v: boolean): void {
        this.paused = v;
    }

    private _onPostAnimFrameUpdate = (updateInfo: ViewerUpdateInfo): void => {
        this.checkKeyShortcuts();

        prepareFrameDebugOverlayCanvas2D();

        // Needs to be called before this.viewer.update()
        const shouldTakeScreenshot = this.viewer.inputManager.isKeyDownEventTriggered('Numpad7') || this.viewer.inputManager.isKeyDownEventTriggered('BracketRight');

        this.viewer.sceneTimeScale = this.ui.isPlaying ? this.sceneTimeScale : 0.0;

        this.viewer.update(updateInfo);

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
    }

    private _onResize() {
        resizeCanvas(this.canvas, window.innerWidth, window.innerHeight, window.devicePixelRatio);
    }

    private _onSceneDescSelected(sceneGroup: SceneGroup, sceneDesc: SceneDesc) {
        this._loadLocation(this.sceneDescLocationCreator.getLocationFromSceneDesc(sceneGroup, sceneDesc));
    }

    public loaderMap = new Map<string, LocationLoader>();
    private registerLocationLoader(loader: LocationLoader): void {
        this.loaderMap.set(loader.providerKey, loader);
    }

    private findLocationLoader(location: LocationBase): LocationLoader {
        return assertExists(this.loaderMap.get(location.loaderKey));
    }

    private _loadCameraSettings(cameraSettings: LocationCameraSettings): void {
        if (cameraSettings.kind === 'WASD') {
            this.viewer.setCameraController(new FPSCameraController());
            const camera = this.viewer.camera;
            const m = camera.worldMatrix;
            m[0]  = cameraSettings.worldMatrix[0];
            m[4]  = cameraSettings.worldMatrix[1];
            m[8]  = cameraSettings.worldMatrix[2];
            m[12] = cameraSettings.worldMatrix[3];
            m[1]  = cameraSettings.worldMatrix[4];
            m[5]  = cameraSettings.worldMatrix[5];
            m[9]  = cameraSettings.worldMatrix[6];
            m[13] = cameraSettings.worldMatrix[7];
            m[2]  = cameraSettings.worldMatrix[8];
            m[6]  = cameraSettings.worldMatrix[9];
            m[10] = cameraSettings.worldMatrix[10];
            m[14] = cameraSettings.worldMatrix[11];
            m[3]  = 0;
            m[7]  = 0;
            m[11] = 0;
            m[15] = 1;
            mat4.invert(camera.viewMatrix, camera.worldMatrix);
            camera.worldMatrixUpdated();
        } else if (cameraSettings.kind === 'Custom') {
            this.viewer.setCameraController(cameraSettings.cameraController);
        }
    }

    private loadSceneDelta = 1;

    private cleanupDataShare(): void {
        // The age delta on pruneOldObjects determines whether any resources will be shared at all.
        // delta = 0 means that we destroy the set of resources used by the previous scene, before
        // we increment the age below fore the "new" scene, which is the only proper way to do leak
        // checking. Typically, we allow one old scene's worth of contents.
        this.dataShare.pruneOldObjects(this.viewer.gfxDevice, this.loadSceneDelta);

        if (this.loadSceneDelta === 0)
            this.viewer.gfxDevice.checkForLeaks();
    }

    public setCurrentScene(sceneContext: SceneLoadContext, reuseExistingScene: boolean): void {
        if (this.loadingScene !== sceneContext) {
            // If this happens, it means that an abort wasn't respected.
            console.warn(`Abort was not respected`);
            return;
        }

        // Ensure that we set our progress at least once...
        this.loadingScene.dataFetcher.setProgress();

        // Stop loading the scene.
        this.loadingScene = null;

        if (!reuseExistingScene) {
            // Tear down the old scene.
            const oldScene = this.currentScene;
            if (oldScene !== null) {
                oldScene.destroy();
            }

            // At this stage, we can do a leak check / cleanup on the DataShare, if wanted.
            this.cleanupDataShare();

            // Swap in the new UI container.
            this.ui.destroyScene();
            this.ui.sceneUIContainer.appendChild(sceneContext.uiContainer);
            this.viewer.setScene(sceneContext.scene);
        }

        this.currentScene = sceneContext;
        this._generateLocationRecommendations();
    }

    public setViewerLocation(location: LocationBase): void {
        // Force time to play when loading a location.
        // TODO(jstpierre): Change this to a location parameter?
        this.ui.togglePlayPause(true);

        // Configure scene time if available.
        if (location.time !== undefined)
            this.viewer.sceneTime = location.time;

        if (location.cameraSettings !== undefined)
            this._loadCameraSettings(location.cameraSettings);
        else
            this.viewer.setCameraController(new FPSCameraController());
    }

    private _loadLocation(location: LocationBase): void {
        // If there's an existing scene being loaded, kill it and start over.
        if (this.loadingScene !== null) {
            // Also abort any ongoing loads.
            this.dataFetcher.abort();
            this.loadingScene.abort();
            this.loadingScene = null;
        }

        // Reset the DataFetcher, if we aborted it.
        this.dataFetcher.reset();

        // Advance the DataShare age counter.
        this.dataShare.loadNewScene();

        // Mark the scene as selected, and start loading.
        this.ui.sceneSelect.setProgress(0);
        this.ui.sceneSelect.setCurrentDesc(this.sceneDescLocationCreator.getSceneGroupFromLocation(location), this.sceneDescLocationCreator.getSceneDescFromLocation(location));

        assert(this.loadingScene === null);
        const locationLoader = this.findLocationLoader(location);

        this.loadingScene = new SceneLoadContext(this, location);
        const ret = locationLoader.loadLocation(this.loadingScene, location);

        if (!ret) {
            console.error(`Cannot load ${location.title}. Probably an unsupported file extension?`);
            throw "whoops";
        }

        // Set window title.
        document.title = `${location.fullTitle} - noclip`;

        // TODO(jstpierre): Invent some sort of "location ID"
        const sceneDescId = '';

        Sentry.addBreadcrumb({
            category: 'loadScene',
            message: sceneDescId,
        });

        Sentry.configureScope((scope) => {
            scope.setExtra('sceneDescId', sceneDescId);
        });
    }

    private _generateLocationRecommendations(): void {
        this._locationRecommendations = [];

        if (this.currentScene === null)
            return;

        for (let i = 1; i <= 9; i++) {
            const location = this.sceneDescLocationCreator.getLocationFromSaveState(this.currentScene.location, i);
            if (location === null)
                continue;
            this._locationRecommendations[i] = location;
        }
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setLocations([... this.sceneDescLocationCreator.getPublicLocations()]);
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
        /*
        const groupId = this.currentSceneGroup!.id;
        const sceneId = this.currentSceneDesc!.id;
        const date = new Date();
        return `${groupId}_${sceneId}_${date.toISOString()}`;
        */
        return '';
    }

    private _takeScreenshot(opaque: boolean = true) {
        const canvas = this.viewer.takeScreenshotToCanvas(opaque);
        const filename = `${this._getSceneDownloadPrefix()}.png`;
        convertCanvasToPNG(canvas).then((blob) => downloadBlob(filename, blob));
    }

    private async _makeTextureZipFile(): Promise<ZipFileEntry[]> {
        const viewerTextures = await this.ui.textureViewer.getViewerTextureList();

        const zipFileEntries: ZipFileEntry[] = [];
        const promises: Promise<void>[] = [];
        for (let i = 0; i < viewerTextures.length; i++) {
            const tex = viewerTextures[i];
            for (let j = 0; j < tex.surfaces.length; j++) {
                const filename = `${tex.name}_${j}.png`;
                promises.push(convertCanvasToPNG(tex.surfaces[j]).then((blob) => blobToArrayBuffer(blob)).then((buf) => {
                    const data = new ArrayBufferSlice(buf);
                    zipFileEntries.push({ filename, data });
                }));
            }
        }
        await Promise.all(promises);

        return zipFileEntries;
    }

    private _downloadTextures() {
        this._makeTextureZipFile().then((zipFileEntries) => {
            if (zipFileEntries.length === 0)
                return;

            const zipBuffer = makeZipFile(zipFileEntries);
            const filename = `${this._getSceneDownloadPrefix()}_Textures.zip`;
            downloadBuffer(filename, zipBuffer, 'application/zip');
        });
    }

    // Hooks for people who want to mess with stuff.
    public getStandardClearColor(): Color {
        return standardFullClearRenderPassDescriptor.colorClearColor;
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
