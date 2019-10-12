
import { vec3, quat } from "gl-matrix";
import { AABB } from "../Geometry";

function readItems(text: string, cb: (section: string, line: string[]) => void) {
    const lines = text.split("\n");
    let section = null;
    for (const s of lines) {
        const line = s.trim().toLowerCase();
        if (line === "" || line[0] === "#") continue;
        if (section === null) {
            section = line;
        } else if (line === "end") {
            section = null;
        } else {
            cb(section, line.split(", "));
        }
    }
}

// https://gtamods.com/wiki/Item_Definition
export enum ObjectFlags {
    DO_NOT_FADE = 0x02,
    DRAW_LAST = 0x04,
    ADDITIVE = 0x08,
    IS_SUBWAY = 0x10,
    IGNORE_LIGHTING = 0x20,
    NO_ZBUFFER_WRITE = 0x40,
}

export interface ObjectDefinition {
    id?: number;
    modelName: string;
    txdName: string;
    drawDistance: number;
    flags: number;
    tobj: boolean;
    timeOn?: number;
    timeOff?: number;
}

function parseObjectDefinition(row: string[], tobj: boolean): ObjectDefinition {
    const def: ObjectDefinition = {
        id: Number(row[0]),
        modelName: row[1],
        txdName: row[2],
        drawDistance: Number((row.length > 5) ? row[4] : row[3]),
        flags: Number(tobj ? row[row.length - 3] : row[row.length - 1]),
        tobj
    };
    if (tobj) {
        def.timeOn  = Number(row[row.length - 2]);
        def.timeOff = Number(row[row.length - 1]);
    }
    return def;
}

export interface ItemDefinition {
    objects: ObjectDefinition[];
}

export function parseItemDefinition(text: string): ItemDefinition {
    let objects = [] as ObjectDefinition[];
    readItems(text, function(section, line) {
        if (section === "objs" || section === "tobj") {
            objects.push(parseObjectDefinition(line, section === "tobj"));
        }
    });
    return { objects };
}

export interface ItemInstance {
    id?: number;
    modelName: string;
    translation: vec3;
    scale: vec3;
    rotation: quat;
}

function parseItemInstance([id, model, posX, posY, posZ, scaleX, scaleY, scaleZ, rotX, rotY, rotZ, rotW]: string[]): ItemInstance {
    return {
        id: Number(id),
        modelName: model,
        translation: vec3.fromValues(Number(posX), Number(posY), Number(posZ)),
        scale: vec3.fromValues(Number(scaleX), Number(scaleY), Number(scaleZ)),
        rotation: quat.fromValues(Number(rotX), Number(rotY), Number(rotZ), -Number(rotW))
    };
}

export interface ItemPlacement {
    instances: ItemInstance[];
}

export function parseItemPlacement(text: string): ItemPlacement {
    let instances = [] as ItemInstance[];
    readItems(text, function(section, line) {
        if (section === "inst") instances.push(parseItemInstance(line));
    });
    return { instances };
}

export function parseZones(text: string): Map<string, AABB> {
    let zones = new Map<string, AABB>();
    readItems(text, function(section, [name, type, x1, y1, z1, x2, y2, z2, level]) {
        if (section === "zone" && type === "0")
            zones.set(name, new AABB(Number(x1), Number(y1), Number(z1),
                                     Number(x2), Number(y2), Number(z2)));
    });
    return zones;
}
