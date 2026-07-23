import { readFileSync } from 'fs';
import { gunzipSync, inflateRawSync } from 'zlib';

const pointerTableOffset = 0x101C50;
const mapTableOffset = 0x15232C;
const propGeometryTableOffset = 0x82A06C;
const setupTableOffset = 0xD0E86C;
const scriptTableOffset = 0xD3B56C;
const spawnerTableOffset = 0x1170D44;
const critterTableOffset = 0x1188BDC;
const globalASMCodeROMOffset = 0x113F0;
const globalASMDataROMOffset = 0xC29D4;
const globalASMDataCompressedSize = 0x949C;
const spritePointerTableOffset = 0x15A090;
const spritePointerCount = 176;
const globalASMVirtualBase = 0x805FB300;
const customScriptFunctionTableOffset = 0x14CB70;
const environmentParticleTableOffset = 0x14D8A0;
const environmentParticleCount = 13;

function parseNumber(s: string): number {
    if (s.startsWith('0x'))
        return Number.parseInt(s.slice(2), 16);
    return Number.parseInt(s, 16);
}

function hex(n: number, width = 0): string {
    return `0x${n.toString(16).padStart(width, '0')}`;
}

function getPointerTableData(rom: Buffer, tableOffset: number, fileID: number, name: string): Buffer {
    const pointer = rom.readUInt32BE(tableOffset + fileID * 4);
    const romOffset = (pointer & 0x7FFFFFFF) + pointerTableOffset;
    if ((pointer & 0x80000000) !== 0) {
        const targetMapID = rom.readUInt16BE(romOffset);
        console.log(`${name} ${hex(fileID, 2)} redirects to ${hex(targetMapID, 2)}`);
        return getPointerTableData(rom, tableOffset, targetMapID, name);
    }

    if (rom.readUInt32BE(romOffset) !== 0x1F8B0800)
        throw new Error(`${name} ${hex(fileID, 2)} does not point to a DK64 gzip stream`);
    return inflateRawSync(rom.subarray(romOffset + 0x0A));
}

function getMapData(rom: Buffer, mapID: number): Buffer {
    return getPointerTableData(rom, mapTableOffset, mapID, 'Map');
}

const opcodeNames = new Map<number, string>([
    [0x00, 'SNOOP'],
    [0x01, 'VTX'],
    [0x02, 'MODIFYVTX'],
    [0x05, 'TRI1'],
    [0x06, 'TRI2'],
    [0xD7, 'TEXTURE'],
    [0xD9, 'GEOMETRYMODE'],
    [0xDE, 'DL'],
    [0xDF, 'ENDDL'],
    [0xE2, 'SETOTHERMODE_L'],
    [0xE3, 'SETOTHERMODE_H'],
    [0xE6, 'RDPLOADSYNC'],
    [0xE7, 'RDPPIPESYNC'],
    [0xE8, 'RDPTILESYNC'],
    [0xF0, 'LOADTLUT'],
    [0xF2, 'SETTILESIZE'],
    [0xF3, 'LOADBLOCK'],
    [0xF5, 'SETTILE'],
    [0xFA, 'SETPRIMCOLOR'],
    [0xFB, 'SETENVCOLOR'],
    [0xFC, 'SETCOMBINE'],
    [0xFD, 'SETTIMG'],
]);

