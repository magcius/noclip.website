
// https://github.com/PistonMiner/ttyd-tools/blob/master/ttyd-tools/ttydasm/ttydasm.cpp
// https://github.com/PistonMiner/ttyd-tools/blob/master/ttyd-tools/docs/ttyd-opc-summary.txt

import ArrayBufferSlice from "../ArrayBufferSlice";
import { hexzero0x, hexzero, decodeString, fallbackUndefined, readString, assert } from "../util";

interface evt_sym {
    name: string;
    filename: string;
}

class evt_map {
    private symbols = new Map<number, evt_sym>();

    constructor(buffer: ArrayBufferSlice) {
        const text = decodeString(buffer);
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // not a symbol
            if (!line.startsWith('8'))
                continue;

            const [addrStr, , , , name, filename] = line.split(' ');
            const addr = parseInt(addrStr, 16);
            this.symbols.set(addr, { name, filename });
        }
    }

    public getSymbol(addr: number): evt_sym | null {
        return fallbackUndefined(this.symbols.get(addr), null);
    }
}

enum op {
	END = 0x01,

    end_evt,
    lbl,
    goto,
    do,
    while,
    do_break,
    do_continue,
    wait_frm,
    wait_msec,
    halt,
    if_str_equal,
    if_str_not_equal,
    if_str_small,
    if_str_large,
    if_str_small_equal,
    if_str_large_equal,
    iff_equal,
    iff_not_equal,
    iff_small,
    iff_large,
    iff_small_equal,
    iff_large_equal,
    if_equal,
    if_not_equal,
    if_small,
    if_large,
    if_small_equal,
    if_large_equal,
    if_flag,
    if_not_flag,
    else,
    end_if,
    switch,
    switchi,
    case_equal,
    case_not_equal,
    case_small,
    case_large,
    case_small_equal,
    case_large_equal,
    case_etc,
    case_or,
    case_and,
    case_flag,
    case_end,
    case_between,
    switch_break,
    end_switch,
    set,
    seti,
    setf,
    add,
    sub,
    mul,
    div,
    mod,
    addf,
    subf,
    mulf,
    divf,
    set_read,
    read,
    read2,
    read3,
    read4,
    read_n,
    set_readf,
    readf,
    readf2,
    readf3,
    readf4,
    readf_n,
    set_user_wrk,
    set_user_flg,
    alloc_user_wrk,
    and,
    andi,
    or,
    ori,
    set_frame_from_msec,
    set_mesc_from_frame,
    set_ram,
    set_ramf,
    get_ram,
    get_ramf,
    setr,
    setrf,
    getr,
    getrf,
    user_func,
    run_evt,
    run_evt_id,
    run_child_evt,
    delete_evt,
    restart_evt,
    set_pri,
    set_spd,
    set_type,
    stop_all,
    start_all,
    stop_other,
    start_other,
    stop_id,
    start_id,
    chk_evt,
    inline_evt,
    inline_evt_id,
    end_inline,
    brother_evt,
    brother_evt_id,
    end_brother,
    debug_put_msg,
    debug_msg_clear,
    debug_put_reg,
    debug_name,
    debug_rem,
    debug_bp,
}

const enum evt_ptype {
    Decimal, Hex, UserCode, String, EvtAddr,
}

interface evt_opcode_tbl_entry {
    t: evt_ptype[];
    varargs: boolean;
}

function opt(t: evt_ptype[], varargs = false): evt_opcode_tbl_entry {
    return { t, varargs };
}

const evt_opcode_tbl: { [o: number]: evt_opcode_tbl_entry } = {
    [op.if_str_equal]:  opt([evt_ptype.String, evt_ptype.String]),
    [op.user_func]:     opt([evt_ptype.UserCode], true),
    [op.run_child_evt]: opt([evt_ptype.EvtAddr]),
    [op.run_evt]:       opt([evt_ptype.EvtAddr]),
};

class evt_disasm_sub {
    constructor(public addr: number, public name: string, public res: string | null = null) {
    }
}

export class evt_disasm_ctx {
    private mapFile: evt_map | null = null;
    private sub: evt_disasm_sub[] = [];

    constructor(private rel: ArrayBufferSlice, private baseAddress: number, private entryAddress: number, mapFileData: ArrayBufferSlice | null) {
        if (mapFileData !== null)
            this.mapFile = new evt_map(mapFileData);
    }

