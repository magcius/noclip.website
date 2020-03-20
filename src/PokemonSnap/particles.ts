import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec3, vec4 } from "gl-matrix";
import { getVec3, getColor } from "./room";
import { assert, hexzero, align } from "../util";
import { TexCM } from "../Common/N64/Image";
import { translateTileTexture, TileState, Texture } from "../Common/N64/RDP";

export interface EmitterData {
    particleIndex: number;
    lifetime: number;
    particleLifetime: number;
    flags: number;
    g: number;
    drag: number;
    velocity: vec3;
    radius: number;
    sprayAngle: number;
    increment: number;
    size: number;
    program: Command[];
}

interface WaitCommand {
    kind: "wait";
    wait: number;
    texIndex: number;
}

interface PhysicsCommand {
    kind: "physics";
    flags: number;
    values: vec3;
}

interface MiscCommand {
    kind: "misc";
    subtype: number;
    values?: number[];
    vector?: vec3;
    color?: vec4;
}

interface ColorCommand {
    kind: "color";
    flags: number;
    timer: number;
    color: vec4;
}

interface LoopCommand {
    kind: "loop";
    isEnd: boolean;
    count: number;
}

type Command = WaitCommand | PhysicsCommand | MiscCommand | ColorCommand | LoopCommand;

export interface ParticleSystem {
    emitters: EmitterData[];
    particleTextures: Texture[][];
}

function tileMask(length: number): number {
    switch (length) {
        case 2: return 1;
        case 4: return 2;
        case 8: return 3;
        case 16: return 4;
        case 32: return 5;
        case 64: return 6;
        case 128: return 7;
        case 256: return 8;
    }
    return 0;
}

