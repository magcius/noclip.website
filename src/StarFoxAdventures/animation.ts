import { mat4 } from 'gl-matrix';
import { lerp, lerpAngle } from '../MathHelpers';
import AnimationController from '../AnimationController';
import { ViewerRenderInput } from '../viewer';
import { DataFetcher } from '../DataFetcher';
import { nArray } from '../util';

import { GameInfo } from './scenes';
import { dataSubarray, interpS16, signExtend, angle16ToRads, HighBitReader } from './util';
import { ModelInstance } from './models';

export class SFAAnimationController {
    public animController: AnimationController = new AnimationController(60);
    public envAnimValue0: number = 0;
    public envAnimValue1: number = 0;
    public enableFineSkinAnims: boolean = true;

    public update(viewerInput: ViewerRenderInput) {
        this.animController.setTimeFromViewerInput(viewerInput);
        this.envAnimValue0 = (0.0084 * this.animController.getTimeInFrames()) % 256;
        this.envAnimValue1 = (0.003 * this.animController.getTimeInFrames()) % 256;
    }
}

interface AnimCurve {
}

export class AnimCurvFile {
    private animcurvTab: DataView;
    private animcurvBin: DataView;

    private constructor() {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string): Promise<AnimCurvFile> {
        const self = new AnimCurvFile();

        const pathBase = gameInfo.pathBase;
        const [animcurvTab, animcurvBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/ANIMCURV.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/ANIMCURV.bin`),
        ]);
        self.animcurvTab = animcurvTab.createDataView();
        self.animcurvBin = animcurvBin.createDataView();

        return self;
    }

    public getAnimCurve(num: number): AnimCurve {
        const offs = this.animcurvTab.getUint32(num * 4) & 0x7fffffff;
        const nextOffs = this.animcurvTab.getUint32((num + 1) * 4) & 0x7fffffff;
        const byteLength = nextOffs - offs;

        const data = dataSubarray(this.animcurvBin, offs, byteLength);

        // TODO

        return {};
    }
}

interface Axis {
    translation: number;
    rotation: number;
    scale: number;
}

function createAxis(): Axis {
    return { translation: 0, rotation: 0, scale: 1 };
}

const NUM_AXES = 3;
interface Pose {
    axes: Axis[/* 3 */];
}

function createPose(): Pose {
    return { axes: nArray(NUM_AXES, () => createAxis()) };
}

export interface Keyframe {
    poses: Pose[];
}

function createKeyframe(numPoses: number): Keyframe {
    return { poses: nArray(numPoses, () => createPose()) };
}

export interface Anim {
    keyframes: Keyframe[];
    speed: number;
    times: number[];
}

export class AnimFile {
    private tab: DataView;
    private bin: DataView;

    private constructor() {
    }

    public static async create(dataFetcher: DataFetcher, path: string): Promise<AnimFile> {
        const self = new AnimFile();

        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${path}.TAB`),
            dataFetcher.fetchData(`${path}.BIN`),
        ]);
        self.tab = tab.createDataView();
        self.bin = bin.createDataView();

        return self;
    }

    public hasAnim(num: number): boolean {
        return (this.tab.getUint32(num * 4) & 0xff000000) === 0x10000000;
    }

    public getAnim(num: number): Anim {
        const offs = this.tab.getUint32(num * 4) & 0x0fffffff;
        const nextOffs = this.tab.getUint32((num + 1) * 4) & 0x0fffffff;
        const byteLength = nextOffs - offs;

        const data = dataSubarray(this.bin, offs, byteLength);

        const HEADER_SIZE = 0xa;
        const header = {
            keyframesOffset: data.getUint16(0x2),
            timesOffset: data.getUint16(0x4),
            numBones: data.getUint8(0x6),
            numKeyframes: data.getUint8(0x7),
            keyframeStride: data.getUint8(0x8),
        };
        // console.log(`Anim ${num} header: ${JSON.stringify(header, null, '\t')}`);

        function loadKeyframe(kfNum: number): Keyframe {
            let cmdOffs = HEADER_SIZE;
            let kfOffs = header.keyframesOffset + kfNum * header.keyframeStride;
            const kfReader = new HighBitReader(data, kfOffs);

            function getNextCmd(): number {
                const result = data.getUint16(cmdOffs);
                cmdOffs += 2;
                return result;
            }

            function loadAxis(): Axis {
                const result: Axis = createAxis();

                let cmd = getNextCmd();

                result.rotation = interpS16(cmd & 0xfff0);

                const numAngleBits = cmd & 0xf;
                if (numAngleBits !== 0) {
                    const value = kfReader.get(numAngleBits);
                    result.rotation += signExtend(value, 14) * 4;
                }

                result.rotation = angle16ToRads(result.rotation);

                if (cmd & 0x10) {
                    cmd = getNextCmd();

                    let hasScale = !!(cmd & 0x10);
                    let hasTranslation = true;

                    if (hasScale) {
                        result.scale = cmd & 0xffc0;

                        const numScaleBits = cmd & 0xf;
                        if (numScaleBits !== 0) {
                            const value = kfReader.get(numScaleBits);
                            result.scale += signExtend(value, 16) * 2;
                        }

                        result.scale = (result.scale & 0xffff) / 1024;

                        hasTranslation = !!(cmd & 0x20);
                        if (hasTranslation) {
                            cmd = getNextCmd();
                        }
                    }
                    
                    if (hasTranslation) {
                        result.translation = interpS16(cmd & 0xfff0);

                        const numTransBits = cmd & 0xf;
                        if (numTransBits !== 0) {
                            result.translation += kfReader.get(numTransBits);
                        }

                        result.translation = interpS16(result.translation) / 512;
                    }
                }

                return result;
            }

            function loadPose(): Pose {
                const result: Pose = createPose();

                for (let i = 0; i < NUM_AXES; i++) {
                    result.axes[i] = loadAxis();
                }

                return result;
            }

            const result: Keyframe = createKeyframe(header.numBones);

            for (let i = 0; i < header.numBones; i++) {
                result.poses[i] = loadPose();
                // console.log(`pose ${i}: ${JSON.stringify(pose, null, '\t')}`);
            }

            return result;
        }

        const keyframes: Keyframe[] = [];
        for (let i = 0; i < header.numKeyframes; i++) {
            const keyframe = loadKeyframe(i);
            keyframes.push(keyframe);
        }

        const times = [];
        let speed = 1;
        if (header.timesOffset !== 0) {
            let timesOffs = header.timesOffset;
            speed = data.getFloat32(timesOffs);
            timesOffs += 0x4;
            const numTimes = data.getUint16(timesOffs);
            timesOffs += 0x2;
            if (data.getUint16(timesOffs) === 0) {
                // FIXME: what is this?
                timesOffs += 0x2;
                if (data.getUint16(timesOffs) === 0) {
                    timesOffs += 0x2;
                }
            }
            if (data.getUint16(timesOffs) !== numTimes) {
                console.warn(`mismatched numTimes ${data.getUint16(timesOffs)} != ${numTimes}`);
            }
            timesOffs += 0x2;
    
            for (let i = 0; i < numTimes; i++) {
                times.push(data.getInt16(timesOffs));
                timesOffs += 0x2;
            }
        }

        const anim = { keyframes, speed, times };
        // console.log(`loaded anim #${num} from offs 0x${offs.toString(16)}: ${JSON.stringify({speed, times}, null, '\t')}`);
        return anim;
    }
}

