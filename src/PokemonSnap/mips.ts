import { bitsAsFloat32, float32AsBits } from '../MathHelpers.js';
import { nArray, assert } from '../util.js';

export const enum Opcode {
    NOP     = 0x00,
    BRANCH  = 0x01,

    J       = 0x02,
    JAL     = 0x03,
    BEQ     = 0x04,
    BNE     = 0x05,
    ADDIU   = 0x09,
    SLTI    = 0x0A,
    SLTIU   = 0x0B,
    ANDI    = 0x0C,
    ORI     = 0x0D,
    XORI    = 0x0E,
    LUI     = 0x0F,

    COP0    = 0x10,
    COP1    = 0x11,

    BEQL    = 0x14,
    BNEL    = 0x15,

    LB      = 0x20,
    LH      = 0x21,
    LW      = 0x23,
    LBU     = 0x24,
    LHU     = 0x25,
    SB      = 0x28,
    SH      = 0x29,
    SW      = 0x2B,
    LWC1    = 0x31,
    SWC1    = 0x39,

    // register opcode block
    REGOP   = 0x100,
    SLL     = 0x100,
    SRL     = 0x102,
    SRA     = 0x103,
    SLLV    = 0x104,
    SRLV    = 0x106,
    SRAV    = 0x107,

    JR      = 0x108,
    JALR    = 0x109,
    MFHI    = 0x110,
    MFLO    = 0x112,
    MULT    = 0x118,
    DIV     = 0x11A,
    ADD     = 0x120,
    ADDU    = 0x121,
    SUB     = 0x122,
    SUBU    = 0x123,
    AND     = 0x124,
    OR      = 0x125,
    XOR     = 0x126,
    NOR     = 0x127,
    SLT     = 0x12A,
    DADDU   = 0x12D,

    // coprocessor 1 opcode block
    COPOP   = 0x200,
    MFC1    = 0x200,
    MTC1    = 0x204,

    // float (single) opcode block
    FLOATOP = 0x300,
    ADDS    = 0x300,
    SUBS    = 0x301,
    MULS    = 0x302,
    MOVS    = 0x306,

    // extra branch instruction block
    BLTZ    = 0x400,
    BGEZ    = 0x401,
}

export const enum RegName {
    R0 = 0x00,
    AT = 0x01,
    V0 = 0x02,
    V1 = 0x03,
    A0 = 0x04,
    A1 = 0x05,
    A2 = 0x06,
    A3 = 0x07,

    S0 = 0x10,
    S1 = 0x11,
    S2 = 0x12,
    S3 = 0x13,
    S4 = 0x14,
    S5 = 0x15,
    S6 = 0x16,
    S7 = 0x17,

    SP = 0x1D,
    FP = 0x1E,
    RA = 0x1F,
}

export function parseMIPSOpcode(instr: number): Opcode {
    let op: Opcode = instr >>> 26;
    const rs = (instr >>> 21) & 0x1F;
    const rt = (instr >>> 16) & 0x1F;
    if (op === Opcode.NOP && instr !== 0)
        op = (instr & 0x3F) | Opcode.REGOP;
    else if (op === Opcode.COP1) {
        if (rs === Opcode.COP0 || rs === Opcode.COP1)
            op = Opcode.FLOATOP | (instr & 0x3F);
        else
            op = Opcode.COPOP | rs;
    } else if (op === Opcode.BRANCH) {
        op = Opcode.BLTZ | rt;
    }
    return op;
}

export interface Register {
    value: number,
    lastOp: Opcode,
}

export interface BranchInfo {
    start: number;
    end: number;
    comparator: Register;
    op: Opcode;
}

export function parseOpcode(instr: number): Opcode {
    let op: Opcode = instr >>> 26;
    const rs = (instr >>> 21) & 0x1F;
    if (op === Opcode.NOP && instr !== 0)
        op = (instr & 0x3F) | Opcode.REGOP;
    else if (op === Opcode.COP1) {
        if (rs === Opcode.COP0 || rs === Opcode.COP1)
            op = Opcode.FLOATOP | (instr & 0x3F);
        else
            op = Opcode.COPOP | rs;
    }
    return op;
}

