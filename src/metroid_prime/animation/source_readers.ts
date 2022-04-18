import { AdvancementDeltas, AdvancementResults, BoolPOINode, IAnimReader, Int32POINode, ParentedMode, ParticlePOINode, PerSegmentData, POIKey, POINode, SoundPOINode, SteadyStateAnimInfo } from './base_reader';
import { CharAnimTime } from './char_anim_time';
import { AnimSource, AnimSourceCompressed } from './data_source';
import { quat, vec3 } from 'gl-matrix';
import { EVNT } from '../evnt';

interface BoolState {
    name: string;
    value: boolean;
}

interface Int32State {
    name: string;
    value: number;
}

interface ParticleState {
    name: string;
    value: ParentedMode;
}

export abstract class AnimSourceReaderBase extends IAnimReader {
    passedBoolIdx: number = 0;
    passedIntIdx: number = 0;
    passedParticleIdx: number = 0;
    passedSoundIdx: number = 0;
    boolStates: BoolState[];
    int32States: Int32State[];
    particleStates: ParticleState[];

    protected constructor(public steadyStateInfo: SteadyStateAnimInfo,
                          public poiData: EVNT | null,
                          public curTime: CharAnimTime = new CharAnimTime()) {
        super();
    }

    public GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        return this.steadyStateInfo;
    }

    private static GetUniquePOIs(arr: POINode[]): Set<POIKey> {
        const ret = new Set<POIKey>();
        for (const poi of arr) {
            if (poi.GetUnique())
                ret.add(poi.GetKey());
        }
        return ret;
    }
    private GetUniqueBoolPOIs(): Set<POIKey> {
        return AnimSourceReaderBase.GetUniquePOIs(this.poiData!.GetBoolPOIStream());
    }
    private GetUniqueInt32POIs(): Set<POIKey> {
        return AnimSourceReaderBase.GetUniquePOIs(this.poiData!.GetInt32POIStream());
    }
    private GetUniqueParticlePOIs(): Set<POIKey> {
        return AnimSourceReaderBase.GetUniquePOIs(this.poiData!.GetParticlePOIStream());
    }

    public PostConstruct(time: CharAnimTime) {
        this.passedBoolIdx = 0;
        this.passedIntIdx = 0;
        this.passedParticleIdx = 0;
        this.passedSoundIdx = 0;

        if (this.poiData) {
            const boolPOIs = this.GetUniqueBoolPOIs();
            const int32POIs = this.GetUniqueInt32POIs();
            const particlePOIs = this.GetUniqueParticlePOIs();

            this.boolStates = new Array(boolPOIs.size);
            this.int32States = new Array(int32POIs.size);
            this.particleStates = new Array(particlePOIs.size);

            for (const poi of boolPOIs) {
                this.boolStates[poi.index] = { name: poi.name, value: false };
            }
            for (const poi of int32POIs) {
                this.int32States[poi.index] = { name: poi.name, value: 0 };
            }
            for (const poi of particlePOIs) {
                this.particleStates[poi.index] = { name: poi.name, value: ParentedMode.Initial };
            }
        }

        let tmpTime = time;
        if (tmpTime.GreaterThanZero()) {
            while (tmpTime.GreaterThanZero()) {
                const res = this.AdvanceView(tmpTime);
                tmpTime = res.remTime;
            }
        } else if (this.poiData) {
            this.UpdatePOIStates();
            if (!time.GreaterThanZero()) {
                this.passedBoolIdx = 0;
                this.passedIntIdx = 0;
                this.passedParticleIdx = 0;
                this.passedSoundIdx = 0;
            }
        }
    }

    public UpdatePOIStates() {
        if (!this.poiData)
            return;

        const boolNodes = this.poiData.GetBoolPOIStream();
        const int32Nodes = this.poiData.GetInt32POIStream();
        const particleNodes = this.poiData.GetParticlePOIStream();
        const soundNodes = this.poiData.GetSoundPOIStream();

        while (this.passedBoolIdx < boolNodes.length && boolNodes[this.passedBoolIdx].GetTime() <= this.curTime) {
            const node = boolNodes[this.passedBoolIdx];
            if (node.GetIndex() >= 0) {
                this.boolStates[node.GetIndex()].value = node.GetValue();
            }
            ++this.passedBoolIdx;
        }

        while (this.passedIntIdx < int32Nodes.length && int32Nodes[this.passedIntIdx].GetTime() <= this.curTime) {
            const node = int32Nodes[this.passedIntIdx];
            if (node.GetIndex() >= 0) {
                this.int32States[node.GetIndex()].value = node.GetValue();
            }
            ++this.passedIntIdx;
        }

        while (this.passedParticleIdx < particleNodes.length && particleNodes[this.passedParticleIdx].GetTime() <= this.curTime) {
            const node = particleNodes[this.passedParticleIdx];
            if (node.GetIndex() >= 0) {
                this.particleStates[node.GetIndex()].value = node.GetParticleData().GetParentedMode();
            }
            ++this.passedParticleIdx;
        }

        while (this.passedSoundIdx < soundNodes.length && soundNodes[this.passedSoundIdx].GetTime() <= this.curTime) {
            ++this.passedSoundIdx;
        }
    }

    public SetPhase(phase: number) {
        this.curTime = this.steadyStateInfo.duration.MulFactor(phase);
        this.UpdatePOIStates();
        if (!this.curTime.GreaterThanZero()) {
            this.passedBoolIdx = 0;
            this.passedIntIdx = 0;
            this.passedParticleIdx = 0;
            this.passedSoundIdx = 0;
        }
    }

    static GetPOIList<T extends POINode>(time: CharAnimTime, listOut: T[], capacity: number, iterator: number, stream: T[],
                                         curTime: CharAnimTime, duration: CharAnimTime, passedIdx: number): number {
        let ret = 0;
        if (stream.length) {
            let targetTime = curTime.Add(time);
            if (targetTime.GreaterEqual(duration))
                targetTime = duration;

            if (passedIdx >= stream.length)
                return ret;

            let nodeTime = stream[passedIdx].GetTime();
            while (passedIdx < stream.length && nodeTime.LessEqual(targetTime)) {
                const idx = iterator + ret;
                if (idx < capacity) {
                    listOut[idx] = stream[passedIdx].CopyNodeMinusStartTime(curTime) as T;
                    ++ret;
                }
                ++passedIdx;
                if (passedIdx < stream.length)
                    nodeTime = stream[passedIdx].GetTime();
            }
        }
        return ret;
    }

    public VGetBoolPOIList(time: CharAnimTime, listOut: BoolPOINode[], capacity: number, iterator: number): number {
        if (this.poiData) {
            const nodes = this.poiData.GetBoolPOIStream();
            return AnimSourceReaderBase.GetPOIList(time, listOut, capacity, iterator, nodes, this.curTime,
                this.steadyStateInfo.duration, this.passedBoolIdx);
        }
        return 0;
    }

    public VGetInt32POIList(time: CharAnimTime, listOut: Int32POINode[], capacity: number, iterator: number): number {
        if (this.poiData) {
            const nodes = this.poiData.GetInt32POIStream();
            return AnimSourceReaderBase.GetPOIList(time, listOut, capacity, iterator, nodes, this.curTime,
                this.steadyStateInfo.duration, this.passedIntIdx);
        }
        return 0;
    }

    public VGetParticlePOIList(time: CharAnimTime, listOut: ParticlePOINode[], capacity: number, iterator: number): number {
        if (this.poiData) {
            const nodes = this.poiData.GetParticlePOIStream();
            return AnimSourceReaderBase.GetPOIList(time, listOut, capacity, iterator, nodes, this.curTime,
                this.steadyStateInfo.duration, this.passedParticleIdx);
        }
        return 0;
    }

    public VGetSoundPOIList(time: CharAnimTime, listOut: SoundPOINode[], capacity: number, iterator: number): number {
        if (this.poiData) {
            const nodes = this.poiData.GetSoundPOIStream();
            return AnimSourceReaderBase.GetPOIList(time, listOut, capacity, iterator, nodes, this.curTime,
                this.steadyStateInfo.duration, this.passedSoundIdx);
        }
        return 0;
    }
}

