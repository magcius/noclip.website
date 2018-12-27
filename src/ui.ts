
// New UI system

import * as Viewer from './viewer';
import Progressable from './Progressable';
import { assertExists, assert } from './util';
import { CameraControllerClass, OrbitCameraController, FPSCameraController } from './Camera';
import { RenderStatistics } from './render';
import { Color, colorToCSS } from './Color';
import { TextureHolder } from './TextureHolder';
import { GITHUB_REVISION_URL, GITHUB_URL, GIT_SHORT_REVISION } from './BuildVersion';

const HIGHLIGHT_COLOR = 'rgb(210, 30, 30)';

export function createDOMFromString(s: string): DocumentFragment {
    return document.createRange().createContextualFragment(s);
}

function setChildren(parent: Element, children: Element[]): void {
    // We want to swap children around without removing them, since removing them will cause
    // a relayout and possibly break scroll positions.

    // Go through and add any new children.
    for (let i = 0; i < children.length; i++)
        if (children[i].parentNode !== parent)
            parent.appendChild(children[i]);

    // Remove any children that we don't want.
    for (let i = 0; i < parent.childElementCount;) {
        const child = parent.children.item(i);
        if (children.includes(child))
            i++;
        else
            parent.removeChild(child);
    }

    // Now the DOM node should only contain the children.
    assert(parent.childElementCount === children.length);

    // Put them in the right order by making as few moves as possible.
    for (let i = 0; i < children.length - 1; i++)
        if (parent.children.item(i) !== children[i])
            parent.insertBefore(children[i], parent.children.item(i));
}

function setElementHighlighted(elem: HTMLElement, highlighted: boolean, normalTextColor: string = '') {
    elem.classList.toggle('Highlighted', highlighted);

    if (highlighted) {
        elem.style.backgroundColor = HIGHLIGHT_COLOR;
        elem.style.color = 'black';
    } else {
        elem.style.backgroundColor = '';
        elem.style.color = normalTextColor;
    }
}

export interface Flair {
    index: number;
    background?: string;
    color?: string;
    bulletColor?: string;
}

function highlightFlair(i: number): Flair {
    return { index: i, background: HIGHLIGHT_COLOR, color: 'black' };
}

export interface Widget {
    elem: HTMLElement;
}

export abstract class ScrollSelect implements Widget {
    public elem: HTMLElement;

    protected toplevel: HTMLElement;
    protected scrollContainer: HTMLElement;
    protected flairs: Flair[] = [];
    protected internalFlairs: Flair[] = [];

    constructor() {
        this.toplevel = document.createElement('div');

        this.scrollContainer = document.createElement('div');
        this.setHeight(`200px`);
        this.scrollContainer.style.overflow = 'auto';
        this.scrollContainer.style.userSelect = 'none';
        this.scrollContainer.style.webkitUserSelect = 'none';
        this.toplevel.appendChild(this.scrollContainer);

        this.elem = this.toplevel;
    }

    public setHeight(height: string): void {
        this.scrollContainer.style.height = height;
    }

    public setStrings(strings: string[]): void {
        this.scrollContainer.style.display = (strings.length > 0) ? '' : 'none';
        this.scrollContainer.innerHTML = '';
        for (let i = 0; i < strings.length; i++) {
            const selector = document.createElement('div');
            selector.style.display = 'list-item';
            selector.style.cursor = 'pointer';
            const textSpan = document.createElement('span');
            textSpan.style.fontWeight = 'bold';
            textSpan.textContent = strings[i];
            selector.appendChild(textSpan);
            const index = i;
            selector.onmousedown = () => {
                this.itemClicked(index, true);
            };
            selector.onmouseover = (e) => {
                if (e.buttons !== 0)
                    this.itemClicked(index, false);
            };
            this.scrollContainer.appendChild(selector);
        }
    }

    public getNumItems() {
        return this.scrollContainer.childElementCount;
    }

    public setFlairs(flairs: Flair[]) {
        this.flairs = flairs;
        this.syncFlairs();
    }

    protected setInternalFlairs(flairs: Flair[]): void {
        this.internalFlairs = flairs;
        this.syncFlairs();
    }

    private syncFlairs(): void {
        const flairs = [...this.internalFlairs, ...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            const selector = this.scrollContainer.children.item(i) as HTMLElement;
            const flair = flairs.find((flair) => flair.index === i);

            const background = (flair !== undefined && flair.background !== undefined) ? flair.background : '';
            selector.style.background = background;
            const textSpan = assertExists(selector.querySelector('span'));
            const color = (flair !== undefined && flair.color !== undefined) ? flair.color : '';
            textSpan.style.color = color;
            if (flair !== undefined && flair.bulletColor !== undefined) {
                selector.style.listStyleType = 'disc';
                selector.style.listStylePosition = 'inside';
                selector.style.marginLeft = '4px';
                selector.style.color = flair.bulletColor;
            } else {
                selector.style.listStyleType = '';
                selector.style.color = '';
                selector.style.marginLeft = '';
            }
        }
    }

    protected abstract itemClicked(index: number, first: boolean): void;
}

