
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

import { SceneDesc, SceneGroup, Viewer, SceneGfx, getSceneDescs, InitErrorCode, initializeViewer, makeErrorUI, makeErrorMessageUI } from './viewer';

import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

import * as BK from './bk/scenes';
import * as THUG2 from './thug2/scenes';
import * as ZTP from './j3d/ztp_scenes';
import * as MKDD from './j3d/mkdd_scenes';
import * as ZWW from './j3d/zww_scenes';
import * as SMS from './j3d/sms_scenes';
import * as PIK2 from './j3d/pik2_scenes';
import * as SMG1 from './j3d/smg1_scenes';
import * as SMG2 from './j3d/smg2_scenes';
import * as SM64DS from './sm64ds/scenes';
import * as MDL0 from './mdl0/scenes';
import * as OOT3D from './oot3d/oot3d_scenes';
import * as MM3D from './oot3d/mm3d_scenes';
import * as LM3D from './oot3d/lm3d_scenes';
import * as Grezzo3DS from './oot3d/scenes';
import * as FRES from './fres/scenes';
import * as SPL from './fres/splatoon_scenes';
import * as DKSIV from './dksiv/scenes';
import * as MP1 from './metroid_prime/scenes';
import * as DKCR from './metroid_prime/dkcr_scenes';
import * as LM from './luigis_mansion/scenes';
import * as ZSS from './rres/zss_scenes';
import * as ELB from './rres/elb_scenes';
import * as MKWII from './rres/mkwii_scenes';
import * as TTYD from './ttyd/scenes';
import * as SPM from './ttyd/spm_scenes';
import * as MKDS from './nns_g3d/mkds_scenes';
import * as NSMBDS from './nns_g3d/nsmbds_scenes';
import * as NNS_G3D from './nns_g3d/scenes';
import * as KH from './kh/scenes';
import * as Z_BOTW from './z_botw/scenes';
import * as SMO from './fres_nx/smo_scenes';
import * as PSY from './psychonauts/scenes';
import * as DKS from './dks/scenes';
import * as J3D from './j3d/scenes';
import * as RTDL from './rres/rtdl_scenes';
import * as SONIC_COLORS from './rres/sonic_colors_scenes';
import * as KLONOA from './rres/klonoa_scenes';

import { UI, SaveStatesAction } from './ui';
import { serializeCamera, deserializeCamera, FPSCameraController } from './Camera';
import { hexdump } from './util';
import { downloadBlob, downloadBufferSlice, downloadBuffer } from './fetch';
import { GfxDevice } from './gfx/platform/GfxPlatform';
import { ZipFileEntry, makeZipFile } from './ZipFile';
import { TextureHolder } from './TextureHolder';
import { atob, btoa } from './Ascii85';
import { vec3, mat4 } from 'gl-matrix';
import { GlobalSaveManager, SaveStateLocation } from './SaveManager';
import { RenderStatistics } from './RenderStatistics';
import { gfxDeviceGetImpl } from './gfx/platform/GfxPlatformWebGL2';
import { Color } from './Color';
import { standardFullClearRenderPassDescriptor } from './gfx/helpers/RenderTargetHelpers';

const sceneGroups = [
    "Wii",
    MKWII.sceneGroup,
    SMG1.sceneGroup,
    SMG2.sceneGroup,
    SPM.sceneGroup,
    ZSS.sceneGroup,
    ELB.sceneGroup,
    RTDL.sceneGroup,
    "GameCube",
    LM.sceneGroup,
    MKDD.sceneGroup,
    MP1.sceneGroup,
    TTYD.sceneGroup,
    PIK2.sceneGroup,
    SMS.sceneGroup,
    ZTP.sceneGroup,
    ZWW.sceneGroup,
    "Nintendo DS",
    MKDS.sceneGroup,
    SM64DS.sceneGroup,
    NSMBDS.sceneGroup,
    "Nintendo 3DS",
    LM3D.sceneGroup,
    MM3D.sceneGroup,
    OOT3D.sceneGroup,
    "Other",
    DKSIV.sceneGroup,
    MDL0.sceneGroup,
    BK.sceneGroup,
    KH.sceneGroup,
    "Experimental",
    PSY.sceneGroup,
    DKCR.sceneGroup,
    SMO.sceneGroup,
    SPL.sceneGroup,
    Z_BOTW.sceneGroup,
    DKS.sceneGroup,
    THUG2.sceneGroup,
    SONIC_COLORS.sceneGroup,
    KLONOA.sceneGroup,
];

