import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, nArray } from "../../util";
import {
    ANIM_STATES_COUNT,
    BITMAP_FLAG_RLE_BIG,
    DescentEClip,
    DescentJoint,
    DescentJointAnimState,
    DescentPalette,
    DescentPigBitmap,
    DescentPowerUp,
    DescentReactor,
    DescentRobot,
    DescentTmap,
    DescentVClip,
    DescentWClip,
    DIFFICULTY_LEVEL_COUNT,
    RGB,
} from "./AssetTypes";
import { DescentDataReader } from "./DataReader";
import { POLYOBJ_MAX_GUNS } from "./Polymodel";

export function readDescentPalette(
    name: string,
    reader: DescentDataReader,
): DescentPalette {
    const data: RGB[] = [];
    assert(reader.buffer.byteLength - reader.buffer.byteOffset >= 768);
    for (let i = 0; i < 256; ++i) {
        const r = ((reader.readUint8() * 255) / 63) | 0;
        const g = ((reader.readUint8() * 255) / 63) | 0;
        const b = ((reader.readUint8() * 255) / 63) | 0;
        data.push([r, g, b]);
    }
    return new DescentPalette(name, data);
}

export function readDescent1Tmap(reader: DescentDataReader): DescentTmap {
    const filename = reader.readString(13);
    const flags = reader.readUint8();
    const lighting = reader.readFix();
    const damage = reader.readFix();
    const eclip_num = reader.readInt32();
    return new DescentTmap(
        -1 /* id */,
        filename,
        flags,
        lighting,
        damage,
        eclip_num,
        -1 /* destroyed_id */,
        0 /* slide_u */,
        0 /* slide_v */,
    );
}

export function readDescent2Tmap(reader: DescentDataReader): DescentTmap {
    const flags = reader.readUint8();
    reader.offset += 3;
    const lighting = reader.readFix();
    const damage = reader.readFix();
    const eclip_num = reader.readInt16();
    const destroyed_id = reader.readInt16();
    const slide_u = reader.readInt16() / 256.0;
    const slide_v = reader.readInt16() / 256.0;
    return new DescentTmap(
        -1 /* id */,
        "" /* filename */,
        flags,
        lighting,
        damage,
        eclip_num,
        destroyed_id,
        slide_u,
        slide_v,
    );
}

export function readDescentVClip(reader: DescentDataReader): DescentVClip {
    const play_time = reader.readFix();
    const num_frames = reader.readInt32();
    const frame_time = reader.readFix();
    const flags = reader.readUint32();
    const sound_num = reader.readInt16();
    const bitmap_index = [];
    for (let i = 0; i < 30; ++i) {
        bitmap_index.push(reader.readUint16());
    }
    const light_value = reader.readFix();
    return new DescentVClip(
        play_time,
        num_frames,
        frame_time,
        flags,
        sound_num,
        bitmap_index,
        light_value,
    );
}

export function readDescentEClip(reader: DescentDataReader): DescentEClip {
    const vclip = readDescentVClip(reader);
    const time_left = reader.readUint32();
    const frame_count = reader.readUint32();
    const changing_wall_texture = reader.readUint16();
    const changing_object_texture = reader.readUint16();
    const flags = reader.readUint32();
    const crit_clip = reader.readUint32();
    const dest_bm_num = reader.readUint32();
    const dest_vclip = reader.readUint32();
    const dest_eclip = reader.readUint32();
    const dest_size = reader.readFix();
    const sound_num = reader.readUint32();
    const segnum = reader.readUint32();
    const sidenum = reader.readUint32();
    return new DescentEClip(
        vclip,
        time_left,
        frame_count,
        changing_wall_texture,
        changing_object_texture,
        flags,
        crit_clip,
        dest_bm_num,
        dest_vclip,
        dest_eclip,
        dest_size,
        sound_num,
        segnum,
        sidenum,
    );
}

export function readDescent1WClip(reader: DescentDataReader): DescentWClip {
    const play_time = reader.readFix();
    const num_frames = reader.readInt16();
    const frames = [];
    for (let i = 0; i < 20; ++i) {
        frames.push(reader.readUint16());
    }
    const open_sound = reader.readInt16();
    const close_sound = reader.readInt16();
    const flags = reader.readInt16();
    const filename = reader.readString(13);
    reader.offset += 1; // pad
    return new DescentWClip(
        play_time,
        num_frames,
        frames,
        open_sound,
        close_sound,
        flags,
        filename,
    );
}

export function readDescent2WClip(reader: DescentDataReader): DescentWClip {
    const play_time = reader.readFix();
    const num_frames = reader.readInt16();
    const frames = [];
    for (let i = 0; i < 50; ++i) {
        frames.push(reader.readUint16());
    }
    const open_sound = reader.readInt16();
    const close_sound = reader.readInt16();
    const flags = reader.readInt16();
    const filename = reader.readString(13);
    reader.offset += 1; // pad
    return new DescentWClip(
        play_time,
        num_frames,
        frames,
        open_sound,
        close_sound,
        flags,
        filename,
    );
}

