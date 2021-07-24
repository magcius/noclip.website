import { readSurface } from "./archive";

export type SurfaceObject = ReturnType<typeof readSurface>;
export type Surface = SurfaceObject["surfaces"][0];
export type Curve = SurfaceObject["curves"][0];