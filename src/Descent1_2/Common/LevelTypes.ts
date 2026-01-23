import { vec3 } from "gl-matrix";

export const SIDE_VERTICES = [
    [7, 6, 2, 3],
    [0, 4, 7, 3],
    [0, 1, 5, 4],
    [2, 6, 5, 1],
    [4, 5, 6, 7],
    [3, 2, 1, 0],
];

export class DescentSide {
    public connection: DescentSegment | null = null;
    public wallNum: number | null = null;
    public openFace: boolean = false;
    public uvl: vec3[] = [];
    public baseTextureIndex: number = 0;
    public overlayTextureIndex: number = 0;
    public overlayRotation: number = 0;

    constructor(
        public segment: DescentSegment,
        public sideNum: number,
    ) {}

    public get mayBeRendered() {
        return (
            this.wallNum !== null ||
            (!this.openFace && this.connection === null)
        );
    }

    public get vertices() {
        return SIDE_VERTICES[this.sideNum].map(
            (index) => this.segment.vertices[index],
        );
    }
}

export class DescentSegment {
    public sides: DescentSide[] = [];
    public special: number = 0;
    public matcenNum: number = 0;
    public flagsValue: number = 0;
    public light: number = 0;
    public vertices: vec3[] = [];

    constructor(public segmentNum: number) {
        for (let i = 0; i < 6; ++i) this.sides.push(new DescentSide(this, i));
    }
}

export type DescentLevelGameInfo = {
    version: number;
    size: number;
    levelNumber: number;
    playerOffset: number;
    playerSize: number;
    objectsOffset: number;
    objectsCount: number;
    objectsSize: number;
    wallsOffset: number;
    wallsCount: number;
    wallsSize: number;
    doorsOffset: number;
    doorsCount: number;
    doorsSize: number;
    triggersOffset: number;
    triggersCount: number;
    triggersSize: number;
    linksOffset: number;
    linksCount: number;
    linksSize: number;
    reactorTriggersOffset: number;
    reactorTriggersCount: number;
    reactorTriggersSize: number;
    matcenOffset: number;
    matcenCount: number;
    matcenSize: number;
    deltaLightIndicesOffset: number;
    deltaLightIndicesCount: number;
    deltaLightIndicesSize: number;
    deltaLightsOffset: number;
    deltaLightsCount: number;
    deltaLightsSize: number;
    levelName: string;
};

export const WALL_TYPE_NORMAL = 0;
export const WALL_TYPE_BLASTABLE = 1;
export const WALL_TYPE_DOOR = 2;
export const WALL_TYPE_ILLUSION = 3;
export const WALL_TYPE_OPEN = 4;
export const WALL_TYPE_CLOSED = 5;
export const WALL_TYPE_OVERLAY = 6;
export const WALL_TYPE_CLOAKED = 7;

export class DescentWall {
    constructor(
        public hitPoints: number,
        public linkedWall: number,
        public type: number,
        public flags: number,
        public state: number,
        public trigger: number,
        public doorClip: number,
        public keys: number,
        public cloakOpacity: number,
    ) {}
}
