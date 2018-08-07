
export function stepF(f: (t: number) => number, maxt: number, step: number, callback: (t: number, v: number) => void) {
    for (let t = 0; t < maxt; t += step) {
        callback(t, f(t));
    }
}

export type F = (t: number) => number;

export class Graph {
    public minv: number = undefined;
    public maxv: number = undefined;
    public ctx: CanvasRenderingContext2D;

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    public graphF(color: string, f: F, range: number): void {
        const step = 1;

        stepF(f, range, step, (t, v) => {
            if (this.minv === undefined)
                this.minv = v;
            if (this.maxv === undefined)
                this.maxv = v;
            this.minv = Math.min(this.minv, v);
            this.maxv = Math.max(this.maxv, v);
        });

        // pad
        const displayMinV = this.minv;
        const displayMaxV = this.maxv;
        const ctx = this.ctx;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        stepF(f, range, step, (t, v) => {
            const xa = (t / range) * 1/step;
            const ya = (v - displayMinV) / (displayMaxV - displayMinV);
            const x = xa * width;
            const y = (1-ya) * height;
            ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

export function cv(): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';

    [].forEach.call(document.querySelectorAll('canvas.cv'), (e: HTMLElement) => document.body.removeChild(e));
    canvas.classList.add('cv');
    document.body.appendChild(canvas);

    return ctx;
}
