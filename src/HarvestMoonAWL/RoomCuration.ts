// This is a curation decision - put certain room objects together in
// the same noclip scene so the user can see the big picture. 
// Examples include the Inn and Villa. This deviates from what's actually on
// disk, as these are technically all completely separate scenes.

import { vec3 } from "gl-matrix";

//#region Parts and their attachments

// Part 0 is the anchor and stays at its archive's own origin
export interface RoomPart {
    archiveName: string;
    attach?: RoomAttach;
    offset?: readonly [number, number, number];
}

export type RoomAttachRelation = 'north' | 'west' | 'east';

export interface RoomAttach {
    relation: RoomAttachRelation;
    partner: number;
    align?: 'center' | 'min' | 'max';
    // Override ROOM_PAIR_GAP
    gap?: number;
}

//#endregion

//#region Layout

export const ROOM_PAIR_GAP = 1.0;

export function layoutRoomParts(parts: readonly RoomPart[], bounds: readonly [vec3, vec3][]): vec3[] {
    const offsets = parts.map(() => vec3.create());
    const min = vec3.create(), max = vec3.create();
    const partnerMin = vec3.create(), partnerMax = vec3.create();

    for (let i = 0; i < parts.length; i++) {
        const attach = parts[i].attach;
        if (attach !== undefined)
            resolveAttach(i, attach);
        const manual = parts[i].offset;
        if (manual !== undefined)
            vec3.set(offsets[i], offsets[i][0] + manual[0], offsets[i][1] + manual[1], offsets[i][2] + manual[2]);
    }
    return offsets;

    function resolveAttach(i: number, attach: RoomAttach): void {
        vec3.add(min, bounds[i][0], offsets[i]);
        vec3.add(max, bounds[i][1], offsets[i]);
        vec3.add(partnerMin, bounds[attach.partner][0], offsets[attach.partner]);
        vec3.add(partnerMax, bounds[attach.partner][1], offsets[attach.partner]);
        if (!Number.isFinite(min[0]) || !Number.isFinite(partnerMin[0]))
            return;

        const gap = attach.gap !== undefined ? attach.gap : ROOM_PAIR_GAP;
        const joinAxis = attach.relation === 'north' ? 2 : 0;
        const crossAxis = attach.relation === 'north' ? 0 : 2;

        if (attach.relation === 'east')
            offsets[i][joinAxis] = partnerMax[joinAxis] - min[joinAxis] + gap;
        else
            offsets[i][joinAxis] = partnerMin[joinAxis] - max[joinAxis] - gap;

        if (attach.align === 'min')
            offsets[i][crossAxis] = partnerMin[crossAxis] - min[crossAxis];
        else if (attach.align === 'max')
            offsets[i][crossAxis] = partnerMax[crossAxis] - max[crossAxis];
        else
            offsets[i][crossAxis] = (partnerMin[crossAxis] + partnerMax[crossAxis]) / 2 - (min[crossAxis] + max[crossAxis]) / 2;
    }
}

//#endregion

//#region Per-scene layout tuning

// For multi-room scenes, move the second floor up
export const UPPER_FLOOR_LIFT = 4.0;

// Player's house
export const JITAKU_KITCHEN_GAP = 0.55;
export const JITAKU_CHILDSROOM_GAP = 0.3;


export const INN_ROOM_GAP = 0.25;
export const INN_KITCHEN_GAP = 0.1;
export const INN_HUUHU_GAP = -2.5;
export const INN_FLOOR_GAP = 3.0;

export const VILLA_ROOM_GAP = 0.25;
export const VILLA_FLOOR_GAP = 3.0;
export const VILLA_ROOM4_LIFT = 4.0;

export const BAR_ROOM_GAP = -1.0;

// Chris & Wally's House
export const MINKA1_FLOOR_GAP = 3.0;
export const MINKA2_FLOOR_GAP = 3.0;

// Vesta's house upper floor
export const NOUKA1B_FLOOR_GAP = 3.0;

export const STORAGE_ROOM_GAP = 0.25;

//#endregion
