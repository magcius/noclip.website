import { CharAnimTime } from './char_anim_time';
import { quat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { InputStream } from '../stream';
import { PART } from '../part';
import { ResourceGame, ResourceSystem } from '../resource';
import { ELSC } from '../elsc';
import { SWHC } from '../swhc';

export class AdvancementDeltas {
    constructor(public translationDelta: vec3 = vec3.create(),
                public rotationDelta: quat = quat.create(),
                public scaleDelta: vec3 = vec3.create()) {
    }

    public static Blend(a: AdvancementDeltas, b: AdvancementDeltas, t: number): AdvancementDeltas {
        return new AdvancementDeltas(
            vec3.lerp(vec3.create(), a.translationDelta, b.translationDelta, t),
            quat.lerp(quat.create(), a.rotationDelta, b.rotationDelta, t),
            vec3.lerp(vec3.create(), a.scaleDelta, b.scaleDelta, t));
    }

    public static Interpolate(a: AdvancementDeltas, b: AdvancementDeltas, wa: number, wb: number): AdvancementDeltas {
        return AdvancementDeltas.Blend(a, b, (wa + wb) * 0.5);
    }
}

export class AdvancementResults {
    constructor(public remTime: CharAnimTime = new CharAnimTime(0),
                public deltas: AdvancementDeltas = new AdvancementDeltas()) {
    }
}

export class DoubleChildAdvancementResults {
    constructor(public trueAdvancement: CharAnimTime = new CharAnimTime(0),
                public leftDeltas: AdvancementDeltas = new AdvancementDeltas(),
                public rightDeltas: AdvancementDeltas = new AdvancementDeltas()) {
    }
}

export class PerSegmentData {
    constructor(public rotation: quat | null,
                public translation: vec3 | null,
                public scale: vec3 | null) {
    }
}

export class SteadyStateAnimInfo {
    constructor(public duration: CharAnimTime,
                public offset: ReadonlyVec3,
                public looping: boolean) {
    }
}

export enum POIType {
    Loop = 0,
    EmptyBool = 1,
    EmptyInt32 = 2,
    SoundInt32 = 4,
    Particle = 5,
    UserEvent = 6,
    RandRate = 7,
    Sound = 8
}

export interface POIKey {
    name: string;
    index: number;
}

export abstract class POINode {
    protected constructor(protected name: string,
                          protected type: POIType,
                          protected time: CharAnimTime,
                          protected index: number,
                          protected unique: boolean,
                          protected weight: number,
                          protected charIdx: number,
                          protected flags: number) {
    }

    protected FromStream(input: InputStream) {
        input.readUint16();
        this.name = input.readString();
        this.type = input.readUint16();
        this.time = CharAnimTime.FromStream(input);
        this.index = input.readInt32();
        this.unique = input.readBool();
        this.weight = input.readFloat32();
        this.charIdx = input.readInt32();
        this.flags = input.readInt32();
    }

    public GetString(): string { return this.name; }
    public GetTime(): CharAnimTime { return this.time; }
    public SetTime(time: CharAnimTime) { this.time = time; }
    public GetPoiType(): POIType { return this.type; }
    public GetIndex(): number { return this.index; }
    public GetUnique(): boolean { return this.unique; }
    public GetWeight(): number { return this.weight; }
    public GetCharacterIndex(): number { return this.charIdx; }
    public GetFlags(): number { return this.flags; }

    public GetKey(): POIKey {
        return { name: this.name, index: this.index };
    }

    public abstract Copy(): POINode;
    public CopyNodeMinusStartTime(startTime: CharAnimTime): POINode {
        const ret = this.Copy();
        ret.time = ret.time.Sub(startTime);
        return ret;
    }
}

export class BoolPOINode extends POINode {
    constructor(name: string = 'root',
                type: POIType = POIType.EmptyBool,
                time: CharAnimTime = new CharAnimTime(),
                index: number = -1,
                unique: boolean = false,
                weight: number = 1.0,
                charIdx: number = -1,
                flags: number = 0,
                private value: boolean = false) {
        super(name, type, time, index, unique, weight, charIdx, flags);
    }

    public static FromStream(input: InputStream): BoolPOINode {
        const ret = new BoolPOINode();
        ret.FromStream(input);
        ret.value = input.readBool();
        return ret;
    }

    public GetValue(): boolean { return this.value; }

    public Copy(): BoolPOINode {
        return new BoolPOINode(this.name, this.type, this.time, this.index, this.unique, this.weight, this.charIdx, this.flags, this.value);
    }
}

export class Int32POINode extends POINode {
    constructor(name: string = '',
                type: POIType = POIType.EmptyInt32,
                time: CharAnimTime = new CharAnimTime(),
                index: number = -1,
                unique: boolean = false,
                weight: number = 1.0,
                charIdx: number = -1,
                flags: number = 0,
                private value: number = 0,
                private locatorName: string = 'root') {
        super(name, type, time, index, unique, weight, charIdx, flags);
    }

    public static FromStream(input: InputStream): Int32POINode {
        const ret = new Int32POINode();
        ret.FromStream(input);
        ret.value = input.readUint32();
        ret.locatorName = input.readString();
        return ret;
    }

    public GetValue(): number { return this.value; }
    public GetLocatorName(): string { return this.locatorName; }

    public Copy(): Int32POINode {
        return new Int32POINode(this.name, this.type, this.time, this.index, this.unique, this.weight, this.charIdx, this.flags, this.value, this.locatorName);
    }
}

export enum ParentedMode {
    Initial,
    ContinuousEmitter,
    ContinuousSystem
}

export class ParticleData {
    constructor(private duration: number = 0,
                private particleFourCC: string = '',
                private particleAssetId: string = '',
                private particle: PART | SWHC | ELSC | null = null,
                private boneName: string | number = 'root',
                private scale: number = 1.0,
                private parentedMode: ParentedMode = ParentedMode.Initial) {
    }

    public FromStream(input: InputStream, resourceSystem: ResourceSystem) {
        this.duration = input.readUint32();
        this.particleFourCC = input.readFourCC();
        this.particleAssetId = input.readAssetID();
        if (this.particleFourCC === 'PART' || this.particleFourCC === 'SWHC' || this.particleFourCC === 'ELSC')
            this.particle = resourceSystem.loadAssetByID<PART | SWHC | ELSC>(this.particleAssetId, this.particleFourCC);
        this.boneName = resourceSystem.game === ResourceGame.MP2 ? input.readUint32() : input.readString();
        this.scale = input.readFloat32();
        this.parentedMode = input.readUint32();
    }

    public GetDuration(): number { return this.duration; }
    public GetParticleAssetFourCC(): string { return this.particleFourCC; }
    public GetParticleAssetId(): string { return this.particleAssetId; }
    public GetParticleDescription(): PART | SWHC | ELSC | null { return this.particle; }
    public GetSegmentName(): string | number { return this.boneName; }
    public GetScale(): number { return this.scale; }
    public GetParentedMode(): ParentedMode { return this.parentedMode; }
}

export class ParticlePOINode extends POINode {
    constructor(name: string = 'root',
                type: POIType = POIType.Particle,
                time: CharAnimTime = new CharAnimTime(),
                index: number = -1,
                unique: boolean = false,
                weight: number = 1.0,
                charIdx: number = -1,
                flags: number = 0,
                private particleData: ParticleData = new ParticleData()) {
        super(name, type, time, index, unique, weight, charIdx, flags);
    }

    public static FromStream(input: InputStream, resourceSystem: ResourceSystem): ParticlePOINode {
        const ret = new ParticlePOINode();
        ret.FromStream(input);
        ret.particleData.FromStream(input, resourceSystem);
        return ret;
    }

    public GetParticleData(): ParticleData { return this.particleData; }

    public Copy(): ParticlePOINode {
        return new ParticlePOINode(this.name, this.type, this.time, this.index, this.unique, this.weight, this.charIdx, this.flags, this.particleData);
    }
}

export class SoundPOINode extends POINode {
    constructor(name: string = '',
                type: POIType = POIType.EmptyInt32,
                time: CharAnimTime = new CharAnimTime(),
                index: number = -1,
                unique: boolean = false,
                weight: number = 1.0,
                charIdx: number = -1,
                flags: number = 0,
                private sfxId: number = 0,
                private falloff: number = 0,
                private maxDist: number = 0) {
        super(name, type, time, index, unique, weight, charIdx, flags);
    }

    public static FromStream(input: InputStream, resourceSystem: ResourceSystem): SoundPOINode {
        const ret = new SoundPOINode();
        ret.FromStream(input);
        ret.sfxId = input.readUint32();
        ret.falloff = input.readFloat32();
        ret.maxDist = input.readFloat32();
        if (resourceSystem.game === ResourceGame.MP2) {
            input.readUint32();
            input.readUint16();
            input.readUint16();
            input.readFloat32();
        }
        return ret;
    }

    public GetSfxId(): number { return this.sfxId; }
    public GetFalloff(): number { return this.falloff; }
    public GetMaxDist(): number { return this.maxDist; }

    public Copy(): SoundPOINode {
        return new SoundPOINode(this.name, this.type, this.time, this.index, this.unique, this.weight, this.charIdx, this.flags, this.sfxId, this.falloff, this.maxDist);
    }
}

/**
 * Basis of intermediate tree nodes and animation source readers (ANIM resource reader)
 */
export abstract class IAnimReader {
    public abstract AdvanceView(dt: CharAnimTime): AdvancementResults;

    public abstract GetTimeRemaining(): CharAnimTime;

    public abstract GetSteadyStateAnimInfo(): SteadyStateAnimInfo;

    public abstract GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[];

    public abstract SetPhase(phase: number): void;

    public abstract VGetBoolPOIList(time: CharAnimTime, listOut: BoolPOINode[], capacity: number, iterator: number): number;
    public GetBoolPOIList(time: CharAnimTime, listOut: BoolPOINode[], capacity: number, iterator: number): number {
        if (time.GreaterThanZero())
            return this.VGetBoolPOIList(time, listOut, capacity, iterator);
        return 0;
    }
    public abstract VGetInt32POIList(time: CharAnimTime, listOut: Int32POINode[], capacity: number, iterator: number): number;
    public GetInt32POIList(time: CharAnimTime, listOut: Int32POINode[], capacity: number, iterator: number): number {
        if (time.GreaterThanZero())
            return this.VGetInt32POIList(time, listOut, capacity, iterator);
        return 0;
    }
    public abstract VGetParticlePOIList(time: CharAnimTime, listOut: ParticlePOINode[], capacity: number, iterator: number): number;
    public GetParticlePOIList(time: CharAnimTime, listOut: ParticlePOINode[], capacity: number, iterator: number): number {
        if (time.GreaterThanZero())
            return this.VGetParticlePOIList(time, listOut, capacity, iterator);
        return 0;
    }
    public abstract VGetSoundPOIList(time: CharAnimTime, listOut: SoundPOINode[], capacity: number, iterator: number): number;
    public GetSoundPOIList(time: CharAnimTime, listOut: SoundPOINode[], capacity: number, iterator: number): number {
        if (time.GreaterThanZero())
            return this.VGetSoundPOIList(time, listOut, capacity, iterator);
        return 0;
    }

    public abstract Clone(): IAnimReader;

    /**
     * Periodically called to cull out completed transition nodes
     */
    public Simplified(): IAnimReader | null {
        return null;
    }
}
