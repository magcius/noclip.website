import ArrayBufferSlice from "../ArrayBufferSlice";
import { AABB } from "../Geometry";
import { vec3 } from "gl-matrix";

import {
    Color,
    Command,
    GFX,
    Vertex,
    colorStructSize,
    gfxStructSize,
    loadVertexFromView,
    vertexStructSize,
    toReadonlyVec3,
} from "./f3dex";
import { Inflater } from "./rom";

/**
 * BGs (assumed to stand for "background geometry") contains the level geometry
 * as packed vertices/colors and display lists in a cascading mess of offsets,
 * trees, and lists that accommodate F3DEX and pd64's room->portal->room
 * renderer reminiscing of a simplified BSP renderer.
 * The path to the packed data and display lists is BGRoom->Room->n Block->gdl.
 * There's also packed data in BGRoom->Room->GFXData, TODO: find out if block
 * vertices are pointers into this.
 *
 * Rooms are split arbitrarily into "blocks", a tree-like structure containing
 * offsets into the room packed data. There's two blocks list, one for opaque
 * geometry and one for transparent geometry.
 *
 * Structure of a BG segment/file, comment courtesy of the pd64 port (MIT).
 *
 * 4 bytes decompressed size of primary data
 * 4 bytes compressed size of section 1 in its entirety
 * 4 bytes compressed size of primary data
 * Section 1:
 *     Primary: (zipped)
 *         4 bytes null
 *         4 bytes pointer to room table
 *         4 bytes pointer to portal table
 *         4 bytes pointer to bgcmds
 *         4 bytes pointer to lights table
 *         4 bytes null
 *         (room table)
 *         (portal table)
 *         (bgcmds)
 *         (lights table)
 *     room 1 roomgfxdata (zipped)
 *     room 2 roomgfxdata (zipped)
 *     ...
 * Section 2:
 *     2 bytes decompressed size of section (mask with 0x7fff)
 *     2 bytes compressed size of section
 *     Texture ID list (zipped)
 * Section 3:
 *     2 bytes decompressed size of section (mask with 0x7fff)
 *     2 bytes compressed size of section
 *     Zipped:
 *         (room bbox table)
 *         (list of roomgfxdata sizes)
 *         (list of light counts per room)
 */

// All pointers found in a BG segment are offset by this. Don't know why.
// We could also consider all pointers to be 24bit and mask them.
const magicOffset = 0x0F000000;

// Matches the struct on ROM.
interface BGRoomEntry {
    // offset into section 1, almost. This offset is sprinkled over many
    // pointers, since it always needs to be substracted before these pointers
    // we do it when first loading them to avoid repeating ourselves.
    roomOffset: number;
    pos: vec3; // [3]float32

    // FIXME: Unused for now, waiting for the renderer.
    brightnessMin: number; // uint8
    brightnessMax: number; // uint8
}
const bgRoomEntryStructSize = 20;

// Rooms are the are the basic building block of a pd64 level. The original
// renderer renders the room you're at and any other room visible through the
// open portals. Such portals can be open or closed at runtime, eg. every door
// in DataDyne infiltration/extraction is a togglable portal, no need to render
// what's behind a closed door.
// This interface is a mix of the decomp room and gfxdata structs, room is
// mostly a "runtime" type whereas gfxdata is loaded from the ROM.
export class Room {
    // Since in pd64 the first empty entry is left intact rooms are effectively
    // 1-indexed. I don't like keeping invalid data around so for clarity and
    // debugging I leave the "roomnum" here as it would appear in in the game
    // and keep our array clean of empty entries and canary values.
    number: number;

    pos: Vertex;

    // Raw vertices, loaded as-is into the RSP the 0x0E segment.
    vertices: Vertex[];

    // We compute this ourselves, no need to load section 3.
    bbox: AABB;

    colors: Color[];

    blocks: Block[];
    opaqueRoot: number | undefined; // index into blocks
    translucentRoot: number | undefined; // index into blocks
    blockOffsetMap: Map<number, number>; // ptr => index in blocks
    serializedBlockOffsetMap: Array<Array<number>>;