function loadFileAsPromise(file: File): Progressable<ArrayBufferSlice> {
    const request = new FileReader();
    request.readAsArrayBuffer(file);

    const p = new Promise<ArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            const buffer: ArrayBuffer = request.result as ArrayBuffer;
            const slice = new ArrayBufferSlice(buffer);
            resolve(slice);
        };
        request.onerror = () => {
            reject();
        };
        request.onprogress = (e) => {
            if (e.lengthComputable)
                pr.setProgress(e.loaded / e.total);
        };
    });
    const pr = new Progressable<ArrayBufferSlice>(p);
    return pr;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Response(blob).arrayBuffer();
}

class DroppedFileSceneDesc implements SceneDesc {
    public id: string;
    public name: string;

    constructor(public file: File, public files: File[]) {
        this.id = file.name;
        this.name = file.name;
    }

    public createScene(device: GfxDevice): Progressable<SceneGfx> {
        const file = this.file;

        if (file.name.endsWith('.zar') || file.name.endsWith('.gar'))
            return loadFileAsPromise(file).then((buffer) => Grezzo3DS.createSceneFromZARBuffer(device, buffer));

        if (file.name.endsWith('.arc') || file.name.endsWith('.carc'))
            return loadFileAsPromise(file).then((buffer) => ELB.createBasicRRESRendererFromU8Archive(device, buffer));

        if (file.name.endsWith('.brres')) {
            return Progressable.all([...this.files].map((f) => loadFileAsPromise(f))).then((buffers) => {
                return ELB.createBasicRRESRendererFromBRRES(device, buffers);
            });
        }

        if (file.name.endsWith('.bfres'))
            return loadFileAsPromise(file).then((buffer) => FRES.createSceneFromFRESBuffer(device, buffer));

        if (file.name.endsWith('.szs') || file.name.endsWith('.rarc') || file.name.endsWith('.bmd') || file.name.endsWith('.bdl'))
            return loadFileAsPromise(file).then((buffer) => J3D.createMultiSceneFromBuffer(device, buffer));

        if (file.name.endsWith('.nsbmd'))
            return loadFileAsPromise(file).then((buffer) => NNS_G3D.createBasicNSBMDRendererFromNSBMD(device, buffer));

        return null;
    }
}

class SceneLoader {
    public loadingSceneDesc: SceneDesc = null;
    public abortController: AbortController | null = null;

    constructor(public viewer: Viewer) {
    }

    public loadSceneDesc(sceneDesc: SceneDesc): Progressable<SceneGfx> {
        this.viewer.setScene(null);
        gfxDeviceGetImpl(this.viewer.gfxDevice).checkForLeaks();

        if (this.abortController !== null)
            this.abortController.abort();
        this.abortController = new AbortController();

        this.loadingSceneDesc = sceneDesc;

        if (sceneDesc.createScene !== undefined) {
            const progressable = sceneDesc.createScene(this.viewer.gfxDevice, this.abortController.signal);
            if (progressable !== null) {
                progressable.then((scene: SceneGfx) => {
                    if (this.loadingSceneDesc === sceneDesc) {
                        this.loadingSceneDesc = null;
                        this.viewer.setScene(scene);
                    }
                });
                return progressable;
            }
        }

        console.error(`Cannot create scene. Probably an unsupported file extension.`);
        throw "whoops";
    }
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

    private uiContainers: HTMLElement;
    private dragHighlight: HTMLElement;
    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;

    private sceneLoader: SceneLoader;

    constructor() {
        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);

        this.canvas = document.createElement('canvas');

        this.uiContainers = document.createElement('div');
        this.toplevel.appendChild(this.uiContainers);

        const errorCode = initializeViewer(this, this.canvas);
        if (errorCode !== InitErrorCode.SUCCESS) {
            this.uiContainers.appendChild(makeErrorUI(errorCode));
            return;
        }

        this.toplevel.ondragover = (e) => {
            this.dragHighlight.style.display = 'block';
            e.preventDefault();
        };
        this.toplevel.ondragleave = (e) => {
            this.dragHighlight.style.display = 'none';
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

        this.sceneLoader = new SceneLoader(this.viewer);

        this._makeUI();

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push('Other');
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        if (this.currentSceneDesc === undefined) {
            // Load the state from the hash, remove the extra character at the end.
            const hash = window.location.hash;
            if (hash.startsWith('#'))
                this._loadState(decodeURIComponent(hash.slice(1)));
            // Wipe out the hash from the URL.
            window.history.replaceState('', '', '/');
        }

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

        this._updateLoop(0);
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
            this.viewer.isSceneTimeRunning = !this.viewer.isSceneTimeRunning;
    }

    private _updateLoop = (time: number) => {
        this.checkKeyShortcuts();

        // Needs to be called before this.viewer.update
        const shouldTakeScreenshot = this.viewer.inputManager.isKeyDownEventTriggered('Numpad7');

        this.viewer.update(time);

        if (shouldTakeScreenshot)
            this._takeScreenshot();

        window.requestAnimationFrame(this._updateLoop);
    };