export class SingleSelect extends ScrollSelect {
    public onselectionchange: (index: number) => void;

    public itemClicked(index: number, first: boolean) {
        this.selectItem(index);
    }

    public selectItem(index: number) {
        this.onselectionchange(index);
    }

    public setHighlighted(highlightedIndex: number) {
        this.setInternalFlairs([highlightFlair(highlightedIndex)]);
    }
}

export class SimpleSingleSelect extends SingleSelect {
    public selectItem(index: number) {
        super.selectItem(index);
        this.setHighlighted(index);
    }
}

export class MultiSelect extends ScrollSelect {
    public itemIsOn: boolean[] = [];
    public onitemchanged: (index: number, v: boolean) => void;
    private itemShouldBeOn: boolean;

    constructor() {
        super();

        const allNone = createDOMFromString(`
<div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 4px;">
<style>
.AllButton, .NoneButton {
    text-align: center;
    line-height: 32px;
    cursor: pointer;
    background: #666;
    font-weight: bold;
}
</style>
<div class="AllButton">All</div><div class="NoneButton">None</div>
</div>
`);
        this.toplevel.insertBefore(allNone, this.toplevel.firstChild);

        const allButton: HTMLElement = this.toplevel.querySelector('.AllButton');
        allButton.onclick = () => {
            for (let i = 0; i < this.getNumItems(); i++)
                this.setItemIsOn(i, true);
            this.syncInternalFlairs();
        };
        const noneButton: HTMLElement = this.toplevel.querySelector('.NoneButton');
        noneButton.onclick = () => {
            for (let i = 0; i < this.getNumItems(); i++)
                this.setItemIsOn(i, false);
            this.syncInternalFlairs();
        };
    }

    private setItemIsOn(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.onitemchanged(index, this.itemIsOn[index]);
    }

    public itemClicked(index: number, first: boolean) {
        if (first)
            this.itemShouldBeOn = !this.itemIsOn[index];
        this.setItemIsOn(index, this.itemShouldBeOn);
        this.syncInternalFlairs();
    }

    private syncInternalFlairs() {
        const flairs: Flair[] = [...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            const bulletColor = !!this.itemIsOn[i] ? HIGHLIGHT_COLOR : '#aaa';
            const color = !!this.itemIsOn[i] ? 'white' : '#aaa';
            flairs.push({ index: i, bulletColor, color });
        }
        this.setInternalFlairs(flairs);
    }

    public setItemsSelected(isOn: boolean[]) {
        this.itemIsOn = isOn;
        this.syncInternalFlairs();
    }

    public setItemSelected(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.syncInternalFlairs();
    }
}

export class Panel implements Widget {
    public elem: HTMLElement;

    protected expanded: boolean;
    protected header: HTMLElement;
    protected svgIcon: SVGSVGElement;

    private toplevel: HTMLElement;
    public extraRack: HTMLElement;
    public mainPanel: HTMLElement;
    public contents: HTMLElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.color = 'white';
        this.toplevel.style.font = '16px monospace';
        this.toplevel.style.overflow = 'hidden';
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridAutoFlow = 'column';
        this.toplevel.style.gridGap = '20px';
        this.toplevel.style.transition = '.25s ease-out';
        this.toplevel.style.alignItems = 'start';

        this.mainPanel = document.createElement('div');
        this.mainPanel.style.overflow = 'hidden';
        this.mainPanel.style.transition = '.25s ease-out';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.appendChild(this.mainPanel);

        this.extraRack = document.createElement('div');
        this.extraRack.style.gridAutoFlow = 'column';
        this.extraRack.style.gridGap = '20px';
        this.extraRack.style.transition = '.15s ease-out .10s';
        this.toplevel.appendChild(this.extraRack);

        this.header = document.createElement('h1');
        this.header.style.lineHeight = '28px';
        this.header.style.width = '400px';
        this.header.style.margin = '0';
        this.header.style.color = HIGHLIGHT_COLOR;
        this.header.style.fontSize = '100%';
        this.header.style.textAlign = 'center';
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.webkitUserSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.toplevel.onmouseover = this.syncSize.bind(this);
        this.toplevel.onmouseout = this.syncSize.bind(this);
        this.header.onclick = () => {
            this.toggleExpanded();
        };
        this.mainPanel.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.width = '400px';
        this.mainPanel.appendChild(this.contents);

