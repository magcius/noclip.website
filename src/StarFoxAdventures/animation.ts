import AnimationController from '../AnimationController';
import { ViewerRenderInput } from '../viewer';
import { DataFetcher } from '../DataFetcher';
import { GameInfo } from './scenes';
import { dataSubarray, interpS16, signExtend, angle16ToRads, HighBitReader } from './util';
import { lerp, lerpAngle } from '../MathHelpers';

export class SFAAnimationController {
    public animController: AnimationController = new AnimationController(60);
    public envAnimValue0: number = 0;
    public envAnimValue1: number = 0;
    public enableFineSkinAnims: boolean = false;

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

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        const [animcurvTab, animcurvBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/ANIMCURV.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/ANIMCURV.bin`),
        ]);
        this.animcurvTab = animcurvTab.createDataView();
        this.animcurvBin = animcurvBin.createDataView();
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

interface Pose {
    axes: Axis[/* 3 */];
}

interface Keyframe {
    poses: Pose[];
}

export interface Anim {
    keyframes: Keyframe[];
}

export class AnimFile {
    private tab: DataView;
    private bin: DataView;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher, path: string) {
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${path}.TAB`),
            dataFetcher.fetchData(`${path}.BIN`),
        ]);
        this.tab = tab.createDataView();
        this.bin = bin.createDataView();
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
                const result: Axis = {
                    translation: 0,
                    rotation: 0,
                    scale: 1.0,
                };

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
                const result: Pose = { axes: [] };

                for (let i = 0; i < 3; i++) {
                    result.axes.push(loadAxis());
                }

                return result;
            }

            const result: Keyframe = { poses: [] };

            for (let i = 0; i < header.numBones; i++) {
                const pose = loadPose();
                result.poses.push(pose);
                // console.log(`pose ${i}: ${JSON.stringify(pose, null, '\t')}`);
            }

            return result;
        }

        const keyframes: Keyframe[] = [];
        for (let i = 0; i < header.numKeyframes; i++) {
            const keyframe = loadKeyframe(i);
            keyframes.push(keyframe);
        }

        return { keyframes };
    }
}

export function interpolateAxes(axis0: Axis, axis1: Axis, ratio: number): Axis {
    return {
        translation: lerp(axis0.translation, axis1.translation, ratio),
        rotation: lerp(axis0.rotation, axis1.rotation, ratio), // TODO: use lerpAngle? but lerpAngle assumes 0..2pi whereas we use -pi..pi.
        scale: lerp(axis0.scale, axis1.scale, ratio),
    };
}

export function interpolatePoses(pose0: Pose, pose1: Pose, ratio: number): Pose {
    const result: Pose = { axes: [] };

    for (let i = 0; i < pose0.axes.length && i < pose1.axes.length; i++) {
        result.axes.push(interpolateAxes(pose0.axes[i], pose1.axes[i], ratio));
    }

    return result;
}

export function interpolateKeyframes(kf0: Keyframe, kf1: Keyframe, ratio: number): Keyframe {
    const result: Keyframe = { poses: [] };

    for (let i = 0; i < kf0.poses.length && i < kf1.poses.length; i++) {
        result.poses.push(interpolatePoses(kf0.poses[i], kf1.poses[i], ratio));
    }

    return result;
}

export class AmapCollection {
    private amapTab: DataView;
    private amapBin: DataView;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher) {
        const pathBase = this.gameInfo.pathBase;
        const [amapTab, amapBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/AMAP.TAB`),
            dataFetcher.fetchData(`${pathBase}/AMAP.BIN`),
        ]);
        this.amapTab = amapTab.createDataView();
        this.amapBin = amapBin.createDataView();
    }

    public getAmap(modelNum: number): DataView {
        const offs = this.amapTab.getUint32(modelNum * 4);
        const nextOffs = this.amapTab.getUint32((modelNum + 1) * 4);
        // console.log(`loading amap for model ${modelNum} from 0x${offs.toString(16)}, size 0x${(nextOffs - offs).toString(16)}`);
        return dataSubarray(this.amapBin, offs, nextOffs - offs);
    }
}

export class ModanimCollection {
    private modanimTab: DataView;
    private modanimBin: DataView;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher) {
        const pathBase = this.gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/MODANIM.TAB`),
            dataFetcher.fetchData(`${pathBase}/MODANIM.BIN`),
        ]);
        this.modanimTab = tab.createDataView();
        this.modanimBin = bin.createDataView();
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

    constructor(private gameInfo: GameInfo) {
        this.animFile = new AnimFile(gameInfo);
        this.preanimFile = new AnimFile(gameInfo);
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        await Promise.all([
            this.animFile.create(dataFetcher, `${pathBase}/${subdir}/ANIM`),
            this.preanimFile.create(dataFetcher, `${pathBase}/PREANIM`),
        ]);
    }

    public getAnim(num: number): Anim {
        if (this.preanimFile.hasAnim(num)) {
            return this.preanimFile.getAnim(num);
        } else {
            return this.animFile.getAnim(num);
        }
    }
}