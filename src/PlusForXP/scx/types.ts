export namespace SCX {

	type Named = { name: string };
	type Animatable = { animations?: KeyframeAnimation[] };

	export type Vec2 = [number, number];
	export type Vec3 = [number, number, number];

	export type Shader = Named & {
		id: number,
		ambient: Vec3,
		diffuse: Vec3,
		specular: Vec3,
		opacity: number,
		luminance: number,
		texture?: string,
		blend: number
	};

	export type Global = {
		animinterval: Vec2,
		framerate: number,
		ambient: Vec3
	};

	export type Transform = {
		trans: Vec3,
		rot: Vec3,
		scale: Vec3
	};

	export type KeyframeAnimationChannel = 
		"xtrans" | "ytrans" | "ztrans" |
		"xrot" | "yrot" | "zrot" |
		"xscale" | "yscale" | "zscale";

	export type Interpolation = "linear" | "hermite";

	export type Extrapolation = "cycle" | "constant";

	export type KeyframeAnimation = {
		channel: KeyframeAnimationChannel,
		extrappre: Extrapolation,
		extrappost: Extrapolation,
		interp: Interpolation,
		keyframes: Keyframe[]
	};

	export type Keyframe = {
		time: number,
		value: number,
		tangentIn?: number,
		tangentOut?: number
	};

	export type Camera = Named & Animatable & {
		fov: number,
		nearclip: number,
		farclip: number,
		pos: Vec3,
		targetpos: Vec3
	};

	export type LightType = "spot" | "directional" | "point" | "ambient";

	export type Light = Named & Partial<{
		type: LightType
		pos: Vec3,
		dir: Vec3,
		umbra: number,
		penumbra: number,
		attenstart: number,
		attenend: number,
		color: Vec3,
		intensity: number,
		off: boolean
	}>;

	export type Polygon = {
		verts: number[],
		shader: number,
		smgroup: number
	};

	export type Mesh = {
		shader: number, 
		vertexcount: number,
		normals: number[],
		texCoords: number[],
		positions: number[],
		
		indices: number[],
	};

	export type PolygonMesh = Mesh & {
		polycount?: number, 
		polygons?: Polygon[]
	}

	export type Object = Named & Animatable & {
		parent?: string,
		transforms: Transform[],
		meshes: Mesh[]
	};

	export type Scene = {
		shaders: Shader[]
		globals: Global[]
		cameras: Camera[]
		lights: Light[]
		objects: Object[]
	};
};