    private _onDrop(e: DragEvent) {
        this.dragHighlight.style.display = 'none';
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

        const s = atob(this._saveStateTmp, offs);
        return s + '=';
    }

    private _loadSceneSaveStateVersion2(state: string): boolean {
        const byteLength = btoa(this._saveStateTmp, 0, state);
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

    private _loadSceneDescById(id: string, sceneState: string | null): Progressable<SceneGfx> | null {
        const [groupId, ...sceneRest] = id.split('/');
        let sceneId = decodeURIComponent(sceneRest.join('/'));

        const group = this.groups.find((g) => typeof g !== 'string' && g.id === groupId) as SceneGroup;
        if (!group)
            return null;

        if (group.sceneIdMap !== undefined && group.sceneIdMap.has(sceneId))
            sceneId = group.sceneIdMap.get(sceneId);

        const desc = getSceneDescs(group).find((d) => d.id === sceneId);
        return this._loadSceneDesc(group, desc, sceneState);
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

        if (scene.createPanels !== undefined)
            this.ui.setScenePanels(scene.createPanels());
        else
            this.ui.setScenePanels([]);

        const sceneDescId = this._getCurrentSceneDescId();
        this.saveManager.setCurrentSceneDescId(sceneDescId);
        this.ui.saveStatesPanel.setCurrentSceneDescId(sceneDescId);

        // Set camera controller.
        if (scene.defaultCameraController !== undefined) {
            const controller = new scene.defaultCameraController();
            this.viewer.setCameraController(controller);
        }

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

    private _sendAnalytics(): void {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;

        if (typeof gtag !== 'undefined') {
            gtag("event", "loadScene", {
                'event_category': "Scenes",
                'event_label': `${groupId}/${sceneId}`,
            });
        }
    }

    private _loadSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, sceneStateStr: string | null = null): Progressable<SceneGfx> {
        if (this.currentSceneDesc === sceneDesc)
            return Progressable.resolve(null);

        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(this.currentSceneGroup, this.currentSceneDesc);

        const progressable = this.sceneLoader.loadSceneDesc(sceneDesc).then((scene) => {
            this._onSceneChanged(scene, sceneStateStr);
            return scene;
        });
        this.ui.sceneSelect.setLoadProgress(progressable.progress);
        progressable.onProgress = () => {
            this.ui.sceneSelect.setLoadProgress(progressable.progress);
        };

        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - noclip`;

        this._sendAnalytics();
        return progressable;
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setSceneGroups(this.groups);
    }

    private _makeUI() {
        this.ui = new UI(this.viewer);
        this.uiContainers.appendChild(this.ui.elem);
        this.ui.sceneSelect.onscenedescselected = this._onSceneDescSelected.bind(this);
        this.ui.saveStatesPanel.onsavestatesaction = (action: SaveStatesAction, key: string) => {
            this.doSaveStatesAction(action, key);
        };

        this.dragHighlight = document.createElement('div');
        this.uiContainers.appendChild(this.dragHighlight);
        this.dragHighlight.style.position = 'absolute';
        this.dragHighlight.style.left = '0';
        this.dragHighlight.style.right = '0';
        this.dragHighlight.style.top = '0';
        this.dragHighlight.style.bottom = '0';
        this.dragHighlight.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        this.dragHighlight.style.boxShadow = '0 0 40px 5px white inset';
        this.dragHighlight.style.display = 'none';
        this.dragHighlight.style.pointerEvents = 'none';
    }

    private _toggleUI() {
        this.uiContainers.style.display = this.uiContainers.style.display === 'none' ? '' : 'none';
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

    private _makeZipFileFromTextureHolder(textureHolder: TextureHolder<any>): Promise<ZipFileEntry[]> {
        const zipFileEntries: ZipFileEntry[] = [];
        const promises: Promise<void>[] = [];
        for (let i = 0; i < textureHolder.viewerTextures.length; i++) {
            const tex = textureHolder.viewerTextures[i];
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
        const textureHolder = this.viewer.getCurrentTextureHolder();
        if (textureHolder) {
            this._makeZipFileFromTextureHolder(textureHolder).then((zipFileEntries) => {
                const zipBuffer = makeZipFile(zipFileEntries);
                const filename = `${this._getSceneDownloadPrefix()}_Textures.zip`;
                downloadBufferSlice(filename, new ArrayBufferSlice(zipBuffer), 'application/zip');
            });
        }
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
    }
}
window.hexdump = hexdump;
window.downloadBuffer = downloadBuffer;
