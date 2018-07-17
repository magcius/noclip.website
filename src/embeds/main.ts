
import Progressable from '../Progressable';
import * as Viewer from '../viewer';
import { OrbitCameraController } from '../Camera';

import * as sunshine_water from './sunshine_water';

type CreateSceneFunc = (gl: WebGL2RenderingContext, name: string) => Progressable<Viewer.MainScene>;

const embeds: { [key: string]: CreateSceneFunc } = {
    "sunshine_water": sunshine_water.createScene,
};

class FsButton {
    public elem: HTMLElement;
    private hover: boolean = false;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.border = '1px solid rgba(255, 255, 255, 0.4)';
        this.elem.style.borderRadius = '4px';
        this.elem.style.color = 'white';
        this.elem.style.position = 'absolute';
        this.elem.style.bottom = '8px';
        this.elem.style.right = '8px';
        this.elem.style.width = '32px';
        this.elem.style.height = '32px';
        this.elem.style.font = '130% bold sans-serif';
        this.elem.style.textAlign = 'center';
        this.elem.style.cursor = 'pointer';
        this.elem.onmouseover = () => {
            this.hover = true;
            this.style();
        };
        this.elem.onmouseout = () => {
            this.hover = false;
            this.style();
        };
        this.elem.onclick = this.onClick.bind(this);
        document.addEventListener('fullscreenchange', this.style.bind(this));
        this.style();
    }

    private isFS() {
        return document.fullscreenElement === document.body;
    }

    private style() {
        this.elem.style.backgroundColor = this.hover ? 'rgba(50, 50, 50, 0.8)' : 'rgba(0, 0, 0, 0.8)';
        this.elem.textContent = this.isFS() ? '🡼' : '🡾';
    }

    private onClick() {
        if (this.isFS())
            document.exitFullscreen();
        else
            document.body.requestFullscreen();
    }
}

class Main {
    private canvas: HTMLCanvasElement;
    private viewer: Viewer.Viewer;
    private fsButton: FsButton;

    constructor() {
        this.canvas = document.createElement('canvas');

        document.body.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);

        this.fsButton = new FsButton();
        document.body.appendChild(this.fsButton.elem);

        this.viewer = new Viewer.Viewer(this.canvas);
        this.viewer.start();

        // Dispatch to the main embed.
        const hash = window.location.hash.slice(1);

        this.onResize();
        this.loadScene(hash);
    }

    private async loadScene(hash: string) {
        const [file, name] = hash.split('/');
        const gl = this.viewer.renderState.gl;
        const createScene = embeds[file];
        createScene(gl, name).then((scene: Viewer.MainScene) => {
            this.viewer.setCameraController(new OrbitCameraController());
            this.viewer.setScene(scene);
        });
    }

    private onResize() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = Math.ceil(window.innerWidth * devicePixelRatio);
        this.canvas.height = Math.ceil(window.innerHeight * devicePixelRatio);
    }
}

window.main = new Main();
