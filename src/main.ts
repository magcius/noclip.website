
import { Viewer, Scene, SceneDesc, SceneGroup } from 'viewer';
import * as SM64DS from 'sm64ds/scenes';
import * as ZELVIEW from 'zelview/scenes';
import * as OOT3D from 'oot3d/scenes';
import * as MDL0 from 'mdl0/scenes';

class Main {
    canvas:HTMLCanvasElement;
    viewer:Viewer;
    groups:SceneGroup[];

    groupSelect:HTMLSelectElement;
    sceneSelect:HTMLSelectElement;
    gearSettings:HTMLElement;
    _selectedGroup:SceneGroup;

    constructor() {
        this.canvas = document.createElement('canvas');
        document.body.appendChild(this.canvas);
        window.onresize = this._onResize.bind(this);
        this._onResize();

        this.viewer = new Viewer(this.canvas);
        this.viewer.start();

        this.groups = [];

        // The "plugin" part of this.
        this.groups.push(MDL0.sceneGroup);
        this.groups.push(SM64DS.sceneGroup);
        this.groups.push(ZELVIEW.sceneGroup);
        this.groups.push(OOT3D.sceneGroup);
        // this.groups.push(J3D.sceneGroup);

        this._makeUI();

        // Select defaults
        this._loadSceneGroup(this.groups[0]);
    }

    _onResize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    _loadSceneDesc(sceneDesc:SceneDesc) {
        const gl = this.viewer.sceneGraph.renderState.viewport.gl;

        sceneDesc.createScene(gl).then((result:Scene) => {
            this.viewer.setScene(result);

            // XXX: Provide a UI for textures eventually?

            /*
            const textures = document.querySelector('#textures');
            textures.innerHTML = '';
            result.textures.forEach((canvas) => {
                textures.appendChild(canvas);
            });
            */
        });

        // Take focus off of the select.
        this.groupSelect.blur();
        this.sceneSelect.blur();
        this.canvas.focus();
    }

    _onGearButtonClicked() {
        this.gearSettings.style.display = 'block';
    }
    _onGroupSelectChange() {
        const option = this.groupSelect.selectedOptions.item(0);
        const group:SceneGroup = (<any> option).group;
        this._loadSceneGroup(group);
    }

    _loadSceneGroup(group:SceneGroup) {
        if (this._selectedGroup === group)
            return;

        this._selectedGroup = group;

        // Clear.
        this.sceneSelect.innerHTML = '';
        for (const sceneDesc of group.sceneDescs) {
            const sceneOption = document.createElement('option');
            sceneOption.textContent = sceneDesc.name;
            (<any> sceneOption).sceneDesc = sceneDesc;
            this.sceneSelect.appendChild(sceneOption);
        }

        // Load default.
        this._loadSceneDesc(group.sceneDescs[0]);
    }
    _onSceneSelectChange() {
        const option = this.sceneSelect.selectedOptions.item(0);
        const sceneDesc:SceneDesc = (<any> option).sceneDesc;
        this._loadSceneDesc(sceneDesc);
    }

    _makeUI() {
        const uiContainerL = document.createElement('div');
        uiContainerL.style.position = 'absolute';
        uiContainerL.style.left = '2em';
        uiContainerL.style.bottom = '2em';
        document.body.appendChild(uiContainerL);

        const uiContainerR = document.createElement('div');
        uiContainerR.style.position = 'absolute';
        uiContainerR.style.right = '2em';
        uiContainerR.style.bottom = '2em';
        document.body.appendChild(uiContainerR);

        this.groupSelect = document.createElement('select');
        for (const group of this.groups) {
            const groupOption = document.createElement('option');
            groupOption.textContent = group.name;
            (<any> groupOption).group = group;
            this.groupSelect.appendChild(groupOption);
        }
        this.groupSelect.onchange = this._onGroupSelectChange.bind(this);
        this.groupSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.groupSelect);

        this.sceneSelect = document.createElement('select');
        this.sceneSelect.onchange = this._onSceneSelectChange.bind(this);
        this.sceneSelect.style.marginRight = '1em';
        uiContainerL.appendChild(this.sceneSelect);

        // XXX: Add back settings panel at a later time...

        /*
        this.gearSettings = document.createElement('div');
        this.gearSettings.style.backgroundColor = 'white';
        this.gearSettings.style.position = 'absolute';
        this.gearSettings.style.top = '0px';
        this.gearSettings.style.bottom = '0px';
        this.gearSettings.style.right = '0px';
        this.gearSettings.style.width = '300px';
        this.gearSettings.style.boxShadow = '-2px 0px 10px rgba(0, 0, 0, 0.4)';
        this.gearSettings.style.display = 'none';
        document.body.appendChild(this.gearSettings);

        const gearButton = document.createElement('button');
        gearButton.textContent = '⚙';
        gearButton.onclick = this._onGearButtonClicked.bind(this);
        uiContainerR.appendChild(gearButton);
        */
    }
}

window.onload = function() {
    window.main = new Main();
};
