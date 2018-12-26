
/* @preserve The source code to this website is under the MIT license and can be found at https://github.com/magcius/model-viewer */

// Parcel HMR workaround.
// https://github.com/parcel-bundler/parcel/issues/289
declare var module: any;
if (module.hot) {
    module.hot.dispose(() => {
        window.location.reload();
        throw new Error();
    });
}

import { MainScene, SceneDesc, SceneGroup, Viewer, Scene_Device } from './viewer';

import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

import * as ZTP from './j3d/ztp_scenes';
import * as MKDD from './j3d/mkdd_scenes';
import * as ZWW from './j3d/zww_scenes';
import * as SMS from './j3d/sms_scenes';
import * as SMG from './j3d/smg_scenes';
import * as SM64DS from './sm64ds/scenes';
import * as MDL0 from './mdl0/scenes';
import * as ZELVIEW from './zelview/scenes';
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
import * as Z_BOTW from './z_botw/scenes';
import * as SMO from './fres_nx/smo_scenes';

import * as J3D from './j3d/scenes';
import { UI, createDOMFromString } from './ui';
import { CameraControllerClass, FPSCameraController, Camera } from './Camera';
import { RenderStatistics } from './render';
import { hexdump } from './util';
import { downloadBlob, downloadBuffer } from './fetch';
import { GfxDevice } from './gfx/platform/GfxPlatform';
import { ZipFileEntry, makeZipFile } from './ZipFile';
import { TextureHolder } from './TextureHolder';

