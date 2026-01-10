// DNA file parser

import { vec3, vec4 } from "gl-matrix";
import { Lexer, type Token, TokenType } from "./lexer";
import {
  type BattleCell,
  type DNAAnimBuilding,
  type DNAAnimProp,
  type DNABaseline,
  type DNACornice,
  type DNADoor,
  type DNAFile,
  type DNAFlatBuilding,
  type DNAFlatDoor,
  type DNAGroup,
  type DNAInteractiveProp,
  type DNALandmarkBuilding,
  type DNANode,
  type DNANodeDef,
  type DNANodeTransform,
  type DNAProp,
  type DNASign,
  type DNASignGraphic,
  type DNASignText,
  type DNAStreet,
  type DNAVisGroup,
  type DNAWall,
  type DNAWindows,
  type ModelDeclaration,
  type StoredFont,
  type StoredNode,
  type StoredTexture,
  type SuitEdge,
  type SuitPoint,
  SuitPointType,
} from "./types";

export class DNAParser {
  private lexer: Lexer;
  private currentZoneId: string = "";

  constructor(input: string) {
    this.lexer = new Lexer(input);
  }

  parse(): DNAFile {
    const file: DNAFile = {
      suitPoints: [],
      models: [],
      storedTextures: [],
      storedFonts: [],
      root: [],
    };

    while (this.lexer.peek().type !== TokenType.EOF) {
      this.parseTopLevel(file);
    }

    return file;
  }

  private parseTopLevel(file: DNAFile): void {
    const token = this.lexer.peek();

    switch (token.type) {
      case TokenType.MODEL:
      case TokenType.HOOD_MODEL:
      case TokenType.PLACE_MODEL:
        file.models.push(this.parseModelDeclaration());
        break;

      case TokenType.STORE_TEXTURE:
        file.storedTextures.push(this.parseStoreTexture());
        break;

      case TokenType.STORE_FONT:
        file.storedFonts.push(this.parseStoreFont());
        break;

      case TokenType.STORE_SUIT_POINT:
        file.suitPoints.push(this.parseStoreSuitPoint());
        break;

      case TokenType.GROUP:
      case TokenType.VISGROUP:
      case TokenType.NODE:
      case TokenType.PROP:
      case TokenType.ANIM_PROP:
      case TokenType.INTERACTIVE_PROP:
      case TokenType.STREET:
      case TokenType.FLAT_BUILDING:
      case TokenType.LANDMARK_BUILDING:
      case TokenType.ANIM_BUILDING:
        file.root.push(this.parseNode());
        break;

      case TokenType.IDENTIFIER:
        // Skip unknown identifiers at top level (some files have informal comments)
        this.lexer.next();
        break;

      default:
        throw this.lexer.error(
          `Unexpected token at top level: ${TokenType[token.type]}`,
        );
    }
  }

  // ============================================
  // Resource Declarations
  // ============================================

