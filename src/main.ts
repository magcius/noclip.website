
import { Viewer, Scene, SceneDesc, SceneGroup } from 'viewer';
import * as SM64DS from 'sm64ds/scenes';
import * as ZELVIEW from 'zelview/scenes';
import * as OOT3D from 'oot3d/scenes';
import * as MDL0 from 'mdl0/scenes';

export class Main {
    viewer:Viewer;
    groups:SceneGroup[];

    constructor() {
        const canvas = document.querySelector('canvas');
        this.viewer = new Viewer(canvas);
        this.viewer.start();

        this.groups = [];

        // The "plugin" part of this.
        this.groups.push(MDL0.sceneGroup);
        this.groups.push(SM64DS.sceneGroup);
        this.groups.push(ZELVIEW.sceneGroup);
        this.groups.push(OOT3D.sceneGroup);
        // this.groups.push(J3D.sceneGroup);

        this.makeUI();
    }

    loadSceneDesc(sceneDesc:SceneDesc) {
        const gl = this.viewer.sceneGraph.renderState.viewport.gl;

        sceneDesc.createScene(gl).then((result:Scene) => {
            this.viewer.setScene(result);

            const textures = document.querySelector('#textures');
            textures.innerHTML = '';
            result.textures.forEach((canvas) => {
                textures.appendChild(canvas);
            });
        });
    }

    makeUI() {
        const pl = document.querySelector('#pl');

        const select = document.createElement('select');
        this.groups.forEach((group:SceneGroup) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.name;
            select.appendChild(optgroup);

            group.sceneDescs.forEach((sceneDesc) => {
                const option = document.createElement('option');
                option.textContent = sceneDesc.name;
                (<any> option).sceneDesc = sceneDesc;
                optgroup.appendChild(option);
            });
        });
        pl.appendChild(select);
        const button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', () => {
            const option = select.options[select.selectedIndex];
            const sceneDesc = (<any> option).sceneDesc;
            this.loadSceneDesc(sceneDesc);
        });
        pl.appendChild(button);
    }
}

window.addEventListener('load', function() {
    window.main = new Main();
});
