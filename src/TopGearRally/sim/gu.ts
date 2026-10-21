import { f, sinf, cosf, sqrtf, u16 } from "./f32.js";
import { Mtx4, Ref } from "./types.js";

const g_fGuRotateDtor = f(3.1415926 / 180.0);

export interface LookAtLight {
    col: number[];
    colc: number[];
    dir: number[];
}

function FTOFRAC8(x: number): number {
    return Math.trunc(Math.min(x * 128.0, 127.0)) & 0xff;
}

export function guMtxIdentF(mf: Mtx4): void {
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            mf[i][j] = i === j ? 1.0 : 0.0;
        }
    }
}

export function guMtxXFMF(mf: Mtx4, x: number, y: number, z: number, ox: Ref<number>, oy: Ref<number>, oz: Ref<number>): void {
    ox.value = f(f(f(f(mf[0][0] * x) + f(mf[1][0] * y)) + f(mf[2][0] * z)) + mf[3][0]);
    oy.value = f(f(f(f(mf[0][1] * x) + f(mf[1][1] * y)) + f(mf[2][1] * z)) + mf[3][1]);
    oz.value = f(f(f(f(mf[0][2] * x) + f(mf[1][2] * y)) + f(mf[2][2] * z)) + mf[3][2]);
}

export function guMtxCatF(mf: Mtx4, nf: Mtx4, res: Mtx4): void {
    const temp: number[][] = [[], [], [], []];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let sum = 0.0;
            for (let k = 0; k < 4; k++) {
                sum = f(sum + f(mf[i][k] * nf[k][j]));
            }
            temp[i][j] = sum;
        }
    }
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            res[i][j] = temp[i][j];
        }
    }
}

export function guTranslateF(mf: Mtx4, x: number, y: number, z: number): void {
    guMtxIdentF(mf);
    mf[3][0] = x;
    mf[3][1] = y;
    mf[3][2] = z;
}

export function guScaleF(mf: Mtx4, x: number, y: number, z: number): void {
    guMtxIdentF(mf);
    mf[0][0] = x;
    mf[1][1] = y;
    mf[2][2] = z;
    mf[3][3] = 1.0;
}

export function guNormalize(x: Ref<number>, y: Ref<number>, z: Ref<number>): void {
    const m = f(1.0 / sqrtf(f(f(f(x.value * x.value) + f(y.value * y.value)) + f(z.value * z.value))));
    x.value = f(x.value * m);
    y.value = f(y.value * m);
    z.value = f(z.value * m);
}

export function guRotateF(mf: Mtx4, a: number, x: number, y: number, z: number): void {
    const rx = { value: x };
    const ry = { value: y };
    const rz = { value: z };
    guNormalize(rx, ry, rz);
    x = rx.value;
    y = ry.value;
    z = rz.value;
    a = f(a * g_fGuRotateDtor);
    const sine = sinf(a);
    const cosine = cosf(a);
    let t = f(1.0 - cosine);
    const ab = f(f(x * y) * t);
    const bc = f(f(y * z) * t);
    const ca = f(f(z * x) * t);
    guMtxIdentF(mf);
    t = f(x * x);
    mf[0][0] = f(t + f(cosine * f(1.0 - t)));
    mf[2][1] = f(bc - f(x * sine));
    mf[1][2] = f(bc + f(x * sine));
    t = f(y * y);
    mf[1][1] = f(t + f(cosine * f(1.0 - t)));
    mf[2][0] = f(ca + f(y * sine));
    mf[0][2] = f(ca - f(y * sine));
    t = f(z * z);
    mf[2][2] = f(t + f(cosine * f(1.0 - t)));
    mf[1][0] = f(ab - f(z * sine));
    mf[0][1] = f(ab + f(z * sine));
}

interface LookAtBasis {
    xLook: number;
    yLook: number;
    zLook: number;
    xRight: number;
    yRight: number;
    zRight: number;
    xUp: number;
    yUp: number;
    zUp: number;
}

