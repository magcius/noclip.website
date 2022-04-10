import { GenDescription } from './particles/element_generator';
import { InputStream } from './stream';
import { ResourceSystem } from './resource';
import { assert } from '../util';

export interface PART {
    description: GenDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): PART {
    const type = stream.readFourCC();
    assert(type === 'GPSM');
    return { description: new GenDescription(stream, resourceSystem) };
}