export function interpolateAxes(axis0: Axis, axis1: Axis, ratio: number, reuse?: Axis): Axis {
    const result = reuse !== undefined ? reuse : createAxis();

    result.translation = lerp(axis0.translation, axis1.translation, ratio);
    result.rotation = lerpAngle(axis0.rotation, axis1.rotation, ratio); // TODO: use lerpAngle? but lerpAngle assumes 0..2pi whereas we use -pi..pi.
    result.scale = lerp(axis0.scale, axis1.scale, ratio);

    return result;
}

export function interpolatePoses(pose0: Pose, pose1: Pose, ratio: number, reuse?: Pose): Pose {
    const result: Pose = reuse !== undefined ? reuse : createPose();

    for (let i = 0; i < NUM_AXES; i++) {
        result.axes[i] = interpolateAxes(pose0.axes[i], pose1.axes[i], ratio, result.axes[i]);
    }

    return result;
}

export function getLocalTransformForPose(dst: mat4, pose: Pose) {
    mat4.fromTranslation(dst, [pose.axes[0].translation, pose.axes[1].translation, pose.axes[2].translation]);
    mat4.scale(dst, dst, [pose.axes[0].scale, pose.axes[1].scale, pose.axes[2].scale]);
    mat4.rotateZ(dst, dst, pose.axes[2].rotation);
    mat4.rotateY(dst, dst, pose.axes[1].rotation);
    mat4.rotateX(dst, dst, pose.axes[0].rotation);
}

