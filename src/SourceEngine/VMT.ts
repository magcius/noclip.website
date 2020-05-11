
// Valve Material Type

import { assert, assertExists } from "../util";
import { SourceFileSystem } from "./Scenes_HalfLife2";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorNewFromRGBA } from "../Color";

export interface VMT {
    _Root: string;
    _Filename: string;

    // patch
    include: string;
    replace: any;

    // material
    $basetexture: string;
    $detail: string;
    $detailblendmode: string;
    $detailblendfactor: string;
    $detailscale: string;
    $alphatest: string;
    $alphatestreference: string;
    $additive: string;
    ['%compilesky']: string;
    ['%compiletrigger']: string;
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

    private obj(): any {
        // already consumed "{"
        const val: { [k: string]: any } = {};
        while (this.hastok()) {
            const tok = this.chew();
            if (tok == "}") {
                return val;
            } else {
                this.spit();
            }

            const [k, v] = this.pair();
            val[k] = v;
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

    private num(start: string): number {
        return Number(this.run(/[0-9.]/, start));
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

    public pair(): [string, any] {
        const k = (this.unit() as string).toLowerCase();
        const v = this.unit();
        return [k, v];
    }
}

export async function parseVMT(filesystem: SourceFileSystem, path: string, depth: number = 0): Promise<VMT> {
    async function parsePath(path: string): Promise<VMT> {
        path = filesystem.resolvePath(path);
        const buffer = assertExists(await filesystem.fetchFileData(path));
        const str = new TextDecoder('utf8').decode(buffer.createTypedArray(Uint8Array));

        const [k, v] = new ValveKeyValueParser(str).pair();
        const vmt = v as VMT;
        vmt._Root = k;
        vmt._Filename = path;

        return vmt;
    }

    const vmt = await parsePath(path);
    if (vmt._Root === 'patch') {
        const base = await parseVMT(filesystem, vmt['include'], depth++);
        Object.assign(base, vmt.replace);
        return base;
    } else {
        return vmt;
    }
}

export function vmtParseVector(S: string): number[] {
    assert((S.startsWith('[') && S.endsWith(']')) || (S.startsWith('{') && S.endsWith('}')));
    const scale = S.startsWith('{') ? 1/255.0 : 1;
    return S.slice(1, -1).split(/\s+/).map((item) => Number(item) * scale);
}

export function vmtParseColor(S: string): Color {
    const v = vmtParseVector(S);
    assert(v.length === 3);
    return colorNewFromRGBA(v[0], v[1], v[2]);
}

// This is in the same file because it also parses keyfiles, even though it's not material-related.
export interface Entity {
    classname: string;
    [k: string]: string;
}

export function parseEntitiesLump(buffer: ArrayBufferSlice): Entity[] {
    const str = new TextDecoder('utf8').decode(buffer.createTypedArray(Uint8Array));
    const p = new ValveKeyValueParser(str);
    const entities: Entity[] = [];
    while (p.hastok()) {
        entities.push(p.unit() as Entity);
        p.skipwhite();
    }
    return entities;
}
