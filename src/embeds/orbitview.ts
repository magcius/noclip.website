
import { SceneGfx } from "../viewer";
import { SceneContext } from "../SceneBase";
import { createSceneFromFiles } from "../Scenes_FileDrops";

export async function createScene(context: SceneContext, name: string): Promise<SceneGfx> {
    const dataFetcher = context.dataFetcher;
    const buffer = await dataFetcher.fetchURL(name);
    return createSceneFromFiles(context, [buffer]);
}
