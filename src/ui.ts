
// New UI system

import * as Viewer from './viewer';
import { assertExists, assert } from './util';
import { CameraControllerClass, OrbitCameraController, FPSCameraController, OrthoCameraController } from './Camera';
import { Color, colorToCSS } from './Color';
import { GITHUB_REVISION_URL, GITHUB_URL, GIT_SHORT_REVISION, IS_DEVELOPMENT } from './BuildVersion';
import { SaveManager, GlobalSaveManager } from "./SaveManager";
import { RenderStatistics } from './RenderStatistics';
import { GlobalGrabManager } from './GrabManager';
import { clamp, invlerp, lerp } from './MathHelpers';
import { DebugFloaterHolder } from './DebugFloaters';
import { DraggingMode } from './InputManager';
import { CLAPBOARD_ICON, StudioPanel } from './Studio';
import { SceneDesc, SceneGroup } from './SceneBase';

// @ts-ignore
import logoURL from './assets/logo.png';
import { AntialiasingMode } from './gfx/helpers/RenderGraphHelpers';

export const HIGHLIGHT_COLOR = 'rgb(210, 30, 30)';
export const COOL_BLUE_COLOR = 'rgb(20, 105, 215)';
export const PANEL_BG_COLOR = '#411';

export function createDOMFromString(s: string): DocumentFragment {
    return document.createRange().createContextualFragment(s);
}

const enum FontelloIcon {
    share = '\ue800',
    resize_full = '\ue801',
    pause = '\ue802',
    resize_small = '\ue803',
    play = '\ue804',
    fast_backward = '\ue805',
};

function setFontelloIcon(elem: HTMLElement, icon: FontelloIcon): void {
    elem.style.fontFamily = 'fontello';
    elem.textContent = icon;
}

const OPEN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 2 92 92" height="20" fill="white"><path d="M84.3765045,45.2316481 L77.2336539,75.2316205 L77.2336539,75.2316205 C77.1263996,75.6820886 76.7239081,76 76.2608477,76 L17.8061496,76 C17.2538649,76 16.8061496,75.5522847 16.8061496,75 C16.8061496,74.9118841 16.817796,74.8241548 16.8407862,74.739091 L24.7487983,45.4794461 C24.9845522,44.607157 25.7758952,44.0012839 26.6794815,44.0012642 L83.4036764,44.0000276 L83.4036764,44.0000276 C83.9559612,44.0000156 84.4036862,44.4477211 84.4036982,45.0000058 C84.4036999,45.0780163 84.3945733,45.155759 84.3765045,45.2316481 L84.3765045,45.2316481 Z M15,24 L26.8277004,24 L26.8277004,24 C27.0616369,24 27.2881698,24.0820162 27.4678848,24.2317787 L31.799078,27.8411064 L31.799078,27.8411064 C32.697653,28.5899189 33.8303175,29 35,29 L75,29 C75.5522847,29 76,29.4477153 76,30 L76,38 L76,38 C76,38.5522847 75.5522847,39 75,39 L25.3280454,39 L25.3280454,39 C23.0690391,39 21.0906235,40.5146929 20.5012284,42.6954549 L14.7844016,63.8477139 L14.7844016,63.8477139 C14.7267632,64.0609761 14.5071549,64.1871341 14.2938927,64.1294957 C14.1194254,64.0823423 13.9982484,63.9240598 13.9982563,63.7433327 L13.9999561,25 L14,25 C14.0000242,24.4477324 14.4477324,24.0000439 15,24.0000439 L15,24 Z"/></svg>`;
export const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 26.25" height="20" fill="white"><path d="M8.6953,14.3916 C5.5543,14.3916 3.0003,11.8356 3.0003,8.6956 C3.0003,5.5546 5.5543,2.9996 8.6953,2.9996 C11.8363,2.9996 14.3913,5.5546 14.3913,8.6956 C14.3913,11.8356 11.8363,14.3916 8.6953,14.3916 L8.6953,14.3916 Z M15.8423,13.7216 L15.6073,13.9566 C16.7213,12.4956 17.3913,10.6756 17.3913,8.6956 C17.3913,3.8936 13.4983,-0.0004 8.6953,-0.0004 C3.8933,-0.0004 0.0003,3.8936 0.0003,8.6956 C0.0003,13.4976 3.8933,17.3916 8.6953,17.3916 C10.6753,17.3916 12.4953,16.7216 13.9573,15.6076 L13.7213,15.8426 L18.3343,20.4546 L20.4553,18.3336 L15.8423,13.7216 Z"/></svg>`;
const TEXTURES_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" height="20" fill="white"><path d="M143.5,143.5v300h300v-300H143.5z M274.8,237.2c10.3,0,18.7,8.4,18.7,18.9c0,10.3-8.4,18.7-18.7,18.7   c-10.3,0-18.7-8.4-18.7-18.7C256,245.6,264.4,237.2,274.8,237.2z M406,406H181v-56.2l56.2-56.1l37.5,37.3l75-74.8l56.2,56.1V406z"/><polygon points="387.2,68.6 68.5,68.6 68.5,368.5 106,368.5 106,106 387.2,106"/></svg>`;
const FRUSTUM_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><polygon points="48.2573,19.8589 33.8981,15.0724 5,67.8384 48.2573,90.3684" /><polygon points="51.5652,19.8738 51.5652,90.3734 95,67.8392 65.9366,15.2701" /><polygon points="61.3189,13.2756 49.9911,9.6265 38.5411,13.1331 49.9213,16.9268" /></svg>`;
const STATISTICS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 0 55 60" height="16" fill="white"><g><polygon points="6.9,11.5 6.9,56 55.4,56 55.4,53 9.9,53 9.9,11.5"/><path d="M52.7,15.8c-2.7,0-4.9,2.2-4.9,4.9c0,1,0.3,1.8,0.8,2.6l-5,6.8c-0.4-0.1-0.9-0.2-1.3-0.2c-1.5,0-2.9,0.7-3.8,1.8l-5.6-2.8   c0-0.2,0.1-0.5,0.1-0.8c0-2.7-2.2-4.9-4.9-4.9s-4.9,2.2-4.9,4.9c0,1.1,0.3,2,0.9,2.8l-3.9,5.1c-0.5-0.2-1.1-0.3-1.7-0.3   c-2.7,0-4.9,2.2-4.9,4.9s2.2,4.9,4.9,4.9s4.9-2.2,4.9-4.9c0-1-0.3-2-0.8-2.7l4-5.2c0.5,0.2,1.1,0.3,1.6,0.3c1.4,0,2.6-0.6,3.5-1.5   l5.8,2.9c0,0.1,0,0.2,0,0.3c0,2.7,2.2,4.9,4.9,4.9c2.7,0,4.9-2.2,4.9-4.9c0-1.2-0.4-2.2-1.1-3.1l4.8-6.5c0.6,0.2,1.2,0.4,1.9,0.4   c2.7,0,4.9-2.2,4.9-4.9S55.4,15.8,52.7,15.8z"/></g></svg>`;
const ABOUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16" fill="white"><path d="M50,1.1C23,1.1,1.1,23,1.1,50S23,98.9,50,98.9C77,98.9,98.9,77,98.9,50S77,1.1,50,1.1z M55.3,77.7c0,1.7-1.4,3.1-3.1,3.1  h-7.9c-1.7,0-3.1-1.4-3.1-3.1v-5.1c0-1.7,1.4-3.1,3.1-3.1h7.9c1.7,0,3.1,1.4,3.1,3.1V77.7z M67.8,47.3c-2.1,2.9-4.7,5.2-7.9,6.9  c-1.8,1.2-3,2.4-3.6,3.8c-0.4,0.9-0.7,2.1-0.9,3.5c-0.1,1.1-1.1,1.9-2.2,1.9h-9.7c-1.3,0-2.3-1.1-2.2-2.3c0.2-2.7,0.9-4.8,2-6.4  c1.4-1.9,3.9-4.2,7.5-6.7c1.9-1.2,3.3-2.6,4.4-4.3c1.1-1.7,1.6-3.7,1.6-6c0-2.3-0.6-4.2-1.9-5.6c-1.3-1.4-3-2.1-5.3-2.1  c-1.9,0-3.4,0.6-4.7,1.7c-0.8,0.7-1.3,1.6-1.6,2.8c-0.4,1.4-1.7,2.3-3.2,2.3l-9-0.2c-1.1,0-2-1-1.9-2.1c0.3-4.8,2.2-8.4,5.5-11  c3.8-2.9,8.7-4.4,14.9-4.4c6.6,0,11.8,1.7,15.6,5c3.8,3.3,5.7,7.8,5.7,13.5C70.9,41.2,69.8,44.4,67.8,47.3z"/></svg>`;
const DICE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="18" height="18" fill="white"><path d="M 12.161286,0.33596185 C 9.1715371,-0.03245869 6.4678746,2.0779729 6.099454,5.0677219 L 0.33596183,51.838714 c -0.36842076,2.989751 1.74201117,5.693411 4.73176007,6.061832 l 46.7709931,5.763492 c 2.98975,0.368421 5.69341,-1.742009 6.061831,-4.73176 L 63.664038,12.161286 C 64.032459,9.171537 61.922029,6.4678748 58.932279,6.0994541 Z M 20.047281,10.438667 a 5.4374807,5.4374806 7.0250241 0 1 4.731761,6.061832 5.4374807,5.4374806 7.0250241 0 1 -6.061833,4.73176 5.4374807,5.4374806 7.0250241 0 1 -4.73176,-6.061832 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.73176 z m 28.782293,3.546782 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061775 5.4374807,5.4374806 7.0250241 0 1 -6.061367,4.731817 5.4374807,5.4374806 7.0250241 0 1 -4.731761,-6.061832 5.4374807,5.4374806 7.0250241 0 1 6.061833,-4.73176 z M 32.665036,26.603204 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061775 5.4374807,5.4374806 7.0250241 0 1 -6.06131,4.731351 5.4374807,5.4374806 7.0250241 0 1 -4.731817,-6.061366 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.73176 z M 16.500499,39.220959 a 5.4374807,5.4374806 7.0250241 0 1 4.731761,6.061833 5.4374807,5.4374806 7.0250241 0 1 -6.061776,4.731295 5.4374807,5.4374806 7.0250241 0 1 -4.731817,-6.061367 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.731761 z m 28.782293,3.546782 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061776 5.4374807,5.4374806 7.0250241 0 1 -6.06131,4.731353 5.4374807,5.4374806 7.0250241 0 1 -4.731818,-6.061368 5.4374807,5.4374806 7.0250241 0 1 6.061833,-4.731761 z"/></svg>`;

// Custom icons used by game-specific panels.
export const LAYER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" height="20" fill="white"><g transform="translate(0,-1036.3622)"><path d="m 8,1039.2486 -0.21875,0.125 -4.90625,2.4375 5.125,2.5625 5.125,-2.5625 L 8,1039.2486 z m -3,4.5625 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1043.8111 z m 0,3 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1046.8111 z"/></g></svg>`;
export const TIME_OF_DAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;
export const RENDER_HACKS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 105" height="20" fill="white"><path d="M95,5v60H65c0-16.6-13.4-30-30-30V5H95z"/><path d="M65,65c0,16.6-13.4,30-30,30C18.4,95,5,81.6,5,65c0-16.6,13.4-30,30-30v30H65z"/></svg>`;
export const SAND_CLOCK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><g><path d="M79.3,83.3h-6.2H24.9h-6.2c-1.7,0-3,1.3-3,3s1.3,3,3,3h60.6c1.7,0,3-1.3,3-3S81,83.3,79.3,83.3z"/><path d="M18.7,14.7h6.2h48.2h6.2c1.7,0,3-1.3,3-3s-1.3-3-3-3H18.7c-1.7,0-3,1.3-3,3S17,14.7,18.7,14.7z"/><path d="M73.1,66c0-0.9-0.4-1.8-1.1-2.4L52.8,48.5L72,33.4c0.7-0.6,1.1-1.4,1.1-2.4V20.7H24.9V31c0,0.9,0.4,1.8,1.1,2.4l19.1,15.1   L26,63.6c-0.7,0.6-1.1,1.4-1.1,2.4v11.3h48.2V66z"/></g></svg>';
export const VR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" height="20" fill="white"><g><path d="M29,8H3A1,1,0,0,0,2,9V23a1,1,0,0,0,1,1H13a1,1,0,0,0,1-.83l.66-4A1.36,1.36,0,0,1,16,18a1.38,1.38,0,0,1,1.36,1.26L18,23.17A1,1,0,0,0,19,24H29a1,1,0,0,0,1-1V9A1,1,0,0,0,29,8ZM8.5,19A3.5,3.5,0,1,1,12,15.5,3.5,3.5,0,0,1,8.5,19Zm15,0A3.5,3.5,0,1,1,27,15.5,3.5,3.5,0,0,1,23.5,19Z"/></g></svg>`;

