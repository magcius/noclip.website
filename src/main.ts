
import { MainScene, SceneDesc, SceneGroup, Viewer } from './viewer';

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
import * as OOT3D from './oot3d/scenes';
import * as FRES from './fres/scenes';
import * as SPL from './fres/splatoon_scenes';
import * as DKSIV from './dksiv/scenes';
import * as MP1 from './metroid_prime/scenes';
import * as DKCR from './metroid_prime/dkcr_scenes';
import * as LM from './luigis_mansion/scenes';
import * as ZSS from './rres/zss_scenes';
import * as ELB from './rres/elb_scenes';
import * as MKWII from './rres/mkwii_scenes';

import * as J3D from './j3d/scenes';
import { UI } from './ui';
import { CameraControllerClass, FPSCameraController } from './Camera';
import { RenderStatistics } from './render';

const sceneGroups = [
    ZTP.sceneGroup,
    ZSS.sceneGroup,
    ZWW.sceneGroup,
    ZWW.sceneGroupDev,
    SMS.sceneGroup,
    SMG.sceneGroup,
    MKDD.sceneGroup,
    MKWII.sceneGroup,
    MP1.sceneGroup,
    DKCR.sceneGroup,
    ELB.sceneGroup,
    LM.sceneGroup,
    SM64DS.sceneGroup,
    SPL.sceneGroup,
    MDL0.sceneGroup,
    ZELVIEW.sceneGroup,
    OOT3D.sceneGroup,
    DKSIV.sceneGroup,
];

class DroppedFileSceneDesc implements SceneDesc {
    public id: string;
    public name: string;
    public file: File;

    constructor(file: File) {
        this.file = file;
        this.id = file.name;
        this.name = file.name;
    }

