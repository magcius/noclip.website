
import { SaveManager, GlobalSaveManager } from "./SaveManager";

declare global {
    interface HTMLElement {
        requestPointerLock(): void;
    }

    interface Document {
        exitPointerLock(): void;
    }
}

function isModifier(key: string) {
    switch (key) {
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'AltLeft':
    case 'AltRight':
        return true;
    default:
        return false;
    }
}

export type Listener = (inputManager: InputManager) => void;

export default class InputManager {
    public toplevel: HTMLElement;
    // tristate. non-existent = not pressed, false = pressed but not this frame, true = pressed this frame.
    public keysDown: Map<string, boolean>;
    public buttonsDown: Map<number, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;
    public button: number;
    private lastX: number;
    private lastY: number;
    public grabbing: boolean = false;
    public onisdraggingchanged: () => void | null = null;
    public invertY: boolean = false;
    private listeners: Listener[] = [];
    private scrollListeners: Listener[] = [];
    private usePointerLock: boolean = true;
    private gamepads: Gamepad[] = [];

    constructor(toplevel: HTMLElement) {
        document.body.tabIndex = -1;

        this.toplevel = toplevel;
        this.toplevel.tabIndex = -1;

        this.keysDown = new Map<string, boolean>();
        this.buttonsDown = new Map<number, boolean>();
        // https://discussion.evernote.com/topic/114013-web-clipper-chrome-extension-steals-javascript-keyup-events/
        document.addEventListener('keydown', this._onKeyDown, { capture: true });
        document.addEventListener('keyup', this._onKeyUp, { capture: true });
        window.addEventListener('blur', this._onBlur);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', this._onMouseDown);

        this.afterFrame();

        GlobalSaveManager.addSettingListener('InvertY', (saveManager: SaveManager, key: string) => {
            this.invertY = saveManager.loadSetting<boolean>(key, false);
        });
        window.addEventListener("gamepadconnected", this.connecthandler.bind(this));
        window.addEventListener("gamepaddisconnected", this.disconnecthandler.bind(this));
    }

    public addListener(listener: Listener): void {
        this.listeners.push(listener);
    }

    public addScrollListener(listener: Listener): void {
        this.scrollListeners.push(listener);
    }

    public getMouseDeltaX(): number {
        return this.dx;
    }

    public getMouseDeltaY(): number {
        return this.dy;
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
    }

    public isButtonDownEventTriggered(key: number): boolean {
        return !!this.buttonsDown.get(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    public isDragging(): boolean {
        return this.grabbing;
    }

    public afterFrame() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;

        // Go through and mark all keys as non-event-triggered.
        this.keysDown.forEach((v, k) => {
            this.keysDown.set(k, false);
        });

        this.gamepads.forEach(gamepad => {
            if(gamepad.connected){
                gamepad.buttons.forEach((button, index) => {
                    if(!button.pressed && this.buttonsDown.has(index)) {
                        this.buttonsDown.delete(index);
                    }
                    else if(this.buttonsDown.has(index) && button.pressed)
                    {
                        this.buttonsDown.set(index, false);
                    }
                    else if(!this.buttonsDown.has(index) && button.pressed)
                    {
                        this.buttonsDown.set(index, true);
                    }
                });
            }
        });
    }

    public focusViewer() {
        this.toplevel.focus();
    }

    private _hasFocus() {
        return document.activeElement === document.body || document.activeElement === this.toplevel;
    }

    private callListeners(): void {
        for (let i = 0; i < this.listeners.length; i++)
            this.listeners[i](this);
    }

    private callScrollListeners(): void {
        for (let i = 0; i < this.scrollListeners.length; i++)
            this.scrollListeners[i](this);
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (isModifier(e.code)) {
            e.preventDefault();
        } else {
            if (!this._hasFocus()) return;
        }

        this.keysDown.set(e.code, !e.repeat);
        this.callListeners();
    };

    private _onKeyUp = (e: KeyboardEvent) => {
        this.keysDown.delete(e.code);
        this.callListeners();
    };

    private _onBlur = () => {
        this.keysDown.clear();
        this.callListeners();
    };

    private _onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.dz += Math.sign(e.deltaY) * -4;
        this.callScrollListeners();
    };

    private _setGrabbing(v: boolean) {
        if (this.grabbing === v)
            return;

        this.grabbing = v;
        this.toplevel.style.cursor = v ? '-webkit-grabbing' : '-webkit-grab';
        this.toplevel.style.cursor = v ? 'grabbing' : 'grab';

        if (v) {
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp);
        } else {
            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('mouseup', this._onMouseUp);
        }

        if (this.onisdraggingchanged)
            this.onisdraggingchanged();
    }

    private _onMouseMove = (e: MouseEvent) => {
        if (!this.grabbing)
            return;
        let dx: number, dy: number;
        if (e.movementX !== undefined) {
            dx = e.movementX;
            dy = e.movementY;
        } else {
            dx = e.pageX - this.lastX;
            dy = e.pageY - this.lastY;
            this.lastX = e.pageX;
            this.lastY = e.pageY;
        }
        this.dx += dx;
        this.dy += dy;
    };

    private _onMouseUp = (e: MouseEvent) => {
        this._setGrabbing(false);
        this.button = 0;
        if (document.exitPointerLock !== undefined)
            document.exitPointerLock();
    };

    private _onMouseDown = (e: MouseEvent) => {
        this.button = e.button;
        this.lastX = e.pageX;
        this.lastY = e.pageY;
        this._setGrabbing(true);
        // Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        this.toplevel.focus();
        e.preventDefault();
        if (this.usePointerLock && this.toplevel.requestPointerLock !== undefined)
            this.toplevel.requestPointerLock();
    };

    private connecthandler(e: GamepadEventInit): void {
        this.gamepads[e.gamepad.index] = e.gamepad;
    }

    private disconnecthandler(e: GamepadEventInit): void {
        delete this.gamepads[e.gamepad.index];
    }

    public getGamepadAxis(axis: number): number {
        let value = 0;
        this.gamepads.forEach(gamepad => {
            if(gamepad.connected){
                if(gamepad.mapping != 'standard' && axis >= 3) axis += 2;
                 value = gamepad.axes[axis];
            }
        });
        return value;
    }

    public getGamepadButton(button: number): boolean {
        let value = false;
        this.gamepads.forEach(gamepad => {
            if(gamepad.connected){
                value = gamepad.buttons[button].pressed;
            }
        });
        return value;
    }
}