export function setChildren(parent: Element, children: Element[]): void {
    // We want to swap children around without removing them, since removing them will cause
    // a relayout and possibly break scroll positions.

    // Go through and add any new children.
    for (let i = 0; i < children.length; i++)
        if (children[i].parentNode !== parent)
            parent.appendChild(children[i]);

    // Remove any children that we don't want.
    for (let i = 0; i < parent.childElementCount;) {
        const child = parent.children.item(i)!;
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

function setElementVisible(elem: HTMLElement, v: boolean, normalDisplay = 'block') {
    elem.style.display = v ? normalDisplay : 'none';
}

export function setElementHighlighted(elem: HTMLElement, highlighted: boolean, normalTextColor: string = '') {
    if (highlighted) {
        elem.style.backgroundColor = HIGHLIGHT_COLOR;
        elem.style.color = 'black';
    } else {
        elem.style.backgroundColor = PANEL_BG_COLOR;
        elem.style.color = normalTextColor;
    }
}

export interface Flair {
    index: number;
    background?: string;
    color?: string;
    bulletColor?: string;
    extraHTML?: string;
    fontWeight?: string;
}

export interface Widget {
    elem: HTMLElement;
}

function svgStringToCSSBackgroundImage(svgString: string) {
    return `url(data:image/svg+xml,${encodeURI(svgString)})`;
}

export class TextField implements Widget {
    public textarea: HTMLInputElement;
    public elem: HTMLElement;

    constructor() {
        this.textarea = document.createElement('input');
        this.textarea.style.color = 'white';
        this.textarea.style.backgroundColor = 'transparent';
        this.textarea.style.font = '16px monospace';
        this.textarea.style.border = 'none';
        this.textarea.style.width = '100%';
        this.textarea.style.caretColor = 'white';

        this.elem = this.textarea;
    }

    public selectAll() {
        this.textarea.setSelectionRange(0, this.textarea.value.length);
        this.textarea.scrollLeft = 0;
    }

    public getValue() {
        return this.textarea.value;
    }

    public setValue(v: string) {
        this.textarea.value = v;
    }

    public setPlaceholder(placeholder: string): void {
        this.textarea.placeholder = placeholder;
    }
}

export class TextEntry implements Widget {
    public elem: HTMLElement;
    public ontext: ((string: string) => void) | null = null;
    public onfocus: (() => void) | null = null;

    protected toplevel: HTMLElement;
    public textfield: TextField;
    protected clearButton: HTMLElement;
    protected svgIcon: SVGSVGElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.position = 'relative';

        this.textfield = new TextField();
        const textarea = this.textfield.textarea;
        textarea.title = 'Search Bar';
        textarea.style.boxSizing = 'border-box';
        textarea.style.padding = '12px';
        textarea.style.paddingLeft = '32px';
        textarea.style.backgroundRepeat = 'no-repeat';
        textarea.style.backgroundPosition = '10px 14px';
        textarea.style.lineHeight = '20px';
        textarea.onkeydown = (e) => {
            if (e.code === 'Escape' && this.textfield.getValue().length > 0) {
                e.stopPropagation();
                this.clear();
            }
        };
        textarea.oninput = () => {
            this.textChanged();
        };
        textarea.onfocus = () => {
            if (this.onfocus !== null)
                this.onfocus();
        };
        this.toplevel.appendChild(this.textfield.elem);

        this.clearButton = document.createElement('div');
        this.clearButton.textContent = '🗙';
        this.clearButton.title = 'Clear';
        this.clearButton.style.color = 'white';
        this.clearButton.style.position = 'absolute';
        this.clearButton.style.width = '24px';
        this.clearButton.style.height = '24px';
        this.clearButton.style.right = '4px';
        this.clearButton.style.top = '12px';
        this.clearButton.style.bottom = '12px';
        this.clearButton.style.lineHeight = '20px';
        this.clearButton.style.cursor = 'pointer';
        this.clearButton.onclick = () => {
            this.clear();
        };
        this.syncClearButtonVisible();
        this.toplevel.appendChild(this.clearButton);

        this.elem = this.toplevel;
    }

    private syncClearButtonVisible(): void {
        this.clearButton.style.display = this.textfield.getValue().length > 0 ? '' : 'none';
    }

    public textChanged(): void {
        if (this.ontext !== null)
            this.ontext(this.textfield.getValue());
        this.syncClearButtonVisible();
    }

    public clear(): void {
        this.textfield.setValue('');
        this.textChanged();
    }

    public setIcon(icon: string): void {
        this.textfield.textarea.style.backgroundImage = svgStringToCSSBackgroundImage(icon);
    }

    public setPlaceholder(placeholder: string): void {
        this.textfield.setPlaceholder(placeholder);
    }
}

export const enum ScrollSelectItemType {
    Selectable, Header,
}

interface ScrollSelectItemHeader {
    type: ScrollSelectItemType.Header;
    visible?: boolean;
    name?: string;
    html?: HTMLElement;
}

interface ScrollSelectItemSelectable {
    type: ScrollSelectItemType.Selectable;
    visible?: boolean;
    name?: string;
    html?: HTMLElement;
}

export type ScrollSelectItem = ScrollSelectItemHeader | ScrollSelectItemSelectable;

export abstract class ScrollSelect implements Widget {
    public elem: HTMLElement;

    protected toplevel: HTMLElement;
    protected scrollContainer: HTMLElement;
    protected flairs: Flair[] = [];
    protected internalFlairs: Flair[] = [];
    private isDragging: boolean = false;

    constructor() {
        this.toplevel = document.createElement('div');

        this.scrollContainer = document.createElement('div');
        this.setHeight(`200px`);
        this.setTextSelectable(false);
        this.scrollContainer.style.overflow = 'auto';
        this.toplevel.appendChild(this.scrollContainer);

        this.elem = this.toplevel;
    }

    public setTextSelectable(v: boolean): void {
        this.scrollContainer.style.userSelect = v ? '' : 'none'
    }

    public setHeight(height: string): void {
        this.scrollContainer.style.height = height;
    }

    protected getOuterForIndex(i: number): HTMLElement {
        return this.scrollContainer.children.item(i) as HTMLElement;
    }

    public focusItem(i: number): boolean {
        const outer = this.getOuterForIndex(i);
        if (!this.itemIsVisible(outer))
            return false;
        const selector = outer.querySelector('.selector') as HTMLElement;
        if (selector) {
            outer.focus();
            return true;
        } else {
            return false;
        }
    }

    public scrollItemIntoView(i: number): boolean {
        const outer = this.getOuterForIndex(i);
        if (!this.itemIsVisible(outer))
            return false;
        const selector = outer.querySelector('.selector') as HTMLElement;
        if (selector) {
            outer.scrollIntoView();
            return true;
        } else {
            return false;
        }
    }

    public setItems(items: ScrollSelectItem[]): void {
        this.scrollContainer.style.display = (items.length > 0) ? '' : 'none';
        this.scrollContainer.innerHTML = '';
        let hasHeader = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            const outer = document.createElement('div');
            outer.tabIndex = -1;
            outer.style.display = 'grid';
            outer.style.gridAutoFlow = 'column';
            outer.style.outline = 'none';

            if (item.type === ScrollSelectItemType.Selectable) {
                outer.style.cursor = 'pointer';
                outer.style.paddingLeft = hasHeader ? '24px' : '';

                const selector = document.createElement('div');
                selector.classList.add('selector');
                selector.style.display = 'list-item';
                selector.style.lineHeight = '24px';
                selector.style.textShadow = `0 0 8px black`;
                outer.appendChild(selector);
                const textSpan = document.createElement('span');
                textSpan.classList.add('text');
                if (item.html !== undefined)
                    textSpan.appendChild(item.html);
                else if (item.name !== undefined)
                    textSpan.textContent = item.name;
                else
                    throw "whoops";
                selector.appendChild(textSpan);

                const index = i;
                outer.onfocus = () => {
                    this.itemFocused(index, !this.isDragging);
                };
                outer.onmousedown = () => {
                    if (document.activeElement === outer)
                        outer.onfocus!(null as unknown as FocusEvent);
                    else
                        outer.focus();
                    this.isDragging = true;
                };
                outer.onmouseup = () => {
                    this.isDragging = false;
                };
                outer.onmouseover = (e) => {
                    if (this.isDragging)
                        outer.focus();
                };
            } else if (item.type === ScrollSelectItemType.Header) {
                const textSpan = document.createElement('span');
                textSpan.classList.add('header');
                textSpan.style.fontWeight = 'bold';
                textSpan.style.lineHeight = `36px`;
                textSpan.style.textShadow = `0 0 8px black`;
                textSpan.style.paddingLeft = `8px`;
                textSpan.style.verticalAlign = `baseline`;
                if (item.html !== undefined)
                    textSpan.appendChild(item.html);
                else if (item.name !== undefined)
                    textSpan.textContent = item.name;
                else
                    throw "whoops";
                outer.appendChild(textSpan);
                hasHeader = true;
            }

            const extraSlot = document.createElement('span');
            extraSlot.classList.add('extra');
            extraSlot.style.justifySelf = 'end';
            outer.appendChild(extraSlot);

            if (item.visible !== undefined)
                this._setItemVisible(outer, item.visible);

            this.scrollContainer.appendChild(outer);
        }

        this.computeHeaderVisibility();
    }

    public setStrings(strings: string[]): void {
        this.setItems(strings.map((string): ScrollSelectItem => {
            return { type: ScrollSelectItemType.Selectable, name: string };
        }));
    }

    protected itemIsHeader(outer: HTMLElement): boolean {
        const header = outer.querySelector('span.header');
        return !!header;
    }

    protected itemIsVisible(outer: HTMLElement): boolean {
        return outer.style.display !== 'none';
    }

    public computeHeaderVisibility(): void {
        const n = this.getNumItems();
        for (let i = 0; i < n;) {
            const outer = this.getOuterForIndex(i);

            if (this.itemIsHeader(outer)) {
                // Find next header.
                let j = i + 1;
                let shouldBeVisible = false;
                for (; j < n; j++) {
                    const outer = this.getOuterForIndex(j);
                    if (this.itemIsHeader(outer))
                        break;
                    if (this.itemIsVisible(outer)) {
                        shouldBeVisible = true;
                        break;
                    }
                }
                this._setItemVisible(outer, shouldBeVisible);
                i = j;
            } else
                i++;
        }
    }

    private _setItemVisible(outer: HTMLElement, v: boolean) {
        outer.style.display = v ? 'grid' : 'none';
    }

    public setItemVisible(i: number, v: boolean): void {
        const outer = this.scrollContainer.children.item(i) as HTMLElement;
        this._setItemVisible(outer, v);
    }

    public getNumItems() {
        return this.scrollContainer.childElementCount;
    }

    public setFlairs(flairs: Flair[]) {
        this.flairs = flairs;
        this.syncInternalFlairs();
    }

    protected abstract syncInternalFlairs(): void;

    protected setInternalFlairs(flairs: Flair[]) {
        this.internalFlairs = flairs;
        this.syncFlairDisplay();
    }

    private syncFlairDisplay(): void {
        const flairs = this.internalFlairs;
        for (let i = 0; i < this.getNumItems(); i++) {
            const outer = this.getOuterForIndex(i);

            const selector = outer.firstElementChild as HTMLElement;
            if (!selector.classList.contains('selector'))
                continue;

            const flair = flairs.find((flair) => flair.index === i);

            const background = (flair !== undefined && flair.background !== undefined) ? flair.background : '';
            outer.style.background = background;
            const textSpan = assertExists(outer.querySelector('span.text') as HTMLElement);
            const color = (flair !== undefined && flair.color !== undefined) ? flair.color : '';
            textSpan.style.color = color;
            const fontWeight = (flair !== undefined && flair.fontWeight !== undefined) ? flair.fontWeight : '';
            textSpan.style.fontWeight = fontWeight;

            if (flair !== undefined && flair.bulletColor !== undefined) {
                selector.style.listStyleType = 'disc';
                selector.style.listStylePosition = 'inside';
                selector.style.paddingLeft = `4px`;
                selector.style.color = flair.bulletColor;
            } else {
                selector.style.listStyleType = 'none';
                selector.style.color = '';
            }

            const extraHTML = (flair !== undefined && flair.extraHTML) ? flair.extraHTML : '';
            const extraSpan = assertExists(outer.querySelector('span.extra') as HTMLElement);
            extraSpan.innerHTML = extraHTML;
        }
    }

    protected abstract itemFocused(index: number, first: boolean): void;
}

