import type ArrayBufferSlice from "../ArrayBufferSlice";
import { decompress } from "../Common/Compression/Deflate.js";
import type { DataFetcher } from "../DataFetcher";
import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { Destroyable } from "../SceneBase";
import { BAMFile } from "./bam";
import { type DNAFile, parseDNA } from "./dna";
import { DNAStorage } from "./dna/storage";
import { Format } from "./nodes";
import { DynamicTextFont, StaticTextFont, TextFont } from "./text";
import {
  type DecodedImage,
  decodeImage,
  getImageFormat,
  mergeAlphaChannel,
} from "./textures";

export const pathBase = "Toontown";
const USE_HQ_FONTS = true;

type MultifileManifest = Record<string, MultifileManifestEntry>;

type MultifileManifestEntry = {
  file: string;
  offset: number;
  length: number;
  compressed: boolean;
};

export class ToontownResourceLoader implements Destroyable {
  private manifest: MultifileManifest = {};
  private modelCache: Map<string, BAMFile> = new Map();
  private textureCache: Map<string, DecodedImage> = new Map();
  private dnaCache: Map<string, DNAFile> = new Map();
  private fontCache: Map<string, TextFont> = new Map();

  constructor(private dataFetcher: DataFetcher) {}

  public async loadManifest() {
    const manifestData = await this.dataFetcher.fetchData(
      `${pathBase}/manifest.json`,
    );
    const manifestString = new TextDecoder().decode(
      manifestData.arrayBuffer as ArrayBuffer,
    );
    this.manifest = JSON.parse(manifestString) as MultifileManifest;
    const numFiles = Object.keys(this.manifest).length;
    console.log(`Loaded manifest with ${numFiles} files`);
  }

  public async hasFile(name: string): Promise<boolean> {
    const fileData = await this.dataFetcher.fetchData(`${pathBase}/${name}`, {
      allow404: true,
    });
    return fileData.byteLength > 0;
    // return name in this.manifest;
  }

  public async loadFile(name: string): Promise<ArrayBufferSlice> {
    let fileData = await this.dataFetcher.fetchData(`${pathBase}/${name}`);
    // const entry = this.manifest[name];
    // if (!entry) throw new Error(`File not found in manifest: ${name}`);
    // let fileData: ArrayBufferSlice = await this.dataFetcher.fetchData(
    //   `${pathBase}/${entry.file}`,
    //   {
    //     rangeStart: entry.offset,
    //     rangeSize: entry.length,
    //   },
    // );
    // if (entry.compressed) {
    //   console.debug(
    //     `Decompressing file ${name} with size ${fileData.byteLength}`,
    //   );
    //   fileData = decompress(fileData);
    //   console.debug(`Decompressed file ${name} to size ${fileData.byteLength}`);
    // }
    return fileData;
  }

  public async loadModel(
    name: string,
    debug: boolean = false,
  ): Promise<BAMFile> {
    const cached = this.modelCache.get(name);
    if (cached) return cached;
    const modelData = await this.loadFile(`${name}.bam`);
    const model = new BAMFile(modelData, { debug });
    this.modelCache.set(name, model);
    return model;
  }

