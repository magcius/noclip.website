
import { Scene, SceneDesc, SceneGroup, Viewer, FPSCameraController, OrbitCameraController } from 'viewer';

import * as FRES from 'fres/scenes';
import * as J3D from 'j3d/scenes';
import * as MDL0 from 'mdl0/scenes';
import * as OOT3D from 'oot3d/scenes';
import * as SM64DS from 'sm64ds/scenes';
import * as ZELVIEW from 'zelview/scenes';

import { Progressable } from './progress';

class ProgressBar {
    public elem: HTMLElement;

    private toplevel: HTMLDivElement;
    private barFill: HTMLDivElement;
    private progressable: Progressable<Scene>;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.border = '1px solid black';

        this.barFill = document.createElement('div');
        this.barFill.style.backgroundColor = 'black';
        this.barFill.style.height = '100%';

        this.toplevel.appendChild(this.barFill);
        this.elem = this.toplevel;
        this.progressable = null;

        this.sync();
    }

    public sync() {
        if (this.progressable) {
            this.toplevel.style.visibility = '';
            this.barFill.style.width = (this.progressable.progress * 100) + '%';
        } else {
            this.toplevel.style.visibility = 'hidden';
        }
    }

    set(p: Progressable<Scene>) {
        if (this.progressable)
            this.progressable.onProgress = null;

        this.progressable = p;

        if (this.progressable)
            this.progressable.onProgress = this.sync.bind(this);

        this.sync();
    }
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

    private _loadFileAsPromise(file: File): Progressable<ArrayBuffer> {
        const request = new FileReader();
        request.readAsArrayBuffer(file);

        const p = new Promise<ArrayBuffer>((resolve, reject) => {
            request.onload = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                reject();
            };
            request.onprogress = (e) => {
                if (e.lengthComputable)
                    pr.setProgress(e.loaded / e.total);
            };
        });
        const pr = new Progressable<ArrayBuffer>(p);
        return pr;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return this._loadFileAsPromise(this.file).then((result) => {
            return J3D.createSceneFromRARCBuffer(gl, result);
        });
    }
}

class Main {
    public canvas: HTMLCanvasElement;
    public viewer: Viewer;
    public groups: SceneGroup[];

    private droppedFileGroup: SceneGroup;

    private uiContainers: HTMLElement;
    private dragHighlight: HTMLElement;
    private groupSelect: HTMLSelectElement;
    private sceneSelect: HTMLSelectElement;
    private gearSettings: HTMLElement;
    private texturesView: HTMLElement;
    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;
    private progressBar: ProgressBar;
    private cameraControllerSelect: HTMLSelectElement;

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
        this.viewer.start();

        this._makeUI();

        this.groups = [];

