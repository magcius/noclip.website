
import { PeekZManager } from "../ZeldaWindWaker/d_dlst_peekZ.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInstExecutionOrder, GfxRenderInstList, gfxRenderInstCompareNone, gfxRenderInstCompareSortKey } from "../gfx/render/GfxRenderInstManager.js";

export type dDlst_list_Set = [GfxRenderInstList, GfxRenderInstList];

export class dDlst_list_c {
    public current: dDlst_list_Set;

    public sky: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    public indirect: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    // This really should be .sky[15], but we don't have multiple buffers in the render inst list...
    public main: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public wetherEffect = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public wetherEffectSet: dDlst_list_Set = [
        this.wetherEffect, this.wetherEffect,
    ]
    public effect: GfxRenderInstList[] = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
    ];
    public ui: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];

    public alphaModel = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public peekZ = new PeekZManager();

    constructor() {
        this.current = [this.main[0], this.main[1]];
    }

    public setOpaDrawList(list: GfxRenderInstList): void {
        this.current[0] = list;
    }

    public setXluDrawList(list: GfxRenderInstList): void {
        this.current[1] = list;
    }

    public setOpaList(): void { this.setOpaDrawList(this.main[0]); }
    public setXluList(): void { this.setXluDrawList(this.main[1]); }

    public setOpaListSky(): void { this.setOpaDrawList(this.sky[0]); }
    public setXluListSky(): void { this.setXluDrawList(this.sky[1]); }

    public setOpaListInvisible(): void { this.setOpaDrawList(this.indirect[0]); }
    public setXluListInvisible(): void { this.setXluDrawList(this.indirect[1]); }

    public setOpaListBG(): void { this.setOpaDrawList(this.main[0]); }
    public setXluListBG(): void { this.setXluDrawList(this.main[1]); }

    public dComIfGd_setListBG(): void {
        this.setOpaListBG();
        this.setXluListBG();
    }

    public dComIfGd_setListInvisisble(): void {
        this.setOpaListInvisible();
        this.setXluListInvisible();
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
    }
}