export function ensureFlairIndex(flairs: Flair[], index: number): Flair {
    const flairIndex = flairs.findIndex((f) => f.index === index);
    if (flairIndex >= 0) {
        flairs[flairIndex] = Object.assign({}, flairs[flairIndex]);
        return flairs[flairIndex];
    } else {
        const flair = { index };
        flairs.push(flair);
        return flair;
    }
}

export class SingleSelect extends ScrollSelect {
    public highlightedIndex: number = -1;
    public onselectionchange: (index: number) => void;
    public setHighlightFlair = true;

    constructor() {
        super();

        this.toplevel.onkeydown = (e: KeyboardEvent) => {
            let handled = false;
            if (e.code === 'ArrowUp')
                handled = this.navigate(-1);
            else if (e.code === 'ArrowDown')
                handled = this.navigate(1);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        };
    }

    private navigate(direction: number): boolean {
        const n = this.getNumItems();
        let newIndex = this.highlightedIndex;
        // If it's not visible, reset us to the beginning/end.
        if (newIndex < 0 || newIndex >= n || !this.itemIsVisible(this.getOuterForIndex(newIndex))) {
            if (direction > 0)
                newIndex = 0;
            else if (direction < 0)
                newIndex = n - 1;
        } else {
            newIndex += direction;
        }
        while (true) {
            if (newIndex < 0 || newIndex >= n)
                break;
            if (this.focusItem(newIndex))
                break;
            newIndex += direction;
        }
        return true;
    }

    public scrollFocus(): void {
        if (this.highlightedIndex !== -1)
            this.scrollItemIntoView(this.highlightedIndex);
    }

    public override setItems(items: ScrollSelectItem[]): void {
        this.highlightedIndex = -1;
        super.setItems(items);
    }

    public itemFocused(index: number, first: boolean) {
        this.selectItem(index);
    }

    public selectItem(index: number) {
        this.setHighlighted(index);
        this.onselectionchange(index);
    }

    public setHighlighted(highlightedIndex: number) {
        if (this.highlightedIndex === highlightedIndex)
            return;
        this.highlightedIndex = highlightedIndex;
        this.syncInternalFlairs();
    }

    protected syncInternalFlairs(): void {
        const flairs = [...this.flairs];
        if (this.setHighlightFlair && this.highlightedIndex >= 0) {
            const flair = ensureFlairIndex(flairs, this.highlightedIndex);
            flair.background = HIGHLIGHT_COLOR;
            flair.fontWeight = 'bold';
        }
        this.setInternalFlairs(flairs);
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
    user-select: none;
}
</style>
<div class="AllButton">All</div><div class="NoneButton">None</div>
</div>
`);
        this.toplevel.insertBefore(allNone, this.toplevel.firstChild);

        const allButton = this.toplevel.querySelector('.AllButton') as HTMLElement;
        allButton.onclick = () => {
            for (let i = 0; i < this.getNumItems(); i++)
                this.setItemIsOn(i, true);
            this.syncInternalFlairs();
        };
        const noneButton = this.toplevel.querySelector('.NoneButton') as HTMLElement;
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

    public itemFocused(index: number, first: boolean) {
        if (first)
            this.itemShouldBeOn = !this.itemIsOn[index];
        this.setItemIsOn(index, this.itemShouldBeOn);
        this.syncInternalFlairs();
    }

    protected syncInternalFlairs() {
        const flairs: Flair[] = [...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            const flair = ensureFlairIndex(flairs, i);
            flair.bulletColor = !!this.itemIsOn[i] ? HIGHLIGHT_COLOR : '#aaa';
            flair.color = !!this.itemIsOn[i] ? 'white' : '#aaa';
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

export class Checkbox implements Widget {
    public elem: HTMLElement;
    public checked: boolean = false;
    public onchanged: (() => void) | null = null;

    private toplevel: HTMLElement;
    private label: HTMLElement;
    private emblem: HTMLElement;

    constructor(label: string = '', initiallyChecked: boolean = false) {
        this.toplevel = document.createElement('div');
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridTemplateColumns = '1fr 24px';
        this.toplevel.style.alignItems = 'center';
        this.toplevel.style.cursor = 'pointer';
        this.toplevel.onclick = this._toggle.bind(this);

        this.label = document.createElement('div');
        this.label.style.userSelect = 'none';
        this.toplevel.appendChild(this.label);

        this.emblem = document.createElement('div');
        this.emblem.style.width = '10px';
        this.emblem.style.height = '10px';
        this.emblem.style.justifySelf = 'center';
        this.emblem.style.margin = '4px';
        this.emblem.style.borderRadius = '4px';
        this.emblem.style.border = '2px solid white';
        this.toplevel.appendChild(this.emblem);

        this.setLabel(label);
        this.setChecked(initiallyChecked);

        this.elem = this.toplevel;
    }

    public setChecked(v: boolean): void {
        this.checked = v;

        if (this.checked) {
            this.emblem.style.backgroundColor = HIGHLIGHT_COLOR;
            this.emblem.style.borderColor = 'white';
            this.label.style.fontWeight = 'bold';
            this.label.style.color = 'white';
        } else {
            this.emblem.style.backgroundColor = 'transparent';
            this.emblem.style.borderColor = '#aaa';
            this.label.style.fontWeight = '';
            this.label.style.color = '#aaa';
        }
    }

    private _toggle(): void {
        this.setChecked(!this.checked);
        if (this.onchanged !== null)
            this.onchanged();
    }

    public setLabel(text: string): void {
        this.label.textContent = text;
    }
}

export class Panel implements Widget {
    public elem: HTMLElement;

    public expanded: boolean | null = null;
    public manuallyExpanded: boolean = false;
    public autoClosed: boolean = false;
    public customHeaderBackgroundColor: string = '';
    protected header: HTMLElement;
    protected headerContainer: HTMLElement;
    protected svgIcon: SVGSVGElement;

    private toplevel: HTMLElement;
    private ignoreAutoCloseTimeout: number = 0;
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
        this.toplevel.style.gap = '20px';
        this.toplevel.style.transition = '.25s ease-out';
        this.toplevel.style.alignItems = 'start';
        this.toplevel.style.outline = 'none';
        this.toplevel.onkeydown = this.onKeyDown.bind(this);
        this.toplevel.onmouseover = this.syncSize.bind(this);
        this.toplevel.onmouseout = this.syncSize.bind(this);
        this.toplevel.tabIndex = -1;

        this.mainPanel = document.createElement('div');
        this.mainPanel.style.overflow = 'hidden';
        this.mainPanel.style.transition = '.25s ease-out';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.appendChild(this.mainPanel);

        this.extraRack = document.createElement('div');
        this.extraRack.style.gridAutoFlow = 'column';
        this.extraRack.style.gap = '20px';
        this.extraRack.style.transition = '.15s ease-out .10s';
        this.toplevel.appendChild(this.extraRack);

        this.headerContainer = document.createElement('div');
        this.mainPanel.appendChild(this.headerContainer);

        this.header = document.createElement('h1');
        this.header.style.lineHeight = '28px';
        this.header.style.width = '440px';
        this.header.style.margin = '0';
        this.header.style.fontSize = '100%';
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.header.onclick = () => {
            if (this.ignoreAutoCloseTimeout > 0) {
                this.ignoreAutoCloseTimeout = 0;
                return;
            }

            this.toggleExpanded();
        };
        this.headerContainer.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.width = '440px';
        this.mainPanel.appendChild(this.contents);

        this.elem = this.toplevel;
    }

    protected onKeyDown(e: KeyboardEvent): void {
        if (e.code === 'Escape' && this.expanded) {
            e.preventDefault();
            e.stopPropagation();
            this.setExpanded(false);
        }
    }

    private syncSize() {
        const widthExpanded = this.expanded || this.mainPanel.matches(':hover');
        this.mainPanel.style.width = widthExpanded ? '440px' : '28px';

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
        this.svgIcon = createDOMFromString(icon).querySelector('svg')!;
        this.svgIcon.style.gridColumn = '1';
        this.header.textContent = title;
        this.header.appendChild(this.svgIcon);
        this.toplevel.dataset.title = title;

        this.setExpanded(false);
    }

    protected syncHeaderStyle() {
        if (this.customHeaderBackgroundColor) {
            this.svgIcon.style.fill = '';
            this.header.style.backgroundColor = this.customHeaderBackgroundColor;
            this.header.style.color = 'white';
        } else {
            this.svgIcon.style.fill = this.expanded ? 'black' : '';
            setElementHighlighted(this.header, !!this.expanded, HIGHLIGHT_COLOR);
        }
    }

    public syncExpanded(): boolean {
        const newExpanded = this.manuallyExpanded && !this.autoClosed;
        if (this.expanded === newExpanded)
            return false;
        this.expanded = newExpanded;
        this.syncHeaderStyle();
        this.syncSize();
        if (!this.expanded)
            document.body.focus();
        return true;
    }

    public setExpanded(v: boolean, focus: boolean = true) {
        this.manuallyExpanded = v;
        this.syncExpanded();
        if (this.expanded && focus)
            this.elem.focus();
    }

    private toggleExpanded() {
        this.setExpanded(!this.expanded);
    }

    public setAutoClosed(v: boolean) {
        if (this.autoClosed === v)
            return;
        this.autoClosed = v;
        const changed = this.syncExpanded();
        if (changed && this.expanded) {
            // If we're coming back from auto-closing, then start a timeout to ignore clicks during this time.
            this.ignoreAutoCloseTimeout = window.setTimeout(() => {
                this.ignoreAutoCloseTimeout = 0;
            }, 250);
        }
    }
}

// https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
function escapeRegExp(S: string): string {
    return S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchRegExps(S: string): RegExp[] {
    return S.split(/\s+/).filter((n) => n.length).map((str) => new RegExp(`(\\b${escapeRegExp(str)})`, 'i'));
}

function matchRegExps(n: RegExp[], S: string): boolean {
    // Empty list matches everything.
    if (n.length === 0)
        return true;
    return n.every((re) => {
        return re.test(S);
    })
}

function randomChoice<T>(L: T[]): T {
    const idx = Math.floor(Math.random() * L.length);
    return assertExists(L[idx]);
}

class SceneSelect extends Panel {
    private sceneGroups: (string | SceneGroup)[] = [];
    private sceneDescs: (string | SceneDesc)[] = [];

    private searchEntry: TextEntry;
    private randomButton: HTMLElement;
    private sceneGroupList: SingleSelect;
    private sceneDescList: SingleSelect;

    private selectedSceneGroup: SceneGroup;
    private currentSceneGroup: SceneGroup;
    private currentSceneDesc: SceneDesc;
    private loadProgress: number;
    private forceVisible: boolean = IS_DEVELOPMENT;

    private currentSearchTokens: RegExp[] = [];

    public onscenedescselected: (sceneGroup: SceneGroup, sceneDesc: SceneDesc) => void;

    constructor(public viewer: Viewer.Viewer) {
        super();
        this.setTitle(OPEN_ICON, 'Games');

        const topBox = document.createElement('div');
        topBox.style.display = 'grid';
        topBox.style.gridTemplateColumns = '1fr 40px';
        topBox.style.background = 'rgba(0, 0, 0, 1.0)';
        this.contents.append(topBox);

        this.searchEntry = new TextEntry();
        this.searchEntry.setIcon(SEARCH_ICON);
        this.searchEntry.setPlaceholder('Search...');
        this.searchEntry.ontext = (searchString: string) => {
            this._setSearchString(searchString);
        };
        this.searchEntry.onfocus = () => {
            // If the search entry manages to get itself focused (which can happen if the user hits Tab),
            // then expand the panel.
            this.setExpanded(true, false);
            this.setAutoClosed(false);
        };
        topBox.appendChild(this.searchEntry.elem);

        this.randomButton = document.createElement('div');
        this.randomButton.title = 'Random';
        this.randomButton.style.placeSelf = 'stretch';
        this.randomButton.style.color = 'white';
        this.randomButton.style.lineHeight = '20px';
        this.randomButton.style.cursor = 'pointer';
        this.randomButton.style.backgroundRepeat = 'no-repeat';
        this.randomButton.style.backgroundPosition = 'center center';
        this.randomButton.style.backgroundImage = svgStringToCSSBackgroundImage(DICE_ICON);
        this.randomButton.onclick = () => {
            this.selectRandom();
        };
        this.syncRandomButtonVisible();
        topBox.appendChild(this.randomButton);

        this.sceneGroupList = new SingleSelect();
        this.sceneGroupList.setHeight('400px');
        this.contents.appendChild(this.sceneGroupList.elem);

        this.sceneDescList = new SingleSelect();
        this.sceneDescList.setHighlightFlair = false;
        this.sceneDescList.elem.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.sceneDescList.elem.style.width = '500px';
        this.sceneDescList.setHeight('472px');
        this.extraRack.appendChild(this.sceneDescList.elem);

        this.sceneGroupList.onselectionchange = (i: number) => {
            this.selectSceneGroupIndex(i);
        };

        this.sceneDescList.onselectionchange = (i: number) => {
            this.selectSceneDescIndex(i);
        };
    }

    protected override onKeyDown(e: KeyboardEvent): void {
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            this.sceneGroupList.elem.onkeydown!(e);
        } else {
            const textarea = this.searchEntry.textfield.textarea;
            textarea.focus();
            textarea.onkeydown!(e);
        }

        if (e.defaultPrevented)
            return;
        super.onKeyDown(e);
    }

    public expandAndFocus(): void {
        this.setExpanded(true);
        this.setAutoClosed(false);
        this.elem.focus();
    }

    private _setSearchString(str: string): void {
        this.currentSearchTokens = searchRegExps(str);
        this.syncVisibility();
    }

    private syncRandomButtonVisible(): void {
    }

    public setForceVisible(v: boolean) {
        this.forceVisible = v;
        this.syncVisibility();
    }

    private syncVisibility(): void {
        // Start searching!
        const n = this.currentSearchTokens;

        let lastDescHeaderVisible = false;
        function matchSceneDesc(item: (string | SceneDesc)): boolean {
            if (typeof item === 'string') {
                // If this is a header, then all items under the header should match.
                lastDescHeaderVisible = matchRegExps(n, item);
                return false;
            } else {
                // If header matches, then so do we.
                if (lastDescHeaderVisible)
                    return true;
                return matchRegExps(n, item.name);
            }
        }

        let lastGroupHeaderVisible = false;
        let selectedGroupExplicitlyVisible = false;
        for (let i = 0; i < this.sceneGroups.length; i++) {
            const item = this.sceneGroups[i];
            if (typeof item === 'string') {
                // If this is a header, then all items under the header should match.
                lastGroupHeaderVisible = matchRegExps(n, item);
            } else {
                let visible = false;
                let explicitlyInvisible = false;

                const isHidden = (!!item.hidden) && !this.forceVisible;
                explicitlyInvisible = item.sceneDescs.length <= 0 || isHidden;

                if (!explicitlyInvisible) {
                    // If header matches, then we are explicitly visible.
                    if (!visible == lastGroupHeaderVisible)
                        visible = true;

                    // If name matches, then we are explicitly visible.
                    if (!visible && (matchRegExps(n, item.name) || (item.altName && matchRegExps(n, item.altName))))
                        visible = true;

                    if (item === this.selectedSceneGroup)
                        selectedGroupExplicitlyVisible = visible;

                    // Now check for any children.
                    if (!visible) {
                        lastDescHeaderVisible = false;
                        visible = item.sceneDescs.some((g) => matchSceneDesc(g));
                    }
                }

                this.sceneGroupList.setItemVisible(i, visible);
            }
        }

        lastDescHeaderVisible = false;
        for (let i = 0; i < this.sceneDescs.length; i++) {
            let visible;
            if (!visible && selectedGroupExplicitlyVisible)
                visible = true;
            if (!visible)
                visible = matchSceneDesc(this.sceneDescs[i]);
            this.sceneDescList.setItemVisible(i, visible);
        }

        this.sceneGroupList.computeHeaderVisibility();
        this.sceneDescList.computeHeaderVisibility();
    }

    public setCurrentDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc) {
        this.selectedSceneGroup = sceneGroup;
        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;
        this.syncSceneDescs();

        this.sceneGroupList.setHighlighted(this.sceneGroups.indexOf(this.currentSceneGroup));
        this.sceneDescList.setHighlighted(this.sceneDescs.indexOf(this.currentSceneDesc));
    }

    public setSceneGroups(sceneGroups: (string | SceneGroup)[]) {
        this.sceneGroups = sceneGroups;
        this.sceneGroupList.setItems(sceneGroups.map((g): ScrollSelectItem => {
            if (typeof g === 'string')
                return { type: ScrollSelectItemType.Header, name: g };
            else
                return { type: ScrollSelectItemType.Selectable, name: g.name };
        }));
        this.syncSceneDescs();
    }

    public setProgress(pct: number): void {
        this.loadProgress = pct;
        this.syncFlairs();
        this.syncHeaderStyle();
    }

    private selectSceneDesc(sceneDesc: SceneDesc) {
        this.onscenedescselected(this.selectedSceneGroup, sceneDesc);
    }

    private selectSceneDescIndex(i: number) {
        this.selectSceneDesc(this.sceneDescs[i] as SceneDesc);
    }

    private selectRandom(): void {
        const sceneGroups = this.sceneGroups.filter((v) => typeof v !== 'string' && !v.hidden && v.sceneDescs.length > 0) as SceneGroup[];
        this.selectSceneGroup(randomChoice(sceneGroups));

        const sceneDescs = this.sceneDescs.filter((v) => typeof v !== 'string') as SceneDesc[];
        this.selectSceneDesc(randomChoice(sceneDescs));

        this.sceneGroupList.scrollFocus();
        this.sceneDescList.scrollFocus();
    }

    private getLoadingGradient(rightColor: string) {
        const pct = `${Math.round(this.loadProgress * 100)}%`;
        return `linear-gradient(to right, ${HIGHLIGHT_COLOR} ${pct}, ${rightColor} ${pct})`;
    }

    protected override syncHeaderStyle() {
        super.syncHeaderStyle();

        setElementHighlighted(this.header, !!this.expanded);
        this.header.style.backgroundColor = 'transparent';

        if (this.expanded)
            this.headerContainer.style.background = HIGHLIGHT_COLOR;
        else
            this.headerContainer.style.background = this.getLoadingGradient(PANEL_BG_COLOR);
    }

    private syncFlairs() {
        const sceneGroupFlairs: Flair[] = [];
        const currentGroupIndex = this.sceneGroups.indexOf(this.currentSceneGroup);
        if (currentGroupIndex >= 0) {
            const flair = ensureFlairIndex(sceneGroupFlairs, currentGroupIndex);
            flair.background = '#666';
        }
        this.sceneGroupList.setFlairs(sceneGroupFlairs);

        const sceneDescFlairs: Flair[] = [];
        const selectedDescIndex = this.sceneDescs.indexOf(this.currentSceneDesc);
        if (selectedDescIndex >= 0) {
            const flair = ensureFlairIndex(sceneDescFlairs, selectedDescIndex);
            flair.background = this.getLoadingGradient('transparent');
            flair.fontWeight = 'bold';
            const pct = `${Math.round(this.loadProgress * 100)}%`;
            flair.extraHTML = this.loadProgress < 1.0 ? `<span style="font-weight: bold; color: #aaa">${pct}</span>` : ``;
        }
        this.sceneDescList.setFlairs(sceneDescFlairs);
    }

    private selectSceneGroup(sceneGroup: SceneGroup): void {
        this.selectedSceneGroup = sceneGroup;
        this.syncSceneDescs();
    }

    private selectSceneGroupIndex(i: number) {
        this.selectSceneGroup(this.sceneGroups[i] as SceneGroup);
    }

    private syncSceneDescs() {
        if (this.selectedSceneGroup)
            this.setSceneDescs(this.selectedSceneGroup.sceneDescs);
        else
            this.setSceneDescs([]);
    }

    private setSceneDescs(sceneDescs: (string | SceneDesc)[]) {
        this.sceneDescs = sceneDescs;
        this.sceneDescList.setItems(sceneDescs.map((g): ScrollSelectItem => {
            if (typeof g === 'string')
                return { type: ScrollSelectItemType.Header, name: g };
            else
                return { type: ScrollSelectItemType.Selectable, name: g.name };
        }));
        this.syncFlairs();
        this.syncVisibility();
    }
}

function makeHashSafe(s: string): string {
    // The set of characters that we encode is basically determined by Twitter's URL parsing.
    return s.replace(/[{}()^]/g, (c) => {
        return `%${c.charCodeAt(0).toString(16)}`;
    });
}

function buildShareURL(saveState: string): string {
    const loc = window.location;
    return `${loc.origin}${loc.pathname}#${makeHashSafe(saveState)}`;
}

