// Misc utilities to help me debug various issues. Mostly garbage.

import { AABB } from "./Geometry";
import { Color, Magenta, colorToCSS } from "./Color";
import { Camera, divideByW, ScreenSpaceProjection } from "./Camera";
import { vec4, mat4, vec3, vec2 } from "gl-matrix";
import { nArray, assert, assertExists } from "./util";

export function stepF(f: (t: number) => number, maxt: number, step: number, callback: (t: number, v: number) => void) {
    for (let t = 0; t < maxt; t += step) {
        callback(t, f(t));
    }
}

export type F = (t: number) => number;

export class Graph {
    public minv: number | undefined = undefined;
    public maxv: number | undefined = undefined;
    public ctx: CanvasRenderingContext2D;
    public mx = 0;
    public my = 0;

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
        this.ctx.canvas.onmousemove = (e) => {
            this.mx = e.offsetX;
            this.my = e.offsetY;
        };
    }

    public clear(): void {
        const ctx = this.ctx;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);    

        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.my + 0.5);
        ctx.lineTo(ctx.canvas.width, this.my + 0.5);
        ctx.stroke();
    }

    public hline(color: string, v: number): void {
        const ctx = this.ctx;
        const ya = (v - this.minv!) / (this.maxv! - this.minv!);
        const y = (1-ya) * ctx.canvas.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ctx.canvas.width, y);
        ctx.stroke();
    }

    public dot(color: string, t: number, v: number, radius: number = 5): void {
        assert(t >= 0 && t <= 1);
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        const ya = (v - this.minv!) / (this.maxv! - this.minv!);
        const x = t * ctx.canvas.width;
        const y = (1-ya) * ctx.canvas.height;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
    }

    public marker(color: string, t: number): void {
        assert(t >= 0 && t <= 1);
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const x = t * ctx.canvas.width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctx.canvas.height);
        ctx.stroke();
    }

    public graphF(color: string, f: F, range: number, step = 1): void {
        stepF(f, range, step, (t, v) => {
            if (this.minv === undefined)
                this.minv = v;
            if (this.maxv === undefined)
                this.maxv = v;
            this.minv = Math.min(this.minv, v);
            this.maxv = Math.max(this.maxv, v);
        });

        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        stepF(f, range, step, (t, v) => {
            const xa = (t / range);
            const ya = (v - this.minv!) / (this.maxv! - this.minv!);
            const x = xa * ctx.canvas.width;
            const y = (1-ya) * ctx.canvas.height;
            ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

export function cv(): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = assertExists(canvas.getContext('2d'));

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

let _debugOverlayCanvas: CanvasRenderingContext2D | null = null;
export function getDebugOverlayCanvas2D(): CanvasRenderingContext2D {
    if (!_debugOverlayCanvas) {
        const canvas = document.createElement('canvas');
        const ctx = assertExists(canvas.getContext('2d'));

        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';

        document.body.appendChild(canvas);
        _debugOverlayCanvas = ctx;
    }

    return _debugOverlayCanvas!;
}

export function prepareFrameDebugOverlayCanvas2D(): void {
    if (_debugOverlayCanvas) {
        _debugOverlayCanvas.canvas.width = window.innerWidth;
        _debugOverlayCanvas.canvas.height = window.innerHeight;
    }
}

const p = nArray(8, () => vec4.create());
const vp = mat4.create();

function transformToClipSpace(ctx: CanvasRenderingContext2D, camera: Camera, nPoints: number): void {
    mat4.mul(vp, camera.projectionMatrix, camera.viewMatrix);
    for (let i = 0; i < nPoints; i++) {
        vec4.transformMat4(p[i], p[i], vp);
        divideByW(p[i], p[i]);
    }
}

function shouldCull(p: vec4): boolean {
    return p[0] < -1 || p[0] > 1 || p[1] < -1 || p[1] > 1 || p[2] < -1 || p[2] > 1;
}

function drawLine(ctx: CanvasRenderingContext2D, p0: vec4, p1: vec4): void {
    if (shouldCull(p0) || shouldCull(p1)) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.moveTo((p0[0] + 1) * cw / 2, ((-p0[1] + 1) * ch / 2));
    ctx.lineTo((p1[0] + 1) * cw / 2, ((-p1[1] + 1) * ch / 2));
}

export function drawWorldSpaceLine(ctx: CanvasRenderingContext2D, camera: Camera, v0: vec3, v1: vec3, color: Color = Magenta): void {
    vec4.set(p[0], v0[0], v0[1], v0[2], 1.0);
    vec4.set(p[1], v1[0], v1[1], v1[2], 1.0);
    transformToClipSpace(ctx, camera, 2);

    ctx.beginPath();
    drawLine(ctx, p[0], p[1]);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}

export function drawWorldSpaceAABB(ctx: CanvasRenderingContext2D, camera: Camera, aabb: AABB, color: Color = Magenta): void {
    vec4.set(p[0], aabb.minX, aabb.minY, aabb.minZ, 1.0);
    vec4.set(p[1], aabb.maxX, aabb.minY, aabb.minZ, 1.0);
    vec4.set(p[2], aabb.minX, aabb.maxY, aabb.minZ, 1.0);
    vec4.set(p[3], aabb.maxX, aabb.maxY, aabb.minZ, 1.0);
    vec4.set(p[4], aabb.minX, aabb.minY, aabb.maxZ, 1.0);
    vec4.set(p[5], aabb.maxX, aabb.minY, aabb.maxZ, 1.0);
    vec4.set(p[6], aabb.minX, aabb.maxY, aabb.maxZ, 1.0);
    vec4.set(p[7], aabb.maxX, aabb.maxY, aabb.maxZ, 1.0);
    transformToClipSpace(ctx, camera, 8);

    ctx.beginPath();
    drawLine(ctx, p[0], p[1]);
    drawLine(ctx, p[1], p[3]);
    drawLine(ctx, p[3], p[2]);
    drawLine(ctx, p[2], p[0]);
    drawLine(ctx, p[4], p[5]);
    drawLine(ctx, p[5], p[7]);
    drawLine(ctx, p[7], p[6]);
    drawLine(ctx, p[6], p[4]);
    drawLine(ctx, p[0], p[4]);
    drawLine(ctx, p[1], p[5]);
    drawLine(ctx, p[2], p[6]);
    drawLine(ctx, p[3], p[7]);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}

export function drawWorldSpacePoint(ctx: CanvasRenderingContext2D, camera: Camera, v: vec4, color: Color = Magenta, radius: number = 2): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    vec4.copy(p[0], v);
    transformToClipSpace(ctx, camera, 1);
    if (shouldCull(p[0])) return;

    const x = ( p[0][0] + 1) * cw / 2;
    const y = (-p[0][1] + 1) * ch / 2;
    ctx.fillStyle = colorToCSS(color);
    ctx.fillRect(x - radius, y - radius, radius, radius);
}

export function drawScreenSpaceProjection(ctx: CanvasRenderingContext2D, proj: ScreenSpaceProjection, color: Color = Magenta): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    const x1 = (proj.projectedMinX + 1) * cw / 2;
    const x2 = (proj.projectedMaxX + 1) * cw / 2;
    const y1 = (-proj.projectedMinY + 1) * ch / 2;
    const y2 = (-proj.projectedMaxY + 1) * ch / 2;

    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}