// A simple MIPS interpreter that can only handle mostly-linear functions
// A very small amount of information is kept about branches, and no attempt
// is made to handle loops, nested conditionals, or most register modification
export class NaiveInterpreter {
    public regs: Register[] = nArray(32, () => ({ value: 0, lastOp: Opcode.NOP } as Register));
    public fregs: Register[] = nArray(32, () => ({ value: 0, lastOp: Opcode.NOP } as Register));
    public stackArgs: Register[] = nArray(10, () => ({ value: 0, lastOp: Opcode.NOP } as Register));

    protected done = false;
    protected valid = true;
    public lastInstr = 0;
    public littleEndian = false;
    public view: DataView

    public reset(): void {
        for (let i = 0; i < this.regs.length; i++) {
            this.regs[i].value = 0;
            this.regs[i].lastOp = Opcode.NOP;
        }
        for (let i = 0; i < this.fregs.length; i++) {
            this.fregs[i].value = 0;
            this.fregs[i].lastOp = Opcode.NOP;
        }
        for (let i = 0; i < this.stackArgs.length; i++) {
            this.stackArgs[i].value = 0;
            this.stackArgs[i].lastOp = Opcode.NOP;
        }
        this.done = false;
        this.valid = true;
        this.lastInstr = 0;
    }

