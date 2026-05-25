
// Per-map background music owned by the scene's renderer. Tracks loop on a
// shared HTMLAudioElement; the id -> filename map is lazy-loaded once.

import { DataFetcher } from "../DataFetcher.js";
import { maps } from "./maps.js";

export class Bgm {
    private static enabled = false;
    private static currentVolume = 0.5;
    private static mapNameById: Map<string, string> | null = null;

    private audio: HTMLAudioElement | null = null;
    private currentMapId: string | null = null;
    private lastFetcher: DataFetcher | null = null;
    private sceneGeneration = 0;
    private indexPromise: Promise<Map<string, string> | null> | null = null;
    private destroyed = false;
    private trackOverride: string | null = null;

    constructor(private pathBase: string) {
    }

    private loadIndex(dataFetcher: DataFetcher): Promise<Map<string, string> | null> {
        if (this.indexPromise !== null)
            return this.indexPromise;
        const url = `${this.pathBase}/bgm/index.json`;
        this.indexPromise = (async () => {
            try {
                const data = await dataFetcher.fetchData(url, { allow404: true });
                const text = new TextDecoder("utf-8").decode(data.createTypedArray(Uint8Array));
                const obj = JSON.parse(text) as Record<string, string>;
                return new Map(Object.entries(obj));
            } catch {
                return null;
            }
        })();
        return this.indexPromise;
    }

    private async urlForMap(dataFetcher: DataFetcher, mapId: string): Promise<string | null> {
        const idx = await this.loadIndex(dataFetcher);
        if (idx === null)
            return null;
        const file = idx.get(mapId);
        if (file === undefined)
            return null;
        return dataFetcher.getDataURLForPath(`${this.pathBase}/bgm/${file}`);
    }

    private ensureAudio(): HTMLAudioElement {
        if (this.audio === null) {
            this.audio = new Audio();
            this.audio.loop = true;
            this.audio.preload = "auto";
            this.audio.volume = Bgm.currentVolume;
        }
        return this.audio;
    }

    public async setMap(dataFetcher: DataFetcher, mapId: string): Promise<void> {
        const generation = ++this.sceneGeneration;
        this.lastFetcher = dataFetcher;
        if (mapId === this.currentMapId)
            return;
        this.currentMapId = mapId;
        if (!Bgm.enabled)
            return;
        await this.applyCurrent(dataFetcher, generation);
    }

    public async setEnabled(value: boolean, dataFetcher: DataFetcher | null): Promise<void> {
        if (Bgm.enabled === value) return;
        Bgm.enabled = value;
        if (!value) {
            if (this.audio !== null)
                this.audio.pause();
            return;
        }
        const f = dataFetcher ?? this.lastFetcher;
        if (f !== null)
            await this.applyCurrent(f, this.sceneGeneration);
    }

    public isEnabled(): boolean {
        return Bgm.enabled;
    }

    public setVolume(v: number): void {
        Bgm.currentVolume = Math.max(0, Math.min(1, v));
        if (this.audio !== null)
            this.audio.volume = Bgm.currentVolume;
    }

    public getVolume(): number {
        return Bgm.currentVolume;
    }

    public async listLabelledTracks(): Promise<{ filename: string, label: string }[]> {
        if (this.lastFetcher === null)
            return [];
        const idx = await this.loadIndex(this.lastFetcher);
        if (idx === null)
            return [];
        // A single file can be shared by multiple maps; use the first map's
        // human-readable name as the label.
        const byFile = new Map<string, string>();
        for (const [mapId, file] of idx)
            if (!byFile.has(file))
                byFile.set(file, mapId);
        if (Bgm.mapNameById === null) {
            Bgm.mapNameById = new Map();
            for (const m of maps)
                Bgm.mapNameById.set(m.id, m.name);
        }
        const names = Bgm.mapNameById;
        const labelled = Array.from(byFile, ([filename, mapId]) => {
            const name = names.get(mapId);
            return { filename, label: name !== undefined ? `${name} (${filename})` : filename };
        });
        labelled.sort((a, b) => a.label.localeCompare(b.label));
        return labelled;
    }

    public setTrackOverride(filename: string | null): void {
        this.trackOverride = filename;
        if (this.lastFetcher !== null && Bgm.enabled)
            this.applyCurrent(this.lastFetcher, ++this.sceneGeneration).catch((e) => console.error("BGM: track override failed", e));
    }

    public async getMapDefaultTrack(): Promise<string | null> {
        if (this.currentMapId === null || this.lastFetcher === null)
            return null;
        const idx = await this.loadIndex(this.lastFetcher);
        return idx?.get(this.currentMapId) ?? null;
    }

    public stop(): void {
        if (this.audio === null)
            return;
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
    }

    public destroy(): void {
        this.destroyed = true;
        this.sceneGeneration++;
        this.currentMapId = null;
        this.lastFetcher = null;
        this.stop();
    }

    private async applyCurrent(dataFetcher: DataFetcher, generation: number): Promise<void> {
        if (this.currentMapId === null)
            return;
        const mapId = this.currentMapId;
        const url = this.trackOverride !== null
            ? dataFetcher.getDataURLForPath(`${this.pathBase}/bgm/${this.trackOverride}`)
            : await this.urlForMap(dataFetcher, mapId);
        if (this.destroyed || generation !== this.sceneGeneration || mapId !== this.currentMapId)
            return;
        if (!Bgm.enabled)
            return;
        const a = this.ensureAudio();
        if (url === null) {
            a.pause();
            a.removeAttribute("src");
            a.load();
            return;
        }
        if (a.src === url) {
            a.play().catch(() => { /* browser autoplay needs a user gesture */ });
            return;
        }
        a.src = url;
        a.volume = Bgm.currentVolume;
        try {
            await a.play();
        } catch {
            // browser autoplay needs a user gesture
        }
        if (this.destroyed)
            this.stop();
    }
}
