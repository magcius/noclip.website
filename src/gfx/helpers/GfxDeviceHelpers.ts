
import { GfxDevice, GfxViewportOrigin } from "../platform/GfxPlatform";

export function gfxDeviceNeedsFlipY(device: GfxDevice): boolean {
    const vendorInfo = device.queryVendorInfo();
    return vendorInfo.viewportOrigin === GfxViewportOrigin.LowerLeft;
}