function lookAtBasis(xEye: number, yEye: number, zEye: number, xAt: number, yAt: number, zAt: number, xUp: number, yUp: number, zUp: number): LookAtBasis {
    let xLook = f(xAt - xEye);
    let yLook = f(yAt - yEye);
    let zLook = f(zAt - zEye);
    let len = f(-1.0 / sqrtf(f(f(f(xLook * xLook) + f(yLook * yLook)) + f(zLook * zLook))));
    xLook = f(xLook * len);
    yLook = f(yLook * len);
    zLook = f(zLook * len);
    let xRight = f(f(yUp * zLook) - f(zUp * yLook));
    let yRight = f(f(zUp * xLook) - f(xUp * zLook));
    let zRight = f(f(xUp * yLook) - f(yUp * xLook));
    len = f(1.0 / sqrtf(f(f(f(xRight * xRight) + f(yRight * yRight)) + f(zRight * zRight))));
    xRight = f(xRight * len);
    yRight = f(yRight * len);
    zRight = f(zRight * len);
    xUp = f(f(yLook * zRight) - f(zLook * yRight));
    yUp = f(f(zLook * xRight) - f(xLook * zRight));
    zUp = f(f(xLook * yRight) - f(yLook * xRight));
    len = f(1.0 / sqrtf(f(f(f(xUp * xUp) + f(yUp * yUp)) + f(zUp * zUp))));
    xUp = f(xUp * len);
    yUp = f(yUp * len);
    zUp = f(zUp * len);
    return { xLook, yLook, zLook, xRight, yRight, zRight, xUp, yUp, zUp };
}

function writeLookAt(mf: Mtx4, b: LookAtBasis, xEye: number, yEye: number, zEye: number): void {
    const dot = (x: number, y: number, z: number): number => -f(f(f(xEye * x) + f(yEye * y)) + f(zEye * z));
    mf[0][0] = b.xRight;
    mf[1][0] = b.yRight;
    mf[2][0] = b.zRight;
    mf[3][0] = dot(b.xRight, b.yRight, b.zRight);
    mf[0][1] = b.xUp;
    mf[1][1] = b.yUp;
    mf[2][1] = b.zUp;
    mf[3][1] = dot(b.xUp, b.yUp, b.zUp);
    mf[0][2] = b.xLook;
    mf[1][2] = b.yLook;
    mf[2][2] = b.zLook;
    mf[3][2] = dot(b.xLook, b.yLook, b.zLook);
    mf[0][3] = 0.0;
    mf[1][3] = 0.0;
    mf[2][3] = 0.0;
    mf[3][3] = 1.0;
}

export function guLookAtF(mf: Mtx4, xEye: number, yEye: number, zEye: number, xAt: number, yAt: number, zAt: number, xUp: number, yUp: number, zUp: number): void {
    guMtxIdentF(mf);
    writeLookAt(mf, lookAtBasis(xEye, yEye, zEye, xAt, yAt, zAt, xUp, yUp, zUp), xEye, yEye, zEye);
}

export function guLookAtReflectF(mf: Mtx4, l: LookAtLight[], xEye: number, yEye: number, zEye: number, xAt: number, yAt: number, zAt: number, xUp: number, yUp: number, zUp: number): void {
    guMtxIdentF(mf);
    const b = lookAtBasis(xEye, yEye, zEye, xAt, yAt, zAt, xUp, yUp, zUp);
    l[0].dir = [FTOFRAC8(b.xRight), FTOFRAC8(b.yRight), FTOFRAC8(b.zRight)];
    l[1].dir = [FTOFRAC8(b.xUp), FTOFRAC8(b.yUp), FTOFRAC8(b.zUp)];
    l[0].col = [0x00, 0x00, 0x00];
    l[0].colc = [0x00, 0x00, 0x00];
    l[1].col = [0x00, 0x80, 0x00];
    l[1].colc = [0x00, 0x80, 0x00];
    writeLookAt(mf, b, xEye, yEye, zEye);
}

export function guPerspectiveF(mf: Mtx4, perspNorm: Ref<number> | null, fovy: number, aspect: number, near: number, far: number, scale: number): void {
    guMtxIdentF(mf);
    fovy = f(fovy * (3.1415926 / 180.0));
    const cot = f(cosf(f(fovy / 2)) / sinf(f(fovy / 2)));
    mf[0][0] = f(cot / aspect);
    mf[1][1] = cot;
    mf[2][2] = f(f(near + far) / f(near - far));
    mf[2][3] = -1.0;
    mf[3][2] = f(f(f(2 * near) * far) / f(near - far));
    mf[3][3] = 0.0;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            mf[i][j] = f(mf[i][j] * scale);
        }
    }
    if (perspNorm !== null) {
        if (f(near + far) <= 2.0) {
            perspNorm.value = 0xffff;
        } else {
            perspNorm.value = u16((2.0 * 65536.0) / f(near + far));
            if (perspNorm.value <= 0) {
                perspNorm.value = 1;
            }
        }
    }
}
