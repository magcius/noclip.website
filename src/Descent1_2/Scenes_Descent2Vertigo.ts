import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import * as Viewer from "../viewer.js";
import { readDescentPalette } from "./Common/AssetReaders.js";
import { DescentDataReader } from "./Common/DataReader.js";
import { Descent2HamFile } from "./D2/D2HamFile.js";
import { Descent2Level } from "./D2/D2Level.js";
import { Descent2PigFile } from "./D2/D2PigFile.js";
import { Descent2VHamFile } from "./D2/D2VHamFile.js";
import { DescentRenderer } from "./Render/Renderer.js";
import { descentGfxTextureToCanvas } from "./Render/TextureToCanvas.js";

const pathBase = `Descent1_2`;

class SceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public name: string,
    ) {}

    public async createScene(
        device: GfxDevice,
        context: SceneContext,
    ): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const level = await context.dataShare.ensureObject(
            `${pathBase}/${this.id}`,
            async () => {
                const levelFile = await dataFetcher.fetchData(
                    `${pathBase}/${this.id}`,
                )!;
                return new Descent2Level(levelFile);
            },
        );
        const ham = await context.dataShare.ensureObject(
            `${pathBase}/descent2.ham`,
            async () => {
                const hamFile = await dataFetcher.fetchData(
                    `${pathBase}/descent2.ham`,
                )!;
                return new Descent2HamFile(hamFile);
            },
        );
        const vham = await context.dataShare.ensureObject(
            `${pathBase}/d2x.ham`,
            async () => {
                const vhamFile = await dataFetcher.fetchData(
                    `${pathBase}/d2x.ham`,
                )!;
                return new Descent2VHamFile(vhamFile, ham);
            },
        );
        const paletteName = level.paletteName.toLowerCase();
        const palette = await context.dataShare.ensureObject(
            `${pathBase}/${paletteName}.256`,
            async () => {
                const paletteFile = await dataFetcher.fetchData(
                    `${pathBase}/${paletteName}.256`,
                )!;
                return readDescentPalette(
                    paletteName,
                    new DescentDataReader(paletteFile),
                );
            },
        );
        const pig = await context.dataShare.ensureObject(
            `${pathBase}/${paletteName}.pig`,
            async () => {
                const pigFile = await dataFetcher.fetchData(
                    `${pathBase}/${paletteName}.pig`,
                )!;
                return new Descent2PigFile(pigFile);
            },
        );

        const renderer = new DescentRenderer(device, level, palette, pig, vham);

        const viewerTextures: Viewer.Texture[] = [];
        for (const texture of renderer.textureList.getAllTextures()) {
            const canvas = descentGfxTextureToCanvas(texture);
            if (canvas != null) viewerTextures.push(canvas);
        }
        renderer!.textureHolder = new FakeTextureHolder(viewerTextures);
        return renderer;
    }
}

const id = `descent2Vertigo`;
const name = "Descent II: Vertigo";
const sceneDescs = [
    "Normal Levels",
    new SceneDesc("d2xlvl01.rl2", "Deep Kraeg Tunnel System"),
    new SceneDesc("d2xlvl02.rl2", "Transmode Containment 2112"),
    new SceneDesc("d2xlvl03.rl2", "Collision Dome Excavation"),
    new SceneDesc("d2xlvl04.rl2", "PTMC Heavy Water Abyss"),
    new SceneDesc("d2xlvl05.rl2", "Artifact Research Facility"),
    new SceneDesc("d2xlvl06.rl2", "Krell Shaft Factory"),
    new SceneDesc("d2xlvl07.rl2", "Kanroku Ore Mine"),
    new SceneDesc("d2xlvl08.rl2", "Archangel Falls Mine"),
    new SceneDesc("d2xlvl09.rl2", "Metacave Weapons Research"),
    new SceneDesc("d2xlvl10.rl2", "Citadel Station"),
    new SceneDesc("d2xlvl11.rl2", "Urgian Kiln"),
    new SceneDesc("d2xlvl12.rl2", "Exodus Research Facility"),
    new SceneDesc("d2xlvl13.rl2", "PTMC Geothermal No. 1A574"),
    new SceneDesc("d2xlvl14.rl2", "Living Water Catacombs"),
    new SceneDesc("d2xlvl15.rl2", "Frisia Gas Mine"),
    new SceneDesc("d2xlvl16.rl2", "Fold Zandura"),
    new SceneDesc("d2xlvl17.rl2", "Gippan Ore Refinery"),
    new SceneDesc("d2xlvl18.rl2", "Magma Tower Complex"),
    new SceneDesc("d2xlvl19.rl2", "Morabi Milk Mine"),
    new SceneDesc("d2xlvl20.rl2", "Vertigo Research Station"),

    "Secret Levels",
    new SceneDesc("d2xlvls1.rl2", "Fort Pyr Security Training Post"),
    new SceneDesc("d2xlvls2.rl2", "GOTH-9 Waste Recycling Facility"),
    new SceneDesc("d2xlvls3.rl2", "Brizzna Babrenna Ice Base"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