function disassembleDisplayList(map: Buffer, dlStart: number, relativeOffset: number, vertexStart = map.readUInt32BE(0x38), vertexSegment = 0x06): void {
    console.log(`\nDisplay list ${hex(relativeOffset)}:`);
    for (let offs = dlStart + relativeOffset; offs + 8 <= map.length; offs += 8) {
        const w0 = map.readUInt32BE(offs);
        const w1 = map.readUInt32BE(offs + 4);
        const opcode = w0 >>> 24;
        const name = opcodeNames.get(opcode) ?? `OP_${opcode.toString(16).padStart(2, '0')}`;
        let annotation = '';
        if (opcode === 0x00)
            annotation = ` section=${hex(w1)}`;
        else if (opcode === 0x01 && (w1 >>> 24) === vertexSegment) {
            const count = (w0 >>> 12) & 0xFF;
            const vertexOffset = vertexStart + (w1 & 0x00FFFFFF);
            const positions: string[] = [];
            for (let i = 0; i < count; i++) {
                const vertex = vertexOffset + i * 0x10;
                positions.push(
                    `(${map.readInt16BE(vertex)},${map.readInt16BE(vertex + 2)},${map.readInt16BE(vertex + 4)}`
                    + `;uv=${map.readInt16BE(vertex + 8)},${map.readInt16BE(vertex + 0x0A)}`
                    + `;rgba=${map.readUInt8(vertex + 0x0C)},${map.readUInt8(vertex + 0x0D)},${map.readUInt8(vertex + 0x0E)},${map.readUInt8(vertex + 0x0F)})`,
                );
            }
            annotation = ` vertices=${positions.join(',')}`;
        }
        else if (opcode === 0xFD)
            annotation = ` segment=${hex(w1 >>> 24, 2)} address=${hex(w1 & 0x00FFFFFF, 6)}`;
        else if (opcode === 0xDE)
            annotation = ` target=${hex(w1)}`;
        console.log(`${hex(offs - dlStart, 6)}  ${name.padEnd(16)} ${hex(w0, 8)} ${hex(w1, 8)}${annotation}`);
        if (opcode === 0xDF)
            return;
    }
}

function inspectPropGeometry(prop: Buffer, propType: number, disassemble: boolean): void {
    const name = prop.subarray(0x0C, 0x20).toString('ascii').split('\0')[0];
    const mainDisplayListStart = prop.readUInt32BE(0x40);
    const secondaryDisplayListStart = prop.readUInt32BE(0x44);
    const vertexStart = prop.readUInt32BE(0x48);
    console.log(`\nProp geometry ${hex(propType, 4)}, decompressed size ${hex(prop.length)}`);
    console.log(`name                     ${JSON.stringify(name)}`);
    for (let offs = 0; offs < 0x78; offs += 4)
        console.log(`header[${hex(offs, 2)}]               ${hex(prop.readUInt32BE(offs), 8)}`);
    const decalTexture = prop.readUInt16BE(0x28);
    if (decalTexture !== 0xFFFF) {
        console.log('prop decal:');
        console.log(`  texture                ${hex(decalTexture)}`);
        console.log(`  rotationStep           ${prop.readInt16BE(0x2C)}`);
        console.log(`  footprint              ${prop.readInt16BE(0x2E)} x ${prop.readInt16BE(0x30)}`);
        console.log(`  textureSize            ${prop.readUInt8(0x32)} x ${prop.readUInt8(0x33)}`);
        console.log(`  format/size            ${prop.readUInt8(0x34) & 0x07}/${prop.readUInt8(0x35)}`);
        console.log(`  fade                   ${prop.readUInt8(0x36) * 10} .. ${prop.readUInt8(0x37) * 10}`);
        console.log(`  alpha/flags            ${hex(prop.readUInt8(0x38), 2)}/${hex(prop.readUInt8(0x39), 2)}`);
    }
    const textureDescriptorStart = prop.readUInt32BE(0x6C);
    if (textureDescriptorStart + 4 <= prop.length) {
        const textureDescriptorCount = prop.readUInt32BE(textureDescriptorStart);
        console.log(`indexed texture descriptors (${textureDescriptorCount}):`);
        for (let i = 0; i < textureDescriptorCount; i++) {
            const offs = textureDescriptorStart + 4 + i * 0x84;
            if (offs + 0x84 > prop.length) {
                console.log(`  ${i}: truncated @${hex(offs)}`);
                break;
            }
            const target = prop.readUInt32BE(offs);
            const crossfade = prop.readUInt32BE(offs + 4);
            const duration = prop.readUInt32BE(offs + 8);
            const frameCount = prop.readUInt32BE(offs + 0x0C);
            const frames = [target];
            for (let frame = 1; frame < frameCount && frame < 0x1E; frame++)
                frames.push(prop.readUInt32BE(offs + 0x0C + frame * 4));
            console.log(`  ${i}: target=${hex(target)} crossfade=${crossfade} duration=${duration} frames=[${frames.map((frame) => hex(frame)).join(', ')}]`);
        }
    }
    console.log(`mainDisplayListStart     ${hex(mainDisplayListStart)}`);
    console.log(`secondaryDisplayListStart ${hex(secondaryDisplayListStart)}`);
    console.log(`vertexStart              ${hex(vertexStart)}`);
    if (!disassemble)
        return;
    console.log('Main wrapper (segment 0x0A):');
    disassembleDisplayList(prop, mainDisplayListStart, 0, vertexStart, 0x08);
    let half1 = -1;
    for (let offs = mainDisplayListStart; offs < Math.min(prop.length, mainDisplayListStart + 0x80); offs += 8) {
        const opcode = prop.readUInt8(offs);
        if (opcode === 0xE1)
            half1 = prop.readUInt32BE(offs + 4);
        else if (opcode === 0x04 && (half1 >>> 24) === 0x0A) {
            console.log('High-detail branch target:');
            disassembleDisplayList(prop, mainDisplayListStart, half1 & 0x00FFFFFF, vertexStart, 0x08);
            break;
        }
    }
    console.log('Secondary display list:');
    disassembleDisplayList(prop, secondaryDisplayListStart, 0, vertexStart, 0x08);
}

