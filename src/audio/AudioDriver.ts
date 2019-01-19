
import { nArray } from "../util";

interface AudioSynth {
    getSampleRate(): number;
    fillSamples(deltaTime: number, buffer: AudioBuffer): void;
}

export class AudioDriverImplBufferSource {
    public running: boolean = false;
    private bufferSize = 8192;
    private numChannels = 2;

    private ctx: AudioContext;

    // Ring buffer of audio buffers that we should use.
    private audioBuffersWP: number = 0;
    private audioBuffers: AudioBuffer[] = [];

    // The time that our currently playing BufferSources will "run out"
    private playEndTime: number;
    private timePerBuffer: number;

    private sampleRate: number;

    constructor(private synth: AudioSynth) {
        this.sampleRate = synth.getSampleRate();
        this.ctx = new AudioContext({ sampleRate: this.sampleRate });
        this.timePerBuffer = this.bufferSize / this.sampleRate;

        // TODO(jstpierre): Dynamically calculate this?
        const NUM_BUFFERS = 4;
        this.audioBuffers = nArray(NUM_BUFFERS, () => this.ctx.createBuffer(this.numChannels, this.bufferSize, this.sampleRate));
    }

    public start() {
        this.running = true;
        this.playEndTime = this.ctx.currentTime;
        this.pumpAudio();
    }

    public stop() {
        this.running = false;
    }

    private onBSEnded = () => {
        this.pumpAudio();
    };

    private pumpBS() {
        this.audioBuffersWP = (this.audioBuffersWP + 1) % this.audioBuffers.length;

        const buffer = this.audioBuffers[this.audioBuffersWP];
        // Fill the buffer up from our audio source.
        this.synth.fillSamples(this.timePerBuffer, buffer);

        // TODO(jstpierre): take out the garbage
        const bs = this.ctx.createBufferSource();
        bs.buffer = buffer;
        bs.onended = this.onBSEnded;
        bs.connect(this.ctx.destination);
        bs.start(this.playEndTime);
        this.playEndTime += this.timePerBuffer;
    }

    private pumpAudio() {
        if (!this.running)
            return;

        // Schedule with some amount of latency.
        const latency = 300 / 1000;
        const delta = this.playEndTime - this.ctx.currentTime;
        while (delta < latency)
            this.pumpBS();
    }
}
