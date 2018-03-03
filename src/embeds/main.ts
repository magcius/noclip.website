
import { System } from 'systemjs';

import * as Viewer from 'viewer';
import { Progressable } from 'progress';

interface EmbedModule {
    createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene>;
}

class Main {
    private canvas: HTMLCanvasElement;
    private viewer: Viewer.Viewer;

    constructor() {
        this.canvas = document.createElement('canvas');

        document.body.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);
        this.onResize();

        this.viewer = new Viewer.Viewer(this.canvas);
        this.viewer.start();

        // Dispatch to the main embed.
        const hash = window.location.hash.slice(1);

        this.loadScene(hash);
    }

    private loadScene(hash: string) {
        System.import(`embeds/${hash}`).then((embedModule: EmbedModule) => {
            const gl = this.viewer.renderState.gl;
            embedModule.createScene(gl).then((scene: Viewer.MainScene) => {
                this.viewer.setScene(scene);
            });
        });
    }

    private onResize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }
}

window.main = new Main();
