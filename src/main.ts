
import { MainScene, SceneDesc, SceneGroup, Viewer, FPSCameraController, OrbitCameraController, Texture } from './viewer';

import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';

import * as ZWW from './j3d/zww_scenes';
import * as SMS from './j3d/sms_scenes';
import * as SMG from './j3d/smg_scenes';
import * as J3D from './j3d/scenes';
import * as SM64DS from './sm64ds/scenes';
import * as MDL0 from './mdl0/scenes';
import * as ZELVIEW from './zelview/scenes';
import * as OOT3D from './oot3d/scenes';
import * as FRES from './fres/scenes';
import * as DKSIV from './dksiv/scenes';
import * as MP1 from './metroid_prime/scenes';

const sceneGroups = [
    ZWW.sceneGroup,
    SMS.sceneGroup,
    SMG.sceneGroup,
    SM64DS.sceneGroup,
    MDL0.sceneGroup,
    ZELVIEW.sceneGroup,
    OOT3D.sceneGroup,
    FRES.sceneGroup,
    DKSIV.sceneGroup,
    MP1.sceneGroup,
];

class ProgressBar {
    public elem: HTMLElement;

    private toplevel: HTMLDivElement;
    private barFill: HTMLDivElement;
    private progressable: Progressable<MainScene>;

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

