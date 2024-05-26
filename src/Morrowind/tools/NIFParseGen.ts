
// Generates a NIF parser from nif.xml
// https://github.com/niftools/nifxml/blob/master/nif.xml

import * as dom from "@xmldom/xmldom";
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { assert, assertExists, fallbackUndefined, hexzero0x } from "../../util";
import { fileURLToPath } from "url";

// TODO(jstpierre):
//  - Runtime version checks

//#region Expression Parser
type MacroMap = Map<string, string>;

interface TokenNum { kind: 'Num'; num: number; }
interface TokenID { kind: 'ID'; id: string; }
interface TokenOther { kind: string; }

type Token = TokenNum | TokenID | TokenOther;

function lex(macroMap: MacroMap, s: string): Token[] {
    let c = 0;
    function headChar(): string { return s[c]; }
    function nextChar(): string { return s[c++]; }
    function nextSlice(n: number) { return s.slice(c, c + n); }
    function advance(n: number) { c += n; }

    function constructBasicTokens(m: string[]) {
        type LiteralToken = { length: number, m: string[] };
        const o: { [k: string]: LiteralToken } = {};
        const p: LiteralToken[] = [];
        for (const t of m) {
            const len = t.length;
            let nl = o[len];
            if (!nl) {
                nl = o[len] = { length: len, m: [] };
                p.push(nl);
            }
            nl.m.push(t);
        }
        p.sort((a, b) => (b.length - a.length));
        return p;
    }
    
    const basicTokens = constructBasicTokens([
        '==', '!=', '<', '<=', '>=', '>',
        '||', '&&',
        '|', '&', '^',
        '>>', '<<',
        '+', '-', '++', '--',
        '*', '/', '%',
        '!', '~',

        '=',
        '||=', '&&=',
        '|=', '&=', '^=',
        '>>=', '<<=',
        '+=', '-=',
        '*=', '/=', '%=',
        '!=', '~=',

        '(', ')',
    ]);

    function macro(): Token[] {
        let b = nextChar();
        assert(b === '#');
        do { b += nextChar() } while (!b.endsWith('#'));

        const expand = assertExists(macroMap.get(b));
        return lex(macroMap, expand);
    }

    function identifier() {
        let b = nextChar();
        while (headChar() && headChar().match(/[a-zA-Z0-9$_\\]/))
            b += nextChar();
        return { kind: 'ID', id: b };
    }

    function number() {
        let b = '';
        while (headChar() && headChar().match(/[0-9.ef\-x]/))
            b += nextChar();

        // Versions contain dots, integers don't.
        const numSeg = b.split('.').length;
        const num = numSeg === 4 ? parseVersionStr(b) : numSeg === 1 ? parseFloat(b) : parseInt(b);
        return { kind: 'Num', num };
    }

    function pushToken(t: Token): void {
        const lastToken = tokens[tokens.length - 1] as TokenID;
        if (tokens.length > 0 && lastToken.kind === "ID") {
            if (t.kind === 'ID') {
                lastToken.id += ` ${(t as TokenID).id}`;
                return;
            } else if (t.kind === 'Num') {
                lastToken.id += ` ${(t as TokenNum).num}`;
                return;
            }
        }

        tokens.push(t);
    }

    const tokens: Token[] = [];
    loop: while (true) {
        const m = headChar();
        if (m === undefined)
            break;
        // ignore white
        if (m.match(/\s/) && nextChar()) {
            continue;
        }
        if (m.match(/\d/)) {
            pushToken(number());
            continue;
        }
        if (m === '#') {
            tokens.push(...macro());
            continue;
        }

        for (const group of basicTokens) {
            const token = nextSlice(group.length);
            if (group.m.includes(token)) {
                advance(group.length);
                pushToken({ kind: token });
                continue loop;
            }
        }

        pushToken(identifier());
    }

    return tokens;
}

interface ExprCtx {
    exprLoad(id: string): boolean | number | null;
    exprMapName(id: string): string;
}

interface Expr {
    eval(ctx: ExprCtx): boolean | number | null;
    generate(ctx: ExprCtx): string;
}

class BinaryExpr implements Expr {
    constructor(public op: string, public lhs: Expr, public rhs: Expr) {
    }

