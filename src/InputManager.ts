
import { SaveManager, GlobalSaveManager } from "./SaveManager";
import { GlobalGrabManager } from './GrabManager';

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

const enum TouchGesture {
    None,
    Scroll, // 1-finger scroll and pan
    Pinch, // 2-finger pinch in and out
}

export default class InputManager {
    public invertY = false;
    public invertX = false;

    public toplevel: HTMLElement;
    // tristate. non-existent = not pressed, false = pressed but not this frame, true = pressed this frame.
    public keysDown: Map<string, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;
    public button: number = -1;
    public onisdraggingchanged: (() => void) | null = null;
    private listeners: Listener[] = [];
    private scrollListeners: Listener[] = [];
    private usePointerLock: boolean = true;
    public isInteractive: boolean = true;

    private touchGesture: TouchGesture = TouchGesture.None;
    private prevTouchX: number = 0; // When scrolling, contains finger X; when pinching, contains midpoint X
    private prevTouchY: number = 0; // When scrolling, contains finger Y; when pinching, contains midpoint Y
    private prevPinchDist: number = 0;
    private dTouchX: number = 0;
    private dTouchY: number = 0;
    private dPinchDist: number = 0;

    constructor(toplevel: HTMLElement) {
        document.body.tabIndex = -1;

        this.toplevel = toplevel;
        this.toplevel.tabIndex = -1;

        this.keysDown = new Map<string, boolean>();
        // https://discussion.evernote.com/topic/114013-web-clipper-chrome-extension-steals-javascript-keyup-events/
        document.addEventListener('keydown', this._onKeyDown, { capture: true });
        document.addEventListener('keyup', this._onKeyUp, { capture: true });
        window.addEventListener('blur', this._onBlur);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', (e) => {
            if (!this.isInteractive)
                return;
            this.button = e.button;
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: this.usePointerLock, useGrabbingCursor: true, releaseOnMouseUp: true });
            if (this.onisdraggingchanged !== null)
                this.onisdraggingchanged();
        });

        this.toplevel.addEventListener('touchstart', this._onTouchChange);
        this.toplevel.addEventListener('touchend', this._onTouchChange);
        this.toplevel.addEventListener('touchcancel', this._onTouchChange);
        this.toplevel.addEventListener('touchmove', this._onTouchMove);

        this.afterFrame();

        GlobalSaveManager.addSettingListener('InvertY', (saveManager: SaveManager, key: string) => {
            this.invertY = saveManager.loadSetting<boolean>(key, false);
        });

        GlobalSaveManager.addSettingListener('InvertX', (saveManager: SaveManager, key: string) => {
            this.invertX = saveManager.loadSetting<boolean>(key, false);
        });
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

    public getTouchDeltaX(): number {
        // XXX: In non-pinch mode, touch deltas are turned into mouse deltas.
        return this.touchGesture == TouchGesture.Pinch ? this.dTouchX : 0;
    }

    public getTouchDeltaY(): number {
        // XXX: In non-pinch mode, touch deltas are turned into mouse deltas.
        return this.touchGesture == TouchGesture.Pinch ? this.dTouchY : 0;
    }

    public getPinchDeltaDist(): number {
        return this.touchGesture == TouchGesture.Pinch ? this.dPinchDist : 0;
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    public isDragging(): boolean {
        return this.touchGesture != TouchGesture.None || GlobalGrabManager.hasGrabListener(this);
    }

    public afterFrame() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
        this.dTouchX = 0;
        this.dTouchY = 0;
        this.dPinchDist = 0;

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

    private _onTouchChange = (e: TouchEvent) => { // start, end or cancel a touch
        if (!this.isInteractive)
            return;
        e.preventDefault();
        if (e.touches.length == 1) {
            this.touchGesture = TouchGesture.Scroll;
            this.prevTouchX = e.touches[0].clientX;
            this.prevTouchY = e.touches[0].clientY;
            this.dTouchX = 0;
            this.dTouchY = 0;
        } else if (e.touches.length == 2) {
            this.touchGesture = TouchGesture.Pinch;
            this.prevTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            this.prevTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            this.prevPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            this.dTouchX = 0;
            this.dTouchY = 0;
            this.dPinchDist = 0;
        } else {
            this.touchGesture = TouchGesture.None;
        }
    };

    private _onTouchMove = (e: TouchEvent) => {
        if (!this.isInteractive)
            return;
        e.preventDefault();
        if (e.touches.length == 1) {
            this.touchGesture = TouchGesture.Scroll;
            this.dTouchX = e.touches[0].clientX - this.prevTouchX;
            this.dTouchY = e.touches[0].clientY - this.prevTouchY;
            this.onMotion(this.dTouchX, this.dTouchY);
            this.prevTouchX = e.touches[0].clientX;
            this.prevTouchY = e.touches[0].clientY;
        } else if (e.touches.length == 2) {
            this.touchGesture = TouchGesture.Pinch;
            const newX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const newY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            this.dTouchX = newX - this.prevTouchX;
            this.dTouchY = newY - this.prevTouchY;
            this.dPinchDist = newDist - this.prevPinchDist;
            this.prevTouchX = newX;
            this.prevTouchY = newY;
            this.prevPinchDist = newDist;
        } else {
            this.touchGesture = TouchGesture.None;
        }
    }

    public onMotion(dx: number, dy: number) {
        this.dx += dx;
        this.dy += dy;
    }

    public onGrabReleased () {
        this.button = -1;
        if (this.onisdraggingchanged !== null)
            this.onisdraggingchanged();
    }
}
