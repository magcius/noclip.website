import { SceneGroup } from "../viewer.js";
import { maps } from "./maps.js";

export const pathBase = `KirbyAirRide`;

const sceneDescs = [
    "Maps",
    ...maps,
];

const id = `KirbyAirRide`;
const name = "Kirby Air Ride";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
