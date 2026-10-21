import { f, s8, u16, u8 } from "./f32.js";
import { G } from "./globals.js";
import { INPUT_HISTORY_SIZE, INPUT_RECORDERS, MAX_PLAYERS, PlayerInputState, Ref, ref } from "./types.js";

export const INPUT_RIGHT = 0x0001;
export const INPUT_DOWN = 0x0002;
export const INPUT_LEFT = 0x0004;
export const INPUT_UP = 0x0008;
export const INPUT_A = 0x0010;
export const INPUT_B = 0x0020;
export const INPUT_C_UP = 0x0100;
export const INPUT_C_RIGHT = 0x0200;
export const INPUT_C_DOWN = 0x0400;
export const INPUT_C_LEFT = 0x0800;
export const INPUT_L = 0x1000;
export const INPUT_R = 0x2000;
export const INPUT_START = 0x4000;
export const INPUT_Z = 0x8000;
export const INPUT_ACCELERATE = 0x00010000;
export const INPUT_REVERSE = 0x00020000;
export const INPUT_BRAKE = 0x00040000;
export const INPUT_EBRAKE = 0x00080000;
export const INPUT_GEAR_UP = 0x00100000;
export const INPUT_GEAR_DOWN = 0x00200000;
export const INPUT_VIEW_COCKPIT = 0x01000000;
export const INPUT_VIEW_TRACKSIDE = 0x02000000;
export const INPUT_VIEW_CHASE = 0x04000000;
export const INPUT_VIEW_BUMPER = 0x08000000;
export const INPUT_VIEWS = 0x0f000000;
export const INPUT_RECORDED_ACTIONS = 0x003f0000;
export const CONTROLLER_LAYOUTS = 5;

export const CONT_NO_RESPONSE_ERROR = 0x8;
export const R_CBUTTONS = 0x0001;
export const L_CBUTTONS = 0x0002;
export const D_CBUTTONS = 0x0004;
export const U_CBUTTONS = 0x0008;
export const R_TRIG = 0x0010;
export const L_TRIG = 0x0020;
export const R_JPAD = 0x0100;
export const L_JPAD = 0x0200;
export const D_JPAD = 0x0400;
export const U_JPAD = 0x0800;
export const START_BUTTON = 0x1000;
export const Z_TRIG = 0x2000;
export const B_BUTTON = 0x4000;
export const A_BUTTON = 0x8000;

const STICK_RANGE = f(70.0);
const DPAD_STEERING = 0x50;
const REVERSE_STICK_Y = -0x40;
const ACCELERATE_STICK_Y = 0x21;
const LAYOUT3_REVERSE_STICK_Y = -0x10;
const STICK_PRESS = f(0.6);
const STICK_RELEASE = f(0.3);
const STICK_FIRST_DELAY = 500;
const STICK_REPEAT_DELAY = 200;
const CHEAT_SEQUENCE_END = 0xffff;
const UNLOCKED_TRACKS_0_TO_4 = 0x001f;
const UNLOCKED_TRACKS_5_TO_9 = 0x03e0;
const UNLOCKED_CARS_0_TO_8 = 0x01ff;
const DATA_SEGMENT_RAM = 0x8025f000;
const CHEAT_CODES_ADDRESS = 0x8028df48;

export interface OSContPad {
    button: number;
    stick_x: number;
    stick_y: number;
    errno: number;
}

export interface CheatCode {
    apply: () => void;
    sequence: number[] | null;
}

export const g_aContPadData: OSContPad[] = Array.from({ length: MAX_PLAYERS }, () => ({ button: 0, stick_x: 0, stick_y: 0, errno: 0 }));
export const g_aCheatCodes: CheatCode[] = [];

export const inputGlobals = {
    g_bShowDepthBuffer: 0,
    g_bBilinearFiltering: 1,
    g_dwContReadPending: 0,
    g_bPakPort0Initialized: 0,
};

export const inputHooks = {
    IsRacingScreen: (): boolean => true,
};

export function CheatToggleRamView(): void {
    inputGlobals.g_bShowDepthBuffer = inputGlobals.g_bShowDepthBuffer ? 0 : 1;
}

