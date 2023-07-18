
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, hexzero, hexzero0x } from "../util.js";

enum op {
    END = 0x01,

    end_evt,
    lbl,
    goto,
    do,
    while,
    do_break,
    wait_frm,
    wait_msec,
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
    user_func,
    run_evt,
    run_evt_id,
    run_child_evt,
    bind_trigger, // unofficial name
    unbind,       // unofficial name
    delete_evt,
    restart_evt,
    set_pri,
    set_spd,
    set_type,
    bind_padlock, // unofficial name
    stop_all,
    start_all,
    stop_other,
    start_other,
    stop_id,
    start_id,
    chk_evt,
    inline_evt,
    end_inline,
    brother_evt,
    end_brother,
    debug_put_msg,
    debug_put_reg,
}

export class evt_handler {
    public get_user_func_sym(addr: number): string | null {
        return null;
    }

    public op_decode(op: number): op {
        return op;
    }

    public user_func(mgr: evtmgr, evt: evt_exec, addr: number): evt_user_func_ret {
        return evt_user_func_ret.advance;
    }
}

class mapentry {
    public view: DataView;

    constructor(public readonly base: number, public readonly buf: ArrayBufferSlice) {
        this.view = buf.createDataView();
    }

    public getUint32(addr: number): number {
        assert(addr >= this.base && addr <= this.base + this.buf.byteLength);
        return this.view.getUint32(addr - this.base);
    }
}

export class rommap {
    private entry: mapentry[] = [];

    public map(addr: number, buf: ArrayBufferSlice): void {
        this.entry.push(new mapentry(addr, buf));
    }

    public ref(addr: number): mapentry | null {
        for (let i = 0; i < this.entry.length; i++) {
            const entry = this.entry[i];
            const end = entry.base + entry.buf.byteLength;
            if (addr >= entry.base && addr < end)
                return this.entry[i];
        }
        return null;
    }
}

// records execution state for one evt
export const enum evt_state { running, waitonfrm, waitonevt, userfuncblock, stopped, end, }

export const enum evt_user_func_ret { advance, block, stop, }

interface evt_loop_record {
    pc: number;
    count: number | null;
}

interface evt_switch_record {
    operand: number | null;
}

export class evt_exec {
    public state = evt_state.running;
    public waitonfrm: number | null = null;
    public waitonevtid: number | null = null;
    public uf: Uint32Array;
    public uw: Float32Array;
    public lf: Uint8Array = new Uint8Array(512);
    public lw: Float32Array = new Float32Array(512);
    public funcwork: Float32Array = new Float32Array(4);
    public typeMask: number = 0xEF;

    public opcode: op;
    public paramCount: number;
    public switchRecord: evt_switch_record[] = [];
    public loopRecord: evt_loop_record[] = [];
    public entryAddress: number;
    public debug = false;

    constructor(public id: number, public pc: number, public readonly entry: mapentry) {
        this.entryAddress = this.pc;
    }

    public is_initial_call(): boolean {
        return this.state !== evt_state.userfuncblock;
    }

    public copy(o: evt_exec): void {
        this.uf = o.uf;
        this.uw = o.uw;
        this.lf.set(o.lf);
        this.lw.set(o.lw);
        this.typeMask = o.typeMask;
    }
}

export class evtmgr {
    private evt: evt_exec[] = [];
    private evtid = 0;
    private time = 0;

    public gswf: Uint8Array = new Uint8Array(65535);
    public lswf: Float32Array = new Float32Array(512);
    public gsw: Uint32Array = new Uint32Array(512);
    public lsw: Float32Array = new Float32Array(512);
    public gf: Uint8Array = new Uint8Array(512);
    public gw: Float32Array = new Float32Array(512);

    constructor(private handler: evt_handler, private map: rommap) {
    }

    public evtnew(addr: number, parent: evt_exec | null = null): evt_exec {
        const entry = this.map.ref(addr);
        const evt = new evt_exec(this.evtid++, addr, entry!);
        if (parent !== null)
            evt.copy(parent);
        if (entry === null)
            evt.state = evt_state.end;
        this.evt.push(evt);
        return evt;
    }