export function parseParticles(data: ArrayBufferSlice): ParticleSystem {
    const emitters: EmitterData[] = [];
    const view = data.createDataView();

    let particleStart = 0;
    let textureFlags: number[][] = [];

    const emitterCount = view.getInt32(0);
    for (let i = 0; i < emitterCount; i++) {
        let offs = view.getInt32(4 * (i + 1));
        assert(view.getInt16(offs + 0x00) === 0); // this governs the emitter's behavior, but only one type is ever used
        const particleIndex = view.getInt16(offs + 0x02);
        const lifetime = view.getInt16(offs + 0x04);
        const particleLifetime = view.getInt16(offs + 0x06);
        const flags = view.getInt32(offs + 0x08);
        const g = view.getFloat32(offs + 0x0C);
        const drag = view.getFloat32(offs + 0x10);
        const velocity = getVec3(view, offs + 0x14);
        const radius = view.getFloat32(offs + 0x20);
        const sprayAngle = view.getFloat32(offs + 0x24);
        const increment = view.getFloat32(offs + 0x28);
        const size = view.getFloat32(offs + 0x2C);

        const texFlags: number[] = textureFlags[particleIndex] || [];
        let currFlags = flags;

        function setFlags(tex: number): void {
            const old = texFlags[tex];
            if (old !== undefined)
                assert((old & 0x70) === (currFlags & 0x70), 'flag mismatch');
            texFlags[tex] = currFlags;
        }

        const program: Command[] = [];
        offs += 0x30;
        while (true) {
            const command = view.getUint8(offs++);
            if (command < 0x80) {
                let wait = command & 0x1F;
                if (command & 0x20)
                    wait = (wait << 8) + view.getUint8(offs++);
                const texIndex = (command & 0x40) ? view.getUint8(offs++) : -1;
                program.push({
                    kind: "wait",
                    wait,
                    texIndex,
                });
                if (texIndex >= 0)
                    setFlags(texIndex);
            } else if (command < 0xA0) {
                const values = vec3.create();
                const flags = command & 0x1F;
                for (let j = 0; j < 3; j++)
                    if (flags & (1 << j)) {
                        values[j] = view.getFloat32(offs);
                        offs += 4;
                    }
                program.push({
                    kind: "physics",
                    flags,
                    values,
                });
            } else if (command < 0xC0) {
                const subtype = command - 0xA0;
                const misc: MiscCommand = {
                    kind: "misc",
                    subtype,
                };
                const values: number[] = [];
                switch (subtype) {
                    case 0x00:
                    case 0x0C: {
                        let value = view.getUint8(offs++);
                        if (value & 0x80)
                            value = ((value & 0x7F) << 8) + view.getUint8(offs++);
                        values.push(value);
                        values.push(view.getFloat32(offs));
                        offs += 4;
                        if (subtype === 0x0C) {
                            values.push(view.getFloat32(offs));
                            offs += 4;
                        }
                    } break;
                    case 0x01:
                    case 0x07:
                    case 0x17:
                    case 0x18:
                    case 0x1C:
                    case 0x1F:
                        values.push(view.getUint8(offs++)); break;
                    case 0x02:
                    case 0x03:
                    case 0x09:
                    case 0x0B:
                    case 0x1D: {
                        values.push(view.getFloat32(offs));
                        offs += 4;
                        if (subtype === 0x1D) {
                            values.push(view.getFloat32(offs));
                            offs += 4;
                        }
                    } break;
                    // these have two shorts
                    case 0x06:
                    case 0x0A:
                        values.push(view.getUint16(offs));
                        offs += 2;
                    case 0x04:
                    case 0x05:
                    case 0x19: {
                        values.push(view.getUint16(offs));
                        offs += 2;
                    } break;
                    case 0x08:
                    case 0x1E: {
                        misc.vector = getVec3(view, offs);
                        offs += 0xC;
                    } break;
                    case 0x1A:
                    case 0x1B: {
                        misc.color = getColor(view, offs);
                        offs += 0x4;
                    } break;
                }
                if (values.length > 0)
                    misc.values = values;
                program.push(misc);
                // flag tracking updates
                if (subtype === 1)
                    currFlags = values[0];
                else if (subtype === 0x0E)
                    currFlags &= ~0x60;
                else if (subtype === 0x0F) {
                    currFlags |= 0x20;
                    currFlags &= ~0x40;
                } else if (subtype === 0x10) {
                    currFlags |= 0x40;
                    currFlags &= ~0x20;
                } else if (subtype === 0x11)
                    currFlags |= 0x60;
                else if (subtype === 0x1C)
                    for (let tex = values[0]; tex < values[0] + values[1]; tex++)
                        setFlags(tex);
            } else if (command < 0xE0) {
                let timer = view.getUint8(offs++);
                if (timer & 0x80)
                    timer = ((timer & 0x7F) << 8) + view.getUint8(offs++);
                const color = vec4.create();
                for (let j = 0; j < 4; j++)
                    if (command & (1 << j))
                        color[j] = view.getUint8(offs++) / 0xFF;
                program.push({
                    kind: "color",
                    flags: command & 0x1F,
                    timer,
                    color,
                });
            } else {
                assert(command >= 0xFA, `bad command ${hexzero(command, 2)}`);
                if (command > 0xFD)
                    break; // done
                let count = -1;
                if (command === 0xFA)
                    count = view.getUint8(offs++);
                else if (command === 0xFB)
                    count = 0;
                program.push({
                    kind: "loop",
                    isEnd: !!(command & 1),
                    count,
                });
            }
        }
        emitters.push({
            particleIndex,
            lifetime,
            particleLifetime,
            flags,
            g,
            drag,
            velocity,
            radius,
            size,
            sprayAngle,
            increment,
            program,
        });
        particleStart = align(offs, 16);
        textureFlags[particleIndex] = texFlags;
    }

    const tile = new TileState();
    const particleTextures: Texture[][] = [];

    const particleCount = view.getInt32(particleStart);
    for (let i = 0; i < particleCount; i++) {
        let offs = view.getInt32(particleStart + 4 * (i + 1)) + particleStart;
        const count = view.getInt32(offs + 0x00);
        const fmt = view.getInt32(offs + 0x04);
        const siz = view.getInt32(offs + 0x08);
        const width = view.getInt32(offs + 0x0C);
        const height = view.getInt32(offs + 0x10);
        const sharedPalette = view.getInt32(offs + 0x14) !== 0;
        const flagList = textureFlags[i] || [];

        const textures: Texture[] = [];

        tile.fmt = fmt;
        tile.siz = siz;
        tile.lrs = 4 * (width - 1);
        tile.lrt = 4 * (height - 1);
        tile.cms = TexCM.MIRROR;
        tile.cmt = TexCM.MIRROR;
        tile.masks = tileMask(width);
        tile.maskt = tileMask(height);

        offs += 0x18;
        for (let j = 0; j < count; j++) {
            if (flagList[j] === undefined)
                console.warn('unused particle', i, j);
            else {
                if (flagList[j] & 0x20)
                    tile.cms = TexCM.CLAMP;
                else
                    tile.cms = TexCM.MIRROR;
                if (flagList[j] & 0x40)
                    tile.cmt = TexCM.CLAMP;
                else
                    tile.cmt = TexCM.MIRROR;
            }
            let palette = particleStart + view.getInt32(offs + 4 * (sharedPalette ? count : j + count));
            textures.push(translateTileTexture([data], particleStart + view.getInt32(offs + 4 * j), palette, tile));
            textures[textures.length - 1].name = `particle_${i}_${j}`;
        }
        particleTextures.push(textures);
    }

    return { emitters, particleTextures };
}