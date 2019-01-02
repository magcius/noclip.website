
import { DeswizzleRequest, deswizzle } from "../gx2_swizzle";

onmessage = (e: MessageEvent) => {
    const req: DeswizzleRequest = e.data;
    const deswizzledSurface = deswizzle(req.surface, req.buffer, req.mipLevel);
    // @ts-ignore
    postMessage(deswizzledSurface, [deswizzledSurface.pixels.buffer]);
};