export class AnimSourceReader extends AnimSourceReaderBase {
    constructor(private source: AnimSource, time: CharAnimTime) {
        super(new SteadyStateAnimInfo(
            source.duration, source.GetTranslation(source.rootBone, time), false), source.GetPOIData(), time);
        this.PostConstruct(time);
    }

    public AdvanceView(dt: CharAnimTime): AdvancementResults {
        if (this.curTime.GreaterEqual(this.source.duration)) {
            this.curTime = new CharAnimTime();
            this.passedBoolIdx = 0;
            this.passedIntIdx = 0;
            this.passedParticleIdx = 0;
            this.passedSoundIdx = 0;
            return { remTime: dt, deltas: new AdvancementDeltas() };
        } else if (dt.EqualsZero()) {
            return { remTime: new CharAnimTime(), deltas: new AdvancementDeltas() };
        } else {
            const prevTime = this.curTime.Copy();
            this.curTime = this.curTime.Add(dt);
            let remTime = new CharAnimTime();
            if (this.curTime > this.source.duration) {
                remTime = this.curTime.Sub(this.source.duration);
                this.curTime = this.source.duration;
            }

            this.UpdatePOIStates();

            let results = new AdvancementResults(remTime);

            const rootId = this.source.rootBone;
            let rb;
            if (this.source.HasRotation(rootId)) {
                const ra = this.source.GetRotation(rootId, prevTime);
                quat.conjugate(ra, ra);
                rb = this.source.GetRotation(rootId, this.curTime);
                quat.conjugate(rb, rb);
                quat.multiply(results.deltas.rotationDelta, rb, ra);
            }

            if (this.source.HasTranslation(rootId)) {
                const ta = this.source.GetTranslation(rootId, prevTime);
                const tb = this.source.GetTranslation(rootId, this.curTime);
                const tdelta = vec3.sub(/*recycle*/tb, tb, ta);
                if (rb)
                    vec3.transformQuat(results.deltas.translationDelta, tdelta, rb);
                else
                    results.deltas.translationDelta = tdelta;
            }

            if (this.source.HasScale(rootId)) {
                const sa = this.source.GetScale(rootId, prevTime);
                const sb = this.source.GetScale(rootId, this.curTime);
                vec3.sub(results.deltas.scaleDelta, sb, sa);
            }

            return results;
        }
    }