        this.elem = this.toplevel;
    }

    private syncSize() {
        const widthExpanded = this.expanded || this.mainPanel.matches(':hover');
        this.mainPanel.style.width = widthExpanded ? '400px' : '28px';

        const heightExpanded = this.expanded;
        if (heightExpanded) {
            const height = Math.max(this.header.offsetHeight + this.contents.offsetHeight, this.extraRack.offsetHeight);
            this.toplevel.style.height = `${height}px`;
            this.extraRack.style.opacity = '1';
            this.extraRack.style.width = 'auto';
        } else {
            this.toplevel.style.transition = '.25s ease-out';
            this.toplevel.style.height = '28px';
            this.extraRack.style.opacity = '0';
            this.extraRack.style.width = '0';
        }
    }

    public setVisible(v: boolean) {
        this.toplevel.style.display = v ? 'grid' : 'none';
    }

    public setTitle(icon: string, title: string) {
        const svgIcon = createDOMFromString(icon).querySelector('svg');
        this.svgIcon = svgIcon;
        this.svgIcon.style.gridColumn = '1';
        this.header.textContent = title;
        this.header.appendChild(this.svgIcon);
        this.toplevel.dataset.title = title;

        this.setExpanded(false);
    }

    protected syncHeaderStyle() {
        this.svgIcon.style.fill = this.expanded ? 'black' : '';
        setElementHighlighted(this.header, this.expanded, HIGHLIGHT_COLOR);
    }

    public setExpanded(expanded: boolean) {
        this.expanded = expanded;
        this.syncHeaderStyle();
        this.syncSize();
    }

    private toggleExpanded() {
        this.setExpanded(!this.expanded);
    }
}