    public disasm(addr: number): void {
        const disasm = new evt_disasm_ctx(this.handler, this.map);
        disasm.disasm(addr);
    }

    private evtgetbyid(id: number): evt_exec | null {
        for (let i = 0; i < this.evt.length; i++)
            if (this.evt[i].id === id)
                return this.evt[i];
        return null;
    }

    private evtdecode(evt: evt_exec): void {
        evt.opcode = this.handler.op_decode(evt.entry.getUint32(evt.pc + 0x00));
        evt.paramCount = evt.entry.getUint32(evt.pc + 0x04);
    }

    private evtnextpc(evt: evt_exec): number {
        return evt.pc + 0x08 + evt.paramCount * 0x04;
    }

    private evtadv(evt: evt_exec): void {
        evt.pc = this.evtnextpc(evt);
        this.evtdecode(evt);
    }

    private evt_raw_arg(evt: evt_exec, i: number): number {
        assert(i < evt.paramCount);
        return evt.entry.getUint32(evt.pc + 0x08 + 0x04 * i);
    }

    public evt_set_arg(evt: evt_exec, i: number, v: number): void {
        const expr = this.evt_raw_arg(evt, i);
        this.evtset(evt, expr, v);
    }

    public evt_eval_arg(evt: evt_exec, i: number): number {
        const expr = this.evt_raw_arg(evt, i);
        return this.evtevalexpr(evt, expr);
    }

    private evtevalexpr(evt: evt_exec, uexpr: number): number {
        const expr = (uexpr | 0);
        if (expr <= -270000000)
            return uexpr; // addr
        else if (expr <= -220000000)
            return (expr - -230000000) / 1024.0; // float imm
        else if (expr < -200000000)
            return evt.uf[expr - -210000000];
        else if (expr < -180000000)
            return evt.uw[expr - -190000000];
        else if (expr < -160000000)
            return this.gsw[expr - -170000000];
        else if (expr < -140000000)
            return this.lsw[expr - -150000000];
        else if (expr < -120000000)
            return this.gswf[expr - -130000000];
        else if (expr < -100000000)
            return this.lswf[expr - -110000000];
        else if (expr < -80000000)
            return this.gf[expr - -90000000];
        else if (expr < -60000000)
            return evt.lf[expr - -70000000];
        else if (expr < -40000000)
            return this.gw[expr - -50000000];
        else if (expr < -20000000)
            return evt.lw[expr - -30000000];
        else
            return expr; // imm
    }

    private evtset(evt: evt_exec, uexpr: number, v: number): void {
        const expr = (uexpr | 0);
        if (expr < -200000000)
            evt.uf[expr - -210000000] = v;
        else if (expr < -180000000)
            evt.uw[expr - -190000000] = v;
        else if (expr < -160000000)
            this.gsw[expr - -170000000] = v;
        else if (expr < -140000000)
            this.lsw[expr - -150000000] = v;
        else if (expr < -120000000)
            this.gswf[expr - -130000000] = v;
        else if (expr < -100000000)
            this.lswf[expr - -110000000] = v;
        else if (expr < -80000000)
            this.gf[expr - -90000000] = v;
        else if (expr < -60000000)
            evt.lf[expr - -70000000] = v;
        else if (expr < -40000000)
            this.gw[expr - -50000000] = v;
        else if (expr < -20000000)
            evt.lw[expr - -30000000] = v;
        else
            throw "whoops";
    }

    private scanend(evt: evt_exec, opena: op[], close: op): void {
        let count = 0;
        const beginop = evt.opcode;
        assert(opena.includes(beginop));

        while (true) {
            if (count === 0)
                assert(beginop === evt.opcode);

            if (opena.includes(evt.opcode))
                ++count;
            else if (evt.opcode === close)
                --count;

            this.evtadv(evt);

            if (count === 0)
                return;
        }
    }

    private switch_get_cur_operand(evt: evt_exec): number {
        return evt.switchRecord[0].operand!;
    }

    private switch_check_skip(evt: evt_exec): boolean {
        if (evt.switchRecord[0].operand === null) {
            this.switch_skip(evt);
            return true;
        } else {
            return false;
        }
    }

