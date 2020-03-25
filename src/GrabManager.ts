
interface GrabListener {
    onMotion(dx: number, dy: number): void;
    onGrabReleased(): void;
}

interface GrabOptions {
    takePointerLock: boolean;
    useGrabbingCursor: boolean;
    releaseOnMouseUp: boolean;
    grabElement?: HTMLElement;
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

function containsElement(sub_: HTMLElement, searchFor: HTMLElement): boolean {
    let sub: HTMLElement | null = sub_;
    while (sub !== null) {
        if (sub === searchFor)
            return true;
        sub = sub.parentElement;
    }
    return false;
}

export class GrabManager {
    private grabListener: GrabListener | null = null;
    private grabOptions: GrabOptions | null = null;
    private currentGrabTarget: HTMLElement | null = null;

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

    private _onMouseDown = (e: MouseEvent) => {
        const grabElement = this.grabOptions!.grabElement;
        if (grabElement && !containsElement(e.target as HTMLElement, grabElement))
            this.releaseGrab();
    };

    private _onMouseUp = (e: MouseEvent) => {
        this.releaseGrab();
    };

    private _onPointerLockChange = (e: Event) => {
        if (document.pointerLockElement !== this.currentGrabTarget)
            this.releaseGrab();
    };

    public hasGrabListener(grabListener: GrabListener): boolean {
        return this.grabListener === grabListener;
    }

    public isGrabbed(): boolean {
        return this.grabListener !== null;
    }

    public takeGrab(grabListener: GrabListener, e: MouseEvent, grabOptions: GrabOptions): void {
        if (this.grabListener !== null)
            return;

        this.grabListener = grabListener;
        this.grabOptions = grabOptions;

        if (grabOptions.useGrabbingCursor)
            GlobalCursorOverride.setCursor(['grabbing', '-webkit-grabbing']);

        this.lastX = e.pageX;
        this.lastY = e.pageY;
        // Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        document.body.focus();
        e.preventDefault();

        const target = e.target as HTMLElement;
        if (grabOptions.takePointerLock && target.requestPointerLock !== undefined) {
            document.addEventListener('pointerlockchange', this._onPointerLockChange);
            target.requestPointerLock();
            this.currentGrabTarget = target;
        }

        document.addEventListener('mousemove', this._onMouseMove);
        if (grabOptions.releaseOnMouseUp)
            document.addEventListener('mouseup', this._onMouseUp);
        else
            document.addEventListener('mousedown', this._onMouseDown, { capture: true });
    }

    public releaseGrab(): void {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('mousedown', this._onMouseDown, { capture: true });

        if (this.currentGrabTarget !== null) {
            document.removeEventListener('pointerlockchange', this._onPointerLockChange);

            if (document.exitPointerLock !== undefined)
                document.exitPointerLock();
        }

        GlobalCursorOverride.setCursor(null);

        // Call onGrabReleased after we set the grabListener to null so that if the callback calls
        // isDragging() or hasDragListener() we appear as if we have no grab.
        const grabListener = this.grabListener!;
        this.grabListener = null;
        grabListener.onGrabReleased();

        this.grabOptions = null;
    }
}

export const GlobalGrabManager = new GrabManager();
