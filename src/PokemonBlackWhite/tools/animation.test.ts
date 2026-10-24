import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mat2d } from 'gl-matrix';
import { calcTexMtx } from '../../nns_g3d/NNS_G3D.js';
import { sampleTextureTrack } from '../nsbta.js';
import ArrayBufferSlice from '../../ArrayBufferSlice.js';
import AnimationController from '../../AnimationController.js';
import { BWAnimationController, TextureMatrixAnimator, TexturePatternAnimator } from '../animation.js';
import { sampleJointAnimation } from '../nsbca.js';
import { archiveNames, GameVersion, loadWorld } from '../world.js';

const root = resolve(process.argv[2] ?? 'data/PokemonBlackWhite/White');
const version: GameVersion = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')).version;
assert(version === 'Black' || version === 'White');
const data = archiveNames.map((name) => {
    const b = readFileSync(resolve(root, name));
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
});
const world = loadWorld(data, -1, 0, version);
const oldClock = new AnimationController(30), clock = new BWAnimationController();
for (const refreshRate of [30, 60, 144]) {
    for (let i = 0; i <= refreshRate; i++) clock.setTimeInMilliseconds(i * 1000 / refreshRate);
    assert.equal(clock.getTimeInFrames(), 15);
}
let patterns = 0, matrices = 0, joints = 0;
for (const time of [0, 125, 1000, 3750, 10000, 10000, -500]) {
    clock.setTimeInMilliseconds(time);
    oldClock.setTimeInMilliseconds(time / 2);
    for (const object of world.objects) {
        if (object.pat) for (const entry of object.pat.entries) {
            assert.equal(new TexturePatternAnimator(clock, object.pat, entry).calcFullTextureName(),
                new TexturePatternAnimator(oldClock, object.pat, entry).calcFullTextureName());
            patterns++;
        }
        if (object.srt) for (const entry of object.srt.entries) {
            const actual = mat2d.create(), expected = mat2d.create();
            new TextureMatrixAnimator(clock, object.srt, entry).calcTexMtx(actual, object.model.texMtxMode, 1, 1);
            new TextureMatrixAnimator(oldClock, object.srt, entry).calcTexMtx(expected, object.model.texMtxMode, 1, 1);
            assert.deepEqual(actual, expected);
            matrices++;
        }
        if (object.joint) {
            assert.deepEqual(sampleJointAnimation(object.joint, object.model, clock.getTimeInFrames()),
                sampleJointAnimation(object.joint, object.model, oldClock.getTimeInFrames()));
            joints++;
        }
    }
}
assert(patterns > 0 && matrices > 0 && joints > 0);
console.log(JSON.stringify({ patterns, matrices, joints, playback: 'half speed', refreshRates: [30, 60, 144], pauseAndReverse: 'passed' }));

clock.setTimeInMilliseconds(1000);
for (const header of [62, 64]) {
    const scene = loadWorld(data, header, 0, version);
    const prefix = header === 62 ? 'c07' : 'c36';
    const object = scene.objects.find((o) => o.srt?.entries.some((e) => e.name === `${prefix}_foun_01`))!;
    assert(object);
    for (const [suffix, frame] of [['01', 7.5], ['02', 15], ['03', 15]] as const) {
        const entry = object.srt!.entries.find((e) => e.name === `${prefix}_foun_${suffix}`)!;
        assert(entry);
        const actual = mat2d.create(), expected = mat2d.create();
        new TextureMatrixAnimator(clock, object.srt!, entry).calcTexMtx(actual, object.model.texMtxMode, 1, 1);
        const angle = sampleTextureTrack(entry.rot, frame, true);
        calcTexMtx(expected, object.model.texMtxMode, 1, 1,
            sampleTextureTrack(entry.scaleS, frame), sampleTextureTrack(entry.scaleT, frame),
            Math.sin(angle), Math.cos(angle), sampleTextureTrack(entry.transS, frame), sampleTextureTrack(entry.transT, frame));
        assert.deepEqual(actual, expected);
    }
}
console.log('Nimbasa fountain ripples slowed independently; spray and jets retain their existing rate.');
