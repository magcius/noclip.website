import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import { ToontownResourceLoader } from "./resources";

interface Player {
  ctx: AudioContext;
  gainNode: GainNode;
  synth: WorkletSynthesizer;
  sequencer: Sequencer;
}

let player: Player | null = null;
let currentVolume = 0.5;

async function init(loader: ToontownResourceLoader): Promise<Player> {
  if (player) return player;
  const sfont = await loader.loadFile("gm3.sf2");
  const ctx = new AudioContext();
  const gainNode = ctx.createGain();
  gainNode.gain.value = currentVolume;
  gainNode.connect(ctx.destination);
  await ctx.audioWorklet.addModule(
    new URL(
      "spessasynth_lib/dist/spessasynth_processor.min.js",
      import.meta.url,
    ),
  );
  const synth = new WorkletSynthesizer(ctx);
  synth.connect(gainNode);
  await synth.soundBankManager.addSoundBank(
    sfont.arrayBuffer as ArrayBuffer,
    "main",
  );
  const sequencer = new Sequencer(synth, {
    skipToFirstNoteOn: false,
  });
  sequencer.loopCount = Infinity;
  player = { ctx, gainNode, synth, sequencer };
  return player;
}

export async function startPlayback(
  loader: ToontownResourceLoader,
  musicFile: string,
) {
  const player = await init(loader);
  await player.synth.isReady;
  await player.ctx.resume();
  const midiData = await loader.loadFile(musicFile);
  player.sequencer.loadNewSongList([
    {
      binary: midiData.arrayBuffer as ArrayBuffer,
    },
  ]);
  player.sequencer.play();
}

export function stopPlayback() {
  if (!player) return;
  player.sequencer.pause();
}

export function setVolume(volume: number) {
  currentVolume = volume;
  if (!player) return;
  player.gainNode.gain.value = volume;
}

export function getVolume(): number {
  if (!player) return currentVolume;
  return player.gainNode.gain.value;
}