const OPEN_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><path d="M84.3765045,45.2316481 L77.2336539,75.2316205 L77.2336539,75.2316205 C77.1263996,75.6820886 76.7239081,76 76.2608477,76 L17.8061496,76 C17.2538649,76 16.8061496,75.5522847 16.8061496,75 C16.8061496,74.9118841 16.817796,74.8241548 16.8407862,74.739091 L24.7487983,45.4794461 C24.9845522,44.607157 25.7758952,44.0012839 26.6794815,44.0012642 L83.4036764,44.0000276 L83.4036764,44.0000276 C83.9559612,44.0000156 84.4036862,44.4477211 84.4036982,45.0000058 C84.4036999,45.0780163 84.3945733,45.155759 84.3765045,45.2316481 L84.3765045,45.2316481 Z M15,24 L26.8277004,24 L26.8277004,24 C27.0616369,24 27.2881698,24.0820162 27.4678848,24.2317787 L31.799078,27.8411064 L31.799078,27.8411064 C32.697653,28.5899189 33.8303175,29 35,29 L75,29 C75.5522847,29 76,29.4477153 76,30 L76,38 L76,38 C76,38.5522847 75.5522847,39 75,39 L25.3280454,39 L25.3280454,39 C23.0690391,39 21.0906235,40.5146929 20.5012284,42.6954549 L14.7844016,63.8477139 L14.7844016,63.8477139 C14.7267632,64.0609761 14.5071549,64.1871341 14.2938927,64.1294957 C14.1194254,64.0823423 13.9982484,63.9240598 13.9982563,63.7433327 L13.9999561,25 L14,25 C14.0000242,24.4477324 14.4477324,24.0000439 15,24.0000439 L15,24 Z"/></svg>`;

class SceneSelect extends Panel {
    private sceneGroups: Viewer.SceneGroup[] = [];
    private sceneDescs: Viewer.SceneDesc[] = [];

    private sceneGroupList: SingleSelect;
    private sceneDescList: SingleSelect;

    private selectedSceneGroup: Viewer.SceneGroup;
    private currentSceneGroup: Viewer.SceneGroup;
    private currentSceneDesc: Viewer.SceneDesc;
    private loadProgress: number;

    public onscenedescselected: (sceneGroup: Viewer.SceneGroup, sceneDesc: Viewer.SceneDesc) => void;

    constructor(private viewer: Viewer.Viewer) {
        super();
        this.setTitle(OPEN_ICON, 'Scenes');

        this.sceneGroupList = new SingleSelect();
        this.contents.appendChild(this.sceneGroupList.elem);

        this.sceneDescList = new SingleSelect();
        this.sceneDescList.elem.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.sceneDescList.elem.style.width = '500px';
        this.sceneDescList.setHeight('250px');
        this.extraRack.appendChild(this.sceneDescList.elem);

        this.sceneGroupList.onselectionchange = (i: number) => {
            this.selectSceneGroup(i);
        };

        this.sceneDescList.onselectionchange = (i: number) => {
            this.selectSceneDesc(i);
        };
    }

    public setProgressable(p: Progressable<any>) {
        this.setLoadProgress(p.progress);
        p.onProgress = () => {
            this.setLoadProgress(p.progress);
        };
    }

    public setCurrentDesc(sceneGroup: Viewer.SceneGroup, sceneDesc: Viewer.SceneDesc) {
        this.selectedSceneGroup = sceneGroup;
        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.syncSceneDescs();
    }

    public setSceneGroups(sceneGroups: Viewer.SceneGroup[]) {
        this.sceneGroups = sceneGroups;
        const strings = this.sceneGroups.filter((g) => g.sceneDescs.length > 0).map((g) => g.name);
        this.sceneGroupList.setStrings(strings);
        this.syncSceneDescs();
    }

    public setLoadProgress(pct: number) {
        this.loadProgress = pct;
        this.syncFlairs();
        this.syncHeaderStyle();
    }

    private selectSceneDesc(i: number) {
        this.onscenedescselected(this.selectedSceneGroup, this.sceneDescs[i]);
    }

    private getLoadingGradient() {
        const pct = `${Math.round(this.loadProgress * 100)}%`;
        return `linear-gradient(to right, ${HIGHLIGHT_COLOR} ${pct}, transparent ${pct})`;
    }

    protected syncHeaderStyle() {
        super.syncHeaderStyle();

        setElementHighlighted(this.header, this.expanded);

        if (this.expanded)
            this.header.style.background = HIGHLIGHT_COLOR;
        else
            this.header.style.background = this.getLoadingGradient();
    }

    private syncFlairs() {
        const selectedGroupIndex = this.sceneGroups.indexOf(this.selectedSceneGroup);
        const flairs: Flair[] = [ { index: selectedGroupIndex, background: HIGHLIGHT_COLOR, color: 'black' } ];

        const currentGroupIndex = this.sceneGroups.indexOf(this.currentSceneGroup);
        if (currentGroupIndex >= 0)
            flairs.push({ index: currentGroupIndex, background: '#666' });
        this.sceneGroupList.setFlairs(flairs);

        const selectedDescIndex = this.sceneDescs.indexOf(this.currentSceneDesc);
        if (selectedDescIndex >= 0) {
            const loadingGradient = this.getLoadingGradient();
            const textColor = this.loadProgress > 0.5 ? 'black' : undefined;
            this.sceneDescList.setFlairs([ { index: selectedDescIndex, background: loadingGradient, color: textColor } ]);
        }
    }

    private selectSceneGroup(i: number) {
        const sceneGroup = this.sceneGroups[i];
        this.selectedSceneGroup = sceneGroup;
        this.syncSceneDescs();
    }

    private syncSceneDescs() {
        if (this.selectedSceneGroup)
            this.setSceneDescs(this.selectedSceneGroup.sceneDescs);
        else if (this.currentSceneGroup)
            this.setSceneDescs(this.currentSceneGroup.sceneDescs);
        else
            this.setSceneDescs([]);
    }

    private setSceneDescs(sceneDescs: Viewer.SceneDesc[]) {
        this.sceneDescs = sceneDescs;
        const strings = sceneDescs.map((desc) => desc.name);
        this.sceneDescList.setStrings(strings);
        this.syncFlairs();
    }
}

function cloneCanvas(dst: HTMLCanvasElement, src: HTMLCanvasElement): void {
    dst.width = src.width;
    dst.height = src.height;
    dst.title = src.title;
    const ctx = dst.getContext('2d');
    ctx.drawImage(src, 0, 0);
}

const CHECKERBOARD_IMAGE = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSwooAAAAAElFTkSuQmCC")';

const TEXTURES_ICON = `<svg viewBox="0 0 512 512" height="20" fill="white"><path d="M143.5,143.5v300h300v-300H143.5z M274.8,237.2c10.3,0,18.7,8.4,18.7,18.9c0,10.3-8.4,18.7-18.7,18.7   c-10.3,0-18.7-8.4-18.7-18.7C256,245.6,264.4,237.2,274.8,237.2z M406,406H181v-56.2l56.2-56.1l37.5,37.3l75-74.8l56.2,56.1V406z"/><polygon points="387.2,68.6 68.5,68.6 68.5,368.5 106,368.5 106,106 387.2,106"/></svg>`;

export class TextureViewer extends Panel {
    private scrollList: SingleSelect;
    private surfaceView: HTMLElement;
    private fullSurfaceView: HTMLElement;
    private properties: HTMLElement;
    private textureList: Viewer.Texture[] = [];

    constructor() {
        super();

        this.setTitle(TEXTURES_ICON, 'Textures');

        this.scrollList = new SingleSelect();
        this.scrollList.elem.style.height = `200px`;
        this.scrollList.elem.style.overflow = 'auto';
        this.scrollList.onselectionchange = (i: number) => {
            this.selectTexture(i);
        };
        this.contents.appendChild(this.scrollList.elem);

        this.surfaceView = document.createElement('div');
        this.surfaceView.style.width = '100%';
        this.surfaceView.style.height = '200px';

        // TODO(jstpierre): Make a less-sucky UI for the texture view.
        this.surfaceView.onmouseover = () => {
            // Checkerboard
            this.surfaceView.style.backgroundColor = 'white';
            this.surfaceView.style.backgroundImage = CHECKERBOARD_IMAGE;
        };
        this.surfaceView.onmouseout = () => {
            this.surfaceView.style.backgroundColor = 'black';
            this.surfaceView.style.backgroundImage = '';
        };
        this.surfaceView.onmouseout(null);

        this.contents.appendChild(this.surfaceView);

        this.properties = document.createElement('div');
        this.contents.appendChild(this.properties);

        this.fullSurfaceView = document.createElement('div');
        this.fullSurfaceView.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
        this.fullSurfaceView.style.padding = '20px';
        this.extraRack.appendChild(this.fullSurfaceView);
    }

    private showInSurfaceView(surface: HTMLCanvasElement) {
        this.surfaceView.innerHTML = '';
        surface.style.width = '100%';
        surface.style.height = '100%';
        surface.style.objectFit = 'scale-down';
        this.surfaceView.appendChild(surface);
    }

    private showInFullSurfaceView(surfaces: HTMLCanvasElement[]) {
        this.fullSurfaceView.innerHTML = '';

        for (const surface of surfaces) {
            const newCanvas = document.createElement('canvas');
            cloneCanvas(newCanvas, surface);
            newCanvas.style.display = 'block';
            newCanvas.style.backgroundColor = 'white';
            newCanvas.style.backgroundImage = CHECKERBOARD_IMAGE;

            this.fullSurfaceView.appendChild(newCanvas);
        }
    }

    private selectTexture(i: number) {
        const texture: Viewer.Texture = this.textureList[i];
        this.scrollList.setHighlighted(i);

        const properties = new Map<string, string>();
        properties.set('Name', texture.name);
        properties.set('Mipmaps', '' + texture.surfaces.length);
        properties.set('Width', '' + texture.surfaces[0].width);
        properties.set('Height', '' + texture.surfaces[0].height);

        if (texture.extraInfo) {
            texture.extraInfo.forEach((value, key) => properties.set(key, value));
        }

        this.properties.innerHTML = `<div style="display: grid; grid-template-columns: 1fr 1fr"></div>`;

        const div = this.properties.firstElementChild;
        properties.forEach((value, name) => {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            div.appendChild(nameSpan);
            const valueSpan = document.createElement('span');
            valueSpan.style.textAlign = 'right';
            valueSpan.textContent = value;
            div.appendChild(valueSpan);
        });

        this.showInSurfaceView(texture.surfaces[0]);
        this.showInFullSurfaceView(texture.surfaces);
    }

    public setTextureList(textures: Viewer.Texture[]) {
        this.setVisible(textures.length > 0);
        if (textures.length === 0)
            return;

        const strings = textures.map((texture) => texture.name);
        this.scrollList.setStrings(strings);
        this.textureList = textures;
    }

    public setTextureHolder(textureHolder: TextureHolder<any>): void {
        this.setTextureList(textureHolder.viewerTextures);
        textureHolder.onnewtextures = () => {
            this.setTextureList(textureHolder.viewerTextures);
        };
    }
}

const FRUSTUM_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><polygon points="48.2573,19.8589 33.8981,15.0724 5,67.8384 48.2573,90.3684" /><polygon points="51.5652,19.8738 51.5652,90.3734 95,67.8392 65.9366,15.2701" /><polygon points="61.3189,13.2756 49.9911,9.6265 38.5411,13.1331 49.9213,16.9268" /></svg>`;

