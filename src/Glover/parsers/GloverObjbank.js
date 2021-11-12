// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['kaitai-struct/KaitaiStream'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('kaitai-struct/KaitaiStream'));
  } else {
    root.GloverObjbank = factory(root.KaitaiStream);
  }
}(typeof self !== 'undefined' ? self : this, function (KaitaiStream) {
var GloverObjbank = (function() {
  function GloverObjbank(_io, _parent, _root) {
    this.__type = 'GloverObjbank';
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;

    this._read();
  }
  GloverObjbank.prototype._read = function() {
    this.directory = []
    var i = 0;
    do {
      var _ = new DirectoryEntry(this._io, this, this._root);
      this.directory.push(_);
      i++;
    } while (!(_.objId == 0));
  }

  var Uv = GloverObjbank.Uv = (function() {
    function Uv(_io, _parent, _root) {
      this.__type = 'Uv';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Uv.prototype._read = function() {
      this.u1 = new Fixed115(this._io, this, this._root);
      this.v1 = new Fixed115(this._io, this, this._root);
      this.u2 = new Fixed115(this._io, this, this._root);
      this.v2 = new Fixed115(this._io, this, this._root);
      this.u3 = new Fixed115(this._io, this, this._root);
      this.v3 = new Fixed115(this._io, this, this._root);
    }

    return Uv;
  })();

  var Vertex = GloverObjbank.Vertex = (function() {
    function Vertex(_io, _parent, _root) {
      this.__type = 'Vertex';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Vertex.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return Vertex;
  })();

  var ObjectRoot = GloverObjbank.ObjectRoot = (function() {
    function ObjectRoot(_io, _parent, _root) {
      this.__type = 'ObjectRoot';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    ObjectRoot.prototype._read = function() {
      this.objId = this._io.readU4be();
      this.bankBaseAddr = this._io.readU4be();
      this.u2 = this._io.readU4be();
      this.meshPtr = this._io.readU4be();
      this.u3 = this._io.readU4be();
      this.u4 = this._io.readU4be();
      this.u5 = this._io.readU4be();
    }
    Object.defineProperty(ObjectRoot.prototype, 'mesh', {
      get: function() {
        if (this._m_mesh !== undefined)
          return this._m_mesh;
        if (this.meshPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.meshPtr);
          this._m_mesh = new Mesh(this._io, this, this._root);
          this._io.seek(_pos);
        }
        return this._m_mesh;
      }
    });

    return ObjectRoot;
  })();

  var DisplayListCmd = GloverObjbank.DisplayListCmd = (function() {
    function DisplayListCmd(_io, _parent, _root) {
      this.__type = 'DisplayListCmd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    DisplayListCmd.prototype._read = function() {
      this.cmd = this._io.readU1();
      this.params = this._io.readBytes(7);
    }

    return DisplayListCmd;
  })();

  var DirectoryEntry = GloverObjbank.DirectoryEntry = (function() {
    function DirectoryEntry(_io, _parent, _root) {
      this.__type = 'DirectoryEntry';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    DirectoryEntry.prototype._read = function() {
      this.objId = this._io.readU4be();
      this.ptr = this._io.readU4be();
    }
    Object.defineProperty(DirectoryEntry.prototype, 'objRoot', {
      get: function() {
        if (this._m_objRoot !== undefined)
          return this._m_objRoot;
        if (this.ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.ptr);
          this._m_objRoot = new ObjectRoot(this._io, this, this._root);
          this._io.seek(_pos);
        }
        return this._m_objRoot;
      }
    });

    return DirectoryEntry;
  })();

  var AffineFrame = GloverObjbank.AffineFrame = (function() {
    function AffineFrame(_io, _parent, _root) {
      this.__type = 'AffineFrame';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    AffineFrame.prototype._read = function() {
      this.v1 = this._io.readF4be();
      this.v2 = this._io.readF4be();
      this.v3 = this._io.readF4be();
      this.v4 = this._io.readF4be();
      this.t = this._io.readU4be();
    }

    return AffineFrame;
  })();

  var Face = GloverObjbank.Face = (function() {
    function Face(_io, _parent, _root) {
      this.__type = 'Face';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Face.prototype._read = function() {
      this.v0 = this._io.readU2be();
      this.v1 = this._io.readU2be();
      this.v2 = this._io.readU2be();
    }

    return Face;
  })();

  var Sprite = GloverObjbank.Sprite = (function() {
    function Sprite(_io, _parent, _root) {
      this.__type = 'Sprite';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Sprite.prototype._read = function() {
      this.textureId = this._io.readU4be();
      this.u2 = this._io.readU4be();
      this.x = this._io.readU2be();
      this.y = this._io.readU2be();
      this.z = this._io.readU2be();
      this.width = this._io.readU2be();
      this.height = this._io.readU2be();
      this.u5 = this._io.readU2be();
      this.u6 = this._io.readU2be();
      this.u7 = this._io.readU2be();
    }

    return Sprite;
  })();

  var Mesh = GloverObjbank.Mesh = (function() {
    function Mesh(_io, _parent, _root) {
      this.__type = 'Mesh';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Mesh.prototype._read = function() {
      this.id = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.alpha = this._io.readU2be();
      this.nScale = this._io.readU2be();
      this.nTranslation = this._io.readU2be();
      this.nRotation = this._io.readU2be();
      this.geometryPtr = this._io.readU4be();
      this.displayListPtr = this._io.readU4be();
      this.scalePtr = this._io.readU4be();
      this.translationPtr = this._io.readU4be();
      this.rotationPtr = this._io.readU4be();
      this.nSprites = this._io.readU4be();
      this.spritesPtr = this._io.readU4be();
      this.nChildren = this._io.readU2be();
      this.renderMode = this._io.readU2be();
      this.childPtr = this._io.readU4be();
      this.siblingPtr = this._io.readU4be();
      this.u15 = this._io.readU4be();
    }
    Object.defineProperty(Mesh.prototype, 'rotation', {
      get: function() {
        if (this._m_rotation !== undefined)
          return this._m_rotation;
        if (this.rotationPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.rotationPtr);
          this._m_rotation = new Array(this.nRotation);
          for (var i = 0; i < this.nRotation; i++) {
            this._m_rotation[i] = new AffineFrame(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_rotation;
      }
    });
    Object.defineProperty(Mesh.prototype, 'geometry', {
      get: function() {
        if (this._m_geometry !== undefined)
          return this._m_geometry;
        if (this.geometryPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.geometryPtr);
          this._m_geometry = new Geometry(this._io, this, this._root);
          this._io.seek(_pos);
        }
        return this._m_geometry;
      }
    });
    Object.defineProperty(Mesh.prototype, 'scale', {
      get: function() {
        if (this._m_scale !== undefined)
          return this._m_scale;
        if (this.scalePtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.scalePtr);
          this._m_scale = new Array(this.nScale);
          for (var i = 0; i < this.nScale; i++) {
            this._m_scale[i] = new AffineFrame(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_scale;
      }
    });
    Object.defineProperty(Mesh.prototype, 'translation', {
      get: function() {
        if (this._m_translation !== undefined)
          return this._m_translation;
        if (this.translationPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.translationPtr);
          this._m_translation = new Array(this.nTranslation);
          for (var i = 0; i < this.nTranslation; i++) {
            this._m_translation[i] = new AffineFrame(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_translation;
      }
    });
    Object.defineProperty(Mesh.prototype, 'child', {
      get: function() {
        if (this._m_child !== undefined)
          return this._m_child;
        if (this.childPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.childPtr);
          this._m_child = new Mesh(this._io, this, this._root);
          this._io.seek(_pos);
        }
        return this._m_child;
      }
    });
    Object.defineProperty(Mesh.prototype, 'sibling', {
      get: function() {
        if (this._m_sibling !== undefined)
          return this._m_sibling;
        if (this.siblingPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.siblingPtr);
          this._m_sibling = new Mesh(this._io, this, this._root);
          this._io.seek(_pos);
        }
        return this._m_sibling;
      }
    });
    Object.defineProperty(Mesh.prototype, 'displayList', {
      get: function() {
        if (this._m_displayList !== undefined)
          return this._m_displayList;
        if (this.displayListPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.displayListPtr);
          this._m_displayList = []
          var i = 0;
          do {
            var _ = new DisplayListCmd(this._io, this, this._root);
            this._m_displayList.push(_);
            i++;
          } while (!(_.cmd == 184));
          this._io.seek(_pos);
        }
        return this._m_displayList;
      }
    });
    Object.defineProperty(Mesh.prototype, 'sprites', {
      get: function() {
        if (this._m_sprites !== undefined)
          return this._m_sprites;
        if (this.spritesPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.spritesPtr);
          this._m_sprites = new Array(this.nSprites);
          for (var i = 0; i < this.nSprites; i++) {
            this._m_sprites[i] = new Sprite(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_sprites;
      }
    });

    return Mesh;
  })();

  var Fixed115 = GloverObjbank.Fixed115 = (function() {
    function Fixed115(_io, _parent, _root) {
      this.__type = 'Fixed115';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Fixed115.prototype._read = function() {
      this.raw = this._io.readU2be();
    }
    Object.defineProperty(Fixed115.prototype, 'value', {
      get: function() {
        if (this._m_value !== undefined)
          return this._m_value;
        this._m_value = (this.raw / 32.0);
        return this._m_value;
      }
    });

    return Fixed115;
  })();

  var Geometry = GloverObjbank.Geometry = (function() {
    function Geometry(_io, _parent, _root) {
      this.__type = 'Geometry';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Geometry.prototype._read = function() {
      this.nFaces = this._io.readU2be();
      this.nVertices = this._io.readU2be();
      this.verticesPtr = this._io.readU4be();
      this.facesPtr = this._io.readU4be();
      this.u1Ptr = this._io.readU4be();
      this.uvsPtr = this._io.readU4be();
      this.u3 = this._io.readU4be();
      this.u4Ptr = this._io.readU4be();
      this.u5Ptr = this._io.readU4be();
      this.textureIdsPtr = this._io.readU4be();
    }
    Object.defineProperty(Geometry.prototype, 'textureIds', {
      get: function() {
        if (this._m_textureIds !== undefined)
          return this._m_textureIds;
        if (this.textureIdsPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.textureIdsPtr);
          this._m_textureIds = new Array(this.nFaces);
          for (var i = 0; i < this.nFaces; i++) {
            this._m_textureIds[i] = this._io.readU4be();
          }
          this._io.seek(_pos);
        }
        return this._m_textureIds;
      }
    });
    Object.defineProperty(Geometry.prototype, 'u5', {
      get: function() {
        if (this._m_u5 !== undefined)
          return this._m_u5;
        if (this.u4Ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.u5Ptr);
          this._m_u5 = new Array(this.nFaces);
          for (var i = 0; i < this.nFaces; i++) {
            this._m_u5[i] = this._io.readU1();
          }
          this._io.seek(_pos);
        }
        return this._m_u5;
      }
    });
    Object.defineProperty(Geometry.prototype, 'faces', {
      get: function() {
        if (this._m_faces !== undefined)
          return this._m_faces;
        if (this.facesPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.facesPtr);
          this._m_faces = new Array(this.nFaces);
          for (var i = 0; i < this.nFaces; i++) {
            this._m_faces[i] = new Face(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_faces;
      }
    });
    Object.defineProperty(Geometry.prototype, 'u4', {
      get: function() {
        if (this._m_u4 !== undefined)
          return this._m_u4;
        if (this.u4Ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.u4Ptr);
          this._m_u4 = new Array(this.nVertices);
          for (var i = 0; i < this.nVertices; i++) {
            this._m_u4[i] = this._io.readU4be();
          }
          this._io.seek(_pos);
        }
        return this._m_u4;
      }
    });
    Object.defineProperty(Geometry.prototype, 'vertices', {
      get: function() {
        if (this._m_vertices !== undefined)
          return this._m_vertices;
        if (this.verticesPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.verticesPtr);
          this._m_vertices = new Array(this.nVertices);
          for (var i = 0; i < this.nVertices; i++) {
            this._m_vertices[i] = new Vertex(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_vertices;
      }
    });
    Object.defineProperty(Geometry.prototype, 'u1', {
      get: function() {
        if (this._m_u1 !== undefined)
          return this._m_u1;
        if (this.u1Ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.u1Ptr);
          this._m_u1 = new Array(this.nFaces);
          for (var i = 0; i < this.nFaces; i++) {
            this._m_u1[i] = this._io.readU4be();
          }
          this._io.seek(_pos);
        }
        return this._m_u1;
      }
    });
    Object.defineProperty(Geometry.prototype, 'uvs', {
      get: function() {
        if (this._m_uvs !== undefined)
          return this._m_uvs;
        if (this.uvsPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.uvsPtr);
          this._m_uvs = new Array(this.nFaces);
          for (var i = 0; i < this.nFaces; i++) {
            this._m_uvs[i] = new Uv(this._io, this, this._root);
          }
          this._io.seek(_pos);
        }
        return this._m_uvs;
      }
    });

    return Geometry;
  })();

  return GloverObjbank;
})();
return GloverObjbank;
}));
