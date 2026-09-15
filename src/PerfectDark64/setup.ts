import ArrayBufferSlice from "../ArrayBufferSlice";
import { AABB } from "../Geometry";
import { vec3 } from "gl-matrix";
import { hexzero0x } from "../util";

import { Color, loadColorFromView } from "./f3dex";

export interface Pad {
    pos: vec3;
    look: vec3;
    up: vec3;
    normal: vec3;
    bbox: AABB;
    room: number;
    flags: number;
    liftNum: number;
    // unk52: number;
}

/*
Pads file header:
    numpads:         number;   // s32
    numcovers:       number;   // s32
    waypointsoffset: number;   // s32
    waygroupsoffset: number;   // s32
    coversoffset:    number;   // s32
    offsets:         number[]; // u16[numpads]
*/

export function loadPadsFromBinary(data: ArrayBufferSlice): Pad[] {
    const ret: Pad[] = [];
    const view = data.createDataView();
    const numPads = view.getInt32(0x00);

    for (let i = 0; i < numPads; i++) {
        const offset = view.getUint16(0x14 + (i * 2));
        ret.push(padFromView(view, offset));
    }

    return ret;
}

function padFromView(view: DataView, offset: number): Pad {
    const header = view.getUint32(offset);
    offset += 4;

    const flags = header >>> 14;
    const room = (header >>> 4) & 0x3ff;
    const liftNum = header & 0xf;

    let pos: vec3;
    if (flags & PadFlag.INTPOS) {
        pos = vec3.fromValues(
            view.getInt16(offset + 0x00),
            view.getInt16(offset + 0x02),
            view.getInt16(offset + 0x04),
        );
        offset += 8;
    } else {
        pos = vec3.fromValues(
            view.getFloat32(offset + 0x00),
            view.getFloat32(offset + 0x04),
            view.getFloat32(offset + 0x08),
        );
        offset += 12;
    }

    let up: vec3;
	if (flags & (PadFlag.UPALIGNTOX | PadFlag.UPALIGNTOY | PadFlag.UPALIGNTOZ)) {
        const sign = (flags & PadFlag.UPALIGNINVERT) ? -1 : 1;
        up = vec3.fromValues(
            (flags & PadFlag.UPALIGNTOX) ? sign : 0,
            (flags & PadFlag.UPALIGNTOY) ? sign : 0,
            (flags & PadFlag.UPALIGNTOZ) ? sign : 0,
        );
    } else {
        up = vec3.fromValues(
            view.getFloat32(offset + 0x00),
            view.getFloat32(offset + 0x04),
            view.getFloat32(offset + 0x08),
        );
        offset += 12;
    }

    let look: vec3;
	if (flags & (PadFlag.LOOKALIGNTOX | PadFlag.LOOKALIGNTOY | PadFlag.LOOKALIGNTOZ)) {
        const sign = (flags & PadFlag.LOOKALIGNINVERT) ? -1 : 1;
        look = vec3.fromValues(
            (flags & PadFlag.LOOKALIGNTOX) ? sign : 0,
            (flags & PadFlag.LOOKALIGNTOY) ? sign : 0,
            (flags & PadFlag.LOOKALIGNTOZ) ? sign : 0,
        );
    } else {
        look = vec3.fromValues(
            view.getFloat32(offset + 0x00),
            view.getFloat32(offset + 0x04),
            view.getFloat32(offset + 0x08),
        );
        offset += 12;
    }

    const normal = vec3.fromValues(
        up[1] * look[2] - look[1] * up[2],
        up[2] * look[0] - look[2] * up[0],
        up[0] * look[1] - look[0] * up[1],
    );

    let bbox: AABB;
    if (flags & PadFlag.HASBBOXDATA) {
        bbox = new AABB(
            view.getFloat32(offset + 0x00),
            view.getFloat32(offset + 0x08),
            view.getFloat32(offset + 0x10),
            view.getFloat32(offset + 0x04),
            view.getFloat32(offset + 0x0c),
            view.getFloat32(offset + 0x14),
        );
    } else {
        bbox = new AABB(
            -100, -100, -100,
            100, 100, 100,
        );
    }

    return {flags, room, liftNum, pos, look, up, normal, bbox};
}

export enum PadFlag {
    INTPOS          = 0x0001,
    UPALIGNTOX      = 0x0002,
    UPALIGNTOY      = 0x0004,
    UPALIGNTOZ      = 0x0008,
    UPALIGNINVERT   = 0x0010,
    LOOKALIGNTOX    = 0x0020,
    LOOKALIGNTOY    = 0x0040,
    LOOKALIGNTOZ    = 0x0080,
    LOOKALIGNINVERT = 0x0100,
    HASBBOXDATA     = 0x0200,
    AIWAITLIFT      = 0x0400,
    AIONLIFT        = 0x0800,
    AIWALKDIRECT    = 0x1000,
    AIDROP          = 0x2000,
    AICROUCH        = 0x4000,
    AIIGNOREY       = 0x8000,
    AIDUCK          = 0x10000,
    AIBOTINUSE      = 0x20000,
}

// A "setup" is a bunch of data/bytecode that contains the gameplay logic for a
// level and how all props are placed and configured.
export class Setup {
    public doors: Door[] = [];
    public basic: Basic[] = [];
    public spawn?: Pad;

    private addPropFromView(
        view: DataView,
        offset: number,
        state: SetupState,
        pads: Pad[],
    ): void {
        const type = view.getUint8(offset + 3);

        switch (type) {
            case ObjectType.BASIC: {
                const obj = defaultObjectFromView(view, offset);
                if (obj.pad < 0) {
                    break;
                }

                const pad = pads[obj.pad];
                this.basic.push({obj, pad});
                break;
            }
            case ObjectType.DOOR:
                this.doors.push(createDoorFromView(view, offset, state, pads));
                break;
            default:
                // Any prop we don't care about is a NOOP.
                break;
        }
    }

    public static fromBinary(data: ArrayBufferSlice, pads: Pad[]): Setup {
        const setup = new Setup();
        const view = data.createDataView();
        const header = setupHeaderFromView(view);

        setup.loadPropsFromView(view, header.props, pads);
        setup.loadIntroFromView(view, header.intro, pads);

        return setup;
    }

    private loadIntroFromView(view: DataView, offset: number, pads: Pad[]): void {
        for (;;) {
            const cmd = view.getInt32(offset);

            switch(cmd) {
                case IntroCommand.END:
                    return;
                case IntroCommand.SPAWN: {
                    const padNum = view.getInt32(offset + 4);
                    this.spawn = pads[padNum];
                    break;
                }
            }

            offset += introCommandSize(cmd) * 4;
        }
    }

    private loadPropsFromView(view: DataView, offset: number, pads: Pad[]): void {
        const state: SetupState = {
            doorScale: 1.0,
        };

        for (;;) {
            const type = view.getUint8(offset + 3);

            switch (type) {
                case ObjectType.END:
                    return;
                case ObjectType.DOORSCALE:
                    state.doorScale = view.getInt32(offset + 4) / 65536;
                    break;
            }

            this.addPropFromView(view, offset, state, pads);

            offset += objectSize(type);
        }
    }
}

interface SetupState {
    doorScale: number;
}

function createDoorFromView(
    view: DataView,
    offset: number,
    state: SetupState,
    pads: Pad[],
): Door {
    const obj = defaultObjectFromView(view, offset);
    const pad = pads[obj.pad];

    if (state.doorScale !== 1.0) {
        pad.bbox.min[0] *= state.doorScale;
        pad.bbox.max[0] *= state.doorScale;
    }

    return {obj, pad};
}

interface Door {
    obj: DefaultObject;
    pad: Pad;
}

interface Basic {
    obj: DefaultObject;
    pad: Pad;
}

interface DefaultObject {
    extraScale: number;     // u16
    hidden2:    number;     // u8
    type:       ObjectType; // u8
    modelnum:   number;     // s16
    pad:        number;     // s16
    flags:      number;     // u32
    flags2:     number;     // u32
    flags3:     number;     // u32
    prop:       number;     // *
    model:      number;     // *
    realRot:    number[];   // f32[3][3]
    hidden:     number;     // u32

    // union
    geo:      number; // *
    geoTileF: number  // *
    geoBlock: number; // *
    geoCyl:   number; // *

    // union
    projectile: number; // *
    embedment:  number; // *

    damage:    number; // s16
    maxDamage: number; // s16
    shadeCol:  Color;  // u8[4]
    nextCol:   Color;  // u8[4]
    geoCount:  number; // s8
}
const defaultObjectSize = 0x5b + 1 /* pad */;