export function interpolateKeyframes(kf0: Keyframe, kf1: Keyframe, ratio: number, reuse?: Keyframe): Keyframe {
    const numPoses = Math.min(kf0.poses.length, kf1.poses.length);
    const result: Keyframe = reuse !== undefined ? reuse : createKeyframe(numPoses);

    for (let i = 0; i < numPoses; i++) {
        result.poses[i] = interpolatePoses(kf0.poses[i], kf1.poses[i], ratio, result.poses[i]);
    }

    return result;
}

export function applyKeyframeToModel(kf: Keyframe, modelInst: ModelInstance, amap: DataView | null) {
    modelInst.resetPose();

    for (let i = 0; i < kf.poses.length && i < modelInst.model.joints.length; i++) {
        let poseNum = i;
        if (amap !== null) {
            poseNum = amap.getInt8(i);
        }

        const pose = kf.poses[poseNum];
        const poseMtx = mat4.create();
        getLocalTransformForPose(poseMtx, pose);

        modelInst.setJointPose(i, poseMtx);
    }
}

export class AmapCollection {
    private amapTab: DataView;
    private amapBin: DataView;

    private constructor() {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher): Promise<AmapCollection> {
        const self = new AmapCollection();

        const pathBase = gameInfo.pathBase;
        const [amapTab, amapBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/AMAP.TAB`),
            dataFetcher.fetchData(`${pathBase}/AMAP.BIN`),
        ]);
        self.amapTab = amapTab.createDataView();
        self.amapBin = amapBin.createDataView();

        return self;
    }

    public getAmap(modelNum: number): DataView {
        const offs = this.amapTab.getUint32(modelNum * 4);
        const nextOffs = this.amapTab.getUint32((modelNum + 1) * 4);
        console.log(`loading amap for model ${modelNum} from 0x${offs.toString(16)}, size 0x${(nextOffs - offs).toString(16)}`);
        return dataSubarray(this.amapBin, offs, nextOffs - offs);
    }
}

export class ModanimCollection {
    private modanimTab: DataView;
    private modanimBin: DataView;

    private constructor() {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher): Promise<ModanimCollection> {
        const self = new ModanimCollection();

        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/MODANIM.TAB`),
            dataFetcher.fetchData(`${pathBase}/MODANIM.BIN`),
        ]);
        self.modanimTab = tab.createDataView();
        self.modanimBin = bin.createDataView();

        return self;
    }

    public getModanim(modelNum: number): DataView {
        const offs = this.modanimTab.getUint16(modelNum * 2);
        const nextOffs = this.modanimTab.getUint16((modelNum + 1) * 2);
        // console.log(`loading modanim for model ${modelNum} from 0x${offs.toString(16)}, size 0x${(nextOffs - offs).toString(16)}`);
        return dataSubarray(this.modanimBin, offs, nextOffs - offs);
    }
}

export class AnimCollection {
    private animFile: AnimFile;
    private preanimFile: AnimFile;

    private constructor() {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string): Promise<AnimCollection> {
        const self = new AnimCollection();

        const pathBase = gameInfo.pathBase;
        self.animFile = await AnimFile.create(dataFetcher, `${pathBase}/${subdir}/ANIM`);
        self.preanimFile = await AnimFile.create(dataFetcher, `${pathBase}/PREANIM`);

        return self;
    }

    public getAnim(num: number): Anim {
        if (this.preanimFile.hasAnim(num)) {
            return this.preanimFile.getAnim(num);
        } else {
            return this.animFile.getAnim(num);
        }
    }
}