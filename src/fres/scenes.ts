
import { SceneGroup } from '../viewer';
import { SceneDesc } from './render';

const name = "BFRES";
const id = "fres";
const sceneDescs: SceneDesc[] = [
    'data/spl/Fld_Plaza00.szs',
    'data/spl/Fld_PlazaLobby.szs',
    'data/spl/Fld_World00.szs',
    'data/spl/Fld_Maze00.szs',
    'data/spl/Fld_EasyJump00.szs',
    'data/spl/Fld_Tuzura00.szs',
    'data/spl/Obj_Tree02.szs',
].map((path): SceneDesc => {
    const name = path;
    return new SceneDesc(name, path);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