        // The "plugin" part of this.
        this.groups.push(SM64DS.sceneGroup);
        this.groups.push(MDL0.sceneGroup);
        this.groups.push(ZELVIEW.sceneGroup);
        this.groups.push(OOT3D.sceneGroup);
        this.groups.push(FRES.sceneGroup);
        this.groups.push(J3D.sceneGroup);

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        // Load the state from the hash
        this._loadState(window.location.hash.slice(1));
        // If it didn't work, fall back to defaults.
        if (!this.currentSceneDesc)
            this._loadSceneGroup(this.groups[0]);
    }

    private _onDrop(e: DragEvent) {
        this.dragHighlight.style.display = 'none';
        e.preventDefault();
        const transfer = e.dataTransfer;
        const file = transfer.files[0];
        const sceneDesc = new DroppedFileSceneDesc(file);
        this.droppedFileGroup.sceneDescs.push(sceneDesc);
        this._loadSceneGroups();
        this._loadSceneGroup(this.droppedFileGroup, false);
        this._loadSceneDesc(sceneDesc);
    }

    private _onResize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private _loadState(state: string) {
        const [groupId, ...sceneRest] = state.split('/');
        const sceneId = sceneRest.join('/');
        const group = this.groups.find((g) => g.id === groupId);
        if (!group)
            return;
        const desc = group.sceneDescs.find((d) => d.id === sceneId);
        if (!desc)
            return;
        this._loadSceneGroup(group, false);
        this._loadSceneDesc(desc);
    }

    private _saveState() {
        const groupId = this.currentSceneGroup.id;
        const sceneId = this.currentSceneDesc.id;
        return `${groupId}/${sceneId}`;
    }

    private _loadSceneDesc(sceneDesc: SceneDesc) {
        if (this.currentSceneDesc === sceneDesc)
            return;

        this.currentSceneDesc = sceneDesc;

        // Make sure combobox is selected
        for (let i = 0; i < this.sceneSelect.options.length; i++) {
            const sceneOption = this.sceneSelect.options[i];
            if ((<any> sceneOption).sceneDesc === sceneDesc)
                this.sceneSelect.selectedIndex = i;
        }

        const gl = this.viewer.sceneGraph.renderState.viewport.gl;

        const progressable = sceneDesc.createScene(gl);
        this.viewer.setScene(null);
        this.progressBar.set(progressable);

        progressable.promise.then((result: Scene) => {
            this.progressBar.set(null);
            this.viewer.setScene(result);

            // XXX: Provide a UI for textures eventually?

            this.texturesView.innerHTML = '';
            result.textures.forEach((canvas) => {
                const tex = document.createElement('div');
                tex.style.margin = '1em';
                canvas.style.margin = '2px';
                canvas.style.border = '1px dashed black';
                tex.appendChild(canvas);
                const label = document.createElement('span');
                label.textContent = canvas.title;
                tex.appendChild(label);
                this.texturesView.appendChild(tex);
            });

            if (result.cameraController === FPSCameraController) {
                this.cameraControllerSelect.selectedIndex = 0;
            } else {
                this.cameraControllerSelect.selectedIndex = 1;
            }
        });

        this._deselectUI();
        window.history.replaceState('', '', '#' + this._saveState());
    }

    private _deselectUI() {
        // Take focus off of the select.
        this.groupSelect.blur();
        this.sceneSelect.blur();
        this.canvas.focus();
    }

    private _onGearButtonClicked() {
        this.gearSettings.style.display = this.gearSettings.style.display === 'block' ? 'none' : 'block';
    }
    private _onGroupSelectChange() {
        const option = this.groupSelect.selectedOptions.item(0);
        const group: SceneGroup = (<any> option).group;
        this._loadSceneGroup(group);
    }

    private _loadSceneGroups() {
        this.groupSelect.innerHTML = '';

        for (const group of this.groups) {
            if (!group.sceneDescs.length)
                continue;

            const groupOption = document.createElement('option');
            groupOption.textContent = group.name;
            (<any> groupOption).group = group;
            this.groupSelect.appendChild(groupOption);
        }
    }

    private _loadSceneGroup(group: SceneGroup, loadDefaultSceneInGroup: boolean = true) {
        if (this.currentSceneGroup === group)
            return;

        this.currentSceneGroup = group;

        // Make sure combobox is selected
        for (let i = 0; i < this.groupSelect.options.length; i++) {
            const groupOption = this.groupSelect.options[i];
            if ((<any> groupOption).group === group)
                this.groupSelect.selectedIndex = i;
        }

        // Clear.
        this.sceneSelect.innerHTML = '';
        for (const sceneDesc of group.sceneDescs) {
            const sceneOption = document.createElement('option');
            sceneOption.textContent = sceneDesc.name;
            (<any> sceneOption).sceneDesc = sceneDesc;
            this.sceneSelect.appendChild(sceneOption);
        }

        if (loadDefaultSceneInGroup)
            this._loadSceneDesc(group.sceneDescs[0]);
    }
    private _onSceneSelectChange() {
        const option = this.sceneSelect.selectedOptions.item(0);
        const sceneDesc: SceneDesc = (<any> option).sceneDesc;
        this._loadSceneDesc(sceneDesc);
    }

    private _makeUI() {
        this.dragHighlight = document.createElement('div');
        document.body.appendChild(this.dragHighlight);
        this.dragHighlight.style.position = 'absolute';
        this.dragHighlight.style.left = '0';
        this.dragHighlight.style.right = '0';
        this.dragHighlight.style.top = '0';
        this.dragHighlight.style.bottom = '0';
        this.dragHighlight.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        this.dragHighlight.style.boxShadow = '0 0 40px 5px white inset';
        this.dragHighlight.style.display = 'none';
        this.dragHighlight.style.pointerEvents = 'none';

        this.uiContainers = document.createElement('div');
        document.body.appendChild(this.uiContainers);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.style.position = 'absolute';
        progressBarContainer.style.left = '100px';
        progressBarContainer.style.right = '100px';
        progressBarContainer.style.top = '50%';
        progressBarContainer.style.marginTop = '-20px';
        progressBarContainer.style.pointerEvents = 'none';

        this.progressBar = new ProgressBar();
        this.progressBar.elem.style.height = '40px';
        progressBarContainer.appendChild(this.progressBar.elem);
        this.uiContainers.appendChild(progressBarContainer);

        const uiContainerL = document.createElement('div');
        uiContainerL.style.position = 'absolute';
        uiContainerL.style.left = '2em';
        uiContainerL.style.bottom = '2em';
        this.uiContainers.appendChild(uiContainerL);

        const uiContainerR = document.createElement('div');
        uiContainerR.style.position = 'absolute';
        uiContainerR.style.right = '2em';
        uiContainerR.style.bottom = '2em';
        this.uiContainers.appendChild(uiContainerR);

        this.groupSelect = document.createElement('select');
        this.groupSelect.onchange = this._onGroupSelectChange.bind(this);
        this.groupSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.groupSelect);

        this.sceneSelect = document.createElement('select');
        this.sceneSelect.onchange = this._onSceneSelectChange.bind(this);
        this.sceneSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.sceneSelect);

        this.gearSettings = document.createElement('div');
        this.gearSettings.style.backgroundColor = 'white';
        this.gearSettings.style.position = 'absolute';
        this.gearSettings.style.top = this.gearSettings.style.bottom =
        this.gearSettings.style.left = this.gearSettings.style.right = '4em';
        this.gearSettings.style.boxShadow = '0px 0px 10px rgba(0, 0, 0, 0.4)';
        this.gearSettings.style.padding = '1em';
        this.gearSettings.style.display = 'none';
        this.gearSettings.style.overflow = 'auto';
        document.body.appendChild(this.gearSettings);

        const fovSlider = document.createElement('input');
        fovSlider.type = 'range';
        fovSlider.max = '100';
        fovSlider.min = '1';
        fovSlider.oninput = this._onFovSliderChange.bind(this);

        const fovSliderLabel = document.createElement('label');
        fovSliderLabel.textContent = "Field of View";

        this.gearSettings.appendChild(fovSliderLabel);
        this.gearSettings.appendChild(fovSlider);

        this.cameraControllerSelect = document.createElement('select');
        const cameraControllerFPS = document.createElement('option');
        cameraControllerFPS.textContent = 'WASD';
        this.cameraControllerSelect.appendChild(cameraControllerFPS);
        const cameraControllerOrbit = document.createElement('option');
        cameraControllerOrbit.textContent = 'Orbit';
        this.cameraControllerSelect.appendChild(cameraControllerOrbit);
        this.cameraControllerSelect.onchange = this._onCameraControllerSelect.bind(this);

        this.gearSettings.appendChild(this.cameraControllerSelect);

        const texturesHeader = document.createElement('h3');
        texturesHeader.textContent = 'Textures';
        this.gearSettings.appendChild(texturesHeader);

        this.texturesView = document.createElement('div');
        this.gearSettings.appendChild(this.texturesView);

        const gearButton = document.createElement('button');
        gearButton.textContent = '⚙';
        gearButton.onclick = this._onGearButtonClicked.bind(this);
        uiContainerR.appendChild(gearButton);
    }

    private _toggleUI() {
        this.uiContainers.style.display = this.uiContainers.style.display === 'none' ? 'block' : 'none';
    }

    private _onKeyDown(e: KeyboardEvent) {
        if (e.key === 'z') {
            this._toggleUI();
            event.preventDefault();
        }
    }
    private _getSliderT(slider: HTMLInputElement) {
        return (+slider.value - +slider.min) / (+slider.max - +slider.min);
    }

    private _onFovSliderChange(e: UIEvent) {
        const slider = (<HTMLInputElement> e.target);
        const value = this._getSliderT(slider);
        this.viewer.sceneGraph.renderState.fov = value * (Math.PI * 0.995);
    }

    private _onCameraControllerSelect(e: UIEvent) {
        const index = this.cameraControllerSelect.selectedIndex;
        if (index === 0) {
            this.viewer.cameraController = new FPSCameraController();
        } else {
            this.viewer.cameraController = new OrbitCameraController();
        }
    }
}

window.main = new Main();