    public constructor(props?:Partial<Room>) {
        Object.assign(this, props);
    }

    public blockAtOffset(offset: number): Block | undefined {
        const index = this.blockOffsetMap.get(offset);
        if (index === undefined) {
            return undefined;
        }

        return this.blocks[index];
    }
}

// Matches the struct on ROM.
interface RoomGFXDataHeader {
    // Pointers into decompressed roomgfxdata.
    verticesPtr:          number, // uint32
    colorsPtr:           number, // uint32
    opaqueBlocksPtr:      number, // uint32
    translucentBlocksPtr: number, // uint32

    lightsIndex:          number, // int16
    numLights:            number, // int16
    numVertices:          number, // int16, computed after loading, we don't use this
    numColors:           number, // int16, computed after loading, we don't use this
}
const roomGFXDataHeaderStructSize = 24;

function readRoomGFXDataHeader(view: DataView, roomOffset: number): RoomGFXDataHeader {
    const header:RoomGFXDataHeader = {
        verticesPtr:          view.getUint32(0),
        colorsPtr:            view.getUint32(4),
        opaqueBlocksPtr:      view.getUint32(8),
        translucentBlocksPtr: view.getUint32(12),
        lightsIndex:          view.getInt16(16),
        numLights:            view.getInt16(18),
        numVertices:          view.getInt16(20),
        numColors:            view.getInt16(22),
    };

    const offset = roomOffset + magicOffset;
    header.verticesPtr          -= header.verticesPtr          === 0 ? 0 : offset;
    header.colorsPtr           -= header.colorsPtr           === 0 ? 0 : offset;
    header.opaqueBlocksPtr      -= header.opaqueBlocksPtr      === 0 ? 0 : offset;
    header.translucentBlocksPtr -= header.translucentBlocksPtr === 0 ? 0 : offset;

    return header;
}

export enum RoomBlockType {
    Leaf   = 0,
    Parent = 1,
}

export interface Block {
    // Offset in roomgfxdata where this block was loaded from.
    offset: number; // uint32

    // {{{ Matches the struct on ROM.
    type: RoomBlockType; // uint8
    // Three 0xFF bytes of padding.
    nextPtr: number; // int32

    // union RoomBlockType.Leaf
    gdlPtr: number; // int32
    verticesPtr: number; // int32
    colorsPtr: number; // int32

    // union RoomBlockType.Parent
    childPtr: number; // int32
    unk0c: number; // int32 // "pointer to 2 coords at least" per decomp comment.
    // }}

    gdls: GFX[];
}
const roomBlockStructSize = 20

function loadBlockGDLs(view: DataView): GFX[] {
    const ret: GFX[] = [];

    for (let i = 0; ; i += gfxStructSize) {
        const gfx = GFX.readFromView(view, i);
        ret.push(gfx);

        if (gfx.command() === Command.G_ENDDL) {
            break;
        }
    }

    return ret;
}

function loadBlock(view: DataView, roomOffset: number, blockOffset: number): Block {
    const ret: Block = {
        offset: blockOffset,

        type: view.getUint8(0),
        nextPtr: view.getUint32(4),

        gdlPtr: view.getUint32(8),
        verticesPtr: view.getUint32(12),
        colorsPtr: view.getUint32(16),

        // Also read the block as if it was a Parent.
        childPtr: view.getUint32(8),
        unk0c: view.getUint32(12),

        gdls: Array<GFX>(),
    };

    const offset = magicOffset + roomOffset;
    ret.nextPtr     -= ret.nextPtr     === 0 ? 0 : offset;
    ret.gdlPtr      -= ret.gdlPtr      === 0 ? 0 : offset;
    ret.verticesPtr -= ret.verticesPtr === 0 ? 0 : offset;
    ret.colorsPtr  -= ret.colorsPtr  === 0 ? 0 : offset;

    return ret;
}

