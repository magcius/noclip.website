import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";

export class dRes_control_c {
    public resObj: dRes_info_c[] = [];
    public resStg: dRes_info_c[] = [];

    public getRes<T>(name: string, idx: number): T | null {
        return null;
    }
}

// a dRes_info_c represents a single archive
export class dRes_info_c {
    public loadResource(): void {
    }

    public setRes(rarc: JKRArchive): void {
    }
}
