
// New UI system

import * as Viewer from './viewer';
import { assertExists, assert } from './util';
import { CameraControllerClass, OrbitCameraController, FPSCameraController } from './Camera';
import { Color, colorToCSS } from './Color';
import { TextureHolder } from './TextureHolder';
import { GITHUB_REVISION_URL, GITHUB_URL, GIT_SHORT_REVISION } from './BuildVersion';
import { SaveManager, GlobalSaveManager, SaveStateLocation } from "./SaveManager";
import { RenderStatistics } from './RenderStatistics';
import InputManager from './InputManager';

// @ts-ignore
import logoURL from './logo.png';

export const HIGHLIGHT_COLOR = 'rgb(210, 30, 30)';
export const COOL_BLUE_COLOR = 'rgb(20, 105, 215)';

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
    extraHTML?: string;
    fontWeight?: string;
}

export interface Widget {
    elem: HTMLElement;
}

function svgStringToCSSBackgroundImage(svgString: string) {
    return `url(data:image/svg+xml,${encodeURI(svgString)})`;
}

class TextField implements Widget {
    public textarea: HTMLInputElement;
    public elem: HTMLElement;

    constructor() {
        this.textarea = document.createElement('input');
        this.textarea.style.color = 'white';
        this.textarea.style.backgroundColor = 'transparent';
        this.textarea.style.font = '16px monospace';
        this.textarea.style.border = 'none';
        this.textarea.style.width = '100%';
        (this.textarea.style as any).caretColor = 'white';

        this.elem = this.textarea;
    }

    public selectAll() {
        this.textarea.setSelectionRange(0, this.textarea.value.length);
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
    public ontext: (string: string) => void | null = null;

    protected toplevel: HTMLElement;
    public textfield: TextField;
    protected clearButton: HTMLElement;
    protected svgIcon: SVGSVGElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.position = 'relative';

        this.textfield = new TextField();
        const textarea = this.textfield.textarea;
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
            this.syncClearButtonVisible();
        };
        this.toplevel.appendChild(this.textfield.elem);

        this.clearButton = document.createElement('div');
        this.clearButton.textContent = '🗙';
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
    html: string;
}

interface ScrollSelectItemSelectable {
    type: ScrollSelectItemType.Selectable;
    visible?: boolean;
    name: string;
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
        this.scrollContainer.style.overflow = 'auto';
        this.scrollContainer.style.userSelect = 'none';
        this.scrollContainer.style.webkitUserSelect = 'none';
        this.toplevel.appendChild(this.scrollContainer);

        this.elem = this.toplevel;
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
                outer.style.paddingLeft = hasHeader ? '20px' : '';

                const selector = document.createElement('div');
                selector.classList.add('selector');
                selector.style.display = 'list-item';
                outer.appendChild(selector);
                const textSpan = document.createElement('span');
                textSpan.classList.add('text');
                textSpan.textContent = item.name;
                selector.appendChild(textSpan);

                const index = i;
                outer.onfocus = () => {
                    this.itemFocused(index, !this.isDragging);
                };
                outer.onmousedown = () => {
                    if (document.activeElement === outer)
                        outer.onfocus(null);
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
                textSpan.innerHTML = item.html;
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

            const selector = outer.querySelector('.selector') as HTMLElement;
            if (!selector)
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

function ensureFlairIndex(flairs: Flair[], index: number): Flair {
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

    public setItems(items: ScrollSelectItem[]): void {
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
            flair.color = 'black';
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
        this.emblem.style.borderRadius = '16px';
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
        this.toplevel.style.gridGap = '20px';
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
        this.header.onclick = () => {
            if (this.ignoreAutoCloseTimeout > 0) {
                this.ignoreAutoCloseTimeout = 0;
                return;
            }

            this.toggleExpanded();
        };
        this.mainPanel.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.width = '400px';
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
        this.svgIcon = createDOMFromString(icon).querySelector('svg');
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
            setElementHighlighted(this.header, this.expanded, HIGHLIGHT_COLOR);
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

    public setExpanded(v: boolean) {
        this.manuallyExpanded = v;
        this.syncExpanded();
        if (this.expanded)
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
            }, 1000);
        }
    }
}