    public GetTimeRemaining(): CharAnimTime {
        return this.source.duration.Sub(this.curTime);
    }

    public GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[] {
        return this.source.GetPerSegmentData(indices, time ? time : this.curTime);
    }

    public Clone(): IAnimReader {
        return new AnimSourceReader(this.source, this.curTime);
    }
}

class StreamedAnimReaderTotals {
    private readonly cumulativeInts: Int32Array;
    private readonly cumulativeFloats: Float32Array;
    currentKey: number = 0;
    calculated: boolean = false;

    constructor(private source: AnimSourceCompressed) {
        // Rotation[W,X,Y,Z], Translation[X,Y,Z], Scale[X,Y,Z]
        this.cumulativeInts = new Int32Array(source.boneChannelCount * 10);
        this.cumulativeFloats = new Float32Array(source.boneChannelCount * 10);
        this.Initialize();
    }

    public Initialize() {
        this.currentKey = 0;
        this.calculated = false;

        for (let i = 0; i < this.source.boneChannelCount; ++i) {
            const cumulativeBase = i * 10;
            const channel = this.source.boneChannels[i];

            this.cumulativeInts[cumulativeBase] = 0;
            this.cumulativeInts[cumulativeBase + 1] = channel.rotation.initialX;
            this.cumulativeInts[cumulativeBase + 2] = channel.rotation.initialY;
            this.cumulativeInts[cumulativeBase + 3] = channel.rotation.initialZ;

            this.cumulativeInts[cumulativeBase + 4] = channel.translation.initialX;
            this.cumulativeInts[cumulativeBase + 5] = channel.translation.initialY;
            this.cumulativeInts[cumulativeBase + 6] = channel.translation.initialZ;

            this.cumulativeInts[cumulativeBase + 7] = channel.scale.initialX;
            this.cumulativeInts[cumulativeBase + 8] = channel.scale.initialY;
            this.cumulativeInts[cumulativeBase + 9] = channel.scale.initialZ;
        }
    }

