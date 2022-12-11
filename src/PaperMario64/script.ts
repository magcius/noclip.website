
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero } from "../util";
import { Color, colorNewFromRGBA } from "../Color";

const scriptAddrBase = 0x80240000;

const enum ScriptThreadState {
    ALIVE, DEAD, WAITING_ON_CHILD, WAITING_ON_FRAME,
}

function copyThreadVars(dst: ScriptThread, src: ScriptThread): void {
    for (let i = 0; i < src.var.length; i++)
        dst.var[i] = src.var[i];
}

class ScriptThread {
    public pc: number;
    public addr: number;
    public var: number[] = [];
    public parentThread: ScriptThread | null = null;
    public boundToParent: boolean = false;
    public loopPC: number = -1;
    public loopCount: number = -1;
    public state: ScriptThreadState = ScriptThreadState.ALIVE;
    public waitOnFrameCount: number = 0;

    constructor(public start: number) {
        this.pc = start;
        this.addr = scriptAddrBase + start;
    }
}

export interface ScriptHost {
    setBGColor(color: Color): void;
    setModelTexAnimGroupEnabled(modelId: number, enabled: boolean): void;
    setModelTexAnimGroup(modelId: number, groupId: number): void;
    setTexAnimGroup(groupId: number, tileId: number, transS: number, transT: number): void;
}

function conditionCheck(op: number, a: number, b: number) {
    switch (op) {
    case 0x0A: return a === b;
    case 0x0B: return a !== b;
    case 0x0C: return a < b;
    case 0x0D: return a > b;
    case 0x0E: return a <= b;
    case 0x0F: return a >= b;
    case 0x10: return ((a & b) !== 0);
    case 0x11: return ((a & b) === 0);
    default: throw "whoops";
    }
}

const FPS = 30;

function opLen(operCount: number): number {
    return 0x08 + 0x04 * operCount;
}

function scanForLabel(thread: ScriptThread, view: DataView, labelId: number): number {
    let pc = thread.start;
    while (true) {
        const op = view.getUint32(pc + 0x00);
        const operCount = view.getUint32(pc + 0x04);
        const oper0 = view.getUint32(pc + 0x08);

        pc += opLen(operCount);

        // Label.
        if (op === 0x03 && oper0 === labelId)
            return pc;
    }
}

function scanPastNext(view: DataView, pc: number, needle: number): number {
    while (true) {
        const op = view.getUint32(pc + 0x00);
        const operCount = view.getUint32(pc + 0x04);

        pc += opLen(operCount);

        if (op === needle)
            return pc;

        if (op === 0x05) // Loop
            pc = scanPastNext(view, pc, 0x06); // EndLoop

        if (op >= 0x0A && op <= 0x11) // If
            pc = scanPastNext(view, pc, 0x13); // EndIf

        if (op === 0x14) // Switch
            pc = scanPastNext(view, pc, 0x23);

        if (op === 0x01) // End
            return pc;
    }
}

export class ScriptExecutor {
    private threads: ScriptThread[] = [];
    private view: DataView;
    private lastTime: number = -1;