export function CheatUnlockTracks0To4(): void {
    G.g_aVehicles[0].profile!.unlockedTracks |= UNLOCKED_TRACKS_0_TO_4;
}

export function CheatUnlockCars0To8(): void {
    G.g_aVehicles[0].profile!.unlocks |= UNLOCKED_CARS_0_TO_8;
}

export function CheatSetUnlockBit200(): void {
    G.g_aVehicles[0].profile!.unlocks |= 0x0200;
}

export function CheatSetUnlockBit1000(): void {
    G.g_aVehicles[0].profile!.unlocks |= 0x1000;
}

export function CheatSetUnlockBit800(): void {
    G.g_aVehicles[0].profile!.unlocks |= 0x0800;
}

export function CheatSetUnlockBit400(): void {
    G.g_aVehicles[0].profile!.unlocks |= 0x0400;
}

export function CheatUnlockTracks5To9(): void {
    G.g_aVehicles[0].profile!.unlockedTracks |= UNLOCKED_TRACKS_5_TO_9;
}

export function CheatSetUnlockBit8000(): void {
    G.g_aVehicles[0].profile!.unlocks |= 0x8000;
}

export function CheatToggleMultiplayerMode(): void {
    G.g_dwMultiplayerMode = G.g_dwMultiplayerMode ? 0 : 1;
}

export function CheatToggleBilinearFilter(): void {
    inputGlobals.g_bBilinearFiltering = inputGlobals.g_bBilinearFiltering ? 0 : 1;
}

const CHEAT_ROUTINES = new Map<number, () => void>([
    [0x80254f40, CheatToggleRamView],
    [0x80254f58, CheatUnlockTracks0To4],
    [0x80254f70, CheatUnlockCars0To8],
    [0x80254f88, CheatSetUnlockBit200],
    [0x80254fa0, CheatSetUnlockBit1000],
    [0x80254fb8, CheatSetUnlockBit800],
    [0x80254fd0, CheatSetUnlockBit400],
    [0x80254fe8, CheatUnlockTracks5To9],
    [0x80255000, CheatSetUnlockBit8000],
    [0x80255018, CheatToggleMultiplayerMode],
    [0x80255030, CheatToggleBilinearFilter],
]);

export function loadInputData(dataSegment: DataView): void {
    const at = (address: number): number => address - DATA_SEGMENT_RAM;
    g_aCheatCodes.length = 0;
    for (let o = at(CHEAT_CODES_ADDRESS); ; o += 8) {
        const apply = dataSegment.getUint32(o);
        const pointer = dataSegment.getUint32(o + 4);
        if (pointer === 0) {
            g_aCheatCodes.push({ apply: () => {}, sequence: null });
            break;
        }
        const sequence: number[] = [];
        for (let s = at(pointer); ; s += 2) {
            const code = dataSegment.getUint16(s);
            sequence.push(code);
            if (code === CHEAT_SEQUENCE_END) {
                break;
            }
        }
        g_aCheatCodes.push({ apply: CHEAT_ROUTINES.get(apply) ?? (() => {}), sequence });
    }
}

