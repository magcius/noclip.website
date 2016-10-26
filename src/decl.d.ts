
// Workaround for not having gl-matrix typings available.
declare interface Window {
    mat4: any;
    vec3: any;
}

// Workaround for no Promise in stdlib.
declare interface Window {
    Promise: any;
}

declare interface Window {
    main: any;
}
