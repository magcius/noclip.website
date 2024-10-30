import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { HIGame, HIScene } from "./HIScene.js";

const dataPath = 'SpongeBobMovie';

class TSSMSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
        this.id = this.id.toLowerCase();
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const paths = [
            `${dataPath}/boot.HIP`,
            //`${dataPath}/boot_US.HIP`,
            //`${dataPath}/mn/mnuc.HIP`,
            //`${dataPath}/mn/mnuc_US.HIP`,
            `${dataPath}/mn/mnui.HIP`,
            //`${dataPath}/mn/mnui_US.HIP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HOP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HIP`,
            //`${dataPath}/${this.id.substring(0, 2)}/${this.id}_US.HIP`,
        ];

        const scene = new HIScene(HIGame.TSSM, device, context);
        await scene.load(context.dataFetcher, paths);

        return scene;
    }
}

const id = 'tssm';
const name = 'The SpongeBob SquarePants Movie';
const sceneDescs = [
    'No Cheese!',
    new TSSMSceneDesc('bb02', 'No Cheese!'),
    'I\'m Ready... Depression',
    new TSSMSceneDesc('bb03', 'I\'m Ready... Depression'),
    new TSSMSceneDesc('am01', 'Combat Arena Challenge'),
    'Sandwich Driving 101',
    new TSSMSceneDesc('bb01', 'Sandwich Driving 101'),
    'Three... Thousand Miles to Shell City',
    new TSSMSceneDesc('de01', 'Three... Thousand Miles to Shell City'),
    new TSSMSceneDesc('fb01', 'Floating Block Challenge'),
    new TSSMSceneDesc('bl01', 'SpongeBall Challenge'),
    'Rub a Dub Dub, Slip Slide in the Tub',
    new TSSMSceneDesc('de02', 'Rub a Dub Dub, Slip Slide in the Tub'),
    'Bubble Blowing Baby Hunt',
    new TSSMSceneDesc('tt01', 'Bubble Blowing Baby Hunt'),
    new TSSMSceneDesc('bl02', 'SpongeBall Challenge'),
    new TSSMSceneDesc('am02', 'Combat Arena Challenge'),
    'No Weenie Parking Anytime',
    new TSSMSceneDesc('tt02', 'No Weenie Parking Anytime'),
    'I\'ll Let You Pet Mr. Whiskers',
    new TSSMSceneDesc('b101', 'I\'ll Let You Pet Mr. Whiskers'),
    'Rock Slide',
    new TSSMSceneDesc('tr01', 'Rock Slide'),
    'Now That We\'re Men...',
    new TSSMSceneDesc('tr02', 'Now That We\'re Men... (Part 1)'),
    new TSSMSceneDesc('tr03', 'Now That We\'re Men... (Part 2)'),
    new TSSMSceneDesc('fb02', 'Floating Block Challenge'),
    new TSSMSceneDesc('am03', 'Combat Arena Challenge'),
    'Shell City, Dead Ahead',
    new TSSMSceneDesc('jk01', 'Shell City, Dead Ahead (Part 1)'),
    new TSSMSceneDesc('jk02', 'Shell City, Dead Ahead (Part 2)'),
    new TSSMSceneDesc('fb03', 'Floating Block Challenge'),
    new TSSMSceneDesc('bl03', 'SpongeBall Challenge'),
    'Name\'s Dennis...',
    new TSSMSceneDesc('b201', 'Name\'s Dennis...'),
    'Sundae Driving',
    new TSSMSceneDesc('gg02', 'Sundae Driving'),
    'Google-Eyes and Smelly Knick Knacks',
    new TSSMSceneDesc('sc02', 'Google-Eyes and Smelly Knick Knacks'),
    'Dennis Strikes Back!',
    new TSSMSceneDesc('b301', 'Dennis Strikes Back!'),
    'Welcome to Planktopolis... Minions',
    new TSSMSceneDesc('pt01', 'Welcome to Planktopolis... Minions (Part 1)'),
    new TSSMSceneDesc('pt03', 'Welcome to Planktopolis... Minions (Part 2)'),
    new TSSMSceneDesc('bl04', 'SpongeBall Challenge'),
    new TSSMSceneDesc('am04', 'Combat Arena Challenge'),
    'Drive of the Knucklehead-McSpazitron',
    new TSSMSceneDesc('pt02', 'Drive of the Knucklehead-McSpazitron'),
    'Turn the Tables on Plankton',
    new TSSMSceneDesc('b401', 'Turn the Tables on Plankton'),
    '100% Cutscene',
    new TSSMSceneDesc('b402', '100% Cutscene')
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };