import { type ReadonlyVec4, vec3, vec4 } from "gl-matrix";
import { getLoader } from "../Common";
import { CharacterJoint, TextureAttrib } from "../nodes";
import { Avatar } from "./Avatar";
import {
  ALL_ANIMATIONS,
  ALL_COLORS,
  ALL_SPECIES,
  BOY_SHORTS,
  BottomsType,
  CLOTHES_COLORS,
  DOG_MUZZLE_MODELS,
  EYELASH_MODELS,
  GIRL_BOTTOMS,
  HEAD_HEIGHTS,
  HEAD_MODEL_PREFIXES,
  LEG_HEIGHTS,
  LEG_MODEL_PREFIXES,
  SHIRTS,
  SLEEVES,
  TOON_BODY_SCALES,
  TORSO_HEIGHTS,
  TORSO_MODEL_PREFIXES,
  type ToonDnaCompact,
  type ToonDnaInner,
  ToonGender,
  ToonSpecies,
} from "./ToonData";

export class Toon extends Avatar {
  private _species: ToonSpecies;
  private _gender: ToonGender;

  override async init(): Promise<void> {
    await super.init();

    const legsBundle = this.getPartBundle("legs");
    if (legsBundle) {
      const joint = legsBundle.findChild("joint_nameTag");
      if (joint instanceof CharacterJoint) {
        joint.clearNetTransforms();
        joint.addNetTransform(this._nametag3d);
      }
    }
  }

  async generate(dnaIn: ToonDnaCompact): Promise<void> {
    if (dnaIn[0] === "r") {
      console.warn("Random NPCs not implemented");
      return;
    }
    const dna = dnaIn as ToonDnaInner;
    this._species = dna[0][0] as ToonSpecies;
    if (!ALL_SPECIES.includes(this._species)) {
      throw new Error(`Invalid species: ${this._species}`);
    }
    this._gender = dna[3];
    await this.loadHead(dna[0], ALL_COLORS[dna[7]] ?? ALL_COLORS[0]);
    await this.loadTorso(
      dna[1],
      ALL_COLORS[dna[4]] ?? ALL_COLORS[0],
      ALL_COLORS[dna[5]] ?? ALL_COLORS[0],
      dna[12],
    );
    await this.loadLegs(dna[2], ALL_COLORS[dna[6]] ?? ALL_COLORS[0]);
    await this.loadClothes(
      dna[1],
      dna[8],
      dna[9],
      dna[10],
      dna[11],
      dna[12],
      dna[13],
    );

    this.attach("head", "torso", "def_head");
    this.attach("torso", "legs", "joint_hips");

    // Add body scale to legs, which will be inherited by attached parts
    const legs = this.getPart("legs");
    if (!legs) throw new Error("Legs not found");
    const bodyScale = TOON_BODY_SCALES[this._species];
    legs.scale = vec3.fromValues(bodyScale, bodyScale, bodyScale);

    let height = 0;
    height += LEG_HEIGHTS[dna[2]] * bodyScale;
    height += TORSO_HEIGHTS[dna[1]] * bodyScale;
    height += HEAD_HEIGHTS[dna[0]];
    this.setHeight(height);
  }

