import { InputStream } from './stream';
import { ParseFunc, Resource, ResourceSystem } from './resource';
import { CMDL } from './cmdl';

export interface Tweaks {
    GetCineGun(): CMDL|null;
}

class TweakPlayerRes {
    constructor(stream: InputStream,
                resourceSystem: ResourceSystem,
                public saveStationIcon = stream.readString(),
                public missileStationIcon = stream.readString(),
                public elevatorIcon = stream.readString(),
                public minesBreakFirstTopIcon = stream.readString(),
                public minesBreakFirstBottomIcon = stream.readString(),
                public minesBreakSecondTopIcon = stream.readString(),
                public minesBreakSecondBottomIcon = stream.readString(),
                public lStickN = stream.readString(),
                public lStickU = stream.readString(),
                public lStickUL = stream.readString(),
                public lStickL = stream.readString(),
                public lStickDL = stream.readString(),
                public lStickD = stream.readString(),
                public lStickDR = stream.readString(),
                public lStickR = stream.readString(),
                public lStickUR = stream.readString(),
                public cStickN = stream.readString(),
                public cStickU = stream.readString(),
                public cStickUL = stream.readString(),
                public cStickL = stream.readString(),
                public cStickDL = stream.readString(),
                public cStickD = stream.readString(),
                public cStickDR = stream.readString(),
                public cStickR = stream.readString(),
                public cStickUR = stream.readString(),
                public lTriggerOut = stream.readString(),
                public lTriggerIn = stream.readString(),
                public rTriggerOut = stream.readString(),
                public rTriggerIn = stream.readString(),
                public startButtonOut = stream.readString(),
                public startButtonIn = stream.readString(),
                public aButtonOut = stream.readString(),
                public aButtonIn = stream.readString(),
                public bButtonOut = stream.readString(),
                public bButtonIn = stream.readString(),
                public xButtonOut = stream.readString(),
                public xButtonIn = stream.readString(),
                public yButtonOut = stream.readString(),
                public yButtonIn = stream.readString(),
                public ballTransitionsANCS = stream.readString(),
                public ballTransitionsPower = stream.readString(),
                public ballTransitionsIce = stream.readString(),
                public ballTransitionsWave = stream.readString(),
                public ballTransitionsPlasma = stream.readString(),
                public ballTransitionsPhazon = stream.readString(),
                public cinePower = resourceSystem.loadAssetByName<CMDL>(stream.readString(), 'CMDL'),
                public cineIce = resourceSystem.loadAssetByName<CMDL>(stream.readString(), 'CMDL'),
                public cineWave = resourceSystem.loadAssetByName<CMDL>(stream.readString(), 'CMDL'),
                public cinePlasma = resourceSystem.loadAssetByName<CMDL>(stream.readString(), 'CMDL'),
                public cinePhazon = resourceSystem.loadAssetByName<CMDL>(stream.readString(), 'CMDL'),
                public cinematicMoveOutofIntoPlayerDistance = stream.readFloat32()) {
    }
}
function parseTweakPlayerRes(stream: InputStream, resourceSystem: ResourceSystem): TweakPlayerRes {
    return new TweakPlayerRes(stream, resourceSystem);
}

class MP1Tweaks implements Tweaks {
    PlayerRes: TweakPlayerRes;
    public GetCineGun(): CMDL | null {
        return this.PlayerRes.cinePower;
    }
}

export function parseMP1Tweaks(resourceSystem: ResourceSystem): MP1Tweaks {
    const ret: { [key: string]: Resource } = new MP1Tweaks();
    function parse(name: string, loaderFunc: ParseFunc<Resource>) {
        const resource = resourceSystem.findResourceByName(name);
        if (!resource)
            return;
        ret[name] = resourceSystem.loadAssetByIDWithFunc(resource.fileID, 'CTWK', loaderFunc);
    }
    parse('PlayerRes', parseTweakPlayerRes);
    return ret as MP1Tweaks;
}

class MP2Tweaks implements Tweaks {
    cinePower: CMDL|null;
    public GetCineGun(): CMDL | null {
        return this.cinePower;
    }
}

// TODO: Actually parse tweaks instead of fetching by the hard-coded gun name
export function parseMP2Tweaks(resourceSystem: ResourceSystem): MP2Tweaks {
    const ret = new MP2Tweaks();
    ret.cinePower = resourceSystem.loadAssetByName<CMDL>('CinematicGunPower', 'CMDL');
    return ret;
}
