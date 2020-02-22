import { ModelRenderer, buildTransform } from "./render";
import { ObjectSpawn, ObjectDef, findGroundHeight, SpawnType, CollisionTree } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3 } from "gl-matrix";

const posScratch = vec3.create();
const scaleScratch = vec3.create();
export class Actor extends ModelRenderer {
    constructor(renderData: RenderData, private spawn: ObjectSpawn, private def: ObjectDef, collision: CollisionTree) {
        super(renderData, def.nodes, def.animations);
        // set transform components
        vec3.copy(posScratch, spawn.pos);
        if (def.spawn === SpawnType.GROUND)
            posScratch[1] = findGroundHeight(collision, spawn.pos[0], spawn.pos[2]);

        vec3.mul(scaleScratch, def.scale, spawn.scale);
        buildTransform(this.modelMatrix, posScratch, spawn.euler, scaleScratch);

        // for now, randomly choose an animation
        const x = 15;
        if (def.animations.length > 0)
            this.setAnimation(0);//Math.floor(Math.random() * def.animations.length));
    }
}