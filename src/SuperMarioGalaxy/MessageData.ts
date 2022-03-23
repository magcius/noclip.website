
import ArrayBufferSlice from "../ArrayBufferSlice";
import { JSystemFileReaderHelper } from "../Common/JSYSTEM/J3D/J3DLoader";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { assert, assertExists, hexzero0x, readString } from "../util";
import { createCsvParser } from "./JMapInfo";
import { SceneObjHolder } from "./Main";

export const enum JUTMesgFlowNodeType { Message = 1, Branch = 2, Event = 3 }

export interface JUTMesgFlowNodeMessage {
    type: JUTMesgFlowNodeType.Message;
    messageGroupID: number;
    messageIndex: number;
    nextNodeIndex: number;
    nextGroupID: number;
}

export interface JUTMesgFlowNodeBranch {
    type: JUTMesgFlowNodeType.Branch;
    numBranch: number;
    nodeData: number;
    userParam: number;
    branchInfoIndex: number;
}

export interface JUTMesgFlowNodeEvent {
    type: JUTMesgFlowNodeType.Event;
    eventID: number;
    branchInfoIndex: number;
    userParam: number;
}

export type JUTMesgFlowNode = JUTMesgFlowNodeMessage | JUTMesgFlowNodeBranch | JUTMesgFlowNodeEvent;

export class TalkMessageInfo {
    public message: string | null;
    public cameraSetID: number;
    public soundID: number;
    public cameraType: number;
    public talkType: number;
    public balloonType: number;
    public messageAreaId: number;
    public messageHistId: number;
}

export class MessageData {
    private messageIds: string[];

    private offs = 0;
    private inf1: ArrayBufferSlice;
    private dat1: ArrayBufferSlice;
    private flw1: ArrayBufferSlice;

    private numStrings: number;
    private inf1ItemSize: number;

    private numNodes: number;
    private numBranchIndex: number;
    private branchIndex: Uint16Array;

    constructor(messageArc: JKRArchive) {
        const messageIds = createCsvParser(messageArc.findFileData(`MessageId.tbl`)!);
        this.messageIds = messageIds.mapRecords((iter) => {
            return assertExists(iter.getValueString('MessageId'));
        });

        const mesgData = messageArc.findFileData(`Message.bmg`)!;
        this.offs = mesgData.byteOffset;
        const readerHelper = new JSystemFileReaderHelper(mesgData);
        assert(readerHelper.magic === 'MESGbmg1');

        this.inf1 = readerHelper.nextChunk('INF1');
        this.dat1 = readerHelper.nextChunk('DAT1');
        this.flw1 = readerHelper.nextChunk('FLW1');

        const inf1View = this.inf1.createDataView();
        this.numStrings = inf1View.getUint16(0x08);
        this.inf1ItemSize = inf1View.getUint16(0x0A);

        const flw1View = this.flw1.createDataView();
        this.numNodes = flw1View.getUint16(0x08);
        this.numBranchIndex = flw1View.getUint16(0x0A);
    }

    private getStringByIndex(i: number): string {
        const inf1View = this.inf1.createDataView();
        const inf1Offs = 0x10 + (i * this.inf1ItemSize) + 0x00;
        const dat1Offs = 0x08 + inf1View.getUint32(inf1Offs);

        const view = this.dat1.createDataView();
        let idx = dat1Offs;
        let S = '';
        while (true) {
            const c = view.getUint16(idx + 0x00);
            if (c === 0)
                break;
            if (c === 0x001A) {
                // Escape sequence.
                const size = view.getUint8(idx + 0x02);
                const escapeKind = view.getUint8(idx + 0x03);

                if (escapeKind === 0x05) {
                    // Current character name -- 'Mario' or 'Luigi'. We use 'Mario'
                    S += "Mario";
                } else {
                    console.warn(`Unknown escape kind ${escapeKind}`);
                }

                idx += size;
            } else {
                S += String.fromCharCode(c);
                idx += 0x02;
            }
        }

        return S;
    }

    private findMessageIndex(id: string): number {
        return this.messageIds.indexOf(id);
    }

    public getStringById(id: string): string | null {
        const index = this.findMessageIndex(id);
        if (index < 0)
            return null;
        return this.getStringByIndex(index);
    }

    private parseMessageStr(dataOffs: number): string {
        const dat1 = this.dat1.createDataView();
        let dat1Offs = 0x08 + dataOffs;

        let S = '';
        let escapeNumChars = 0;
        while (true) {
            const c = dat1.getUint16(dat1Offs + 0x00);
            if (escapeNumChars === 0) {
                if (c === 0x001A) {
                    // Tag.
                    escapeNumChars = (dat1.getUint8(dat1Offs + 0x02) >>> 1);
                } else if (c === 0x0000) {
                    break;
                }
            } else {
                escapeNumChars--;
            }
            S += String.fromCharCode(c);
            dat1Offs += 0x02;
        }
        return S;
    }

    public getMessage(dst: TalkMessageInfo, groupID: number, index: number): void {
        const inf1 = this.inf1.createDataView();
        const inf1Offs = 0x10 + this.inf1ItemSize * index;

        const dataOffs = inf1.getUint32(inf1Offs + 0x00);
        dst.message = this.parseMessageStr(dataOffs);
        dst.cameraSetID = inf1.getUint16(inf1Offs + 0x04);
        dst.soundID = inf1.getUint8(inf1Offs + 0x06);
        dst.cameraType = inf1.getUint8(inf1Offs + 0x07);
        dst.talkType = inf1.getUint8(inf1Offs + 0x08);
        dst.balloonType = inf1.getUint8(inf1Offs + 0x09);
        dst.messageAreaId = inf1.getUint8(inf1Offs + 0x0A);
        dst.messageHistId = inf1.getUint8(inf1Offs + 0x0B);
    }

    private parseNode(offs: number): JUTMesgFlowNode {
        const flw1 = this.flw1.createDataView();
        const type = flw1.getUint8(offs + 0x00);
        if (type === JUTMesgFlowNodeType.Message) {
            const messageGroupID = flw1.getUint8(offs + 0x01);
            const messageIndex = flw1.getUint16(offs + 0x02);
            const nextNodeIndex = flw1.getUint16(offs + 0x04);
            const nextGroupID = flw1.getUint8(offs + 0x06);
            return { type, messageGroupID, messageIndex, nextNodeIndex, nextGroupID };
        } else if (type === JUTMesgFlowNodeType.Branch) {
            const numBranch = flw1.getUint8(offs + 0x01);
            const nodeData = flw1.getUint16(offs + 0x02);
            const userParam = flw1.getUint16(offs + 0x04);
            const branchInfoIndex = flw1.getUint16(offs + 0x06);
            return { type, numBranch, nodeData, userParam, branchInfoIndex };
        } else if (type === JUTMesgFlowNodeType.Event) {
            const eventID = flw1.getUint8(offs + 0x01);
            const branchInfoIndex = flw1.getUint16(offs + 0x02);
            const userParam = flw1.getUint32(offs + 0x04);
            return { type, eventID, branchInfoIndex, userParam };
        } else {
            throw "whoops";
        }
    }

    public getMessageDirect(dst: TalkMessageInfo, messageId: string): boolean {
        const index = this.findMessageIndex(messageId);
        if (index < 0)
            return false;

        this.getMessage(dst, 0, index);
        return true;
    }

    public getNode(index: number): JUTMesgFlowNode {
        return this.parseNode(0x10 + index * 0x08);
    }

    private getBranchNodeIndex(branch: number): number {
        const flw1 = this.flw1.createDataView();
        return flw1.getUint16(0x10 + this.numNodes * 0x08 + branch * 0x02);
    }

    public isValidBranchNode(branch: number): boolean {
        return this.getBranchNodeIndex(branch) !== 0xFFFF;
    }

    public getBranchNode(branch: number): JUTMesgFlowNode | null {
        const nodeIndex = this.getBranchNodeIndex(branch);
        if (nodeIndex === 0xFFFF)
            return null;
        return this.getNode(nodeIndex);
    }

    public findNode(id: string): JUTMesgFlowNodeMessage | null {
        const index = this.findMessageIndex(id);
        if(index < 0)
            return null;

        const flw1 = this.flw1.createDataView();
        let offs = 0x10;
        for (let i = 0; i < this.numNodes; i++, offs += 0x08) {
            const type = flw1.getUint8(offs + 0x00);
            if (type !== JUTMesgFlowNodeType.Message)
                continue;
            const messageIndex = flw1.getUint16(offs + 0x02);
            if (messageIndex === index)
                return this.parseNode(offs) as JUTMesgFlowNodeMessage;
        }

        return null;
    }
}

export class MessageHolder {
    public gameData: MessageData | null = null;
    public sceneData: MessageData | null = null;

    constructor(sceneObjHolder: SceneObjHolder) {
        const gameArchiveName = `UsEnglish/MessageData/Message.arc`;
        if (sceneObjHolder.modelCache.isArchiveExist(gameArchiveName))
            this.gameData = new MessageData(sceneObjHolder.modelCache.getArchive(gameArchiveName)!);

        this.sceneData = this.gameData;
    }
}

export function getLayoutMessageDirect(sceneObjHolder: SceneObjHolder, messageId: string): string | null {
    if (sceneObjHolder.messageHolder.gameData === null)
        return null;
    return sceneObjHolder.messageHolder.gameData.getStringById(messageId);
}