  private async loadHead(style: string, color: ReadonlyVec4): Promise<void> {
    const headLen = style[1];
    const muzzleLen = style[2];

    // let headHeight: number;
    // if (headLen === "s") {
    //   headHeight = 0.5;
    // } else if (headLen === "l") {
    //   headHeight = 0.75;
    // } else {
    //   throw new Error(`Invalid head length: ${headLen}`);
    // }

    // Try the fully qualified head model, then just the species
    let headModelPrefix = HEAD_MODEL_PREFIXES[style];
    let headCombinedModel = false;
    if (!headModelPrefix) {
      headModelPrefix = HEAD_MODEL_PREFIXES[this._species];
      headCombinedModel = true;
    }
    if (!headModelPrefix) {
      throw new Error(`Unknown head model: ${style}`);
    }
    await this.loadModel(`phase_3${headModelPrefix}1000`, "head");

    const head = this.getPart("head");
    if (!head) throw new Error("Failed to load head");

    if (headCombinedModel) {
      // Hide specific parts depending on the head and muzzle length
      const reversed =
        this._species === ToonSpecies.Rabbit && headLen !== muzzleLen;

      // Swap ears (rabbit ears are reversed; ducks and horses only have one ear type)
      if (
        this._species !== ToonSpecies.Duck &&
        this._species !== ToonSpecies.Horse
      ) {
        if ((headLen === "s" && !reversed) || (headLen === "l" && reversed)) {
          head.find("**/ears-long")?.removeNode();
        } else {
          head.find("**/ears-short")?.removeNode();
        }
      }

      // Swap eyes (rabbits only have one eye type)
      if (this._species !== ToonSpecies.Rabbit) {
        if (headLen === "s") {
          head.find("**/eyes-long")?.removeNode();
        } else {
          head.find("**/eyes-short")?.removeNode();
        }
      }

      // Swap pupils (dogs only have one pupil type)
      if (this._species !== ToonSpecies.Dog) {
        if (headLen === "s") {
          head.find("**/joint_pupilL_long")?.removeNode();
          head.find("**/joint_pupilR_long")?.removeNode();
        } else {
          head.find("**/joint_pupilL_short")?.removeNode();
          head.find("**/joint_pupilR_short")?.removeNode();
        }
      }

      // Swap head parts
      if (headLen === "s") {
        head.find("**/head-long")?.removeNode();
        head.find("**/head-front-long")?.removeNode();
      } else {
        head.find("**/head-short")?.removeNode();
        head.find("**/head-front-short")?.removeNode();
      }

      // Swap muzzles (rabbit muzzles are reversed)
      if ((muzzleLen === "s" && !reversed) || (muzzleLen === "l" && reversed)) {
        head.findAllMatches("**/muzzle-long*").forEach((node) => {
          node.removeNode();
        });
      } else {
        head.findAllMatches("**/muzzle-short*").forEach((node) => {
          node.removeNode();
        });
      }
    }

    // Load dog muzzles (separate)
    if (this._species === ToonSpecies.Dog) {
      const model = await getLoader().loadModel(
        `phase_3${DOG_MUZZLE_MODELS[style]}1000`,
      );
      model.cloneTo(head);
    }

    // Stash extra muzzle parts
    const muzzleParts = head.findAllMatches("**/muzzle*");
    for (const part of muzzleParts) {
      if (part.name === "muzzle" || part.name.endsWith("neutral")) continue;
      part.stash();
    }

    // Load eyelashes
    if (this._gender === ToonGender.Female) {
      const eyelashModel = await getLoader().loadModel(
        `phase_3${EYELASH_MODELS[this._species]}`,
      );
      if (headLen === "s") {
        eyelashModel.find("**/open-short")?.cloneTo(head);
        eyelashModel.find("**/close-short")?.cloneTo(head);
      } else {
        eyelashModel.find("**/open-long")?.cloneTo(head);
        eyelashModel.find("**/close-long")?.cloneTo(head);
      }
    }

    // Set head color
    for (const part of head.findAllMatches("**/head*")) {
      part.setColor(color);
    }

    // Set ear color for certain species
    if (
      this._species === ToonSpecies.Cat ||
      this._species === ToonSpecies.Rabbit ||
      this._species === ToonSpecies.Bear ||
      this._species === ToonSpecies.Mouse ||
      this._species === ToonSpecies.Pig
    ) {
      for (const part of head.findAllMatches("**/ear?-*")) {
        part.setColor(color);
      }
    }

    // Load animations for dog heads only
    if (this._species === ToonSpecies.Dog) {
      await this.loadAnims(buildAnimDict(headModelPrefix), "head", {
        allowMissing: true,
      });
    }
  }

  private async loadTorso(
    style: string,
    armColor: ReadonlyVec4,
    glovesColor: ReadonlyVec4,
    bottomTextureStyle: number,
  ): Promise<void> {
    if (this._gender === ToonGender.Female) {
      const bottoms = GIRL_BOTTOMS[bottomTextureStyle];
      if (!bottoms)
        throw new Error(`Invalid bottom texture style: ${bottomTextureStyle}`);
      // Adjust torso style based on bottom type
      style = `${style[0]}${bottoms[1] === BottomsType.Skirt ? "d" : "s"}`;
    }

    const torsoModelPrefix = TORSO_MODEL_PREFIXES[style];
    if (!torsoModelPrefix) throw new Error(`Invalid torso style: ${style}`);
    await this.loadModel(`phase_3${torsoModelPrefix}1000`, "torso");
    await this.loadAnims(buildAnimDict(torsoModelPrefix), "torso", {
      allowMissing: true,
    });
    this.pose("neutral", 0, "torso");

    // Set torso color
    const torso = this.getPart("torso");
    if (!torso) throw new Error(`Failed to load torso`);
    if (style.length === 1) {
      // Naked torso
      torso.findAllMatches("**/torso*").forEach((part) => {
        part.setColor(armColor);
      });
    }
    torso.findAllMatches("**/arms").forEach((part) => {
      part.setColor(armColor);
    });
    torso.findAllMatches("**/neck").forEach((part) => {
      part.setColor(armColor);
    });

    // Set gloves color
    torso.findAllMatches("**/hands").forEach((part) => {
      part.setColor(glovesColor);
    });
  }

