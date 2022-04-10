import { SwooshDescription } from './particles/swoosh_generator';
import { InputStream } from './stream';
import { ResourceSystem } from './resource';
import { assert } from '../util';

export interface SWHC {
    description: SwooshDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): SWHC {
    const type = stream.readFourCC();
    assert(type === 'SWSH');
    return { description: new SwooshDescription(stream, resourceSystem) };
}
