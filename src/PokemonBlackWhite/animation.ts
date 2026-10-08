import { mat2d } from 'gl-matrix';
import AnimationController from '../AnimationController.js';
import { PAT0, SRT0, TexMtxMode, calcTexMtx } from '../nns_g3d/NNS_G3D.js';
import { sampleTextureTrack } from './nsbta.js';

export class BWAnimationController extends AnimationController {
    constructor() {
        super(15);
    }
}

export class TextureMatrixAnimator {
    private playbackRate: number;

    constructor(private controller: AnimationController, private animation: SRT0, private entry: SRT0['entries'][number]) {
        this.playbackRate = entry.name === 'c07_foun_01' || entry.name === 'c36_foun_01' ? 0.5 : 1;
    }
    public calcTexMtx(dst: mat2d, mode: TexMtxMode, scaleS: number, scaleT: number): void {
        const frame = ((this.controller.getTimeInFrames() * this.playbackRate % this.animation.duration) + this.animation.duration) % this.animation.duration, e = this.entry;
        const angle = sampleTextureTrack(e.rot, frame, true);
        calcTexMtx(dst, mode, scaleS, scaleT, sampleTextureTrack(e.scaleS, frame), sampleTextureTrack(e.scaleT, frame),
            Math.sin(angle), Math.cos(angle), sampleTextureTrack(e.transS, frame), sampleTextureTrack(e.transT, frame));
    }
}

export class TexturePatternAnimator {
    constructor(private controller: AnimationController, private animation: PAT0, public matData: PAT0['entries'][number]) {}
    public calcFullTextureName(): string {
        const frame = ((this.controller.getTimeInFrames() % this.animation.duration) + this.animation.duration) % this.animation.duration;
        const track = this.matData.animationTrack;
        let i = 0;
        while (i + 1 < track.length && track[i + 1].frame <= frame) i++;
        return track[i].fullTextureName;
    }
}
