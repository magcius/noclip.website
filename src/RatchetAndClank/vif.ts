import { assert, hexzero } from "../util";
import { DataViewExt } from "./DataViewExt";
import { getBits } from "./utils";

export enum VifCmd {
    NOP = 0b0000000,
    STCYCL = 0b0000001,
    OFFSET = 0b0000010,
    BASE = 0b0000011,
    ITOP = 0b0000100,
    STMOD = 0b0000101,
    MSKPATH3 = 0b0000110,
    MARK = 0b0000111,
    FLUSHE = 0b0010000,
    FLUSH = 0b0010001,
    FLUSHA = 0b0010011,
    MSCAL = 0b0010100,
    MSCNT = 0b0010111,
    MSCALF = 0b0010101,
    STMASK = 0b0100000,
    STROW = 0b0110000,
    STCOL = 0b0110001,
    MPG = 0b1001010,
    DIRECT = 0b1010000,
    DIRECTHL = 0b1010001
};

export const VIF_UNPACK_MASK = 0b0110_0000;

enum VifUnpackVN {
    S = 0x00,
    V2 = 0x01,
    V3 = 0x02,
    V4 = 0x03,
}

enum VifUnpackVL {
    VL_32 = 0x00,
    VL_16 = 0x01,
    VL_8 = 0x02,
    VL_5 = 0x03,
}

export enum VifUnpackFormat {
    S_32 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_32),
    S_16 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_16),
    S_8 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
}

export function readVifCommandList(view: DataViewExt) {
    assert(view.byteLength % 4 === 0);

    const out: VifCommand[] = [];

    // cycle register values (affects decoding of unpack commands)
    let wl = 1, cl = 1;

    while (view.byteLength) {
        const command = new VifCommand(view, wl, cl);
        const size = command.size();
        assert(size <= view.byteLength);
        assert(size % 4 === 0);
        out.push(command);

        switch (command.cmd) {
            case VifCmd.STCYCL: {
                const stcycl = command.decodeStcycl();
                wl = stcycl.wl;
                cl = stcycl.cl;
                break;
            }
        }

        view = view.subview(size);
    }

    return out;
}

class VifCommand {
    irq: number;
    cmd: number;
    num: number;
    immediate: number;

    constructor(public view: DataViewExt, private wl: number, private cl: number) {
        const vifCmd = view.getUint32(0);

        this.immediate = getBits(vifCmd, 0, 15);
        this.num = getBits(vifCmd, 16, 23) || 256; // num 0 means 256 (EE manual page 88)
        this.cmd = getBits(vifCmd, 24, 30);
        this.irq = getBits(vifCmd, 31, 31);
    }

    isUnpack() {
        return (this.cmd & VIF_UNPACK_MASK) === VIF_UNPACK_MASK;
    }

    size() {
        // EE manual page 87 has a table of sizes
        let packetLength = 0;
        switch (this.cmd) {
            case VifCmd.NOP:
            case VifCmd.STCYCL:
            case VifCmd.OFFSET:
            case VifCmd.BASE:
            case VifCmd.ITOP:
            case VifCmd.STMOD:
            case VifCmd.MSKPATH3:
            case VifCmd.MARK:
            case VifCmd.FLUSHE:
            case VifCmd.FLUSH:
            case VifCmd.FLUSHA:
            case VifCmd.MSCAL:
            case VifCmd.MSCNT:
            case VifCmd.MSCALF:
                packetLength = 1;
                break;
            case VifCmd.STMASK:
                packetLength = 1 + 1;
                break;
            case VifCmd.STROW:
            case VifCmd.STCOL:
                packetLength = 1 + 4;
                break;
            case VifCmd.MPG:
                packetLength = 1 + this.num * 2;
                break;
            case VifCmd.DIRECT:
            case VifCmd.DIRECTHL:
                const _immediate = this.immediate || 65536; // EE manual page 122
                packetLength = 1 + _immediate * 4;
                break;
            default: {
                assert(this.isUnpack());

                const vn: VifUnpackVN = (this.cmd & 0b1100) >> 2
                const vl: VifUnpackVL = this.cmd & 0b0011;

                if (this.wl <= this.cl) {
                    /**
                     * EE manual page 123:
                     * "//" means divide and round up
                     * 1+(((32>>vl) x (vn+1)) x num//32)
                     */
                    packetLength = 1 + Math.ceil((((32 >> vl) * (vn + 1)) * this.num) / 32);
                } else {
                    /**
                     * ```
                     * int limit(int a,int max) { return( a>max ? max: a); }
                     * n = CL x (num/WL)+limit(num%WL,CL)
                     * 1+(((32>>vl) x (vn+1)) x n//32)
                     * ```
                     */
                    // not tested, but this should work
                    // function limit(a: number, max: number) { return a > max ? max : a; }
                    // const n = cl * Math.trunc(num / wl) + limit(num % wl, cl);
                    // packetLength = 1 + Math.ceil((((32 >> vl) * (vn + 1)) * num) / 32);
                    throw new Error("Filling write unpacks not tested");
                }
            }
        }
        return 0x4 * packetLength;
    }

