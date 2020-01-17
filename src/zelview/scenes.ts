
import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPassDescriptor, GfxRenderPass, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { makeClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { OpaqueBlack } from '../Color';
import { SceneContext } from '../SceneBase';
import { readZELVIEW0, Headers } from './zelview0';
import { RootMeshRenderer, MeshData, Mesh } from './render';
import { RSPState, RSPOutput } from './f3dzex';

const pathBase = `zelview`;

class ZelviewRenderer implements Viewer.SceneGfx {
    private clearRenderPassDescriptor: GfxRenderPassDescriptor;

    public meshRenderers: RootMeshRenderer[] = [];

    private renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.clearRenderPassDescriptor = makeClearRenderPassDescriptor(true, OpaqueBlack);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.clearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].destroy(device);
    }
}

class ZelviewSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const zelviewData = await dataFetcher.fetchData(`${pathBase}/${this.id}.zelview0`);

        const renderer = new ZelviewRenderer(device);

        const zelview = readZELVIEW0(zelviewData);
        const headers = zelview.loadMainScene();
        //console.log(`headers: ${JSON.stringify(headers, null, '\t')}`);

        function createMeshRenderer(rspOutput: (RSPOutput | null)) {
            if (!rspOutput) {
                return;
            }
            
            const cache = renderer.renderHelper.getCache();
            const mesh: Mesh = {
                sharedOutput: zelview.sharedOutput,
                rspState: new RSPState(headers.rom, zelview.sharedOutput),
                rspOutput: rspOutput,
            }
            const meshData = new MeshData(device, cache, mesh);
            const meshRenderer = new RootMeshRenderer(device, cache, meshData);
            renderer.meshRenderers.push(meshRenderer);
        }

        function createRenderer(headers: Headers) {
            if (headers.mesh) {
                for (let i = 0; i < headers.mesh.opaque.length; i++) {
                    createMeshRenderer(headers.mesh.opaque[i]);
                }
                
                for (let i = 0; i < headers.mesh.transparent.length; i++) {
                    // FIXME: sort transparent meshes back-to-front
                    createMeshRenderer(headers.mesh.transparent[i]);
                }
            } else {
                for (let i = 0; i < headers.rooms.length; i++) {
                    console.log(`Loading ${headers.filename} room ${i}...`);
                    createRenderer(headers.rooms[i]);
                }
            }
        }

        createRenderer(headers);

        return renderer;
    }
}

