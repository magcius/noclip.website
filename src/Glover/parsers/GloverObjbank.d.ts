// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

interface DebugPosition {
  start: number;
  end: number;
  ioOffset: number;
}

declare class GloverObjbank {
  constructor(io: any, parent?: any, root?: any);
  __type: 'GloverObjbank';
  _io: any;

  directory: GloverObjbank.DirectoryEntry[];

  _debug: {
    directory: DebugPosition;
  };
}

declare namespace GloverObjbank {
  class Uv {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Uv';
    _io: any;

    u1: GloverObjbank.Fixed115;
    v1: GloverObjbank.Fixed115;
    u2: GloverObjbank.Fixed115;
    v2: GloverObjbank.Fixed115;
    u3: GloverObjbank.Fixed115;
    v3: GloverObjbank.Fixed115;

    _debug: {
      u1: DebugPosition;
      v1: DebugPosition;
      u2: DebugPosition;
      v2: DebugPosition;
      u3: DebugPosition;
      v3: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Vertex {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Vertex';
    _io: any;

    x: number;
    y: number;
    z: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class ObjectRoot {
    constructor(io: any, parent?: any, root?: any);
    __type: 'ObjectRoot';
    _io: any;

    mesh: GloverObjbank.Mesh;
    objId: number;
    bankBaseAddr: number;
    u2: number;
    meshPtr: number;
    u3: number;
    u4: number;
    u5: number;

    _debug: {
      objId: DebugPosition;
      bankBaseAddr: DebugPosition;
      u2: DebugPosition;
      meshPtr: DebugPosition;
      u3: DebugPosition;
      u4: DebugPosition;
      u5: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class DisplayListCmd {
    constructor(io: any, parent?: any, root?: any);
    __type: 'DisplayListCmd';
    _io: any;

    cmd: number;
    params: Uint8Array;

    _debug: {
      cmd: DebugPosition;
      params: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class DirectoryEntry {
    constructor(io: any, parent?: any, root?: any);
    __type: 'DirectoryEntry';
    _io: any;

    objRoot: GloverObjbank.ObjectRoot;
    objId: number;
    ptr: number;

    _debug: {
      objId: DebugPosition;
      ptr: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class AffineFrame {
    constructor(io: any, parent?: any, root?: any);
    __type: 'AffineFrame';
    _io: any;

    v1: number;
    v2: number;
    v3: number;
    v4: number;
    t: number;

    _debug: {
      v1: DebugPosition;
      v2: DebugPosition;
      v3: DebugPosition;
      v4: DebugPosition;
      t: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Face {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Face';
    _io: any;

    v0: number;
    v1: number;
    v2: number;

    _debug: {
      v0: DebugPosition;
      v1: DebugPosition;
      v2: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Sprite {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Sprite';
    _io: any;

    textureId: number;
    u2: number;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    u5: number;
    u6: number;
    u7: number;

    _debug: {
      textureId: DebugPosition;
      u2: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      width: DebugPosition;
      height: DebugPosition;
      u5: DebugPosition;
      u6: DebugPosition;
      u7: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Mesh {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Mesh';
    _io: any;

    rotation: GloverObjbank.AffineFrame[];
    geometry: GloverObjbank.Geometry;
    scale: GloverObjbank.AffineFrame[];
    translation: GloverObjbank.AffineFrame[];
    child: GloverObjbank.Mesh;
    sibling: GloverObjbank.Mesh;
    displayList: GloverObjbank.DisplayListCmd[];
    sprites: GloverObjbank.Sprite[];
    id: number;
    name: string;
    alpha: number;
    numScale: number;
    numTranslation: number;
    numRotation: number;
    geometryPtr: number;
    displayListPtr: number;
    scalePtr: number;
    translationPtr: number;
    rotationPtr: number;
    numSprites: number;
    spritesPtr: number;
    numChildren: number;
    renderMode: number;
    childPtr: number;
    siblingPtr: number;
    u15: number;

    _debug: {
      id: DebugPosition;
      name: DebugPosition;
      alpha: DebugPosition;
      numScale: DebugPosition;
      numTranslation: DebugPosition;
      numRotation: DebugPosition;
      geometryPtr: DebugPosition;
      displayListPtr: DebugPosition;
      scalePtr: DebugPosition;
      translationPtr: DebugPosition;
      rotationPtr: DebugPosition;
      numSprites: DebugPosition;
      spritesPtr: DebugPosition;
      numChildren: DebugPosition;
      renderMode: DebugPosition;
      childPtr: DebugPosition;
      siblingPtr: DebugPosition;
      u15: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Fixed115 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Fixed115';
    _io: any;

    value: number;
    raw: number;

    _debug: {
      raw: DebugPosition;
    };
  }
}

declare namespace GloverObjbank {
  class Geometry {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Geometry';
    _io: any;

    textureIds: number[];
    u5: number[];
    faces: GloverObjbank.Face[];
    vertices: GloverObjbank.Vertex[];
    u1: number[];
    uvs: GloverObjbank.Uv[];
    colorsNorms: number[];
    numFaces: number;
    numVertices: number;
    verticesPtr: number;
    facesPtr: number;
    u1Ptr: number;
    uvsPtr: number;
    u3: number;
    colorsNormsPtr: number;
    u5Ptr: number;
    textureIdsPtr: number;

    _debug: {
      numFaces: DebugPosition;
      numVertices: DebugPosition;
      verticesPtr: DebugPosition;
      facesPtr: DebugPosition;
      u1Ptr: DebugPosition;
      uvsPtr: DebugPosition;
      u3: DebugPosition;
      colorsNormsPtr: DebugPosition;
      u5Ptr: DebugPosition;
      textureIdsPtr: DebugPosition;
    };
  }
}

export = GloverObjbank;
export as namespace GloverObjbank;
