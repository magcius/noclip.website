
// Debug Floater UI

import { objIsColor } from "./Color";
import { Slider, Widget, RENDER_HACKS_ICON, createDOMFromString, HIGHLIGHT_COLOR, setElementHighlighted, Checkbox } from "./ui";
import { GlobalGrabManager } from "./GrabManager";
import { arrayRemove, assert, nullify } from "./util";
import { invlerp, lerp } from "./MathHelpers";
import { IS_DEVELOPMENT } from "./BuildVersion";
import "reflect-metadata";

interface Range {
    min: number;
    max: number;
    step: number;
}

interface ParentMetadata {
    range: Range | undefined;
    usepercent: boolean | undefined;
    sigfigs: number | undefined;
}

function getParentMetadata(target: any, key: string): ParentMetadata {
    return {
        range: Reflect.getMetadata('df:range', target, key),
        usepercent: Reflect.getMetadata('df:usepercent', target, key),
        sigfigs: Reflect.getMetadata('df:sigfigs', target, key),
    };
}

type RecursePropertiesCallback = (obj: { [k: string]: any }, paramName: string, labelName: string, parentMetadata: ParentMetadata | null) => boolean;
function recurseBindProperties(cb: RecursePropertiesCallback, obj: { [k: string]: any }, parentName: string = '', parentMetadata: ParentMetadata | null = null): void {
    for (const keyName in obj) {
        let labelName = Reflect.getMetadata(`df:label`, obj, keyName);
        if (labelName === undefined)
            labelName = `${parentName}.${keyName}`;

        if (!cb(obj, keyName, labelName, parentMetadata))
            continue;
        if (typeof obj[keyName] === 'object' && !!obj[keyName])
            recurseBindProperties(cb, obj[keyName], labelName, getParentMetadata(obj, keyName));
    }
}

class FloaterControlHandlerValue {
    public min = 0.0;
    public max = 1.0;
    public step = 0.01;

    public isMidiListenerBound = false;

    private explicitRange = false;
    private updateInterval: number;
    private lastValue: number | null = null;

    public onismidilistenerboundchanged: (() => void) | null = null;
    public onupdate: ((value: number, min: number, max: number) => void) | null = null;
    public midiListener: MIDIControlListenerValue;

    constructor(private obj: { [k: string]: number }, private paramName: string, parentMetadata: ParentMetadata | null = null) {
        let range = Reflect.getMetadata('df:range', obj, paramName);
        if (range === undefined && parentMetadata !== null)
            range = parentMetadata.range;

        if (range !== undefined) {
            this.min = range.min;
            this.max = range.max;
            this.step = range.step;
            this.explicitRange = true;
        }

        this.midiListener = {
            onbind: (v: number) => {
                this.isMidiListenerBound = true;
                if (this.onismidilistenerboundchanged !== null)
                    this.onismidilistenerboundchanged();
            },
            onunbind: () => {
                this.isMidiListenerBound = false;
                if (this.onismidilistenerboundchanged !== null)
                    this.onismidilistenerboundchanged();
            },
            onvalue: (v: number) => {
                const newValue = lerp(this.min, this.max, v);
                this.setValue(newValue);
            },
        };

        this.updateInterval = setInterval(() => {
            if (this.obj[this.paramName] !== this.lastValue)
                this.update();
        }, 10);
    }

    public setValue(value: number): void {
        this.obj[this.paramName] = value;
        this.update();
    }

    public update(): void {
        const value = this.obj[this.paramName];
        this.lastValue = value;

        const localMin = Math.min(value, this.min);
        const localMax = Math.max(value, this.max);

        // Automatically update if we don't have any declarative range values.
        if (!this.explicitRange) {
            this.min = localMin;
            this.max = localMax;
        }

        if (this.onupdate !== null)
            this.onupdate(value, localMin, localMax);
    }
}

export class FloatingPanel implements Widget {
    public elem: HTMLElement;
    public onclose: (() => void) | null = null;