export function readDescentJoint(reader: DescentDataReader): DescentJoint {
    const joint_num = reader.readInt16();
    const angles_p = reader.readInt16() / 65536.0;
    const angles_b = reader.readInt16() / 65536.0;
    const angles_h = reader.readInt16() / 65536.0;
    return new DescentJoint(
        joint_num,
        vec3.fromValues(angles_p, angles_b, angles_h),
    );
}

export function readDescentPowerUp(reader: DescentDataReader): DescentPowerUp {
    const vclip_num = reader.readInt32();
    const hit_sound = reader.readInt32();
    const size = reader.readFix();
    const light = reader.readFix();
    return new DescentPowerUp(vclip_num, hit_sound, size, light);
}

export function readRobotAnimState(
    reader: DescentDataReader,
): DescentJointAnimState {
    return {
        numJoints: reader.readInt16(),
        offset: reader.readInt16(),
    };
}

export function readDescent1Robot(reader: DescentDataReader): DescentRobot {
    const modelNum = reader.readInt32();
    const numGuns = reader.readInt32();
    const gunPoints = nArray(POLYOBJ_MAX_GUNS, () => reader.readFixVector());
    const gunSubModel = nArray(POLYOBJ_MAX_GUNS, () => reader.readUint8());
    const hitVclip = reader.readInt16();
    const hitSound = reader.readInt16();
    const deathVclip = reader.readInt16();
    const deathSound = reader.readInt16();
    const weaponType = reader.readInt16();
    const containsId = reader.readInt8();
    const containsCount = reader.readInt8();
    const containsProbability = reader.readInt8();
    const containsType = reader.readInt8();
    const score = reader.readInt32();
    const lighting = reader.readFix();
    const strength = reader.readFix();
    const mass = reader.readFix();
    const drag = reader.readFix();
    const fov = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const firingWait = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const turnTime = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const firePower = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const shields = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const maxSpeed = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const circleDistance = nArray(DIFFICULTY_LEVEL_COUNT, () =>
        reader.readFix(),
    );
    const rapidfireCount = nArray(DIFFICULTY_LEVEL_COUNT, () =>
        reader.readInt8(),
    );
    const evadeSpeed = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readInt8());
    const cloakType = reader.readInt8();
    const attackType = reader.readInt8();
    const bossFlag = reader.readInt8();
    const seeSound = reader.readUint8();
    const attackSound = reader.readUint8();
    const clawSound = reader.readUint8();
    const animStates = nArray(POLYOBJ_MAX_GUNS + 1, () =>
        nArray(ANIM_STATES_COUNT, () => readRobotAnimState(reader)),
    );
    reader.readUint32();

    return new DescentRobot(
        modelNum,
        gunPoints,
        gunSubModel,
        hitVclip,
        hitSound,
        deathVclip,
        deathSound,
        weaponType,
        -1 /* weaponType2 */,
        numGuns,
        containsId,
        containsCount,
        containsProbability,
        containsType,
        0 /* kamikaze */,
        score,
        0 /* deathExplosionRadius */,
        0 /* energyDrain */,
        lighting,
        strength,
        mass,
        drag,
        fov,
        firingWait,
        nArray(DIFFICULTY_LEVEL_COUNT, () => 0.0) /* firingWait2 */,
        turnTime,
        firePower,
        shields,
        maxSpeed,
        circleDistance,
        rapidfireCount,
        evadeSpeed,
        cloakType,
        attackType,
        seeSound,
        attackSound,
        clawSound,
        -1 /* tauntSound */,
        bossFlag,
        false /* companion */,
        0 /* smartBlobsOnDeath */,
        0 /* smartBlobsOnHit */,
        false /* thief */,
        0 /* pursuit */,
        0 /* lightCast */,
        0 /* deathRollTime */,
        0 /* flags */,
        0 /* deathRollSound */,
        0 /* glow */,
        0 /* behavior */,
        0 /* aim */,
        animStates,
    );
}

