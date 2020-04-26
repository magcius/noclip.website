
// Debug Floater UI

import { objIsColor } from "./Color";
import { Slider, Widget, RENDER_HACKS_ICON, createDOMFromString, HIGHLIGHT_COLOR, setElementHighlighted } from "./ui";
import { GlobalGrabManager } from "./GrabManager";
import { assert } from "./util";

export class FloatingPanel implements Widget {
    public elem: HTMLElement;

    public customHeaderBackgroundColor: string = '';
    protected header: HTMLElement;
    protected headerContainer: HTMLElement;
    protected svgIcon: SVGSVGElement;

    private toplevel: HTMLElement;
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
        this.toplevel.style.alignItems = 'start';
        this.toplevel.style.outline = 'none';
        this.toplevel.style.minWidth = '300px';
        this.toplevel.style.position = 'absolute';
        this.toplevel.style.left = '82px';
        this.toplevel.style.top = '32px';
        this.toplevel.style.pointerEvents = 'auto';
        this.toplevel.tabIndex = -1;

        this.mainPanel = document.createElement('div');
        this.mainPanel.style.overflow = 'hidden';
        this.mainPanel.style.transition = '.25s ease-out';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.appendChild(this.mainPanel);

        this.headerContainer = document.createElement('div');
        this.mainPanel.appendChild(this.headerContainer);

        this.header = document.createElement('h1');
        this.header.style.lineHeight = '28px';
        this.header.style.margin = '0';
        this.header.style.fontSize = '100%';
        this.header.style.textAlign = 'center';
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.header.addEventListener('mousedown', (e) => {
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: false, useGrabbingCursor: true, releaseOnMouseUp: true });
        });

        this.headerContainer.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.maxHeight = '50vh';
        this.contents.style.overflow = 'auto';
        this.mainPanel.appendChild(this.contents);

        this.setWidth(400);

        this.elem = this.toplevel;

        this.elem.onmouseover = () => {
            this.elem.style.opacity = '1';
        };
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.2';
        };
        this.elem.style.opacity = '0.2';
    }

    public setWidth(v: number): void {
        this.header.style.width = `${v}px`;
        this.contents.style.width = `${v}px`;
    }

    public destroy(): void {
        this.toplevel.parentElement!.removeChild(this.toplevel);
    }

    public onMotion(dx: number, dy: number): void {
        this.toplevel.style.left = (parseFloat(this.toplevel.style.left!) + dx) + 'px';
        this.toplevel.style.top = (parseFloat(this.toplevel.style.top!) + dy) + 'px';
    }

    public onGrabReleased(): void {
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
        this.syncHeaderStyle();
    }

    protected syncHeaderStyle() {
        if (this.customHeaderBackgroundColor) {
            this.svgIcon.style.fill = '';
            this.header.style.backgroundColor = this.customHeaderBackgroundColor;
            this.header.style.color = 'white';
        } else {
            this.svgIcon.style.fill = 'black';
            setElementHighlighted(this.header, true, HIGHLIGHT_COLOR);
        }
    }
}

export class DebugFloaterHolder {
    private floatingPanels: FloatingPanel[] = [];
    public elem: HTMLElement;

    constructor() {
        this.elem = document.createElement('div');
    }

    public makeFloatingPanel(title: string = 'Floating Panel', icon: string = RENDER_HACKS_ICON): FloatingPanel {
        const panel = new FloatingPanel();
        panel.setWidth(600);
        panel.setTitle(icon, title);
        this.elem.appendChild(panel.elem);
        this.floatingPanels.push(panel);
        return panel;
    }

    public destroyScene(): void {
        for (let i = 0; i < this.floatingPanels.length; i++)
            this.floatingPanels[i].destroy();
        this.floatingPanels = [];
    }

    private debugFloater: FloatingPanel | null = null;
    private getDebugFloater(): FloatingPanel {
        if (this.debugFloater === null)
            this.debugFloater = this.makeFloatingPanel('Debug');
        return this.debugFloater;
    }

    public bindSlider(obj: { [k: string]: number }, panel: FloatingPanel, paramName: string, labelName: string, parentMetadata: any | null): void {
        let value = obj[paramName];
        assert(typeof value === "number");

        let min: number = 0, max: number = 1, step: number = 0.01;

        let range = Reflect.getMetadata('df:range', obj, paramName);
        if (range === undefined && parentMetadata !== null)
            range = parentMetadata.range;
        if (range !== undefined) {
            min = range.min;
            max = range.max;
            step = range.step;
        }

        const fracDig = Math.max(0, -Math.log10(step));
        const slider = new Slider();
        slider.onvalue = (newValue: number) => {
            obj[paramName] = newValue;
            update();
        };
        update();

        function update() {
            value = obj[paramName];
            slider.setLabel(`${labelName} = ${value.toFixed(fracDig)}`);
            const localMin = Math.min(value, min);
            const localMax = Math.max(value, max);

            // Automatically update if we don't have any declarative range values.
            if (range === undefined) {
                min = localMin;
                max = localMax;
            }

            slider.setRange(localMin, localMax, step);
            slider.setValue(value);
        }

        setInterval(() => {
            if (obj[paramName] !== value)
                update();
        }, 100);

        panel.contents.appendChild(slider.elem);
    }

    private bindSlidersRecurse(obj: { [k: string]: any }, panel: FloatingPanel, parentName: string, parentMetadata: any | null = null): void {
        // Children are by default invisible, unless we're in a color, or some sort of number array.
        const childDefaultVisible = objIsColor(obj) || (obj instanceof Array) || (obj instanceof Float32Array);

        const keys = Object.keys(obj);

        for (let i = 0; i < keys.length; i++) {
            const keyName = keys[i];
            if (!(childDefaultVisible || dfShouldShowOwn(obj, keyName)))
                continue;
            const v = obj[keyName];

            if (typeof v === "number")
                this.bindSlider(obj, panel, keyName, `${parentName}.${keyName}`, parentMetadata);

            this.bindSlidersRecurse(v, panel, `${parentName}.${keyName}`, {
                range: Reflect.getMetadata('df:range', obj, keyName),
            });
        }
    }

    public bindSliders(obj: { [k: string]: any }, panel: FloatingPanel | null = null): void {
        if (panel === null)
            panel = this.getDebugFloater();

        while (panel.contents.firstChild)
            panel.contents.removeChild(panel.contents.firstChild);

        this.bindSlidersRecurse(obj, panel, '');
    }
}

function dfShouldShowOwn(obj: any, keyName: string): boolean {
    const visibility = Reflect.getMetadata('df:visibility', obj, keyName);
    if (visibility === false)
        return false;

    // Look for a sign that the user wants to show it.
    if (visibility === true)
        return true;
    if (Reflect.hasMetadata('df:range', obj, keyName))
        return true;
    if (Reflect.hasMetadata('df:sigfigs', obj, keyName))
        return true;

    return false;
}

export function dfShow() {
    return Reflect.metadata('df:visibility', true);
}

export function dfHide() {
    return Reflect.metadata('df:visibility', false);
}

export function dfRange(min: number = 0, max: number = 1, step: number = (max - min) / 100) {
    return Reflect.metadata('df:range', { min, max, step });
}

export function dfSigFigs(v: number = 2) {
    return Reflect.metadata('df:sigfigs', v);
}
