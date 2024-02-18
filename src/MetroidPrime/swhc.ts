import { SwooshDescription } from './particles/swoosh_generator.js';
import { InputStream } from './stream.js';
import { ResourceSystem } from './resource.js';
import { assert } from '../util.js';

export interface SWHC {
    description: SwooshDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): SWHC {
    const type = stream.readFourCC();
    assert(type === 'SWSH');
    return { description: new SwooshDescription(stream, resourceSystem) };
}
