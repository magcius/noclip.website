
// Valve Material Type

import { arrayRemove, assertExists } from "../util";
import { SourceFileSystem } from "./Main";
import { Color } from "../Color";

export type VKFParamMap = { [k: string]: string };
export type VKFPairUnit = string | number | VKFPair[];
export type VKFPair<T extends VKFPairUnit = VKFPairUnit> = [string, T];

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
    [k: string]: VKFPairUnit;
}

export class ValveKeyValueParser {
    private pos = 0;

    constructor(private S: string) {
    }

    public hastok() {
        return (this.pos < this.S.length);
    }

    public skipwhite(): void {
        while (this.hastok()) {
            const tok = this.S.charAt(this.pos);
            if (/\s|[`\0]/.test(tok))
                this.pos++;
            else
                return;
        }
    }

    private skipcomment2(): boolean {
        if (this.chew() === '/') {
            const ch = this.chew(true);
            if (ch === '/') {
                while (this.chew(true) !== '\n')
                    ;
                return true;
            } else if (ch === '*') {
                this.pos = this.S.indexOf('*/', this.pos) + 2;
                return true;
            } else {
                throw "whoops";
            }
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
            this.skipcomment();
            const tok = this.chew();
            if (tok === "}" || tok === "") {
                return val;
            } else {
                this.spit();
            }

            val.push(this.pair());
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
        const num = this.run(/[0-9.]/, start);
        // numbers can have garbage at the end of them. this is ugly...
        // shoutouts to materials/models/props_lab/printout_sheet.vmt which has a random letter "y" after a number
        this.run(/[a-zA-Z]/, '');
        return num;
    }

    private unquote(start: string): string {
        return this.run(/[0-9a-zA-Z$%<>=/\\_]/, start);
    }

    public unit(): VKFPairUnit {
        this.skipcomment();

        const tok = this.chew();
        if (tok === '{')
            return this.obj();
        else if (tok === '"')
            return this.quote(tok);
        else if (/[a-zA-Z$%<>=/\\_]/.test(tok))
            return this.unquote(tok);
        else if (/[-0-9.]/.test(tok))
            return this.num(tok);
        console.log(tok);
        debugger;
        throw "whoops";
    }

    public pair<T extends VKFPairUnit>(): VKFPair<T> {
        const kk = this.unit();
        if (typeof kk !== 'string') debugger;
        const k = (kk as string).toLowerCase();
        const v = this.unit() as T;
        return [k, v];
    }
}

function convertPairsToObj(o: any, pairs: VKFPair[], recurse: boolean = false, supportsMultiple: boolean = true): void {
    for (let i = 0; i < pairs.length; i++) {
        const [k, v] = pairs[i];
        const vv = (recurse && typeof v === 'object') ? pairs2obj(v) : v;

        if (k in o) {
            if (supportsMultiple) {
                if (!Array.isArray(o[k]))
                    o[k] = [o[k]];
                o[k].push(vv);
            } else {
                // Take the first one.
                continue;
            }
        } else {
            o[k] = vv;
        }
    }
    return o;
}

export function pairs2obj(pairs: VKFPair[], recurse: boolean = false): any {
    const o: any = {};
    convertPairsToObj(o, pairs, recurse);
    return o;
}

function patch(dst: any, srcpair: VKFPair[] | null, replace: boolean): void {
    if (srcpair === null)
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

function stealPair(pairs: VKFPair[], name: string): VKFPair | null {
    const pair = pairs.find((pair) => pair[0] === name);
    if (pair === undefined)
        return null;

    arrayRemove(pairs, pair);
    return pair;
}

export async function parseVMT(filesystem: SourceFileSystem, path: string, depth: number = 0): Promise<VMT> {
    async function parsePath(path: string): Promise<VMT> {
        path = filesystem.resolvePath(path, '.vmt');
        if (!filesystem.hasEntry(path)) {
            // Amazingly, the material could be in materials/materials/, like is
            //    materials/materials/nature/2/blenddirttojunglegrass002b.vmt
            // from cp_mossrock
            path = `materials/${path}`;
        }
        if (!filesystem.hasEntry(path))
            path = `materials/editor/obsolete.vmt`;
        const buffer = assertExists(await filesystem.fetchFileData(path));
        const str = new TextDecoder('utf8').decode(buffer.createTypedArray(Uint8Array));

        // The data that comes out of the parser is a nested series of VKFPairs.
        const [rootK, rootObj] = new ValveKeyValueParser(str).pair<VKFPair[]>();

        // Start building our VMT.
        const vmt = {} as VMT;
        vmt._Root = rootK;
        vmt._Filename = path;

        // First, handle proxies if they exist as special, since there can be multiple keys with the same name.
        const proxiesPairs = stealPair(rootObj, 'proxies');
        if (proxiesPairs !== null) {
            const proxies = (proxiesPairs[1] as VKFPair[]).map(([name, value]) => {
                return [name, pairs2obj((value as VKFPair[]), true)];
            });
            vmt.proxies = proxies;
        }

        // Pull out replace / insert patching.
        const replace = stealPair(rootObj, 'replace');
        const insert = stealPair(rootObj, 'insert');

        // Now go through and convert all the other pairs. Note that if we encounter duplicates, we drop, rather
        // than convert to a list.
        const recurse = true, supportsMultiple = false;
        convertPairsToObj(vmt, rootObj, recurse, supportsMultiple);

        vmt.replace = replace !== null ? replace[1] : null;
        vmt.insert = insert !== null ? insert[1] : null;
        return vmt;
    }

    const vmt = await parsePath(path);
    if (vmt._Root === 'patch') {
        const base = await parseVMT(filesystem, vmt['include'], depth++);
        patch(base, vmt.replace, true);
        patch(base, vmt.insert, false);
        base._Patch = base._Filename;
        base._Filename = vmt._Filename;
        return base;
    } else {
        return vmt;
    }
}

export function vmtParseVector(S: string): number[] {
    // There are two syntaxes for vectors: [1.0 1.0 1.0] and {255 255 255}. These should both represent white.
    // In practice, combine_tower01b.vmt has "[.25 .25 .25}", so the starting delimeter is all that matters.
    // And factory_metal_floor001a.vmt has ".125 .125 .125" so I guess the square brackets are just decoration??

    const scale = S.startsWith('{') ? 1/255.0 : 1;
    S = S.replace(/[\[\]{}]/g, '').trim(); // Trim off all the brackets.
    return S.split(/\s+/).map((item) => Number(item) * scale);
}

export function vmtParseColor(dst: Color, S: string): void {
    const v = vmtParseVector(S);
    dst.r = v[0] / 255.0;
    dst.g = v[1] / 255.0;
    dst.b = v[2] / 255.0;
    dst.a = (v[3] !== undefined) ? (v[3] / 255.0) : 1.0;
}

export function vmtParseNumber(S: string | undefined, fallback: number): number {
    if (S !== undefined) {
        const v = vmtParseVector(S);
        if (v[0] !== undefined && !Number.isNaN(v[0]))
            return v[0];
    }
    return fallback;
}