    set(p: Progressable<MainScene>) {
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

    private _loadFileAsPromise(file: File): Progressable<ArrayBufferSlice> {
        const request = new FileReader();
        request.readAsArrayBuffer(file);

        const p = new Promise<ArrayBufferSlice>((resolve, reject) => {
            request.onload = () => {
                const buffer: ArrayBuffer = request.result;
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

    private createSceneFromFile(gl: WebGL2RenderingContext, file: File, buffer: ArrayBufferSlice): MainScene {
        let scene;
        if (file.name.endsWith('.bfres'))
            return FRES.createSceneFromFRESBuffer(gl, buffer);

        scene = J3D.createSceneFromBuffer(gl, buffer);
        if (scene)
            return scene;

        return null;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<MainScene> {
        return this._loadFileAsPromise(this.file).then((result: ArrayBufferSlice) => {
            return this.createSceneFromFile(gl, this.file, result);
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
    private texturesView: HTMLElement;
    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;
    private progressBar: ProgressBar;
    private cameraControllerSelect: HTMLSelectElement;

    private sceneUIContainer: HTMLElement;

    private popup: HTMLElement;
    private popupSettingsPane: HTMLElement;
    private popupHelpPane: HTMLElement;
    private popupPaneContainer: HTMLElement;

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

        this.groups = sceneGroups;

        this.droppedFileGroup = { id: "drops", name: "Dropped Files", sceneDescs: [] };
        this.groups.push(this.droppedFileGroup);

        this._loadSceneGroups();

        // Load the state from the hash
        this._loadState(window.location.hash.slice(1));
        // If it didn't work, fall back to defaults.
        if (!this.currentSceneDesc)
            this._loadSceneGroup(this.groups[0]);
    }

    private _deselectUI() {
        // Take focus off of the select.
        this.groupSelect.blur();
        this.sceneSelect.blur();
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
        this._loadSceneGroup(this.droppedFileGroup, false);
        this._loadSceneDesc(sceneDesc);
    }

    private _onResize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private _loadState(state: string) {
        const [groupId, ...sceneRest] = state.split('/');
        const sceneId = decodeURIComponent(sceneRest.join('/'));
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

    private _makeTextureElem(texture: Texture): HTMLElement {
        const tex = document.createElement('div');
        tex.style.margin = '.5em';
        tex.style.padding = '.5em';
        tex.style.backgroundColor = 'rgb(245, 237, 222)';
        tex.style.border = '1px solid #666';
        tex.style.textAlign = 'center';
        tex.style.verticalAlign = 'bottom';

        const canvases = [];

        for (const canvas of texture.surfaces) {
            canvas.style.margin = '2px';
            canvas.style.border = '1px dashed black';
            canvases.push(canvas);
            tex.appendChild(canvas);
        }

        tex.onmouseover = () => {
            canvases.forEach((canvas) => {
                canvas.style.backgroundColor = '';
                canvas.style.backgroundImage = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSwooAAAAAElFTkSuQmCC")';
            });
        };
        tex.onmouseout = () => {
            canvases.forEach((canvas) => {
                canvas.style.backgroundColor = 'black';
                canvas.style.backgroundImage = '';
            });
        }
        tex.onmouseout(null);

        const label = document.createElement('div');
        label.textContent = texture.name;
        tex.appendChild(label);

        tex.style.cssFloat = 'left';
        return tex;
    }

    private _makeTextureSection(textures: Texture[]): HTMLElement {
        const toplevel = document.createElement('div');
        toplevel.innerHTML = `
<h2>Textures</h2>
`;
        textures.forEach((texture) => {
            const elem = this._makeTextureElem(texture);
            toplevel.appendChild(elem);
        });
        return toplevel;
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

        const gl = this.viewer.renderState.gl;

        const progressable = sceneDesc.createScene(gl);
        this.viewer.setScene(null);
        this.progressBar.set(progressable);

        this.sceneUIContainer.innerHTML = '';

        progressable.promise.then((result: MainScene) => {
            this.progressBar.set(null);
            this.viewer.setScene(result);

            this.texturesView.innerHTML = '';
            this.texturesView.appendChild(this._makeTextureSection(result.textures));

            this.sceneUIContainer.innerHTML = '';

            if (result.createUI)
                this.sceneUIContainer.appendChild(result.createUI());

            if (result.cameraController === FPSCameraController) {
                this.cameraControllerSelect.selectedIndex = 0;
            } else {
                this.cameraControllerSelect.selectedIndex = 1;
            }
        });

        this._deselectUI();
        window.history.replaceState('', '', '#' + this._saveState());
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
        // Make sure combobox is selected
        for (let i = 0; i < this.groupSelect.options.length; i++) {
            const groupOption = this.groupSelect.options[i];
            if ((<any> groupOption).group === group)
                this.groupSelect.selectedIndex = i;
        }

        this.currentSceneGroup = group;

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

    private showPopup(contents: HTMLElement) {
        if (contents === null) {
            this.popupPaneContainer.innerHTML = '';
            this.popup.style.display = 'none';
        } else if (contents.parentNode) {
            // Already sowing these contents, hide popup.
            this.showPopup(null);
        } else {
            this.popupPaneContainer.innerHTML = '';
            this.popupPaneContainer.appendChild(contents);
            this.popup.style.display = 'block';
        }
    }

    private _onGearButtonClicked() {
        this.showPopup(this.popupSettingsPane);
    }

    private _onHelpButtonClicked() {
        this.showPopup(this.popupHelpPane);
    }

    private _onCloseButtonClicked() {
        this.showPopup(null);
    }

    private _onGroupSelectChange() {
        const option = this.groupSelect.selectedOptions.item(0);
        const group: SceneGroup = (<any> option).group;
        this._loadSceneGroup(group);
    }

    private _makeUI() {
        this.uiContainers = document.createElement('div');
        document.body.appendChild(this.uiContainers);

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

        const progressBarContainer = document.createElement('div');
        progressBarContainer.style.position = 'absolute';
        progressBarContainer.style.left = '2em';
        progressBarContainer.style.right = '2em';
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

        this.sceneUIContainer = document.createElement('div');
        this.sceneUIContainer.style.position = 'absolute';
        this.sceneUIContainer.style.right = '2em';
        this.sceneUIContainer.style.top = '2em';
        this.sceneUIContainer.onkeydown = (e) => {
            e.preventDefault();
        };
        this.uiContainers.appendChild(this.sceneUIContainer);

        this.groupSelect = document.createElement('select');
        this.groupSelect.onchange = this._onGroupSelectChange.bind(this);
        this.groupSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.groupSelect);

        this.sceneSelect = document.createElement('select');
        this.sceneSelect.onchange = this._onSceneSelectChange.bind(this);
        this.sceneSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.sceneSelect);

        this.popup = document.createElement('div');
        this.popup.style.backgroundColor = 'white';
        this.popup.style.position = 'absolute';
        this.popup.style.top = '2em';
        this.popup.style.left = '2em';
        this.popup.style.right = '2em';
        this.popup.style.bottom = '5em';
        this.popup.style.border = '1px solid #666';
        this.popup.style.padding = '1em';
        this.popup.style.display = 'none';
        this.popup.style.overflow = 'auto';
        this.popup.style.font = '100% sans-serif';

        const closeButton = document.createElement('button');
        closeButton.style.position = 'fixed';
        closeButton.style.top = '3em';
        closeButton.style.right = '4em';
        closeButton.textContent = 'X';
        closeButton.onclick = this._onCloseButtonClicked.bind(this);
        this.popup.appendChild(closeButton);

        this.popupPaneContainer = document.createElement('div');
        this.popup.appendChild(this.popupPaneContainer);
        this.uiContainers.appendChild(this.popup);

        // Settings.
        this.popupSettingsPane = document.createElement('div');

        this.popupSettingsPane.innerHTML = `
<h2>Settings</h2>
`;

        const fovSliderLabel = document.createElement('label');
        fovSliderLabel.textContent = "Field of View";
        this.popupSettingsPane.appendChild(fovSliderLabel);

        const fovSlider = document.createElement('input');
        fovSlider.type = 'range';
        fovSlider.max = '100';
        fovSlider.min = '1';
        fovSlider.oninput = this._onFovSliderChange.bind(this);
        this.popupSettingsPane.appendChild(fovSlider);

        this.popupSettingsPane.appendChild(document.createElement('br'));

        const cameraControllerLabel = document.createElement('label');
        cameraControllerLabel.textContent = "Camera Controller";
        this.popupSettingsPane.appendChild(cameraControllerLabel);
        this.cameraControllerSelect = document.createElement('select');
        const cameraControllerFPS = document.createElement('option');
        cameraControllerFPS.textContent = 'WASD';
        this.cameraControllerSelect.appendChild(cameraControllerFPS);
        const cameraControllerOrbit = document.createElement('option');
        cameraControllerOrbit.textContent = 'Orbit';
        this.cameraControllerSelect.appendChild(cameraControllerOrbit);
        this.cameraControllerSelect.onchange = this._onCameraControllerSelect.bind(this);
        this.popupSettingsPane.appendChild(this.cameraControllerSelect);

        this.texturesView = document.createElement('div');
        this.popupSettingsPane.appendChild(this.texturesView);

        const gearButton = document.createElement('button');
        gearButton.style.width = '2em';
        gearButton.style.height = '2em';
        gearButton.style.padding = '0';
        gearButton.style.marginLeft = '1em';
        gearButton.textContent = '⚙';
        gearButton.onclick = this._onGearButtonClicked.bind(this);
        uiContainerR.appendChild(gearButton);

        this.popupHelpPane = document.createElement('div');
        this.popupHelpPane.style.padding = '2em';
        this.popupHelpPane.innerHTML = `
<h1>Jasper's Model Viewer</h1>
<h2>Created by <a href="http://github.com/magcius">Jasper St. Pierre</a></h2>

<p> Basic controls: Use WASD to move around, B to reset the camera, and Z to toggle the UI. Hold
 Shift to go faster, twiddle the mouse wheel to go even faster than that. </p>

<p> Based on reverse engineering work by myself and a large collection of people. Special thanks to
  <a href="https://twitter.com/LordNed">LordNed</a>,
  <a href="https://twitter.com/SageOfMirrors">SageOfMirrors</a>,
  <a href="https://twitter.com/StapleButter">StapleButter</a>,
  <a href="https://twitter.com/xdanieldzd">xdanieldzd</a>,
  <a href="https://twitter.com/Jewelots_">Jewel</a>,
  <a href="https://twitter.com/instant_grat">Simon</a>,
  <a href="https://github.com/vlad001">vlad001</a>,
  and the rest of the Dolphin and Citra crews.
</p>

<p> All art belongs to the original creators. Nintendo's artists especially are fantastic.
`;
        const helpButton = document.createElement('button');
        helpButton.style.width = '2em';
        helpButton.style.height = '2em';
        helpButton.style.padding = '0';
        helpButton.style.marginLeft = '1em';
        helpButton.textContent = '?';
        helpButton.onclick = this._onHelpButtonClicked.bind(this);
        uiContainerR.appendChild(helpButton);
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
        this.viewer.renderState.fov = value * (Math.PI * 0.995);
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