    private _loadFileAsPromise(file: File): Progressable<ArrayBufferSlice> {
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

    private createSceneFromFile(gl: WebGL2RenderingContext, file: File, buffer: ArrayBufferSlice): Promise<MainScene> {
        if (file.name.endsWith('.brres'))
            return Promise.resolve(ELB.createBasicRRESSceneFromBuffer(gl, buffer));

        if (file.name.endsWith('.bfres'))
            return Promise.resolve(FRES.createSceneFromFRESBuffer(gl, buffer));

        if (file.name.endsWith('.szs'))
            return FRES.createSceneFromSARCBuffer(gl, buffer);

        // XXX(jstpierre): Figure out WTF to do here...
        const promise = J3D.createMultiSceneFromBuffer(gl, buffer);
        if (promise)
            return promise;

        return null;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<MainScene> {
        return this._loadFileAsPromise(this.file).then((result: ArrayBufferSlice) => {
            return this.createSceneFromFile(gl, this.file, result);
        });
    }
}

class SceneLoader {
    public currentScene: MainScene;
    public onscenechanged: () => void;

    constructor(public viewer: Viewer) {
    }

    public setScene(scene: MainScene, sceneDesc: SceneDesc, cameraState: string) {
        this.currentScene = scene;

        let cameraControllerClass: CameraControllerClass;
        if (sceneDesc !== null)
            cameraControllerClass = sceneDesc.defaultCameraController;
        if (cameraControllerClass === undefined)
            cameraControllerClass = FPSCameraController;

        const cameraController = new cameraControllerClass();
        this.viewer.setCameraController(cameraController);

        if (cameraState !== null) {
            cameraController.deserialize(cameraState);
        } else {
            cameraController.camera.identity();
            if (scene !== null && scene.resetCamera)
                scene.resetCamera(cameraController.camera);
        }

        this.viewer.setScene(scene);

        this.onscenechanged();
    }

    public loadSceneDesc(sceneDesc: SceneDesc, cameraState: string): Progressable<MainScene> {
        this.setScene(null, null, null);

        const gl = this.viewer.renderState.gl;
        const progressable = sceneDesc.createScene(gl);
        progressable.then((scene: MainScene) => {
            this.setScene(scene, sceneDesc, cameraState);
        });
        return progressable;
    }
}

class Main {
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
        this.canvas = document.createElement('canvas');
        this.canvas.onmousedown = () => {
            this._deselectUI();
        };
        this.canvas.ondragover = (e) => {
            this.dragHighlight.style.display = 'block';
            e.preventDefault();
        };
        this.canvas.ondragleave = (e) => {
            this.dragHighlight.style.display = 'none';
            e.preventDefault();
        };
        this.canvas.ondrop = this._onDrop.bind(this);

        document.body.appendChild(this.canvas);
        window.onresize = this._onResize.bind(this);
        this._onResize();

        window.addEventListener('keydown', this._onKeyDown.bind(this));

        this.viewer = new Viewer(this.canvas);
        this.viewer.onstatistics = (statistics: RenderStatistics): void => {
            this.ui.statisticsPanel.addRenderStatistics(statistics);
        };
        this.viewer.oncamerachanged = () => {
            this._queueSaveState();
        };
        this.viewer.start();

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
    }

    public destroy(): void {
        this.sceneLoader.setScene(null, null, null);
        document.body.removeChild(this.canvas);
        document.body.removeChild(this.uiContainers);
        window.onresize = null;
    }

    private _deselectUI() {
        this.canvas.focus();
    }

    private _onDrop(e: DragEvent) {
        this.dragHighlight.style.display = 'none';
        e.preventDefault();
        const transfer = e.dataTransfer;
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
        const hasDesc = desc !== undefined;
        this.lastSavedState = state;
        this._loadSceneDesc(group, desc, cameraState);
    }

    private _getState() {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        const camera = this.viewer.cameraController.serialize();
        return `${groupId}/${sceneId};${camera}`;
    }

    private _saveState() {
        // If we're currently loading a scene, don't save out...
        if (this.sceneLoader.currentScene === null)
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

        this.saveTimeout = setTimeout(() => {
            this._saveState();
            this.saveTimeout = 0;
        }, 100);
    }

    private _onSceneChanged(): void {
        const scene = this.viewer.scene;
        this.ui.sceneChanged();

        if (scene && scene.createPanels)
            this.ui.setScenePanels(scene.createPanels());
        else
            this.ui.setScenePanels([]);
    }

    private _onSceneDescSelected(sceneGroup: SceneGroup, sceneDesc: SceneDesc) {
        this._loadSceneDesc(sceneGroup, sceneDesc);
    }

    private _sendAnalytics(): void {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        ga("send", {
            hitType: "event",
            eventCategory: "Scenes",
            eventAction: "loadScene",
            eventLabel: `${groupId}/${sceneId}`,
        });
    }

    private _loadSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, cameraState: string = null) {
        if (this.currentSceneDesc === sceneDesc)
            return;

        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.ui.sceneSelect.setCurrentDesc(this.currentSceneGroup, this.currentSceneDesc);

        const progressable = this.sceneLoader.loadSceneDesc(sceneDesc, cameraState);
        this.ui.sceneSelect.setProgressable(progressable);

        // TODO(jstpierre): Probably a better place to put this.
        // Set window title.
        document.title = `${sceneDesc.name} - ${sceneGroup.name} - Model Viewer`;

        this._deselectUI();
        this._saveState();
        this._sendAnalytics();
    }

    private _loadSceneGroups() {
        this.ui.sceneSelect.setSceneGroups(this.groups);
    }

    private _makeUI() {
        this.uiContainers = document.createElement('div');
        document.body.appendChild(this.uiContainers);

        this.ui = new UI(this.viewer);
        this.ui.elem.style.position = 'absolute';
        this.ui.elem.style.left = '2em';
        this.ui.elem.style.top = '2em';
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

    private _onKeyDown(e: KeyboardEvent) {
        if (e.code === 'KeyZ') {
            this._toggleUI();
            e.preventDefault();
        }
    }
}

// Declare a "main" object for easy access.
declare global {
    interface Window {
        main: any;
    }
}

window.main = new Main();

// Parcel HMR workaround.
declare var module: any;
if (module.hot) {
    module.hot.dispose(() => {
        window.location.reload();
    });
}
