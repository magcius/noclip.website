
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

function containsElement(sub_: HTMLElement, searchFor: HTMLElement): boolean {
    let sub: HTMLElement | null = sub_;
    while (sub !== null) {
        if (sub === searchFor)
            return true;
        sub = sub.parentElement;
    }
    return false;
}

function setGlobalCursor(cursor: string): void {
    // Needed to make the cursor update in Chrome. See:
    // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
    if (document.body.style.cursor !== cursor) {
        document.body.focus();
        document.body.style.cursor = cursor;
    }
}

export class GrabManager {
    private grabListener: GrabListener | null = null;
    private grabOptions: GrabOptions | null = null;
    private currentGrabTarget: HTMLElement | null = null;
    private usingPointerLock: boolean = false;
    private currentCursor: string = '';

    private lastX: number = -1;
    private lastY: number = -1;
    private grabButton: number = -1;

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
        if (!grabElement || !containsElement(e.target as HTMLElement, grabElement))
            this.releaseGrab();
    };

    private _onMouseUp = (e: MouseEvent) => {
        if (e.button === this.grabButton)
            this.releaseGrab();
    };

    private _onPointerLockChange = (e: Event) => {
        if (document.pointerLockElement === this.currentGrabTarget) {
            // Success.
            this.usingPointerLock = true;
        } else {
            // This shouldn't hit the error case.
            this.releaseGrab();
        }
    };

    private _onPointerLockError = (e: Event) => {
        // Could not take the pointer lock. Fall back to the grab cursor if wanted.
        if (this.grabOptions !== null && this.grabOptions.useGrabbingCursor)
            setGlobalCursor('grabbing');
    };

    public getGrabListenerOptions(grabListener: GrabListener): GrabOptions | null {
        if (this.grabListener === grabListener)
            return this.grabOptions;
        else
            return null;
    }

    public isGrabbed(): boolean {
        return this.grabListener !== null;
    }

    public setCursor(cursor: string): void {
        this.currentCursor = cursor;

        // If we're in a pointer lock grab, then the cursor doesn't matter...
        if (this.grabOptions !== null && this.usingPointerLock)
            return;

        // Grab cursor takes precedence.
        if (this.grabOptions !== null && this.grabOptions.useGrabbingCursor)
            return;

        document.body.style.cursor = cursor;
    }

    public takeGrab(grabListener: GrabListener, e: MouseEvent, grabOptions: GrabOptions): void {
        e.preventDefault();

        if (this.grabListener !== null)
            return;

        this.grabListener = grabListener;
        this.grabOptions = grabOptions;

        this.lastX = e.pageX;
        this.lastY = e.pageY;
        this.grabButton = e.button;

        const target = e.target as HTMLElement;
        target.focus();

        this.usingPointerLock = false;
        if (grabOptions.takePointerLock && target.requestPointerLock !== undefined) {
            document.addEventListener('pointerlockchange', this._onPointerLockChange);
            document.addEventListener('pointerlockerror', this._onPointerLockError);
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

        // If we're exiting a pointer lock, or we overrode the cursor with our grabbing one,
        // then reset the cursor back to the user choice.
        if (this.grabOptions!.useGrabbingCursor || this.usingPointerLock)
            setGlobalCursor(this.currentCursor);

        // Call onGrabReleased after we set the grabListener to null so that if the callback calls
        // isDragging() or hasDragListener() we appear as if we have no grab.
        const grabListener = this.grabListener!;
        this.grabListener = null;
        grabListener.onGrabReleased();

        this.grabOptions = null;
    }
}

export const GlobalGrabManager = new GrabManager();