    public eval(ctx: ExprCtx) {
        const lhs = this.lhs.eval(ctx);
        const rhs = this.rhs.eval(ctx);
        if (lhs === null || rhs === null)
            return null;

        switch (this.op) {
            case '+': return Number(lhs) + Number(rhs);
            case '-': return Number(lhs) - Number(rhs);
            case '*': return Number(lhs) * Number(rhs);
            case '/': return Number(lhs) / Number(rhs);
            case '&&': return lhs && rhs;
            case '||': return lhs || rhs;
            case '==': return Number(lhs) === Number(rhs);
            case '!=': return Number(lhs) !== Number(rhs);
            case '>': return Number(lhs) > Number(rhs);
            case '<': return Number(lhs) < Number(rhs);
            case '>=': return Number(lhs) >= Number(rhs);
            case '<=': return Number(lhs) <= Number(rhs);
            default: throw `whoops ${this.op}`;
        }
    }

    public generate(ctx: ExprCtx): string {
        const lhs = this.lhs.generate(ctx);
        const rhs = this.rhs.generate(ctx);
        const op =
            this.op === "==" ? "===" :
            this.op === "!=" ? "!==" :
            this.op;
        return `(${lhs} ${op} ${rhs})`;
    }
}

class UnaryExpr implements Expr {
    constructor(public op: string, public rhs: Expr) {
    }

    public eval(ctx: ExprCtx) {
        const rhs = this.rhs.eval(ctx);
        if (rhs === null)
            return null;

        switch (this.op) {
            case '!': return !rhs;
            default: throw "whoops";
        }
    }

    public generate(ctx: ExprCtx): string {
        const rhs = this.rhs.generate(ctx);
        return `(${this.op}${rhs})`;
    }
}

class LoadExpr implements Expr {
    constructor(public id: string) {
    }

    public eval(ctx: ExprCtx) {
        return ctx.exprLoad(this.id);
    }

    public generate(ctx: ExprCtx): string {
        return ctx.exprMapName(this.id);
    }
}

class NumberLiteralExpr implements Expr {
    constructor(public literal: number) {
    }

    public eval(ctx: ExprCtx) {
        return this.literal;
    }

    public generate(ctx: ExprCtx): string {
        return '' + this.literal;
    }
}

class Parser {
    constructor(private tokens: Token[]) {
    }

    private s = 0;

    private peek(): Token | null {
        if (this.s >= this.tokens.length)
            return null;
        return this.tokens[this.s];
    }

    private peekKind(): string | null {
        const t = this.peek();
        return t !== null ? t.kind : null;
    }

    private chew(): Token | null {
        if (this.s >= this.tokens.length)
            return null;
        return this.tokens[this.s++];
    }

    private expect<T extends Token>(k: string): T {
        const m = this.chew();
        assert(m !== null && m.kind === k);
        return m as T;
    }

    private expectID() {
        return this.expect<TokenID>('ID').id;
    }

    private expectNumber() {
        return this.expect<TokenNum>('Num').num;
    }

    private parenExpr(): Expr {
        this.expect('(');
        const expr = this.expr();
        this.expect(')');
        return expr;
    }

    private value(): Expr {
        switch (this.peekKind()) {
        case 'ID':
            return new LoadExpr(this.expectID());
        case 'Num':
            return new NumberLiteralExpr(this.expectNumber());
        case '(':
            return this.parenExpr();
        default:
            assert(false);
        }
    }

    private unaryExpr(): Expr {
        if (['!', '~', '+', '-'].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            return new UnaryExpr(op, this.unaryExpr());
        } else {
            return this.value();
        }
    }