    public parseFromView(view: DataView, offs = 0): boolean {
        this.reset();
        const branches: BranchInfo[] = [];
        this.view = view;
        let func = 0;
        let funcOp = Opcode.JAL;
        let currBranch: BranchInfo | null = null;
        // next offset at which all paths of execution are guaranteed to meet
        // only updated when necessary for branches
        let nextMeet = 0;

        while (!this.done) {
            const instr = view.getUint32(offs + 0x00, this.littleEndian);
            this.lastInstr = instr;

            const op = parseMIPSOpcode(instr);
            const rs = (instr >>> 21) & 0x1F;
            const rt = (instr >>> 16) & 0x1F;
            const rd = (instr >>> 11) & 0x1F;
            const frd = (instr >>> 6) & 0x1F;
            const u_imm = (instr >>> 0) & 0xFFFF;
            const imm = (u_imm << 16) >> 16;
            switch (op) {
                case Opcode.NOP:
                    break;
                case Opcode.BEQ:
                    if (rs === 0 && rt === 0 && imm > 0) {
                        nextMeet = Math.max(nextMeet, offs + 4 * (imm + 1));
                        if (currBranch !== null) {
                            // assert(!this.valid || currBranch.end === -1 || currBranch.end === offs + 8, "unconditional branch in the middle of if block");
                            currBranch.end = offs + 8;
                        }
                        break; // unconditional branch
                    }
                case Opcode.BNE:
                case Opcode.BNEL:
                case Opcode.BEQL: {
                    // don't try to track loops or nested conditionals
                    if (imm <= 0) {
                        this.handleLoop(op, this.regs[rs], this.regs[rt], imm);
                        break;
                    } else if (currBranch !== null) {
                        this.handleUnknown(op);
                        break;
                    }
                    assert(rs !== 0 || rt !== 0, `bad trivial branch`);
                    let compReg = this.regs[rt];
                    if (rt === 0 || (rs !== 0 && this.seemsLikeLiteral(rs)))
                        compReg = this.regs[rs];
                    const comparator: Register = { lastOp: compReg.lastOp, value: compReg.value };
                    // if the body starts right away, the condition is effectively inverted
                    // assume this is the case when comparing to zero
                    let start = offs + 8;
                    let end = offs + 4 * (imm + 1);
                    nextMeet = Math.max(nextMeet, end);
                    if (rs !== 0 && rt !== 0 && (op === Opcode.BEQ || op === Opcode.BEQL)) {
                        // if not comparing to zero, assume we are looking at
                        //      if (x == y)
                        // meaning "positive" branches jump to the start of the body
                        start = end;
                        end = -1;
                    }
                    branches.push({ op, start, end, comparator });
                } break;

                case Opcode.SB:
                case Opcode.SH:
                case Opcode.SW: {
                    if (rs !== RegName.SP)
                        this.handleStore(op, this.regs[rt], this.regs[rs], imm);
                    else if (rt !== RegName.RA && op === Opcode.SW) {
                        const stackOffset = (u_imm >>> 2) - 4;
                        if (stackOffset >= 0 && stackOffset < this.stackArgs.length) {
                            this.stackArgs[stackOffset].lastOp = this.regs[rt].lastOp;
                            this.stackArgs[stackOffset].value = this.regs[rt].value;
                        }
                    }
                } break;
                case Opcode.SWC1: {
                    if (rs !== RegName.SP)
                        this.handleStore(op, this.fregs[rt], this.regs[rs], imm);
                    else {
                        const stackOffset = (u_imm >>> 2) - 4;
                        if (stackOffset >= 0 && stackOffset < this.stackArgs.length) {
                            this.stackArgs[stackOffset].lastOp = this.fregs[rt].lastOp;
                            this.stackArgs[stackOffset].value = this.fregs[rt].value;
                        }
                    }
                } break;

                // attempt to retrieve a value from the stack
                case Opcode.LW:
                    const stackIndex = (imm >>> 2) - 4;
                    if (rs === RegName.SP && stackIndex >= 0 && stackIndex < this.stackArgs.length) {
                        const stored = this.stackArgs[stackIndex];
                        if (stored !== null) {
                            this.regs[rt].value = stored.value;
                            this.regs[rt].lastOp = stored.lastOp;
                            break;
                        }
                    }
                // for other loads, just store the constant, and hope it can be understood later
                case Opcode.LB:
                case Opcode.LBU:
                case Opcode.LH:
                case Opcode.LHU:
                case Opcode.LWC1: {
                    const target = op === Opcode.LWC1 ? this.fregs[rt] : this.regs[rt];
                    if (imm === 0)
                        target.value = this.guessValue(rs);
                    else //if ((this.regs[rs].value & 0xFFFF) === 0)
                        target.value = this.guessValue(rs) + imm;
                    // else
                    //     target.value = imm;

                    target.lastOp = op;
                } break;

                case Opcode.DADDU:
                    if (rt === 0) {
                        this.regs[rd].value = this.regs[rs].value;
                        this.regs[rd].lastOp = this.regs[rs].lastOp;
                        break;
                    }
                case Opcode.ADDU: {
                    this.regs[rd].value = this.guessValue(rs) + this.guessValue(rt);
                    this.regs[rd].lastOp = op;
                } break;
                case Opcode.AND: {
                    this.regs[rd].value = this.guessValue(rs, rt);
                    // if multiple flag operations happened, try to get the one used for AND
                    if (this.regs[rs].lastOp === Opcode.OR || this.regs[rs].lastOp === Opcode.ORI)
                        this.regs[rd].value = this.guessValue(rt);
                    this.regs[rd].lastOp = op;
                } break;
                case Opcode.OR: {
                    if (rt === RegName.R0) {
                        // actually a MOV
                        this.regs[rd].value = this.regs[rs].value;
                        this.regs[rd].lastOp = this.regs[rs].lastOp;
                    } else {
                        this.regs[rd].value = this.guessValue(rs, rt);
                        this.regs[rd].lastOp = op;
                    }
                } break;
                case Opcode.ORI: {
                    this.regs[rt].value = this.guessValue(rs) | u_imm;
                    this.regs[rt].lastOp = op;
                } break;
                case Opcode.ANDI: {
                    this.regs[rt].value = u_imm;
                    this.regs[rt].lastOp = op;
                } break;
                case Opcode.ADDIU: {
                    if (rt !== RegName.SP) { // ignore stack changes
                        this.regs[rt].value = this.guessValue(rs) + imm;
                        this.regs[rt].lastOp = op;
                    }
                } break;
                case Opcode.LUI: {
                    this.regs[rt].value = (u_imm << 16) >>> 0;
                    this.regs[rt].lastOp = op;
                } break;
                case Opcode.J:
                case Opcode.JAL:
                    func = (instr & 0xFFFFFF) << 2;
                    funcOp = op;
                    break;
                case Opcode.JR: {
                    if (rs === RegName.RA) {
                        this.finish();
                        return this.valid;
                    }
                    // a switch statement, beyond the scope of this interpreter
                    this.handleUnknown(op);
                } break;
                case Opcode.MFC1: {
                    this.regs[rt].lastOp = this.fregs[rd].lastOp;
                    this.regs[rt].value = this.fregs[rd].value;
                } break;
                case Opcode.MTC1: {
                    this.fregs[rd].lastOp = this.regs[rt].lastOp;
                    this.fregs[rd].value = this.regs[rt].value;
                } break;
                case Opcode.SUBS:
                case Opcode.ADDS:
                case Opcode.MULS: {
                    this.fregs[frd].lastOp = op;
                    const left = bitsAsFloat32(this.fregs[rd].value);
                    const right = bitsAsFloat32(this.fregs[rt].value);
                    let res = 0;
                    if (op === Opcode.SUBS)
                        res = left - right;
                    else if (op === Opcode.ADDS)
                        res = left + right;
                    else if (op === Opcode.MULS)
                        res = left * right;
                    this.fregs[frd].value = float32AsBits(res);
                } break;
                case Opcode.MOVS: {
                    this.fregs[frd].lastOp = this.fregs[rd].lastOp;
                    this.fregs[frd].value = this.fregs[rd].value;
                } break;

                default:
                    // unhandled instruction, return invalid
                    this.handleUnknown(op);
            }
            if (op === Opcode.BEQL || op === Opcode.BNEL)
                offs += 4; // skip the delay slot entirely
            if (func !== 0 && op !== Opcode.JAL && op !== Opcode.J) {
                const v0 = this.handleFunction(func, this.regs[RegName.A0], this.regs[RegName.A1], this.regs[RegName.A2], this.regs[RegName.A3], this.stackArgs, currBranch, this.fregs[12]);
                this.regs[RegName.V0].lastOp = funcOp;
                this.regs[RegName.V0].value = v0;
                this.fregs[0].lastOp = funcOp;
                this.fregs[0].value = v0;
                func = 0;
                if (funcOp === Opcode.J)
                    break;
            }
            offs += 4;
            if (currBranch !== null &&
                ((currBranch.end >= 0 && offs >= currBranch.end) || (offs >= nextMeet))
            )
                currBranch = null;
            // check if we started a new branch
            for (let i = 0; i < branches.length; i++) {
                if (branches[i].start === offs) {
                    currBranch = branches[i];
                    break;
                }
            }
        }
        this.finish();
        return this.valid;
    }