    private switch_skip(evt: evt_exec): void {
        // Skip this switch case.

        // Since we're inside a switch, our count is 1.
        const start = evt.pc;
        let count = 1;
        while (true) {
            let found = false;

            if (count === 1 && evt.pc !== start && evt.opcode >= op.case_equal && evt.opcode <= op.case_between)
                found = true;
            else if (evt.opcode === op.switch || evt.opcode === op.switchi)
                ++count;
            else if (evt.opcode === op.end_switch)
                --count;

            this.evtadv(evt);

            if (found || count === 0)
                break;
        }
    }

    private switch_accept(evt: evt_exec): void {
        evt.switchRecord[0].operand = null;
    }

    private op_else(evt: evt_exec): void {
        // If we naturally hit an else, we need to find the endif and skip to it. Note that
        // we're inside an if block here, so count starts as 1.

        let count = 1;
        while (true) {
            if (evt.opcode >= op.if_equal && evt.opcode <= op.if_not_flag)
                ++count;
            else if (evt.opcode === op.end_if)
                --count;

            this.evtadv(evt);

            if (count === 0)
                break;
        }
    }

    private op_if(evt: evt_exec, v: boolean): void {
        // If comparison was true, step inside the if, which will happen naturally.
        // If the v is false, we need to scan for an else or an endif.

        if (v)
            return;

        let count = 0;
        while (true) {
            let found = false;

            if (evt.opcode === op.else && count === 1)
                break;

            if (evt.opcode >= op.if_equal && evt.opcode <= op.if_not_flag)
                ++count;
            else if (evt.opcode === op.end_if)
                --count;

            this.evtadv(evt);

            if (found || count === 0)
                break;
        }
    }

    private do_go_start(evt: evt_exec): void {
        evt.pc = evt.loopRecord[0].pc;
    }

    private do_go_break(evt: evt_exec): void {
        // Search forward for a "while".

        // Since we're inside a loop, we start our do/while counter at 1.
        assert(evt.loopRecord.length >= 1);
        let count = 1;

        while (true) {
            if (evt.opcode === op.do)
                ++count;
            else if (evt.opcode === op.while)
                --count;

            this.evtadv(evt);

            if (count === 0)
                break;
        }

        evt.loopRecord.shift();
    }

    private op_goto(evt: evt_exec, needle: number): void {
        // Look for lbl

        evt.pc = evt.entryAddress;
        this.evtdecode(evt);

        while (true) {
            let found = false;

            if (evt.opcode === op.lbl && evt.paramCount === 1) {
                const lbl = this.evt_raw_arg(evt, 0);
                if (lbl === needle)
                    found = true;
            }

            this.evtadv(evt);

            if (found)
                break;
        }
    }

