
// Parcel HMR workaround.
// https://github.com/parcel-bundler/parcel/issues/289
declare var module: any;
if (module.hot) {
    module.hot.dispose(() => {
        window.location.reload();
        throw new Error();
    });
}

import Progressable from '../Progressable';
import * as Viewer from '../viewer';
import { OrbitCameraController } from '../Camera';

import * as sunshine_water from './sunshine_water';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

type CreateSceneFunc = (device: GfxDevice, name: string) => Progressable<Viewer.SceneGfx>;

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
        // @ts-ignore
        // https://github.com/Microsoft/TSJS-lib-generator/pull/597
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
    public viewer: Viewer.Viewer;
    private canvas: HTMLCanvasElement;
    private fsButton: FsButton;

    constructor() {
        this.canvas = document.createElement('canvas');

        const initErrorCode = Viewer.initializeViewer(this, this.canvas);
        if (initErrorCode !== Viewer.InitErrorCode.SUCCESS) {
            document.body.appendChild(Viewer.makeErrorUI(initErrorCode));
            return;
        }

        document.body.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);

        this.fsButton = new FsButton();
        document.body.appendChild(this.fsButton.elem);

        // Dispatch to the main embed.
        const hash = window.location.hash.slice(1);

        this.onResize();
        this.loadScene(hash);

        this._updateLoop(0);
    }

    private _updateLoop = (time: number) => {
        this.viewer.update(time);
        window.requestAnimationFrame(this._updateLoop);
    };

    private async loadScene(hash: string) {
        const [file, name] = hash.split('/');
        const device = this.viewer.gfxDevice;
        const createScene = embeds[file];
        const scene = await createScene(device, name);
        this.viewer.setScene(scene);
        this.viewer.setCameraController(new OrbitCameraController());
    }

    private onResize() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = Math.ceil(window.innerWidth * devicePixelRatio);
        this.canvas.height = Math.ceil(window.innerHeight * devicePixelRatio);
    }
}

window.main = new Main();