function cloneCanvas(dst: HTMLCanvasElement, src: HTMLCanvasElement): void {
    dst.width = src.width;
    dst.height = src.height;
    dst.title = src.title;
    const ctx = dst.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
}

const CHECKERBOARD_IMAGE = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSwooAAAAAElFTkSuQmCC")';

export interface TextureListHolder {
    viewerTextures: Viewer.Texture[];
    onnewtextures: (() => void) | null;
}

class FrameDebouncer {
    private timeoutId: number | null = null;
    public callback: (() => void) | null = null;

    constructor(public timeout = 100) {
    }

    private onframe = (): void => {
        if (this.callback !== null)
            this.callback();
        this.timeoutId = null;
    }

    public trigger(): void {
        if (this.timeoutId !== null)
            this.clear();
        if (this.callback !== null)
            this.timeoutId = setTimeout(this.onframe, this.timeout);
    }

    public clear() {
        if (this.timeoutId === null)
            return;
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
    }
}

export class TextureViewer extends Panel {
    private scrollList: SingleSelect;
    private surfaceView: HTMLElement;
    private fullSurfaceView: HTMLElement;
    private properties: HTMLElement;
    private textureList: Viewer.Texture[] = [];
    private newTexturesDebouncer = new FrameDebouncer();

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
        this.surfaceView.onmouseout(null as unknown as MouseEvent);

        this.contents.appendChild(this.surfaceView);

        this.properties = document.createElement('div');
        this.contents.appendChild(this.properties);

        this.fullSurfaceView = document.createElement('div');
        this.fullSurfaceView.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
        this.fullSurfaceView.style.padding = '20px';
        this.extraRack.appendChild(this.fullSurfaceView);
    }

    public async getViewerTextureList(): Promise<Viewer.Texture[]> {
        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.textureList.length; i++)
            promises.push(this.maybeActivateTexture(this.textureList[i]));
        await Promise.all(promises);
        return this.textureList;
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

        for (let i = 0; i < surfaces.length; i++) {
            const newCanvas = document.createElement('canvas');
            cloneCanvas(newCanvas, surfaces[i]);
            newCanvas.style.display = 'block';
            newCanvas.style.backgroundColor = 'white';
            newCanvas.style.backgroundImage = CHECKERBOARD_IMAGE;

            this.fullSurfaceView.appendChild(newCanvas);
        }
    }

    private async maybeActivateTexture(texture: Viewer.Texture): Promise<void> {
        if (texture.surfaces.length === 0 && texture.activate !== undefined) {
            await texture.activate();
        } else {
            // We're good.
        }
    }

    private selectTexture(i: number): void {
        const texture: Viewer.Texture = this.textureList[i];

        if (texture.surfaces.length === 0 && texture.activate !== undefined) {
            texture.activate().then(() => {
                this.selectTexture(i);
            });
            return;
        }

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

        const div = this.properties.firstElementChild!;
        properties.forEach((value, name) => {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            div.appendChild(nameSpan);
            const valueSpan = document.createElement('span');
            valueSpan.style.textAlign = 'right';
            valueSpan.textContent = value;
            div.appendChild(valueSpan);
        });

        if (texture.surfaces.length > 0)
            this.showInSurfaceView(texture.surfaces[0]);

        this.showInFullSurfaceView(texture.surfaces);
    }

    public setThingList(things: { viewerTexture: Viewer.Texture }[]) {
        this.setTextureList(things.map((thing) => thing.viewerTexture));
    }

    public setTextureList(textures: Viewer.Texture[]) {
        textures = textures.filter((tex) => tex.surfaces.length > 0 || tex.activate !== undefined);

        this.setVisible(textures.length > 0);
        if (textures.length === 0)
            return;

        const strings = textures.map((texture) => texture.name);
        this.scrollList.setStrings(strings);
        this.textureList = textures;
    }

    public setTextureHolder(textureHolder: TextureListHolder): void {
        this.newTexturesDebouncer.callback = () => {
            this.setTextureList(textureHolder.viewerTextures);
        };
        textureHolder.onnewtextures = () => {
            this.newTexturesDebouncer.trigger();
        };
        this.newTexturesDebouncer.trigger();
    }
}