function inspectMap(map: Buffer, mapID: number): void {
    const headerFields = [
        ['treeStart', 0x30],
        ['dlStart', 0x34],
        ['vertStart', 0x38],
        ['vertEnd', 0x40],
        ['animatedTextureStart', 0x48],
        ['sectionStart', 0x58],
        ['sectionEnd', 0x5C],
        ['chunkCountOffset', 0x64],
        ['chunkStart', 0x68],
        ['chunkEnd', 0x6C],
        ['dlExpansionStart', 0x70],
    ] as const;

    console.log(`Map ${hex(mapID, 2)}, decompressed size ${hex(map.length)}`);
    console.log(`mapFlags                 ${hex(map.readUInt8(0x08), 2)} (fog=${(map.readUInt8(0x08) & 1) !== 0})`);
    for (const [name, offs] of headerFields)
        console.log(`${name.padEnd(24)} ${hex(map.readUInt32BE(offs))}`);

    const treeStart = map.readUInt32BE(0x30);
    console.log(`rootNodeType             ${map.readUInt8(treeStart + 0xB8)}`);
    console.log(`rootExtraListCount       ${map.readUInt8(treeStart + 0xC5)}`);

    const animatedTextureStart = map.readUInt32BE(0x48);
    const animatedTextureCount = map.readUInt32BE(animatedTextureStart);
    console.log(`\nAnimated textures (${animatedTextureCount}):`);
    for (let i = 0; i < animatedTextureCount; i++) {
        const offs = animatedTextureStart + 4 + i * 0x7C;
        const frameCount = map.readUInt8(offs + 3);
        const frames: string[] = [];
        for (let j = 0; j < frameCount; j++)
            frames.push(hex(map.readUInt32BE(offs + 0x0C + j * 4)));
        console.log(`${i}: segment=${hex(map.readUInt8(offs), 2)} group=${map.readUInt8(offs + 1)} delay=${map.readUInt8(offs + 2)} frames=[${frames.join(', ')}]`);
    }

    const sectionStart = map.readUInt32BE(0x58);
    const sectionEnd = map.readUInt32BE(0x5C);
    const sections = new Map<number, number>();
    for (let offs = sectionStart + 4; offs < sectionEnd; offs += 0x1C)
        sections.set(map.readUInt16BE(offs + 2), map.readUInt16BE(offs));

    const chunkCount = map.readUInt32BE(map.readUInt32BE(0x64));
    const chunkStart = map.readUInt32BE(0x68);
    const dlStart = map.readUInt32BE(0x34);
    console.log(`\nChunks (${chunkCount}):`);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunkOffs = chunkStart + chunkIndex * 0x34;
        const vertOffset = map.readInt32BE(chunkOffs + 0x2C);
        console.log(`chunk ${chunkIndex}: vertOffset=${hex(vertOffset)}`);
        for (let slot = 0; slot < 4; slot++) {
            const relativeOffset = map.readInt32BE(chunkOffs + 0x0C + slot * 8);
            const size = map.readUInt32BE(chunkOffs + 0x10 + slot * 8);
            if (relativeOffset < 0 || size === 0)
                continue;
            const snoops: string[] = [];
            for (let offs = dlStart + relativeOffset; offs < dlStart + relativeOffset + size; offs += 8) {
                if (map.readUInt8(offs) === 0x00) {
                    const sectionID = map.readUInt32BE(offs + 4);
                    snoops.push(`${hex(sectionID)}(group ${sections.get(sectionID) ?? '?'})@${hex(offs - dlStart)}`);
                }
            }
            console.log(`  slot ${slot}: dl=${hex(relativeOffset)} size=${hex(size)} snoops=[${snoops.join(', ')}]`);
        }
    }

    const expansionStart = map.readUInt32BE(0x70);
    console.log(`\nDisplay-list expansions: ${map.readUInt32BE(expansionStart)}`);
}