function loadRoomGFXDataBlocks(header: RoomGFXDataHeader, roomOffset: number, gfx: ArrayBufferSlice): Block[] {
    const ret: Block[] = [];
    let end = header.verticesPtr;

    // The first entry is not skipped for a change.
    for (let offset = roomGFXDataHeaderStructSize; offset < end; offset += roomBlockStructSize) {
        const block = loadBlock(
            gfx.subarray(offset, roomBlockStructSize).createDataView(),
            roomOffset,
            offset,
        );

        if (block.type === RoomBlockType.Leaf) {
            block.gdls = loadBlockGDLs(gfx.slice(block.gdlPtr).createDataView());
        }

        if (block.type === RoomBlockType.Parent && block.verticesPtr < end) {
            end = block.verticesPtr;
        }

        ret.push(block);
    }

    return ret;
}

function loadRoomGFXDataColors(
    header: RoomGFXDataHeader,
    view: DataView,
    room: Room,
): Color[] {
    if (header.colorsPtr === 0) {
        return [];
    }

    const nextGDL = findNextGDLInRoom(room, 0, findGDLType.Opaque | findGDLType.Translucent);
    const count = (nextGDL - header.colorsPtr) / colorStructSize;

    return Array.from({length: count}, (_, i) => {
        const offset = header.colorsPtr + (i * colorStructSize);

        return {
            r: view.getUint8(offset),
            g: view.getUint8(offset + 1),
            b: view.getUint8(offset + 2),
            a: view.getUint8(offset + 3),
        }
    });
}

enum findGDLType {
    Opaque      = 1 << 0,
    Translucent = 1 << 1,
}

function findNextGDLInRoom(room:Room, start: number, type: findGDLType) {
    let opaGDL: number = 0;
    let xluGDL: number = 0;

    if (type & findGDLType.Opaque && room.opaqueRoot !== undefined) {
        const block = room.blocks[room.opaqueRoot];
        opaGDL = findNextGDLInBlock(room, block, start, 0);
        if (type === findGDLType.Opaque) {
            return opaGDL;
        }
    }

    if (type & findGDLType.Translucent && room.translucentRoot !== undefined) {
        const block = room.blocks[room.translucentRoot];
        xluGDL = findNextGDLInBlock(room, block, start, 0);
        if (type === findGDLType.Translucent) {
            return xluGDL;
        }
    }

    if (opaGDL > 0) {
        if ((xluGDL > 0) && xluGDL < opaGDL) {
            return xluGDL;
        }

        return opaGDL;
    }

    return xluGDL;
}

function findNextGDLInBlock(room:Room, block: Block | undefined, start: number, end: number): number {
    while(block !== undefined) {
        switch(block.type) {
            case RoomBlockType.Leaf:
                if ((block.gdlPtr > start) && (block.gdlPtr < end || end == 0)) {
                    end = block.gdlPtr;
                }
                block = room.blockAtOffset(block.nextPtr);
                break;
            case RoomBlockType.Parent: {
                const tmp = findNextGDLInBlock(room, room.blockAtOffset(block.childPtr), start, end);
                block = room.blockAtOffset(block.nextPtr);
                end = tmp;
                break;
            }
            default:
                return end;
        }
    }

    return end;
}

function loadRoomGFXDataVertices(header: RoomGFXDataHeader, view: DataView): Vertex[] {
    const ret: Vertex[] = [];
    const count = (header.colorsPtr - header.verticesPtr) / vertexStructSize;

    for (let i = 0; i < count; i++) {
        const offset = header.verticesPtr + (i * vertexStructSize);
        ret.push(loadVertexFromView(view, offset));
    }

    return ret;
}

