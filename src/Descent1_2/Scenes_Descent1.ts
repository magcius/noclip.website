import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import * as Viewer from "../viewer.js";
import { readDescentPalette } from "./Common/AssetReaders.js";
import { DescentDataReader } from "./Common/DataReader.js";
import { Descent1Level } from "./D1/D1Level.js";
import { Descent1PigFile } from "./D1/D1PigFile.js";
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
                return new Descent1Level(levelFile);
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
            `${pathBase}/descent.pig`,
            async () => {
                const pigFile = await dataFetcher.fetchData(
                    `${pathBase}/descent.pig`,
                )!;
                return new Descent1PigFile(pigFile);
            },
        );

        const renderer = new DescentRenderer(device, level, palette, pig, pig);

        const viewerTextures: Viewer.Texture[] = [];
        for (const texture of renderer.textureList.getAllTextures()) {
            const canvas = descentGfxTextureToCanvas(texture);
            if (canvas != null) viewerTextures.push(canvas);
        }
        renderer!.textureHolder = new FakeTextureHolder(viewerTextures);
        return renderer;
    }
}

const id = `descent`;
const name = "Descent";
const sceneDescs = [
    "Earth",
    new SceneDesc("level01.rdl", "Lunar Outpost"),
    new SceneDesc("level02.rdl", "Lunar Scilab"),
    new SceneDesc("level03.rdl", "Lunar Military Base"),

    "Venus",
    new SceneDesc("level04.rdl", "Venus Atmospheric Lab"),
    new SceneDesc("level05.rdl", "Venus Nickel-Iron Mine"),

    "Mercury",
    new SceneDesc("level06.rdl", "Mercury Solar Lab"),
    new SceneDesc("level07.rdl", "Mercury Core"),

    "Mars",
    new SceneDesc("level08.rdl", "Mars Processing Station"),
    new SceneDesc("level09.rdl", "Mars Military Dig"),
    new SceneDesc("level10.rdl", "Mars Military Base"),

    "Jupiter",
    new SceneDesc("level11.rdl", "Io Sulfur Mine"),
    new SceneDesc("level12.rdl", "Callisto Tower Colony"),
    new SceneDesc("level13.rdl", "Europa Mining Colony"),
    new SceneDesc("level14.rdl", "Europa CO2 Mine"),

    "Saturn",
    new SceneDesc("level15.rdl", "Titan Mine"),
    new SceneDesc("level16.rdl", "Hyperion Methane Mine"),
    new SceneDesc("level17.rdl", "Tethys H20 Mine"),
    new SceneDesc("level18.rdl", "Miranda Mine"),

    "Uranus",
    new SceneDesc("level19.rdl", "Oberon Mine"),
    new SceneDesc("level20.rdl", "Oberon Platinum Mine"),
    new SceneDesc("level21.rdl", "Oberon Iron Mine"),

    "Neptune",
    new SceneDesc("level22.rdl", "Neptune Storage Depot"),
    new SceneDesc("level23.rdl", "Triton Storage Depot"),
    new SceneDesc("level24.rdl", "Nereid Volatile Mine"),

    "Pluto",
    new SceneDesc("level25.rdl", "Pluto Outpost"),
    new SceneDesc("level26.rdl", "Pluto Military Base"),
    new SceneDesc("level27.rdl", "Charon Volatile Mine"),

    "Secret Levels",
    new SceneDesc("levels1.rdl", "Asteroid Secret Base"),
    new SceneDesc("levels2.rdl", "Asteroid Military Depot"),
    new SceneDesc("levels3.rdl", "Asteroid Robot Factory"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
