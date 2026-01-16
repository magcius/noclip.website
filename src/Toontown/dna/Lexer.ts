export enum TokenType {
  // Literals
  NUMBER,
  STRING,
  IDENTIFIER,

  // Punctuation
  LBRACKET, // [
  RBRACKET, // ]
  COMMA, // ,

  // Keywords - Top level declarations
  MODEL,
  HOOD_MODEL,
  PLACE_MODEL,
  STORE_NODE,
  STORE_TEXTURE,
  STORE_FONT,
  STORE_SUIT_POINT,

  // Keywords - Suit point types
  STREET_POINT,
  FRONT_DOOR_POINT,
  SIDE_DOOR_POINT,
  COGHQ_IN_POINT,
  COGHQ_OUT_POINT,

  // Keywords - Node types
  GROUP,
  VISGROUP,
  NODE,
  PROP,
  ANIM_PROP,
  INTERACTIVE_PROP,
  STREET,
  FLAT_BUILDING,
  LANDMARK_BUILDING,
  ANIM_BUILDING,
  WALL,
  WINDOWS,
  DOOR,
  FLAT_DOOR,
  CORNICE,
  SIGN,
  BASELINE,
  TEXT,
  GRAPHIC,

  // Keywords - Properties
  VIS,
  SUIT_EDGE,
  BATTLE_CELL,
  POS,
  HPR,
  NHPR,
  SCALE,
  CODE,
  COLOR,
  WIDTH,
  HEIGHT,
  TEXTURE,
  TITLE,
  ARTICLE,
  BUILDING_TYPE,
  ANIM,
  CELL_ID,
  INDENT,
  KERN,
  WIGGLE,
  STUMBLE,
  STOMP,
  FLAGS,
  LETTERS,
  COUNT,

  // Special
  EOF,
}

