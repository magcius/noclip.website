
/* @preserve The source code to this website is under the MIT license and can be found at https://github.com/magcius/noclip.website */

// Parcel HMR workaround.
// https://github.com/parcel-bundler/parcel/issues/289
declare var module: any;
if (module.hot) {
    module.hot.dispose(() => {
        window.location.reload();
        throw new Error();
    });
}

import { Viewer, SceneGfx, InitErrorCode, initializeViewer, makeErrorUI } from './viewer';

import ArrayBufferSlice from './ArrayBufferSlice';

import * as Scenes_BanjoKazooie from './bk/scenes';
import * as Scenes_Zelda_TwilightPrincess from './j3d/ztp_scenes';
import * as Scenes_MarioKartDoubleDash from './j3d/mkdd_scenes';
import * as Scenes_Zelda_TheWindWaker from './j3d/WindWaker/zww_scenes';
import * as Scenes_SuperMarioSunshine from './j3d/sms_scenes';
import * as Scenes_Pikmin2 from './j3d/pik2_scenes';
import * as Scenes_SuperMarioGalaxy1 from './j3d/smg/smg1_scenes';
import * as Scenes_SuperMarioGalaxy2 from './j3d/smg/smg2_scenes';
import * as Scenes_SuperMario64DS from './sm64ds/scenes';
import * as Scenes_SonicMania from './sonic_mania/scenes';
import * as Scenes_Zelda_OcarinaOfTime3D from './oot3d/oot3d_scenes';
import * as Scenes_Zelda_MajorasMask3D from './oot3d/mm3d_scenes';
import * as Scenes_LuigisMansion3D from './oot3d/lm3d_scenes';
import * as Scenes_DarkSoulsCollision from './dksiv/scenes';
import * as Scenes_MetroidPrime from './metroid_prime/scenes';
import * as Scenes_DonkeyKongCountryReturns from './metroid_prime/dkcr_scenes';
import * as Scenes_LuigisMansion from './luigis_mansion/scenes';
import * as Scenes_PaperMario_TheThousandYearDoor from './ttyd/scenes';
import * as Scenes_SuperPaperMario from './ttyd/spm_scenes';
import * as Scenes_MarioKartDS from './nns_g3d/mkds_scenes';
import * as Scenes_NewSuperMarioBrosDS from './nns_g3d/nsmbds_scenes';
import * as Scenes_KingdomHearts from './kh/scenes';
import * as Scenes_KingdomHeartsIIFinalMix from './kh2fm/scenes';
import * as Scenes_Psychonauts from './psychonauts/scenes';
import * as Scenes_DarkSouls from './dks/scenes';
import * as Scenes_KatamariDamacy from './katamari_damacy/scenes';
import * as Scenes_PaperMario64 from './pm64/scenes';
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
import * as Scenes_InteractiveExamples from './interactive_examples/Scenes';

import { DroppedFileSceneDesc } from './Scenes_FileDrops';

import { UI, SaveStatesAction, Panel } from './ui';
import { serializeCamera, deserializeCamera, FPSCameraController } from './Camera';
import { hexdump } from './util';
import { DataFetcher } from './DataFetcher';
import { ZipFileEntry, makeZipFile } from './ZipFile';
import { atob, btoa } from './Ascii85';
import { vec3, mat4 } from 'gl-matrix';
import { GlobalSaveManager, SaveStateLocation } from './SaveManager';
import { RenderStatistics } from './RenderStatistics';
import { gfxDeviceGetImpl } from './gfx/platform/GfxPlatformWebGL2';
import { Color } from './Color';
import { standardFullClearRenderPassDescriptor } from './gfx/helpers/RenderTargetHelpers';