function inspectEffectPoints(map: Buffer, mapID: number): void {
    const table = map.readUInt32BE(0x40);
    const setCount = map.readInt32BE(table) + 1;
    console.log(`\nEffect point sets ${hex(mapID, 2)} (${setCount}):`);
    for (let set = 0; set < setCount; set++) {
        const start = table + map.readUInt32BE(table + 4 + set * 4);
        const end = table + map.readUInt32BE(table + 8 + set * 4);
        const count = (end - start) / 12;
        const first = count > 0
            ? ` first=(${map.readFloatBE(start).toFixed(1)},${map.readFloatBE(start + 4).toFixed(1)},${map.readFloatBE(start + 8).toFixed(1)})`
            : '';
        console.log(`  set=${set} start=${hex(start)} end=${hex(end)} points=${count}${first}`);
    }
}

function inspectSetup(setup: Buffer, mapID: number): void {
    const propCount = setup.readUInt32BE(0);
    let offs = 4;
    console.log(`\nSetup ${hex(mapID, 2)}, decompressed size ${hex(setup.length)}`);
    console.log(`Props (${propCount}):`);
    for (let i = 0; i < propCount; i++, offs += 0x30) {
        console.log(
            `${i.toString().padStart(3)} @${hex(offs, 4)} `
            + `type=${hex(setup.readUInt16BE(offs + 0x28), 4)} id=${hex(setup.readUInt16BE(offs + 0x2A), 4)} `
            + `pos=(${setup.readFloatBE(offs).toFixed(1)}, ${setup.readFloatBE(offs + 4).toFixed(1)}, ${setup.readFloatBE(offs + 8).toFixed(1)}) `
            + `scale=${setup.readFloatBE(offs + 0x0C).toFixed(3)} `
            + `rot=(${setup.readFloatBE(offs + 0x18).toFixed(1)},${setup.readFloatBE(offs + 0x1C).toFixed(1)},${setup.readFloatBE(offs + 0x20).toFixed(1)})`,
        );
    }

    const mysteryCount = setup.readUInt32BE(offs);
    offs += 4;
    console.log(`Mystery entries (${mysteryCount}):`);
    for (let i = 0; i < mysteryCount; i++, offs += 0x24) {
        const words: string[] = [];
        for (let j = 0; j < 9; j++)
            words.push(hex(setup.readUInt32BE(offs + j * 4), 8));
        console.log(`${i.toString().padStart(3)} @${hex(offs, 4)} ${words.join(' ')}`);
    }

    const actorCount = setup.readUInt32BE(offs);
    offs += 4;
    console.log(`Actors (${actorCount}):`);
    for (let i = 0; i < actorCount; i++, offs += 0x38) {
        console.log(
            `${i.toString().padStart(3)} @${hex(offs, 4)} `
            + `type=${hex(setup.readUInt16BE(offs + 0x32), 4)} id=${hex(setup.readUInt16BE(offs + 0x34), 4)} `
            + `pos=(${setup.readFloatBE(offs).toFixed(1)}, ${setup.readFloatBE(offs + 4).toFixed(1)}, ${setup.readFloatBE(offs + 8).toFixed(1)}) `
            + `scale=${setup.readFloatBE(offs + 0x0C).toFixed(3)} rotY=${setup.readInt16BE(offs + 0x30)}`,
        );
    }
}