const sceneGroups = [
    MKDS.sceneGroup,
    SMS.sceneGroup,
    MKDD.sceneGroup,
    MKWII.sceneGroup,
    ZWW.sceneGroup,
    ZWW.sceneGroupDev,
    ZTP.sceneGroup,
    ZSS.sceneGroup,
    SMG.sceneGroup,
    LM.sceneGroup,
    TTYD.sceneGroup,
    SPM.sceneGroup,
    SM64DS.sceneGroup,
    DKSIV.sceneGroup,
    ELB.sceneGroup,
    MP1.sceneGroup,
    DKCR.sceneGroup,
    SPL.sceneGroup,
    MDL0.sceneGroup,
    OOT3D.sceneGroup,
    MM3D.sceneGroup,
    ZELVIEW.sceneGroup,
    LM3D.sceneGroup,
    Z_BOTW.sceneGroup,
    SMO.sceneGroup,
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
    public file: File;

    constructor(file: File) {
        this.file = file;
        this.id = file.name;
        this.name = file.name;
    }

    public createScene_Device(device: GfxDevice): Progressable<Scene_Device> {
        const file = this.file;

        if (file.name.endsWith('.zar') || file.name.endsWith('.gar'))
            return loadFileAsPromise(file).then((buffer) => Grezzo3DS.createSceneFromZARBuffer(device, buffer));

        return null;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<MainScene> {
        const file = this.file;

        if (file.name.endsWith('.brres'))
            return loadFileAsPromise(file).then((buffer) => ELB.createBasicRRESSceneFromBuffer(gl, buffer));

        if (file.name.endsWith('.bfres'))
            return loadFileAsPromise(file).then((buffer) => FRES.createSceneFromFRESBuffer(gl, buffer));

        if (file.name.endsWith('.szs') || file.name.endsWith('.rarc') || file.name.endsWith('.bmd') || file.name.endsWith('.arc'))
            return loadFileAsPromise(file).then((buffer) => J3D.createMultiSceneFromBuffer(gl, buffer));

        return null;
    }
}

class SceneLoader {
    public loadingSceneDesc: SceneDesc = null;
    public onscenechanged: () => void;

    constructor(public viewer: Viewer) {
    }

    public setCameraState(sceneDesc: SceneDesc, cameraState: string, resetCamera: (camera: Camera) => void): void {
        let cameraControllerClass: CameraControllerClass;
        if (sceneDesc !== null)
            cameraControllerClass = sceneDesc.defaultCameraController;
        if (cameraControllerClass === undefined)
            cameraControllerClass = FPSCameraController;

        const cameraController = new cameraControllerClass();
        this.viewer.setCameraController(cameraController);

        if (cameraState) {
            cameraController.deserialize(cameraState);
        } else {
            resetCamera(cameraController.camera);
        }
    }

    public loadSceneDesc(sceneDesc: SceneDesc, cameraState: string): Progressable<MainScene> | Progressable<Scene_Device> {
        this.viewer.setScene(null);

        this.loadingSceneDesc = sceneDesc;

        const gl = this.viewer.renderState.gl;

        if (sceneDesc.createScene_Device !== undefined) {
            const progressable = sceneDesc.createScene_Device(this.viewer.gfxDevice);
            if (progressable !== null) {
                progressable.then((scene: Scene_Device) => {
                    if (this.loadingSceneDesc === sceneDesc) {
                        this.loadingSceneDesc = null;
                        this.setCameraState(sceneDesc, cameraState, (camera) => camera.identity());
                        this.viewer.setSceneDevice(scene);
                        this.onscenechanged();
                    }
                });
                return progressable;
            }
        }

        if (sceneDesc.createScene !== undefined) {
            const progressable = sceneDesc.createScene(gl);
            if (progressable !== null) {
                progressable.then((scene: MainScene) => {
                    if (this.loadingSceneDesc === sceneDesc) {
                        this.loadingSceneDesc = null;
                        this.setCameraState(sceneDesc, cameraState, (camera) => {
                            if (scene.resetCamera)
                                scene.resetCamera(camera);
                            else
                                camera.identity();
                        });
                        this.viewer.setScene(scene);
                        this.onscenechanged();
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

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public groups: SceneGroup[];
    public ui: UI;

    private droppedFileGroup: SceneGroup;

    private uiContainers: HTMLElement;
    private dragHighlight: HTMLElement;
    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;

    private sceneLoader: SceneLoader;

    private lastSavedState: string;
    private saveTimeout: number;

    constructor() {
        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);

        this.canvas = document.createElement('canvas');

        this.uiContainers = document.createElement('div');
        this.toplevel.appendChild(this.uiContainers);

        this.viewer = Viewer.make(this.canvas);
        if (this.viewer === null) {
            this._makeErrorUI_NoWebGL2();
            return;
        }

        this.canvas.onmousedown = () => {
            this._deselectUI();
        };
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
            this._queueSaveState();
        };
        this.viewer.inputManager.onisdraggingchanged = () => {
            this.ui.setIsDragging(this.viewer.inputManager.isDragging());
        };

        this.sceneLoader = new SceneLoader(this.viewer);
        this.sceneLoader.onscenechanged = this._onSceneChanged.bind(this);

        this._makeUI();

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        // Load the state from the hash
        this._loadState(window.location.hash.slice(1));

        // Make the user choose a scene if there's nothing loaded by default...
        if (this.currentSceneDesc === undefined)
            this.ui.sceneSelect.setExpanded(true);

        this._updateLoop(0);
    }

    private _updateLoop = (time: number) => {
        if (this.viewer.inputManager.isKeyDownEventTriggered('KeyZ'))
            this._toggleUI();

        const shouldTakeScreenshot = this.viewer.inputManager.isKeyDownEventTriggered('Numpad7');

        if (this.viewer.inputManager.isKeyDownEventTriggered('Numpad9'))
            this._downloadTextures();

        this.viewer.update(time);

        if (shouldTakeScreenshot)
            this._takeScreenshot();

        window.requestAnimationFrame(this._updateLoop);
    };

    private _deselectUI() {
        this.canvas.focus();
    }

    private _onDrop(e: DragEvent) {
        this.dragHighlight.style.display = 'none';
        e.preventDefault();
        const transfer = e.dataTransfer;
        if (transfer.files.length === 0)
            return;
        const file = transfer.files[0];
        const sceneDesc = new DroppedFileSceneDesc(file);
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

    private _loadState(state: string) {
        const parts = state.split(';');
        const [sceneState, cameraState] = parts;
        const [groupId, ...sceneRest] = sceneState.split('/');
        const sceneId = decodeURIComponent(sceneRest.join('/'));

        const group = this.groups.find((g) => g.id === groupId);
        if (!group)
            return;

        const desc = group.sceneDescs.find((d) => d.id === sceneId);
        this.lastSavedState = state;
        this._loadSceneDesc(group, desc, cameraState);
    }

    private _getState() {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        const camera = this.viewer.cameraController ? this.viewer.cameraController.serialize() : '';
        return `${groupId}/${sceneId};${camera}`;
    }

    private _saveState() {
        if (this.currentSceneDesc === null)
            return;

        const newState = this._getState();
        if (this.lastSavedState !== newState) {
            window.history.replaceState('', '', '#' + newState);
            this.lastSavedState = newState;
        }
    }

    private _queueSaveState() {
        if (this.saveTimeout !== 0)
            clearTimeout(this.saveTimeout);

        this.saveTimeout = window.setTimeout(() => {
            this._saveState();
            this.saveTimeout = 0;
        }, 100);
    }

    private _onSceneChanged(): void {
        this.ui.sceneChanged();

        if (this.viewer.scene && this.viewer.scene.createPanels)
            this.ui.setScenePanels(this.viewer.scene.createPanels());
        else if (this.viewer.scene_device && this.viewer.scene_device.createPanels)
            this.ui.setScenePanels(this.viewer.scene_device.createPanels());
        else
            this.ui.setScenePanels([]);
    }

    private _onSceneDescSelected(sceneGroup: SceneGroup, sceneDesc: SceneDesc) {
        this._loadSceneDesc(sceneGroup, sceneDesc);
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

    private _loadSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, cameraState: string = null) {
        if (this.currentSceneDesc === sceneDesc)
            return;

        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(this.currentSceneGroup, this.currentSceneDesc);

        const progressable = this.sceneLoader.loadSceneDesc(sceneDesc, cameraState);
        this.ui.sceneSelect.setProgressable(progressable);

        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - noclip`;

        this._deselectUI();
        this._saveState();
        this._sendAnalytics();
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setSceneGroups(this.groups);
    }

    private _makeErrorUI(message: string): void {
        const errorMessage = createDOMFromString(`
<div style="display: flex; background-color: #220000; flex-direction: column; position: absolute; top: 0; bottom: 0; left: 0; right: 0; justify-content: center;">
<div style="display: flex; background-color: #aa2233; justify-content: center; box-shadow: 0 0 32px black;">
<div style="max-width: 1000px; font: 16pt sans-serif; color: white; text-align: justify;">
<style>
a:link, a:visited { color: #ccc; transition: .5s color; }
a:hover { color: #fff; }
</style>
${message}
`);

        this.uiContainers.appendChild(errorMessage);
    }

    private _makeErrorUI_NoWebGL2(): void {
        return this._makeErrorUI(`
<p>Your browser does not appear to have WebGL 2 support. Please check <a href="http://webglreport.com/?v=2">WebGL Report</a> for further details.
<p>If WebGL Report says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/model-viewer/issues/new">GitHub issue</a> with as much as information as possible.
<p>Unfortunately, this means that Safari and iOS are not supported. The plan is to support <a href="https://github.com/gpuweb/gpuweb">WebGPU</a> once this arrives in browsers, which Apple has promised to support.
<p style="text-align: right">Thanks, Jasper.</p>
`);
    }

    private _makeUI() {
        this.ui = new UI(this.viewer);
        this.uiContainers.appendChild(this.ui.elem);
        this.ui.sceneSelect.onscenedescselected = this._onSceneDescSelected.bind(this);

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
                downloadBuffer(filename, new ArrayBufferSlice(zipBuffer), 'application/zip');
            });
        }
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
        debug: any;
    }
}
window.hexdump = hexdump;