    private guessValue(r: RegName, s: RegName = RegName.R0): number {
        if (this.seemsLikeLiteral(r))
            return this.regs[r].value;
        if (this.seemsLikeLiteral(s))
            return this.regs[s].value;
        return 0;
    }

    // very hacky attempt to preserve information from register operations
    // roughly, we want to keep the literal values involved
    private seemsLikeLiteral(r: RegName): boolean {
        switch (this.regs[r].lastOp) {
            case Opcode.JAL:
                return this.regs[r].value !== 0;// we provided this, trust it
            case Opcode.AND:
            case Opcode.OR:
            case Opcode.ADDIU:
            case Opcode.ANDI:
            case Opcode.ORI:
            case Opcode.LUI:
                return true;
        }
        return false;
    }

    protected handleFunction(func: number, a0: Register, a1: Register, a2: Register, a3: Register, stackArgs: (Register | null)[], branch: BranchInfo | null, f12: Register): number {
        return 0;
    }

    protected handleStore(op: Opcode, value: Register, target: Register, offset: number): void { }

    // handler for unknown instructions, by default just mark invalid
    protected handleUnknown(op: Opcode): void {
        this.valid = false;
    }

    protected handleLoop(op: Opcode, left: Register, right: Register, offset: number): void {
        this.valid = false;
    }

    protected finish(): void { }
}