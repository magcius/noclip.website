import { vec3 } from "gl-matrix";
import { Destroyable } from "../../SceneBase";

export type RGB = [number, number, number];

/** Represents a Descent palette: 256 RGB colors. */
export class DescentPalette implements Destroyable {
    constructor(
        public name: string,
        public data: RGB[],
    ) {}

    public destroy(_: any) {}
}

/** TMAP (texture metadata). */
export class DescentTmap {
    constructor(
        public id: number,
        public filename: string,
        public flags: number,
        public lighting: number,
        public damage: number,
        public eclipNum: number,
        public destroyedId: number,
        public slideU: number,
        public slideV: number,
    ) {}
}

/** VCLIP (various animated video clips). */
export class DescentVClip {
    constructor(
        public playTime: number,
        public numFrames: number,
        public frameTime: number,
        public flags: number,
        public soundNum: number,
        public bitmapIndex: number[],
        public lightValue: number,
    ) {}
}

/** ECLIP (animated textures, etc.). */
export class DescentEClip {
    constructor(
        public vclip: DescentVClip,
        public timeLeft: number,
        public frameCount: number,
        public changingWallTexture: number,
        public changingObjectTexture: number,
        public flags: number,
        public critClip: number,
        public destBmNum: number,
        public destVclip: number,
        public destEclip: number,
        public destSize: number,
        public soundNum: number,
        public segnum: number,
        public sidenum: number,
    ) {}
}

/** WCLIP (animated wall data, e.g. doors). */
export class DescentWClip {
    constructor(
        public playTime: number,
        public numFrames: number,
        public frames: number[],
        public openSound: number,
        public closeSound: number,
        public flags: number,
        public filename: string,
    ) {}
}

/** Bitmap contains transparent pixels with palette index 255. */
export const BITMAP_FLAG_TRANSPARENT = 1;
/** Bitmap contains 'super-transparent' ('see-through') pixels with
 * palette index 254. Super-transparent pixels differ from transparent
 * pixels in overlay textures for walls; transparent pixels reveal the
 * underlying base texture, while supertransparent pixels make the side
 * truly transparent (e.g. see-through grates). */
export const BITMAP_FLAG_SUPER_TRANSPARENT = 2;
/** Unused flag? */
export const BITMAP_FLAG_NO_LIGHTING = 4;
/** Bitmap data is RLE compressed. */
export const BITMAP_FLAG_RLE = 8;
/** Bitmap data is 'paged out', used internally by the game's own engine
 * to track which textures are loaded in memory. */
export const BITMAP_FLAG_PAGED_OUT = 16;
/** RLE compressed bitmap data has 16-bit sizes for each scanline
 * as opposed to 8-bit. */
export const BITMAP_FLAG_RLE_BIG = 32;

/** Represents a bitmap in a PIG file. */
export class DescentPigBitmap {
    constructor(
        public filename: string,
        public meta: number,
        public width: number,
        public height: number,
        public flags: number,
        public average: number,
        public offset: number,
        public extension: number,
    ) {
        if (meta & 128) this.width += 256;
    }
}

/** Represents a robot joint. */
export class DescentJoint {
    constructor(
        public jointNum: number,
        public angles: vec3,
    ) {}
}

/** Represents a collectible powerup. */
export class DescentPowerUp {
    constructor(
        public vclipNum: number,
        public hitSound: number,
        public size: number,
        public light: number,
    ) {}
}

/** Represents animation state for a robot joint. */
export type DescentJointAnimState = {
    numJoints: number;
    offset: number;
};

export const DIFFICULTY_LEVEL_COUNT = 5;
export const ANIM_STATES_COUNT = 5;

/** Represents a robot (enemy type). */
export class DescentRobot {
    constructor(
        public modelNum: number,
        public gunPoints: vec3[],
        public gunSubModel: number[],
        public hitVclip: number,
        public hitSound: number,
        public deathVclip: number,
        public deathSound: number,
        public weaponType1: number,
        public weaponType2: number,
        public numGuns: number,
        public containsId: number,
        public containsCount: number,
        public containsProbability: number,
        public containsType: number,
        public kamikaze: number,
        public score: number,
        public deathExplosionRadius: number,
        public energyDrain: number,
        public lighting: number,
        public strength: number,
        public mass: number,
        public drag: number,
        public fov: number[],
        public firingWait1: number[],
        public firingWait2: number[],
        public turnTime: number[],
        public firePower: number[],
        public shields: number[],
        public maxSpeed: number[],
        public circleDistance: number[],
        public rapidfireCount: number[],
        public evadeSpeed: number[],
        public cloakType: number,
        public attackType: number,
        public seeSound: number,
        public attackSound: number,
        public clawSound: number,
        public tauntSound: number,
        public bossFlag: number,
        public companion: boolean,
        public smartBlobsOnDeath: number,
        public smartBlobsOnHit: number,
        public thief: boolean,
        public pursuit: number,
        public lightCast: number,
        public deathRollTime: number,
        public flags: number,
        public deathRollSound: number,
        public glow: number,
        public behavior: number,
        public aim: number,
        public animStates: DescentJointAnimState[][],
    ) {}
}

/** Represents a reactor; Descent 2 only, Descent 1 has hardcoded-ish data. */
export class DescentReactor {
    constructor(
        public modelNum: number,
        public numGuns: number,
        public gunPoints: vec3[],
        public gunDirs: vec3[],
    ) {}
}
