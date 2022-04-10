import { InputStream } from './stream';
import { ResourceSystem } from './resource';
import { BoolPOINode, Int32POINode, ParticlePOINode, SoundPOINode } from './animation/base_reader';

export class EVNT {
    version: number;
    boolNodes: BoolPOINode[];
    int32Nodes: Int32POINode[];
    particleNodes: ParticlePOINode[];
    soundNodes: SoundPOINode[];

    public GetBoolPOIStream(): BoolPOINode[] {
        return this.boolNodes;
    }

    public GetInt32POIStream(): Int32POINode[] {
        return this.int32Nodes;
    }

    public GetParticlePOIStream(): ParticlePOINode[] {
        return this.particleNodes;
    }

    public GetSoundPOIStream(): SoundPOINode[] {
        return this.soundNodes;
    }

    constructor(input: InputStream, resourceSystem: ResourceSystem) {
        this.version = input.readUint32();

        const boolCount = input.readUint32();
        this.boolNodes = new Array(boolCount);
        for (let i = 0; i < boolCount; ++i) {
            this.boolNodes[i] = BoolPOINode.FromStream(input);
        }

        const int32Count = input.readUint32();
        this.int32Nodes = new Array(int32Count);
        for (let i = 0; i < int32Count; ++i) {
            this.int32Nodes[i] = Int32POINode.FromStream(input);
        }

        const particleCount = input.readUint32();
        this.particleNodes = new Array(particleCount);
        for (let i = 0; i < particleCount; ++i) {
            this.particleNodes[i] = ParticlePOINode.FromStream(input, resourceSystem);
        }

        if (this.version >= 2) {
            const soundCount = input.readUint32();
            this.soundNodes = new Array(soundCount);
            for (let i = 0; i < soundCount; ++i) {
                this.soundNodes[i] = SoundPOINode.FromStream(input, resourceSystem);
            }
        } else {
            this.soundNodes = [];
        }
    }
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): EVNT {
    return new EVNT(stream, resourceSystem);
}