export function readDescent2Robot(reader: DescentDataReader): DescentRobot {
    const modelNum = reader.readInt32();
    const gunPoints = nArray(POLYOBJ_MAX_GUNS, () => reader.readFixVector());
    const gunSubModel = nArray(POLYOBJ_MAX_GUNS, () => reader.readUint8());
    const hitVclip = reader.readInt16();
    const hitSound = reader.readInt16();
    const deathVclip = reader.readInt16();
    const deathSound = reader.readInt16();
    const weaponType1 = reader.readInt8();
    const weaponType2 = reader.readInt8();
    const numGuns = reader.readInt8();
    const containsId = reader.readInt8();
    const containsCount = reader.readInt8();
    const containsProbability = reader.readInt8();
    const containsType = reader.readInt8();
    const kamikaze = reader.readInt8();
    const score = reader.readInt16();
    const deathExplosionRadius = reader.readUint8();
    const energyDrain = reader.readUint8();
    const lighting = reader.readFix();
    const strength = reader.readFix();
    const mass = reader.readFix();
    const drag = reader.readFix();
    const fov = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const firingWait1 = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const firingWait2 = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const turnTime = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const maxSpeed = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readFix());
    const circleDistance = nArray(DIFFICULTY_LEVEL_COUNT, () =>
        reader.readFix(),
    );
    const rapidfireCount = nArray(DIFFICULTY_LEVEL_COUNT, () =>
        reader.readInt8(),
    );
    const evadeSpeed = nArray(DIFFICULTY_LEVEL_COUNT, () => reader.readInt8());
    const cloakType = reader.readInt8();
    const attackType = reader.readInt8();
    const seeSound = reader.readUint8();
    const attackSound = reader.readUint8();
    const clawSound = reader.readUint8();
    const tauntSound = reader.readUint8();
    const bossFlag = reader.readInt8();
    const companion = !!reader.readInt8();
    const smartBlobsOnDeath = reader.readInt8();
    const smartBlobsOnHit = reader.readInt8();
    const thief = !!reader.readInt8();
    const pursuit = reader.readInt8();
    const lightCast = reader.readInt8();
    const deathRollTime = reader.readInt8();
    const flags = reader.readUint8();
    reader.offset += 3;
    const deathRollSound = reader.readUint8();
    const glow = reader.readUint8() / 16.0;
    const behavior = reader.readUint8();
    const aim = reader.readUint8();
    const animStates = nArray(POLYOBJ_MAX_GUNS + 1, () =>
        nArray(ANIM_STATES_COUNT, () => readRobotAnimState(reader)),
    );
    reader.readUint32();

    return new DescentRobot(
        modelNum,
        gunPoints,
        gunSubModel,
        hitVclip,
        hitSound,
        deathVclip,
        deathSound,
        weaponType1,
        weaponType2,
        numGuns,
        containsId,
        containsCount,
        containsProbability,
        containsType,
        kamikaze,
        score,
        deathExplosionRadius,
        energyDrain,
        lighting,
        strength,
        mass,
        drag,
        fov,
        firingWait1,
        firingWait2,
        turnTime,
        nArray(DIFFICULTY_LEVEL_COUNT, () => 0.0) /* firePower */,
        nArray(DIFFICULTY_LEVEL_COUNT, () => 0.0) /* shields */,
        maxSpeed,
        circleDistance,
        rapidfireCount,
        evadeSpeed,
        cloakType,
        attackType,
        seeSound,
        attackSound,
        clawSound,
        tauntSound,
        bossFlag,
        companion,
        smartBlobsOnDeath,
        smartBlobsOnHit,
        thief,
        pursuit,
        lightCast,
        deathRollTime,
        flags,
        deathRollSound,
        glow,
        behavior,
        aim,
        animStates,
    );
}

export function readDescentReactor(reader: DescentDataReader): DescentReactor {
    const model_num = reader.readInt32();
    const num_guns = reader.readInt32();
    const gun_points = nArray(POLYOBJ_MAX_GUNS, () => reader.readFixVector());
    const gun_dirs = nArray(POLYOBJ_MAX_GUNS, () => reader.readFixVector());
    return new DescentReactor(model_num, num_guns, gun_points, gun_dirs);
}

function descentRleDecompressRow(
    dst: Uint8Array,
    dstOffset: number,
    src: Uint8Array,
    srcOffset: number,
    stride: number,
) {
    let dstOut = dstOffset;
    const dstEnd = dstOffset + stride;

    while (dstOut < dstEnd) {
        const cmd = src[srcOffset++];

        if (cmd >= 0xe0) {
            const count = cmd & 0x1f;
            if (count === 0) return;

            const data = src[srcOffset++];
            for (let i = 0; i < count && dstOut < dstEnd; ++i)
                dst[dstOut++] = data;
        } else {
            dst[dstOut++] = cmd;
        }
    }
}

/** Decompresses a RLE compressed bitmap into uncompressed palettized bitmap data. */
export function descentRleDecompress(
    bitmap: DescentPigBitmap,
    data: ArrayBufferSlice,
): ArrayBuffer {
    const result = new ArrayBuffer(bitmap.width * bitmap.height);
    const src = data.createTypedArray(Uint8Array);
    const dst = new Uint8Array(result);

    let offset =
        bitmap.flags & BITMAP_FLAG_RLE_BIG ? bitmap.height * 2 : bitmap.height;
    for (let y = 0; y < bitmap.height; ++y) {
        descentRleDecompressRow(
            dst,
            y * bitmap.width,
            src,
            offset,
            bitmap.width,
        );
        if (bitmap.flags & BITMAP_FLAG_RLE_BIG) {
            offset += src[2 * y] | (src[2 * y + 1] << 8);
        } else {
            offset += src[y];
        }
    }

    return result;
}