    constructor(private scriptHost: ScriptHost, private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public startFromHeader(headerAddr: number): void {
        const headerOffs = headerAddr - scriptAddrBase;
        const mainScriptAddr = this.view.getUint32(headerOffs + 0x10);
        this.startThread(mainScriptAddr - scriptAddrBase);
    }

    private startThread(pc: number): ScriptThread {
        const thread = new ScriptThread(pc);
        this.threads.push(thread);
        return thread;
    }

    private startChildThread(parentThread: ScriptThread, pc: number): ScriptThread {
        const child = this.startThread(pc);
        copyThreadVars(child, parentThread);
        child.parentThread = parentThread;
        return child;
    }

    public stepTime(time: number): void {
        let numFrames = 1;

        if (this.lastTime !== -1) {
            const delta = time - this.lastTime;
            numFrames = (delta / FPS) | 0;
        }

        for (let i = 0; i < numFrames; i++)
            this.stepFrame();
        if (numFrames > 0)
            this.lastTime = time;
    }

    private stepFrame(): void {
        // Step all frames until they are waiting...

        // First, step all the frame counters.
        for (let i = 0; i < this.threads.length; i++) {
            const thread = this.threads[i];
            if (thread.state === ScriptThreadState.WAITING_ON_FRAME)
                if (--thread.waitOnFrameCount === 0)
                    thread.state = ScriptThreadState.ALIVE;
        }

        let maxExec = 0;
        while (maxExec++ < 100) {
            for (let i = 0; i < this.threads.length; i++) {
                const thread = this.threads[i];

                if (thread.boundToParent && thread.parentThread !== null && thread.parentThread.state === ScriptThreadState.DEAD)
                    thread.state = ScriptThreadState.DEAD;

                if (thread.state === ScriptThreadState.ALIVE)
                    this.stepFrameThread(thread);

                if (thread.state === ScriptThreadState.DEAD)
                    this.threads.splice(i--, 1);
            }

            let anyThreadAlive = false;
            for (let i = 0; !anyThreadAlive && i < this.threads.length; i++)
                anyThreadAlive = anyThreadAlive || this.threads[i].state === ScriptThreadState.ALIVE;

            if (!anyThreadAlive)
                break;
        }
    }

    private setVariable(thread: ScriptThread, addr: number, value: number): void {
        if (addr < -20000000) {
            // Local variable.
            thread.var[addr + 30000000] = value;
        } else {
            // Hopefully not important.
        }
    }

    private getValue(thread: ScriptThread, addr: number): number {
        if (addr < -270000000) {
            return addr;
        } else if (addr <= -250000000) { // Unknown
            throw "whoops";
        } else if (addr <= -220000000) { // FixedReal
            const p = addr + 230000000;
            return p / 1024.0;
        } else if (addr <= -200000000) { // FlagArray
            return 0;
        } else if (addr <= -180000000) { // Array
            return 0;
        } else if (addr <= -160000000) { // GameByte
            const p = addr + 170000000;
            if (p === 0x00) { // StoryProgress
                return 0xFF;
            } else {
                console.warn(`Unknown GameByte flag ${p}`);
                return 0;
            }
        } else if (addr <= -140000000) { // AreaByte
            return 0;
        } else if (addr <= -120000000) { // GameFlag
            return 0;
        } else if (addr <= -100000000) { // AreaFlag
            return 0;
        } else if (addr <= -80000000) { // MapFlag
            return 0;
        } else if (addr <= -60000000) { // Flag
            return 0;
        } else if (addr <= -40000000) { // MapVar
            return 0;
        } else if (addr <= -20000000) { // Var
            return thread.var[addr + 30000000];
        } else {
            return addr;
        }
    }

    private callFunction(thread: ScriptThread, addr: number, operCount: number, operOffs: number): number {
        const view = this.view;

        if (addr === 0x802CA828) {
            // SetCamPerspective
        } else if (addr === 0x802CAB18) {
            // SetCamViewport
        } else if (addr === 0x802CAD98) {
            // SetCamBGColor
            assert(operCount === 4);
            const camId = view.getUint32(operOffs + 0x00);
            const r = view.getUint32(operOffs + 0x04) / 0xFF;
            const g = view.getUint32(operOffs + 0x08) / 0xFF;
            const b = view.getUint32(operOffs + 0x0C) / 0xFF;
            const color = colorNewFromRGBA(r, g, b);
            this.scriptHost.setBGColor(color);
        } else if (addr === 0x802C9208) {
            // EnableTexPanning
            assert(operCount === 2);
            const modelId = view.getUint32(operOffs + 0x00);
            const enabled = !!this.getValue(thread, view.getUint32(operOffs + 0x04));
            this.scriptHost.setModelTexAnimGroupEnabled(modelId, enabled);
        } else if (addr === 0x802C9000) {
            // SetTexPanner
            assert(operCount === 2);
            const modelId = this.getValue(thread, view.getInt32(operOffs + 0x00));
            const groupId = this.getValue(thread, view.getInt32(operOffs + 0x04));
            this.scriptHost.setModelTexAnimGroup(modelId, groupId);
        } else if (addr === 0x802C9364) {
            // SetTexPan
            assert(operCount === 4);
            const groupId = this.getValue(thread, view.getInt32(operOffs + 0x00));
            const tileId = this.getValue(thread, view.getInt32(operOffs + 0x04));
            const transS = this.getValue(thread, view.getInt32(operOffs + 0x08)) / 0x400;
            const transT = this.getValue(thread, view.getInt32(operOffs + 0x0C)) / -0x400;
            this.scriptHost.setTexAnimGroup(groupId, tileId, transS, transT);
        }

        return 2;
    }

    private stepFrameThread(thread: ScriptThread): void {
        const view = this.view;
        let pc = thread.pc;
        let nextPC = thread.pc;

        let i = 0;
        while (thread.state === ScriptThreadState.ALIVE) {
            const op = view.getUint32(pc + 0x00);
            const operCount = view.getUint32(pc + 0x04);

            nextPC += opLen(operCount);

            // If we go for 1000 ops without a wait, kill us.
            if (++i > 1000)
                thread.state = ScriptThreadState.DEAD;

            switch (op) {
            case 0x01: // End. Just a marker for parsing purposes.
                return;
            case 0x02: // Return. Copy our state to the parent thread and kill ourselves.
                thread.state = ScriptThreadState.DEAD;
                if (thread.parentThread !== null && thread.parentThread.state === ScriptThreadState.WAITING_ON_CHILD) {
                    copyThreadVars(thread.parentThread, thread);
                    thread.parentThread.state = ScriptThreadState.ALIVE;
                }
                break;
            case 0x03: // Label.
                break;
            case 0x04: // Goto.
                nextPC = scanForLabel(thread, view, view.getUint32(pc + 0x08));
                break;
            case 0x05: // Loop. The first operand is the number of times to loop. 0 means infinite.
                // assert(thread.loopCount == -1);
                thread.loopPC = nextPC;
                thread.loopCount = view.getUint32(pc + 0x08);
                break;
            case 0x06: // EndLoop. Jump back to the previous loop.
                if (thread.loopCount > 0) {
                    thread.loopCount--;
                    if (thread.loopCount === 0)
                        thread.loopCount = -1;
                }

                if (thread.loopCount >= 0)
                    nextPC = thread.loopPC;
                break;
            case 0x07: // BreakLoop. Jump past the end of the loop.
                thread.loopCount = -1;
                // Scan forward for an EndLoop.
                nextPC = scanPastNext(view, nextPC, 0x06);
                break;
            case 0x08: // Wait (Frames).
                thread.state = ScriptThreadState.WAITING_ON_FRAME;
                thread.waitOnFrameCount = view.getUint32(pc + 0x08);
                break;
            case 0x09: // Wait (seconds).
                thread.state = ScriptThreadState.WAITING_ON_FRAME;
                thread.waitOnFrameCount = view.getUint32(pc + 0x08) * 30;
                break;
            case 0x0A: // If A == B
            case 0x0B: // If A != B
            case 0x0C: // If A <  B
            case 0x0D: // If A >  B
            case 0x0E: // If A <= B
            case 0x0F: // If A >= B
            case 0x10: // If ((A & B) != 0)
            case 0x11: // If ((A & B) == 0)
                // If the condition is true, then we take the first branch.
                // Otherwise, look for the Else token and take that instead if it exists.
                const a = this.getValue(thread, view.getInt32(pc + 0x08));
                const b = this.getValue(thread, view.getInt32(pc + 0x0C));
                if (conditionCheck(op, a, b)) {
                    // Take first branch.
                } else {
                    // Take else branch if it exists.
                    const elseBranch = scanPastNext(view, nextPC, 0x12);
                    if (elseBranch >= 0)
                        nextPC = elseBranch;
                    else
                        nextPC = scanPastNext(view, nextPC, 0x13);
                }
                break;
            case 0x12: // Else
                // The only way that we should hit this "naturally" is if we
                // run off the first branch. Scan for the next EndIf.
                nextPC = scanPastNext(view, nextPC, 0x13);
                break;
            case 0x13: // EndIf
                // No need to do anything.
                break;
            case 0x14: // Switch
                // TODO(jstpierre): Implement switch
                nextPC = scanPastNext(view, nextPC, 0x23);
                break;
            case 0x24: // Set
                this.setVariable(thread, view.getInt32(pc + 0x08), this.getValue(thread, view.getUint32(pc + 0x0C)));
                break;
            case 0x26: // SetF
                this.setVariable(thread, view.getInt32(pc + 0x08), this.getValue(thread, view.getUint32(pc + 0x0C)));
                break;
            case 0x27: // Add
            case 0x2C: { // AddF
                const a = view.getInt32(pc + 0x08);
                this.setVariable(thread, a, this.getValue(thread, a) + this.getValue(thread, view.getInt32(pc + 0x0C)));
                break;
            }
            case 0x28: // Sub
            case 0x2D: { // SubF
                const a = view.getInt32(pc + 0x08);
                this.setVariable(thread, a, this.getValue(thread, a) - this.getValue(thread, view.getInt32(pc + 0x0C)));
                break;
            }
            case 0x29: // Mul
            case 0x2E: { // MulF
                const a = view.getInt32(pc + 0x08);
                this.setVariable(thread, a, this.getValue(thread, a) * this.getValue(thread, view.getInt32(pc + 0x0C)));
                break;
            }
            case 0x2A: { // Div
                const a = view.getInt32(pc + 0x08);
                this.setVariable(thread, a, (this.getValue(thread, a) / this.getValue(thread, view.getInt32(pc + 0x0C))) | 0);
                break;
            }
            case 0x2F: { // DivF
                const a = view.getInt32(pc + 0x08);
                this.setVariable(thread, a, this.getValue(thread, a) / this.getValue(thread, view.getInt32(pc + 0x0C)));
                break;
            }
            case 0x43: // Call
                const funcAddr = view.getUint32(pc + 0x08);
                // The args are in the buffer...
                // If the function doesn't return '2', then exit early and call it next frame...
                if (this.callFunction(thread, funcAddr, operCount - 1, pc + 0x0C) !== 2)
                    return;
                break;
            case 0x44: { // Exec
                const scriptAddr = view.getUint32(pc + 0x08);
                if (scriptAddr < 0x80280000) {
                    this.startChildThread(thread, scriptAddr - scriptAddrBase);
                }
                break;
            }
            case 0x45: { // ExecSync
                const scriptAddr = view.getUint32(pc + 0x08);
                if (scriptAddr < 0x80280000) {
                    this.startChildThread(thread, scriptAddr - scriptAddrBase);
                }
                break;
            }
            case 0x46: { // ExecWait
                const scriptAddr = view.getUint32(pc + 0x08);
                if (scriptAddr < 0x80280000) {
                    this.startChildThread(thread, scriptAddr - scriptAddrBase);
                    thread.state = ScriptThreadState.WAITING_ON_CHILD;
                }
                break;
            }
            case 0x47: // Bind
                break;
            case 0x49: // Kill
                break;
            case 0x4D: // SetGroup
                break;
            case 0x4F: // SuspendAll
                break;
            case 0x50: // ResumeAll
                break;
            case 0x56: { // Thread
                this.startChildThread(thread, nextPC);
                nextPC = scanPastNext(view, pc, 0x57);
                break;
            }
            case 0x57: // EndThread
                // Only way we should hit this naturally is if we run into it as the child thread...
                thread.state = ScriptThreadState.DEAD;
                break;
            default:
                console.warn(`Unimplemented command: ${hexzero(pc, 4)}: ${hexzero(op, 2)} / ${operCount}`);
                debugger;
                return;
            }

            pc = nextPC;
        }

        thread.pc = pc;
    }
}