function inspectScripts(scripts: Buffer, mapID: number): void {
    console.log(`\nScripts ${hex(mapID, 2)}, decompressed size ${hex(scripts.length)}`);
    const scriptCount = scripts.readUInt16BE(0);
    let offs = 2;
    console.log(`Script entries (${scriptCount}):`);
    for (let scriptIndex = 0; scriptIndex < scriptCount; scriptIndex++) {
        const id = scripts.readUInt16BE(offs);
        const blockCount = scripts.readUInt16BE(offs + 2);
        const behavior = scripts.readUInt16BE(offs + 4);
        console.log(`${scriptIndex}: id=${hex(id, 4)} blocks=${blockCount} behavior=${hex(behavior, 4)} @${hex(offs, 4)}`);
        offs += 6;
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
            const conditionCount = scripts.readUInt16BE(offs);
            offs += 2;
            const conditions: string[] = [];
            for (let i = 0; i < conditionCount; i++, offs += 8) {
                conditions.push(
                    `${hex(scripts.readUInt16BE(offs), 4)}(`
                    + `${scripts.readInt16BE(offs + 2)},${scripts.readInt16BE(offs + 4)},${scripts.readInt16BE(offs + 6)})`,
                );
            }
            const executionCount = scripts.readUInt16BE(offs);
            offs += 2;
            const executions: string[] = [];
            for (let i = 0; i < executionCount; i++, offs += 8) {
                executions.push(
                    `${hex(scripts.readUInt16BE(offs), 4)}(`
                    + `${scripts.readInt16BE(offs + 2)},${scripts.readInt16BE(offs + 4)},${scripts.readInt16BE(offs + 6)})`,
                );
            }
            console.log(`  block ${blockIndex}: if [${conditions.join(', ')}] exec [${executions.join(', ')}]`);
        }
    }
    console.log(`Parsed through ${hex(offs)} of ${hex(scripts.length)}`);
}

