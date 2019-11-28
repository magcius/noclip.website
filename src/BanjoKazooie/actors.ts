import { GeometryRenderer, FlipbookRenderer, GeometryData, FlipbookData } from './render';
import { vec3, mat4 } from 'gl-matrix';
import { assertExists } from '../util';

export class ClankerPart extends GeometryRenderer {
    public clankerVectors: vec3[];
}

export class ClankerTooth extends ClankerPart {
    constructor(geometryData: GeometryData, private isRight: boolean) {
        super(geometryData);
    }

    protected movement(): void {
        const vectorIndex = this.isRight ? 9 : 7;
        mat4.fromTranslation(this.modelMatrix, assertExists(this.clankerVectors[vectorIndex]));
    }
}

const enum BoltState {
    InClanker,
    Rising,
    AtPeak,
    Falling,
}

const scratchVec = vec3.create();
export class ClankerBolt extends ClankerPart {
    private boltState = BoltState.InClanker;
    private static peak = vec3.fromValues(2640, 5695, -10);

    protected movement(): void {
        let timer = this.animationController.getTimeInSeconds();
        vec3.copy(scratchVec, assertExists(this.clankerVectors[5]));
        let newState = this.boltState;

        switch (this.boltState) {
            case BoltState.InClanker:
                if (timer >= 2 && Math.hypot(scratchVec[0] - ClankerBolt.peak[0], scratchVec[2] - ClankerBolt.peak[2]) <= 60)
                    newState = BoltState.Rising;
                break;
            case BoltState.Rising:
                if (timer >= 1) newState = BoltState.AtPeak;
                break;
            case BoltState.AtPeak:
                if (timer >= 1) newState = BoltState.Falling;
                break;
            case BoltState.Falling:
                if (timer >= 1) newState = BoltState.InClanker;
                break;
        }
        if (this.boltState !== newState) {
            this.boltState = newState;
            timer = 0;
            this.animationController.setPhaseToCurrent();
        }

        switch (this.boltState) {
            case BoltState.InClanker: break; // already set
            case BoltState.Rising:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.sin(timer * Math.PI / 2));
                break;
            case BoltState.AtPeak:
                vec3.copy(scratchVec, ClankerBolt.peak);
                break;
            case BoltState.Falling:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.cos(timer * Math.PI / 2));
                break;
        }
        mat4.fromTranslation(this.modelMatrix, scratchVec);
    }
}

export function createRenderer(objectID: number, geometryData: GeometryData): GeometryRenderer | FlipbookRenderer {
    switch (objectID) {
        case 0x43: return new ClankerBolt(geometryData);
        case 0x44: return new ClankerTooth(geometryData, false);
        case 0x45: return new ClankerTooth(geometryData, true);
    }
    return new GeometryRenderer(geometryData);
}