class ViewerSettings extends Panel {
    private fovSlider: HTMLElement;
    private cameraControllerWASD: HTMLElement;
    private cameraControllerOrbit: HTMLElement;
    private cullingOn: HTMLElement;
    private cullingOff: HTMLElement;

    constructor(private viewer: Viewer.Viewer) {
        super();

        this.setTitle(FRUSTUM_ICON, 'Viewer Settings');

        // TODO(jstpierre): make css not leak
        this.contents.innerHTML = `
<style>
.Slider {
    -webkit-appearance: none;
    width: 100%;
    height: 24px;
    margin: 0;
}
.Slider::-moz-range-thumb {
    width: 16px;
    height: 24px;
    cursor: pointer;
    background: ${HIGHLIGHT_COLOR};
    border-radius: 0;
    border: none;
}
.Slider::-webkit-slider-thumb {
    width: 16px;
    height: 24px;
    cursor: pointer;
    background: ${HIGHLIGHT_COLOR};
    border-radius: 0;
    border: none;
}
.Slider::-moz-range-track {
    height: 24px;
    cursor: pointer;
    background: #444;
}
.Slider::-webkit-slider-runnable-track {
    height: 24px;
    cursor: pointer;
    background: #444;
}
.Slider::-moz-range-progress {
    height: 24px;
    cursor: pointer;
    background: #aaa;
}
.SettingsHeader, .SettingsButton {
    text-align: center;
    font-weight: bold;
    line-height: 24px;
}
.SettingsButton {
    background: #444;
    line-height: 32px;
    cursor: pointer;
}
</style>
<div class="SettingsHeader">Field of View</div>
<div><input class="Slider FoVSlider" type="range" min="1" max="100"></div>
<div class="SettingsHeader">Camera Controller</div>
<div style="display: grid; grid-template-columns: 1fr 1fr;">
<div class="SettingsButton CameraControllerWASD">WASD</div><div class="SettingsButton CameraControllerOrbit">Orbit</div>
</div>
<div class="SettingsHeader">Culling?</div>
<div style="display: grid; grid-template-columns: 1fr 1fr;">
<div class="SettingsButton CullingOn">On</div><div class="SettingsButton CullingOff">Off</div>
</div>
`;
        this.fovSlider = this.contents.querySelector('.FoVSlider');
        this.fovSlider.oninput = this.onFovSliderChange.bind(this);

        this.cameraControllerWASD = this.contents.querySelector('.CameraControllerWASD');
        this.cameraControllerWASD.onclick = () => {
            this.setCameraControllerClass(FPSCameraController);
        };

        this.cameraControllerOrbit = this.contents.querySelector('.CameraControllerOrbit');
        this.cameraControllerOrbit.onclick = () => {
            this.setCameraControllerClass(OrbitCameraController);
        };

        this.cullingOn = this.contents.querySelector('.CullingOn');
        this.cullingOn.onclick = () => {
            this.setCulling(true);
        };

        this.cullingOff = this.contents.querySelector('.CullingOff');
        this.cullingOff.onclick = () => {
            this.setCulling(false);
        };
    }