    private disasm_addr(addr: number, type: evt_ptype): string {
        if (type === evt_ptype.UserCode && this.mapFile !== null) {
            const sym = this.mapFile.getSymbol(addr);
            if (sym !== null)
                return `${sym.name}/${sym.filename}`;
        }

        if (type === evt_ptype.EvtAddr && addr >= this.baseAddress) {
            const sub = this.disasm_sub_maybe(addr);
            return sub.name;
        }

        if (type === evt_ptype.String && addr >= this.baseAddress) {
            const str = readString(this.rel, addr - this.baseAddress, 0xFF, true);
            return `"${str}"`;
        }

        // Try to guess.
        if (type === undefined) {
            const str = readString(this.rel, addr - this.baseAddress, 0xFF, true);
            if (str.length > 3 && str.split('').every((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) <= 0x7F))
                return `"${str}"`;
        }

        return `$${hexzero0x(addr, 8)}`;
    }

    private disasm_expr(uv: number, type: evt_ptype): string {
        const v = (uv | 0);
        if (v <= -250000000)
            return this.disasm_addr(uv, type);
        else if (v < -230000000)
            return `${(v - -230000000) / 1024.0}`;
        else if (v >= -210000000 && v < -200000000)
            return `UF(${v - -210000000})`;
        else if (v >= -190000000 && v < -180000000)
            return `UW(${v - 1910000000})`;
        else if (v >= -170000000 && v < -160000000)
            return `GSW(${v - -170000000})`;
        else if (v >= -150000000 && v < -140000000)
            return `LSW(${v - -150000000})`;
        else if (v >= -130000000 && v < -120000000)
            return `GSWF(${v - -130000000})`;
        else if (v >= -110000000 && v < -100000000)
            return `LSWF(${v - -110000000})`;
        else if (v >= -90000000 && v < -80000000)
            return `GF(${v - -90000000})`;
        else if (v >= -70000000 && v < -60000000)
            return `LF(${v - -70000000})`;
        else if (v >= -50000000 && v < -40000000)
            return `GW(${v - -50000000})`;
        else if (v >= -30000000 && v < -20000000)
            return `LW(${v - -30000000})`;
        else if (type === evt_ptype.Hex)
            return `${hexzero0x(v)}`;
        else
            return `${v}`;
    }

    private disasm_sub(sub: evt_disasm_sub, view: DataView): string {
        let pc = sub.addr;

        let S = `${sub.name}:\n`;
        let indent = '';

        function pushIndent(): void {
            indent += `  `;
        }
        function popIndent(): void {
            indent = indent.slice(2);
        }

        while (true) {
            const header = view.getUint32(pc - this.baseAddress);
            const opcode: op = (header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            if ((opcode === op.end_if) || opcode === op.else || opcode === op.while || opcode === op.end_switch || opcode === op.end_inline || opcode === op.end_brother)
                popIndent();

            S += `${indent}  ${op[opcode]}`;

            pc += 0x04;
            const tbl = evt_opcode_tbl[opcode];
            let ptype: evt_ptype[] = [];
            if (tbl !== undefined) {
                if (!tbl.varargs)
                    assert(tbl.t.length === paramCount);
                ptype = tbl.t;
            }

            for (let i = 0; i < paramCount; i++) {
                const expr = view.getUint32(pc - this.baseAddress);
                pc += 0x04;

                const exprType = ptype[i];
                S += `  ${this.disasm_expr(expr, exprType)}`;
            }

            S += `\n`;

            if (opcode === op.END)
                break;

            if ((opcode >= op.if_str_equal && opcode <= op.if_not_flag) || opcode === op.else || opcode === op.do || opcode === op.switch || opcode === op.inline_evt || opcode === op.inline_evt_id || opcode === op.brother_evt || opcode === op.brother_evt_id)
                pushIndent();
        }

        return S;
    }

    private disasm_sub_maybe(addr: number, prefix = 'SUB_'): evt_disasm_sub {
        let sub = this.sub.find((sub) => sub.addr === addr);
        if (!sub) {
            sub = new evt_disasm_sub(addr, `${prefix}_${hexzero(addr, 8)}`);
            this.sub.push(sub);
            sub.res = this.disasm_sub(sub, this.rel.createDataView());
        }
        return sub;
    }

    public disasm(): void {
        this.disasm_sub_maybe(this.entryAddress, 'ENTRY_');

        let S = ``;
        for (let i = 0; i < this.sub.length; i++)
            S += `${this.sub[i].res}\n\n`;
        console.log(S);
    }
}