const OPEN_ICON = `<svg viewBox="0 2 92 92" height="20" fill="white"><path d="M84.3765045,45.2316481 L77.2336539,75.2316205 L77.2336539,75.2316205 C77.1263996,75.6820886 76.7239081,76 76.2608477,76 L17.8061496,76 C17.2538649,76 16.8061496,75.5522847 16.8061496,75 C16.8061496,74.9118841 16.817796,74.8241548 16.8407862,74.739091 L24.7487983,45.4794461 C24.9845522,44.607157 25.7758952,44.0012839 26.6794815,44.0012642 L83.4036764,44.0000276 L83.4036764,44.0000276 C83.9559612,44.0000156 84.4036862,44.4477211 84.4036982,45.0000058 C84.4036999,45.0780163 84.3945733,45.155759 84.3765045,45.2316481 L84.3765045,45.2316481 Z M15,24 L26.8277004,24 L26.8277004,24 C27.0616369,24 27.2881698,24.0820162 27.4678848,24.2317787 L31.799078,27.8411064 L31.799078,27.8411064 C32.697653,28.5899189 33.8303175,29 35,29 L75,29 C75.5522847,29 76,29.4477153 76,30 L76,38 L76,38 C76,38.5522847 75.5522847,39 75,39 L25.3280454,39 L25.3280454,39 C23.0690391,39 21.0906235,40.5146929 20.5012284,42.6954549 L14.7844016,63.8477139 L14.7844016,63.8477139 C14.7267632,64.0609761 14.5071549,64.1871341 14.2938927,64.1294957 C14.1194254,64.0823423 13.9982484,63.9240598 13.9982563,63.7433327 L13.9999561,25 L14,25 C14.0000242,24.4477324 14.4477324,24.0000439 15,24.0000439 L15,24 Z"/></svg>`;
const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 26.25" height="20" fill="white"><path d="M8.6953,14.3916 C5.5543,14.3916 3.0003,11.8356 3.0003,8.6956 C3.0003,5.5546 5.5543,2.9996 8.6953,2.9996 C11.8363,2.9996 14.3913,5.5546 14.3913,8.6956 C14.3913,11.8356 11.8363,14.3916 8.6953,14.3916 L8.6953,14.3916 Z M15.8423,13.7216 L15.6073,13.9566 C16.7213,12.4956 17.3913,10.6756 17.3913,8.6956 C17.3913,3.8936 13.4983,-0.0004 8.6953,-0.0004 C3.8933,-0.0004 0.0003,3.8936 0.0003,8.6956 C0.0003,13.4976 3.8933,17.3916 8.6953,17.3916 C10.6753,17.3916 12.4953,16.7216 13.9573,15.6076 L13.7213,15.8426 L18.3343,20.4546 L20.4553,18.3336 L15.8423,13.7216 Z"/></svg>`;

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

class SceneSelect extends Panel {
    private sceneGroups: (string | Viewer.SceneGroup)[] = [];
    private sceneDescs: (string | Viewer.SceneDesc)[] = [];

    private searchEntry: TextEntry;
    private sceneGroupList: SingleSelect;
    private sceneDescList: SingleSelect;

    private selectedSceneGroup: Viewer.SceneGroup;
    private currentSceneGroup: Viewer.SceneGroup;
    private currentSceneDesc: Viewer.SceneDesc;
    private loadProgress: number;

    private currentSearchTokens: RegExp[] = [];

    public onscenedescselected: (sceneGroup: Viewer.SceneGroup, sceneDesc: Viewer.SceneDesc) => void;

    constructor(public viewer: Viewer.Viewer) {
        super();
        this.setTitle(OPEN_ICON, 'Games');

        this.searchEntry = new TextEntry();
        this.searchEntry.elem.style.background = 'rgba(0, 0, 0, 1.0)';
        this.searchEntry.setIcon(SEARCH_ICON);
        this.searchEntry.setPlaceholder('Search...');
        this.searchEntry.ontext = (searchString: string) => {
            this._setSearchString(searchString);
        };
        this.contents.appendChild(this.searchEntry.elem);

        this.sceneGroupList = new SingleSelect();
        this.sceneGroupList.setHeight('300px');
        this.contents.appendChild(this.sceneGroupList.elem);

        this.sceneDescList = new SingleSelect();
        this.sceneDescList.setHighlightFlair = false;
        this.sceneDescList.elem.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.sceneDescList.elem.style.width = '500px';
        this.sceneDescList.setHeight('372px');
        this.extraRack.appendChild(this.sceneDescList.elem);

        this.sceneGroupList.onselectionchange = (i: number) => {
            this.selectSceneGroup(i);
        };

        this.sceneDescList.onselectionchange = (i: number) => {
            this.selectSceneDesc(i);
        };
    }

