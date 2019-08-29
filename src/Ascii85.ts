
import { assert } from "./util";

const A85_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+=-_,:;~/?[]@!$&()*{}|^';

export function btoa(d: Uint8Array, byteLength: number = d.byteLength, charset: string = A85_CHARS, chunk = ['0', '0', '0', '0', '0']): string {
    assert(charset.length === 85);
    const n = byteLength;
    const padding = (-n) & 0x03;

    let S = '';
    for (let i = 0; i < n;) {
        const wordEnd = Math.min(i + 0x04, n);
        let v = 0;
        let s = 24;
        for (; i < wordEnd; i++) {
            v |= (d[i] << s);
            s -= 8;
        }
        v = v >>> 0;

        chunk.fill('0');
        for (let j = 4; j >= 0; j--) {
            const c = charset.charAt(v % 85);
            assert(c.length === 1);
            chunk[j] = c;
            v = (v / 85) | 0;
        }

        if (i === n)
            S += chunk.slice(0, 5-padding).join('');
        else
            S += chunk.join('');
    }
    return S;
}

export function atob(dst: Uint8Array, dstOffs: number = 0, str: string, charset: string = A85_CHARS): number {
    assert(charset.length === 85);
    const table: { [k: string]: number } = {};
    for (let i = 0; i < 85; i++)
        table[charset.charAt(i)] = i;

    const n = str.length;
    const numCharGroups = ((n + 4) / 5) | 0;
    const byteLength = numCharGroups * 4 - ((5 - (n % 5)) % 5);
    assert(byteLength <= dst.byteLength - dstOffs);

    outer:
    for (let i = 0; i < n;) {
        let v = 0;
        const wordEnd = i + 5;
        for (; i < wordEnd; i++) {
            const c = i < n ? table[str.charAt(i)] : 84;
            v = v * 85 + c;
        }

        for (let j = 0; j < 4; j++) {
            dst[dstOffs++] = (v >> 24) & 0xFF;
            v <<= 8;

            if (dstOffs >= byteLength)
                break outer;
        }
    }

    return byteLength;
}
