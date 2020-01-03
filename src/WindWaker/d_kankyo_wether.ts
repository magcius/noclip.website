
import { dScnKy_env_light_c, dKy_efplight_set } from "./d_kankyo";
import { dGlobals } from "./zww_scenes";
import { cM_rndF } from "./SComponent";
import { vec3 } from "gl-matrix";
import { colorFromRGBA } from "../Color";

export function dKyw_rain_set(envLight: dScnKy_env_light_c, count: number): void {
    envLight.rainCount = count;
    envLight.rainCountOrig = count;
}

function dKyr_thunder_move(envLight: dScnKy_env_light_c): void {
    if (envLight.thunderStateTimer === 0) {
        envLight.thunderFlashTimer = 0;
        if (cM_rndF(1.0) > 0.007) {
            if ((envLight.thunderMode < 10) && cM_rndF(1.0) < 0.005) {
                // TODO(jstpierre): what is this?
                vec3.set(envLight.thunderLightInfluence.pos, 1000, 1000, 1000);
                colorFromRGBA(envLight.thunderLightInfluence.color, 0, 0, 0);
                envLight.thunderLightInfluence.power = 90000.0;
                envLight.thunderLightInfluence.fluctuation = 150.0;
                dKy_efplight_set(envLight, envLight.thunderLightInfluence);
                envLight.thunderStateTimer++;
            }
        } else {
            envLight.thunderStateTimer = 11;
        }
    }
}

function dKyr_thunder_init(envLight: dScnKy_env_light_c): void {
    envLight.thunderStateTimer = 0;
}

function wether_move_thunder(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    if (envLight.thunderActive) {
        dKyr_thunder_move(envLight);
    } else if (envLight.thunderMode !== 0) {
        dKyr_thunder_init(envLight);
        envLight.thunderActive = true;
    }
}

function wether_move_windline(globals: dGlobals): void {
}

function dKyw_wether_move(globals: dGlobals): void {
    wether_move_thunder(globals);
    wether_move_windline(globals);
}

function dKyw_wether_move_draw(globals: dGlobals): void {
    // TODO(jstpierre)
}

export function dKyeff_c__execute(globals: dGlobals): void {
    if (globals.stageName === 'Name') {
        // menu_vrbox_set();
    } else {
        dKyw_wether_move(globals);
    }
    dKyw_wether_move_draw(globals);
}