function objectSize(type: ObjectType): number {
    // Padding is separated for clarity.

    switch (type) {
        case ObjectType.BASIC:  return defaultObjectSize;
        case ObjectType.DEBRIS: return defaultObjectSize;

        case ObjectType.AMMOCRATE:               return 0x60;
        case ObjectType.AUTOGUN:                 return 0xac;
        case ObjectType.BEGINOBJECTIVE:          return 0x10;
        case ObjectType.BLOCKEDPATH:             return 0x10;
        case ObjectType.BRIEFING:                return 4*4;
        case ObjectType.CAMERAPRESET:            return 7*4;
        case ObjectType.CCTV:                    return 0xc4;
        case ObjectType.CHOPPER:                 return 0xe8;
        case ObjectType.CHR:                     return 0x2c;
        case ObjectType.CONDITIONALSCENERY:      return 5*4;
        case ObjectType.DOOR:                    return 0xdb   + 1;
        case ObjectType.DOORSCALE:               return 0x08;
        case ObjectType.ENDOBJECTIVE:            return 4;
        case ObjectType.ESCASTEP:                return 0x6c;
        case ObjectType.FAN:                     return 0x71   + 3;
        case ObjectType.GLASS:                   return 0x5e   + 2;
        case ObjectType.HOVERBIKE:               return 0xe0;
        case ObjectType.HOVERCAR:                return 0x98;
        case ObjectType.HOVERPROP:               return 0x9c;
        case ObjectType.KEY:                     return 0x60;
        case ObjectType.LIFT:                    return 0x94;
        case ObjectType.LINKGUNS:                return 0x08;
        case ObjectType.LINKLIFTDOOR:            return 5*4;
        case ObjectType.MINE:                    return 0x68;
        case ObjectType.MULTIMONITOR:            return 0x230;
        case ObjectType.OBJECTIVE_COLLECTOBJ:    return 8;
        case ObjectType.OBJECTIVE_COMPFLAGS:     return 8;
        case ObjectType.OBJECTIVE_COPYGOLDENEYE: return 4;
        case ObjectType.OBJECTIVE_DESTROYOBJ:    return 8;
        case ObjectType.OBJECTIVE_FAILFLAGS:     return 8;
        case ObjectType.OBJECTIVE_HOLOGRAPH:     return 4*4;
        case ObjectType.OBJECTIVE_THROWOBJ:      return 8;
        case ObjectType.OBJECTIVE_UNK1F:         return 4;
        case ObjectType.PADEFFECT:               return 3*4;
        case ObjectType.RENAMEOBJ:               return 0x28;
        case ObjectType.SHIELD:                  return 0x68;
        case ObjectType.SINGLEMONITOR:           return 0xd3   + 1;
        case ObjectType.TAG:                     return 0x10;
        case ObjectType.TANK:                    return 32*4;
        case ObjectType.TINTEDGLASS:             return 0x68;
        case ObjectType.WEAPON:                  return 0x68;
        case ObjectType.MULTIAMMOCRATE:          return 0xA8;
    }

    throw new Error(["unhandled type:", hexzero0x(type, 2), ObjectType[type]].join(" "));
    return 1;
}

function defaultObjectFromView(view: DataView, offset: number): DefaultObject {
    return {
        extraScale: view.getUint16(offset + 0x00),
        hidden2:    view.getUint8(offset  + 0x02),
        type:       view.getUint8(offset  + 0x03),
        modelnum:   view.getInt16(offset  + 0x04),
        pad:        view.getInt16(offset  + 0x06),
        flags:      view.getUint32(offset + 0x08),
        flags2:     view.getUint32(offset + 0x0c),
        flags3:     view.getUint32(offset + 0x10),
        prop:       view.getUint32(offset + 0x14),
        model:      view.getUint32(offset + 0x18),
        realRot:    getFloat32Array(view, offset + 0x1c, 3*3),
        hidden:     view.getUint32(offset + 0x40),

        geo:      view.getUint32(offset + 0x44),
        geoTileF: view.getUint32(offset + 0x44),
        geoBlock: view.getUint32(offset + 0x44),
        geoCyl:   view.getUint32(offset + 0x44),

        projectile: view.getUint32(offset + 0x48),
        embedment:  view.getUint32(offset + 0x48),

        damage:     view.getInt16(offset + 0x4c),
        maxDamage:  view.getInt16(offset + 0x4e),
        shadeCol:   loadColorFromView(view, offset + 0x50),
        nextCol:    loadColorFromView(view, offset + 0x54),
        geoCount:   view.getUint8(offset + 0x5a),
    };
}