    get debug() {
        const irqStr = this.irq ? "IRQ" : "";
        const cmdName = this.isUnpack() ? "UNPACK" : VifCmd[this.cmd] ? VifCmd[this.cmd] : `UNKNOWN ${hexzero(this.cmd, 2)}`;
        let extra = "";

        if (this.cmd === VifCmd.STCYCL) {
            const stcycl = this.decodeStcycl();
            extra = `WL=${stcycl.wl} CL=${stcycl.cl}`;
        }

        if (this.isUnpack()) {
            const unpack = this.decodeUnpack();
            const numStr = String(this.num);
            const vnvlStr = VifUnpackFormat[unpack.vnvl] ?? `VNVL=${hexzero(unpack.vnvl, 2)}`;
            const destStr = `ADDR=${hexzero(unpack.addr, 4)}`;
            extra = `${numStr} x ${vnvlStr} -> ${destStr}`;
        }

        return [irqStr, cmdName, extra].filter(s => s).join(" ");
    }

    decodeUnpack() {
        assert(this.isUnpack());

        const vnvl = this.cmd & 0xF;
        const vn: VifUnpackVN = (this.cmd & 0b1100) >> 2
        const vl: VifUnpackVL = this.cmd & 0b0011;
        return {
            vnvl,
            elementCount: 1 + vn,
            elementSize: (32 >> vl) / 8,
            mask: this.cmd & 0b10000,
            addr: getBits(this.immediate, 0, 9),
            unsigned: !!getBits(this.immediate, 14, 14),
            addTopsToAddr: !!getBits(this.immediate, 15, 15),
        };
    }

    readUnpackData() {
        assert(this.isUnpack());
        return this.view.subview(0x4, this.size() - 0x4);
    }

    readStrowData() {
        assert(this.cmd === VifCmd.STROW);
        return this.view.subview(0x4, 0x4 * 4).getTypedArrayView(Int32Array);
    }

    decodeStcycl() {
        assert(this.cmd === VifCmd.STCYCL);
        return {
            cl: getBits(this.immediate, 0, 7),
            wl: getBits(this.immediate, 8, 15),
        };
    }
}

// helper for iterating over unpack commands in a vif command list
export class VifUnpackReader {
    private i = 0;

    constructor(private commands: VifCommand[]) {
    }

    advanceToNext(failIfNotFound: boolean = true) {
        for (; this.i < this.commands.length; this.i++) {
            const cmd = this.commands[this.i];
            if (cmd.isUnpack()) {
                return;
            }
        }
        if (failIfNotFound) {
            throw new Error(`No more UNPACK commands in list`);
        }
    }

    // return the next unpack's data
    next() {
        this.advanceToNext();
        const cmd = this.commands[this.i];
        this.i++; // advance past this command
        return cmd.readUnpackData();
    }

    hasNext() {
        this.advanceToNext(false);
        return !!this.commands[this.i];
    }

    peekNextVnvl() {
        this.advanceToNext();
        const cmd = this.commands[this.i];
        // do not advance i here
        return cmd.decodeUnpack().vnvl;
    }

    peekNextAddr() {
        this.advanceToNext();
        const cmd = this.commands[this.i];
        // do not advance i here
        return cmd.decodeUnpack().addr;
    }
}