  private async loadClothes(
    torsoStyle: string,
    topTextureStyle: number,
    topTextureColor: number,
    sleeveTextureStyle: number,
    sleeveTextureColor: number,
    bottomTextureStyle: number,
    bottomTextureColor: number,
  ): Promise<void> {
    if (torsoStyle.length === 1) {
      // Naked torso
      return;
    }

    const topTexturePath = SHIRTS[topTextureStyle] ?? SHIRTS[0];
    const topColor = CLOTHES_COLORS[topTextureColor] ?? CLOTHES_COLORS[0];

    const sleeveTexturePath = SLEEVES[sleeveTextureStyle] ?? SLEEVES[0];
    const sleeveColor = CLOTHES_COLORS[sleeveTextureColor] ?? CLOTHES_COLORS[0];

    let bottomsTexturePath: string;
    if (this._gender === ToonGender.Male) {
      bottomsTexturePath = BOY_SHORTS[bottomTextureStyle] ?? BOY_SHORTS[0];
    } else {
      bottomsTexturePath = (GIRL_BOTTOMS[bottomTextureStyle] ??
        GIRL_BOTTOMS[0])[0];
    }
    const bottomColor = CLOTHES_COLORS[bottomTextureColor] ?? CLOTHES_COLORS[0];

    const torso = this.getPart("torso");
    if (!torso) throw new Error("No torso part");

    const top = torso.find("**/torso-top");
    if (top) {
      top.setAttrib(TextureAttrib.make(topTexturePath), 1);
      top.setColor(topColor);
    }

    const sleeve = torso.find("**/sleeves");
    if (sleeve) {
      sleeve.setAttrib(TextureAttrib.make(sleeveTexturePath), 1);
      sleeve.setColor(sleeveColor);
    }

    for (const bottom of torso.findAllMatches("**/torso-bot")) {
      bottom.setAttrib(TextureAttrib.make(bottomsTexturePath), 1);
      bottom.setColor(bottomColor);
    }

    const caps = torso.find("**/torso-bot-cap");
    if (caps) {
      caps.setColor(
        vec4.fromValues(
          bottomColor[0] * 0.5,
          bottomColor[1] * 0.5,
          bottomColor[2] * 0.5,
          1,
        ),
      );
    }
  }

  private async loadLegs(style: string, color: ReadonlyVec4): Promise<void> {
    const legModelPrefix = LEG_MODEL_PREFIXES[style];
    if (!legModelPrefix) throw new Error(`Invalid legs style: ${style}`);
    await this.loadModel(`phase_3${legModelPrefix}1000`, "legs");
    await this.loadAnims(buildAnimDict(legModelPrefix), "legs", {
      allowMissing: true,
    });
    this.pose("neutral", 0, "legs");

    // Set legs color
    const legs = this.getPart("legs");
    if (!legs) throw new Error(`Failed to load legs`);
    legs.findAllMatches("**/legs").forEach((part) => {
      part.setColor(color);
    });
    legs.findAllMatches("**/feet").forEach((part) => {
      part.setColor(color);
    });

    // Hide shoes/boots
    // I don't know why these are here and I can't find any references to them in the code
    legs.findAllMatches("**/shoes").forEach((part) => {
      part.stash();
    });
    legs.findAllMatches("**/boots*").forEach((part) => {
      part.stash();
    });
  }
}

function buildAnimDict(prefix: string): Record<string, string> {
  const animDict: Record<string, string> = {};
  for (const [phase, anims] of Object.entries(ALL_ANIMATIONS)) {
    for (const [name, anim] of Object.entries(anims)) {
      animDict[name] = `${phase}${prefix}${anim}`;
    }
  }
  return animDict;
}