    public IncrementInto(loader: BitLevelLoader, dest: StreamedAnimReaderTotals) {
        dest.calculated = false;

        for (let i = 0; i < this.source.boneChannelCount; ++i) {
            const cumulativeBase = i * 10;
            const channel = this.source.boneChannels[i];

            if (channel.rotation.keyCount) {
                dest.cumulativeInts[cumulativeBase] = loader.LoadBool() ? 1 : 0;
                dest.cumulativeInts[cumulativeBase + 1] =
                    this.cumulativeInts[cumulativeBase + 1] + loader.LoadSigned(channel.rotation.bitsX);
                dest.cumulativeInts[cumulativeBase + 2] =
                    this.cumulativeInts[cumulativeBase + 2] + loader.LoadSigned(channel.rotation.bitsY);
                dest.cumulativeInts[cumulativeBase + 3] =
                    this.cumulativeInts[cumulativeBase + 3] + loader.LoadSigned(channel.rotation.bitsZ);
            }

            if (channel.translation.keyCount) {
                dest.cumulativeInts[cumulativeBase + 4] =
                    this.cumulativeInts[cumulativeBase + 4] + loader.LoadSigned(channel.translation.bitsX);
                dest.cumulativeInts[cumulativeBase + 5] =
                    this.cumulativeInts[cumulativeBase + 5] + loader.LoadSigned(channel.translation.bitsY);
                dest.cumulativeInts[cumulativeBase + 6] =
                    this.cumulativeInts[cumulativeBase + 6] + loader.LoadSigned(channel.translation.bitsZ);
            }

            if (channel.scale.keyCount) {
                dest.cumulativeInts[cumulativeBase + 7] =
                    this.cumulativeInts[cumulativeBase + 7] + loader.LoadSigned(channel.scale.bitsX);
                dest.cumulativeInts[cumulativeBase + 8] =
                    this.cumulativeInts[cumulativeBase + 8] + loader.LoadSigned(channel.scale.bitsY);
                dest.cumulativeInts[cumulativeBase + 9] =
                    this.cumulativeInts[cumulativeBase + 9] + loader.LoadSigned(channel.scale.bitsZ);
            }
        }

        dest.currentKey = this.currentKey + 1;
    }

    public CalculateDown() {
        const rq = Math.PI / 2.0 / this.source.rotationDiv;
        const tq = this.source.translationMult;
        const sq = this.source.scaleMult ? this.source.scaleMult : 0.0;

        for (let i = 0; i < this.source.boneChannelCount; ++i) {
            const cumulativeBase = i * 10;
            const channel = this.source.boneChannels[i];

            if (channel.rotation.keyCount) {
                this.cumulativeFloats[cumulativeBase + 1] = Math.sin(this.cumulativeInts[cumulativeBase + 1] * rq);
                this.cumulativeFloats[cumulativeBase + 2] = Math.sin(this.cumulativeInts[cumulativeBase + 2] * rq);
                this.cumulativeFloats[cumulativeBase + 3] = Math.sin(this.cumulativeInts[cumulativeBase + 3] * rq);

                this.cumulativeFloats[cumulativeBase] =
                    Math.sqrt(Math.max(1.0 - (
                        this.cumulativeFloats[cumulativeBase + 1] ** 2 +
                        this.cumulativeFloats[cumulativeBase + 2] ** 2 +
                        this.cumulativeFloats[cumulativeBase + 3] ** 2), 0.0));
                if (this.cumulativeInts[cumulativeBase])
                    this.cumulativeFloats[cumulativeBase] = -this.cumulativeFloats[cumulativeBase];
            }

            if (channel.translation.keyCount) {
                this.cumulativeFloats[cumulativeBase + 4] = this.cumulativeInts[cumulativeBase + 4] * tq;
                this.cumulativeFloats[cumulativeBase + 5] = this.cumulativeInts[cumulativeBase + 5] * tq;
                this.cumulativeFloats[cumulativeBase + 6] = this.cumulativeInts[cumulativeBase + 6] * tq;
            }

            if (channel.scale.keyCount) {
                this.cumulativeFloats[cumulativeBase + 7] = this.cumulativeInts[cumulativeBase + 7] * sq;
                this.cumulativeFloats[cumulativeBase + 8] = this.cumulativeInts[cumulativeBase + 8] * sq;
                this.cumulativeFloats[cumulativeBase + 9] = this.cumulativeInts[cumulativeBase + 9] * sq;
            }
        }

        this.calculated = true;
    }

    public GetRotation(idx: number): quat {
        const base = idx * 10;
        return quat.fromValues(
            this.cumulativeFloats[base + 1],
            this.cumulativeFloats[base + 2],
            this.cumulativeFloats[base + 3],
            this.cumulativeFloats[base]);
    }

    public GetTranslation(idx: number): vec3 {
        const base = idx * 10 + 4;
        return vec3.fromValues(
            this.cumulativeFloats[base],
            this.cumulativeFloats[base + 1],
            this.cumulativeFloats[base + 2]);
    }

    public GetScale(idx: number): vec3 {
        const base = idx * 10 + 7;
        return vec3.fromValues(
            this.cumulativeFloats[base],
            this.cumulativeFloats[base + 1],
            this.cumulativeFloats[base + 2]);
    }
}