function loadRooms(
    seg: ArrayBufferSlice,
    bgRooms: BGRoomEntry[],
    baseOffset: number,
    decompress: Inflater,
): Room[] {
    const ret: Room[] = [];

    bgRooms.forEach((bgRoom, i) => {
        // Like with files, first and last entry are not real rooms.
        if (i === 0 || i == bgRooms.length - 1) {
            return;
        }

        const offset = bgRoom.roomOffset - baseOffset;
        const len = (bgRooms[i+1].roomOffset - bgRoom.roomOffset + 0xF) & ~0xF;

        const gfx = decompress(seg.subarray(offset, len));
        const gfxView = gfx.createDataView();
        const gfxDataHeader = readRoomGFXDataHeader(gfxView, bgRoom.roomOffset);
        const vertices = loadRoomGFXDataVertices(gfxDataHeader, gfxView);
        const bbox = new AABB();
        bbox.setFromPoints(vertices.map(v => toReadonlyVec3(v)));

        const room = new Room({
            number: i,
            vertices: vertices,
            bbox: bbox,
            blocks: loadRoomGFXDataBlocks(gfxDataHeader, bgRoom.roomOffset, gfx),
            blockOffsetMap: new Map<number, number>(),
            serializedBlockOffsetMap: [],
            opaqueRoot: undefined,
            translucentRoot: undefined,
            colors: [],
            pos: {
                x: bgRoom.pos[0],
                y: bgRoom.pos[1],
                z: bgRoom.pos[2],
                flags: 0,
                color: 0,
                s: 0,
                t: 0,
            }
        });

        room.blockOffsetMap = new Map<number, number>(room.blocks.map((block, i) => {
            return [block.offset, i];
        }));
        // HACK: Because Map cannot be json-serialized, use an intermediary
        // array to store the map.
        room.serializedBlockOffsetMap = [...room.blockOffsetMap.entries()];

        room.opaqueRoot = room.blockOffsetMap.get(gfxDataHeader.opaqueBlocksPtr);
        room.translucentRoot = room.blockOffsetMap.get(gfxDataHeader.translucentBlocksPtr);
        room.colors = loadRoomGFXDataColors(gfxDataHeader, gfxView, room);

        ret.push(room);
    });

    return ret;
}

function loadBGRoomTable(primary: ArrayBufferSlice): BGRoomEntry[] {
    const view = primary.createDataView();
    const ret: BGRoomEntry[] = [];

    let offset = view.getUint32(4) - magicOffset;
    for(;; offset += bgRoomEntryStructSize) {
        const rawRoomOffset = view.getUint32(offset);
        if (rawRoomOffset === 0 && ret.length > 0) {
            break;
        }

        ret.push({
            roomOffset: rawRoomOffset - magicOffset,
            pos: vec3.fromValues(
                view.getFloat32(offset + 4),
                view.getFloat32(offset + 8),
                view.getFloat32(offset + 12),
            ),
            brightnessMin: view.getUint8(offset + 16),
            brightnessMax: view.getUint8(offset + 17),
        });
    }

    return ret;
}

export class BGSegment {
    public readonly rooms: Room[];

    constructor(seg: ArrayBufferSlice, decompress: Inflater) {
        const view = seg.createDataView();

        const primSize = view.getUint32(0);
        // TODO: section2 // const compSec1Size = view.getUint32(4);
        const compPrimSize = view.getUint32(8);

        const primary = decompress(seg.subarray(12, compPrimSize));
        if (primary.byteLength !== primSize) {
            throw new Error("unexpected decompressed section #1 primary data size");
        }
        const bgRooms = loadBGRoomTable(primary);

        // The roomOffset pointing to each Room compressed data is itself
        // offset by this value. I can't make sense of it, but it works.
        const roomsOffset = primSize - compPrimSize - 0x0C;
        this.rooms = loadRooms(seg, bgRooms, roomsOffset, decompress);
    }

    static fromJSON(buffer: ArrayBufferSlice): BGSegment {
        const ret = JSON.parse(new TextDecoder().decode(buffer.arrayBuffer));

        ret.rooms = ret.rooms.map((props:Partial<Room>) => {
            const room = new Room(props);

            room.blockOffsetMap = new Map<number, number>(
                room.serializedBlockOffsetMap.map(entry => {
                    return [entry[0], entry[1]];
                })
            );
            room.serializedBlockOffsetMap = [];

            return room;
        });

        return ret;
    }
}
