
export class InputManager {
    public toplevel: HTMLElement;
    public keysDown: Map<string, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;
    public button: number;
    private lastX: number;
    private lastY: number;
    public grabbing: boolean = false;

    constructor(toplevel: HTMLElement) {
        this.toplevel = toplevel;

        this.keysDown = new Map<string, boolean>();
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', this._onMouseDown);

        this.resetMouse();
    }

    public isKeyDown(key: string) {
        return this.keysDown.get(key);
    }
    public isDragging(): boolean {
        return this.grabbing;
    }
    public resetMouse() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        this.keysDown.set(e.code, true);
    };
    private _onKeyUp = (e: KeyboardEvent) => {
        this.keysDown.delete(e.code);
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
        this.toplevel.style.setProperty('pointer-events', v ? 'auto' : '', 'important');

        if (v) {
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp);
        } else {
            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('mouseup', this._onMouseUp);
        }
    }

    private _onMouseMove = (e: MouseEvent) => {
        if (!this.grabbing)
            return;
        const dx = e.pageX - this.lastX;
        const dy = e.pageY - this.lastY;
        this.lastX = e.pageX;
        this.lastY = e.pageY;
        this.dx += dx;
        this.dy += dy;
    };
    private _onMouseUp = (e: MouseEvent) => {
        this._setGrabbing(false);
        this.button = 0;
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
    };
}