import * as Sentry from '@sentry/browser';
import { GIT_REVISION, IS_DEVELOPMENT } from './BuildVersion';
import { SceneDesc, SceneGroup, SceneContext, getSceneDescs, Destroyable } from './SceneBase';
import { prepareFrameDebugOverlayCanvas2D } from './DebugJunk';
import { downloadBlob, downloadBufferSlice, downloadBuffer } from './DownloadUtils';

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
    Scenes_LuigisMansion3D.sceneGroup,
    Scenes_Zelda_MajorasMask3D.sceneGroup,
    Scenes_Zelda_OcarinaOfTime3D.sceneGroup,
    "Nintendo DS",
    Scenes_MarioKartDS.sceneGroup,
    Scenes_NewSuperMarioBrosDS.sceneGroup,
    Scenes_SuperMario64DS.sceneGroup,
    "Nintendo 64",
    Scenes_BanjoKazooie.sceneGroup,
    Scenes_PaperMario64.sceneGroup,
    "PlayStation 2",
    Scenes_KatamariDamacy.sceneGroup,
    Scenes_KingdomHearts.sceneGroup,
    Scenes_KingdomHeartsIIFinalMix.sceneGroup,
    "Other",
    Scenes_DarkSoulsCollision.sceneGroup,
    Scenes_SonicMania.sceneGroup,
    "Experimental",
    Scenes_DarkSouls.sceneGroup,
    Scenes_DonkeyKongCountryReturns.sceneGroup,
    Scenes_Elebits.sceneGroup,
    Scenes_MarioAndSonicAtThe2012OlympicGames.sceneGroup,
    Scenes_MetroidPrime.sceneGroupMP3,
    Scenes_Psychonauts.sceneGroup,
    Scenes_SonicColors.sceneGroup,
    Scenes_Test.sceneGroup,
    Scenes_InteractiveExamples.sceneGroup,
];

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Response(blob).arrayBuffer();
}

function convertCanvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function writeString(d: Uint8Array, offs: number, m: string): number {
    const n = m.length;
    for (let i = 0; i < n; i++)
        d[offs++] = m.charCodeAt(i);
    return n;
}

function matchString(d: Uint8Array, offs: number, m: string): boolean {
    const n = m.length;
    for (let i = 0; i < n; i++)
        if (d[offs++] !== m.charCodeAt(i))
            return false;
    return true;
}