    private execone(evt: evt_exec): void {
        this.evtdecode(evt);
        const oldpc = evt.pc;
        let nextpc = this.evtnextpc(evt);

        if (evt.debug)
            console.log(evt.id, hexzero(evt.pc, 8), op[evt.opcode]);

        // Dispatch opcode.
        switch (evt.opcode) {
        case op.END: {
            // no-op
        } break;
        case op.end_evt:
        case op.end_inline:
        case op.end_brother: {
            evt.state = evt_state.end;
        } break;
        case op.lbl: break;
        case op.goto: {
            this.op_goto(evt, this.evt_eval_arg(evt, 0));
        } break;
        case op.do: {
            const rawCount = this.evt_eval_arg(evt, 0);
            const count = rawCount === 0 ? null : rawCount;
            evt.loopRecord.unshift({ pc: nextpc, count });
        } break;
        case op.do_break: {
            this.do_go_break(evt);
        } break;
        case op.while: {
            const loopRecord = evt.loopRecord[0]!;
            if (loopRecord.count === null || loopRecord.count-- > 0)
                this.do_go_start(evt);
            else
                evt.loopRecord.shift();
        } break;
        case op.wait_frm: {
            evt.state = evt_state.waitonfrm;
            evt.waitonfrm = this.evt_eval_arg(evt, 0);
        } break;
        case op.wait_msec: {
            evt.state = evt_state.waitonfrm;
            evt.waitonfrm = this.evt_eval_arg(evt, 0) * (60/1000);
        } break;
        case op.if_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 === op1);
        } break;
        case op.if_not_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 !== op1);
        } break;
        case op.if_small: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 < op1);
        } break;
        case op.if_large: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 > op1);
        } break;
        case op.if_small_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 <= op1);
        } break;
        case op.if_large_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 >= op1);
        } break;
        case op.if_flag: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.op_if(evt, !!(op0 & op1));
        } break;
        case op.if_not_flag: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.op_if(evt, !(op0 & op1));
        } break;
        case op.else: {
            this.op_else(evt);
        } break;
        case op.end_if: break;
        case op.switch: {
            const operand = this.evt_eval_arg(evt, 0);
            evt.switchRecord.push({ operand });
        } break;
        case op.case_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) === eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_not_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) !== eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_small: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) < eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_large: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) > eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_small_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) <= eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_large_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) >= eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_between: {
            if (this.switch_check_skip(evt))
                break;

            const min = this.evt_eval_arg(evt, 0);
            const max = this.evt_eval_arg(evt, 1);
            if (this.switch_get_cur_operand(evt) >= min && this.switch_get_cur_operand(evt) <= max) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_etc: {
            if (this.switch_check_skip(evt))
                break;

            this.switch_accept(evt);
        } break;
        case op.case_or: {
            let check = false;
            while (evt.opcode === op.case_or) {
                const eq = this.evt_eval_arg(evt, 0);
                if (this.switch_get_cur_operand(evt) === eq)
                    check = true;
                this.evtadv(evt);
            }
            // first non-case_or

            if (check) {
                // we passed
            } else {
                // we failed, look for case_end
                while (evt.opcode !== op.case_end)
                    this.evtadv(evt);
            }
        } break;
        case op.case_end: {
            // nothing to do
        } break;
        case op.end_switch: {
            evt.switchRecord.shift();
        } break;
        case op.set:
        case op.seti:
        case op.setf: {
            const v = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, v);
        } break;
        case op.add:
        case op.addf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 + op1);
        } break;
        case op.sub:
        case op.subf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 - op1);
        } break;
        case op.mul:
        case op.mulf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 * op1);
        } break;
        case op.div:
        case op.divf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 / op1);
        } break;
        case op.mod: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 % op1);
        } break;
        case op.set_read: {
            // TODO
        } break;
        case op.read: {
            this.evt_set_arg(evt, 0, 0);
        } break;
        case op.read2: {
            this.evt_set_arg(evt, 0, 0);
            this.evt_set_arg(evt, 1, 0);
        } break;
        case op.read3: {
            this.evt_set_arg(evt, 0, 0);
            this.evt_set_arg(evt, 1, 0);
            this.evt_set_arg(evt, 2, 0);
        } break;
        case op.read4: {
            this.evt_set_arg(evt, 0, 0);
            this.evt_set_arg(evt, 1, 0);
            this.evt_set_arg(evt, 2, 0);
            this.evt_set_arg(evt, 3, 0);
        } break;
        case op.set_user_flg:
        case op.set_user_wrk:
            // TODO
            break;
        case op.alloc_user_wrk: {
            const size = this.evt_eval_arg(evt, 0);
            evt.uw = new Float32Array(size);
        } break;
        case op.and: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 & op1);
        } break;
        case op.andi: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 & op1);
        } break;
        case op.or: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 | op1);
        } break;
        case op.ori: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 | op1);
        } break;
        case op.user_func: {
            const func_addr = this.evt_eval_arg(evt, 0);
            const ret = this.handler.user_func(this, evt, func_addr);

            if (ret === evt_user_func_ret.block)
                evt.state = evt_state.userfuncblock;
            else if (ret === evt_user_func_ret.stop)
                evt.state = evt_state.stopped;
        } break;
        case op.run_evt: {
            const addr = this.evt_eval_arg(evt, 0);
            this.evtnew(addr, evt);
        } break;
        case op.run_evt_id: {
            const addr = this.evt_eval_arg(evt, 0);
            const subevt = this.evtnew(addr, evt);
            this.evt_set_arg(evt, 1, subevt.id);
        } break;
        case op.run_child_evt: {
            const addr = this.evt_eval_arg(evt, 0);
            const subevt = this.evtnew(addr, evt);
            evt.waitonevtid = subevt.id;
            evt.state = evt_state.waitonevt;
        } break;
        case op.bind_trigger:
        case op.unbind:
        case op.bind_padlock:
            // no implementation right now
            break;
        case op.delete_evt: {
            const id = this.evt_eval_arg(evt, 0);
            const subevt = this.evtgetbyid(id);
            if (subevt !== null)
                subevt.state = evt_state.end;
        } break;
        case op.set_type: {
            evt.typeMask = this.evt_eval_arg(evt, 0);
        } break;
        case op.stop_other: {
            const typeMask = this.evt_eval_arg(evt, 0);
            for (let i = 0; i < this.evt.length; i++) {
                const e = this.evt[i];
                if (e === evt)
                    continue;
                if (!(e.typeMask & typeMask))
                    continue;
                e.state = evt_state.stopped;
            }
        } break;
        case op.start_other: {
            const typeMask = this.evt_eval_arg(evt, 0);
            for (let i = 0; i < this.evt.length; i++) {
                const e = this.evt[i];
                if (e === evt)
                    continue;
                if (!(e.typeMask & typeMask))
                    continue;
                e.state = evt_state.running;
            }
        } break;
        case op.chk_evt: {
            const id = this.evt_eval_arg(evt, 0);
            const subevt = this.evtgetbyid(id);
            const is_running = subevt !== null ? subevt.state === evt_state.running : false;
            this.evt_set_arg(evt, 1, is_running ? 1 : 0);
        } break;
        case op.inline_evt: {
            const subevt = this.evtnew(nextpc, evt);
            this.scanend(evt, [op.inline_evt], op.end_inline);
        } break;
        case op.brother_evt: {
            const subevt = this.evtnew(nextpc, evt);
            this.scanend(evt, [op.brother_evt], op.end_brother);
        } break;
        case op.debug_put_msg:
        case op.debug_put_reg: {
            // No implementation
        } break;
        default:
            console.warn("unimplemented op", op[evt.opcode]);
            throw "whoops";
        }

        if (evt.pc === oldpc && evt.state !== evt_state.userfuncblock)
            evt.pc = nextpc;
    }

    private execevt(evt: evt_exec): void {
        while (evt.state === evt_state.running || evt.state === evt_state.userfuncblock) {
            this.execone(evt);

            if (evt.state !== evt_state.running)
                break;
        }

        if (evt.state === evt_state.waitonfrm) {
            if (--evt.waitonfrm! <= 0)
                evt.state = evt_state.running;
        } else if (evt.state === evt_state.waitonevt) {
            const subevt = this.evtgetbyid(evt.waitonevtid!);
            if (subevt === null || subevt.state === evt_state.end)
                evt.state = evt_state.running;
        }
    }

    private exec(): void {
        for (let i = 0; i < this.evt.length; i++)
            this.execevt(this.evt[i]);
    }

    public update(dt: number): void {
        this.time += dt;

        const FPS = 1000/30;
        while (this.time >= FPS) {
            this.exec();
            this.time -= FPS;
        }
    }
}