export class Slider implements Widget {
    private toplevel: HTMLElement;
    private sliderInput: HTMLInputElement;

    public elem: HTMLElement;
    public onvalue: ((value: number) => void) | null = null;

    constructor() {
        this.toplevel = document.createElement('div');

        // DOM lacks a coherent way of adjusting pseudostyles, so this is what we end up with...
        this.toplevel.innerHTML = `
<style>
.Slider {
    -webkit-appearance: none;
    width: 100%;
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
    -webkit-appearance: none;
    width: 16px;
    height: 24px;
    cursor: pointer;
    background: ${HIGHLIGHT_COLOR};
    border-radius: 0;
    border: none;
}
.Slider::-moz-range-track {
    cursor: pointer;
    height: 24px;
    background: #444;
}
.Slider::-webkit-slider-runnable-track {
    cursor: pointer;
    height: 24px;
    background: #444;
}
</style>
<div style="display: grid; grid-template-columns: 1fr 1fr; align-items: center">
<div style="font-weight: bold; user-select: none" class="Label"></div>
<input class="Slider" type="range">
</div>
`;

        this.sliderInput = this.toplevel.querySelector('.Slider') as HTMLInputElement;
        this.sliderInput.oninput = this.onInput.bind(this);

        this.elem = this.toplevel;
    }

    private onInput(): void {
        if (this.onvalue !== null)
            this.onvalue(this.getValue());
    }

    public setRange(min: number, max: number, step: number = (max - min) / 100) {
        this.sliderInput.min = '' + min;
        this.sliderInput.max = '' + max;
        this.sliderInput.step = '' + step;
    }

    public setLabel(label: string): void {
        this.toplevel.querySelector('.Label')!.textContent = label;
    }

    public getValue(): number {
        return +this.sliderInput.value;
    }

    public setValue(v: number, triggerCallback: boolean = false): void {
        this.sliderInput.value = '' + v;
        if (triggerCallback)
            this.onInput();
    }

    public getT(): number {
        return invlerp(+this.sliderInput.min, +this.sliderInput.max, +this.sliderInput.value);
    }

    public setT(t: number): void {
        const v = lerp(+this.sliderInput.min, +this.sliderInput.max, t);
        this.setValue(v);
    }
}

export class RadioButtons implements Widget {
    public elem: HTMLElement;
    public selectedIndex: number = -1;
    public onselectedchange: ((() => void) | null) = null;
    public options: HTMLElement[] = [];

    constructor(title: string, optionNames: string[]) {
        this.elem = document.createElement('div');

        this.elem.style.display = 'grid';

        const fr = (title.length ? `${optionNames.length}fr ` : ``) + `${optionNames.map(() => '1fr').join(' ')}`;
        this.elem.style.gridTemplateColumns = fr;
        this.elem.style.alignItems = 'center';

        if (title.length) {
            const header = document.createElement('div');
            header.style.fontWeight = 'bold';
            header.textContent = title;
            this.elem.appendChild(header);
        }

        optionNames.forEach((optionName, i) => {
            const option = document.createElement('div');
            option.style.fontWeight = `bold`;
            option.style.textAlign = `center`;
            option.style.lineHeight = `24px`;
            option.style.cursor = `pointer`;
            option.textContent = optionName;
            option.onclick = () => {
                this.setSelectedIndex(i);
            };

            this.elem.appendChild(option);
            this.options.push(option);
        });
    }

    public setVisible(v: boolean) {
        this.elem.style.display = v ? 'grid' : 'none';
    }

    private sync(): void {
        this.options.forEach((option, i) => {
            setElementHighlighted(option, i === this.selectedIndex);
        });
    }

    public setSelectedIndex(i: number): void {
        if (this.selectedIndex === i)
            return;

        this.selectedIndex = i;
        this.sync();

        if (this.onselectedchange !== null)
            this.onselectedchange();
    }
}

class ViewerSettings extends Panel {
    private fovSlider: Slider;
    private camControllerClasses: CameraControllerClass[] = [FPSCameraController, OrbitCameraController, OrthoCameraController];
    private camRadioButtons: RadioButtons;
    private camSpeedSlider: Slider;
    private invertYCheckbox: Checkbox;
    private invertXCheckbox: Checkbox;
    private antialiasingRadioButtons: RadioButtons;

    constructor(private ui: UI, private viewer: Viewer.Viewer) {
        super();

        this.setTitle(FRUSTUM_ICON, 'Viewer Settings');

        this.contents.style.lineHeight = '36px';

        // Don't change the order
        this.camRadioButtons = new RadioButtons('Camera Controls', ['WASD', 'Orbit', 'Ortho']);
        this.camRadioButtons.onselectedchange = () => {
            if (ui.studioModeEnabled)
                return;

            this.setCameraControllerIndex(this.camRadioButtons.selectedIndex);
        };
        this.contents.appendChild(this.camRadioButtons.elem);

        this.fovSlider = new Slider();
        this.fovSlider.setLabel("Field of View");
        this.fovSlider.setRange(1, 100);
        this.fovSlider.setValue(Viewer.Viewer.FOV_Y_DEFAULT / Math.PI * 100);
        this.fovSlider.onvalue = this.onFovSliderChange.bind(this);
        this.contents.appendChild(this.fovSlider.elem);

        this.camSpeedSlider = new Slider();
        this.camSpeedSlider.setLabel("Camera Speed");
        this.camSpeedSlider.setRange(0, 200);
        this.camSpeedSlider.onvalue = this.updateCameraSpeedFromSlider.bind(this);
        this.contents.appendChild(this.camSpeedSlider.elem);

        this.viewer.addKeyMoveSpeedListener(this.onKeyMoveSpeedChanged.bind(this));
        this.viewer.inputManager.addScrollListener(this.onScrollWheel.bind(this));

        const limits = this.viewer.gfxDevice.queryLimits();

        const aaModes = ['None', 'FXAA'];
        if (limits.supportedSampleCounts.includes(4))
            aaModes.push('4x MSAA');

        this.antialiasingRadioButtons = new RadioButtons('Antialiasing', aaModes);
        this.antialiasingRadioButtons.onselectedchange = () => { GlobalSaveManager.saveSetting(`AntialiasingMode`, this.antialiasingRadioButtons.selectedIndex); };
        this.contents.appendChild(this.antialiasingRadioButtons.elem);
        GlobalSaveManager.addSettingListener('AntialiasingMode', this.antialiasingChanged.bind(this));

        this.invertYCheckbox = new Checkbox('Invert Y Axis?');
        this.invertYCheckbox.onchanged = () => { GlobalSaveManager.saveSetting(`InvertY`, this.invertYCheckbox.checked); };
        this.contents.appendChild(this.invertYCheckbox.elem);
        GlobalSaveManager.addSettingListener('InvertY', this.invertYChanged.bind(this));

        this.invertXCheckbox = new Checkbox('Invert X Axis?');
        this.invertXCheckbox.onchanged = () => { GlobalSaveManager.saveSetting(`InvertX`, this.invertXCheckbox.checked); };
        this.contents.appendChild(this.invertXCheckbox.elem);
        GlobalSaveManager.addSettingListener('InvertX', this.invertXChanged.bind(this));
    }

    public setCameraControllerIndex(idx: number) {
        const index = this.camRadioButtons.selectedIndex;
        const cameraControllerClass = this.camControllerClasses[index];
        this.setCameraControllerClass(cameraControllerClass);
    }

    private onFovSliderChange(): void {
        const value = this.fovSlider.getT();
        this.viewer.fovY = value * (Math.PI * 0.995);
    }

    private onKeyMoveSpeedChanged(): void {
        const keyMoveSpeed = this.viewer.cameraController!.getKeyMoveSpeed();
        if (keyMoveSpeed !== null) {
            setElementVisible(this.camSpeedSlider.elem, true);
            this.camSpeedSlider.setValue(keyMoveSpeed);
            this.ui.cameraSpeedIndicator.setCameraSpeed(keyMoveSpeed);
        } else {
            setElementVisible(this.camSpeedSlider.elem, false);
        }
    }

    public setInitialKeyMoveSpeed(v: number): void {
        this.camSpeedSlider.setValue(v);
    }

    private setCameraControllerClass(cameraControllerClass: CameraControllerClass) {
        if (this.viewer.cameraController instanceof cameraControllerClass)
            return;
        this.viewer.setCameraController(new cameraControllerClass());
        this.cameraControllerSelected(cameraControllerClass);
        this.updateCameraSpeedFromSlider();
    }

    private onScrollWheel(): void {
        const v = clamp(this.camSpeedSlider.getValue() + Math.sign(this.viewer.inputManager.dz) * 4, 0, 200);
        this.ui.setMouseActive();
        this.viewer.setKeyMoveSpeed(v);
    }

    private updateCameraSpeedFromSlider(): void {
        this.viewer.setKeyMoveSpeed(this.camSpeedSlider.getValue());
    }

    public cameraControllerSelected(cameraControllerClass: CameraControllerClass) {
        this.camRadioButtons.setSelectedIndex(this.camControllerClasses.indexOf(cameraControllerClass));
        setElementVisible(this.fovSlider.elem, cameraControllerClass !== OrthoCameraController);
    }

    private invertYChanged(saveManager: SaveManager, key: string): void {
        const invertY = saveManager.loadSetting<boolean>(key, false);
        this.invertYCheckbox.setChecked(invertY);
    }

    private invertXChanged(saveManager: SaveManager, key: string): void {
        const invertX = saveManager.loadSetting<boolean>(key, false);
        this.invertXCheckbox.setChecked(invertX);
    }

    private antialiasingChanged(saveManager: SaveManager, key: string): void {
        const antialiasingMode = saveManager.loadSetting<AntialiasingMode>(key, AntialiasingMode.FXAA);
        this.antialiasingRadioButtons.setSelectedIndex(antialiasingMode);
    }
}

class XRSettings extends Panel {
    public onWebXRStateRequested: (state: boolean) => void = (state: boolean) => { };

    public enableXRCheckBox: Checkbox;
    private scaleSlider: Slider;

    constructor(private ui: UI, private viewer: Viewer.Viewer) {
        super();

        this.setTitle(VR_ICON, 'VR Settings');

        this.contents.style.lineHeight = '36px';

        this.contents.innerHTML += `
        <div id="About">
        <p>To enable VR in Chrome, make sure you go to <font color="aqua">chrome://flags/</font> and change the following settings:</p>
        <ul>
            <li> WebXR Device API - <font color="green"><strong>Enabled</strong></font></li>
            <li>OpenXR support - <font color="green"><strong>Enabled</strong></font></li>
            <li>OpenVR hardware support - <font color="green"><strong>Enabled</strong></font></li>
            <li>Oculus hardware support - <font color="green"><strong>Enabled</strong></font></li>
            <li>XR device sandboxing - <font color="red"><strong>Disabled</strong></font></li>
        </ul>
        <p>Click on the <strong>Enable VR</strong> checkbox to go in VR mode.</p>
        <p>Press the <strong>Trigger</strong> to go up, and use the <strong>Grab Button</strong> to go down.
        You can move horizontally by using the <strong>Joystick</strong>.
        </div>
        `;

        this.enableXRCheckBox = new Checkbox('Enable VR');
        this.contents.appendChild(this.enableXRCheckBox.elem);
        this.enableXRCheckBox.onchanged = this.enableXRChecked.bind(this);

        const displayScaleValue = (value: Number) => {
            return value.toPrecision(5).toString();
        };

        const getSliderLabel = () => {
            return `VR World Scale: ${displayScaleValue(this.viewer.xrCameraController.worldScale)}`;
        };

        this.scaleSlider = new Slider();
        this.scaleSlider.setLabel(getSliderLabel());
        this.scaleSlider.setRange(10, 10000);
        this.scaleSlider.setValue(this.viewer.xrCameraController.worldScale);
        this.scaleSlider.onvalue = () => {
            this.viewer.xrCameraController.worldScale = this.scaleSlider.getValue();
            this.scaleSlider.setValue(this.viewer.xrCameraController.worldScale);
            this.scaleSlider.setLabel(getSliderLabel());
        };
        this.contents.appendChild(this.scaleSlider.elem);
    }