    private multiplicativeExpr(): Expr {
        let lhs = this.unaryExpr();
        while (['*', '/', '%'].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            const rhs = this.unaryExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private additiveExpr(): Expr {
        let lhs = this.multiplicativeExpr();
        while (['+', '-'].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            const rhs = this.multiplicativeExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private shiftExpr(): Expr {
        let lhs = this.additiveExpr();
        while (['<<', '>>'].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            const rhs = this.additiveExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private relationalExpr(): Expr {
        let lhs = this.shiftExpr();
        while (['<', '<=', '>', '>='].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            const rhs = this.shiftExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private equalityExpr(): Expr {
        let lhs = this.relationalExpr();
        while (['==', '!='].includes(this.peekKind()!)) {
            const op = this.chew()!.kind;
            const rhs = this.relationalExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private bitwiseAndExpr(): Expr {
        let lhs = this.equalityExpr();
        while (this.peekKind() === '&') {
            const op = this.chew()!.kind;
            const rhs = this.equalityExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private bitwiseOrExpr(): Expr {
        let lhs = this.bitwiseAndExpr();
        while (this.peekKind() === '|') {
            const op = this.chew()!.kind;
            const rhs = this.bitwiseAndExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private logicalAndExpr(): Expr {
        let lhs = this.bitwiseOrExpr();
        while (this.peekKind() === '&&') {
            const op = this.chew()!.kind;
            const rhs = this.bitwiseOrExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    private logicalOrExpr(): Expr {
        let lhs = this.logicalAndExpr();
        while (this.peekKind() === '||') {
            const op = this.chew()!.kind;
            const rhs = this.logicalAndExpr();
            lhs = new BinaryExpr(op, lhs, rhs);
        }
        return lhs;
    }

    public expr(): Expr {
        return this.logicalOrExpr();
    }
}

function parseExpr(s: string, attr: string, context: NifXML) {
    const macroMap = context.getMacroMap(attr);
    const tokens = [...lex(macroMap, s)];
    const ast = new Parser(tokens).expr();
    return ast;
}
//#endregion

function relpath(p: string): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), p);
}

function fixEmpty(str: string | null): string | null {
    return str ? str : null;
}

function parseVersionStr(versionStr: string): number {
    // 20.10.2.1
    const p = versionStr.split('.').map((v) => parseInt(v));
    p.push(0); p.push(0); p.push(0); p.push(0);
    return p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3];
}

function fixIndent(inp: TemplateStringsArray, ...va: string[]): string {
    let S = '';
    for (let i = 0; i < inp.length - 1; i++) {
        S += inp[i];
        const indent = /^\s*/.exec(S.split('\n').filter(v => v).pop()!)!;
        S += va[i].split('\n').map((v, j) => j > 0 ? indent + v : v).join('\n');
    }
    S += inp[inp.length - 1];
    return S;
}

class ModuleImport {
    public items: Set<string>;

    constructor(public moduleName: string, items: string[]) {
        this.items = new Set<string>(items);
    }

    public union(other: ModuleImport): void {
        for (const v of other.items)
            this.items.add(v);
    }

    public generate(): string {
        const items = [...this.items.values()].sort();
        return `import { ${items.join(', ')} } from "${this.moduleName}";`;
    }
}

interface Type {
    name: string;
    fieldInitializer: string | null;
    fieldGenerateParse(context: NifXML, dst: string, arg?: string): string;
    specialize?(context: StructField): Type;
    generateBody?(context: NifXML): string;
    generateImports?(): ModuleImport[];
    resolve?(context: NifXML): void;
    findTypes(set: Set<Type>): void;
}

class BasicType implements Type {
    constructor(public name: string, public readMethod: string) {}

    public get fieldInitializer(): string | null { return null; }
    public fieldGenerateParse(context: NifXML, dst: string): string { return `${dst} = stream.${this.readMethod}();`; }
    public findTypes(set: Set<Type>) { set.add(this); }
}

class ExtraType implements Type {
    constructor(public module: string, public name: string, public createMethod: string, public readMethod: string, public extraSymbols: string[] = []) {
    }

    public get fieldInitializer(): string | null { return this.createMethod; }
    public fieldGenerateParse(context: NifXML, dst: string): string { return `stream.${this.readMethod}(${dst});`; }
    public findTypes(set: Set<Type>) { set.add(this); }
    public generateImports(): ModuleImport[] {
        if (this.module !== null)
            return [new ModuleImport(this.module, [this.name, ... this.extraSymbols])];
        return [];
    }
}

abstract class ClassType implements Type {
    public abstract name: string;

    public get fieldInitializer(): string | null { return `new ${this.name}()`; }
    public fieldGenerateParse(context: NifXML, dst: string, arg?: string): string { return `${dst}.parse(stream${arg ? `, ${arg}` : ``});`; }
    public findTypes(set: Set<Type>) { set.add(this); }
}

class ArrayType implements Type {
    public name: string;

    constructor(public baseType: Type, public length: string, public width: string | null) {
        this.name = `${baseType.name}[]`;
        if (this.width !== null)
            this.name = `${this.name}[]`;
    }

    public get fieldInitializer(): string | null { return `[]`; }
    public fieldGenerateParse(context: NifXML, dst: string): string {
        if (this.width !== null) {
            return fixIndent`for (let i = 0; i < ${this.length}; i++) {
    ${dst}[i] = [];
    for (let j = 0; j < ${this.width}; j++) {
        ${this.baseType.fieldInitializer !== null ? `${dst}[i][j] = ${this.baseType.fieldInitializer};
` : ``}${this.baseType.fieldGenerateParse(context, `${dst}[i][j]`)}
    }
}`;
        } else {
            return fixIndent`for (let i = 0; i < ${this.length}; i++) {
    ${this.baseType.fieldInitializer !== null ? `${dst}[i] = ${this.baseType.fieldInitializer};
` : ``}${this.baseType.fieldGenerateParse(context, `${dst}[i]`)}
}`;
        }
    }
    public findTypes(set: Set<Type>) { this.baseType.findTypes(set); }
}

class CondType implements Type {
    public name: string;

    constructor(public baseType: Type, public cond: Expr) {
        this.name = `${baseType.name} | null`;
    }

    public get fieldInitializer(): string | null { return `null`; }
    public fieldGenerateParse(context: NifXML, dst: string): string {
        return fixIndent`if (${this.cond.generate(context)}) {
    ${this.baseType.fieldInitializer !== null ? `${dst} = ${this.baseType.fieldInitializer};
` : ``}${this.baseType.fieldGenerateParse(context, dst)}
}`;
    }
    public findTypes(set: Set<Type>) { this.baseType.findTypes(set); }
}

class EnumValue {
    public name: string;
    public value: number;

    constructor(context: NifXML, node: Element) {
        this.name = node.getAttribute("name")!;
        if (node.hasAttribute("value"))
            this.value = parseInt(node.getAttribute("value")!);
        else if (node.hasAttribute("bit"))
            this.value = 1 << parseInt(node.getAttribute("bit")!);
    }
}

class Enum implements Type {
    public name: string;
    public storage: Type;
    public value: EnumValue[] = [];

    constructor(context: NifXML, node: Element) {
        this.name = node.getAttribute("name")!;
        this.storage = context.getType(node.getAttribute("storage")!);

        for (let p = node.firstChild; p !== null; p = p.nextSibling)
            if (p.nodeType === p.ELEMENT_NODE && p.nodeName === "option")
                this.value.push(new EnumValue(context, p as Element));
    }

    public generateBody(): string {
        return `export const enum ${this.name} {
${this.value.map((v) => {
    return `    ${v.name} = ${v.value},`
}).join('\n')}
};
`;
    }

    public get fieldInitializer(): string | null { return null; }
    public fieldGenerateParse(context: NifXML, dst: string): string { return this.storage.fieldGenerateParse(context, dst); }
    public findTypes(set: Set<Type>): void {
        set.add(this);
        this.storage.findTypes(set);
    }
}

class BitfieldMember {
    public name: string;
    public pos: number;
    public width: number;
    public rawType: string;
    public type: Type;

    public memberName: string;

    constructor(context: NifXML, node: Element) {
        this.name = node.getAttribute("name")!;
        this.pos = parseInt(node.getAttribute("pos")!);
        this.width = parseInt(node.getAttribute("width")!);
        this.rawType = node.getAttribute("type")!;
        this.type = context.getType(this.rawType);

        this.memberName = makeMemberFieldName(this.name);
    }
}

class Bitfield extends ClassType {
    public name: string;
    public storage: Type;
    public member: BitfieldMember[] = [];

    constructor(context: NifXML, node: Element) {
        super();

        this.name = node.getAttribute("name")!;
        this.storage = context.getType(node.getAttribute("storage")!);

        for (let p = node.firstChild; p !== null; p = p.nextSibling)
            if (p.nodeType === p.ELEMENT_NODE && p.nodeName === "member")
                this.member.push(new BitfieldMember(context, p as Element));
    }

    public generateBody(context: NifXML): string {
        return `class ${this.name} {
${this.member.map((member) => {
    return `    public ${member.memberName}: ${member.type.name};`;
}).join('\n')}

    public parse(stream: Stream): void {
        ${this.storage.fieldGenerateParse(context, 'const internal')}
${this.member.map((member) => {
    const widthMask = (1 << member.width) - 1;
    let value = `(internal >>> ${member.pos}) & ${hexzero0x(widthMask, 8)}`;
    if (member.type.name === 'boolean')
        value = `!!(${value})`;
    return `        this.${member.memberName} = ${value};`;
}).join('\n')}
    }
}
`;
    }

    public findTypes(set: Set<Type>): void {
        set.add(this);
        this.storage.findTypes(set);
        for (const member of this.member)
            set.add(member.type);
    }
}

function makeMemberFieldName(s: string): string {
    s = s.replace(/ /g, '');
    s = s[0].toLowerCase() + s.slice(1);
    return s;
}

class StructField {
    public rawName: string;
    public rawType: string;
    public rawTemplate: string | null;
    public rawLength: string | null;
    public rawWidth: string | null;
    public rawCond: string | null;
    public rawVerCond: string | null;
    public since: number | null;
    public until: number | null;
    public arg: string;

    public name: string;
    public type: Type;
    public template: Type | null = null;
    public length: Expr | null = null;
    public width: Expr | null = null;
    public cond: Expr | null = null;
    public verCond: Expr | null = null;

    public isMember = true;
    public protection = `public`;
    public isVisible = true;
    public runtimeCheckSince = true;
    public runtimeCheckUntil = true;
    public runtimeCheckCond = false;
    public runtimeCheckVerCond = false;

    constructor(context: NifXML, node: Element) {
        this.rawName = assertExists(node.getAttribute('name'));
        this.rawType = assertExists(node.getAttribute('type'));
        this.rawTemplate = fixEmpty(node.getAttribute('template'));
        this.rawLength = fixEmpty(node.getAttribute('length'));
        this.rawWidth = fixEmpty(node.getAttribute('width'));
        this.rawCond = fixEmpty(node.getAttribute('cond'));
        this.rawVerCond = fixEmpty(node.getAttribute('vercond'));
        this.since = node.getAttribute('since') ? parseVersionStr(node.getAttribute('since')!) : null;
        this.until = node.getAttribute('until') ? parseVersionStr(node.getAttribute('until')!) : null;
        this.arg = node.getAttribute('arg')!;

        this.name = makeMemberFieldName(this.rawName);

        if (this.rawLength !== null)
            this.length = parseExpr(this.rawLength, `length`, context);
        if (this.rawWidth !== null)
            this.width = parseExpr(this.rawWidth, `length`, context);
        if (this.rawCond !== null)
            this.cond = parseExpr(this.rawCond, `cond`, context);
        if (this.rawVerCond !== null)
            this.verCond = parseExpr(this.rawVerCond, `vercond`, context);

        this.checkVersion(context);
    }

    public checkVersion(context: NifXML): void {
        const versionBounds = context.versionBounds;
        if (this.since !== null && versionBounds.minVersion !== null && this.since < versionBounds.minVersion)
            this.runtimeCheckSince = false;
        if (this.since !== null && versionBounds.maxVersion !== null && this.since >= versionBounds.maxVersion)
            this.isVisible = false;

        if (this.until !== null && versionBounds.minVersion !== null && this.until < versionBounds.minVersion)
            this.isVisible = false;
        if (this.until !== null && versionBounds.maxVersion !== null && this.until >= versionBounds.maxVersion)
            this.runtimeCheckUntil = false;
    }

    public checkCond(context: NifXML): void {
        if (this.cond === null)
            return;

        const r = this.cond.eval(context);
        if (r === null) {
            this.runtimeCheckCond = true;
            return;
        }

        if (!r)
            this.isVisible = false;
    }

    public checkVerCond(context: NifXML): void {
        if (this.verCond === null)
            return;

        const r = this.verCond.eval(context);
        if (r === null) {
            this.runtimeCheckVerCond = true;
            return;
        }

        if (!r)
            this.isVisible = false;
    }

    public generateMember(context: NifXML): string {
        // const type = 
        return ``;
    }

    public generateParse(context: NifXML): string {
        // TODO(jstpierre): Runtime version checks
        const dst = this.isMember ? `this.${this.name}` : `const ${this.name}`;
        const arg = this.arg === '#ARG#' ? 'arg' : this.arg;

        return `${this.type.fieldGenerateParse(context, dst, arg)}`;
    }

    private resolveLength(raw: string | null, expr: Expr | null, struct: Struct, context: NifXML): string | null {
        if (raw === null)
            return null;

        const lengthField = struct.getField(raw);
        if (lengthField !== null) {
            if (struct.fields.includes(lengthField)) {
                lengthField.isMember = false;
                return lengthField.name;
            } else {
                lengthField.protection = `protected`;
                return `this.${lengthField.name}`;
            }
        } else if (expr !== null) {
            return expr.generate(context);
        } else {
            return raw;
        }
    }

    public resolve(struct: Struct, context: NifXML): void {
        if (this.rawTemplate !== null)
            this.template = context.getType(this.rawTemplate, this);

        this.type = context.getType(this.rawType, this);
        if (this.length !== null) {
            const length = assertExists(this.resolveLength(this.rawLength, this.length, struct, context));
            const width = this.resolveLength(this.rawWidth, this.width, struct, context);
            this.type = new ArrayType(this.type, length, width);
        }

        this.checkCond(context);
        this.checkVerCond(context);

        if (this.runtimeCheckCond)
            this.type = new CondType(this.type, this.cond!);
        if (this.runtimeCheckVerCond)
            this.type = new CondType(this.type, this.verCond!);
    }
}

class Struct extends ClassType {
    public name: string;
    public rawInherit: string | null;
    public inherit: Type | null;
    public generic: boolean = false;
    public fields: StructField[] = [];
    public isNiObject = false;

    constructor(context: NifXML, node: Element) {
        super();

        this.name = assertExists(node.getAttribute(`name`));
        this.rawInherit = fixEmpty(node.getAttribute(`inherit`));
        this.generic = node.getAttribute("generic") === "true";
        this.isNiObject = node.nodeName === "niobject";

        if (this.generic) // TODO
            return;

        for (let p: Node | null = node.firstChild; p !== null; p = p.nextSibling)
            if (p.nodeName === "field")
                this.fields.push(new StructField(context, p as Element));
    }

    public resolve(context: NifXML): void {
        this.inherit = this.rawInherit ? context.getType(this.rawInherit) : null;

        for (let i = 0; i < this.fields.length; i++)
            this.fields[i].resolve(this, context);
    }

    public getField(rawName: string): StructField | null {
        const v = fallbackUndefined(this.fields.find((field) => field.rawName === rawName), null);
        if (v !== null)
            return v;
        if (this.inherit instanceof Struct)
            return this.inherit.getField(rawName);
        return null;
    }

    public getVisibleFields() {
        return this.fields.filter((field) => field.isVisible);
    }

    public getMemberFields() {
        return this.fields.filter((field) => field.isMember && field.isVisible);
    }

    public generateBody(context: NifXML): string {
        const extend = this.inherit !== null ? ` extends ${this.inherit.name}` : ``;

        const memberFields = this.getVisibleFields();
        const visibleFields = this.getVisibleFields();

        return `${this.isNiObject ? `export ` : ``}class ${this.name}${extend} {
${memberFields.length !== 0 ? memberFields.map((field) => {
    return `    ${field.protection} ${field.name}: ${field.type.name}${field.type.fieldInitializer !== null ? ` = ${field.type.fieldInitializer}` : ``};`;
}).join('\n') + `\n\n` : ``}    public ${this.inherit !== null ? `override ` : ``}parse(stream: Stream, arg: number | null = null): void {${this.inherit !== null ? `
        super.parse(stream, arg);` : ``}
${visibleFields.length !== 0 ? visibleFields.map((field) => fixIndent`        ${field.generateParse(context)}`).join('\n') + '\n' : ``}    }
}
`;
    }

    public findTypes(set: Set<Type>): void {
        if (set.has(this))
            return;

        set.add(this);
        if (this.inherit !== null)
            this.inherit.findTypes(set);
        const fields = this.getVisibleFields();
        for (let i = 0; i < fields.length; i++)
            fields[i].type.findTypes(set);
    }
}

class Ref extends ClassType {
    constructor(public name: string, public specializedType: Type | null = null) {
        super();
    }

    public specialize(field: StructField) {
        return new Ref(`${this.name}<${field.rawTemplate}>`, field.template);
    }

    public override findTypes(set: Set<Type>): void {
        super.findTypes(set);
        if (this.specializedType !== null)
            this.specializedType.findTypes(set);
    }
}

class VersionBounds {
    public minVersion: number | null = null;
    public maxVersion: number | null = null;
    public minUserVersion: number | null = null;
    public maxUserVersion: number | null = null;
    public minBSVersion: number | null = null;
    public maxBSVersion: number | null = null;

    public get exactVersion(): number | null {
        if (this.minVersion === this.maxVersion) return this.minVersion;
        return null;
    }

    public set exactVersion(v: number | null) {
        this.minVersion = this.maxVersion = v;
    }

    public get exactUserVersion(): number | null {
        if (this.minUserVersion === this.maxUserVersion) return this.minUserVersion;
        return null;
    }

    public set exactUserVersion(v: number | null) {
        this.minUserVersion = this.maxUserVersion = v;
    }

    public get exactBSVersion(): number | null {
        if (this.minBSVersion === this.maxBSVersion) return this.minBSVersion;
        return null;
    }

    public set exactBSVersion(v: number | null) {
        this.minBSVersion = this.maxBSVersion = v;
    }
}

class NifXML implements ExprCtx {
    public types: Type[] = [];

    private typeRegistry = new Map<string, Type>();
    public macroRegistry = new Map<string, Map<string, string>>();

    constructor(public versionBounds: VersionBounds, filePath = relpath("nif.xml")) {
        this.registerBasicTypes();

        const str = readFileSync(filePath, { encoding: 'utf8' });
        const parser = new dom.DOMParser();
        const doc = parser.parseFromString(str);
        this.parseXML(doc);

        this.resolve();
    }

    public registerBasicTypes(): void {
        this.registerType(`HeaderString`, new BasicType(`string`, `readLine`));
        this.registerType(`LineString`, new BasicType(`string`, `readLine`));
        this.registerType(`FileVersion`, new BasicType(`number`, `readUint32`));
        this.registerType(`byte`, new BasicType(`number`, `readUint8`));
        this.registerType(`sbyte`, new BasicType(`number`, `readInt8`));
        this.registerType(`bool`, new BasicType(`boolean`, `readBool`));
        this.registerType(`normbyte`, new BasicType(`number`, `readUint8Norm`));
        this.registerType(`char`, new BasicType(`number`, `readUint8`));
        this.registerType(`ushort`, new BasicType(`number`, `readUint16`));
        this.registerType(`short`, new BasicType(`number`, `readInt16`));
        this.registerType(`uint`, new BasicType(`number`, `readUint32`));
        this.registerType(`int`, new BasicType(`number`, `readInt32`));
        this.registerType(`uint64`, new BasicType(`bigint`, `readUint64`));
        this.registerType(`ulittle32`, new BasicType(`number`, `readUint32L`));
        this.registerType(`float`, new BasicType(`number`, `readFloat32`));
        this.registerType(`hfloat`, new BasicType(`number`, `readFloat16`));
        this.registerType(`SizedString`, new BasicType(`string`, `readSizedString`));
        this.registerType(`string`, new BasicType(`string`, `readString`));
        this.registerType(`NiFixedString`, new BasicType(`number`, `readUint32`));
        this.registerType(`StringOffset`, new BasicType(`number`, `readUint32`));
        this.registerType(`BlockTypeIndex`, new BasicType(`number`, `readUint16`));
        this.registerType(`Ref`, new Ref(`RecordRef`));
        this.registerType(`Ptr`, new Ref(`RecordRef`));

        // Overrides
        this.registerType(`Vector3`, new ExtraType(`gl-matrix`, `vec3`, `vec3.create()`, `readVector3`));
        this.registerType(`Matrix33`, new ExtraType(`gl-matrix`, `mat3`, `mat3.create()`, `readMatrix33`));
        this.registerType(`Color4`, new ExtraType(`../Color.js`, `Color`, `colorNewCopy(White)`, `readColor`, [`colorNewCopy`, `White`]));
    }

    public registerType(name: string, type: Type): void {
        if (this.typeRegistry.has(name))
            return;

        this.typeRegistry.set(name, type);
        this.types.push(type);
    }

    private parseElem(p: Element): void {
        if (p.nodeName === "enum" || p.nodeName === "bitflags") {
            const type = new Enum(this, p);
            this.registerType(type.name, type);
        } else if (p.nodeName === "bitfield") {
            const type = new Bitfield(this, p);
            this.registerType(type.name, type);
        } else if (p.nodeName === "struct" || p.nodeName === "niobject") {
            const type = new Struct(this, p);
            this.registerType(type.name, type);
        } else if (p.nodeName === "token") {
            this.parseToken(p);
        }
    }

    private parseToken(elem: Element): void {
        const name = assertExists(elem.getAttribute("name"));
        const attrs = assertExists(elem.getAttribute("attrs")).split(' ');

        const newMacroMap = () => {
            const macroMap = new Map<string, string>();
            macroMap.set(`#ARG#`, `arg`);
            macroMap.set(`#ARG1#`, `arg`);
            return macroMap;
        };

        const macroMaps = attrs.map((attr) => {
            if (!this.macroRegistry.has(attr))
                this.macroRegistry.set(attr, newMacroMap());
            return this.macroRegistry.get(attr)!;
        });

        for (let p = elem.firstChild; p !== null; p = p.nextSibling) {
            if (p.nodeType !== p.ELEMENT_NODE)
                continue;

            const c = p as Element;
            if (c.nodeName === name) {
                const token = assertExists(c.getAttribute("token"));
                const string = assertExists(c.getAttribute("string"));
                for (const macroMap of macroMaps)
                    macroMap.set(token, string);
            }
        }
    }

    public getMacroMap(attr: string): MacroMap {
        return assertExists(this.macroRegistry.get(attr));
    }

    public parseXML(doc: Document): void {
        for (let p = doc.documentElement.firstChild; p !== null; p = p.nextSibling) {
            if (p.nodeType !== p.ELEMENT_NODE)
                continue;

            this.parseElem(p as Element);
        }
    }

    public resolve(): void {
        for (let i = 0; i < this.types.length; i++) {
            const type = this.types[i];
            if (type.resolve !== undefined)
                type.resolve(this);
        }
    }

    public getType(rawType: string, context: StructField | null = null): Type {
        let p = this.typeRegistry.get(rawType);
        if (p === undefined)
            throw new Error(`Missing type ${rawType}`);
        if (p.specialize)
            p = p.specialize(assertExists(context));
        return p;
    }

    public exprLoad(id: string): number | boolean | null {
        if (id === `Version`)
            return this.versionBounds.exactVersion;
        else if (id === `User Version`)
            return this.versionBounds.exactUserVersion;
        else if (id === `BS Header\\BS Version`)
            return this.versionBounds.exactBSVersion;
        return null;
    }

    public exprMapName(id: string) {
        return `this.${makeMemberFieldName(id)}`;
    }
}

class CodeGenerator {
    private includedTypes = new Set<Type>();

    constructor(private context: NifXML) {
    }

    public addType(rawTypeName: string): void {
        const type = this.context.getType(rawTypeName);
        type.findTypes(this.includedTypes);
    }

    public generate(): string {
        const imports = new Map<string, ModuleImport>();
        let body = '';

        const types = this.context.types.filter((type) => this.includedTypes.has(type));
        for (const type of types) {
            if (type.generateImports) {
                for (const module of type.generateImports()) {
                    if (imports.has(module.moduleName))
                        imports.get(module.moduleName)!.union(module);
                    else
                        imports.set(module.moduleName, module);
                }
            }

            if (type.generateBody) {
                body += `${type.generateBody(this.context)}\n`;
            }
        }

        const objects = types.filter((type) => type instanceof Struct && type.isNiObject);
        const newRecord = `export function newRecord(recordType: string): NiParse {
    switch (recordType) {
${objects.map((type) => `        case '${type.name}': return new ${type.name}();`).join('\n')}
        default: throw "whoops";
    }
}`;

        const importsStr = [...imports.values()].map((v) => v.generate()).join('\n');
        return `
// Generated by NIFParseGen
${importsStr}
import { Stream, RecordRef, NiParse } from "./NIFBase.js";

export namespace NIFParse {

${body}${newRecord}
}
`;
    }
}

function main() {
    const versionBounds = new VersionBounds();
    versionBounds.exactVersion = parseVersionStr('4.0.0.2');
    versionBounds.exactUserVersion = 0;
    versionBounds.exactBSVersion = 0;

    const xml = new NifXML(versionBounds);
    const generator = new CodeGenerator(xml);
    generator.addType('NiTriShape');
    generator.addType('NiTriShapeData');
    generator.addType('NiTexturingProperty');
    generator.addType('NiMaterialProperty');
    generator.addType('NiAlphaProperty');
    generator.addType('NiVertexColorProperty');
    generator.addType('NiStringExtraData');
    generator.addType('NiTextureEffect');
    generator.addType('RootCollisionNode');
    // generator.addType('NiAdditionalGeometryData');

    xml.getType('NiGeometryData').generateBody = () => {
        // hand-write for now
        return `
class NiGeometryData extends NiObject {
    public hasVertices: boolean;
    public vertices: vec3[] | null = null;
    public hasNormals: boolean;
    public normals: vec3[] | null = null;
    public boundingSphere: NiBound = new NiBound();
    public hasVertexColors: boolean;
    public vertexColors: Color[] | null = null;
    public dataFlags: NiGeometryDataFlags = new NiGeometryDataFlags();
    public hasUV: boolean;
    public uVSets: TexCoord[][] = [];

    public override parse(stream: Stream, arg: number | null = null): void {
        super.parse(stream, arg);
        const numVertices = stream.readUint16();
        this.hasVertices = stream.readBool();
        if (this.hasVertices) {
            this.vertices = [];
            for (let i = 0; i < numVertices; i++) {
                this.vertices[i] = vec3.create();
                stream.readVector3(this.vertices[i]);
            }
        }
        this.hasNormals = stream.readBool();
        if (this.hasNormals) {
            this.normals = [];
            for (let i = 0; i < numVertices; i++) {
                this.normals[i] = vec3.create();
                stream.readVector3(this.normals[i]);
            }
        }
        this.boundingSphere.parse(stream);
        this.hasVertexColors = stream.readBool();
        if (this.hasVertexColors) {
            this.vertexColors = [];
            for (let i = 0; i < numVertices; i++) {
                this.vertexColors[i] = colorNewCopy(White);
                stream.readColor(this.vertexColors[i]);
            }
        }
        this.dataFlags.parse(stream);
        this.hasUV = stream.readBool();
        for (let i = 0; i < this.dataFlags.numUVSets; i++) {
            this.uVSets[i] = [];
            for (let j = 0; j < numVertices; j++) {
                this.uVSets[i][j] = new TexCoord();
                this.uVSets[i][j].parse(stream);
            }
        }
    }
}`;
    };

    writeFileSync(relpath("../NIFParse.ts"), generator.generate());
    // console.log(generator.generate());
}

main();