const SAVE_STATE_MAGIC = 'NC\0\0';
class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public groups: (string | SceneGroup)[];
    public ui: UI;
    public saveManager = GlobalSaveManager;

    private droppedFileGroup: SceneGroup;

    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;

    private loadingSceneDesc: SceneDesc = null;
    private abortController: AbortController | null = null;
    private destroyablePool: Destroyable[] = [];

    constructor() {
        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);

        this.canvas = document.createElement('canvas');

        const errorCode = initializeViewer(this, this.canvas);
        if (errorCode !== InitErrorCode.SUCCESS) {
            this.toplevel.appendChild(makeErrorUI(errorCode));
            return;
        }

        this.toplevel.ondragover = (e) => {
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
            this._saveState();
        };
        this.viewer.inputManager.onisdraggingchanged = () => {
            this.ui.setIsDragging(this.viewer.inputManager.isDragging());
        };

        this._makeUI();

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push('Other');
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        window.onhashchange = this._onHashChange.bind(this);

        if (this.currentSceneDesc === undefined)
            this._onHashChange();

        if (this.currentSceneDesc === undefined) {
            // Load the state from session storage.
            const currentDescId = this.saveManager.getCurrentSceneDescId();
            if (currentDescId !== null) {
                // Load save slot 0.
                const key = this.saveManager.getSaveStateSlotKey(currentDescId, 0);
                const sceneState = this.saveManager.loadState(key);
                this._loadSceneDescById(currentDescId, sceneState);
            }
        }

        if (this.currentSceneDesc === undefined) {
            // Make the user choose a scene if there's nothing loaded by default...
            this.ui.sceneSelect.setExpanded(true);
        }

        this._updateLoop(window.performance.now());

        if (!IS_DEVELOPMENT) {
            Sentry.init({
                dsn: 'https://a3b5f6c50bc04555835f9a83d6e76b23@sentry.io/1448331',
                beforeSend: (event) => {
                    // Filter out aborted XHRs.
                    if (event.exception.values.length) {
                        const exc = event.exception.values[0];
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
        // Load the state from the hash, remove the extra character at the end.
        const hash = window.location.hash;
        if (hash.startsWith('#')) {
            this._loadState(decodeURIComponent(hash.slice(1)));
            // Wipe out the hash from the URL.
            window.history.replaceState('', '', '/');
        }
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
        if (inputManager.isKeyDownEventTriggered('KeyG'))
            this.ui.saveStatesPanel.expandAndFocus();
        for (let i = 1; i <= 9; i++) {
            if (inputManager.isKeyDownEventTriggered('Digit'+i)) {
                if (this.currentSceneDesc) {
                    const key = this._getSaveStateSlotKey(i);
                    const action = this.ui.saveStatesPanel.pickSaveStatesAction(inputManager);
                    this.doSaveStatesAction(action, key);
                }
            }
        }
        if (inputManager.isKeyDownEventTriggered('Numpad3'))
            this._exportSaveData();
        if (inputManager.isKeyDownEventTriggered('Period'))
            this.ui.timePanel.togglePausePlay();
        if (inputManager.isKeyDownEventTriggered('Comma'))
            this.viewer.sceneTime = 0;
    }

    private _updateLoop = (time: number) => {
        this.checkKeyShortcuts();

        prepareFrameDebugOverlayCanvas2D();

        // Needs to be called before this.viewer.update
        const shouldTakeScreenshot = this.viewer.inputManager.isKeyDownEventTriggered('Numpad7');

        let sceneTimeScale = this.ui.timePanel.getTimeScale();

        this.viewer.sceneTimeScale = sceneTimeScale;
        this.viewer.update(time);

        if (shouldTakeScreenshot)
            this._takeScreenshot();

        this.ui.timePanel.update(this.viewer.sceneTime, 1.0);

        window.requestAnimationFrame(this._updateLoop);
    };

    private _onDrop(e: DragEvent) {
        this.ui.dragHighlight.style.display = 'none';
        e.preventDefault();
        const transfer = e.dataTransfer;
        if (transfer.files.length === 0)
            return;
        const file = transfer.files[0];
        const files: File[] = [];
        for (let i = 0; i < transfer.files.length; i++)
            files.push(transfer.files[i]);
        const sceneDesc = new DroppedFileSceneDesc(file, files);
        this.droppedFileGroup.sceneDescs.push(sceneDesc);
        this._loadSceneGroups();
        this._loadSceneDesc(this.droppedFileGroup, sceneDesc);
    }

    private _onResize() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.setAttribute('style', `width: ${window.innerWidth}px; height: ${window.innerHeight}px;`);
        this.canvas.width = window.innerWidth * devicePixelRatio;
        this.canvas.height = window.innerHeight * devicePixelRatio;
    }

    private _saveStateTmp = new Uint8Array(512);
    private _saveStateF32 = new Float32Array(this._saveStateTmp.buffer);
    private _getSceneSaveState() {
        writeString(this._saveStateTmp, 0, SAVE_STATE_MAGIC);

        let wordOffs = 1;
        this._saveStateF32[wordOffs++] = this.viewer.sceneTime;
        wordOffs += serializeCamera(this._saveStateF32, wordOffs, this.viewer.camera);
        let offs = wordOffs * 4;
        if (this.viewer.scene !== null && this.viewer.scene.serializeSaveState)
            offs = this.viewer.scene.serializeSaveState(this._saveStateTmp.buffer, offs);

        const s = btoa(this._saveStateTmp, offs);
        return s + '=';
    }

    private _loadSceneSaveStateVersion2(state: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, state);
        if (byteLength < 4)
            return false;

        if (!matchString(this._saveStateTmp, 0, SAVE_STATE_MAGIC))
            return false;

        let wordOffs = 1;
        this.viewer.sceneTime = this._saveStateF32[wordOffs++];
        wordOffs += deserializeCamera(this.viewer.camera, this._saveStateF32, wordOffs);
        let offs = wordOffs * 4;
        if (this.viewer.scene !== null && this.viewer.scene.deserializeSaveState)
            offs = this.viewer.scene.deserializeSaveState(this._saveStateTmp.buffer, offs, byteLength);

        if (this.viewer.cameraController !== null)
            this.viewer.cameraController.cameraUpdateForced();

        return true;
    }

    private _loadSceneSaveStateVersion1(state: string): boolean {
        const camera = this.viewer.camera;

        const [tx, ty, tz, fx, fy, fz, rx, ry, rz] = state.split(',');
        // Translation.
        camera.worldMatrix[12] = +tx;
        camera.worldMatrix[13] = +ty;
        camera.worldMatrix[14] = +tz;
        camera.worldMatrix[2] = +fx;
        camera.worldMatrix[6] = +fy;
        camera.worldMatrix[10] = +fz;
        camera.worldMatrix[0] = +rx;
        camera.worldMatrix[4] = +ry;
        camera.worldMatrix[8] = +rz;
        const u = vec3.create();
        vec3.cross(u, [camera.worldMatrix[2], camera.worldMatrix[6], camera.worldMatrix[10]], [camera.worldMatrix[0], camera.worldMatrix[4], camera.worldMatrix[8]]);
        vec3.normalize(u, u);
        camera.worldMatrix[1] = u[0];
        camera.worldMatrix[5] = u[1];
        camera.worldMatrix[9] = u[2];

        if (this.viewer.cameraController !== null)
            this.viewer.cameraController.cameraUpdateForced();

        return true;
    }

    private _loadSceneSaveState(state: string | null): boolean {
        if (state === '' || state === null)
            return false;

        if (state.endsWith('='))
            return this._loadSceneSaveStateVersion2(state.slice(0, -1));
        else
            return this._loadSceneSaveStateVersion1(state);
    }

    private _loadSceneDescById(id: string, sceneState: string | null): void {
        const [groupId, ...sceneRest] = id.split('/');
        let sceneId = decodeURIComponent(sceneRest.join('/'));

        const group = this.groups.find((g) => typeof g !== 'string' && g.id === groupId) as SceneGroup;
        if (!group)
            return null;

        if (group.sceneIdMap !== undefined && group.sceneIdMap.has(sceneId))
            sceneId = group.sceneIdMap.get(sceneId);

        const desc = getSceneDescs(group).find((d) => d.id === sceneId);
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
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        return `${groupId}/${sceneId}`;
    }

    private _saveState() {
        if (this.currentSceneDesc === null)
            return;

        const sceneStateStr = this._getSceneSaveState();
        const currentDescId = this._getCurrentSceneDescId();
        const key = this.saveManager.getSaveStateSlotKey(currentDescId, 0);
        this.saveManager.saveTemporaryState(key, sceneStateStr);

        const saveState = `${currentDescId};${sceneStateStr}`;
        this.ui.saveStatesPanel.setSaveState(saveState);
    }

    private _getSaveStateSlotKey(slotIndex: number): string {
        return this.saveManager.getSaveStateSlotKey(this._getCurrentSceneDescId(), slotIndex);
    }

    private _onSceneChanged(scene: SceneGfx, sceneStateStr: string): void {
        scene.onstatechanged = () => {
            this._saveState();
        };

        let scenePanels: Panel[] = [];
        if (scene.createPanels)
            scenePanels = scene.createPanels();
        this.ui.setScenePanels(scenePanels);

        const sceneDescId = this._getCurrentSceneDescId();
        this.saveManager.setCurrentSceneDescId(sceneDescId);
        this.ui.saveStatesPanel.setCurrentSceneDescId(sceneDescId);

        if (scene.createCameraController !== undefined)
            this.viewer.setCameraController(scene.createCameraController());
        if (this.viewer.cameraController === null)
            this.viewer.setCameraController(new FPSCameraController());

        if (!this._loadSceneSaveState(sceneStateStr)) {
            const camera = this.viewer.camera;

            const key = this.saveManager.getSaveStateSlotKey(sceneDescId, 1);
            const didLoadCameraState = this._loadSceneSaveState(this.saveManager.loadState(key));

            if (!didLoadCameraState)
                mat4.identity(camera.worldMatrix);
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

    private _loadSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, sceneStateStr: string | null = null): void {
        if (this.currentSceneDesc === sceneDesc) {
            this._loadSceneSaveState(sceneStateStr);
            return;
        }

        const device = this.viewer.gfxDevice;

        // Tear down old scene.
        if (this.abortController !== null)
            this.abortController.abort();
        this.ui.destroyScene();
        if (this.viewer.scene && !this.destroyablePool.includes(this.viewer.scene))
            this.destroyablePool.push(this.viewer.scene);
        this.viewer.setScene(null);
        for (let i = 0; i < this.destroyablePool.length; i++)
            this.destroyablePool[i].destroy(device);
        this.abortController = new AbortController();
        gfxDeviceGetImpl(this.viewer.gfxDevice).checkForLeaks();

        // Unhide any hidden scene groups upon being loaded.
        if (sceneGroup.hidden)
            sceneGroup.hidden = false;

        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(this.currentSceneGroup, this.currentSceneDesc);

        this.ui.sceneSelect.setProgress(0);

        const abortSignal = this.abortController.signal;
        const progressMeter = this.ui.sceneSelect;
        const dataFetcher = new DataFetcher(abortSignal, progressMeter);
        const uiContainer: HTMLElement = document.createElement('div');
        this.ui.sceneUIContainer.appendChild(uiContainer);
        const destroyablePool: Destroyable[] = this.destroyablePool;
        const context: SceneContext = {
            device, dataFetcher, uiContainer, destroyablePool,
        };

        this.loadingSceneDesc = sceneDesc;
        const promise = sceneDesc.createScene(device, context);

        if (promise === null) {
            console.error(`Cannot load ${sceneDesc.id}. Probably an unsupported file extension.`);
            throw "whoops";
        }

        promise.then((scene: SceneGfx) => {
            if (this.loadingSceneDesc === sceneDesc) {
                this.loadingSceneDesc = null;
                this.abortController = null;
                this.viewer.setScene(scene);
                this._onSceneChanged(scene, sceneStateStr);
            }
        });

        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - noclip`;

        const sceneDescId = this._getCurrentSceneDescId();

        if (typeof gtag !== 'undefined') {
            gtag("event", "loadScene", {
                'event_category': "Scenes",
                'event_label': sceneDescId,
            });
        }

        Sentry.addBreadcrumb({
            category: 'loadScene',
            message: sceneDescId,
        });

        Sentry.configureScope((scope) => {
            scope.setExtra('sceneDescId', sceneDescId);
        });
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setSceneGroups(this.groups);
    }

    private _makeUI() {
        this.ui = new UI(this.viewer);
        this.toplevel.appendChild(this.ui.elem);
        this.ui.sceneSelect.onscenedescselected = this._onSceneDescSelected.bind(this);
        this.ui.saveStatesPanel.onsavestatesaction = (action: SaveStatesAction, key: string) => {
            this.doSaveStatesAction(action, key);
        };
        this.ui.timePanel.ontimescrub = (adj: number) => {
            this.viewer.setSceneTime(Math.max(this.viewer.sceneTime + adj, 0));
        };
        this.ui.timePanel.onrewind = () => {
            this.viewer.setSceneTime(0);
            this._saveState();
        };
    }

    private _toggleUI() {
        this.ui.elem.style.display = this.ui.elem.style.display === 'none' ? '' : 'none';
    }

    private _getSceneDownloadPrefix() {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        const date = new Date();
        return `${groupId}_${sceneId}_${date.toISOString()}`;
    }

    private _takeScreenshot() {
        const canvas = this.viewer.takeScreenshotToCanvas();
        const filename = `${this._getSceneDownloadPrefix()}.png`;
        convertCanvasToPNG(canvas).then((blob) => downloadBlob(filename, blob));
    }

    private _makeTextureZipFile(): Promise<ZipFileEntry[]> | null {
        const viewerTextures = this.ui.textureViewer.getViewerTextureList();
        const zipFileEntries: ZipFileEntry[] = [];
        const promises: Promise<void>[] = [];
        for (let i = 0; i < viewerTextures.length; i++) {
            const tex = viewerTextures[i];
            for (let j = 0; j < tex.surfaces.length; j++) {
                const filename = `${tex.name}_${j}.png`;
                promises.push(convertCanvasToPNG(tex.surfaces[j]).then((blob) => blobToArrayBuffer(blob)).then((data) => {
                    zipFileEntries.push({ filename, data });
                }));
            }
        }

        return Promise.all(promises).then(() => zipFileEntries);
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
}

// Google Analytics
declare var gtag: (command: string, eventName: string, eventParameters: { [key: string]: string }) => void;

// Declare a "main" object for easy access.
declare global {
    interface Window {
        main: any;
    }
}

window.main = new Main();

// Debug utilities.
declare global {
    interface Window {
        hexdump: any;
        downloadBuffer: any;
        debug: any;
        debugObj: any;
        gl: any;
    }
}
window.hexdump = hexdump;
window.downloadBuffer = (name: any, buffer: any) => {
    if (buffer instanceof ArrayBufferSlice)
        downloadBufferSlice(name, buffer);
    else if (name.name && name.buffer)
        window.downloadBuffer(name.name, name.buffer);
    else if (buffer instanceof ArrayBuffer) 
        downloadBuffer(name, buffer);
};
