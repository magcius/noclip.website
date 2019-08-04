
// Parcel HMR workaround.
// https://github.com/parcel-bundler/parcel/issues/289
declare var module: any;
if (module.hot) {
    module.hot.dispose(() => {
        window.location.reload();
        throw new Error();
    });
}

import * as Viewer from '../viewer';
import { OrbitCameraController } from '../Camera';

import * as sunshine_water from './sunshine_water';
import * as orbitview from './orbitview';
import { DataFetcher } from '../DataFetcher';
import { SceneContext, Destroyable } from '../SceneBase';

type CreateSceneFunc = (context: SceneContext, state: string) => Promise<Viewer.SceneGfx>;

const embeds: { [key: string]: CreateSceneFunc } = {
    "sunshine_water": sunshine_water.createScene,
    "orbitview": orbitview.createScene,
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
    private destroyablePool: Destroyable[] = [];
    private abortController: AbortController | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');

        const initErrorCode = Viewer.initializeViewer(this, this.canvas);
        if (initErrorCode !== Viewer.InitErrorCode.SUCCESS) {
            document.body.appendChild(Viewer.makeErrorUI(initErrorCode));
            return;
        }

        document.body.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);
        window.onhashchange = this.loadFromHash.bind(this);

        this.fsButton = new FsButton();
        document.body.appendChild(this.fsButton.elem);

        this.onResize();

        this.loadFromHash();
        this._updateLoop(0);
    }

    private _updateLoop = (time: number) => {
        this.viewer.update(time);
        window.requestAnimationFrame(this._updateLoop);
    };

    private loadFromHash(): void {
        const hash = window.location.hash.slice(1);
        this.loadScene(hash);
    }

    private async loadScene(hash: string) {
        const firstSlash = hash.indexOf('/');
        const embedId = hash.slice(0, firstSlash);
        const state = hash.slice(firstSlash + 1);

        const device = this.viewer.gfxDevice;
        // Destroy the old scene.
        for (let i = 0; i < this.destroyablePool.length; i++)
            this.destroyablePool[i].destroy(device);
        this.destroyablePool.length = 0;

        if (this.abortController !== null)
            this.abortController.abort();

        // TODO(jstpierre): ProgressMeter
        const progressMeter = { setProgress: () => {} };
        this.abortController = new AbortController();
        const abortSignal = this.abortController.signal;
        const destroyablePool = this.destroyablePool;
        const dataFetcher = new DataFetcher(abortSignal, progressMeter);
        // TODO(jstpierre): Support uiContainer in embeds.
        const uiContainer = document.createElement('div');
        const context: SceneContext = { device, dataFetcher, destroyablePool, uiContainer };
        const createScene = embeds[embedId];
        const scene = await createScene(context, state);
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
