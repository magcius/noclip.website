export interface MPHAreaFog {
    enabled: boolean;
    color: number;
    depthShift: number;
    offset: number;
}

export interface MPHAreaMetadata {
    sourceAddress: number;
    geometrySet?: number;
    name: string;
    modelFilename: string;
    animationFilename: string;
    textureFilename: string;
    collisionFilename: string;
    entityFilename: string;
    nodeFilename: string;
    fog: MPHAreaFog;
    lightColor0: readonly number[];
    lightVector0: readonly number[];
    lightColor1: readonly number[];
    lightVector1: readonly number[];
}

const multiplayerAreaStart = 0x020BA474;

export function sceneIdToModelStem(sceneId: string): string {
    return sceneId.replace(/_mp$/i, '').toLowerCase();
}

export function findAreaMetadata(areaMetadata: readonly MPHAreaMetadata[], modelStem: string, multiplayer: boolean): MPHAreaMetadata | null {
    const isRequestedMode = (entry: MPHAreaMetadata): boolean =>
        (entry.sourceAddress >= multiplayerAreaStart) === multiplayer;
    const routeEntityFilename = modelStem.replace(/_model$/, '_ent.bin');
    const routeArea = areaMetadata.find((entry) =>
        isRequestedMode(entry) && entry.entityFilename === routeEntityFilename);
    if (routeArea !== undefined)
        return routeArea;
    const candidates = areaMetadata.filter((entry) =>
        isRequestedMode(entry) && entry.modelFilename === `${modelStem}.bin`);
    return candidates.length === 1 ? candidates[0] : null;
}
