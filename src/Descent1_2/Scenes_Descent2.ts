import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import * as Viewer from "../viewer.js";
import { readDescentPalette } from "./Common/AssetReaders.js";
import { DescentDataReader } from "./Common/DataReader.js";
import { Descent2HamFile } from "./D2/D2HamFile.js";
import { Descent2Level } from "./D2/D2Level.js";
import { Descent2PigFile } from "./D2/D2PigFile.js";
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

        const renderer = new DescentRenderer(device, level, palette, pig, ham);

        const viewerTextures: Viewer.Texture[] = [];
        for (const texture of renderer.textureList.getAllTextures()) {
            const canvas = descentGfxTextureToCanvas(texture);
            if (canvas != null) viewerTextures.push(canvas);
        }
        renderer!.textureHolder = new FakeTextureHolder(viewerTextures);
        return renderer;
    }
}

const id = `descent2`;
const name = "Descent II";
const sceneDescs = [
    "Zeta Aquilae",
    new SceneDesc("d2leva-1.rl2", "Ahayweh Gate"),
    new SceneDesc("d2leva-2.rl2", "Turnabout Bore"),
    new SceneDesc("d2leva-3.rl2", "Wenl Mine"),
    new SceneDesc("d2leva-4.rl2", "Robby Station"),

    "Quartzon System",
    new SceneDesc("d2levb-1.rl2", "Seaspring Gorge"),
    new SceneDesc("d2levb-2.rl2", "The Well"),
    new SceneDesc("d2levb-3.rl2", "Coralbank Quarry"),
    new SceneDesc("d2levb-4.rl2", "Riverbed Mine"),

    "Brimspark System",
    new SceneDesc("d2levc-1.rl2", "Firewalker Mine"),
    new SceneDesc("d2levc-2.rl2", "Lavafalls Extraction Ctr."),
    new SceneDesc("d2levc-3.rl2", "Coalbank Shaft"),
    new SceneDesc("d2levc-4.rl2", "Magnacore Station"),

    "Limefrost Spiral",
    new SceneDesc("d2levd-1.rl2", "Sleetstone Tunnels"),
    new SceneDesc("d2levd-2.rl2", "Arcticon Corridor"),
    new SceneDesc("d2levd-3.rl2", "Icehammer Caverns"),
    new SceneDesc("d2levd-4.rl2", "Terrafrost Catacombs"),

    "Baloris Prime",
    new SceneDesc("d2leve-1.rl2", "Y'tor III"),
    new SceneDesc("d2leve-2.rl2", "Drec'nilbie K'luh"),
    new SceneDesc("d2leve-3.rl2", "Nep-Hilim S'crub"),
    new SceneDesc("d2leve-4.rl2", "Gytowt Station"),

    "Puuma Sphere",
    new SceneDesc("d2levf-1.rl2", "N'neri Ring"),
    new SceneDesc("d2levf-2.rl2", "Kwod A'rior"),
    new SceneDesc("d2levf-3.rl2", "Iwihml"),

    "Omega System",
    new SceneDesc("d2levf-4.rl2", "Tycho Brahe"),

    "Secret Levels",
    new SceneDesc("d2leva-s.rl2", "Segment City"),
    new SceneDesc("d2levb-s.rl2", "Hurdle Chase"),
    new SceneDesc("d2levc-s.rl2", "Mephisto Hardcore"),
    new SceneDesc("d2levd-s.rl2", "Galacia Caverns"),
    new SceneDesc("d2leve-s.rl2", "Ascent Level 1"),
    new SceneDesc("d2levf-s.rl2", "Chain Reaction"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