function inspectEffectCalls(rom: Buffer, setup: Buffer, scripts: Buffer, mapID: number): void {
    const code = gunzipSync(rom.subarray(globalASMCodeROMOffset, globalASMDataROMOffset));
    const data = gunzipSync(rom.subarray(globalASMDataROMOffset, globalASMDataROMOffset + globalASMDataCompressedSize));
    const globalASM = Buffer.concat([code, data]);
    const propCount = setup.readUInt32BE(0);
    const props = new Map<number, { type: number, x: number, y: number, z: number }>();
    for (let i = 0; i < propCount; i++) {
        const offs = 4 + i * 0x30;
        props.set(setup.readUInt16BE(offs + 0x2A), {
            type: setup.readUInt16BE(offs + 0x28),
            x: setup.readFloatBE(offs),
            y: setup.readFloatBE(offs + 4),
            z: setup.readFloatBE(offs + 8),
        });
    }

    console.log(`\nCustom effect calls ${hex(mapID, 2)}:`);
    const scriptCount = scripts.readUInt16BE(0);
    let offs = 2;
    for (let scriptIndex = 0; scriptIndex < scriptCount; scriptIndex++) {
        const id = scripts.readUInt16BE(offs);
        const blockCount = scripts.readUInt16BE(offs + 2);
        offs += 6;
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
            const conditionCount = scripts.readUInt16BE(offs);
            offs += 2;
            const conditions: string[] = [];
            for (let i = 0; i < conditionCount; i++, offs += 8) {
                conditions.push(
                    `${hex(scripts.readUInt16BE(offs), 4)}(`
                    + `${scripts.readInt16BE(offs + 2)},${scripts.readInt16BE(offs + 4)},${scripts.readInt16BE(offs + 6)})`,
                );
            }
            const executionCount = scripts.readUInt16BE(offs);
            offs += 2;
            for (let i = 0; i < executionCount; i++, offs += 8) {
                if (scripts.readUInt16BE(offs) !== 7)
                    continue;
                const functionIndex = scripts.readInt16BE(offs + 2);
                const functionAddress = globalASM.readUInt32BE(customScriptFunctionTableOffset + functionIndex * 4);
                const prop = props.get(id);
                console.log(
                    `  script=${hex(id, 4)} block=${blockIndex} function=${functionIndex} address=${hex(functionAddress, 8)} `
                    + `args=(${scripts.readInt16BE(offs + 4)},${scripts.readInt16BE(offs + 6)}) `
                    + `conditions=[${conditions.join(', ')}] `
                    + (prop !== undefined
                        ? `propType=${hex(prop.type, 4)} pos=(${prop.x.toFixed(1)},${prop.y.toFixed(1)},${prop.z.toFixed(1)})`
                        : 'prop=missing'),
                );
            }
        }
    }
}

function inspectEnvironmentParticles(rom: Buffer, mapID: number): void {
    const code = gunzipSync(rom.subarray(globalASMCodeROMOffset, globalASMDataROMOffset));
    const data = gunzipSync(rom.subarray(globalASMDataROMOffset, globalASMDataROMOffset + globalASMDataCompressedSize));
    const globalASM = Buffer.concat([code, data]);
    console.log(`\nEnvironmental particle definitions ${hex(mapID, 2)}:`);
    let matches = 0;
    for (let i = 0; i < environmentParticleCount; i++) {
        const offs = environmentParticleTableOffset + i * 0x20;
        if (globalASM.readUInt8(offs) !== mapID)
            continue;
        matches++;
        console.log(
            `  entry=${i} start=(${globalASM.readInt16BE(offs + 2)},${globalASM.readInt16BE(offs + 4)},${globalASM.readInt16BE(offs + 6)})`
            + ` end=(${globalASM.readInt16BE(offs + 8)},${globalASM.readInt16BE(offs + 10)},${globalASM.readInt16BE(offs + 12)})`
            + ` gap=${globalASM.readFloatBE(offs + 0x10)} distance=${globalASM.readInt16BE(offs + 0x14)}`
            + ` baseScale=${globalASM.readFloatBE(offs + 0x18)} risingScale=${globalASM.readFloatBE(offs + 0x1C)}`,
        );
    }
    if (matches === 0)
        console.log('  none');
}