function getFloat32Array(view: DataView, offset: number, entries: number): number[] {
    const ret = new Array(entries);
    for (let i = 0; i < entries; i++) {
        ret[i] = view.getFloat32(offset + i * 4);
    }

    return ret;
}

interface setupHeader {
    waypoints: number; // u32
    waygroup: number; // u32
    cover: number; // u32
    intro: number; // s32
    props: number; // u32
    paths: number; // u32
    aiLists: number; // u32
}

function setupHeaderFromView(view: DataView): setupHeader {
    return {
        waypoints: view.getUint32(0),
        waygroup:  view.getUint32(4),
        cover:     view.getUint32(8),
        intro:     view.getInt32(12),
        props:     view.getUint32(16),
        paths:     view.getUint32(20),
        aiLists:   view.getUint32(24),
    };
}

enum IntroCommand {
    SPAWN        = 0,
    WEAPON       = 1,
    AMMO         = 2,
    OUTFIT       = 5,
    WATCHTIME    = 7,
    CREDITOFFSET = 8,
    CASE         = 9,
    CASERESPAWN  = 10,
    HILL         = 11,
    END          = 12,
}

function introCommandSize(cmd: IntroCommand): number {
    switch(cmd) {
        case IntroCommand.END:          return 1;
        case IntroCommand.HILL:
        case IntroCommand.OUTFIT:       return 2;
        case IntroCommand.CASE:
        case IntroCommand.CASERESPAWN:
        case IntroCommand.SPAWN:        return 3;
        case IntroCommand.WEAPON:
        case IntroCommand.AMMO:
        case IntroCommand.WATCHTIME:
        case IntroCommand.CREDITOFFSET: return 4;
    }

    throw new Error(`unhandled intro command: ${hexzero0x(cmd, 2)}`);
}

enum ObjectType {
    DOOR                    = 0x01,
    DOORSCALE               = 0x02,
    BASIC                   = 0x03,
    KEY                     = 0x04,
    ALARM                   = 0x05,
    CCTV                    = 0x06,
    AMMOCRATE               = 0x07,
    WEAPON                  = 0x08,
    CHR                     = 0x09,
    SINGLEMONITOR           = 0x0a,
    MULTIMONITOR            = 0x0b,
    HANGINGMONITORS         = 0x0c,
    AUTOGUN                 = 0x0d,
    LINKGUNS                = 0x0e,
    DEBRIS                  = 0x0f,
    UNK10                   = 0x10,
    HAT                     = 0x11,
    GRENADEPROB             = 0x12,
    LINKLIFTDOOR            = 0x13,
    MULTIAMMOCRATE          = 0x14,
    SHIELD                  = 0x15,
    TAG                     = 0x16,
    BEGINOBJECTIVE          = 0x17,
    ENDOBJECTIVE            = 0x18,
    OBJECTIVE_DESTROYOBJ    = 0x19,
    OBJECTIVE_COMPFLAGS     = 0x1a,
    OBJECTIVE_FAILFLAGS     = 0x1b,
    OBJECTIVE_COLLECTOBJ    = 0x1c,
    OBJECTIVE_THROWOBJ      = 0x1d,
    OBJECTIVE_HOLOGRAPH     = 0x1e,
    OBJECTIVE_UNK1F         = 0x1f,
    OBJECTIVE_ENTERROOM     = 0x20,
    OBJECTIVE_THROWINROOM   = 0x21,
    OBJECTIVE_COPYGOLDENEYE = 0x22,
    BRIEFING                = 0x23,
    GASBOTTLE               = 0x24,
    RENAMEOBJ               = 0x25,
    PADLOCKEDDOOR           = 0x26,
    TRUCK                   = 0x27,
    HELI                    = 0x28,
    UNK29                   = 0x29,
    GLASS                   = 0x2a,
    SAFE                    = 0x2b,
    SAFEITEM                = 0x2c,
    TANK                    = 0x2d,
    CAMERAPRESET            = 0x2e,
    TINTEDGLASS             = 0x2f,
    LIFT                    = 0x30,
    CONDITIONALSCENERY      = 0x31,
    BLOCKEDPATH             = 0x32,
    HOVERBIKE               = 0x33,
    END                     = 0x34, // End of prop list marker.
    HOVERPROP               = 0x35,
    FAN                     = 0x36,
    HOVERCAR                = 0x37,
    PADEFFECT               = 0x38,
    CHOPPER                 = 0x39,
    MINE                    = 0x3a,
    ESCASTEP                = 0x3b,
}