const enum evt_disasm_ptype { dec, hex, user_func, evt, }
interface evt_disasm_opcode_tbl_entry {
    t: evt_disasm_ptype[];
    varargs: boolean;
}

function opt(t: evt_disasm_ptype[], varargs = false): evt_disasm_opcode_tbl_entry {
    return { t, varargs };
}

const evt_disasm_opcode_tbl: { [o: number]: evt_disasm_opcode_tbl_entry } = {
    [op.user_func]:     opt([evt_disasm_ptype.user_func], true),
    [op.run_child_evt]: opt([evt_disasm_ptype.evt]),
    [op.run_evt]:       opt([evt_disasm_ptype.evt]),
};

class evt_disasm_sub {
    constructor(public addr: number, public name: string, public res: string | null = null) {
    }
}

export class evt_disasm_ctx {
    private sub: evt_disasm_sub[] = [];

    constructor(private handler: evt_handler, private map: rommap) {
    }

    private disasm_addr(addr: number, type: evt_disasm_ptype): string {
        if (type === evt_disasm_ptype.user_func) {
            const sym = this.handler.get_user_func_sym(addr);
            if (sym !== null)
                return sym;
        }

        if (type === evt_disasm_ptype.evt) {
            const sub = this.disasm_sub_maybe(addr);
            return sub.name;
        }

        return `$${hexzero0x(addr, 8)}`;
    }