function inspectSpawners(spawners: Buffer, mapID: number): void {
    console.log(`\nSpawners ${hex(mapID, 2)}, decompressed size ${hex(spawners.length)}`);
    let offs = 0;
    const fenceCount = spawners.readUInt16BE(offs);
    offs += 2;
    console.log(`Fences (${fenceCount}):`);
    for (let fenceIndex = 0; fenceIndex < fenceCount; fenceIndex++) {
        const pointCount = spawners.readUInt16BE(offs);
        offs += 2;
        const points: string[] = [];
        for (let i = 0; i < pointCount; i++, offs += 6)
            points.push(`(${spawners.readInt16BE(offs)},${spawners.readInt16BE(offs + 2)},${spawners.readInt16BE(offs + 4)})`);
        const extraCount = spawners.readUInt16BE(offs);
        offs += 2;
        const extras: string[] = [];
        for (let i = 0; i < extraCount; i++, offs += 0x0A)
            extras.push(spawners.subarray(offs, offs + 0x0A).toString('hex'));
        const flags = spawners.subarray(offs, offs + 2).toString('hex');
        offs += 2;
        console.log(`  ${fenceIndex}: points=[${points.join(', ')}] extras=[${extras.join(', ')}] flags=${flags}`);
    }

    const spawnerCount = spawners.readUInt16BE(offs);
    offs += 2;
    console.log(`Enemy spawners (${spawnerCount}):`);
    for (let i = 0; i < spawnerCount; i++) {
        const start = offs;
        const extraDataCount = spawners.readUInt8(offs + 0x11);
        console.log(
            `  ${i} @${hex(start, 4)} enemy=${hex(spawners.readUInt8(offs), 2)} `
            + `pos=(${spawners.readInt16BE(offs + 4)},${spawners.readInt16BE(offs + 6)},${spawners.readInt16BE(offs + 8)}) `
            + `rotY=${spawners.readUInt16BE(offs + 2)} scale=${spawners.readUInt8(offs + 0x0F)} `
            + `state=${spawners.readUInt8(offs + 0x12)} trigger=${spawners.readUInt8(offs + 0x13)} `
            + `extra=${extraDataCount}`,
        );
        offs += 0x16 + extraDataCount * 2;
    }
    console.log(`Parsed through ${hex(offs)} of ${hex(spawners.length)}`);
}

function inspectCritters(critters: Buffer, mapID: number): void {
    console.log(`\nAmbient critters ${hex(mapID, 2)}, decompressed size ${hex(critters.length)}`);
    let offs = 0;
    const groupCount = critters.readUInt8(offs++);
    console.log(`Groups (${groupCount}):`);
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const type = critters.readUInt8(offs++);
        const regionCount = critters.readUInt8(offs++);
        const critterCount = critters.readUInt8(offs++);
        console.log(`  ${groupIndex}: type=${type} regions=${regionCount} critters=${critterCount}`);
        for (let regionIndex = 0; regionIndex < regionCount; regionIndex++, offs += 0x20) {
            const fields: string[] = [];
            for (let fieldOffset = 6; fieldOffset < 0x20; fieldOffset += 2)
                fields.push(hex(critters.readUInt16BE(offs + fieldOffset), 4));
            console.log(
                `    region ${regionIndex} @${hex(offs, 4)} `
                + `pos=(${critters.readInt16BE(offs)},${critters.readInt16BE(offs + 2)},${critters.readInt16BE(offs + 4)}) `
                + `fields=[${fields.join(', ')}]`,
            );
        }
    }
    console.log(`Parsed through ${hex(offs)} of ${hex(critters.length)}`);
}

