import AnimationController from '../AnimationController';
import { ViewerRenderInput } from '../viewer';
import { DataFetcher } from '../DataFetcher';
import { GameInfo } from './scenes';
import { dataSubarray, interpS16, signExtend, angle16ToRads, HighBitReader } from './util';

export class SFAAnimationController {
    public animController: AnimationController = new AnimationController(60);
    public envAnimValue0: number = 0;
    public envAnimValue1: number = 0;

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
    amap: DataView;
    keyframes: Keyframe[];
}

interface UnmappedAnim {
    keyframes: Keyframe[];
}

export class AnimFile {
    private tab: DataView;
    private bin: DataView;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher, path: string) {
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${path}.tab`),
            dataFetcher.fetchData(`${path}.bin`),
        ]);
        this.tab = tab.createDataView();
        this.bin = bin.createDataView();
    }

    public hasAnim(num: number): boolean {
        return (this.tab.getUint32(num * 4) & 0xff000000) === 0x10000000;
    }

    public getAnim(num: number): UnmappedAnim {
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
        console.log(`Anim ${num} header: ${JSON.stringify(header, null, '\t')}`);

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

                const numAngleBits = cmd & 0xf;
                result.rotation = interpS16(cmd & 0xfff0);
                if (numAngleBits !== 0) {
                    const value = kfReader.get(numAngleBits);
                    result.rotation += signExtend(value, 14);
                }

                if (cmd & 0x10) {
                    cmd = getNextCmd();

                    let hasScale = !!(cmd & 0x10);
                    let hasTranslation = true;

                    if (hasScale) {
                        result.scale = interpS16(cmd & 0xffc0);
                        const numScaleBits = cmd & 0xf;
                        if (numScaleBits !== 0) {
                            result.scale += kfReader.get(numScaleBits);
                        }

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
                        result.translation /= 256; // ???
                    }
                }

                result.rotation = (result.rotation / 0xd0) * Math.PI / 180;

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
                console.log(`pose ${i}: ${JSON.stringify(pose, null, '\t')}`);
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

export class AnimLoader {
    private animFile: AnimFile;
    private preanimFile: AnimFile;
    private amapTab: DataView;
    private amapBin: DataView;

    constructor(private gameInfo: GameInfo) {
        this.animFile = new AnimFile(gameInfo);
        this.preanimFile = new AnimFile(gameInfo);
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        const [_1, _2, amapTab, amapBin] = await Promise.all([
            this.animFile.create(dataFetcher, `${pathBase}/${subdir}/ANIM`),
            this.preanimFile.create(dataFetcher, `${pathBase}/PREANIM`),
            dataFetcher.fetchData(`${pathBase}/AMAP.tab`),
            dataFetcher.fetchData(`${pathBase}/AMAP.bin`),
        ]);
        this.amapTab = amapTab.createDataView();
        this.amapBin = amapBin.createDataView();
    }

    public getAnim(num: number): Anim {
        const amapOffs = this.amapTab.getUint32(num * 4);
        const nextAmapOffs = this.amapTab.getUint32((num + 1) * 4);
        console.log(`loading amap from 0x${amapOffs.toString(16)}, size 0x${(nextAmapOffs - amapOffs).toString(16)}`);
        //const amap = dataSubarray(this.amapBin, amapOffs, nextAmapOffs - amapOffs);
        const amap = dataSubarray(this.amapBin, amapOffs);

        let unmappedAnim;
        if (this.preanimFile.hasAnim(num)) {
            unmappedAnim = this.preanimFile.getAnim(num);
        } else {
            unmappedAnim = this.animFile.getAnim(num);
        }

        return { amap, keyframes: unmappedAnim.keyframes };
    }
}