    private disasm_expr(uexpr: number, type: evt_disasm_ptype): string {
        const expr = (uexpr | 0);
        if (expr <= -270000000)
            return this.disasm_addr(uexpr, type);
        else if (expr <= -220000000)
            return `${(expr - -230000000) / 1024.0}`;
        else if (expr < -200000000)
            return `UF(${expr - -210000000})`;
        else if (expr < -180000000)
            return `UW(${expr - -190000000})`;
        else if (expr < -160000000)
            return `GSW(${expr - -170000000})`;
        else if (expr < -140000000)
            return `LSW(${expr - -150000000})`;
        else if (expr < -120000000)
            return `GSWF(${expr - -130000000})`;
        else if (expr < -100000000)
            return `LSWF(${expr - -110000000})`;
        else if (expr < -80000000)
            return `GF(${expr - -90000000})`;
        else if (expr < -60000000)
            return `LF(${expr - -70000000})`;
        else if (expr < -40000000)
            return `GW(${expr - -50000000})`;
        else if (expr < -20000000)
            return `LW(${expr - -30000000})`;
        else if (type === evt_disasm_ptype.hex)
            return `${hexzero0x(expr)}`;
        else
            return `${expr}`;
    }

    private disasm_sub(sub: evt_disasm_sub, entry: mapentry | null): string {
        let S = `${sub.name}:\n`;

        if (entry === null)
            return S + `    [not found]`;

        let pc = sub.addr;

        let indent = '';

        function pushIndent(): void {
            indent += `  `;
        }
        function popIndent(): void {
            indent = indent.slice(2);
        }

        while (true) {
            const opcode = entry.getUint32(pc + 0x00);
            const paramCount = entry.getUint32(pc + 0x04);

            if ((opcode === op.end_if) || opcode === op.else || opcode === op.while || opcode === op.end_switch || opcode === op.end_inline || opcode === op.end_brother)
                popIndent();

            const pcs = hexzero(pc, 8);
            S += `${pcs}  ${indent}  ${op[opcode]}`;

            pc += 0x08;
            const tbl = evt_disasm_opcode_tbl[opcode];
            let ptype: evt_disasm_ptype[] = [];
            if (tbl !== undefined) {
                if (!tbl.varargs)
                    assert(tbl.t.length === paramCount);
                ptype = tbl.t;
            }

            for (let i = 0; i < paramCount; i++) {
                const expr = entry.getUint32(pc);
                pc += 0x04;

                const exprType = ptype[i];
                S += `  ${this.disasm_expr(expr, exprType)}`;
            }

            S += `\n`;

            if (opcode === op.END)
                break;

            if ((opcode >= op.if_equal && opcode <= op.if_not_flag) || opcode === op.else || opcode === op.do || opcode === op.switch || opcode === op.inline_evt || opcode === op.brother_evt)
                pushIndent();
        }

        return S;
    }

    private disasm_sub_maybe(addr: number, prefix = 'SUB_'): evt_disasm_sub {
        let sub = this.sub.find((sub) => sub.addr === addr);
        if (!sub) {
            sub = new evt_disasm_sub(addr, `${prefix}_${hexzero(addr, 8)}`);
            this.sub.push(sub);
            const entry = this.map.ref(addr);
            sub.res = this.disasm_sub(sub, entry);
        }
        return sub;
    }

    public disasm(entry: number): void {
        this.disasm_sub_maybe(entry, 'ENTRY_');

        let S = ``;
        for (let i = 0; i < this.sub.length; i++)
            S += `${this.sub[i].res}\n\n`;
        console.log(S);
    }
}
