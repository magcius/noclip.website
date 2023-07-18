import { ElectricDescription } from './particles/electric_generator.js';
import { InputStream } from './stream.js';
import { ResourceSystem } from './resource.js';
import { assert } from '../util.js';

export interface ELSC {
    description: ElectricDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): ELSC {
    const type = stream.readFourCC();
    assert(type === 'ELSM');
    return { description: new ElectricDescription(stream, resourceSystem) };
}
