import { GenDescription } from './particles/element_generator.js';
import { InputStream } from './stream.js';
import { ResourceSystem } from './resource.js';
import { assert } from '../util.js';

export interface PART {
    description: GenDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): PART {
    const type = stream.readFourCC();
    assert(type === 'GPSM');
    return { description: new GenDescription(stream, resourceSystem) };
}
