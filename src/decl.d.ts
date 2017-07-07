
// Workaround for not having gl-matrix typings available.
declare interface Window {
    mat4: any;
    vec3: any;
}

declare interface Window {
    main: any;
}
