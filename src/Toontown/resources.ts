import type ArrayBufferSlice from "../ArrayBufferSlice";
import { decompress } from "../Common/Compression/Deflate.js";
import type { DataFetcher } from "../DataFetcher";
import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { Destroyable } from "../SceneBase";
import { BAMFile } from "./bam";

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
			console.log(
				`Decompressing file ${name} with size ${fileData.byteLength}`,
			);
			fileData = decompress(fileData);
			console.log(`Decompressed file ${name} to size ${fileData.byteLength}`);
		}
		return fileData;
	}

	public async loadModel(
		name: string,
		dataFetcher: DataFetcher,
		debug: boolean = false,
	): Promise<BAMFile> {
		const modelData = await this.loadFile(name, dataFetcher);
		return new BAMFile(modelData, { debug });
	}

	destroy(_device: GfxDevice): void {
		throw new Error("Method not implemented.");
	}
}