const id = 'zelview';
const name = 'Ocarina of Time';
const sceneDescs = [
    // TODO: Implement scenes with JFIF backgrounds. They are commented out.
    "Kokiri Forest",
    new ZelviewSceneDesc('spot04_scene', 'Kokiri Forest'),
    new ZelviewSceneDesc('ydan_scene', 'Inside the Deku Tree'),
    new ZelviewSceneDesc('ydan_boss_scene', 'Inside the Deku Tree (Boss)'),
    new ZelviewSceneDesc('spot10_scene', 'Lost Woods'),
    new ZelviewSceneDesc('spot05_scene', 'Sacred Forest Meadow'),
    new ZelviewSceneDesc('Bmori1_scene', 'Forest Temple'),
    new ZelviewSceneDesc('moribossroom_scene', 'Forest Temple (Boss)'),
    // new ZelviewSceneDesc('kokiri_home_scene', "Know-it-all Brothers' Home"),
    // new ZelviewSceneDesc('kokiri_shop_scene', 'Kokiri Shop'),
    // new ZelviewSceneDesc('link_home_scene', "Link's Home"),
    // new ZelviewSceneDesc('kokiri_home3_scene', 'House of Twins'),
    // new ZelviewSceneDesc('kokiri_home4_scene', "Mido's House"),
    // new ZelviewSceneDesc('kokiri_home5_scene', "Saria's House"),

    "Kakariko Village",
    new ZelviewSceneDesc('spot01_scene', 'Kakariko Village'),
    new ZelviewSceneDesc('kinsuta_scene', 'Skulltula House'),
    // new ZelviewSceneDesc('labo_scene', "Impa's House"),
    new ZelviewSceneDesc('mahouya_scene', "Granny's Potion Shop"),
    // new ZelviewSceneDesc('drag_scene', 'Kakariko Potion Shop'),
    new ZelviewSceneDesc('spot02_scene', 'Kakariko Graveyard'),
    // new ZelviewSceneDesc('hut_scene', "Dampé's Hut"),
    new ZelviewSceneDesc('hakasitarelay_scene', "Dampé's Grave & Kakariko Windmill"),
    new ZelviewSceneDesc('hakaana_ouke_scene', "Royal Family's Tomb"),
    new ZelviewSceneDesc('HAKAdan_scene', 'Shadow Temple'),
    new ZelviewSceneDesc('HAKAdan_bs_scene', 'Shadow Temple (Boss)'),
    new ZelviewSceneDesc('HAKAdanCH_scene', 'Bottom of the Well'),
    new ZelviewSceneDesc('hakaana_scene', 'Grave (1)'),
    new ZelviewSceneDesc('hakaana2_scene', 'Grave (2)'),
    // new ZelviewSceneDesc('shop1_scene', 'Kakariko Bazaar'),
    new ZelviewSceneDesc('syatekijyou_scene', 'Shooting Gallery'),
    // new ZelviewSceneDesc('kakariko_scene', 'Kakariko Village House'),
    // new ZelviewSceneDesc('kakariko3_scene', 'Back Alley Village House'),

    "Death Mountain",
    new ZelviewSceneDesc('spot16_scene', 'Death Mountain'),
    new ZelviewSceneDesc('spot17_scene', 'Death Mountain Crater'),
    new ZelviewSceneDesc('spot18_scene', 'Goron City'),
    // new ZelviewSceneDesc('golon_scene', 'Goron Shop'),
    new ZelviewSceneDesc('ddan_scene', "Dodongo's Cavern"),
    new ZelviewSceneDesc('ddan_boss_scene', "Dodongo's Cavern (Boss)"),
    new ZelviewSceneDesc('HIDAN_scene', 'Fire Temple'),
    new ZelviewSceneDesc('FIRE_bs_scene', 'Fire Temple (Boss)'),

    "Hyrule Field",
    new ZelviewSceneDesc('spot00_scene', 'Hyrule Field'),
    new ZelviewSceneDesc('spot20_scene', 'Lon Lon Ranch'),
    // new ZelviewSceneDesc('souko_scene', "Talon's House"),
    // new ZelviewSceneDesc('malon_stable_scene', 'Stables'),
    new ZelviewSceneDesc('spot03_scene', "Zora's River"),
    new ZelviewSceneDesc('daiyousei_izumi_scene', 'Great Fairy Fountain'),
    new ZelviewSceneDesc('yousei_izumi_tate_scene', 'Small Fairy Fountain'),
    new ZelviewSceneDesc('yousei_izumi_yoko_scene', 'Magic Fairy Fountain'),
    new ZelviewSceneDesc('kakusiana_scene', 'Grottos'),
    new ZelviewSceneDesc('hiral_demo_scene', 'Cutscene Map'),

    "Hyrule Castle / Town",
    new ZelviewSceneDesc('spot15_scene', 'Hyrule Castle'),
    new ZelviewSceneDesc('hairal_niwa_scene', 'Castle Courtyard'),
    new ZelviewSceneDesc('hairal_niwa_n_scene', 'Castle Courtyard (Night)'),
    new ZelviewSceneDesc('nakaniwa_scene', "Zelda's Courtyard"),
    // new ZelviewSceneDesc('entra_scene', 'Market Entrance (Day)'),
    // new ZelviewSceneDesc('entra_n_scene', 'Market Entrance (Night)'),
    // new ZelviewSceneDesc('enrui_scene', 'Market Entrance (Ruins)'),
    new ZelviewSceneDesc('miharigoya_scene', "Lots'o'Pots"),
    // new ZelviewSceneDesc('market_day_scene', 'Market (Day)'),
    // new ZelviewSceneDesc('market_night_scene', 'Market (Night)'),
    // new ZelviewSceneDesc('market_ruins_scene', 'Market (Ruins)'),
    // new ZelviewSceneDesc('market_alley_scene', 'Market Back-Alley (Day)'),
    // new ZelviewSceneDesc('market_alley_n_scene', 'Market Back-Alley (Night)'),
    new ZelviewSceneDesc('bowling_scene', 'Bombchu Bowling Alley'),
    // new ZelviewSceneDesc('night_shop_scene', 'Bombchu Shop'),
    new ZelviewSceneDesc('takaraya_scene', 'Treasure Chest Game'),
    // new ZelviewSceneDesc('impa_scene', "Puppy Woman's House"),
    // new ZelviewSceneDesc('alley_shop_scene', 'Market Potion Shop'),
    // new ZelviewSceneDesc('face_shop_scene', 'Happy Mask Shop'),
    // new ZelviewSceneDesc('shrine_scene', 'Temple of Time (Outside, Day)'),
    // new ZelviewSceneDesc('shrine_n_scene', 'Temple of Time (Outside, Night)'),
    // new ZelviewSceneDesc('shrine_r_scene', 'Temple of Time (Outside, Adult)'),
    new ZelviewSceneDesc('tokinoma_scene', 'Temple of Time (Interior)'),
    new ZelviewSceneDesc('kenjyanoma_scene', 'Chamber of Sages'),

    "Lake Hylia",
    new ZelviewSceneDesc('spot06_scene', 'Lake Hylia'),
    new ZelviewSceneDesc('hylia_labo_scene', 'Hylia Lakeside Laboratory'),
    new ZelviewSceneDesc('turibori_scene', 'Fishing Pond'),
    new ZelviewSceneDesc('MIZUsin_scene', 'Water Temple'),
    new ZelviewSceneDesc('MIZUsin_bs_scene', 'Water Temple (Boss)'),

    "Zora's Domain",
    new ZelviewSceneDesc('spot07_scene', "Zora's Domain"),
    new ZelviewSceneDesc('spot08_scene', "Zora's Fountain"),
    // new ZelviewSceneDesc('zoora_scene', 'Zora Shop'),
    new ZelviewSceneDesc('bdan_scene', "Jabu-Jabu's Belly"),
    new ZelviewSceneDesc('bdan_boss_scene', "Jabu-Jabu's Belly (Boss)"),
    new ZelviewSceneDesc('ice_doukutu_scene', 'Ice Cavern'),

    "Gerudo Desert",
    new ZelviewSceneDesc('spot09_scene', 'Gerudo Valley'),
    new ZelviewSceneDesc('tent_scene', "Carpenter's Tent"),
    new ZelviewSceneDesc('spot12_scene', "Gerudo's Fortress"),
    new ZelviewSceneDesc('men_scene', 'Gerudo Training Grounds'),
    new ZelviewSceneDesc('gerudoway_scene', "Thieves' Hideout"),
    new ZelviewSceneDesc('spot13_scene', 'Haunted Wasteland'),
    new ZelviewSceneDesc('spot11_scene', 'Desert Colossus'),
    new ZelviewSceneDesc('jyasinzou_scene', 'Spirit Temple'),
    new ZelviewSceneDesc('jyasinboss_scene', 'Spirit Temple (Mid-Boss)'),

    "Ganon's Castle",
    new ZelviewSceneDesc('ganontika_scene', "Ganon's Castle"),
    new ZelviewSceneDesc('ganontikasonogo_scene', "Ganon's Castle (Crumbling)"),
    new ZelviewSceneDesc('ganon_tou_scene', "Ganon's Castle (Outside)"),
    new ZelviewSceneDesc('ganon_scene', "Ganon's Castle Tower"),
    new ZelviewSceneDesc('ganon_sonogo_scene', "Ganon's Castle Tower (Crumbling)"),
    new ZelviewSceneDesc('ganon_boss_scene', 'Second-To-Last Boss Ganondorf'),
    new ZelviewSceneDesc('ganon_demo_scene', 'Final Battle Against Ganon'),
    new ZelviewSceneDesc('ganon_final_scene', "Ganondorf's Death"),
    
    "Unused Scenes",
    new ZelviewSceneDesc('test01_scene', 'Collision Testing Area'),
    new ZelviewSceneDesc('besitu_scene', 'Besitu / Treasure Chest Warp'),
    new ZelviewSceneDesc('depth_test_scene', 'Depth Test'),
    new ZelviewSceneDesc('syotes_scene', 'Stalfos Middle Room'),
    new ZelviewSceneDesc('syotes2_scene', 'Stalfos Boss Room'),
    new ZelviewSceneDesc('sutaru_scene', 'Dark Link Testing Area'),
    new ZelviewSceneDesc('hairal_niwa2_scene', 'Beta Castle Courtyard'),
    new ZelviewSceneDesc('sasatest_scene', 'Action Testing Room'),
    new ZelviewSceneDesc('testroom_scene', 'Item Testing Room'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
