import type ArrayBufferSlice from "../ArrayBufferSlice";
import { decompress } from "../Common/Compression/Deflate.js";
import type { DataFetcher } from "../DataFetcher";
import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { Destroyable } from "../SceneBase";
import { BAMFile } from "./bam";
import { type DNAFile, parseDNA } from "./dna";
import { DNAStorage } from "./dna/storage";
import {
  type DecodedImage,
  decodeImage,
  getImageFormat,
  mergeAlphaChannel,
} from "./textures";

export const pathBase = "Toontown";

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

  public async loadManifest(dataFetcher: DataFetcher) {
    const manifestData = await dataFetcher.fetchData(
      `${pathBase}/manifest.json`,
    );
    const manifestString = new TextDecoder().decode(
      manifestData.arrayBuffer as ArrayBuffer,
    );
    this.manifest = JSON.parse(manifestString) as MultifileManifest;
    const numFiles = Object.keys(this.manifest).length;
    console.log(`Loaded manifest with ${numFiles} files`);
  }

  public hasFile(name: string): boolean {
    return name in this.manifest;
  }

  public async loadFile(
    name: string,
    dataFetcher: DataFetcher,
  ): Promise<ArrayBufferSlice> {
    const entry = this.manifest[name];
    if (!entry) throw new Error(`File not found in manifest: ${name}`);
    let fileData: ArrayBufferSlice = await dataFetcher.fetchData(
      `${pathBase}/${entry.file}`,
      {
        rangeStart: entry.offset,
        rangeSize: entry.length,
      },
    );
    if (entry.compressed) {
      console.debug(
        `Decompressing file ${name} with size ${fileData.byteLength}`,
      );
      fileData = decompress(fileData);
      console.debug(`Decompressed file ${name} to size ${fileData.byteLength}`);
    }
    return fileData;
  }

  public async loadModel(
    name: string,
    dataFetcher: DataFetcher,
    debug: boolean = false,
  ): Promise<BAMFile> {
    const cached = this.modelCache.get(name);
    if (cached) return cached;
    const modelData = await this.loadFile(name, dataFetcher);
    const model = new BAMFile(modelData, { debug });
    this.modelCache.set(name, model);
    return model;
  }

  /**
   * Load DNA files in order and build a DNAStorage with all resources
   * @param dnaFiles Array of DNA file paths to load in order
   * @param dataFetcher DataFetcher to use
   * @returns DNAStorage populated with all resources, and the final scene DNAFile
   */
  public async loadDNAWithStorage(
    dnaFiles: string[],
    dataFetcher: DataFetcher,
  ): Promise<{ storage: DNAStorage; sceneFile: DNAFile }> {
    const storage = new DNAStorage();
    let sceneFile: DNAFile | null = null;

    for (const dnaPath of dnaFiles) {
      const dnaFile = await this.loadDNA(dnaPath, dataFetcher);
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

  private async loadDNA(
    name: string,
    dataFetcher: DataFetcher,
  ): Promise<DNAFile> {
    const cached = this.dnaCache.get(name);
    if (cached) return cached;
    const dnaData = await this.loadFile(name, dataFetcher);
    const text = new TextDecoder().decode(dnaData.arrayBuffer as ArrayBuffer);
    const dnaFile = parseDNA(text);
    this.dnaCache.set(name, dnaFile);
    return dnaFile;
  }

  public async loadTexture(
    filename: string,
    alphaFilename: string | null,
    dataFetcher: DataFetcher,
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
    const fileData = await this.loadFile(filename, dataFetcher);
    const decoded = await decodeImage(fileData, format);

    // Check if there's a separate alpha file
    if (alphaFilename) {
      const alphaFormat = getImageFormat(alphaFilename);
      if (alphaFormat) {
        try {
          const alphaFileData = await this.loadFile(alphaFilename, dataFetcher);
          const alphaDecoded = await decodeImage(alphaFileData, alphaFormat);
          mergeAlphaChannel(decoded, alphaDecoded);
        } catch (e) {
          throw new Error(`Failed to load alpha texture ${alphaFilename}:`, {
            cause: e,
          });
        }
      }
    }

    this.textureCache.set(filename, decoded);
    return decoded;
  }

  destroy(_device: GfxDevice): void {
    throw new Error("Method not implemented.");
  }
}