    public customHeaderBackgroundColor: string = '';
    protected header: HTMLElement;
    protected headerContainer: HTMLElement;
    protected svgIcon: SVGSVGElement;
    protected minimizeButton: HTMLElement;
    protected minimized = false;

    private toplevel: HTMLElement;
    public mainPanel: HTMLElement;
    public contents: HTMLElement;
    public closeButton: HTMLElement;

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
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr 28px';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.header.onmousedown = (e) => {
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: false, useGrabbingCursor: true, releaseOnMouseUp: true });
        };
        this.header.ondblclick = (e) => {
            this.close();
        }

        this.minimizeButton = document.createElement('div');
        this.minimizeButton.textContent = '_';
        this.minimizeButton.title = 'Minimize';
        this.minimizeButton.style.gridColumn = '3';
        this.minimizeButton.style.lineHeight = '28px';
        this.minimizeButton.style.margin = '0';
        this.minimizeButton.style.padding = '0 4px';
        this.minimizeButton.style.fontSize = '100%';
        this.minimizeButton.style.cursor = 'pointer';
        this.minimizeButton.style.userSelect = 'none';
        this.minimizeButton.onclick = (e: MouseEvent) => {
            this.setMinimized(!this.minimized);
        };
        this.minimizeButton.ondblclick = (e: MouseEvent) => {
            e.stopPropagation();
        };

        this.closeButton = document.createElement('div');
        this.closeButton.textContent = 'X';
        this.closeButton.title = 'Close';
        this.closeButton.style.gridColumn = '4';
        this.closeButton.style.lineHeight = '28px';
        this.closeButton.style.margin = '0';
        this.closeButton.style.padding = '0 4px';
        this.closeButton.style.fontSize = '100%';
        this.closeButton.style.cursor = 'pointer';
        this.closeButton.style.userSelect = 'none';
        this.closeButton.onclick = () => {
            this.close();
        };

        this.headerContainer.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.maxHeight = '50vh';
        this.contents.style.overflow = 'auto';
        this.mainPanel.appendChild(this.contents);

        this.setWidth(`400px`);

        this.elem = this.toplevel;
    }

    public setWidth(v: string): void {
        this.header.style.width = v;
        this.contents.style.width = v;
    }

    public close(): void {
        if (this.toplevel.parentElement !== null)
            this.toplevel.parentElement.removeChild(this.toplevel);
        if (this.onclose)
            this.onclose();
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

    public setMinimized(v: boolean) {
        if (this.minimized === v)
            return;
        this.minimized = v;
        this.contents.style.height = this.minimized ? '0px' : '';
    }

    public setTitle(icon: string, title: string) {
        this.svgIcon = createDOMFromString(icon).querySelector('svg')!;
        this.svgIcon.style.gridColumn = '1';
        this.header.textContent = title;
        this.header.appendChild(this.svgIcon);
        this.header.appendChild(this.minimizeButton);
        this.header.appendChild(this.closeButton);
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

    public bindCheckbox(labelName: string, obj: any, paramName: string): void {
        let value = obj[paramName];
        assert(typeof value === "boolean");

        let labelNameMetadata = Reflect.getMetadata('df:label', obj, paramName);
        if (labelNameMetadata !== undefined)
            labelName = labelNameMetadata;

        const cb = new Checkbox(labelName, value);
        cb.onchanged = () => {
            obj[paramName] = cb.checked;
            update();
        };

        function update(): void {
            cb.setChecked(obj[paramName]);
        }

        setInterval(() => {
            if (obj[paramName] !== value)
                update();
        }, 100);

        this.contents.appendChild(cb.elem);
    }

    public bindButton(labelName: string, obj: any, paramName: string): void {
        let value = obj[paramName];
        assert(typeof value === "function");

        let labelNameMetadata = Reflect.getMetadata('df:label', obj, paramName);
        if (labelNameMetadata !== undefined)
            labelName = labelNameMetadata;

        const button = document.createElement('div');
        button.style.fontWeight = `bold`;
        button.style.textAlign = `center`;
        button.style.lineHeight = `24px`;
        button.style.cursor = `pointer`;
        button.textContent = labelName;
        button.onclick = () => {
            value.call(obj);
        };

        this.contents.appendChild(button);
    }

    public bindSlider(labelName: string, obj: any, paramName: string, parentMetadata: ParentMetadata | null = null, midiControls: GlobalMIDIControls | null = null): void {
        let value = obj[paramName];
        assert(typeof value === "number");

        const handler = new FloaterControlHandlerValue(obj, paramName, parentMetadata);
        handler.onupdate = (value: number, min: number, max: number) => {
            slider.setRange(min, max, handler.step);
            slider.setValue(value);

            const fracDig = Math.max(0, -Math.log10(handler.step));
            let valueStr: string;
            if (usePercent) {
                valueStr = `${(invlerp(handler.min, handler.max, value) * 100).toFixed(0)}%`;
            } else {
                valueStr = value.toFixed(fracDig);
            }
    
            slider.setLabel(`${labelName} = ${valueStr}`);

            let changedCallback = Reflect.getMetadata('df:changedcallback', obj, paramName);
            if (changedCallback)
                changedCallback.call(obj);
        };

        let usePercent = Reflect.getMetadata('df:usepercent', obj, paramName);
        if (usePercent === undefined && parentMetadata !== null)
            usePercent = parentMetadata.usepercent;
        usePercent = !!usePercent;

        let labelNameMetadata = Reflect.getMetadata('df:label', obj, paramName);
        if (labelNameMetadata !== undefined)
            labelName = labelNameMetadata;

        let sigfigs = Reflect.getMetadata('df:sigfigs', obj, paramName);
        if (sigfigs === undefined && parentMetadata !== null)
            sigfigs = parentMetadata.sigfigs;
        if (sigfigs === undefined)
            sigfigs = -Math.log10(handler.step);
        const slider = new Slider();

        let midiBindButton: HTMLElement | null = null;

        if (midiControls !== null && midiControls.isInitialized()) {
            const sliderDiv = slider.elem.querySelector('div')!;
            sliderDiv.style.gridTemplateColumns = '48px 1fr 1fr';

            let bindState: ('unbound' | 'binding' | 'bound') = 'unbound';

            const syncColor = (): void => {
                if (bindState === 'unbound')
                    midiBindButton!.style.color = 'white';
                else if (bindState === 'binding')
                    midiBindButton!.style.color = 'cyan';
                else if (bindState === 'bound')
                    midiBindButton!.style.color = HIGHLIGHT_COLOR;
            };
            handler.onismidilistenerboundchanged = () => {
                bindState = handler.isMidiListenerBound ? 'bound' : 'unbound';
                syncColor();
            };

            midiBindButton = document.createElement('span');
            midiBindButton.textContent = 'B';
            midiBindButton.style.color = 'white';
            midiBindButton.style.margin = '0 1em';
            midiBindButton.style.userSelect = 'none';
            midiBindButton.style.cursor = 'pointer';
            midiBindButton.style.fontWeight = 'bold';
            midiBindButton.onclick = () => {
                if (bindState === 'unbound') {
                    bindState = 'binding';
                    syncColor();
                    midiControls.setNextBindListener(handler.midiListener);
                } else if (bindState === 'binding') {
                    bindState = 'unbound';
                    syncColor();
                    midiControls.setNextBindListener(null);
                } else if (bindState === 'bound') {
                    bindState = 'unbound';
                    syncColor();
                    handler.midiListener.unbind!();
                }
            };

            sliderDiv.insertBefore(midiBindButton, sliderDiv.firstElementChild);
        }

        slider.onvalue = (value: number): void => {
            handler.setValue(value);
        };

        this.contents.appendChild(slider.elem);
    }

    public bindSliderChain(labelName: string, target: any, ...args: string[]): void {
        // Ugly helper that recurses through the chain, accumulating metadata along the way.

        let parentMetadata: any | null = null;
        for (let i = 0; i < args.length - 1; i++) {
            parentMetadata = getParentMetadata(target, args[i]);
            target = target[args[i]];
        }

        this.bindSlider(labelName, target, args[args.length - 1], parentMetadata);
    }
}

export class DebugFloaterHolder {
    private floatingPanels: FloatingPanel[] = [];
    private debugFloater: FloatingPanel | null = null;
    public elem: HTMLElement;
    public midiControls = new GlobalMIDIControls();

    constructor() {
        this.elem = document.createElement('div');

        if (IS_DEVELOPMENT)
            this.midiControls.init();
    }

    public makeFloatingPanel(title: string = 'Floating Panel', icon: string = RENDER_HACKS_ICON): FloatingPanel {
        const panel = new FloatingPanel();
        panel.setWidth(`600px`);
        panel.setTitle(icon, title);
        panel.onclose = () => {
            if (this.debugFloater === panel)
                this.debugFloater = null;
        };
        this.elem.appendChild(panel.elem);
        this.floatingPanels.push(panel);
        return panel;
    }

    private getDebugFloater(): FloatingPanel {
        if (this.debugFloater === null)
            this.debugFloater = this.makeFloatingPanel('Debug');
        return this.debugFloater;
    }

    public destroyScene(): void {
        for (let i = 0; i < this.floatingPanels.length; i++)
            this.floatingPanels[i].close();
        this.floatingPanels = [];
        this.debugFloater = null;
    }

    public bindPanel(obj: { [k: string]: any }, panel_: FloatingPanel | null = null): void {
        let panel = panel_!;
        if (panel === null)
            panel = this.getDebugFloater();

        while (panel.contents.firstChild)
            panel.contents.removeChild(panel.contents.firstChild);

        recurseBindProperties((obj, keyName, labelName, parentMetadata) => {
            // Children are by default invisible, unless we're in a color, or some sort of number array.
            const childDefaultVisible = objIsColor(obj) || (obj instanceof Array) || (obj instanceof Float32Array);

            if (!(childDefaultVisible || dfShouldShowOwn(obj, keyName)))
                return false;

            const v = obj[keyName];

            if (typeof v === "number")
                panel.bindSlider(labelName, obj, keyName, parentMetadata, this.midiControls);
            else if (typeof v === "boolean")
                panel.bindCheckbox(labelName, obj, keyName);
            else if (typeof v === "function")
                panel.bindButton(labelName, obj, keyName);

            return true;
        }, obj);

        recurseAllPrototypeFunctions((proto, keyName) => {
            if (!dfShouldShowOwn(obj, keyName) && !dfShouldShowOwn(proto, keyName))
                return;

            panel.bindButton(keyName, obj, keyName);
        }, obj);
    }
}

function dfShouldShowOwn(obj: any, keyName: string): boolean {
    return Reflect.getMetadata('df:visibility', obj, keyName);
}

interface MIDIControlListenerValue {
    onvalue: ((v: number) => void) | null;
    onbind?: ((v: number) => void);
    onunbind?: (() => void);
    unbind?(): void;
}

class BoundMIDIControlValue {
    public value: number = -1;
    public listener: MIDIControlListenerValue | null = null;

    constructor(public channel: number, public controlNumber: number) {
    }

    public bindListener(v: MIDIControlListenerValue | null): void {
        if (this.listener !== null)
            this.listener.unbind = undefined;
        if (this.listener !== null && this.listener.onunbind !== undefined)
            this.listener.onunbind();
        this.listener = v;
        if (this.listener !== null)
            this.listener.unbind = () => this.bindListener(null);
        if (this.listener !== null && this.listener.onbind !== undefined)
            this.listener.onbind(this.value);
    }

    public setValue(v: number): void {
        if (this.listener !== null && this.listener.onvalue !== null)
            this.listener.onvalue(v);
    }
}

interface MIDIControlListenerButton {
    ondown: () => void;
    onup?: () => void;
}

class BoundMIDIControlButton {
    public value: number = -1;
    public listener: MIDIControlListenerButton | null = null;

    constructor(public channel: number, public controlNumber: number) {
    }

    public bindListener(v: MIDIControlListenerButton | null): void {
        this.listener = v;
    }

    public setValue(v: number): void {
        if (this.listener !== null && v >= 1.0)
            this.listener.ondown();
        else if (this.listener !== null && this.listener.onup !== undefined)
            this.listener.onup();
    }
}

interface MidiMetadata {
    kind: 'knob' | 'slider' | 'button';
    index: number;
    channel: number;
    callback?: boolean;
}

function recurseAllPrototypeFunctions(cb: (proto: any, keyName: string) => void, obj: any): void {
    if (obj === null)
        return;
    const props = Object.getOwnPropertyNames(obj);
    for (const keyName of props) {
        const desc = Object.getOwnPropertyDescriptor(obj, keyName);
        if (desc === undefined)
            continue;
        if (desc.value === undefined || typeof desc.value !== 'function')
            continue;
        cb(obj, keyName);
    }
    recurseAllPrototypeFunctions(cb, Object.getPrototypeOf(obj));
}

class MIDIDevice {
    private boundControls: BoundMIDIControl[] = [];
    public oncontrolmessage: ((device: MIDIDevice, boundControl: BoundMIDIControl | null, channel: number, controlNumber: number, value: number | null) => void) | null = null;

    constructor(public midiInput: WebMidi.MIDIInput) {
        this.midiInput.onmidimessage = this.onMessage;
    }

    private onMessage = (e: WebMidi.MIDIMessageEvent): void => {
        const messageType = e.data[0];

        if (messageType >= 0xB0 && messageType <= 0xBF && this.oncontrolmessage !== null) {
            // Control change message
            const channel = e.data[0] & 0x0F, controlNumber = e.data[1], value = e.data[2];

            let boundControl = nullify(this.boundControls.find((control) => control.channel === channel && control.controlNumber === controlNumber));
            this.oncontrolmessage(this, boundControl, channel, controlNumber, value);

            // Caller could have created a new bound control, so re-look in our map.
            boundControl = nullify(this.boundControls.find((control) => control.channel === channel && control.controlNumber === controlNumber));
            const normalizedValue = value !== null ? invlerp(0, 127, value) : null;
            if (boundControl !== null && normalizedValue !== null)
                boundControl.setValue(normalizedValue);
        }
    };

    public bindValueListener(channel: number, controlNumber: number, listener: MIDIControlListenerValue): BoundMIDIControlValue {
        const control = new BoundMIDIControlValue(channel, controlNumber);
        control.bindListener(listener);
        this.boundControls.push(control);
        return control;
    }

    public bindButtonListener(channel: number, controlNumber: number, listener: MIDIControlListenerButton): BoundMIDIControlButton {
        const control = new BoundMIDIControlButton(channel, controlNumber);
        control.bindListener(listener);
        this.boundControls.push(control);
        return control;
    }

    public clearBinds(): void {
        for (let i = 0; i < this.boundControls.length; i++)
            this.boundControls[i].bindListener(null);
    }
}

type BoundMIDIControl = BoundMIDIControlValue | BoundMIDIControlButton;
class GlobalMIDIControls {
    private midiAccess: WebMidi.MIDIAccess | null = null;
    private devices: MIDIDevice[] = [];

    public async init() {
        if (navigator.requestMIDIAccess === undefined)
            return;

        this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        this.midiAccess.onstatechange = () => {
            this.scanDevices();
        }
        this.scanDevices();
    }

    public isInitialized(): boolean {
        return this.midiAccess !== null;
    }

    private scanDevices(): void {
        const inputs = [...this.midiAccess!.inputs.values()];
        for (const input of inputs) {
            let device = this.devices.find((device) => device.midiInput === input);
            if (device === undefined) {
                device = new MIDIDevice(input);
                device.oncontrolmessage = this.onControlMessage;
                this.devices.push(device);
            }
        }
    }

    private nextListener: MIDIControlListenerValue | null = null;
    public setNextBindListener(v: MIDIControlListenerValue | null): void {
        if (this.nextListener !== null && this.nextListener.onunbind !== undefined) {
            this.nextListener.onunbind();
            this.nextListener = null;
        }

        this.nextListener = v;
    }

    private log = false;
    private onControlMessage = (device: MIDIDevice, boundControl: BoundMIDIControl | null, channel: number, controlNumber: number, value: number | null): void => {
        if (this.log) console.log(channel, controlNumber, value);

        if (this.nextListener !== null) {
            // Transfer to the bind control. Create if needed.
            if (boundControl === null) {
                boundControl = device.bindValueListener(channel, controlNumber, this.nextListener);
            } else if (boundControl instanceof BoundMIDIControlValue) {
                boundControl.bindListener(this.nextListener);
            }

            this.nextListener = null;
        }
    };

    private getControlNumber(midi: MidiMetadata): number {
        // Control indices are for KORG nanoKONTROL 2
        if (midi.kind === 'button')
            return 32 + midi.index;
        else if (midi.kind === 'knob')
            return 16 + midi.index;
        else if (midi.kind === 'slider')
            return 0 + midi.index;
        else
            throw "whoops";
    }

    public bindObject(obj: { [k: string]: any }): void {
        // Bind the first device that we have...
        const device = this.devices[0];
        if (device === undefined)
            return;

        recurseBindProperties((obj, keyName, labelName, parentMetadata) => {
            const midi = Reflect.getMetadata('df:midi', obj, keyName) as MidiMetadata | undefined;
            if (!midi)
                return false;

            const controlNumber = this.getControlNumber(midi);
            if (midi.kind === 'knob' || midi.kind === 'slider') {
                const handler = new FloaterControlHandlerValue(obj, keyName, parentMetadata);
                device.bindValueListener(midi.channel, controlNumber, handler.midiListener);
            } else if (midi.kind === 'button') {
                assert(!midi.callback);
                const listener: MIDIControlListenerButton = {
                    ondown: () => { obj[keyName] = true; },
                    onup: () => { obj[keyName] = false; },
                }
                device.bindButtonListener(midi.channel, controlNumber, listener);
            }

            return true;
        }, obj);

        // Look for callbacks to hook
        recurseAllPrototypeFunctions((proto, keyName) => {
            const midi = Reflect.getMetadata('df:midi', proto, keyName) as MidiMetadata | undefined;
            if (!midi)
                return;

            const controlNumber = this.getControlNumber(midi);
            if (midi.kind === 'knob' || midi.kind === 'slider') {
                const listener: MIDIControlListenerValue = {
                    onvalue: (t) => { proto[keyName].call(obj, t); },
                };
                device.bindValueListener(midi.channel, controlNumber, listener);
            } else if (midi.kind === 'button') {
                const listener: MIDIControlListenerButton = {
                    ondown: () => { proto[keyName].call(obj); },
                }
                device.bindButtonListener(midi.channel, controlNumber, listener);
            }
        }, obj);
    }
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

export function dfUsePercent(v: boolean = true) {
    return Reflect.metadata('df:usepercent', v);
}

export function dfLabel(v: string) {
    return Reflect.metadata('df:label', v);
}

export function dfChangedCallback(v: () => void) {
    return Reflect.metadata('df:changedcallback', v);
}

export function dfBindMidiValue(kind: 'knob' | 'slider', index: number, channel: number = 0) {
    return Reflect.metadata('df:midi', { kind, index, channel });
}

export function dfBindMidiValueCallback(kind: 'knob' | 'slider', index: number, channel: number = 0) {
    return Reflect.metadata('df:midi', { kind, index, channel, callback: true });
}

export function dfBindMidiBoolean(index: number, channel: number = 0) {
    return Reflect.metadata('df:midi', { kind: 'button', index, channel });
}
