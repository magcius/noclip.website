
import { assert } from './util';

interface GrabListener {
    onMotion(dx: number, dy: number): void;
    onGrabReleased(): void;
}

interface GrabOptions {
    takePointerLock: boolean;
}

class CursorOverride {
    private styleElem: HTMLStyleElement;
    private style: CSSStyleSheet;

    constructor() {
        this.styleElem = document.createElement('style');
        document.head.appendChild(this.styleElem);
        this.style = this.styleElem.sheet as CSSStyleSheet;
    }

    public setCursor(cursors: string[] | null): void {
        if (this.style.cssRules.length)
            this.style.deleteRule(0);

        if (cursors) {
            const ruleLines = cursors.map((cursor) => `cursor: ${cursor} !important;`);
            const rule = `* { ${ruleLines.join(' ')} }`;
            this.style.insertRule(rule, 0);
        }
    }
}

export const GlobalCursorOverride = new CursorOverride();

export class GrabManager {
    private grabListener: GrabListener | null = null;

    private lastX: number = -1;
    private lastY: number = -1;

    private _onMouseMove = (e: MouseEvent) => {
        if (this.grabListener === null)
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

        this.grabListener.onMotion(dx, dy);
    };

    private _onMouseUp = (e: MouseEvent) => {
        this.releaseGrab();
    };

    public hasGrabListener(grabListener: GrabListener): boolean {
        return this.grabListener === grabListener;
    }

    public isGrabbed(): boolean {
        return this.grabListener !== null;
    }

    public takeGrab(grabListener: GrabListener, e: MouseEvent, options: GrabOptions): void {
        if (this.grabListener !== null)
            return;

        this.grabListener = grabListener;

        GlobalCursorOverride.setCursor(['grabbing', '-webkit-grabbing']);

        this.lastX = e.pageX;
        this.lastY = e.pageY;
        // Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        document.body.focus();
        e.preventDefault();

        const target = e.target as HTMLElement;
        if (options.takePointerLock && target.requestPointerLock !== undefined)
            target.requestPointerLock();

        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);
    }

    public releaseGrab(): void {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);

        if (document.exitPointerLock !== undefined)
            document.exitPointerLock();

        GlobalCursorOverride.setCursor(null);

        // Call onGrabReleased after we set the grabListener to null so that if the callback calls
        // isDragging() or hasDragListener() we appear as if we have no grab.
        const grabListener = this.grabListener;
        this.grabListener = null;
        grabListener.onGrabReleased();
    }
}

export const GlobalGrabManager = new GrabManager();