class StreamedPairOfTotals {
    private flip: boolean = true;
    private readonly a: StreamedAnimReaderTotals;
    private readonly b: StreamedAnimReaderTotals;
    private t: number = 0.0;

    constructor(private source: AnimSourceCompressed) {
        this.a = new StreamedAnimReaderTotals(source);
        this.b = new StreamedAnimReaderTotals(source);
    }

    private get prior(): StreamedAnimReaderTotals {
        return this.flip ? this.a : this.b;
    }

    private get next(): StreamedAnimReaderTotals {
        return this.flip ? this.b : this.a;
    }

    public SetTime(loader: BitLevelLoader, time: CharAnimTime) {
        let priorTime = new CharAnimTime();
        let curTime = new CharAnimTime();

        let prior = -1;
        let next = -1;
        let cur = 0;
        for (let i = 0; i < this.source.bitmapBitCount; ++i) {
            const word = (i / 32) >>> 0;
            const bit = (i % 32) >>> 0;
            if ((this.source.bitmapWords[word] >>> bit) & 1) {
                if (curTime.LessEqual(time)) {
                    prior = cur;
                    priorTime = curTime;
                } else if (curTime.Greater(time)) {
                    next = cur;
                    if (prior === -1) {
                        prior = cur;
                        priorTime = curTime;
                        this.t = 0.0;
                    } else {
                        this.t = time.Sub(priorTime).Div(curTime.Sub(priorTime));
                    }

                    break;
                }
                ++cur;
            }
            curTime = curTime.Add(new CharAnimTime(this.source.interval));
        }

        if (prior !== -1 && prior < this.prior.currentKey) {
            this.prior.Initialize();
            this.next.Initialize();
            loader.Reset();
        }

        if (next !== -1) {
            while (next > this.next.currentKey) {
                this.flip = !this.flip;
                this.prior.IncrementInto(loader, this.next);
            }
        }

        if (!this.prior.calculated)
            this.prior.CalculateDown();
        if (!this.next.calculated)
            this.next.CalculateDown();
    }

    public GetRotation(idx: number): quat {
        const quatA = this.prior.GetRotation(idx);
        const quatB = this.next.GetRotation(idx);
        return quat.slerp(quat.create(), quatA, quatB, this.t);
    }

    public GetTranslation(idx: number): vec3 {
        const transA = this.prior.GetTranslation(idx);
        const transB = this.next.GetTranslation(idx);
        return vec3.lerp(vec3.create(), transA, transB, this.t);
    }

    public GetScale(idx: number): vec3 {
        const scaleA = this.prior.GetScale(idx);
        const scaleB = this.next.GetScale(idx);
        return vec3.lerp(vec3.create(), scaleA, scaleB, this.t);
    }
}

class BitLevelLoader {
    private bitIdx: number = 0;

    constructor(private data: Uint32Array) {
    }

    public Reset() {
        this.bitIdx = 0;
    }

    public LoadSigned(q: number): number {
        const wordCur = (this.bitIdx / 32) >>> 0;
        const bitRem = (this.bitIdx % 32) >>> 0;

        /* Fill 32 bit buffer with region containing bits */
        /* Make them least significant */
        let tempBuf = this.data[wordCur] >>> bitRem;

        /* If this shift underflows the value, buffer the next 32 bits */
        /* And tack onto shifted buffer */
        if ((bitRem + q) > 32)
            tempBuf |= this.data[wordCur + 1] << (32 - bitRem);

        /* Sign extend */
        tempBuf = tempBuf << (32 - q) >> (32 - q);

        /* Return delta value */
        this.bitIdx += q;
        return tempBuf;
    }

    public LoadBool(): boolean {
        const wordCur = (this.bitIdx / 32) >>> 0;
        const bitRem = (this.bitIdx % 32) >>> 0;

        /* Fill 32 bit buffer with region containing bits */
        /* Make them least significant */
        const tempBuf = this.data[wordCur] >>> bitRem;

        /* That's it */
        this.bitIdx += 1;
        return (tempBuf & 0x1) !== 0;
    }
}

class SegIdToIndexConverter {
    indices: Int32Array;

    constructor(source: AnimSourceCompressed) {
        this.indices = new Int32Array(100);
        this.indices.fill(-1);
        for (let b = 0; b < source.boneChannelCount; ++b) {
            const channel = source.boneChannels[b];
            if (channel.boneId >= 100)
                continue;
            this.indices[channel.boneId] = b;
        }
    }

    public SegIdToIndex(seg: number): number | undefined {
        const idx = this.indices[seg];
        return idx !== -1 ? idx : undefined;
    }
}