    private enableXRChecked() {
        const enableXR = this.enableXRCheckBox.checked;
        this.enableXRCheckBox.setChecked(enableXR);
        this.onWebXRStateRequested(enableXR);
    }
}

class LineGraph {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public textYOffset: number = 0;

    constructor(public minY: number = 0, public maxY: number = 160) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d')!;
    }

    public beginDraw(width: number, height: number): void {
        Viewer.resizeCanvas(this.canvas, width, height, window.devicePixelRatio);

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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

class StatisticsPanel extends Panel {
    private fpsGraph = new LineGraph();
    private fpsHistory: number[] = [];
    private fpsPoints: number[] = [];
    private fpsColor: Color = { r: 0.4, g: 0.9, b: 0.6, a: 1.0 };

    constructor(private viewer: Viewer.Viewer) {
        super();
        this.setTitle(STATISTICS_ICON, 'Statistics');

        this.contents.appendChild(this.fpsGraph.canvas);
    }

    public addRenderStatistics(renderStatistics: RenderStatistics): void {
        if (!this.expanded)
            return;

        this.fpsHistory.unshift(renderStatistics.fps);
        while (this.fpsHistory.length > 100)
            this.fpsHistory.pop();

        this.fpsPoints.length = 100;
        for (let i = 0; i < this.fpsPoints.length; i++)
            this.fpsPoints[i] = this.fpsHistory[i] !== undefined ? this.fpsHistory[i] : 0;

        this.fpsGraph.beginDraw(440, 200);
        this.fpsGraph.drawPoints(this.fpsPoints, this.fpsColor);

        for (const line of renderStatistics.lines)
            this.fpsGraph.drawText(line);
    }
}

class StudioSidePanel extends Panel {
    private studioSidePanelHelpBtn: HTMLButtonElement;
    private enableStudioBtn: HTMLElement;
    private disableStudioBtn: HTMLElement;

    constructor(private ui: UI) {
        super();
        this.setTitle(CLAPBOARD_ICON, 'Studio');
        document.head.insertAdjacentHTML('beforeend', `
            <style>
                button.SettingsButton {
                    font: 16px monospace;
                    font-weight: bold;
                    border: none;
                    width: 100%;
                    color: inherit;
                    padding: 0.15rem;
                    text-align: center;
                    background-color: rgb(64, 64, 64);
                    cursor: pointer;
                }
                #studioSidePanelHelpBtn {
                    width: 32px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin-left: 1rem;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                }
            </style>
            `);
        this.contents.insertAdjacentHTML('beforeend', `
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; align-items: center;">
                <div style="display: flex;">
                    <span>Studio Mode</span>
                    <button class="SettingsButton" id="studioSidePanelHelpBtn"></button>
                </div>
                <button id="enableStudioBtn" class="SettingsButton">Enable</button>
                <button id="disableStudioBtn" class="SettingsButton">Disable</button>
            </div>
            <div id="studioPanelContents" hidden></div>
        `);
        this.contents.style.lineHeight = '36px';

        this.studioSidePanelHelpBtn = this.contents.querySelector('#studioSidePanelHelpBtn') as HTMLButtonElement;
        this.studioSidePanelHelpBtn.appendChild(createDOMFromString(ABOUT_ICON).querySelector('svg')!);
        this.studioSidePanelHelpBtn.onclick = () => {
            const helpLink = document.createElement('a') as HTMLAnchorElement;
            helpLink.rel = 'noopener noreferrer';
            helpLink.target = '_blank';
            helpLink.href = 'https://github.com/magcius/noclip.website/wiki/Studio';
            helpLink.click();
        }

        this.enableStudioBtn = this.contents.querySelector('#enableStudioBtn') as HTMLInputElement;
        this.disableStudioBtn = this.contents.querySelector('#disableStudioBtn') as HTMLInputElement;

        this.enableStudioBtn.onclick = () => {
            if (!ui.studioModeEnabled) {
                ui.enableStudioMode();
                setElementHighlighted(this.enableStudioBtn, true);
                setElementHighlighted(this.disableStudioBtn, false);
                this.setExpanded(false);
            }
        }
        this.disableStudioBtn.onclick = () => {
            if (ui.studioModeEnabled) {
                ui.disableStudioMode();
                setElementHighlighted(this.disableStudioBtn, true);
                setElementHighlighted(this.enableStudioBtn, false);
            }
        };
        setElementHighlighted(this.disableStudioBtn, true);
        setElementHighlighted(this.enableStudioBtn, false);
    }
}

class About extends Panel {
    public onfaq: (() => void) | null = null;

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
#About h1 {
    margin: 0px;
    font-size: 2em;
}
#About h2 {
    font-size: 12.8pt;
}
#About h1 span, #About h1 img {
    vertical-align: middle;
    line-height: 64px;
}
#About .BuildVersion a {
    color: #666;
    font-size: smaller;
}
</style>

<h1> <img src="${logoURL}"> <span> noclip.website </span> </h1>
<h2> A digital museum of video game levels </h2>

<a href="#" class="FAQLink"> What is this? / FAQ </a>

<p> <strong>CLICK AND DRAG</strong> to look around and use <strong>WASD</strong> to move the camera </p>
<p> Hold <strong>SHIFT</strong> to go faster, and use <strong>MOUSE WHEEL</strong> to fine tune the speed
<strong>Z</strong> toggles the UI. </p>

<p><a href="https://discord.gg/bkJmKKv"><strong>JOIN THE DISCORD</strong> by clicking here</a></p>

<p><strong>CODE PRIMARILY WRITTEN</strong> by <a href="https://twitter.com/JasperRLZ">Jasper</a></p>

<p><strong>OPEN SOURCE</strong> at <a href="${GITHUB_URL}">GitHub</a></p>

<p class="BuildVersion"><a href="${GITHUB_REVISION_URL}">build ${GIT_SHORT_REVISION}</a></p>
</div>
`;
        const faqLink = this.contents.querySelector('.FAQLink') as HTMLAnchorElement;
        faqLink.onclick = () => {
            if (this.onfaq !== null)
                this.onfaq();
        };
    }
}

class FAQPanel implements Widget {
    private toplevel: HTMLElement;
    private panel: HTMLElement;

    public elem: HTMLElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.classList.add('FAQPanel');
        this.toplevel.style.position = 'absolute';
        this.toplevel.style.left = '0';
        this.toplevel.style.top = '0';
        this.toplevel.style.right = '0';
        this.toplevel.style.bottom = '0';
        this.toplevel.style.background = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.onclick = () => {
            this.elem.style.display = 'none';
        };

        const styleFrag = createDOMFromString(`
