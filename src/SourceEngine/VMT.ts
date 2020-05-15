
// Valve Material Type

import { assert, assertExists } from "../util";
import { SourceFileSystem } from "./Main";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorFromRGBA } from "../Color";

export interface VMT {
    _Root: string;
    _Filename: string;

    // patch
    include: string;
    replace: any;
    insert: any;

    // proxies
    proxies: any;

    // generic
    [k: string]: string;
}

export type VKFPair = [string, any];

class ValveKeyValueParser {
    private pos = 0;
    constructor(private S: string) {
    }

    public hastok() {
        return (this.pos < this.S.length);
    }

    public skipwhite(): void {
        while (this.hastok()) {
            const tok = this.S.charAt(this.pos);
            if (/\s/.test(tok) || tok === '\0')
                this.pos++;
            else
                return;
        }
    }

    private skipcomment2(): boolean {
        if (this.chew() === '/') {
            assert(this.chew(true) === '/');
            while (this.chew(true) !== '\n')
                ;
            return true;
        } else {
            this.spit();
            return false;
        }
    }

    private skipcomment(): void {
        while (this.skipcomment2()) ;
    }

    private chew(white: boolean = false) {
        if (!white)
            this.skipwhite();
        return this.S.charAt(this.pos++);
    }

    private spit(): void {
        this.pos--;
    }

    private obj(): VKFPair[] {
        // already consumed "{"
        const val: VKFPair[] = [];
        while (this.hastok()) {
            const tok = this.chew();
            if (tok == "}") {
                return val;
            } else {
                this.spit();
            }

            val.push(this.pair());
            this.skipcomment();
        }
        return val;
    }

    private quote(delim: string): string {
        // already consumed delim
        let val = "";
        while (this.hastok()) {
            const tok = this.chew(true);
            if (tok == delim)
                return val;
            else
                val += tok;
        }
        debugger;
        throw "whoops";
    }

    private run(t: RegExp, start: string): string {
        let val = start;
        while (this.hastok()) {
            const tok = this.chew(true);
            if (t.test(tok)) {
                val += tok;
            } else {
                this.spit();
                break;
            }
        }
        return val;
    }

    private num(start: string): string {
        return this.run(/[0-9.]/, start);
    }

    private unquote(start: string): string {
        return this.run(/[a-zA-Z$]/, start);
    }

    public unit(): any {
        this.skipcomment();

        const tok = this.chew();
        if (tok === '{')
            return this.obj();
        else if (tok === '"')
            return this.quote(tok);
        else if (/[a-zA-Z$%]/.test(tok))
            return this.unquote(tok);
        else if (/[-0-9.]/.test(tok))
            return this.num(tok);
        debugger;
        throw "whoops";
    }

    public pair(): VKFPair {
        const k = (this.unit() as string).toLowerCase();
        const v = this.unit();
        return [k, v];
    }
}

function pairs2obj(pairs: VKFPair[], recurse: boolean = false): any {
    const o: any = {};
    for (let i = 0; i < pairs.length; i++) {
        const [k, v] = pairs[i];
        o[k] = (recurse && typeof v === 'object') ? pairs2obj(v) : v;
    }
    return o;
}

function patch(dst: any, srcpair: VKFPair[], replace: boolean): void {
    if (srcpair === undefined)
        return;

    for (const [key, value] of srcpair) {
        if (key in dst || !replace) {
            if (typeof value === 'object')
                patch(dst[key], value, replace);
            else
                dst[key] = value;
        }
    }
}

export async function parseVMT(filesystem: SourceFileSystem, path: string, depth: number = 0): Promise<VMT> {
    async function parsePath(path: string): Promise<VMT> {
        path = filesystem.resolvePath(path);
        const buffer = assertExists(await filesystem.fetchFileData(path));
        const str = new TextDecoder('utf8').decode(buffer.createTypedArray(Uint8Array));

        const [k, v] = new ValveKeyValueParser(str).pair();
        const vmt = pairs2obj(v) as VMT;
        vmt._Root = k;
        vmt._Filename = path;

        if (vmt.proxies !== undefined) {
            const proxies = vmt.proxies as VKFPair[];
            for (let i = 0; i < proxies.length; i++)
                proxies[i][1] = pairs2obj(proxies[i][1], true);
        }

        return vmt;
    }

    const vmt = await parsePath(path);
    if (vmt._Root === 'patch') {
        const base = await parseVMT(filesystem, vmt['include'], depth++);
        patch(base, vmt.replace, true);
        patch(base, vmt.insert, false);
        base._Filename = vmt._Filename;
        return base;
    } else {
        return vmt;
    }
}

export function vmtParseVector(S: string): number[] {
    assert((S.startsWith('[') && S.endsWith(']')) || (S.startsWith('{') && S.endsWith('}')));
    const scale = S.startsWith('{') ? 1/255.0 : 1;
    return S.slice(1, -1).trim().split(/\s+/).map((item) => Number(item) * scale);
}

export function vmtParseColor(dst: Color, S: string): void {
    const v = vmtParseVector(S);
    assert(v.length === 3);
    colorFromRGBA(dst, v[0], v[1], v[2]);
}

export function vmtParseNumbers(S: string): number[] {
    return S.trim().split(/\s+/).map((item) => Number(item));
}

// This is in the same file because it also parses keyfiles, even though it's not material-related.
export interface BSPEntity {
    classname: string;
    [k: string]: string;
}

export function parseEntitiesLump(buffer: ArrayBufferSlice): BSPEntity[] {
    const str = new TextDecoder('utf8').decode(buffer.createTypedArray(Uint8Array));
    const p = new ValveKeyValueParser(str);
    const entities: BSPEntity[] = [];
    while (p.hastok()) {
        entities.push(pairs2obj(p.unit()) as BSPEntity);
        p.skipwhite();
    }
    return entities;
}
