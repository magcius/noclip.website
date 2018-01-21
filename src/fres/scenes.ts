
import { SceneGroup } from '../viewer';
import { SceneDesc } from './render';

const name = "BFRES";
const id = "fres";
const sceneDescs: SceneDesc[] = [
    { name: 'Inkopolis Plaza', path: 'Fld_Plaza00.szs' },
    { name: 'Inkopolis Plaza Lobby', path: 'Fld_PlazaLobby.szs' },
    { name: 'Ancho-V Games', path: 'Fld_Office00.szs' },
    { name: 'Arrowana Mall', path: 'Fld_UpDown00.szs' },
    { name: 'Blackbelly Skatepark', path: 'Fld_SkatePark00.szs' },
    { name: 'Bluefin Depot', path: 'Fld_Ruins00.szs' },
    { name: 'Camp Triggerfish', path: 'Fld_Athletic00.szs' },
    { name: 'Flounder Heights', path: 'Fld_Jyoheki00.szs' },
    { name: 'Hammerhead Bridge', path: 'Fld_Kaisou00.szs' },
    { name: 'Kelp Dome', path: 'Fld_Maze00.szs' },
    { name: 'Mahi-Mahi Resort', path: 'Fld_Hiagari00.szs' },
    { name: 'Moray Towers', path: 'Fld_Tuzura00.szs' },
    { name: 'Museum d\'Alfonsino', path: 'Fld_Pivot00.szs' },
    { name: 'Pirahna Pit', path: 'Fld_Quarry00.szs' },
    { name: 'Port Mackerel', path: 'Fld_Amida00.szs' },
    { name: 'Saltspray Rig', path: 'Fld_SeaPlant00.szs' },
    { name: 'Urchin Underpass (New)', path: 'Fld_Crank01.szs' },
    { name: 'Urchin Underpass (Old)', path: 'Fld_Crank00.szs' },
    { name: 'Walleye Warehouse', path: 'Fld_Warehouse00.szs' },
    { name: 'Octo Valley', path: 'Fld_World00.szs' },
    { name: 'Object: Tree', path: 'Obj_Tree02.szs' },
    { name: 'Object: CenterFloorUpDown', path: 'Obj_CenterFloorUpDown.szs' },
].map((entry): SceneDesc => {
    const name = entry.name || entry.path;
    const path = `data/spl/${entry.path}`;
    return new SceneDesc(name, path);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
