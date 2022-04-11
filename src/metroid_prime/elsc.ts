import { ElectricDescription } from './particles/electric_generator';
import { InputStream } from './stream';
import { ResourceSystem } from './resource';
import { assert } from '../util';

export interface ELSC {
    description: ElectricDescription;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): ELSC {
    const type = stream.readFourCC();
    assert(type === 'ELSM');
    return { description: new ElectricDescription(stream, resourceSystem) };
}
