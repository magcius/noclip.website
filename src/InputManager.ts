
import { SaveManager, GlobalSaveManager } from "./SaveManager";
import { GlobalGrabManager } from './GrabManager';
import { vec2 } from 'gl-matrix';

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

    private isSingleTouching: boolean = false;
    private prevSingleTouchX: number = 0;
    private prevSingleTouchY: number = 0;

    private isDoubleTouching: boolean = false;
    private prevDoubleTouchDist: number = 0;
    private dDoubleTouchDist: number = 0;

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

    public getDoubleTouchDeltaDist(): number {
        return this.isDoubleTouching ? this.dDoubleTouchDist : 0;
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    public isDragging(): boolean {
        return this.isSingleTouching || GlobalGrabManager.hasGrabListener(this);
    }

    public afterFrame() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
        this.dDoubleTouchDist = 0;

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
            this.isSingleTouching = true;
            this.isDoubleTouching = false;
            this.prevSingleTouchX = e.touches[0].clientX;
            this.prevSingleTouchY = e.touches[0].clientY;
        } else if (e.touches.length == 2) {
            this.isDoubleTouching = true;
            this.isSingleTouching = false;
            this.prevDoubleTouchDist = vec2.dist([e.touches[0].clientX, e.touches[0].clientY], [e.touches[1].clientX, e.touches[1].clientY]);
            this.dDoubleTouchDist = 0;
        } else {
            this.isSingleTouching = false;
            this.isDoubleTouching = false;
        }
    };

    private _onTouchMove = (e: TouchEvent) => {
        if (!this.isInteractive)
            return;
        e.preventDefault();
        if (e.touches.length == 1) {
            this.isSingleTouching = true;
            this.isDoubleTouching = false;
            this.onMotion(e.touches[0].clientX - this.prevSingleTouchX, e.touches[0].clientY - this.prevSingleTouchY);
            this.prevSingleTouchX = e.touches[0].clientX;
            this.prevSingleTouchY = e.touches[0].clientY;
        } else if (e.touches.length == 2) {
            this.isDoubleTouching = true;
            this.isSingleTouching = false;
            const newDist = vec2.dist([e.touches[0].clientX, e.touches[0].clientY], [e.touches[1].clientX, e.touches[1].clientY]);
            this.dDoubleTouchDist = newDist - this.prevDoubleTouchDist;
            this.prevDoubleTouchDist = newDist;
        } else {
            this.isSingleTouching = false;
            this.isDoubleTouching = false;
        }
        // TODO: handle pinch gesture
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
