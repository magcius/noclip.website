import { readFileSync } from 'fs';
import { DK64Extractor } from './extractor.js';

function parseNumber(s: string): number {
    if (s.startsWith('0x'))
        return Number.parseInt(s.slice(2), 16);
    return Number.parseInt(s, 16);
}

function hex(n: number, width = 0): string {
    return `0x${n.toString(16).padStart(width, '0')}`;
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

function inspectPropGeometry(extractor: DK64Extractor, prop: Buffer, propType: number, disassemble: boolean): void {
    const parsed = extractor.parsePropGeometry(prop);
    const { mainDisplayListStart, secondaryDisplayListStart, vertexStart } = parsed;
    console.log(`\nProp geometry ${hex(propType, 4)}, decompressed size ${hex(prop.length)}`);
    console.log(`name                     ${JSON.stringify(parsed.name)}`);
    for (let offs = 0; offs < 0x78; offs += 4)
        console.log(`header[${hex(offs, 2)}]               ${hex(prop.readUInt32BE(offs), 8)}`);
    if (parsed.layout === 2) {
        console.log(`runtime quad descriptors (${parsed.runtimeQuads.length}):`);
        for (const [i, quad] of parsed.runtimeQuads.entries()) {
            console.log(`  ${i}: texture=${hex(quad.texture)} palette=${hex(quad.palette)}`
                + ` dimensions=${quad.dimensions.join('x')} format/size=${quad.format}/${quad.size}`);
            console.log(`     x=${quad.x.join(',')} y=${quad.y.join(',')} z=${quad.z.join(',')}`);
            console.log(`     s=${quad.s.join(',')} t=${quad.t.join(',')}`);
        }
    }
    if (parsed.decal !== null) {
        const decal = parsed.decal;
        console.log('prop decal:');
        console.log(`  texture                ${hex(decal.texture)}`);
        console.log(`  rotationStep           ${decal.rotationStep}`);
        console.log(`  footprint              ${decal.footprint.join(' x ')}`);
        console.log(`  textureSize            ${decal.textureSize.join(' x ')}`);
        console.log(`  format/size            ${decal.format}/${decal.size}`);
        console.log(`  fade                   ${decal.fade.join(' .. ')}`);
        console.log(`  alpha/flags            ${hex(decal.alpha, 2)}/${hex(decal.flags, 2)}`);
    }
    console.log(`indexed texture descriptors (${parsed.indexedTextures.length}):`);
    for (const [i, texture] of parsed.indexedTextures.entries())
        console.log(`  ${i}: target=${hex(texture.target)} crossfade=${texture.crossfade} duration=${texture.duration} frames=[${texture.frames.map((frame) => hex(frame)).join(', ')}]`);
    console.log(`mainDisplayListStart     ${hex(mainDisplayListStart)}`);
    console.log(`secondaryDisplayListStart ${hex(secondaryDisplayListStart)}`);
    console.log(`vertexStart              ${hex(vertexStart)}`);
    const { matrixAnimationStart, matrixDataStart } = parsed;
    if (matrixAnimationStart !== matrixDataStart) {
        console.log(`matrixAnimationStart     ${hex(matrixAnimationStart)}`);
        console.log(`matrixDataStart          ${hex(matrixDataStart)}`);
        const matrixBufferSize = prop.readUInt32BE(matrixDataStart);
        const initialMatrixDataSize = prop.readUInt32BE(matrixDataStart + 4);
        console.log(`matrixBuffer             size=${hex(matrixBufferSize)} initial=${hex(initialMatrixDataSize)}`);
        for (let matrix = 0; matrix * 0x40 < initialMatrixDataSize; matrix++) {
            const start = matrixDataStart + 8 + matrix * 0x40;
            const values = Array.from({ length: 16 }, (_, i) => prop.readFloatBE(start + i * 4));
            console.log(`  baseMatrix[${matrix}] ${values.map((value) => Number(value.toFixed(4))).join(',')}`);
        }
        for (let channel = 0; channel < 10; channel++) {
            const channelOffset = matrixAnimationStart + prop.readUInt32BE(matrixAnimationStart + channel * 4);
            console.log(`matrixAnimation[${channel}]       ${hex(channelOffset)}`);
            if (channel < 3 && channelOffset < matrixDataStart) {
                const frameCount = prop.readUInt8(channelOffset);
                const nodeCount = prop.readUInt8(channelOffset + 0x39);
                console.log(`  frames=${frameCount} nodes=${nodeCount} timings=[${Array.from(prop.subarray(channelOffset + 1, channelOffset + 1 + frameCount)).join(',')}]`);
                const recordStride = 8 + frameCount * 0x24;
                for (let node = 0; node < nodeCount; node++) {
                    const record = channelOffset + 0x3C + node * recordStride;
                    console.log(`  node ${node}: matrix=${hex(prop.readUInt32BE(record))} flags=${hex(prop.readUInt32BE(record + 4))}`);
                    for (let frame = 0; frame < frameCount; frame++) {
                        const transform = record + 8 + frame * 0x24;
                        const values = Array.from({ length: 9 }, (_, i) => prop.readFloatBE(transform + i * 4));
                        console.log(`    ${frame}: scale=(${values.slice(0, 3).join(',')}) rot=(${values.slice(3, 6).join(',')}) translate=(${values.slice(6, 9).join(',')})`);
                    }
                }
            }
        }
    }
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

function inspectActorGeometry(extractor: DK64Extractor, actor: Buffer, model: number, disassemble: boolean): void {
    const parsed = extractor.parseActorGeometry(actor);
    console.log(`\nActor geometry ${hex(model, 4)}, decompressed size ${hex(actor.length)}`);
    console.log(`runtimeBase=${hex(parsed.runtimeBase, 8)} bones=${parsed.boneCount} displayLists=${parsed.displayLists.length}`);
    for (let offs = 0; offs < 0x28; offs += 4)
        console.log(`header[${hex(offs, 2)}] ${hex(actor.readUInt32BE(offs), 8)}`);
    for (const [i, displayList] of parsed.displayLists.entries()) {
        console.log(`displayList[${i}] ${hex(displayList.pointer, 8)} local=${hex(displayList.localOffset)}`);
        if (disassemble)
            disassembleDisplayList(actor, displayList.localOffset, 0, 0x28, 0x03);
    }
    console.log(`skeleton=${actor.subarray(parsed.skeletonOffset).toString('hex').match(/.{1,32}/g)?.join(' ')}`);
    for (const entry of parsed.auxiliaryData) {
        console.log(
            `header[${hex(entry.headerOffset, 2)}] data local=${hex(entry.start)}..${hex(entry.end)} `
            + actor.subarray(entry.start, entry.end).toString('hex').match(/.{1,32}/g)?.join(' '),
        );
    }
}

function inspectAnimation(extractor: DK64Extractor, animation: number): void {
    const data = extractor.getAnimation(animation);
    console.log(`\nAnimation ${hex(animation, 4)}, decompressed size ${hex(data.length)}`);
    console.log(data.toString('hex').match(/.{1,32}/g)?.join('\n'));
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
    console.log(`mapGridOrigin            (${map.readInt16BE(0x10)}, ${map.readInt16BE(0x12)})`);
    console.log(`mapGridSize              (${map.readInt16BE(0x14) * 8}, ${map.readInt16BE(0x16) * 8})`);
    console.log(`mapBounds                x=${map.readInt16BE(0x18)}..${map.readInt16BE(0x1C)}`
        + ` z=${map.readInt16BE(0x1A)}..${map.readInt16BE(0x1E)}`);
    console.log(`mapReferencePoint        (${map.readInt16BE(0x20)}, ${map.readInt16BE(0x22)}, ${map.readInt16BE(0x24)})`);
    for (const [name, offs] of headerFields)
        console.log(`${name.padEnd(24)} ${hex(map.readUInt32BE(offs))}`);

    const vertexStart = map.readUInt32BE(0x38);
    const vertexEnd = map.readUInt32BE(0x40);
    const vertexBounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
    for (let offs = vertexStart; offs + 0x10 <= vertexEnd; offs += 0x10) {
        for (let axis = 0; axis < 3; axis++) {
            const value = map.readInt16BE(offs + axis * 2);
            vertexBounds[axis][0] = Math.min(vertexBounds[axis][0], value);
            vertexBounds[axis][1] = Math.max(vertexBounds[axis][1], value);
        }
    }
    console.log(`vertexBounds             (${vertexBounds.map((axis) => axis.join('..')).join(',')})`);

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

    const generatedSurfaceStart = map.readUInt32BE(0x4C);
    const generatedSurfaceCount = map.readUInt32BE(generatedSurfaceStart);
    console.log(`\nGenerated surfaces (${generatedSurfaceCount}):`);
    for (let i = 0; i < generatedSurfaceCount; i++) {
        const offs = generatedSurfaceStart + 4 + i * 0x6C;
        console.log(
            `${i}: material=${map.readUInt8(offs + 0x66)} flags=${hex(map.readUInt8(offs + 0x67), 2)} `
            + `step=${map.readInt16BE(offs + 0x44)} `
            + `bounds=(${map.readInt16BE(offs + 0x46)},${map.readInt16BE(offs + 0x48)})`
            + `..(${map.readInt16BE(offs + 0x4A)},${map.readInt16BE(offs + 0x4C)}) `
            + `baseY=${map.readInt16BE(offs + 0x4E)}`,
        );
    }

    const sectionStart = map.readUInt32BE(0x58);
    const sectionEnd = map.readUInt32BE(0x5C);
    const sections = new Map<number, { group: number, vertexOffsets: number[] }>();
    for (let offs = sectionStart + 4; offs < sectionEnd; offs += 0x1C) {
        sections.set(map.readUInt16BE(offs + 2), {
            group: map.readUInt16BE(offs),
            vertexOffsets: Array.from({ length: 8 }, (_, i) => map.readUInt16BE(offs + 0x08 + i * 2)),
        });
    }

    const chunkCount = map.readUInt32BE(map.readUInt32BE(0x64));
    const chunkStart = map.readUInt32BE(0x68);
    const dlStart = map.readUInt32BE(0x34);
    console.log(`\nChunks (${chunkCount}):`);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunkOffs = chunkStart + chunkIndex * 0x34;
        const vertOffset = map.readInt32BE(chunkOffs + 0x2C);
        const vertSize = map.readUInt32BE(chunkOffs + 0x30);
        const vertexDataStart = map.readUInt32BE(0x38) + vertOffset;
        const bounds = [
            [0x7FFF, -0x8000],
            [0x7FFF, -0x8000],
            [0x7FFF, -0x8000],
        ];
        for (let vertex = vertexDataStart; vertex < vertexDataStart + vertSize; vertex += 0x10) {
            for (let axis = 0; axis < 3; axis++) {
                const value = map.readInt16BE(vertex + axis * 2);
                bounds[axis][0] = Math.min(bounds[axis][0], value);
                bounds[axis][1] = Math.max(bounds[axis][1], value);
            }
        }
        console.log(
            `chunk ${chunkIndex}: vertOffset=${hex(vertOffset)} vertSize=${hex(vertSize)} `
            + `bounds=(${bounds[0].join('..')},${bounds[1].join('..')},${bounds[2].join('..')}) `
            + `ambient=(${map.readUInt8(chunkOffs)},${map.readUInt8(chunkOffs + 1)},${map.readUInt8(chunkOffs + 2)}) `
            + `modulateVertexColors=${map.readUInt32BE(chunkOffs + 0x08) === 1}`,
        );
        for (let slot = 0; slot < 4; slot++) {
            const relativeOffset = map.readInt32BE(chunkOffs + 0x0C + slot * 8);
            const size = map.readUInt32BE(chunkOffs + 0x10 + slot * 8);
            if (relativeOffset < 0 || size === 0)
                continue;
            const snoops: string[] = [];
            for (let offs = dlStart + relativeOffset; offs < dlStart + relativeOffset + size; offs += 8) {
                if (map.readUInt8(offs) === 0x00) {
                    const sectionID = map.readUInt32BE(offs + 4);
                    const section = sections.get(sectionID);
                    const vertexBase = section === undefined ? '?' : hex(vertOffset + section.vertexOffsets[slot] * 0x10);
                    snoops.push(`${hex(sectionID)}(group ${section?.group ?? '?'}, vertices ${vertexBase})@${hex(offs - dlStart)}`);
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

function inspectSetup(extractor: DK64Extractor, setup: Buffer, mapID: number): void {
    const parsed = extractor.parseSetup(setup);
    console.log(`\nSetup ${hex(mapID, 2)}, decompressed size ${hex(setup.length)}`);
    console.log(`Props (${parsed.props.length}):`);
    for (const [i, prop] of parsed.props.entries()) {
        const light = prop.lightAnimation !== 0 ? ` lightAnimation=${hex(prop.lightAnimation, 2)}` : '';
        console.log(
            `${i.toString().padStart(3)} @${hex(prop.offset, 4)} type=${hex(prop.type, 4)} id=${hex(prop.id, 4)} `
            + `pos=(${Array.from(prop.position, (value) => value.toFixed(1)).join(', ')}) scale=${prop.scale.toFixed(3)} `
            + `rot=(${Array.from(prop.rotation, (value) => value.toFixed(1)).join(',')})${light}`,
        );
    }

    console.log(`Mystery entries (${parsed.mystery.length}):`);
    for (const [i, entry] of parsed.mystery.entries())
        console.log(`${i.toString().padStart(3)} @${hex(entry.offset, 4)} ${entry.words.map((word) => hex(word, 8)).join(' ')}`);

    console.log(`Actors (${parsed.actors.length}):`);
    for (const [i, actor] of parsed.actors.entries()) {
        const light = actor.type === 0x0010 || actor.type === 0x002A
            ? ` speed=${setup.readFloatBE(actor.offset + 0x10).toFixed(3)}`
                + ` color=(${setup.readInt32BE(actor.offset + 0x14)},${setup.readInt32BE(actor.offset + 0x18)},${setup.readInt32BE(actor.offset + 0x1C)})`
                + ` cone=(${setup.readFloatBE(actor.offset + 0x20).toFixed(1)},${setup.readFloatBE(actor.offset + 0x24).toFixed(1)})`
            : '';
        console.log(
            `${i.toString().padStart(3)} @${hex(actor.offset, 4)} type=${hex(actor.type, 4)} id=${hex(actor.id, 4)} `
            + `pos=(${Array.from(actor.position, (value) => value.toFixed(1)).join(', ')}) `
            + `scale=${actor.scale.toFixed(3)} rotY=${actor.rotationY}${light}`,
        );
    }
}

function formatCommand(command: { opcode: number; args: number[] }): string {
    return `${hex(command.opcode, 4)}(${command.args.join(',')})`;
}

function inspectScripts(extractor: DK64Extractor, scripts: Buffer, mapID: number): void {
    console.log(`\nScripts ${hex(mapID, 2)}, decompressed size ${hex(scripts.length)}`);
    const parsed = extractor.parseScripts(scripts);
    console.log(`Script entries (${parsed.length}):`);
    for (const [scriptIndex, script] of parsed.entries()) {
        console.log(`${scriptIndex}: id=${hex(script.id, 4)} blocks=${script.blocks.length} behavior=${hex(script.behavior, 4)} @${hex(script.offset, 4)}`);
        for (const [blockIndex, block] of script.blocks.entries())
            console.log(`  block ${blockIndex}: if [${block.conditions.map(formatCommand).join(', ')}] exec [${block.executions.map(formatCommand).join(', ')}]`);
    }
}

function inspectMatrixProps(extractor: DK64Extractor, setup: Buffer, scripts: Buffer, mapID: number): void {
    const scriptExecutions = new Map(extractor.parseScripts(scripts).map((script) => [
        script.id,
        script.blocks.flatMap((block) => block.executions)
            .filter(({ opcode }) => opcode >= 0x11 && opcode <= 0x1A)
            .map(formatCommand),
    ]));
    const geometryCache = new Map<number, { matrixCommands: string[]; animated: boolean }>();
    console.log(`\nMatrix-driven props ${hex(mapID, 2)}:`);
    for (const [i, prop] of extractor.parseSetup(setup).props.entries()) {
        let geometryInfo = geometryCache.get(prop.type);
        if (geometryInfo === undefined) {
            const geometry = extractor.getPropGeometry(prop.type);
            const matrixCommands: string[] = [];
            if (geometry.readUInt8(0x1C) === 1) {
                const start = geometry.readUInt32BE(0x40);
                const end = geometry.readUInt32BE(0x44);
                for (let dlOffs = start; dlOffs + 8 <= Math.min(end, geometry.length); dlOffs += 8) {
                    if (geometry.readUInt8(dlOffs) === 0xDA || geometry.readUInt8(dlOffs) === 0xD8)
                        matrixCommands.push(`${hex(dlOffs, 4)}=${hex(geometry.readUInt32BE(dlOffs), 8)}:${hex(geometry.readUInt32BE(dlOffs + 4), 8)}`);
                }
            }
            geometryInfo = {
                matrixCommands,
                animated: geometry.readUInt32BE(0x64) !== geometry.readUInt32BE(0x68),
            };
            geometryCache.set(prop.type, geometryInfo);
        }
        if (geometryInfo.matrixCommands.length === 0)
            continue;
        console.log(
            `  setup=${i} type=${hex(prop.type, 4)} id=${hex(prop.id, 4)} animated=${geometryInfo.animated} `
            + `matrices=[${geometryInfo.matrixCommands.join(', ')}] `
            + `animationExec=[${(scriptExecutions.get(prop.id) ?? []).join(', ')}]`,
        );
    }
}

function inspectEffectCalls(extractor: DK64Extractor, setup: Buffer, scripts: Buffer, mapID: number): void {
    const props = new Map(extractor.parseSetup(setup).props.map((prop) => [prop.id, prop]));

    console.log(`\nCustom effect calls ${hex(mapID, 2)}:`);
    for (const script of extractor.parseScripts(scripts)) {
        for (const [blockIndex, block] of script.blocks.entries()) {
            for (const execution of block.executions) {
                if (execution.opcode !== 7)
                    continue;
                const [functionIndex, arg0, arg1] = execution.args;
                const functionAddress = extractor.getCustomScriptFunctionAddress(functionIndex);
                const prop = props.get(script.id);
                console.log(
                    `  script=${hex(script.id, 4)} block=${blockIndex} function=${functionIndex} address=${hex(functionAddress, 8)} `
                    + `args=(${arg0},${arg1}) conditions=[${block.conditions.map(formatCommand).join(', ')}] `
                    + (prop !== undefined
                        ? `propType=${hex(prop.type, 4)} pos=(${Array.from(prop.position, (value) => value.toFixed(1)).join(',')})`
                        : 'prop=missing'),
                );
            }
        }
    }
}

function inspectEnvironmentParticles(extractor: DK64Extractor, mapID: number): void {
    console.log(`\nEnvironmental particle definitions ${hex(mapID, 2)}:`);
    const matches = extractor.getEnvironmentParticles()
        .map((particle, index) => ({ particle, index }))
        .filter(({ particle }) => particle.map === mapID);
    for (const { particle, index } of matches) {
        console.log(
            `  entry=${index} start=(${particle.start.join(',')}) end=(${particle.end.join(',')})`
            + ` gap=${particle.gap} distance=${particle.distance}`
            + ` baseScale=${particle.baseScale} risingScale=${particle.risingScale}`,
        );
    }
    if (matches.length === 0)
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

function inspectSprites(extractor: DK64Extractor, spriteID: number | null): void {
    console.log('\nGlobal sprite definitions:');
    for (const [index, sprite] of extractor.getSpriteDefinitions().entries()) {
        if (spriteID !== null && sprite.id !== spriteID)
            continue;
        console.log(
            `  index=${index} id=${hex(sprite.id, 2)} address=${hex(sprite.address, 8)} `
            + `grid=${sprite.imagesPerFrameHorizontal}x${sprite.imagesPerFrameVertical} `
            + `flags=${hex(sprite.flags, 2)} codec=${sprite.codec} `
            + `params=[${sprite.params.map((value) => hex(value, 2)).join(', ')}] table=${sprite.table} `
            + `dimensions=${sprite.width}x${sprite.height} `
            + `images=[${sprite.images.map((image) => hex(image, 4)).join(', ')}]`,
        );
    }
}

function inspectLightAnimations(extractor: DK64Extractor): void {
    console.log('\nDynamic light animations:');
    for (const [animation, keyframes] of extractor.getLightAnimations().entries()) {
        const formatted = keyframes.map((keyframe) =>
            `{intensity=${keyframe.intensity.toFixed(3)} color=(${keyframe.color.join(',')})`
            + ` radius=${keyframe.radius} duration=${keyframe.duration}}`);
        console.log(`  ${hex(animation + 1, 2)}: ${formatted.join(' ')}`);
    }
}

function inspectActorDefinition(extractor: DK64Extractor, actorType: number): void {
    const definition = extractor.getActorDefinitions().find(({ type }) => type === actorType);
    if (definition !== undefined) {
        console.log(
            `\nActor definition ${hex(actorType, 4)}: tableIndex=${definition.tableIndex} `
            + `model=${hex(definition.model, 4)} behavior=${hex(definition.behavior, 8)} `
            + `words=[${definition.words.map((word) => hex(word, 8)).join(', ')}]`,
        );
        return;
    }
    console.log(`\nActor definition ${hex(actorType, 4)} not found`);
}

function auditSceneSetups(extractor: DK64Extractor, mapIDs: number[]): void {
    const actorDefinitions = new Map(extractor.getActorDefinitions()
        .map(({ type, model, name }) => [type, { model, name }] as const));

    const propUsage = new Map<number, { count: number; maps: Set<number>; layout: number; animated: boolean }>();
    const actorUsage = new Map<number, { count: number; maps: Set<number>; model: number; name: string }>();
    for (const mapID of mapIDs) {
        const setup = extractor.getParsedSetup(mapID);
        for (const prop of setup.props) {
            let usage = propUsage.get(prop.type);
            if (usage === undefined) {
                const geometry = extractor.getPropGeometry(prop.type);
                usage = {
                    count: 0,
                    maps: new Set(),
                    layout: geometry.readUInt8(0x1C),
                    animated: geometry.readUInt32BE(0x64) !== geometry.readUInt32BE(0x68),
                };
                propUsage.set(prop.type, usage);
            }
            usage.count++;
            usage.maps.add(mapID);
        }
        for (const actor of setup.actors) {
            let usage = actorUsage.get(actor.type);
            if (usage === undefined) {
                const definition = actorDefinitions.get(actor.type + 0x10);
                usage = { count: 0, maps: new Set(), model: definition?.model ?? 0, name: definition?.name ?? '' };
                actorUsage.set(actor.type, usage);
            }
            usage.count++;
            usage.maps.add(mapID);
        }
    }

    console.log(`Audited ${mapIDs.length} map setups`);
    console.log(`\nProp types (${propUsage.size}):`);
    for (const [type, usage] of [...propUsage].sort((a, b) => a[0] - b[0]))
        console.log(`  ${hex(type, 4)} count=${usage.count} maps=${usage.maps.size} layout=${usage.layout} animated=${usage.animated}`);
    console.log(`\nActor setup types (${actorUsage.size}):`);
    for (const [type, usage] of [...actorUsage].sort((a, b) => a[0] - b[0]))
        console.log(`  setup=${hex(type, 4)} actor=${hex(type + 0x10, 4)} model=${hex(usage.model, 4)} count=${usage.count} maps=${usage.maps.size} name=${JSON.stringify(usage.name)}`);
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: npm run inspect:DonkeyKong64 -- <map-id-hex> [--audit-scenes=<map-ids>] [--dl=<relative-offset-hex>] [--vertex-base=<relative-offset-hex>] [--prop-geometry=<type-hex>] [--prop-dl] [--matrix-props] [--actor-model=<model-hex>] [--actor-dl] [--animation=<id-hex>] [--texture=<id-hex>] [--setup] [--scripts] [--effects] [--environment-particles] [--light-animations] [--actor-definition=<type-hex>] [--effect-points] [--spawners] [--critters] [--sprites[=<id-hex>]] [--rom=<path>]');
        console.error('Example: npm run inspect:DonkeyKong64 -- B0 --dl=9778');
        process.exit(1);
    }

    const mapID = parseNumber(args[0]);
    const romPath = args.find((arg) => arg.startsWith('--rom='))?.slice('--rom='.length) ?? 'data/DonkeyKong64_Raw/rom.z64';
    const dlArg = args.find((arg) => arg.startsWith('--dl='));
    const vertexBaseArg = args.find((arg) => arg.startsWith('--vertex-base='));
    const extractor = new DK64Extractor(readFileSync(romPath));
    const auditScenesArg = args.find((arg) => arg.startsWith('--audit-scenes='));
    if (auditScenesArg !== undefined) {
        auditSceneSetups(extractor, auditScenesArg.slice('--audit-scenes='.length).split(',').map(parseNumber));
        return;
    }
    const map = extractor.getMap(mapID);
    inspectMap(map, mapID);
    if (dlArg !== undefined) {
        const vertexStart = map.readUInt32BE(0x38)
            + (vertexBaseArg !== undefined ? parseNumber(vertexBaseArg.slice('--vertex-base='.length)) : 0);
        disassembleDisplayList(map, map.readUInt32BE(0x34), parseNumber(dlArg.slice('--dl='.length)), vertexStart);
    }
    const propGeometryArg = args.find((arg) => arg.startsWith('--prop-geometry='));
    if (propGeometryArg !== undefined) {
        const propType = parseNumber(propGeometryArg.slice('--prop-geometry='.length));
        inspectPropGeometry(extractor, extractor.getPropGeometry(propType), propType, args.includes('--prop-dl'));
    }
    const textureArg = args.find((arg) => arg.startsWith('--texture='));
    if (textureArg !== undefined) {
        const textureID = parseNumber(textureArg.slice('--texture='.length));
        const texture = extractor.getGeometryTexture(textureID);
        console.log(`\nTexture ${hex(textureID)}, decompressed size ${hex(texture.length)}`);
        console.log(`first 32 bytes: ${texture.subarray(0, 0x20).toString('hex').match(/../g)?.join(' ')}`);
        console.log(`last 32 bytes:  ${texture.subarray(Math.max(0, texture.length - 0x20)).toString('hex').match(/../g)?.join(' ')}`);
    }
    if (args.includes('--effect-points'))
        inspectEffectPoints(map, mapID);
    if (args.includes('--setup'))
        inspectSetup(extractor, extractor.getSetup(mapID), mapID);
    if (args.includes('--scripts'))
        inspectScripts(extractor, extractor.getScripts(mapID), mapID);
    if (args.includes('--matrix-props'))
        inspectMatrixProps(
            extractor,
            extractor.getSetup(mapID),
            extractor.getScripts(mapID),
            mapID,
        );
    if (args.includes('--effects'))
        inspectEffectCalls(
            extractor,
            extractor.getSetup(mapID),
            extractor.getScripts(mapID),
            mapID,
        );
    if (args.includes('--environment-particles'))
        inspectEnvironmentParticles(extractor, mapID);
    if (args.includes('--light-animations'))
        inspectLightAnimations(extractor);
    const actorDefinitionArg = args.find((arg) => arg.startsWith('--actor-definition='));
    if (actorDefinitionArg !== undefined)
        inspectActorDefinition(extractor, parseNumber(actorDefinitionArg.slice('--actor-definition='.length)));
    const actorModelArg = args.find((arg) => arg.startsWith('--actor-model='));
    if (actorModelArg !== undefined) {
        const actorModel = parseNumber(actorModelArg.slice('--actor-model='.length));
        inspectActorGeometry(
            extractor,
            extractor.getActorGeometry(actorModel),
            actorModel,
            args.includes('--actor-dl'),
        );
    }
    const animationArg = args.find((arg) => arg.startsWith('--animation='));
    if (animationArg !== undefined)
        inspectAnimation(extractor, parseNumber(animationArg.slice('--animation='.length)));
    if (args.includes('--spawners'))
        inspectSpawners(extractor.getSpawners(mapID), mapID);
    if (args.includes('--critters'))
        inspectCritters(extractor.getCritters(mapID), mapID);
    const spritesArg = args.find((arg) => arg === '--sprites' || arg.startsWith('--sprites='));
    if (spritesArg !== undefined)
        inspectSprites(extractor, spritesArg.includes('=') ? parseNumber(spritesArg.slice(spritesArg.indexOf('=') + 1)) : null);
}

main();