  /**
   * Load DNA files in order and build a DNAStorage with all resources
   * @param dnaFiles Array of DNA file paths to load in order
   * @returns DNAStorage populated with all resources, and the final scene DNAFile
   */
  public async loadDNAWithStorage(
    dnaFiles: string[],
  ): Promise<{ storage: DNAStorage; sceneFile: DNAFile }> {
    const storage = new DNAStorage();

    if (USE_HQ_FONTS) {
      storage.storeFont({
        code: "humanist",
        filename: "phase_3/fonts/ImpressBT",
        category: "font",
      });
      storage.storeFont({
        code: "mickey",
        filename: "phase_3/fonts/MickeyFontMaximum",
        category: "font",
      });
      storage.storeFont({
        code: "suit",
        filename: "phase_3/fonts/vtRemingtonPortable",
        category: "font",
      });
      storage.storeFont({
        code: "TT_Comedy",
        filename: "phase_3/fonts/Comedy",
        category: "font",
      });
      storage.storeFont({
        code: "DD_Portago",
        filename: "phase_3/fonts/Portago",
        category: "font",
      });
      storage.storeFont({
        code: "MM_Musicals",
        filename: "phase_3/fonts/Musicals",
        category: "font",
      });
      storage.storeFont({
        code: "BR_Aftershock",
        filename: "phase_3/fonts/Aftershock",
        category: "font",
      });
      storage.storeFont({
        code: "DG_Ironwork",
        filename: "phase_3/fonts/Ironwork",
        category: "font",
      });
      storage.storeFont({
        code: "DL_JiggeryPokery",
        filename: "phase_3/fonts/JiggeryPokery",
        category: "font",
      });
    }

    let sceneFile: DNAFile | null = null;

    for (const dnaPath of dnaFiles) {
      const dnaFile = await this.loadDNA(dnaPath);
      storage.loadFromDNAFile(dnaFile);

      // The last file is the scene file
      sceneFile = dnaFile;
    }

    if (!sceneFile) {
      throw new Error("No DNA files provided");
    }

    // storage.debugPrint();
    return { storage, sceneFile };
  }

  private async loadDNA(name: string): Promise<DNAFile> {
    const cached = this.dnaCache.get(name);
    if (cached) return cached;
    let dnaPath = (await this.hasFile(`${name}.xml`))
      ? `${name}.xml`
      : `${name}.dna`;
    const dnaData = await this.loadFile(dnaPath);
    const text = new TextDecoder().decode(dnaData.arrayBuffer as ArrayBuffer);
    const dnaFile = parseDNA(text);
    this.dnaCache.set(name, dnaFile);
    return dnaFile;
  }

  public async loadTexture(
    filename: string,
    alphaFilename: string | null,
    gameFormat: Format | null,
  ): Promise<DecodedImage> {
    const cached = this.textureCache.get(filename);
    if (cached) return cached;

    // Determine image format from extension
    const format = getImageFormat(filename);
    if (!format) {
      throw new Error(
        `Failed to load texture ${filename}: unsupported format ${format}`,
      );
    }
    const fileData = await this.loadFile(filename);
    const decoded = await decodeImage(fileData, format);

    // Check if there's a separate alpha file
    if (alphaFilename) {
      const alphaFormat = getImageFormat(alphaFilename);
      if (alphaFormat) {
        try {
          const alphaFileData = await this.loadFile(alphaFilename);
          const alphaDecoded = await decodeImage(alphaFileData, alphaFormat);
          mergeAlphaChannel(decoded, alphaDecoded);
        } catch (e) {
          throw new Error(`Failed to load alpha texture ${alphaFilename}:`, {
            cause: e,
          });
        }
      }
    } else if (gameFormat === Format.Alpha) {
      mergeAlphaChannel(decoded, decoded);
    }

    this.textureCache.set(filename, decoded);
    return decoded;
  }

  async loadFont(filename: string): Promise<TextFont> {
    const cached = this.fontCache.get(filename);
    if (cached) return cached;

    // Try TTF first, then fall back to BAM
    const ttfPath = filename.endsWith(".ttf") ? filename : `${filename}.ttf`;
    if (await this.hasFile(ttfPath)) {
      const ttfData = await this.loadFile(ttfPath);
      const font = new DynamicTextFont(ttfData.createTypedArray(Uint8Array));
      this.fontCache.set(filename, font);
      return font;
    }

    // Fall back to BAM
    const fontModel = await this.loadModel(filename);
    const font = new StaticTextFont(fontModel.getRoot());
    this.fontCache.set(filename, font);
    return font;
  }

  destroy(_device: GfxDevice): void {
    throw new Error("Method not implemented.");
  }
}
