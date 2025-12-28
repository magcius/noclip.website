import { SceneGroup } from "../viewer.js";
import { maps } from "./maps.js";
import { machines } from "./machines.js";

export const pathBase = `KirbyAirRide`;

const sceneDescs = [
    "Maps",
    ...maps,
    "Machines",
    ...machines,
];

const id = `KirbyAirRide`;
const name = "Kirby Air Ride";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