    protected onKeyDown(e: KeyboardEvent): void {
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            this.sceneGroupList.elem.onkeydown(e);
        } else {
            const textarea = this.searchEntry.textfield.textarea;
            textarea.focus();
            textarea.onkeydown(e);
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

    private syncVisibility(): void {
        // Start searching!
        const n = this.currentSearchTokens;

        let lastDescHeaderVisible = false;
        function matchSceneDesc(item: (string | Viewer.SceneDesc)): boolean {
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

                explicitlyInvisible = item.sceneDescs.length <= 0;
                if (!explicitlyInvisible) {
                    // If header matches, then we are explicitly visible.
                    if (!visible == lastGroupHeaderVisible)
                        visible = true;

                    // If name matches, then we are explicitly visible.
                    if (!visible && matchRegExps(n, item.name))
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

    public setCurrentDesc(sceneGroup: Viewer.SceneGroup, sceneDesc: Viewer.SceneDesc) {
        this.selectedSceneGroup = sceneGroup;
        this.currentSceneGroup = sceneGroup;
        this.currentSceneDesc = sceneDesc;

        const index = this.sceneGroups.indexOf(this.currentSceneGroup);
        this.sceneGroupList.setHighlighted(index);

        this.syncSceneDescs();
    }

    public setSceneGroups(sceneGroups: (string | Viewer.SceneGroup)[]) {
        this.sceneGroups = sceneGroups;
        this.sceneGroupList.setItems(sceneGroups.map((g): ScrollSelectItem => {
            if (typeof g === 'string') {
                return { type: ScrollSelectItemType.Header, html: g };
            } else {
                return { type: ScrollSelectItemType.Selectable, name: g.name };
            }
        }));
        this.syncSceneDescs();
    }

    public setLoadProgress(pct: number) {
        this.loadProgress = pct;
        this.syncFlairs();
        this.syncHeaderStyle();
    }

    private selectSceneDesc(i: number) {
        this.onscenedescselected(this.selectedSceneGroup, this.sceneDescs[i] as Viewer.SceneDesc);
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
            flair.background = this.getLoadingGradient();
            flair.color = this.loadProgress > 0.5 ? 'black' : undefined;
            flair.fontWeight = 'bold';
            const pct = `${Math.round(this.loadProgress * 100)}%`;
            flair.extraHTML = this.loadProgress < 1.0 ? `<span style="font-weight: bold; color: #aaa">${pct}</span>` : ``;
        }
        this.sceneDescList.setFlairs(sceneDescFlairs);
    }

    private selectSceneGroup(i: number) {
        const sceneGroup = this.sceneGroups[i];
        this.selectedSceneGroup = sceneGroup as Viewer.SceneGroup;
        this.syncSceneDescs();
    }

    private syncSceneDescs() {
        if (this.selectedSceneGroup)
            this.setSceneDescs(this.selectedSceneGroup.sceneDescs);
        else
            this.setSceneDescs([]);
    }

    private setSceneDescs(sceneDescs: (string | Viewer.SceneDesc)[]) {
        this.sceneDescs = sceneDescs;
        this.sceneDescList.setItems(sceneDescs.map((g): ScrollSelectItem => {
            if (typeof g === 'string')
                return { type: ScrollSelectItemType.Header, html: g };
            else
                return { type: ScrollSelectItemType.Selectable, name: g.name };
        }));
        this.syncFlairs();
        this.syncVisibility();
    }
}

const SAVE_ICON = `<svg viewBox="-8 -8 116 116" height="20" fill="white"><path fill="none" d="M35.763,37.954l30.977-0.021c2.118-0.001,4.296-2.033,4.296-4.15l-0.017-24.37L31.642,9.442l0.016,24.368   C31.658,35.928,33.645,37.955,35.763,37.954z M56.121,13.159l8.078-0.004c1.334-0.003,2.41,1.076,2.413,2.407l0.011,16.227   c-0.001,1.331-1.078,2.412-2.409,2.412l-8.082,0.005c-1.329,0.003-2.408-1.077-2.41-2.408l-0.01-16.23   C53.71,14.24,54.788,13.159,56.121,13.159z"/><path fill="none" d="M76.351,49.009H23.647c-2.457,0-4.449,2.079-4.449,4.644v34.044h61.605V53.652   C80.802,51.088,78.81,49.009,76.351,49.009z"/><path d="M56.132,34.206l8.082-0.005c1.331,0,2.408-1.081,2.409-2.412l-0.011-16.227c-0.003-1.331-1.08-2.411-2.413-2.407   l-8.078,0.004c-1.333,0-2.411,1.081-2.41,2.409l0.01,16.23C53.724,33.129,54.803,34.208,56.132,34.206z"/><path d="M92.756,22.267c-0.002-1.555-0.376-2.831-1.378-3.83c-0.645-0.644-7.701-7.692-11.327-11.318   c-1.279-1.271-3.68-2.121-5.468-2.12c-1.789,0.001-60.258,0.04-60.258,0.04C10.387,5.044,7.198,8.236,7.2,12.172l0.051,75.703   c0.003,3.939,3.197,7.126,7.134,7.125l71.29-0.048c3.937-0.001,7.127-3.197,7.126-7.131C92.8,87.82,92.756,23.228,92.756,22.267z    M71.019,9.414l0.017,24.37c0,2.117-2.178,4.148-4.296,4.15l-30.977,0.021c-2.117,0.001-4.104-2.026-4.104-4.144L31.642,9.442   L71.019,9.414z M80.802,87.697H19.198V53.652c0-2.564,1.992-4.644,4.449-4.644h52.704c2.459,0,4.451,2.079,4.451,4.644V87.697z"/></svg>`;

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

export const enum SaveStatesAction { Load, LoadDefault, Save, Delete };

export class SaveStatesPanel extends Panel {
    public currentShareURLEntry: TextField;
    public currentSceneDescIdEntry: TextField;
    private currentSceneDescId: string;
    private stateButtonsHeader: HTMLElement;
    private stateButtons: HTMLElement[] = [];
    private defaultStateButtons: HTMLElement[] = [];

    public onsavestatesaction: (action: SaveStatesAction, key: string) => void;

    constructor(private inputManager: InputManager) {
        super();

        this.setTitle(SAVE_ICON, 'Save States and Sharing');

        GlobalSaveManager.addSaveStateListener(this._onSaveStateChanged.bind(this));
        this.inputManager.addListener(this._onKeyEvent.bind(this));

        this.stateButtonsHeader = document.createElement('div');
        this.stateButtonsHeader.style.fontWeight = 'bold';
        this.contents.appendChild(this.stateButtonsHeader);

        const stateButtons = document.createElement('div');
        stateButtons.style.display = 'grid';
        stateButtons.style.gridAutoFlow = 'column';
        stateButtons.style.gridGap = '8px';
        for (let i = 1; i <= 9; i++) {
            const button = document.createElement('div');
            button.textContent = '' + i;
            button.style.textAlign = 'center';
            button.style.lineHeight = '1.2em';
            button.style.userSelect = 'none';
            this.stateButtons.push(button);
            stateButtons.appendChild(button);
        }
        this.contents.appendChild(stateButtons);

        const defaultStateButtonsHeader = document.createElement('div');
        defaultStateButtonsHeader.textContent = 'Load Default Save State';
        defaultStateButtonsHeader.style.fontWeight = 'bold';
        defaultStateButtonsHeader.style.marginTop = '1em';
        this.contents.appendChild(defaultStateButtonsHeader);

        const defaultStateButtons = document.createElement('div');
        defaultStateButtons.style.display = 'grid';
        defaultStateButtons.style.gridAutoFlow = 'column';
        defaultStateButtons.style.gridGap = '8px';
        for (let i = 1; i <= 9; i++) {
            const button = document.createElement('div');
            button.textContent = '' + i;
            button.style.textAlign = 'center';
            button.style.lineHeight = '1.2em';
            button.style.userSelect = 'none';
            this.defaultStateButtons.push(button);
            defaultStateButtons.appendChild(button);
        }
        this.contents.appendChild(defaultStateButtons);

        const shareURLHeader = document.createElement('div');
        shareURLHeader.textContent = 'Share URL';
        shareURLHeader.style.fontWeight = 'bold';
        shareURLHeader.style.marginTop = '1em';
        this.contents.appendChild(shareURLHeader);

        this.currentShareURLEntry = new TextField();
        this.currentShareURLEntry.textarea.readOnly = true;
        this.currentShareURLEntry.textarea.onfocus = () => {
            this.currentShareURLEntry.selectAll();
        };
        this.contents.appendChild(this.currentShareURLEntry.elem);

        const sceneDescIdHeader = document.createElement('div');
        sceneDescIdHeader.textContent = 'Internal Scene ID';
        sceneDescIdHeader.style.fontWeight = 'bold';
        sceneDescIdHeader.style.marginTop = '1em';
        this.contents.appendChild(sceneDescIdHeader);

        this.currentSceneDescIdEntry = new TextField();
        this.currentSceneDescIdEntry.textarea.readOnly = true;
        this.currentSceneDescIdEntry.textarea.onfocus = () => {
            this.currentSceneDescIdEntry.selectAll();
        };
        this.contents.appendChild(this.currentSceneDescIdEntry.elem);

        const helpText = document.createElement('div');
        helpText.style.marginTop = '1em';
        helpText.innerHTML = `
Hold <b>Shift</b> to save new save states<br>
Hold <b>Alt</b> to delete saves you made<br>
Use <b>&lt;Num&gt;</b> on keyboard for quick access
`.trim();
        this.contents.appendChild(helpText);
    }

    public pickSaveStatesAction(inputManager: InputManager): SaveStatesAction {
        if (inputManager.isKeyDown('ShiftLeft'))
            return SaveStatesAction.Save;
        else if (inputManager.isKeyDown('AltLeft'))
            return SaveStatesAction.Delete;
        else
            return SaveStatesAction.Load;
    }

    private initLoadStateButton(button: HTMLElement, action: SaveStatesAction, saveManager: SaveManager, key: string): void {
        let active = false;
        if (action !== SaveStatesAction.LoadDefault && saveManager.hasStateInLocation(key, SaveStateLocation.LocalStorage)) {
            button.style.backgroundColor = COOL_BLUE_COLOR;
            button.style.fontWeight = 'bold';
            button.style.color = '';
            active = true;
        } else if (action === SaveStatesAction.LoadDefault && saveManager.hasStateInLocation(key, SaveStateLocation.Defaults)) {
            button.style.backgroundColor = '#8fa88f';
            button.style.fontWeight = 'bold';
            button.style.color = '';
            active = true;
        } else if (action === SaveStatesAction.Save) {
            button.style.backgroundColor = '#666';
            button.style.fontWeight = 'bold';
            button.style.color = 'white';
            active = true;
        } else {
            button.style.backgroundColor = '#333';
            button.style.fontWeight = '';
            button.style.color = '#aaa';
        }

        if (active) {
            button.style.cursor = 'pointer';
            button.onclick = () => {
                this.onsavestatesaction(action, key);
            };
        } else {
            button.style.cursor = 'default';
            button.onclick = null;
        }
    }

    private initButtons(saveManager: SaveManager): void {
        const sceneDescId = this.currentSceneDescId;
        const action = this.pickSaveStatesAction(this.inputManager);

        if (action === SaveStatesAction.Load)
            this.stateButtonsHeader.textContent = `Load Save State`;
        else if (action === SaveStatesAction.Save)
            this.stateButtonsHeader.textContent = `Save Save State`;
        else if (action === SaveStatesAction.Delete)
            this.stateButtonsHeader.textContent = `Delete Save State`;

        for (let i = 0; i < this.stateButtons.length; i++) {
            const key = saveManager.getSaveStateSlotKey(sceneDescId, i + 1);
            this.initLoadStateButton(this.stateButtons[i], action, saveManager, key);
            this.initLoadStateButton(this.defaultStateButtons[i], SaveStatesAction.LoadDefault, saveManager, key);
        }
    }

    private _onSaveStateChanged(saveManager: SaveManager): void {
        this.initButtons(saveManager);
    }

    private _onKeyEvent(): void {
        this.initButtons(GlobalSaveManager);
    }

    public expandAndFocus(): void {
        this.setExpanded(true);
        this.setAutoClosed(false);
        this.currentShareURLEntry.textarea.focus({ preventScroll: true });
    }

    public setCurrentSceneDescId(sceneDescId: string): void {
        this.currentSceneDescId = sceneDescId;
        this.currentSceneDescIdEntry.setValue(sceneDescId);
        this.initButtons(GlobalSaveManager);
    }

    public setSaveState(saveState: string) {
        this.currentShareURLEntry.setValue(buildShareURL(saveState));
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
    private fovSlider: HTMLInputElement;
    private cameraControllerWASD: HTMLElement;
    private cameraControllerOrbit: HTMLElement;
    private invertCheckbox: Checkbox;

    constructor(private viewer: Viewer.Viewer) {
        super();

        this.setTitle(FRUSTUM_ICON, 'Viewer Settings');

        // TODO(jstpierre): make css not leak
        this.contents.innerHTML = `
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
    background: #444;
}
.Slider::-webkit-slider-runnable-track {
    cursor: pointer;
    background: #444;
}
.Slider::-moz-range-progress, .Slider::-webkit-slider-thumb {
    cursor: pointer;
    background: #aaa;
}
.SettingsHeader, .SettingsButton {
    font-weight: bold;
}
.SettingsButton {
    background: #444;
    text-align: center;
    line-height: 24px;
    cursor: pointer;
}
</style>

<div style="display: grid; grid-template-columns: 1fr 1fr; align-items: center;">
<div class="SettingsHeader">Field of View</div>
<input class="Slider FoVSlider" type="range" min="1" max="100">
</div>

<div style="display: grid; grid-template-columns: 2fr 1fr 1fr; align-items: center;">
<div class="SettingsHeader">Camera Controller</div>
<div class="SettingsButton CameraControllerWASD">WASD</div><div class="SettingsButton CameraControllerOrbit">Orbit</div>
</div>
`;
        this.contents.style.lineHeight = '36px';

        this.fovSlider = this.contents.querySelector('.FoVSlider');
        this.fovSlider.oninput = this.onFovSliderChange.bind(this);
        this.fovSlider.value = '25';

        this.cameraControllerWASD = this.contents.querySelector('.CameraControllerWASD');
        this.cameraControllerWASD.onclick = () => {
            this.setCameraControllerClass(FPSCameraController);
        };

        this.cameraControllerOrbit = this.contents.querySelector('.CameraControllerOrbit');
        this.cameraControllerOrbit.onclick = () => {
            this.setCameraControllerClass(OrbitCameraController);
        };

        this.invertCheckbox = new Checkbox('Invert Y Axis?');
        this.invertCheckbox.onchanged = () => { this.setInvertY(this.invertCheckbox.checked); };
        this.contents.appendChild(this.invertCheckbox.elem);
        GlobalSaveManager.addSettingListener('InvertY', this.invertYChanged.bind(this));
    }

    private _getSliderT(slider: HTMLInputElement) {
        return (+slider.value - +slider.min) / (+slider.max - +slider.min);
    }

    private onFovSliderChange(e: UIEvent): void {
        const slider = (<HTMLInputElement> e.target);
        const value = this._getSliderT(slider);
        this.viewer.fovY = value * (Math.PI * 0.995);
    }

    private setCameraControllerClass(cameraControllerClass: CameraControllerClass) {
        this.viewer.setCameraController(new cameraControllerClass());
        this.cameraControllerSelected(cameraControllerClass);
    }

    public cameraControllerSelected(cameraControllerClass: CameraControllerClass) {
        setElementHighlighted(this.cameraControllerWASD, cameraControllerClass === FPSCameraController);
        setElementHighlighted(this.cameraControllerOrbit, cameraControllerClass === OrbitCameraController);
    }

    public setInvertY(v: boolean): void {
        GlobalSaveManager.saveSetting(`InvertY`, v);
    }

    private invertYChanged(saveManager: SaveManager, key: string): void {
        const invertY = saveManager.loadSetting<boolean>(key, false);
        this.invertCheckbox.setChecked(invertY);
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

    constructor(private viewer: Viewer.Viewer) {
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
        if (renderStatistics.triangleCount)
            this.fpsGraph.drawText(`Drawn Triangles: ${renderStatistics.triangleCount}`);
        if (renderStatistics.textureBindCount)
            this.fpsGraph.drawText(`Texture Binds: ${renderStatistics.textureBindCount}`);
        if (renderStatistics.bufferUploadCount)
            this.fpsGraph.drawText(`Buffer Uploads: ${renderStatistics.bufferUploadCount}`);

        const camPositionX = this.viewer.camera.worldMatrix[12].toFixed(2);
        const camPositionY = this.viewer.camera.worldMatrix[13].toFixed(2);
        const camPositionZ = this.viewer.camera.worldMatrix[14].toFixed(2);
        this.fpsGraph.drawText(`Camera Position: ${camPositionX} ${camPositionY} ${camPositionZ}`);
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
    margin: 0px;
    font-size: 2em;
}
#About h2 span, #About h2 img {
    vertical-align: middle;
    line-height: 64px;
}
#About .BuildVersion a {
    color: #666;
    font-size: smaller;
}
</style>

<h2> <img src="${logoURL}"> <span> noclip.website </span> </h2>

<p> <strong>CLICK AND DRAG</strong> to look around and use <strong>WASD</strong> to move the camera </p>
<p> Hold <strong>SHIFT</strong> to go faster, and use <strong>MOUSE WHEEL</strong> to go faster than that.
<strong>B</strong> resets the camera, and <strong>Z</strong> toggles the UI. </p>

<p><strong>CODE PRIMARILY WRITTEN</strong> by <a href="https://twitter.com/JasperRLZ">Jasper</a></p>

<p><strong>OPEN SOURCE</strong> at <a href="${GITHUB_URL}">GitHub</a></p>

<p>Feature requests and bugs welcome!</p>

<p>
<strong>BASED ON WORK</strong> by
<a href="https://twitter.com/beholdnec">N.E.C.</a>,
<a href="https://twitter.com/JuPaHe64">JuPaHe64</a>,
<a href="https://twitter.com/Jawchewa">Jawchewa</a>,
<a href="https://twitter.com/PistonMiner">PistonMiner</a>,
<a href="https://twitter.com/Starschulz">Starschulz</a>,
<a href="https://twitter.com/LordNed">LordNed</a>,
<a href="https://twitter.com/SageOfMirrors">SageOfMirrors</a>,
<a href="https://github.com/blank63">blank63</a>,
<a href="https://twitter.com/StapleButter">StapleButter</a>,
<a href="https://twitter.com/xdanieldzd">xdanieldzd</a>,
<a href="https://github.com/vlad001">vlad001</a>,
<a href="https://twitter.com/Jewelots_">Jewel</a>,
<a href="https://twitter.com/instant_grat">Instant Grat</a>,
<a href="https://twitter.com/pupperuki">Aruki</a>
</p>

<p><strong>MODELS</strong> © Nintendo, SEGA, Retro Studios, FROM Software, Konami, Neversoft, Double Fine Productions</p>

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
<li> Search <span>by</span> Alain W.
<li> Save <span>by</span> Prime Icons
<li> Overlap <span>by</span> Zach Bogart
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
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
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
    public saveStatesPanel: SaveStatesPanel;
    public textureViewer: TextureViewer;
    public viewerSettings: ViewerSettings;
    public statisticsPanel: StatisticsPanel;
    public panels: Panel[];
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
            this.setPanelsAutoClosed(false);
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
        this.saveStatesPanel = new SaveStatesPanel(viewer.inputManager);
        this.textureViewer = new TextureViewer();
        this.viewerSettings = new ViewerSettings(viewer);
        this.statisticsPanel = new StatisticsPanel(viewer);
        this.about = new About();

        this.setScenePanels([]);

        this.elem = this.toplevel;
    }

    public sceneChanged() {
        const cameraControllerClass = this.viewer.cameraController.constructor as CameraControllerClass;
        this.viewerSettings.cameraControllerSelected(cameraControllerClass);

        // Textures
        if (this.viewer.scene !== null) {
            const scene = this.viewer.scene;
            if (scene.textureHolder !== undefined)
                this.textureViewer.setTextureHolder(scene.textureHolder);
            else
                this.textureViewer.setTextureList([]);
        }
    }

    private setPanels(panels: Panel[]): void {
        this.panels = panels;
        setChildren(this.panelContainer, panels.map((panel) => panel.elem));
    }

    public setScenePanels(panels: Panel[]): void {
        this.setPanels([this.sceneSelect, ...panels, this.textureViewer, this.saveStatesPanel, this.viewerSettings, this.statisticsPanel, this.about]);
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

    public setIsDragging(isDragging: boolean): void {
        this.elem.style.pointerEvents = isDragging ? 'none' : '';
        if (isDragging && this.shouldPanelsAutoClose())
            this.setPanelsAutoClosed(true);
    }
}