  private parseModelDeclaration(): ModelDeclaration {
    const token = this.lexer.next();
    let modelType: "model" | "hood_model" | "place_model";

    switch (token.type) {
      case TokenType.MODEL:
        modelType = "model";
        break;
      case TokenType.HOOD_MODEL:
        modelType = "hood_model";
        break;
      case TokenType.PLACE_MODEL:
        modelType = "place_model";
        break;
      default:
        throw this.lexer.error("Expected model declaration");
    }

    const path = this.expectString();
    const nodes: StoredNode[] = [];

    this.lexer.expect(TokenType.LBRACKET);

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      if (this.lexer.peek().type === TokenType.STORE_NODE) {
        this.lexer.next();
        nodes.push(this.parseStoreNode());
      } else {
        throw this.lexer.error(
          `Unexpected token in model block: ${TokenType[this.lexer.peek().type]}`,
        );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return { path, type: modelType, nodes };
  }

  private parseStoreNode(): StoredNode {
    this.lexer.expect(TokenType.LBRACKET);

    const category = this.expectString();
    const code = this.expectString();

    let nodeName: string | undefined;
    if (this.lexer.peek().type === TokenType.STRING) {
      nodeName = this.expectString();
    }

    this.lexer.expect(TokenType.RBRACKET);

    return { category, code, nodeName };
  }

  private parseStoreTexture(): StoredTexture {
    this.lexer.next(); // store_texture
    this.lexer.expect(TokenType.LBRACKET);

    const category = this.expectString();
    const code = this.expectString();
    const filename = this.expectString();

    this.lexer.expect(TokenType.RBRACKET);

    return { category, code, filename };
  }

  private parseStoreFont(): StoredFont {
    this.lexer.next(); // store_font
    this.lexer.expect(TokenType.LBRACKET);

    const category = this.expectString();
    const code = this.expectString();
    const filename = this.expectString();

    this.lexer.expect(TokenType.RBRACKET);

    return { category, code, filename };
  }

  private parseStoreSuitPoint(): SuitPoint {
    this.lexer.next(); // store_suit_point
    this.lexer.expect(TokenType.LBRACKET);

    const index = this.expectNumber();

    // Check for old vs new syntax (comma after index means new syntax)
    const hasComma = this.lexer.peek().type === TokenType.COMMA;
    if (hasComma) {
      this.lexer.next(); // consume comma
    }

    let suitType: SuitPointType;
    const typeToken = this.lexer.peek();

    if (typeToken.type === TokenType.NUMBER) {
      // Old syntax: numeric type
      suitType = this.expectNumber() as SuitPointType;
    } else {
      // New syntax: keyword type
      suitType = this.parseSuitPointType();
    }

    if (hasComma && this.lexer.peek().type === TokenType.COMMA) {
      this.lexer.next(); // consume comma before position
    }

    const x = this.expectNumber();
    const y = this.expectNumber();
    const z = this.expectNumber();

    let landmarkBuildingIndex: number | undefined;

    // Check for optional landmark building index
    if (this.lexer.peek().type === TokenType.COMMA) {
      this.lexer.next();
      landmarkBuildingIndex = this.expectNumber();
    } else if (this.lexer.peek().type === TokenType.NUMBER) {
      // Old syntax without comma
      landmarkBuildingIndex = this.expectNumber();
    }

    this.lexer.expect(TokenType.RBRACKET);

    return {
      index,
      type: suitType,
      pos: vec3.fromValues(x, y, z),
      landmarkBuildingIndex,
    };
  }

  private parseSuitPointType(): SuitPointType {
    const token = this.lexer.next();
    switch (token.type) {
      case TokenType.STREET_POINT:
        return SuitPointType.STREET_POINT;
      case TokenType.FRONT_DOOR_POINT:
        return SuitPointType.FRONT_DOOR_POINT;
      case TokenType.SIDE_DOOR_POINT:
        return SuitPointType.SIDE_DOOR_POINT;
      case TokenType.COGHQ_IN_POINT:
        return SuitPointType.COGHQ_IN_POINT;
      case TokenType.COGHQ_OUT_POINT:
        return SuitPointType.COGHQ_OUT_POINT;
      default:
        throw this.lexer.error(
          `Expected suit point type, got ${TokenType[token.type]}`,
        );
    }
  }

  // ============================================
  // Node Parsing
  // ============================================

  private parseNode(): DNANode {
    const token = this.lexer.peek();

    switch (token.type) {
      case TokenType.GROUP:
        return this.parseGroup();
      case TokenType.VISGROUP:
        return this.parseVisGroup();
      case TokenType.NODE:
        return this.parseNodeDef();
      case TokenType.PROP:
        return this.parseProp();
      case TokenType.ANIM_PROP:
        return this.parseAnimProp();
      case TokenType.INTERACTIVE_PROP:
        return this.parseInteractiveProp();
      case TokenType.STREET:
        return this.parseStreet();
      case TokenType.FLAT_BUILDING:
        return this.parseFlatBuilding();
      case TokenType.LANDMARK_BUILDING:
        return this.parseLandmarkBuilding();
      case TokenType.ANIM_BUILDING:
        return this.parseAnimBuilding();
      default:
        throw this.lexer.error(
          `Expected node type, got ${TokenType[token.type]}`,
        );
    }
  }

  private parseGroup(): DNAGroup {
    this.lexer.next(); // group
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const children: DNANode[] = [];
    while (this.isNodeStart(this.lexer.peek())) {
      children.push(this.parseNode());
    }

    this.lexer.expect(TokenType.RBRACKET);

    return { type: "group", name, children };
  }

  private parseVisGroup(): DNAVisGroup {
    this.lexer.next(); // visgroup
    const name = this.expectString();
    this.currentZoneId = name;

    this.lexer.expect(TokenType.LBRACKET);

    const visibles: string[] = [];
    const suitEdges: SuitEdge[] = [];
    const battleCells: BattleCell[] = [];
    const children: DNANode[] = [];

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.VIS:
          this.lexer.next();
          this.lexer.expect(TokenType.LBRACKET);
          while (this.lexer.peek().type === TokenType.STRING) {
            visibles.push(this.expectString());
          }
          this.lexer.expect(TokenType.RBRACKET);
          break;

        case TokenType.SUIT_EDGE:
          suitEdges.push(this.parseSuitEdge());
          break;

        case TokenType.BATTLE_CELL:
          battleCells.push(this.parseBattleCell());
          break;

        default:
          if (this.isNodeStart(token)) {
            children.push(this.parseNode());
          } else {
            throw this.lexer.error(
              `Unexpected token in visgroup: ${TokenType[token.type]}`,
            );
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return {
      type: "visgroup",
      name,
      children,
      visibles,
      suitEdges,
      battleCells,
    };
  }

  private parseSuitEdge(): SuitEdge {
    this.lexer.next(); // suit_edge
    this.lexer.expect(TokenType.LBRACKET);

    const startPointIndex = this.expectNumber();
    const endPointIndex = this.expectNumber();

    this.lexer.expect(TokenType.RBRACKET);

    return { startPointIndex, endPointIndex, zoneId: this.currentZoneId };
  }

  private parseBattleCell(): BattleCell {
    this.lexer.next(); // battle_cell
    this.lexer.expect(TokenType.LBRACKET);

    const width = this.expectNumber();
    const height = this.expectNumber();
    const x = this.expectNumber();
    const y = this.expectNumber();
    const z = this.expectNumber();

    this.lexer.expect(TokenType.RBRACKET);

    return { width, height, pos: vec3.fromValues(x, y, z) };
  }

  private parseNodeDef(): DNANodeDef {
    this.lexer.next(); // node
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const node: DNANodeDef = { type: "node", name, children: [] };
    this.parseTransformAndChildren(node, node.children);

    this.lexer.expect(TokenType.RBRACKET);

    return node;
  }

  private parseProp(): DNAProp {
    this.lexer.next(); // prop
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const prop: DNAProp = { type: "prop", name, code: "", children: [] };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          prop.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          prop.color = this.parseColorBlock();
          break;
        case TokenType.SIGN:
          prop.sign = this.parseSign();
          break;
        default:
          if (!this.tryParseTransform(prop)) {
            if (this.isNodeStart(token)) {
              prop.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in prop: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return prop;
  }

  private parseAnimProp(): DNAAnimProp {
    this.lexer.next(); // anim_prop
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const prop: DNAAnimProp = {
      type: "anim_prop",
      name,
      code: "",
      anim: "",
      children: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          prop.code = this.parseCodeBlock();
          break;
        case TokenType.ANIM:
          prop.anim = this.parseAnimBlock();
          break;
        case TokenType.COLOR:
          prop.color = this.parseColorBlock();
          break;
        case TokenType.SIGN:
          prop.sign = this.parseSign();
          break;
        default:
          if (!this.tryParseTransform(prop)) {
            if (this.isNodeStart(token)) {
              prop.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in anim_prop: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return prop;
  }

  private parseInteractiveProp(): DNAInteractiveProp {
    this.lexer.next(); // interactive_prop
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const prop: DNAInteractiveProp = {
      type: "interactive_prop",
      name,
      code: "",
      anim: "",
      cellId: 0,
      children: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          prop.code = this.parseCodeBlock();
          break;
        case TokenType.ANIM:
          prop.anim = this.parseAnimBlock();
          break;
        case TokenType.CELL_ID:
          prop.cellId = this.parseCellIdBlock();
          break;
        case TokenType.COLOR:
          prop.color = this.parseColorBlock();
          break;
        case TokenType.SIGN:
          prop.sign = this.parseSign();
          break;
        default:
          if (!this.tryParseTransform(prop)) {
            if (this.isNodeStart(token)) {
              prop.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in interactive_prop: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return prop;
  }

  private parseStreet(): DNAStreet {
    this.lexer.next(); // street
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const street: DNAStreet = {
      type: "street",
      name,
      code: "",
      streetTexture: "",
      sidewalkTexture: "",
      children: [],
    };

    const textures: string[] = [];
    const colors: vec4[] = [];

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          street.code = this.parseCodeBlock();
          break;
        case TokenType.TEXTURE:
          textures.push(this.parseTextureBlock());
          break;
        case TokenType.COLOR:
          colors.push(this.parseColorBlock());
          break;
        default:
          if (!this.tryParseTransform(street)) {
            if (this.isNodeStart(token)) {
              street.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in street: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    // Assign textures in order: street, sidewalk, curb
    if (textures.length > 0) street.streetTexture = textures[0];
    if (textures.length > 1) street.sidewalkTexture = textures[1];
    if (textures.length > 2) street.curbTexture = textures[2];

    // Assign colors in order
    if (colors.length > 0) street.streetColor = colors[0];
    if (colors.length > 1) street.sidewalkColor = colors[1];
    if (colors.length > 2) street.curbColor = colors[2];

    this.lexer.expect(TokenType.RBRACKET);

    return street;
  }

  private parseFlatBuilding(): DNAFlatBuilding {
    this.lexer.next(); // flat_building
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const building: DNAFlatBuilding = {
      type: "flat_building",
      name,
      width: 0,
      walls: [],
      children: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.WIDTH:
          building.width = this.parseWidthBlock();
          break;
        case TokenType.WALL:
          building.walls.push(this.parseWall());
          break;
        case TokenType.PROP:
          building.props = building.props || [];
          building.props.push(this.parseProp());
          break;
        default:
          if (!this.tryParseTransform(building)) {
            if (this.isNodeStart(token)) {
              building.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in flat_building: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return building;
  }

  private parseWall(): DNAWall {
    this.lexer.next(); // wall
    this.lexer.expect(TokenType.LBRACKET);

    const wall: DNAWall = {
      type: "wall",
      height: 0,
      code: "",
      color: vec4.fromValues(1, 1, 1, 1),
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.HEIGHT:
          wall.height = this.parseHeightBlock();
          break;
        case TokenType.CODE:
          wall.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          wall.color = this.parseColorBlock();
          break;
        case TokenType.WINDOWS:
          wall.windows = this.parseWindows();
          break;
        case TokenType.CORNICE:
          wall.cornice = this.parseCornice();
          break;
        case TokenType.FLAT_DOOR:
          wall.flatDoor = this.parseFlatDoor();
          break;
        case TokenType.PROP:
          wall.props = wall.props || [];
          wall.props.push(this.parseProp());
          break;
        default:
          throw this.lexer.error(
            `Unexpected token in wall: ${TokenType[token.type]}`,
          );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return wall;
  }

  private parseWindows(): DNAWindows {
    this.lexer.next(); // windows
    this.lexer.expect(TokenType.LBRACKET);

    const windows: DNAWindows = {
      type: "windows",
      code: "",
      color: vec4.fromValues(1, 1, 1, 1),
      count: 1,
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          windows.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          windows.color = this.parseColorBlock();
          break;
        case TokenType.COUNT:
          windows.count = this.parseCountBlock();
          break;
        default:
          throw this.lexer.error(
            `Unexpected token in windows: ${TokenType[token.type]}`,
          );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return windows;
  }

  private parseCornice(): DNACornice {
    this.lexer.next(); // cornice
    this.lexer.expect(TokenType.LBRACKET);

    const cornice: DNACornice = {
      type: "cornice",
      code: "",
      color: vec4.fromValues(1, 1, 1, 1),
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          cornice.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          cornice.color = this.parseColorBlock();
          break;
        default:
          throw this.lexer.error(
            `Unexpected token in cornice: ${TokenType[token.type]}`,
          );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return cornice;
  }

  private parseFlatDoor(): DNAFlatDoor {
    this.lexer.next(); // flat_door
    this.lexer.expect(TokenType.LBRACKET);

    const door: DNAFlatDoor = {
      type: "flat_door",
      code: "",
      color: vec4.fromValues(1, 1, 1, 1),
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          door.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          door.color = this.parseColorBlock();
          break;
        default:
          throw this.lexer.error(
            `Unexpected token in flat_door: ${TokenType[token.type]}`,
          );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return door;
  }

  private parseLandmarkBuilding(): DNALandmarkBuilding {
    this.lexer.next(); // landmark_building
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const building: DNALandmarkBuilding = {
      type: "landmark_building",
      name,
      code: "",
      title: "",
      children: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          building.code = this.parseCodeBlock();
          break;
        case TokenType.TITLE:
          building.title = this.parseTitleBlock();
          break;
        case TokenType.ARTICLE:
          building.article = this.parseArticleBlock();
          break;
        case TokenType.BUILDING_TYPE:
          building.buildingType = this.parseBuildingTypeBlock();
          break;
        case TokenType.COLOR:
          building.wallColor = this.parseColorBlock();
          break;
        case TokenType.DOOR:
          building.door = this.parseDoor();
          break;
        case TokenType.SIGN:
          building.sign = this.parseSign();
          break;
        case TokenType.PROP:
          building.props = building.props || [];
          building.props.push(this.parseProp());
          break;
        default:
          if (!this.tryParseTransform(building)) {
            if (this.isNodeStart(token)) {
              building.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in landmark_building: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return building;
  }

  private parseAnimBuilding(): DNAAnimBuilding {
    this.lexer.next(); // anim_building
    const name = this.expectString();

    this.lexer.expect(TokenType.LBRACKET);

    const building: DNAAnimBuilding = {
      type: "anim_building",
      name,
      code: "",
      title: "",
      anim: "",
      children: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          building.code = this.parseCodeBlock();
          break;
        case TokenType.TITLE:
          building.title = this.parseTitleBlock();
          break;
        case TokenType.ARTICLE:
          building.article = this.parseArticleBlock();
          break;
        case TokenType.BUILDING_TYPE:
          building.buildingType = this.parseBuildingTypeBlock();
          break;
        case TokenType.ANIM:
          building.anim = this.parseAnimBlock();
          break;
        case TokenType.COLOR:
          building.wallColor = this.parseColorBlock();
          break;
        case TokenType.DOOR:
          building.door = this.parseDoor();
          break;
        case TokenType.SIGN:
          building.sign = this.parseSign();
          break;
        case TokenType.PROP:
          building.props = building.props || [];
          building.props.push(this.parseProp());
          break;
        default:
          if (!this.tryParseTransform(building)) {
            if (this.isNodeStart(token)) {
              building.children.push(this.parseNode());
            } else {
              throw this.lexer.error(
                `Unexpected token in anim_building: ${TokenType[token.type]}`,
              );
            }
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return building;
  }

  private parseDoor(): DNADoor {
    this.lexer.next(); // door
    this.lexer.expect(TokenType.LBRACKET);

    const door: DNADoor = {
      type: "door",
      code: "",
      color: vec4.fromValues(1, 1, 1, 1),
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          door.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          door.color = this.parseColorBlock();
          break;
        default:
          throw this.lexer.error(
            `Unexpected token in door: ${TokenType[token.type]}`,
          );
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return door;
  }

  private parseSign(): DNASign {
    this.lexer.next(); // sign
    this.lexer.expect(TokenType.LBRACKET);

    const sign: DNASign = {
      type: "sign",
      baselines: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          sign.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          sign.color = this.parseColorBlock();
          break;
        case TokenType.BASELINE:
          sign.baselines.push(this.parseBaseline());
          break;
        default:
          if (!this.tryParseTransform(sign)) {
            throw this.lexer.error(
              `Unexpected token in sign: ${TokenType[token.type]}`,
            );
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return sign;
  }

  private parseBaseline(): DNABaseline {
    this.lexer.next(); // baseline
    this.lexer.expect(TokenType.LBRACKET);

    const baseline: DNABaseline = {
      type: "baseline",
      items: [],
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          baseline.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          baseline.color = this.parseColorBlock();
          break;
        case TokenType.WIDTH:
          baseline.width = this.parseWidthBlock();
          break;
        case TokenType.HEIGHT:
          baseline.height = this.parseHeightBlock();
          break;
        case TokenType.INDENT:
          baseline.indent = this.parseIndentBlock();
          break;
        case TokenType.KERN:
          baseline.kern = this.parseKernBlock();
          break;
        case TokenType.WIGGLE:
          baseline.wiggle = this.parseWiggleBlock();
          break;
        case TokenType.STUMBLE:
          baseline.stumble = this.parseStumbleBlock();
          break;
        case TokenType.STOMP:
          baseline.stomp = this.parseStompBlock();
          break;
        case TokenType.FLAGS:
          baseline.flags = this.parseFlagsBlock();
          break;
        case TokenType.TEXT:
          baseline.items.push(this.parseText());
          break;
        case TokenType.GRAPHIC:
          baseline.items.push(this.parseGraphic());
          break;
        default:
          if (!this.tryParseTransform(baseline)) {
            throw this.lexer.error(
              `Unexpected token in baseline: ${TokenType[token.type]}`,
            );
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return baseline;
  }

  private parseText(): DNASignText {
    this.lexer.next(); // text
    this.lexer.expect(TokenType.LBRACKET);

    const text: DNASignText = {
      type: "text",
      letters: "",
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.LETTERS:
          text.letters = this.parseLettersBlock();
          break;
        case TokenType.CODE:
          text.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          text.color = this.parseColorBlock();
          break;
        default:
          if (!this.tryParseTransform(text)) {
            throw this.lexer.error(
              `Unexpected token in text: ${TokenType[token.type]}`,
            );
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return text;
  }

  private parseGraphic(): DNASignGraphic {
    this.lexer.next(); // graphic
    this.lexer.expect(TokenType.LBRACKET);

    const graphic: DNASignGraphic = {
      type: "graphic",
      code: "",
    };

    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      const token = this.lexer.peek();

      switch (token.type) {
        case TokenType.CODE:
          graphic.code = this.parseCodeBlock();
          break;
        case TokenType.COLOR:
          graphic.color = this.parseColorBlock();
          break;
        case TokenType.WIDTH:
          graphic.width = this.parseWidthBlock();
          break;
        case TokenType.HEIGHT:
          graphic.height = this.parseHeightBlock();
          break;
        default:
          if (!this.tryParseTransform(graphic)) {
            throw this.lexer.error(
              `Unexpected token in graphic: ${TokenType[token.type]}`,
            );
          }
      }
    }

    this.lexer.expect(TokenType.RBRACKET);

    return graphic;
  }

  // ============================================
  // Property Block Parsing
  // ============================================

  private parseCodeBlock(): string {
    this.lexer.next(); // code
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseTextureBlock(): string {
    this.lexer.next(); // texture
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseTitleBlock(): string {
    this.lexer.next(); // title
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseArticleBlock(): string {
    this.lexer.next(); // article
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseBuildingTypeBlock(): string {
    this.lexer.next(); // building_type
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseAnimBlock(): string {
    this.lexer.next(); // anim
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseCellIdBlock(): number {
    this.lexer.next(); // cell_id
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseLettersBlock(): string {
    this.lexer.next(); // letters
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseFlagsBlock(): string {
    this.lexer.next(); // flags
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectString();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseWidthBlock(): number {
    this.lexer.next(); // width
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseHeightBlock(): number {
    this.lexer.next(); // height
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseCountBlock(): number {
    this.lexer.next(); // count
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseIndentBlock(): number {
    this.lexer.next(); // indent
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseKernBlock(): number {
    this.lexer.next(); // kern
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseWiggleBlock(): number {
    this.lexer.next(); // wiggle
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseStumbleBlock(): number {
    this.lexer.next(); // stumble
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseStompBlock(): number {
    this.lexer.next(); // stomp
    this.lexer.expect(TokenType.LBRACKET);
    const value = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return value;
  }

  private parseColorBlock(): vec4 {
    this.lexer.next(); // color
    this.lexer.expect(TokenType.LBRACKET);
    const r = this.expectNumber();
    const g = this.expectNumber();
    const b = this.expectNumber();
    const a = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return vec4.fromValues(r, g, b, a);
  }

  private parsePosBlock(): vec3 {
    this.lexer.next(); // pos
    this.lexer.expect(TokenType.LBRACKET);
    const x = this.expectNumber();
    const y = this.expectNumber();
    const z = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return vec3.fromValues(x, y, z);
  }

  private parseHprBlock(): vec3 {
    this.lexer.next(); // hpr or nhpr
    this.lexer.expect(TokenType.LBRACKET);
    const x = this.expectNumber();
    const y = this.expectNumber();
    const z = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return vec3.fromValues(x, y, z);
  }

  private parseScaleBlock(): vec3 {
    this.lexer.next(); // scale
    this.lexer.expect(TokenType.LBRACKET);
    const x = this.expectNumber();
    const y = this.expectNumber();
    const z = this.expectNumber();
    this.lexer.expect(TokenType.RBRACKET);
    return vec3.fromValues(x, y, z);
  }

  // ============================================
  // Helpers
  // ============================================

  private tryParseTransform(node: DNANodeTransform): boolean {
    const token = this.lexer.peek();

    switch (token.type) {
      case TokenType.POS:
        node.pos = this.parsePosBlock();
        return true;
      case TokenType.HPR:
      case TokenType.NHPR:
        node.hpr = this.parseHprBlock();
        return true;
      case TokenType.SCALE:
        node.scale = this.parseScaleBlock();
        return true;
      default:
        return false;
    }
  }

  private parseTransformAndChildren(
    node: DNANodeTransform,
    children: DNANode[],
  ): void {
    while (this.lexer.peek().type !== TokenType.RBRACKET) {
      if (!this.tryParseTransform(node)) {
        if (this.isNodeStart(this.lexer.peek())) {
          children.push(this.parseNode());
        } else {
          throw this.lexer.error(
            `Unexpected token: ${TokenType[this.lexer.peek().type]}`,
          );
        }
      }
    }
  }

  private isNodeStart(token: Token): boolean {
    switch (token.type) {
      case TokenType.GROUP:
      case TokenType.VISGROUP:
      case TokenType.NODE:
      case TokenType.PROP:
      case TokenType.ANIM_PROP:
      case TokenType.INTERACTIVE_PROP:
      case TokenType.STREET:
      case TokenType.FLAT_BUILDING:
      case TokenType.LANDMARK_BUILDING:
      case TokenType.ANIM_BUILDING:
        return true;
      default:
        return false;
    }
  }

  private expectString(): string {
    const token = this.lexer.next();
    if (token.type !== TokenType.STRING) {
      throw this.lexer.error(`Expected string, got ${TokenType[token.type]}`);
    }
    return token.value as string;
  }

  private expectNumber(): number {
    const token = this.lexer.next();
    if (token.type !== TokenType.NUMBER) {
      throw this.lexer.error(`Expected number, got ${TokenType[token.type]}`);
    }
    return token.value as number;
  }
}

export function parseDNA(input: string): DNAFile {
  const parser = new DNAParser(input);
  return parser.parse();
}