export function ProcessInputCommandBuffer(state: PlayerInputState): void {
    const buttons = u16(state.buttons);

    if (buttons !== state.history[state.historyIndex]) {
        state.historyIndex = (state.historyIndex - 1) & (INPUT_HISTORY_SIZE - 1);
        state.history[state.historyIndex] = buttons;

        for (let j = 0; j < g_aCheatCodes.length; j++) {
            const sequence = g_aCheatCodes[j].sequence;
            if (sequence === null) {
                break;
            }
            let i = state.historyIndex;
            let matched = true;
            for (let code = 0; sequence[code] !== CHEAT_SEQUENCE_END; code++, i = (i + 1) & (INPUT_HISTORY_SIZE - 1)) {
                if (sequence[code] !== state.history[i]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                g_aCheatCodes[j].apply();
            }
        }
    }
}

function ADD_BRAKE_ACTION(state: PlayerInputState): void {
    if (state.buttons & INPUT_ACCELERATE) {
        state.buttons = (state.buttons | INPUT_EBRAKE) >>> 0;
    } else {
        state.buttons = (state.buttons | INPUT_BRAKE) >>> 0;
    }
}

function press(state: PlayerInputState, bits: number): void {
    state.buttons = (state.buttons | bits) >>> 0;
}

export function TranslateControllerInput(state: PlayerInputState): void {
    const pad = g_aContPadData[state.playerIndex];

    if (pad.errno !== 0) {
        state.controllerMissing = pad.errno === CONT_NO_RESPONSE_ERROR ? 1 : 0;
        pad.stick_x = 0;
        pad.stick_y = 0;
        pad.button = 0;
    } else {
        state.controllerMissing = 0;
    }

    const pressed = pad.button;
    state.buttons = 0;
    if (pressed & U_JPAD) {
        state.buttons = INPUT_UP;
    }
    if (pressed & D_JPAD) {
        press(state, INPUT_DOWN);
    }
    if (pressed & L_JPAD) {
        press(state, INPUT_LEFT);
    }
    if (pressed & R_JPAD) {
        press(state, INPUT_RIGHT);
    }
    if (pressed & A_BUTTON) {
        press(state, INPUT_A);
    }
    if (pressed & B_BUTTON) {
        press(state, INPUT_B);
    }
    if (pressed & L_TRIG) {
        press(state, INPUT_L);
    }
    if (pressed & R_TRIG) {
        press(state, INPUT_R);
    }
    if (pressed & Z_TRIG) {
        press(state, INPUT_Z);
    }
    if (pressed & START_BUTTON) {
        press(state, INPUT_START);
    }
    if (pressed & U_CBUTTONS) {
        press(state, INPUT_C_UP);
    }
    if (pressed & R_CBUTTONS) {
        press(state, INPUT_C_RIGHT);
    }
    if (pressed & D_CBUTTONS) {
        press(state, INPUT_C_DOWN);
    }
    if (pressed & L_CBUTTONS) {
        press(state, INPUT_C_LEFT);
    }

    if (inputHooks.IsRacingScreen()) {
        switch (state.controllerLayout) {
            case 4:
            case 0:
                if (state.controllerLayout === 4) {
                    if (state.buttons & INPUT_L) {
                        press(state, INPUT_GEAR_DOWN);
                    }
                    if (state.buttons & INPUT_R) {
                        press(state, INPUT_GEAR_UP);
                    }
                } else {
                    if (state.buttons & INPUT_Z) {
                        press(state, INPUT_GEAR_DOWN);
                    }
                    if (state.buttons & INPUT_R) {
                        press(state, INPUT_GEAR_UP);
                    }
                }
                state.steeringInput = s8(pad.stick_x);
                if (state.buttons & INPUT_A) {
                    if (pad.stick_y < REVERSE_STICK_Y) {
                        press(state, INPUT_REVERSE);
                    }
                    press(state, INPUT_ACCELERATE);
                }
                if (state.buttons & INPUT_B) {
                    ADD_BRAKE_ACTION(state);
                }
                if (state.buttons & INPUT_C_UP) {
                    press(state, INPUT_VIEW_COCKPIT);
                }
                if (state.buttons & INPUT_C_DOWN) {
                    press(state, INPUT_VIEW_CHASE);
                }
                if (state.buttons & INPUT_C_LEFT) {
                    press(state, INPUT_VIEW_BUMPER);
                }
                break;
            case 1:
                if (state.buttons & INPUT_Z) {
                    press(state, INPUT_GEAR_DOWN);
                }
                if (state.buttons & INPUT_R) {
                    press(state, INPUT_GEAR_UP);
                }
                state.steeringInput = s8(pad.stick_x);
                if (state.buttons & INPUT_A) {
                    if (pad.stick_y < REVERSE_STICK_Y) {
                        press(state, INPUT_REVERSE);
                    }
                    press(state, INPUT_ACCELERATE);
                }
                if (state.buttons & INPUT_B) {
                    press(state, INPUT_BRAKE);
                }
                if (state.buttons & INPUT_C_DOWN) {
                    press(state, INPUT_EBRAKE);
                }
                if (state.buttons & INPUT_C_UP) {
                    press(state, INPUT_VIEW_COCKPIT);
                }
                if (state.buttons & INPUT_C_RIGHT) {
                    press(state, INPUT_VIEW_CHASE);
                }
                if (state.buttons & INPUT_C_LEFT) {
                    press(state, INPUT_VIEW_BUMPER);
                }
                break;
            case 2:
                if (state.buttons & INPUT_LEFT) {
                    if (state.buttons & INPUT_RIGHT) {
                        state.steeringInput = 0;
                    } else {
                        state.steeringInput = -DPAD_STEERING;
                    }
                } else if (state.buttons & INPUT_RIGHT) {
                    state.steeringInput = DPAD_STEERING;
                } else {
                    state.steeringInput = 0;
                }
                if (state.buttons & INPUT_A) {
                    if (state.buttons & INPUT_DOWN) {
                        press(state, INPUT_REVERSE);
                    }
                    press(state, INPUT_ACCELERATE);
                }
                if (state.buttons & INPUT_B) {
                    ADD_BRAKE_ACTION(state);
                }
                if (state.buttons & INPUT_L) {
                    press(state, INPUT_GEAR_DOWN);
                }
                if (state.buttons & INPUT_R) {
                    press(state, INPUT_GEAR_UP);
                }
                if (state.buttons & INPUT_C_UP) {
                    press(state, INPUT_VIEW_COCKPIT);
                }
                if (state.buttons & INPUT_C_DOWN) {
                    press(state, INPUT_VIEW_CHASE);
                }
                if (state.buttons & INPUT_C_LEFT) {
                    press(state, INPUT_VIEW_BUMPER);
                }
                break;
            case 3:
                if (pad.stick_y >= ACCELERATE_STICK_Y) {
                    press(state, INPUT_ACCELERATE);
                } else if (pad.stick_y < LAYOUT3_REVERSE_STICK_Y) {
                    press(state, INPUT_ACCELERATE | INPUT_REVERSE);
                }
                state.steeringInput = s8(pad.stick_x);
                if (state.buttons & INPUT_Z) {
                    ADD_BRAKE_ACTION(state);
                }
                if (state.buttons & (INPUT_A | INPUT_DOWN)) {
                    press(state, INPUT_GEAR_DOWN);
                }
                if (state.buttons & (INPUT_B | INPUT_UP)) {
                    press(state, INPUT_GEAR_UP);
                }
                if (state.buttons & INPUT_C_UP) {
                    press(state, INPUT_VIEW_COCKPIT);
                }
                if (state.buttons & INPUT_C_DOWN) {
                    press(state, INPUT_VIEW_CHASE);
                }
                if (state.buttons & INPUT_C_LEFT) {
                    press(state, INPUT_VIEW_BUMPER);
                }
                break;
        }
    }

    if (state.recordBuffers[0] !== null || state.recordBuffers[1] !== null) {
        for (let i = 0; i < INPUT_RECORDERS; i++) {
            const buffer = state.recordBuffers[i];
            if (buffer !== null && state.recordPositions[i] < state.recordLimits[i]) {
                buffer[state.recordPositions[i]] = u8(state.steeringInput);
                buffer[state.recordPositions[i] + 1] = (state.buttons & INPUT_RECORDED_ACTIONS) >>> 16;
                if (!G.g_dwRacePauseState) {
                    state.recordPositions[i] += 2;
                }
            }
        }
    } else if (state.playbackBuffer !== null) {
        if (state.playbackPosition < state.playbackLimit) {
            state.steeringInput = s8(state.playbackBuffer[state.playbackPosition]);
            state.buttons = ((state.buttons & ~INPUT_RECORDED_ACTIONS) | (state.playbackBuffer[state.playbackPosition + 1] << 16)) >>> 0;
            if (!G.g_dwRacePauseState) {
                state.playbackPosition += 2;
            }
        } else {
            state.steeringInput = 0;
            state.buttons = (state.buttons & ~INPUT_RECORDED_ACTIONS) >>> 0;
        }
    }

    state.stickX = f(pad.stick_x / STICK_RANGE);
    state.steering = f(state.steeringInput / STICK_RANGE);
    state.stickY = f(pad.stick_y / STICK_RANGE);
    if (state.stickX > 1.0) {
        state.stickX = 1.0;
    } else if (state.stickX < -1.0) {
        state.stickX = -1.0;
    }
    if (state.stickY > 1.0) {
        state.stickY = 1.0;
    } else if (state.stickY < -1.0) {
        state.stickY = -1.0;
    }
    if (state.steering > 1.0) {
        state.steering = 1.0;
    } else if (state.steering < -1.0) {
        state.steering = -1.0;
    }

    ProcessInputCommandBuffer(state);
}

export function TransferFlags(state: PlayerInputState, mask: number): void {
    state.heldButtons = (state.heldButtons | (state.buttons & mask)) >>> 0;
    state.buttons = (state.buttons & ~mask) >>> 0;
}

export function ConsumeInputFlags(state: PlayerInputState): void {
    const buttons = state.buttons;

    state.buttons = (state.buttons ^ (buttons & state.heldButtons)) >>> 0;
    state.heldButtons = (state.heldButtons & buttons) >>> 0;
}

export function CheckAnalogStickPositive(state: PlayerInputState, timer: Ref<number>, axis: Ref<number>, button: number): void {
    const time = timer.value;

    if (time !== 0) {
        if (axis.value < STICK_RELEASE) {
            timer.value = 0;
        } else if (time > 0) {
            timer.value = (time - G.g_dwFrameDeltaMs) | 0;
            if (timer.value <= 0) {
                press(state, button);
                timer.value = -STICK_REPEAT_DELAY;
            }
        } else {
            timer.value = (time + G.g_dwFrameDeltaMs) | 0;
            if (timer.value >= 0) {
                press(state, button);
                timer.value = -STICK_REPEAT_DELAY;
            }
        }
    } else if (axis.value > STICK_PRESS) {
        press(state, button);
        timer.value = STICK_FIRST_DELAY;
    }
}

export function CheckAnalogStickNegative(state: PlayerInputState, timer: Ref<number>, axis: Ref<number>, button: number): void {
    const time = timer.value;

    if (time !== 0) {
        if (axis.value > -STICK_RELEASE) {
            timer.value = 0;
        } else if (time > 0) {
            timer.value = (time - G.g_dwFrameDeltaMs) | 0;
            if (timer.value <= 0) {
                press(state, button);
                timer.value = -STICK_REPEAT_DELAY;
            }
        } else {
            timer.value = (time + G.g_dwFrameDeltaMs) | 0;
            if (timer.value >= 0) {
                press(state, button);
                timer.value = -STICK_REPEAT_DELAY;
            }
        }
    } else if (axis.value < -STICK_PRESS) {
        press(state, button);
        timer.value = STICK_FIRST_DELAY;
    }
}

export function UpdateStickRepeat(state: PlayerInputState): void {
    const timer = ref(state.repeatUp);
    CheckAnalogStickPositive(state, timer, ref(state.stickY), INPUT_UP);
    state.repeatUp = timer.value;
    timer.value = state.repeatDown;
    CheckAnalogStickNegative(state, timer, ref(state.stickY), INPUT_DOWN);
    state.repeatDown = timer.value;
    timer.value = state.repeatLeft;
    CheckAnalogStickNegative(state, timer, ref(state.stickX), INPUT_LEFT);
    state.repeatLeft = timer.value;
    timer.value = state.repeatRight;
    CheckAnalogStickPositive(state, timer, ref(state.stickX), INPUT_RIGHT);
    state.repeatRight = timer.value;
}

export function InitPlayerInputState(state: PlayerInputState): void {
    const player = G.g_aPlayerInputState.indexOf(state);

    state.recordBuffers[1] = null;
    state.recordBuffers[0] = null;
    state.playbackBuffer = null;
    state.playerIndex = player;
}

export function UpdateControllerState(): void {
    for (let i = 0; i < MAX_PLAYERS; i++) {
        TranslateControllerInput(G.g_aPlayerInputState[i]);
        ConsumeInputFlags(G.g_aPlayerInputState[i]);
    }
}
