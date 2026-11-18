import { DataFetcher } from '../DataFetcher.js';
import { ProgressMeter } from '../SceneBase.js';

export class BWLoading {
    public cancelled = false;
    private original: ProgressMeter | null;
    private downloadMeter: ProgressMeter;
    private progress = 0;

    constructor(private fetcher: DataFetcher, private onCancel: () => void = () => {}) {
        this.original = fetcher.progressMeter;
        this.downloadMeter = { loadProgress: 0, setProgress: (value) => this.setProgress(value * 0.35) };
        fetcher.progressMeter = this.downloadMeter;
        this.setProgress(0);
    }

    public setProgress(value: number): void {
        if (this.cancelled) return;
        this.progress = Math.max(this.progress, Math.min(value, 1));
        this.original?.setProgress(this.progress);
    }

    public async yield(): Promise<void> {
        await new Promise<void>((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
        if (this.cancelled) throw new DOMException('Scene loading cancelled', 'AbortError');
    }

    public restore(): void {
        if (this.fetcher.progressMeter === this.downloadMeter) this.fetcher.progressMeter = this.original;
    }

    public destroy(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        this.restore();
        this.onCancel();
    }
}
