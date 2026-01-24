import type { ReadonlyVec3 } from "gl-matrix";
import { type DNAFile, DNASceneBuilder, DNAStorage } from "../dna";
import type { ToontownLoader } from "../Loader";
import {
  CompassEffect,
  CompassEffectProperties,
  CullBinAttrib,
  DepthTestAttrib,
  DepthWriteAttrib,
  DepthWriteMode,
  PandaCompareFunc,
  type PandaNode,
} from "../nodes";
import {
  type AnimatedProp,
  type Avatar,
  animatedPropMap,
  GenericAnimatedBuilding,
  GenericAnimatedProp,
  HydrantInteractiveProp,
  MailboxInteractiveProp,
  TrashcanInteractiveProp,
} from "../objects";
import { NPCFisherman } from "../objects/NPCFisherman";
import { NPCPartyPerson } from "../objects/NPCPartyPerson";
import { NPCToonBase } from "../objects/NPCToonBase";
import { PartyGate } from "../objects/PartyGate";
import { NPC_TOONS, NPC_TOONS_BY_ZONE, ToonNpcType } from "../objects/ToonData";
import type { SceneLoader } from ".";

const GLOBAL_STORAGE_DNA = "phase_4/dna/storage";
const TOWN_STORAGE_DNA = "phase_5/dna/storage_town";

export class BaseLoader implements SceneLoader {
  protected storage = new DNAStorage();
  protected sceneBuilder: DNASceneBuilder;
  protected storageDNAFiles: string[] = [GLOBAL_STORAGE_DNA, TOWN_STORAGE_DNA];
  protected dnaFile: string | null = null;
  protected skyFile: string | null = null;
  public musicFile: string | null = null;

  protected avatars: Avatar[] = [];
  protected animProps: AnimatedProp[] = [];

  constructor(
    protected scene: PandaNode,
    protected loader: ToontownLoader,
  ) {
    this.sceneBuilder = new DNASceneBuilder(this.storage, this.loader);
  }

  async load(): Promise<void> {
    await this.loadDna();
    await this.loadSky();
    // await this.loadMusic();
    await this.loadAnimProps();
    this.fixDoors();
  }

  enter(): void {
    // this.avatars.forEach((avatar) => avatar.enter());
    this.animProps.forEach((prop) => prop.enter());
  }

  exit(): void {
    // this.avatars.forEach((avatar) => avatar.enter());
    this.animProps.forEach((prop) => prop.exit());
  }

  getDropPoints(): readonly [ReadonlyVec3, number][] {
    return [];
  }

  public async loadDna(): Promise<void> {
    const dnaPromises: Promise<DNAFile>[] = [];
    for (const dnaPath of this.storageDNAFiles) {
      dnaPromises.push(this.loader.loadDNAInternal(dnaPath));
    }
    if (this.dnaFile) {
      dnaPromises.push(this.loader.loadDNAInternal(this.dnaFile));
    }
    let sceneFile: DNAFile | null = null;
    for (const dnaFile of await Promise.all(dnaPromises)) {
      this.storage.loadFromDNAFile(dnaFile);
      if (this.dnaFile) sceneFile = dnaFile;
    }
    if (sceneFile) await this.sceneBuilder.build(sceneFile, this.scene);
  }

  private async loadSky(): Promise<void> {
    if (!this.skyFile) return;
    const camera = this.scene.find("camera");
    if (!camera) {
      console.warn("Camera node not found in scene; cannot attach sky.");
      return;
    }
    const model = await this.loader.loadModel(this.skyFile);
    const instance = model.cloneTo(this.scene);
    instance.tags.set("sky", "Regular");
    instance.setEffect(
      CompassEffect.create(CompassEffectProperties.Position, camera),
    );
    instance.setAttrib(CullBinAttrib.create("background", 100));
    instance.setAttrib(DepthTestAttrib.create(PandaCompareFunc.None));
    instance.setAttrib(DepthWriteAttrib.create(DepthWriteMode.Off));
    // Ensure sky renders before clouds
    instance.find("**/Sky")?.reparentTo(instance, -1);
  }

  protected async spawnNpcs(root: PandaNode, zoneId: number): Promise<void> {
    let posIdx = 0;
    const promises: Promise<void>[] = [];
    for (const npcToonIdx of NPC_TOONS_BY_ZONE[zoneId] ?? []) {
      const npcToon = NPC_TOONS[npcToonIdx];
      const npcToonType = npcToon[4];
      let toon: NPCToonBase;
      if (npcToonType === ToonNpcType.Partyperson) {
        toon = new NPCPartyPerson(root, npcToonIdx, posIdx);
      } else if (npcToonType === ToonNpcType.Fisherman) {
        toon = new NPCFisherman(root, npcToonIdx, posIdx);
      } else {
        toon = new NPCToonBase(root, npcToonIdx, posIdx);
      }
      toon.name = npcToon[1];
      promises.push(
        (async () => {
          await toon.generate(npcToon[2]);
          await toon.init();
        })(),
      );
      this.avatars.push(toon);
      posIdx++;
    }
    await Promise.all(promises);
  }

  private async loadAnimProps(): Promise<void> {
    const animPropNodes = this.scene.findAllMatches("**/animated_prop_*");
    for (const node of animPropNodes) {
      let prop: AnimatedProp;
      if (node.name.startsWith("animated_prop_generic")) {
        prop = new GenericAnimatedProp(node);
      } else {
        const className = node.name.substring(
          "animated_prop_".length,
          node.name.length - "_DNARoot".length,
        );
        const factory = animatedPropMap.get(className);
        if (!factory) {
          console.warn(`No factory found for class ${className}`);
          continue;
        }
        prop = new factory(node);
      }
      this.animProps.push(prop);
    }
    const interactivePropNodes = this.scene.findAllMatches(
      "**/interactive_prop_*",
    );
    for (const node of interactivePropNodes) {
      if (node.name.includes("hydrant")) {
        this.animProps.push(new HydrantInteractiveProp(node));
      } else if (node.name.includes("trashcan")) {
        this.animProps.push(new TrashcanInteractiveProp(node));
      } else if (node.name.includes("mailbox")) {
        this.animProps.push(new MailboxInteractiveProp(node));
      } else {
        this.animProps.push(new GenericAnimatedProp(node));
      }
    }
    const animatedBuildingNodes = this.scene.findAllMatches(
      "**/*:animated_building_*;-h",
    );
    for (const node of animatedBuildingNodes) {
      this.animProps.push(new GenericAnimatedBuilding(node));
    }
    const partyGateNode = this.scene.find("**/*party_gate*");
    if (partyGateNode) {
      this.animProps.push(new PartyGate(partyGateNode));
    }
    await Promise.all(this.animProps.map((prop) => prop.init()));
  }

  // Hack for overlapping door frames
  private fixDoors(): void {
    this.scene.findAllMatches("**/doorFrameHoleLeft").forEach((node) => {
      node.hide();
    });
    this.scene.findAllMatches("**/doorFrameHoleRight").forEach((node) => {
      node.hide();
    });
  }
}
