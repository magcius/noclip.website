
import { Viewer, Scene, SceneDesc } from 'viewer';
import * as SM64DS from 'sm64ds';

export class Main {
    viewer:Viewer;
    sceneDescs: SceneDesc[];

    constructor() {
        const canvas = document.querySelector('canvas');
        this.viewer = new Viewer(canvas);
        this.viewer.start();

        this.sceneDescs = [];

        // The "plugin" part of this.
        this.sceneDescs = this.sceneDescs.concat(SM64DS.loadSceneDescs());

        this.makeUI();
    }

    loadSceneDesc(sceneDesc:SceneDesc) {
        const gl = this.viewer.sceneGraph.renderState.viewport.gl;

        sceneDesc.createScene(gl).then((result:Scene) => {
            this.viewer.setScene(result);

            const textures = document.querySelector('#textures');
            textures.innerHTML = '';
            result.textures.forEach((tex) => {
                const canvas = tex.toCanvas();
                canvas.title = tex.title;
                textures.appendChild(canvas);
            });
        });
    }

    makeUI() {
        const pl = document.querySelector('#pl');

        const select = document.createElement('select');
        this.sceneDescs.forEach(function(entry) {
            const option = document.createElement('option');
            option.textContent = entry.name;
            select.appendChild(option);
        });
        pl.appendChild(select);
        const button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', () => {
            const sceneDesc = this.sceneDescs[select.selectedIndex];
            this.loadSceneDesc(sceneDesc);
        });
        pl.appendChild(button);
    }
}

window.addEventListener('load', function() {
    window.main = new Main();
});
