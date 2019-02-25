
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
    private usePointerLock: boolean = true;

    constructor(toplevel: HTMLElement) {
        document.body.tabIndex = -1;

        this.toplevel = toplevel;
        this.toplevel.tabIndex = -1;

        this.keysDown = new Map<string, boolean>();
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', this._onMouseDown);

        this.afterFrame();

        GlobalSaveManager.addSettingListener('InvertY', (saveManager: SaveManager, key: string) => {
            this.invertY = saveManager.loadSetting<boolean>(key, false);
        });
    }

    public addListener(listener: Listener): void {
        this.listeners.push(listener);
    }

    public getMouseDeltaX(obeyInvert: boolean = true): number {
        return this.dx;
    }

    public getMouseDeltaY(obeyInvert: boolean = true): number {
        const mult = (obeyInvert && this.invertY) ? -1 : 1;
        return this.dy * mult;
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
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
}