<style>
.FAQPanel a:link, .FAQPanel a:visited { color: #ddd; }
.FAQPanel a:hover { color: #fff; }
</style>
`);
        this.toplevel.appendChild(styleFrag);

        this.panel = document.createElement('div');
        this.panel.style.boxSizing = 'border-box';
        this.panel.style.width = '50vw';
        this.panel.style.margin = '5vh auto';
        this.panel.style.height = '90vh';
        this.panel.style.backgroundColor = 'black';
        this.panel.style.padding = '2em';
        this.panel.style.font = '11pt monospace';
        this.panel.style.overflow = 'auto';
        this.panel.style.color = '#ddd';
        this.panel.style.textAlign = 'justify';
        this.panel.onclick = (e) => {
            e.stopPropagation();
        };

        const qa = document.createElement('div');
        this.panel.appendChild(qa);

        const faq = `
## What is noclip.website?

<p>noclip.website is a celebration of video game level design and art. It's a chance to
explore and deepen your appreciation for some of your favorite games.</p>

## Why did you make this?

<p>I've always had an appreciation for the incredible worlds that game developers make.
Sometimes staring closely at levels might help you understand the challenges the designers
were facing, and what problems and techniques they used to solve them. You can learn a lot
about a game by looking in the places they <em>don't</em> show in the game itself. It's
also a ton of fun to test your memory, seeing if you can remember how a level is laid
out, or where two rooms might connect to each other.</p>

## It doesn't work!

<p>Oops, sorry about that. Please let me know through either the <a href="https://discord.gg/bkJmKKv">official noclip.website Discord</a>
or <a href="https://twitter.com/JasperRLZ/">Twitter</a>. Try to let me know what
OS/browser/GPU you were using, and what game you tried to view, and I'll investigate.</p>

## Can I request a game?

<p>Maybe. Check around to see if anybody has looked at the game files before. If there's
existing community documentation, that helps a lot. And if you're around to help answer
questions or provide map names, I'm even more inclined.</p>

<p>Even having documentation, games can take months of my time to add. So I have to be
very careful with which games I choose to spend my time with.</p>

<p>If you have some programming skills and want to try to add a game yourself, I fully
welcome that. Join the Discord and I will be happy to help you get set up with a
development environment and walk you through the code.</p>

## Why do some levels look broken?

<p>In order to put a game on the website, I first need to take apart the game, extract
the data, and then figure out how to put it back together. Some of these games, especially
the newer ones, are really complex with their levels and their models, and that often means
it takes more work to make it look correct. The line between "game engine" and "game data"
is only getting blurrier and blurrier.</p>

<p>My dream is that the site contains fully accurate versions of each game, and I try
to get closer to that goal when I can, but the effort and time involved to make an accurate
recreation can sometimes be far too much, or would push me more into recreating large
parts of the original game's engine, which I'm less interested in doing myself.</p>

## How do I export models from the site?

<p>You can't. From the technical side, there is no one consistent file format that has
all of the features that an accurate model would require. From a personal perspective,
I'm not ready to take on the support burden of writing an export tool.</p>

<p>That said, if you would like to use my work as a base to build your own tools, the website
is open-source and source code can be found at <a href="https://github.com/magcius/noclip.website">GitHub</a>.</p>

<p>If you are looking for art for your own projects, there are some fantastic artists
out there in the community that are always looking for work. Hire them instead of
using art assets from other games.</p>

## This is cool! Any way I can help you out!

<p>Absolutely. Join <a href="https://discord.gg/bkJmKKv">the official Discord</a> and ask around if you would like to help out.
The easiest things to help out with are providing savestates and naming maps, and can
be done even if you do not know how to code. There's also some work that would be
appreciated to help me improve accuracy, like running games in certain modes to help
me compare the two.</p>

<p>If you have a more tech-y background, there's always coding work to be done. All
the source code to the site is available at <a href="https://github.com/magcius/noclip.website">GitHub</a>,
whether you want to browse around, use it for your own purposes, or help contribute.</p>

## Are you afraid of being taken down?

<p>Less than you might think. Companies take down fan projects when they're competing
with their in-house projects. I don't see noclip.website as competing with any game
out there &mdash; it's more of a museum, not a game. The worlds on display are incredible
and I hope they encourage you to go out and buy a copy of the game itself.</p>

<p>That said, I have enormous respect for the developers and dev teams and if I received
a take-down request, I would honor it. It is their work on display, after all.</p>

<p>Developers are only able to make these fantastic worlds if we collectively support
them. noclip would not exist without their hard work and dedication. To ensure that they
remain healthy, please try to buy games instead of pirating them. I also put in extra effort
to ensure that all assets available on this site cannot be used to pirate the game itself.</p>

## Do you accept donations?

<p>No. Use the money to buy some games instead.</p>

## Any affiliation to noclip, the documentary people?

<p>I chatted with them once, but the name is a coincidence. The name comes from an old Quake
command that would let you fly through the levels here, just like in the game.</p>

## Have you seen the YouTube show Boundary Break?

<p>Of course! I love that show. I'm ecstatic to see that exploring video game levels from
different angles has captured the imaginations of such a wide audience. And I hope that this
site encourages that same curiosity that's visible all throughout Boundary Break, trekking
through these levels on your own adventures!</p>

## Who made this site?

<p>In my opinion? The artists and game developers. They made everything you actually see here
on display.</p>

<p>All icons you see are from <a href="https://thenounproject.com/">The Noun Project</a>,
used under Creative Commons CC-BY:</p>
<ul>
<li> Truncated Pyramid <span>by</span> Bohdan Burmich
<li> Images <span>by</span> Creative Stall
<li> Help <span>by</span> Gregor Cresnar
<li> Open <span>by</span> Landan Lloyd
<li> Nightshift <span>by</span> mikicon
<li> Layer <span>by</span> Chameleon Design
<li> Sand Clock <span>by</span> James
<li> Line Chart <span>by</span> Shastry
<li> Search <span>by</span> Alain W.
<li> Save <span>by</span> Prime Icons
<li> Overlap <span>by</span> Zach Bogart
<li> VR <span>by</span> Fauzan Adaiima
<li> Play Clapboard <span>by</span> Yoyon Pujiyono
<li> Undo <span>by</span> Numero Uno
<li> Redo <span>by</span> Numero Uno
<li> Zoom In <span>by</span> Tanvir Islam
<li> Zoom Out <span>by</span> Tanvir Islam

</ul>
`;

        const qas = faq.split('##').slice(1).map((qa) => {
            const firstNewline = qa.indexOf('\n');
            const question = qa.slice(0, firstNewline).trim();
            const answer = qa.slice(firstNewline).trim();

            return { question, answer };
        });

        for (let i = 0; i < qas.length; i++) {
            const block = document.createElement('div');

            const title = qas[i].question;

            const q = document.createElement('p');
            q.style.color = '#ccc';
            q.style.fontWeight = 'bold';
            q.style.marginTop = '0';
            q.style.fontSize = '12pt';
            q.textContent = title;
            block.appendChild(q);
            const a = document.createElement('p');
            a.style.marginBottom = '1.6em';
            a.innerHTML = qas[i].answer;
            block.appendChild(a);

            qa.appendChild(block);
        }

        this.toplevel.appendChild(this.panel);

        this.elem = this.toplevel;
    }
}

export interface Layer {
    name: string;
    visible: boolean;
    setVisible(v: boolean): void;
}

export class LayerPanel extends Panel {
    public multiSelect: MultiSelect;
    private layers: Layer[] = [];
    public onlayertoggled: (() => void) | null = null;

    constructor(layers: Layer[] | null = null) {
        super();
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        this.setTitle(LAYER_ICON, 'Layers');
        this.multiSelect = new MultiSelect();
        this.multiSelect.onitemchanged = this._onItemChanged.bind(this);
        this.contents.appendChild(this.multiSelect.elem);
        if (layers !== null)
            this.setLayers(layers);
    }

    private _onItemChanged(index: number, visible: boolean): void {
        this.layers[index].setVisible(visible);
        if (this.onlayertoggled !== null)
            this.onlayertoggled();
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
        this.setVisible(layers.length > 1);
    }
}

class CameraSpeedIndicator implements BottomBarWidget {
    public elem: HTMLElement;

    private currentAnimation: Animation | null = null;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.opacity = '0';
        this.elem.style.textShadow = `0 0 8px black`;
        this.elem.style.padding = '0 8px';
        this.elem.style.font = 'bold 16px monospace';
        this.elem.style.color = 'white';
        this.elem.style.pointerEvents = 'none';
        this.elem.style.lineHeight = '32px';
    }

    public setVisible(v: boolean): void {
        this.elem.style.display = v ? 'block' : 'none';
    }

    public setArea(): void {
    }

    public isAnyPanelExpanded(): boolean {
        return false;
    }

    public setCameraSpeed(v: number, displayIndicator: boolean = true): void {
        const dispV = Math.max(v, 1);
        this.elem.textContent = `Camera Speed: ${dispV.toFixed(0)}`;

        const pct = `${(dispV / 200) * 100}%`;
        this.elem.style.backgroundImage = `linear-gradient(to right, ${HIGHLIGHT_COLOR} ${pct}, rgba(0, 0, 0, 0.75) ${pct})`;

        if (displayIndicator) {
            if (this.currentAnimation !== null)
                this.currentAnimation.cancel();

            this.currentAnimation = this.elem.animate([
                { opacity: 1, offset: 0 },
                { opacity: 1, offset: 0.5 },
                { opacity: 0, offset: 1.0 },
            ], 2000);
        }
    }
}

const enum BottomBarArea { Left, Center, Right }

function setAreaAnchor(elem: HTMLElement, area: BottomBarArea) {
    if (area === BottomBarArea.Left) {
        elem.style.transform = '';
        elem.style.marginLeft = '';
        elem.style.right = '';
    } else if (area === BottomBarArea.Center) {
        elem.style.transform = 'translate(-50%, 0)';
        elem.style.marginLeft = '16px';
        elem.style.right = '';
    } else if (area === BottomBarArea.Right) {
        elem.style.transform = '';
        elem.style.marginLeft = '';
        elem.style.right = '0';
    }
}

interface BottomBarWidget {
    elem: HTMLElement;
    setArea(area: BottomBarArea): void;
    setVisible(v: boolean): void;
    isAnyPanelExpanded(): boolean;
}

class BottomBar {
    public elem: HTMLElement;
    public widgets: BottomBarWidget[] = [];

    constructor() {
        this.elem = document.createElement('div');
        this.elem.id = 'BottomBar';
        this.elem.style.position = 'absolute';
        this.elem.style.bottom = '32px';
        this.elem.style.left = '32px';
        this.elem.style.right = '32px';
        this.elem.style.display = 'grid';
        this.elem.style.gridTemplateColumns = '1fr 1fr 1fr';
        this.elem.style.gap = '8px';
        this.elem.style.transition = '.1s ease-out';
        this.elem.style.pointerEvents = 'none';

        const leftArea = this.newArea();
        leftArea.style.justifySelf = 'start';
        this.elem.appendChild(leftArea);

        const centerArea = this.newArea();
        centerArea.style.justifySelf = 'center';
        this.elem.appendChild(centerArea);

        const rightArea = this.newArea();
        rightArea.style.justifySelf = 'end';
        this.elem.appendChild(rightArea);
    }

    private newArea(): HTMLElement {
        const area = document.createElement('div');
        area.style.display = 'grid';
        area.style.gridAutoFlow = 'column';
        area.style.gap = '8px';
        return area;
    }

    public addWidgets(area: BottomBarArea, widget: BottomBarWidget): void {
        widget.setArea(area);
        this.widgets.push(widget);
        this.elem.children.item(area)!.appendChild(widget.elem);
    }

    public isAnyPanelExpanded(): boolean {
        for (let i = 0; i < this.widgets.length; i++)
            if (this.widgets[i].isAnyPanelExpanded())
                return true;
        return false;
    }

    public setActive(active: boolean): void {
        this.elem.style.opacity = active ? '1' : '0';
    }

    public setVisible(v: boolean): void {
        this.elem.style.display = v ? 'grid' : 'none';
    }
}

abstract class SingleIconButton implements BottomBarWidget {
    public elem: HTMLElement;
    public icon: HTMLElement;
    public tooltipElem: HTMLElement;
    public isOpen: boolean = false;
    public isHover: boolean = false;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.position = 'relative';
        this.elem.style.transition = '.1s ease-out';
        this.elem.style.width = '32px';
        this.elem.style.height = '32px';
        this.elem.style.pointerEvents = 'auto';
        this.elem.onclick = this.onClick.bind(this);
        this.elem.onmouseover = () => {
            this.isHover = true;
            this.syncStyle();
        };
        this.elem.onmouseout = () => {
            this.isHover = false;
            this.syncStyle();
        };

        this.icon = document.createElement('div');
        this.icon.style.width = '32px';
        this.icon.style.height = '32px';
        this.icon.style.cursor = 'pointer';
        this.icon.style.font = '16px monospace';
        this.icon.style.color = 'white';
        this.icon.style.lineHeight = '32px';
        this.icon.style.textAlign = 'center';
        this.icon.style.textShadow = '0px 0px 6px rgba(0, 0, 0, 0.5)';
        this.icon.style.transition = '0.1s ease-out';
        this.icon.style.userSelect = 'none';
        this.elem.appendChild(this.icon);

        this.tooltipElem = document.createElement('div');
        this.tooltipElem.style.position = 'absolute';
        this.tooltipElem.style.top = '0';
        this.tooltipElem.style.marginTop = '-32px';
        this.tooltipElem.style.padding = '0 8px';
        this.tooltipElem.style.background = 'rgba(0, 0, 0, 0.75)';
        this.tooltipElem.style.font = 'bold 16px monospace';
        this.tooltipElem.style.lineHeight = '32px';
        this.tooltipElem.style.color = 'white';
        this.tooltipElem.style.textShadow = `0 0 8px black`;
        this.tooltipElem.style.transition = '0.1s ease-out';
        this.tooltipElem.style.pointerEvents = 'none';
        this.tooltipElem.style.userSelect = 'none';
        this.tooltipElem.style.opacity = '0';
        this.elem.appendChild(this.tooltipElem);
    }

    public setShow(v: boolean): void {
        this.elem.style.display = v ? 'block' : 'none';
    }

    public setArea(area: BottomBarArea): void {
        setAreaAnchor(this.tooltipElem, area);
    }

    public setVisible(v: boolean): void {
        this.elem.style.display = v ? 'block' : 'none';
    }

    public isAnyPanelExpanded(): boolean {
        return this.isOpen;
    }

    public abstract onClick(e: MouseEvent): void;

    public setIsOpen(v: boolean): void {
        this.isOpen = v;
        this.syncStyle();
    }

    public syncStyle(): void {
        if (this.isOpen) {
            this.icon.style.background = 'rgba(0, 0, 0, 0.75)';
            this.icon.style.color = HIGHLIGHT_COLOR;
            this.tooltipElem.style.opacity = '0';
        } else if (this.isHover) {
            this.icon.style.background = 'rgba(0, 0, 0, 0.75)';
            this.icon.style.color = 'white';
            this.tooltipElem.style.opacity = '1';
        } else {
            this.icon.style.background = 'rgba(0, 0, 0, 0.0)';
            this.icon.style.color = 'white';
            this.tooltipElem.style.opacity = '0';
        }
    }
}

class PanelButton extends SingleIconButton {
    protected panel: HTMLElement;

    constructor() {
        super();

        this.panel = document.createElement('div');
        this.panel.style.position = 'absolute';
        this.panel.style.top = '0';
        this.panel.style.marginTop = '-32px';
        this.panel.style.lineHeight = '32px';
        this.panel.style.background = 'rgba(0, 0, 0, 0.75)';
        this.panel.style.transition = '0.1s ease-out';

        this.elem.appendChild(this.panel);

        this.syncStyle();
    }

    public override setArea(area: BottomBarArea): void {
        super.setArea(area);
        setAreaAnchor(this.panel, area);
    }

    public onClick(e: MouseEvent): void {
        if (!this.isOpen) {
            this.setIsOpen(true);
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: false, useGrabbingCursor: false, releaseOnMouseUp: false, grabElement: this.panel });
        }
    }

    public onMotion(): void {
        // Doesn't matter.
    }

    public onGrabReleased(): void {
        this.setIsOpen(false);
    }

    public override syncStyle(): void {
        super.syncStyle();

        if (this.isOpen) {
            this.panel.style.opacity = '1';
            this.panel.style.pointerEvents = '';
        } else {
            this.panel.style.opacity = '0';
            this.panel.style.pointerEvents = 'none';
        }
    }
}

class ShareButton extends PanelButton {
    public currentShareURLEntry: TextField;
    public copyButton: HTMLElement;
    private copyButtonState: 'copy' | 'copied';

    constructor() {
        super();
        this.tooltipElem.textContent = 'Share';
        setFontelloIcon(this.icon, FontelloIcon.share);

        this.panel.style.display = 'grid';
        this.panel.style.width = '400px';
        this.panel.style.gridAutoFlow = 'column';

        this.currentShareURLEntry = new TextField();
        this.currentShareURLEntry.textarea.readOnly = true;
        this.currentShareURLEntry.textarea.onfocus = () => {
            this.currentShareURLEntry.selectAll();
        };
        this.currentShareURLEntry.elem.style.width = 'auto';
        this.currentShareURLEntry.elem.style.lineHeight = '32px';
        this.currentShareURLEntry.elem.style.padding = '0 16px';
        this.panel.appendChild(this.currentShareURLEntry.elem);

        this.copyButton = document.createElement('div');
        this.copyButton.style.font = '16px monospace';
        this.copyButton.style.textShadow = '0px 0px 6px rgba(0, 0, 0, 0.5)';
        this.copyButton.style.color = 'white';
        this.copyButton.style.lineHeight = '32px';
        this.copyButton.style.textAlign = 'center';
        this.copyButton.style.userSelect = 'none';
        this.copyButton.onclick = () => {
            if (this.copyButtonState === 'copy') {
                window.navigator.clipboard.writeText(this.currentShareURLEntry.getValue());
                this.currentShareURLEntry.selectAll();
                this.setCopyButtonState('copied');
            }
        };
        this.setCopyButtonState('copy');
        this.panel.appendChild(this.copyButton);
    }

    private setCopyButtonState(state: 'copy' | 'copied'): void {
        if (this.copyButtonState === state)
            return;
        this.copyButtonState = state;
        if (state === 'copy') {
            this.copyButton.style.backgroundColor = HIGHLIGHT_COLOR;
            this.copyButton.style.cursor = 'pointer';
            this.copyButton.textContent = 'COPY';
        } else {
            this.copyButton.style.backgroundColor = '#666';
            this.copyButton.style.cursor = '';
            this.copyButton.textContent = 'COPIED';
        }
    }

    public setShareURL(shareURL: string) {
        this.setCopyButtonState('copy');
        this.currentShareURLEntry.setValue(shareURL);
    }
}

class FullscreenButton extends SingleIconButton {
    constructor() {
        super();
        if (document.body.requestFullscreen === undefined)
            this.setShow(false);
        document.addEventListener('fullscreenchange', this.syncStyle.bind(this));
        this.syncStyle();
    }

    private isFS() {
        return document.fullscreenElement === document.body;
    }

    public override syncStyle() {
        super.syncStyle();
        setFontelloIcon(this.icon, this.isFS() ? FontelloIcon.resize_small : FontelloIcon.resize_full);
        this.tooltipElem.textContent = this.isFS() ? 'Unfullscreen' : 'Fullscreen';
    }

    public onClick() {
        if (this.isFS())
            document.exitFullscreen();
        else
            document.body.requestFullscreen();
    }
}

class PlayPauseButton extends SingleIconButton {
    public onplaypause: ((shouldBePlaying: boolean) => void) | null = null;
    public isPlaying: boolean;

    public override syncStyle(): void {
        super.syncStyle();
        setFontelloIcon(this.icon, this.isPlaying ? FontelloIcon.pause : FontelloIcon.play);
        this.tooltipElem.textContent = this.isPlaying ? 'Pause' : 'Play';
    }

    public setIsPlaying(isPlaying: boolean): void {
        this.isPlaying = isPlaying;
        this.syncStyle();
    }

    public onClick() {
        if (this.onplaypause !== null)
            this.onplaypause(!this.isPlaying);
    }
}

class RecordingBranding {
    public elem: HTMLElement;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.position = 'absolute';
        this.elem.style.right = '0';
        this.elem.style.bottom = '0';
        this.elem.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        this.elem.style.borderTopLeftRadius = '8px';
        this.elem.style.font = '32px Norwester';
        this.elem.style.color = 'white';
        this.elem.style.padding = '4px 8px 4px 12px';
        this.elem.style.pointerEvents = 'none';
        this.elem.style.textShadow = '0px 0px 10px rgba(0, 0, 0, 0.8)';
        this.elem.style.visibility = 'hidden';
        this.elem.style.userSelect = 'none';
        this.elem.textContent = 'noclip.website';
    }

    public v(): void {
        this.elem.style.visibility = '';
        ((window.main.ui) as UI).toggleUI(false);
    }
}

export class UI {
    public elem: HTMLElement;

    private toplevel: HTMLElement;

    public dragHighlight: HTMLElement;
    public sceneUIContainer: HTMLElement;

    private panelToplevel: HTMLElement;
    private panelContainer: HTMLElement;

    public sceneSelect: SceneSelect;
    public textureViewer: TextureViewer;
    public viewerSettings: ViewerSettings;
    public xrSettings: XRSettings;
    public statisticsPanel: StatisticsPanel;
    public panels: Panel[];
    private about: About;
    private faqPanel: FAQPanel;
    private studioSidePanel: StudioSidePanel;
    private studioPanel: StudioPanel;
    private recordingBranding = new RecordingBranding();

    public cameraSpeedIndicator = new CameraSpeedIndicator();
    private bottomBar = new BottomBar();
    private playPauseButton = new PlayPauseButton();
    private shareButton = new ShareButton();
    private fullscreenButton = new FullscreenButton();

    public debugFloaterHolder = new DebugFloaterHolder();

    private isDragging: boolean = false;
    private lastMouseActiveTime: number = -1;

    public isPlaying: boolean = true;

    public isEmbedMode: boolean = false;
    public isVisible: boolean = true;

    public studioModeEnabled: boolean = false;

    constructor(public viewer: Viewer.Viewer) {
        this.toplevel = document.createElement('div');

        this.sceneUIContainer = document.createElement('div');
        this.sceneUIContainer.style.pointerEvents = 'none';
        this.toplevel.appendChild(this.sceneUIContainer);

        this.panelToplevel = document.createElement('div');
        this.panelToplevel.id = 'Panel';
        this.panelToplevel.style.position = 'absolute';
        this.panelToplevel.style.left = '0';
        this.panelToplevel.style.top = '0';
        this.panelToplevel.style.bottom = '0';
        this.panelToplevel.style.padding = '2em';
        this.panelToplevel.style.transition = '.2s background-color';
        this.panelToplevel.onmouseover = () => {
            this.panelToplevel.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            this.panelToplevel.style.overflow = 'auto';
            this.setPanelsAutoClosed(false);
        };
        this.panelToplevel.onmouseout = () => {
            this.panelToplevel.style.backgroundColor = 'rgba(0, 0, 0, 0)';
            this.panelToplevel.style.overflow = 'hidden';
        };

        this.panelContainer = document.createElement('div');
        this.panelContainer.style.display = 'grid';
        this.panelContainer.style.gridTemplateColumns = '1fr';
        this.panelContainer.style.gap = '20px';
        this.panelToplevel.appendChild(this.panelContainer);

        this.toplevel.appendChild(this.panelToplevel);

        this.dragHighlight = document.createElement('div');
        this.toplevel.appendChild(this.dragHighlight);
        this.dragHighlight.style.position = 'absolute';
        this.dragHighlight.style.left = '0';
        this.dragHighlight.style.right = '0';
        this.dragHighlight.style.top = '0';
        this.dragHighlight.style.bottom = '0';
        this.dragHighlight.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        this.dragHighlight.style.boxShadow = '0 0 40px 5px white inset';
        this.dragHighlight.style.display = 'none';
        this.dragHighlight.style.pointerEvents = 'none';

        this.toplevel.appendChild(this.debugFloaterHolder.elem);

        this.toplevel.appendChild(this.recordingBranding.elem);

        this.toplevel.appendChild(this.bottomBar.elem);
        this.bottomBar.addWidgets(BottomBarArea.Left, this.cameraSpeedIndicator);
        this.bottomBar.addWidgets(BottomBarArea.Center, this.playPauseButton);
        this.bottomBar.addWidgets(BottomBarArea.Right, this.shareButton);
        this.bottomBar.addWidgets(BottomBarArea.Right, this.fullscreenButton);

        this.sceneSelect = new SceneSelect(viewer);
        this.textureViewer = new TextureViewer();
        this.viewerSettings = new ViewerSettings(this, viewer);
        this.xrSettings = new XRSettings(this, viewer);
        this.statisticsPanel = new StatisticsPanel(viewer);
        this.about = new About();

        this.faqPanel = new FAQPanel();
        this.faqPanel.elem.style.display = 'none';
        this.toplevel.appendChild(this.faqPanel.elem);

        this.studioSidePanel = new StudioSidePanel(this);
        this.studioPanel = new StudioPanel(this, viewer);
        this.toplevel.appendChild(this.studioPanel.elem);

        this.playPauseButton.onplaypause = (shouldBePlaying) => {
            this.togglePlayPause(shouldBePlaying);
        };
        this.playPauseButton.setIsPlaying(this.isPlaying);

        this.about.onfaq = () => {
            this.faqPanel.elem.style.display = 'block';
        };

        window.onmousemove = () => {
            this.setMouseActive();
        };
        this.setMouseActive();

        this.setScenePanels(null);

        this.elem = this.toplevel;
    }

    public togglePlayPause(shouldBePlaying: boolean = !this.isPlaying): void {
        this.isPlaying = shouldBePlaying;
        this.playPauseButton.setIsPlaying(this.isPlaying);
    }

    public toggleWebXRCheckbox(shouldBeChecked: boolean = !this.xrSettings.enableXRCheckBox.checked) {
        this.xrSettings.enableXRCheckBox.setChecked(shouldBeChecked);
    }

    public setMouseActive(): void {
        this.lastMouseActiveTime = window.performance.now();
    }

    public update(): void {
        this.syncVisibilityState();
    }

    public setSaveState(saveState: string) {
        const shareURL = buildShareURL(saveState);
        this.shareButton.setShareURL(shareURL);
    }

    public sceneChanged() {
        const cameraControllerClass = this.viewer.cameraController!.constructor as CameraControllerClass;
        this.viewerSettings.cameraControllerSelected(cameraControllerClass);
        const keyMoveSpeed = this.viewer.cameraController!.getKeyMoveSpeed();
        if (keyMoveSpeed !== null)
            this.viewerSettings.setInitialKeyMoveSpeed(keyMoveSpeed);

        // Textures
        if (this.viewer.scene !== null) {
            const scene = this.viewer.scene;
            if (scene.textureHolder !== undefined)
                this.textureViewer.setTextureHolder(scene.textureHolder);
            else
                this.textureViewer.setTextureList([]);
        }

        if (this.studioModeEnabled)
            this.studioPanel.onSceneChange();
    }

    private setPanels(panels: Panel[]): void {
        this.panels = panels;
        setChildren(this.panelContainer, panels.map((panel) => panel.elem));
    }

    public destroyScene(): void {
        this.setScenePanels([]);
        setChildren(this.sceneUIContainer, []);
        this.debugFloaterHolder.destroyScene();
    }

    public setScenePanels(scenePanels: Panel[] | null): void {
        if (scenePanels !== null) {
            this.setPanels([this.sceneSelect, ...scenePanels, this.textureViewer, this.viewerSettings, this.xrSettings, this.statisticsPanel, this.studioSidePanel, this.about]);
        } else {
            this.setPanels([this.sceneSelect, this.about]);
        }
    }

    public setPanelsAutoClosed(v: boolean): void {
        for (let i = 0; i < this.panels.length; i++)
            this.panels[i].setAutoClosed(v);
    }

    private shouldPanelsAutoClose(): boolean {
        // TODO(jstpierre): Lock icon?
        if (this.statisticsPanel.manuallyExpanded)
            return false;
        return true;
    }

    private shouldBottomBarBeFadeIn(): boolean {
        if (this.bottomBar.isAnyPanelExpanded())
            return true;

        if (this.isDragging)
            return true;

        // Hide after one second of mouse inactivity
        const lastMouseActiveHideThreshold = 1000;
        if (window.performance.now() > this.lastMouseActiveTime + lastMouseActiveHideThreshold)
            return false;

        return true;
    }

    public setDraggingMode(draggingMode: DraggingMode): void {
        const isDragging = draggingMode !== DraggingMode.None;
        const isPointerLocked = draggingMode === DraggingMode.PointerLocked;

        this.isDragging = isDragging;
        this.elem.style.pointerEvents = (isDragging && !isPointerLocked) ? 'none' : '';
        if (isDragging && this.shouldPanelsAutoClose())
            this.setPanelsAutoClosed(true);
        this.syncVisibilityState();
    }

    private syncVisibilityState(): void {
        const panelsVisible = !this.isEmbedMode && this.isVisible;
        this.panelToplevel.style.display = panelsVisible ? '' : 'none';

        const bottomBarVisible = this.isVisible;
        this.bottomBar.setVisible(bottomBarVisible);
        this.bottomBar.setActive(this.shouldBottomBarBeFadeIn());

        const extraButtonsVisible = !this.isEmbedMode;
        this.cameraSpeedIndicator.setVisible(extraButtonsVisible);
        this.shareButton.setVisible(extraButtonsVisible);
    }

    public setEmbedMode(v: boolean): void {
        if (this.isEmbedMode === v)
            return;

        this.isEmbedMode = v;
        this.syncVisibilityState();
    }

    public toggleUI(v: boolean = !this.isVisible): void {
        if (this.isVisible === v)
            return;

        this.isVisible = v;
        this.syncVisibilityState();
    }

    public enableStudioMode(): void {
        // Switch to the FPS Camera Controller (so the UI shows the correct controller highlighted).
        this.viewerSettings.setCameraControllerIndex(0);
        this.studioPanel.initStudio();
        this.studioPanel.show();
        this.viewer.setCameraController(this.studioPanel.studioCameraController);
        this.studioModeEnabled = true;
    }

    public disableStudioMode(): void {
        this.studioModeEnabled = false;
        this.viewerSettings.setCameraControllerIndex(0);
        this.studioPanel.hide();
    }
}
