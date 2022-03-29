import * as Viewer from '../viewer';
import { SuperMonkeyBallSceneDesc } from './scene';
import { StageId } from './stageInfo';

const id = 'supermonkeyball'
const name = 'Super Monkey Ball'

const sceneDescs = [
    'Jungle',
    new SuperMonkeyBallSceneDesc(StageId.St001_Plain, 'Beginner 01 - Plain'),
    new SuperMonkeyBallSceneDesc(StageId.St002_Diamond, 'Beginner 02 - Diamond'),
    new SuperMonkeyBallSceneDesc(StageId.St003_Hairpin, 'Beginner 03 - Hairpin'),
    new SuperMonkeyBallSceneDesc(StageId.St004_WideBridge, 'Beginner 04 - Wide Bridge'),
    'Sunset',
    new SuperMonkeyBallSceneDesc(StageId.St005_Slopes, 'Beginner 06 - Slopes'),
    new SuperMonkeyBallSceneDesc(StageId.St006_Steps, 'Beginner 07 - Steps'),
    new SuperMonkeyBallSceneDesc(StageId.St007_Blocks, 'Beginner 08 - Blocks'),
    new SuperMonkeyBallSceneDesc(StageId.St008_JumpSingle, 'Beginner 09 - Jump Single'),
    new SuperMonkeyBallSceneDesc(StageId.St009_ExamA, 'Beginner 10 - Exam-A'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