export interface Token {
  type: TokenType;
  value: string | number;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  model: TokenType.MODEL,
  hood_model: TokenType.HOOD_MODEL,
  place_model: TokenType.PLACE_MODEL,
  store_node: TokenType.STORE_NODE,
  store_texture: TokenType.STORE_TEXTURE,
  store_font: TokenType.STORE_FONT,
  store_suit_point: TokenType.STORE_SUIT_POINT,
  STREET_POINT: TokenType.STREET_POINT,
  FRONT_DOOR_POINT: TokenType.FRONT_DOOR_POINT,
  SIDE_DOOR_POINT: TokenType.SIDE_DOOR_POINT,
  COGHQ_IN_POINT: TokenType.COGHQ_IN_POINT,
  COGHQ_OUT_POINT: TokenType.COGHQ_OUT_POINT,
  group: TokenType.GROUP,
  visgroup: TokenType.VISGROUP,
  node: TokenType.NODE,
  prop: TokenType.PROP,
  anim_prop: TokenType.ANIM_PROP,
  interactive_prop: TokenType.INTERACTIVE_PROP,
  street: TokenType.STREET,
  flat_building: TokenType.FLAT_BUILDING,
  landmark_building: TokenType.LANDMARK_BUILDING,
  anim_building: TokenType.ANIM_BUILDING,
  wall: TokenType.WALL,
  windows: TokenType.WINDOWS,
  door: TokenType.DOOR,
  flat_door: TokenType.FLAT_DOOR,
  cornice: TokenType.CORNICE,
  sign: TokenType.SIGN,
  baseline: TokenType.BASELINE,
  text: TokenType.TEXT,
  graphic: TokenType.GRAPHIC,
  vis: TokenType.VIS,
  suit_edge: TokenType.SUIT_EDGE,
  battle_cell: TokenType.BATTLE_CELL,
  pos: TokenType.POS,
  hpr: TokenType.HPR,
  nhpr: TokenType.NHPR,
  scale: TokenType.SCALE,
  code: TokenType.CODE,
  color: TokenType.COLOR,
  width: TokenType.WIDTH,
  height: TokenType.HEIGHT,
  texture: TokenType.TEXTURE,
  title: TokenType.TITLE,
  article: TokenType.ARTICLE,
  building_type: TokenType.BUILDING_TYPE,
  anim: TokenType.ANIM,
  cell_id: TokenType.CELL_ID,
  indent: TokenType.INDENT,
  kern: TokenType.KERN,
  wiggle: TokenType.WIGGLE,
  stumble: TokenType.STUMBLE,
  stomp: TokenType.STOMP,
  flags: TokenType.FLAGS,
  letters: TokenType.LETTERS,
  count: TokenType.COUNT,
};

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private peeked: Token | null = null;

  constructor(input: string) {
    this.input = input;
  }

  peek(): Token {
    if (this.peeked === null) {
      this.peeked = this.readToken();
    }
    return this.peeked;
  }

  next(): Token {
    if (this.peeked !== null) {
      const token = this.peeked;
      this.peeked = null;
      return token;
    }
    return this.readToken();
  }

  expect(type: TokenType): Token {
    const token = this.next();
    if (token.type !== type) {
      throw this.error(
        `Expected ${TokenType[type]}, got ${TokenType[token.type]}`,
      );
    }
    return token;
  }

  error(message: string): Error {
    return new Error(
      `DNA parse error at line ${this.line}, column ${this.column}: ${message}`,
    );
  }

  private readToken(): Token {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.input.length) {
      return {
        type: TokenType.EOF,
        value: "",
        line: this.line,
        column: this.column,
      };
    }

    const line = this.line;
    const column = this.column;
    const ch = this.input[this.pos];

    // Punctuation
    if (ch === "[") {
      this.advance();
      return { type: TokenType.LBRACKET, value: "[", line, column };
    }
    if (ch === "]") {
      this.advance();
      return { type: TokenType.RBRACKET, value: "]", line, column };
    }
    if (ch === ",") {
      this.advance();
      return { type: TokenType.COMMA, value: ",", line, column };
    }

    // String
    if (ch === '"') {
      return this.readString(line, column);
    }

    // Number (including negative)
    if (
      this.isDigit(ch) ||
      ((ch === "-" || ch === "+") && this.isDigit(this.input[this.pos + 1]))
    ) {
      return this.readNumber(line, column);
    }

    // Identifier or keyword
    if (this.isIdentifierStart(ch)) {
      return this.readIdentifier(line, column);
    }

    throw this.error(`Unexpected character: ${ch}`);
  }

  private readString(line: number, column: number): Token {
    this.advance(); // Skip opening quote
    let value = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '"') {
        this.advance(); // Skip closing quote
        return { type: TokenType.STRING, value, line, column };
      }
      if (ch === "\\") {
        this.advance();
        if (this.pos < this.input.length) {
          const escaped = this.input[this.pos];
          switch (escaped) {
            case "n":
              value += "\n";
              break;
            case "t":
              value += "\t";
              break;
            case "r":
              value += "\r";
              break;
            case '"':
              value += '"';
              break;
            case "\\":
              value += "\\";
              break;
            default:
              value += escaped;
          }
          this.advance();
        }
      } else if (ch === "\n") {
        // Handle newline in string (some DNA files have this)
        value += ch;
        this.line++;
        this.column = 0;
        this.pos++;
        this.column++;
      } else {
        value += ch;
        this.advance();
      }
    }

    throw this.error("Unterminated string");
  }

  private readNumber(line: number, column: number): Token {
    let numStr = "";

    // Optional sign
    if (this.input[this.pos] === "-" || this.input[this.pos] === "+") {
      numStr += this.input[this.pos];
      this.advance();
    }

    // Integer part
    while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
      numStr += this.input[this.pos];
      this.advance();
    }

    // Decimal part
    if (this.pos < this.input.length && this.input[this.pos] === ".") {
      numStr += ".";
      this.advance();
      while (
        this.pos < this.input.length &&
        this.isDigit(this.input[this.pos])
      ) {
        numStr += this.input[this.pos];
        this.advance();
      }
    }

    // Exponent part
    if (
      this.pos < this.input.length &&
      (this.input[this.pos] === "e" || this.input[this.pos] === "E")
    ) {
      numStr += this.input[this.pos];
      this.advance();
      if (
        this.pos < this.input.length &&
        (this.input[this.pos] === "-" || this.input[this.pos] === "+")
      ) {
        numStr += this.input[this.pos];
        this.advance();
      }
      while (
        this.pos < this.input.length &&
        this.isDigit(this.input[this.pos])
      ) {
        numStr += this.input[this.pos];
        this.advance();
      }
    }

    const value = parseFloat(numStr);
    return { type: TokenType.NUMBER, value, line, column };
  }

  private readIdentifier(line: number, column: number): Token {
    let ident = "";

    while (
      this.pos < this.input.length &&
      this.isIdentifierChar(this.input[this.pos])
    ) {
      ident += this.input[this.pos];
      this.advance();
    }

    // Check if it's a keyword
    const keywordType = KEYWORDS[ident];
    if (keywordType !== undefined) {
      return { type: keywordType, value: ident, line, column };
    }

    return { type: TokenType.IDENTIFIER, value: ident, line, column };
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }

      // Newline
      if (ch === "\n") {
        this.pos++;
        this.line++;
        this.column = 1;
        continue;
      }

      // Comments
      if (ch === "/" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];

        // Single-line comment
        if (next === "/") {
          this.pos += 2;
          this.column += 2;
          while (
            this.pos < this.input.length &&
            this.input[this.pos] !== "\n"
          ) {
            this.advance();
          }
          continue;
        }

        // Multi-line comment
        if (next === "*") {
          this.pos += 2;
          this.column += 2;
          while (this.pos + 1 < this.input.length) {
            if (
              this.input[this.pos] === "*" &&
              this.input[this.pos + 1] === "/"
            ) {
              this.pos += 2;
              this.column += 2;
              break;
            }
            if (this.input[this.pos] === "\n") {
              this.line++;
              this.column = 0;
            }
            this.advance();
          }
          continue;
        }
      }

      // Not whitespace or comment, stop
      break;
    }
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentifierStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentifierChar(ch: string): boolean {
    return (
      this.isIdentifierStart(ch) ||
      this.isDigit(ch) ||
      ch === ":" ||
      ch === "." ||
      ch === "-" ||
      ch === "/"
    );
  }

  getPosition(): { line: number; column: number } {
    return { line: this.line, column: this.column };
  }
}
