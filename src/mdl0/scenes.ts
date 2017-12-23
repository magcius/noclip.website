
import { SceneGroup } from '../viewer';
import { SceneDesc } from './render';

const name = "Sonic Mania";
const sceneDescs: SceneDesc[] = [
    'Meshes/Continue/Count0.bin',
    'Meshes/Continue/Count1.bin',
    'Meshes/Continue/Count2.bin',
    'Meshes/Continue/Count3.bin',
    'Meshes/Continue/Count4.bin',
    'Meshes/Continue/Count5.bin',
    'Meshes/Continue/Count6.bin',
    'Meshes/Continue/Count7.bin',
    'Meshes/Continue/Count8.bin',
    'Meshes/Continue/Count9.bin',
    'Meshes/Decoration/Bird.bin',
    'Meshes/Decoration/Fish.bin',
    'Meshes/Decoration/Flower1.bin',
    'Meshes/Decoration/Flower2.bin',
    'Meshes/Decoration/Flower3.bin',
    'Meshes/Decoration/Pillar1.bin',
    'Meshes/Decoration/Pillar2.bin',
    'Meshes/Decoration/Tree.bin',
    'Meshes/Global/Sonic.bin',
    'Meshes/Global/SpecialRing.bin',
    'Meshes/Special/EmeraldBlue.bin',
    'Meshes/Special/EmeraldCyan.bin',
    'Meshes/Special/EmeraldGreen.bin',
    'Meshes/Special/EmeraldGrey.bin',
    'Meshes/Special/EmeraldPurple.bin',
    'Meshes/Special/EmeraldRed.bin',
    'Meshes/Special/EmeraldYellow.bin',
    'Meshes/Special/ItemBox.bin',
    'Meshes/Special/KnuxBall.bin',
    'Meshes/Special/KnuxDash.bin',
    'Meshes/Special/KnuxJog.bin',
    'Meshes/Special/KnuxJump.bin',
    'Meshes/Special/KnuxTumble.bin',
    'Meshes/Special/Shadow.bin',
    'Meshes/Special/SonicBall.bin',
    'Meshes/Special/SonicDash.bin',
    'Meshes/Special/SonicJog.bin',
    'Meshes/Special/SonicJump.bin',
    'Meshes/Special/SonicTumble.bin',
    'Meshes/Special/Springboard.bin',
    'Meshes/Special/TailsBall.bin',
    'Meshes/Special/TailsDash.bin',
    'Meshes/Special/TailsJog.bin',
    'Meshes/Special/TailsJump.bin',
    'Meshes/Special/TailsTumble.bin',
    'Meshes/Special/UFOChase.bin',
    'Meshes/SSZ/EggTower.bin',
    'Meshes/TMZ/MonarchBG.bin',
    'Meshes/TMZ/OrbNet.bin',
].map((filename): SceneDesc => {
    const path = `data/mdl0/${filename}`;
    const name = filename;
    return new SceneDesc(name, path);
});

export const sceneGroup: SceneGroup = { name, sceneDescs };