export class AnimSourceReaderCompressed extends AnimSourceReaderBase {
    private totals: StreamedPairOfTotals;
    private readonly bitLoader: BitLevelLoader;
    private segIdToIndex: SegIdToIndexConverter;

    constructor(private source: AnimSourceCompressed, time: CharAnimTime) {
        super(new SteadyStateAnimInfo(
            new CharAnimTime(source.duration), vec3.create(), source.looping), source.GetPOIData(), time);
        this.totals = new StreamedPairOfTotals(source);
        this.bitLoader = new BitLevelLoader(source.bitstreamWords);
        this.segIdToIndex = new SegIdToIndexConverter(source);
        this.totals.SetTime(this.bitLoader, time);
        this.PostConstruct(time);
    }

    private HasRotation(seg: number): boolean {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return false;
        return this.source.boneChannels[idx].rotation.keyCount !== 0;
    }

    private HasTranslation(seg: number): boolean {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return false;
        return this.source.boneChannels[idx].translation.keyCount !== 0;
    }

    private HasScale(seg: number): boolean {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return false;
        return this.source.boneChannels[idx].scale.keyCount !== 0;
    }

    private GetRotation(seg: number): quat {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return quat.create();
        return this.totals.GetRotation(idx);
    }

    private GetTranslation(seg: number): vec3 {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return vec3.create();
        return this.totals.GetTranslation(idx);
    }

    private GetScale(seg: number): vec3 {
        const idx = this.segIdToIndex.SegIdToIndex(seg);
        if (idx === undefined)
            return vec3.create();
        return this.totals.GetScale(idx);
    }

    public AdvanceView(dt: CharAnimTime): AdvancementResults {
        const animDur = new CharAnimTime(this.source.duration);
        if (this.curTime.Equals(animDur)) {
            this.curTime = new CharAnimTime();
            this.passedBoolIdx = 0;
            this.passedIntIdx = 0;
            this.passedParticleIdx = 0;
            this.passedSoundIdx = 0;
            return { remTime: dt, deltas: new AdvancementDeltas() };
        } else if (dt.EqualsZero()) {
            return { remTime: new CharAnimTime(), deltas: new AdvancementDeltas() };
        } else {
            let results = new AdvancementResults();
            const rootId = this.source.rootBone;

            const priorQ = this.GetRotation(rootId);
            const priorV = this.GetTranslation(rootId);
            const priorS = this.GetScale(rootId);

            this.curTime = this.curTime.Add(dt);
            let overTime = new CharAnimTime();
            if (this.curTime.Greater(animDur)) {
                overTime = this.curTime.Sub(animDur);
                this.curTime = animDur;
            }

            this.totals.SetTime(this.bitLoader, this.curTime);
            this.UpdatePOIStates();

            const nextQ = this.GetRotation(rootId);
            const nextV = this.GetTranslation(rootId);
            const nextS = this.GetScale(rootId);

            results.remTime = overTime;
            if (this.HasRotation(rootId))
                quat.mul(results.deltas.rotationDelta, nextQ, quat.conjugate(/*recycle*/priorQ, priorQ));
            if (this.HasTranslation(rootId))
                vec3.transformQuat(results.deltas.translationDelta,
                    vec3.sub(/*recycle*/nextV, nextV, priorV), quat.conjugate(/*recycle*/nextQ, nextQ));
            if (this.HasScale(rootId))
                vec3.sub(results.deltas.scaleDelta, nextS, priorS);

            return results;
        }
    }

    public GetTimeRemaining(): CharAnimTime {
        return new CharAnimTime(this.source.duration).Sub(this.curTime);
    }

    public GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[] {
        let ret = new Array(indices.length);
        this.totals.SetTime(this.bitLoader, time ? time : this.curTime);

        for (let i = 0; i < indices.length; ++i) {
            const seg = indices[i];
            const rotation = this.HasRotation(seg) ? this.GetRotation(seg) : null;
            const translation = this.HasTranslation(seg) ? this.GetTranslation(seg) : null;
            const scale = this.HasScale(seg) ? this.GetScale(seg) : null;
            ret[i] = new PerSegmentData(rotation, translation, scale);
        }

        return ret;
    }

    public override SetPhase(phase: number) {
        super.SetPhase(phase);
        this.totals.SetTime(this.bitLoader, this.curTime);
    }

    public Clone(): IAnimReader {
        return new AnimSourceReaderCompressed(this.source, this.curTime);
    }
}