function inspectSprites(rom: Buffer, spriteID: number | null): void {
    const code = gunzipSync(rom.subarray(globalASMCodeROMOffset, globalASMDataROMOffset));
    const data = gunzipSync(rom.subarray(globalASMDataROMOffset, globalASMDataROMOffset + globalASMDataCompressedSize));
    const globalASM = Buffer.concat([code, data]);
    console.log('\nGlobal sprite definitions:');
    for (let index = 0; index < spritePointerCount; index++) {
        const address = globalASM.readUInt32BE(spritePointerTableOffset + index * 4);
        const offs = address - globalASMVirtualBase;
        const id = globalASM.readUInt32BE(offs);
        if (spriteID !== null && id !== spriteID)
            continue;
        const imageCount = globalASM.readUInt16BE(offs + 0x12);
        const images: string[] = [];
        for (let i = 0; i < imageCount; i++)
            images.push(hex(globalASM.readUInt16BE(offs + 0x14 + i * 2), 4));
        const params = Array.from(globalASM.subarray(offs + 8, offs + 0x0D), (value) => hex(value, 2));
        console.log(
            `  index=${index} id=${hex(id, 2)} address=${hex(address, 8)} `
            + `grid=${globalASM.readUInt8(offs + 4)}x${globalASM.readUInt8(offs + 5)} `
            + `flags=${hex(globalASM.readUInt8(offs + 6), 2)} codec=${globalASM.readUInt8(offs + 7)} `
            + `params=[${params.join(', ')}] table=${globalASM.readUInt8(offs + 0x0D)} `
            + `dimensions=${globalASM.readUInt16BE(offs + 0x0E)}x${globalASM.readUInt16BE(offs + 0x10)} `
            + `images=[${images.join(', ')}]`,
        );
    }
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: npm run inspect:DonkeyKong64 -- <map-id-hex> [--dl=<relative-offset-hex>] [--prop-geometry=<type-hex>] [--prop-dl] [--setup] [--scripts] [--effects] [--environment-particles] [--effect-points] [--spawners] [--critters] [--sprites[=<id-hex>]] [--rom=<path>]');
        console.error('Example: npm run inspect:DonkeyKong64 -- B0 --dl=9778');
        process.exit(1);
    }

    const mapID = parseNumber(args[0]);
    const romPath = args.find((arg) => arg.startsWith('--rom='))?.slice('--rom='.length) ?? 'data/DonkeyKong64_Raw/rom.z64';
    const dlArg = args.find((arg) => arg.startsWith('--dl='));
    const rom = readFileSync(romPath);
    const map = getMapData(rom, mapID);
    inspectMap(map, mapID);
    if (dlArg !== undefined)
        disassembleDisplayList(map, map.readUInt32BE(0x34), parseNumber(dlArg.slice('--dl='.length)));
    const propGeometryArg = args.find((arg) => arg.startsWith('--prop-geometry='));
    if (propGeometryArg !== undefined) {
        const propType = parseNumber(propGeometryArg.slice('--prop-geometry='.length));
        inspectPropGeometry(getPointerTableData(rom, propGeometryTableOffset, propType, 'Prop geometry'), propType, args.includes('--prop-dl'));
    }
    if (args.includes('--effect-points'))
        inspectEffectPoints(map, mapID);
    if (args.includes('--setup'))
        inspectSetup(getPointerTableData(rom, setupTableOffset, mapID, 'Setup'), mapID);
    if (args.includes('--scripts'))
        inspectScripts(getPointerTableData(rom, scriptTableOffset, mapID, 'Scripts'), mapID);
    if (args.includes('--effects'))
        inspectEffectCalls(
            rom,
            getPointerTableData(rom, setupTableOffset, mapID, 'Setup'),
            getPointerTableData(rom, scriptTableOffset, mapID, 'Scripts'),
            mapID,
        );
    if (args.includes('--environment-particles'))
        inspectEnvironmentParticles(rom, mapID);
    if (args.includes('--spawners'))
        inspectSpawners(getPointerTableData(rom, spawnerTableOffset, mapID, 'Spawners'), mapID);
    if (args.includes('--critters'))
        inspectCritters(getPointerTableData(rom, critterTableOffset, mapID, 'Critters'), mapID);
    const spritesArg = args.find((arg) => arg === '--sprites' || arg.startsWith('--sprites='));
    if (spritesArg !== undefined)
        inspectSprites(rom, spritesArg.includes('=') ? parseNumber(spritesArg.slice(spritesArg.indexOf('=') + 1)) : null);
}

main();
