/*
 * Main LocoRoco scene descriptor.
 *
 * petton-svn, 2026.
 */

import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import * as Viewer from "../viewer.js";
import { LocoRocoRenderer } from "./LocoRocoRenderer.js";
import * as LZMA from "../Common/Compression/LZMA.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";

const pathBase = `LocoRoco/DATA.BIN`;

function decompressLZMA(compressed: ArrayBufferSlice): ArrayBufferSlice {
  const props = LZMA.decodeLZMAProperties(compressed.subarray(0, 5));
  return LZMA.decompress(compressed.subarray(13), props, 16 * 1024 * 1024, true);
}

export class LocoRocoLevelSceneDesc implements Viewer.SceneDesc {
  constructor(
    public id: string,
    public name: string,
    public clv_filename: string,
  ) {}

  public async createScene(
    device: GfxDevice,
    context: SceneContext,
  ): Promise<Viewer.SceneGfx> {
    const dataFetcher = context.dataFetcher;

    const system_arc_promise = dataFetcher.fetchData(
      `${pathBase}/system.arc.lzma`,
    );
    const level_promise = dataFetcher.fetchData(
      `${pathBase}/${this.clv_filename}.lzma`,
    );

    const system_arc = decompressLZMA(await system_arc_promise);
    const level = decompressLZMA(await level_promise);

    // Extract level name from clv_filename (e.g., "st0_a.clv" -> "st0_a")
    const levelName = this.clv_filename.replace(/\.clv$/i, "");
    return new LocoRocoRenderer(device, system_arc, level, levelName);
  }
}