    private _getSliderT(slider: HTMLInputElement) {
        return (+slider.value - +slider.min) / (+slider.max - +slider.min);
    }

    private onFovSliderChange(e: UIEvent): void {
        const slider = (<HTMLInputElement> e.target);
        const value = this._getSliderT(slider);
        this.viewer.renderState.fov = value * (Math.PI * 0.995);
    }

    private setCameraControllerClass(cameraControllerClass: CameraControllerClass) {
        this.viewer.setCameraController(new cameraControllerClass());
        this.cameraControllerSelected(cameraControllerClass);
    }

    public cameraControllerSelected(cameraControllerClass: CameraControllerClass) {
        setElementHighlighted(this.cameraControllerWASD, cameraControllerClass === FPSCameraController);
        setElementHighlighted(this.cameraControllerOrbit, cameraControllerClass === OrbitCameraController);
    }

    public setCulling(value: boolean) {
        this.viewer.renderState.forceDisableCulling = !value;
        setElementHighlighted(this.cullingOn, value);
        setElementHighlighted(this.cullingOff, !value);
    }
}

class LineGraph {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public textYOffset: number = 0;

    constructor(public minY: number = 0, public maxY: number = 160) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
    }

    public beginDraw(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, width, height);

        this.textYOffset = 24;
    }

    public drawPoints(points: number[], color: Color): void {
        const width = this.canvas.width;
        const height = this.canvas.height;

        const ctx = this.ctx;

        const pointsRange = points.length - 1;
        const valuesRange = (this.maxY - this.minY) - 1;

        const scaleX = width / pointsRange;
        const scaleY = height / valuesRange;

        ctx.lineWidth = 2;
        ctx.strokeStyle = colorToCSS(color);
        ctx.fillStyle = colorToCSS({ r: color.r, g: color.g, b: color.b, a: color.a - 0.8 });
        ctx.beginPath();
        ctx.lineTo(width + 20, height + 20);
        for (let i = 0; i < points.length; i++) {
            ctx.lineTo(width - i * scaleX, height - (points[i] - this.minY) * scaleY);
        }
        ctx.lineTo(-20, height + 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    public drawText(text: string): void {
        const ctx = this.ctx;

        ctx.fillStyle = 'white';
        ctx.font = '12pt monospace';
        ctx.fillText(text, 16, this.textYOffset);
        this.textYOffset += 16;
    }
}

const STATISTICS_ICON = `
<svg viewBox="5 0 55 60" height="16" fill="white"><g><polygon points="6.9,11.5 6.9,56 55.4,56 55.4,53 9.9,53 9.9,11.5"/><path d="M52.7,15.8c-2.7,0-4.9,2.2-4.9,4.9c0,1,0.3,1.8,0.8,2.6l-5,6.8c-0.4-0.1-0.9-0.2-1.3-0.2c-1.5,0-2.9,0.7-3.8,1.8l-5.6-2.8   c0-0.2,0.1-0.5,0.1-0.8c0-2.7-2.2-4.9-4.9-4.9s-4.9,2.2-4.9,4.9c0,1.1,0.3,2,0.9,2.8l-3.9,5.1c-0.5-0.2-1.1-0.3-1.7-0.3   c-2.7,0-4.9,2.2-4.9,4.9s2.2,4.9,4.9,4.9s4.9-2.2,4.9-4.9c0-1-0.3-2-0.8-2.7l4-5.2c0.5,0.2,1.1,0.3,1.6,0.3c1.4,0,2.6-0.6,3.5-1.5   l5.8,2.9c0,0.1,0,0.2,0,0.3c0,2.7,2.2,4.9,4.9,4.9c2.7,0,4.9-2.2,4.9-4.9c0-1.2-0.4-2.2-1.1-3.1l4.8-6.5c0.6,0.2,1.2,0.4,1.9,0.4   c2.7,0,4.9-2.2,4.9-4.9S55.4,15.8,52.7,15.8z"/></g></svg>`;

class StatisticsPanel extends Panel {
    public history: RenderStatistics[] = [];
    private fpsGraph = new LineGraph();
    private fpsPoints: number[] = [];
    private fpsColor: Color = { r: 0.4, g: 0.9, b: 0.6, a: 1.0 };

    constructor() {
        super();
        this.setTitle(STATISTICS_ICON, 'Statistics');

        this.contents.appendChild(this.fpsGraph.canvas);
    }

    public addRenderStatistics(renderStatistics: RenderStatistics): void {
        if (!this.expanded)
            return;

        this.history.unshift({ ...renderStatistics });

        while (this.history.length > 100) {
            this.history.pop();
        }

        this.fpsPoints.length = 100;
        for (let i = 0; i < this.fpsPoints.length; i++) {
            this.fpsPoints[i] = this.history[i] !== undefined ? this.history[i].fps : 0;
        }

        this.fpsGraph.beginDraw(400, 200);
        this.fpsGraph.drawPoints(this.fpsPoints, this.fpsColor);

        this.fpsGraph.drawText(`FPS: ${renderStatistics.fps | 0}`);
        if (renderStatistics.drawCallCount)
            this.fpsGraph.drawText(`Draw Calls: ${renderStatistics.drawCallCount}`);
        if (renderStatistics.textureBindCount)
            this.fpsGraph.drawText(`Texture Binds: ${renderStatistics.textureBindCount}`);
        if (renderStatistics.bufferUploadCount)
            this.fpsGraph.drawText(`Buffer Uploads: ${renderStatistics.bufferUploadCount}`);
    }
}

const ABOUT_ICON = `
<svg viewBox="0 0 100 100" height="16" fill="white"><path d="M50,1.1C23,1.1,1.1,23,1.1,50S23,98.9,50,98.9C77,98.9,98.9,77,98.9,50S77,1.1,50,1.1z M55.3,77.7c0,1.7-1.4,3.1-3.1,3.1  h-7.9c-1.7,0-3.1-1.4-3.1-3.1v-5.1c0-1.7,1.4-3.1,3.1-3.1h7.9c1.7,0,3.1,1.4,3.1,3.1V77.7z M67.8,47.3c-2.1,2.9-4.7,5.2-7.9,6.9  c-1.8,1.2-3,2.4-3.6,3.8c-0.4,0.9-0.7,2.1-0.9,3.5c-0.1,1.1-1.1,1.9-2.2,1.9h-9.7c-1.3,0-2.3-1.1-2.2-2.3c0.2-2.7,0.9-4.8,2-6.4  c1.4-1.9,3.9-4.2,7.5-6.7c1.9-1.2,3.3-2.6,4.4-4.3c1.1-1.7,1.6-3.7,1.6-6c0-2.3-0.6-4.2-1.9-5.6c-1.3-1.4-3-2.1-5.3-2.1  c-1.9,0-3.4,0.6-4.7,1.7c-0.8,0.7-1.3,1.6-1.6,2.8c-0.4,1.4-1.7,2.3-3.2,2.3l-9-0.2c-1.1,0-2-1-1.9-2.1c0.3-4.8,2.2-8.4,5.5-11  c3.8-2.9,8.7-4.4,14.9-4.4c6.6,0,11.8,1.7,15.6,5c3.8,3.3,5.7,7.8,5.7,13.5C70.9,41.2,69.8,44.4,67.8,47.3z"/></svg>`;

class About extends Panel {
    constructor() {
        super();
        this.setTitle(ABOUT_ICON, 'About');

        this.contents.innerHTML = `
<div id="About">
<style>
#About {
    padding: 12px;
    line-height: 1.2;
}
#About a {
    color: white;
}
#About li span {
    color: #aaa;
}
#About h2 {
    vertical-align: middle;
    font-size: 2em;
    text-align: center;
    margin: 0px;
}
#About .BuildVersion a {
    color: #666;
    font-size: smaller;
}
</style>

<p> <strong>CLICK AND DRAG</strong> to look around and use <strong>WASD</strong> to move the camera </p>
<p> Hold <strong>SHIFT</strong> to go faster, and use <strong>MOUSE WHEEL</strong> to go faster than that.
<strong>B</strong> resets the camera, and <strong>Z</strong> toggles the UI. </p>

<p><strong>CODE PRIMARILY WRITTEN</strong> by <a href="https://twitter.com/JasperRLZ">Jasper</a></p>

<p><strong>MODELS</strong> © Nintendo, SEGA, Retro Studios, FROM Software, Konami</p>

<p>
<strong>BASED ON WORK</strong> by
<a href="https://twitter.com/beholdnec">N.E.C.</a>,
<a href="https://twitter.com/PistonMiner">PistonMiner</a>,
<a href="https://twitter.com/LordNed">LordNed</a>,
<a href="https://twitter.com/SageOfMirrors">SageOfMirrors</a>,
<a href="https://github.com/blank63">blank63</a>,
<a href="https://twitter.com/StapleButter">StapleButter</a>,
<a href="https://twitter.com/xdanieldzd">xdanieldzd</a>,
<a href="https://github.com/vlad001">vlad001</a>,
<a href="https://twitter.com/Jewelots_">Jewel</a>,
<a href="https://twitter.com/instant_grat">Instant Grat</a>,
<a href="https://twitter.com/__Aruki">Aruki</a>
</p>

<p><strong>OPEN SOURCE</strong> at <a href="${GITHUB_URL}">GitHub</a></p>

<p>Feature requests and bugs welcome!</p>

<p><strong>ICONS</strong> from <a href="https://thenounproject.com/">The Noun Project</a>, used under Creative Commons CC-BY:</p>
<ul>
<li> Truncated Pyramid <span>by</span> Bohdan Burmich
<li> Images <span>by</span> Creative Stall
<li> Help <span>by</span> Gregor Cresnar
<li> Open <span>by</span> Landan Lloyd
<li> Nightshift <span>by</span> mikicon
<li> Layer <span>by</span> Chameleon Design
<li> Sand Clock <span>by</span> James
<li> Line Chart <span>by</span> Shastry
</ul>

<p class="BuildVersion"><a href="${GITHUB_REVISION_URL}">build ${GIT_SHORT_REVISION}</a></p>
</div>
`;
    }
}

export interface Layer {
    name: string;
    visible: boolean;
    setVisible(v: boolean): void;
}

const LAYER_ICON = `<svg viewBox="0 0 16 16" height="20" fill="white"><g transform="translate(0,-1036.3622)"><path d="m 8,1039.2486 -0.21875,0.125 -4.90625,2.4375 5.125,2.5625 5.125,-2.5625 L 8,1039.2486 z m -3,4.5625 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1043.8111 z m 0,3 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1046.8111 z"/></g></svg>`;

export class LayerPanel extends Panel {
    private multiSelect: MultiSelect;
    private layers: Layer[];

    constructor(layers: Layer[] = null) {
        super();
        this.setTitle(LAYER_ICON, 'Layers');
        this.multiSelect = new MultiSelect();
        this.multiSelect.onitemchanged = this._onItemChanged.bind(this);
        this.contents.appendChild(this.multiSelect.elem);
        if (layers)
            this.setLayers(layers);
    }

    private _onItemChanged(index: number, visible: boolean): void {
        this.layers[index].setVisible(visible);
    }

    public syncLayerVisibility(): void {
        const isOn = this.layers.map((layer) => layer.visible);
        this.multiSelect.setItemsSelected(isOn);
    }

    public setLayers(layers: Layer[]): void {
        this.layers = layers;
        const strings = layers.map((layer) => layer.name);
        this.multiSelect.setStrings(strings);
        this.syncLayerVisibility();
    }
}

export class UI {
    public elem: HTMLElement;

    private toplevel: HTMLElement;
    private panelContainer: HTMLElement;

    public sceneSelect: SceneSelect;
    public textureViewer: TextureViewer;
    public viewerSettings: ViewerSettings;
    public statisticsPanel: StatisticsPanel;
    private about: About;

    constructor(public viewer: Viewer.Viewer) {
        this.toplevel = document.createElement('div');
        this.toplevel.style.position = 'absolute';
        this.toplevel.style.left = '0';
        this.toplevel.style.top = '0';
        this.toplevel.style.bottom = '0';
        this.toplevel.style.padding = '2em';
        this.toplevel.style.transition = '.2s background-color';
        this.toplevel.onmouseover = () => {
            this.toplevel.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            this.toplevel.style.overflow = 'auto';
        };
        this.toplevel.onmouseout = () => {
            this.toplevel.style.backgroundColor = 'rgba(0, 0, 0, 0)';
            this.toplevel.style.overflow = 'hidden';
        };

        this.panelContainer = document.createElement('div');
        this.panelContainer.style.display = 'grid';
        this.panelContainer.style.gridTemplateColumns = '1fr';
        this.panelContainer.style.gridGap = '20px';
        this.toplevel.appendChild(this.panelContainer);

        this.sceneSelect = new SceneSelect(viewer);
        this.textureViewer = new TextureViewer();
        this.viewerSettings = new ViewerSettings(viewer);
        this.statisticsPanel = new StatisticsPanel();
        this.about = new About();

        this.setScenePanels([]);

        this.elem = this.toplevel;
    }

    public sceneChanged() {
        const cameraControllerClass = (<CameraControllerClass> this.viewer.cameraController.constructor);
        // Set up UI.
        this.viewerSettings.cameraControllerSelected(cameraControllerClass);
        if (this.viewer.scene !== null) {
            const scene = this.viewer.scene;
            if (scene.textures !== undefined)
                this.textureViewer.setTextureList(scene.textures);
            else if (scene.textureHolder !== undefined)
                this.textureViewer.setTextureHolder(scene.textureHolder);
            else
                this.textureViewer.setTextureList([]);
        } else if (this.viewer.scene_device !== null) {
            const scene_device = this.viewer.scene_device;
            if (scene_device.textureHolder !== undefined)
                this.textureViewer.setTextureHolder(scene_device.textureHolder);
            else
                this.textureViewer.setTextureList([]);
        }
    }

    private setPanels(panels: Panel[]): void {
        setChildren(this.panelContainer, panels.map((panel) => panel.elem));
    }

    public setScenePanels(panels: Panel[]): void {
        this.setPanels([this.sceneSelect, ...panels, this.textureViewer, this.viewerSettings, this.statisticsPanel, this.about]);
    }

    public setIsDragging(isDragging: boolean): void {
        this.elem.style.pointerEvents = isDragging ? 'none' : '';
    }
}
