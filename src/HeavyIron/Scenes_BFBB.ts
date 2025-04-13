import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { HIGame, HIScene } from "./HIScene.js";

const dataPath = 'SpongeBobBattleForBikiniBottom/v2';

class BFBBSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, public beta: boolean = false) {
        this.id = this.id.toLowerCase();
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const paths = [
            `${dataPath}/boot.HIP`,
            //`${dataPath}/mn/mnu4.HIP`,
            //`${dataPath}/mn/mnu5.HIP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HOP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HIP`,
        ];

        const scene = new HIScene(this.beta ? HIGame.BFBBBeta : HIGame.BFBB, device, context);
        await scene.load(context.dataFetcher, paths);

        return scene;
    }
}

const id = 'bfbb';
const name = 'SpongeBob SquarePants: Battle for Bikini Bottom';
const sceneDescs = [
    'Main Menu',
    new BFBBSceneDesc('mnu3', 'Main Menu'),
    'Bikini Bottom',
    new BFBBSceneDesc('hb00', 'Prologue Cutscene'),
    new BFBBSceneDesc('hb01', 'Bikini Bottom'),
    new BFBBSceneDesc('hb02', 'SpongeBob\'s Pineapple'),
    new BFBBSceneDesc('hb03', 'Squidward\'s Tiki'),
    new BFBBSceneDesc('hb04', 'Patrick\'s Rock'),
    new BFBBSceneDesc('hb05', 'Sandy\'s Treedome'),
    new BFBBSceneDesc('hb06', 'Shady Shoals'),
    new BFBBSceneDesc('hb07', 'Krusty Krab'),
    new BFBBSceneDesc('hb08', 'Chum Bucket'),
    new BFBBSceneDesc('hb09', 'Police Station'),
    new BFBBSceneDesc('hb10', 'Theater'),
    'Jellyfish Fields',
    new BFBBSceneDesc('jf01', 'Jellyfish Rock'),
    new BFBBSceneDesc('jf02', 'Jellyfish Caves'),
    new BFBBSceneDesc('jf03', 'Jellyfish Lake'),
    new BFBBSceneDesc('jf04', 'Spork Mountain'),
    'Downtown Bikini Bottom',
    new BFBBSceneDesc('bb01', 'Downtown Streets'),
    new BFBBSceneDesc('bb02', 'Downtown Rooftops'),
    new BFBBSceneDesc('bb03', 'Lighthouse'),
    new BFBBSceneDesc('bb04', 'Sea Needle'),
    'Goo Lagoon',
    new BFBBSceneDesc('gl01', 'Goo Lagoon Beach'),
    new BFBBSceneDesc('gl02', 'Goo Lagoon Sea Caves'),
    new BFBBSceneDesc('gl03', 'Goo Lagoon Pier'),
    'Poseidome',
    new BFBBSceneDesc('b101', 'Poseidome'),
    'Rock Bottom',
    new BFBBSceneDesc('rb01', 'Downtown Rock Bottom'),
    new BFBBSceneDesc('rb02', 'Rock Bottom Museum'),
    new BFBBSceneDesc('rb03', 'Trench of Advanced Darkness'),
    'Mermalair',
    new BFBBSceneDesc('bc01', 'Mermalair Lobby'),
    new BFBBSceneDesc('bc02', 'Mermalair Main Chamber'),
    new BFBBSceneDesc('bc03', 'Mermalair Security Tunnel'),
    new BFBBSceneDesc('bc04', 'Rolling Ball Area'),
    new BFBBSceneDesc('bc05', 'Villain Containment Area'),
    'Sand Mountain',
    new BFBBSceneDesc('sm01', 'Ski Lodge'),
    new BFBBSceneDesc('sm02', 'Guppy Mound'),
    new BFBBSceneDesc('sm03', 'Flounder Hill'),
    new BFBBSceneDesc('sm04', 'Sand Mountain'),
    'Industrial Park',
    new BFBBSceneDesc('b201', 'Industrial Park'),
    'Kelp Forest',
    new BFBBSceneDesc('kf01', 'Kelp Forest'),
    new BFBBSceneDesc('kf02', 'Kelp Swamp'),
    new BFBBSceneDesc('kf04', 'Kelp Caves'),
    new BFBBSceneDesc('kf05', 'Kelp Vines'),
    'Flying Dutchman\'s Graveyard',
    new BFBBSceneDesc('gy01', 'Graveyard Lake'),
    new BFBBSceneDesc('gy02', 'Graveyard of Ships'),
    new BFBBSceneDesc('gy03', 'Dutchman\'s Ship'),
    new BFBBSceneDesc('gy04', 'Flying Dutchman Battle'),
    'SpongeBob\'s Dream',
    new BFBBSceneDesc('db01', 'SpongeBob\'s Dream'),
    new BFBBSceneDesc('db02', 'Sandy\'s Dream'),
    new BFBBSceneDesc('db03', 'Squidward\'s Dream'),
    new BFBBSceneDesc('db04', 'Mr. Krabs\' Dream'),
    new BFBBSceneDesc('db06', 'Patrick\'s Dream'),
    new BFBBSceneDesc('db05', 'Patrick\'s Dream (unused)', true),
    'Chum Bucket Lab',
    new BFBBSceneDesc('b301', 'MuscleBob Fight (unused)'),
    new BFBBSceneDesc('b302', 'Kah-Rah-Tae!'),
    new BFBBSceneDesc('b303', 'The Small Shall Rule... Or Not'),
    'SpongeBall Arena',
    new BFBBSceneDesc('pg12', 'SpongeBall Arena')
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };