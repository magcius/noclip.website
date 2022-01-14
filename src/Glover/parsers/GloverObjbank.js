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
    this._debug = {};

    this._read();
  }
  GloverObjbank.prototype._read = function() {
    this._debug.directory = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.directory = []
    this._debug.directory.arr = [];
    var i = 0;
    do {
      this._debug.directory.arr[this.directory.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
      var _ = new DirectoryEntry(this._io, this, this._root);
      this.directory.push(_);
      this._debug.directory.arr[this.directory.length - 1].end = this._io.pos;
      i++;
    } while (!(_.objId == 0));
    this._debug.directory.end = this._io.pos;
  }

  var Uv = GloverObjbank.Uv = (function() {
    function Uv(_io, _parent, _root) {
      this.__type = 'Uv';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Uv.prototype._read = function() {
      this._debug.u1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u1 = new Fixed115(this._io, this, this._root);
      this._debug.u1.end = this._io.pos;
      this._debug.v1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v1 = new Fixed115(this._io, this, this._root);
      this._debug.v1.end = this._io.pos;
      this._debug.u2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u2 = new Fixed115(this._io, this, this._root);
      this._debug.u2.end = this._io.pos;
      this._debug.v2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v2 = new Fixed115(this._io, this, this._root);
      this._debug.v2.end = this._io.pos;
      this._debug.u3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u3 = new Fixed115(this._io, this, this._root);
      this._debug.u3.end = this._io.pos;
      this._debug.v3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v3 = new Fixed115(this._io, this, this._root);
      this._debug.v3.end = this._io.pos;
    }

    return Uv;
  })();

  var Vertex = GloverObjbank.Vertex = (function() {
    function Vertex(_io, _parent, _root) {
      this.__type = 'Vertex';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Vertex.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return Vertex;
  })();

  var ObjectRoot = GloverObjbank.ObjectRoot = (function() {
    function ObjectRoot(_io, _parent, _root) {
      this.__type = 'ObjectRoot';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    ObjectRoot.prototype._read = function() {
      this._debug.objId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objId = this._io.readU4be();
      this._debug.objId.end = this._io.pos;
      this._debug.bankBaseAddr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.bankBaseAddr = this._io.readU4be();
      this._debug.bankBaseAddr.end = this._io.pos;
      this._debug.u2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u2 = this._io.readU4be();
      this._debug.u2.end = this._io.pos;
      this._debug.meshPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.meshPtr = this._io.readU4be();
      this._debug.meshPtr.end = this._io.pos;
      this._debug.u3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u3 = this._io.readU4be();
      this._debug.u3.end = this._io.pos;
      this._debug.u4 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u4 = this._io.readU4be();
      this._debug.u4.end = this._io.pos;
      this._debug.animationPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.animationPtr = this._io.readU4be();
      this._debug.animationPtr.end = this._io.pos;
    }
    Object.defineProperty(ObjectRoot.prototype, 'mesh', {
      get: function() {
        if (this._m_mesh !== undefined)
          return this._m_mesh;
        if (this.meshPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.meshPtr);
          this._debug._m_mesh = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_mesh = new Mesh(this._io, this, this._root);
          this._debug._m_mesh.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_mesh;
      }
    });
    Object.defineProperty(ObjectRoot.prototype, 'animation', {
      get: function() {
        if (this._m_animation !== undefined)
          return this._m_animation;
        if (this.animationPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.animationPtr);
          this._debug._m_animation = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_animation = new Animation(this._io, this, this._root);
          this._debug._m_animation.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_animation;
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
      this._debug = {};

      this._read();
    }
    DisplayListCmd.prototype._read = function() {
      this._debug.cmd = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.cmd = this._io.readU1();
      this._debug.cmd.end = this._io.pos;
      this._debug.params = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.params = this._io.readBytes(7);
      this._debug.params.end = this._io.pos;
    }

    return DisplayListCmd;
  })();

  var DirectoryEntry = GloverObjbank.DirectoryEntry = (function() {
    function DirectoryEntry(_io, _parent, _root) {
      this.__type = 'DirectoryEntry';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    DirectoryEntry.prototype._read = function() {
      this._debug.objId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objId = this._io.readU4be();
      this._debug.objId.end = this._io.pos;
      this._debug.ptr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ptr = this._io.readU4be();
      this._debug.ptr.end = this._io.pos;
    }
    Object.defineProperty(DirectoryEntry.prototype, 'objRoot', {
      get: function() {
        if (this._m_objRoot !== undefined)
          return this._m_objRoot;
        if (this.ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.ptr);
          this._debug._m_objRoot = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_objRoot = new ObjectRoot(this._io, this, this._root);
          this._debug._m_objRoot.end = this._io.pos;
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
      this._debug = {};

      this._read();
    }
    AffineFrame.prototype._read = function() {
      this._debug.v1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v1 = this._io.readF4be();
      this._debug.v1.end = this._io.pos;
      this._debug.v2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v2 = this._io.readF4be();
      this._debug.v2.end = this._io.pos;
      this._debug.v3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v3 = this._io.readF4be();
      this._debug.v3.end = this._io.pos;
      this._debug.v4 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v4 = this._io.readF4be();
      this._debug.v4.end = this._io.pos;
      this._debug.t = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.t = this._io.readU4be();
      this._debug.t.end = this._io.pos;
    }

    return AffineFrame;
  })();

  var AnimationDefinition = GloverObjbank.AnimationDefinition = (function() {
    function AnimationDefinition(_io, _parent, _root) {
      this.__type = 'AnimationDefinition';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    AnimationDefinition.prototype._read = function() {
      this._debug.startTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.startTime = this._io.readS2be();
      this._debug.startTime.end = this._io.pos;
      this._debug.endTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.endTime = this._io.readS2be();
      this._debug.endTime.end = this._io.pos;
      this._debug.playbackSpeed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.playbackSpeed = this._io.readF4be();
      this._debug.playbackSpeed.end = this._io.pos;
      this._debug.u1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u1 = this._io.readU4be();
      this._debug.u1.end = this._io.pos;
    }

    return AnimationDefinition;
  })();

  var Face = GloverObjbank.Face = (function() {
    function Face(_io, _parent, _root) {
      this.__type = 'Face';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Face.prototype._read = function() {
      this._debug.v0 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v0 = this._io.readU2be();
      this._debug.v0.end = this._io.pos;
      this._debug.v1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v1 = this._io.readU2be();
      this._debug.v1.end = this._io.pos;
      this._debug.v2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.v2 = this._io.readU2be();
      this._debug.v2.end = this._io.pos;
    }

    return Face;
  })();

  var Sprite = GloverObjbank.Sprite = (function() {
    function Sprite(_io, _parent, _root) {
      this.__type = 'Sprite';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Sprite.prototype._read = function() {
      this._debug.textureId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.textureId = this._io.readU4be();
      this._debug.textureId.end = this._io.pos;
      this._debug.u2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u2 = this._io.readU4be();
      this._debug.u2.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readU2be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readU2be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readU2be();
      this._debug.z.end = this._io.pos;
      this._debug.width = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.width = this._io.readU2be();
      this._debug.width.end = this._io.pos;
      this._debug.height = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.height = this._io.readU2be();
      this._debug.height.end = this._io.pos;
      this._debug.u5 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u5 = this._io.readU2be();
      this._debug.u5.end = this._io.pos;
      this._debug.u6 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u6 = this._io.readU2be();
      this._debug.u6.end = this._io.pos;
      this._debug.u7 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u7 = this._io.readU2be();
      this._debug.u7.end = this._io.pos;
    }

    return Sprite;
  })();

  var Animation = GloverObjbank.Animation = (function() {
    function Animation(_io, _parent, _root) {
      this.__type = 'Animation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Animation.prototype._read = function() {
      this._debug.numAnimationDefinitions = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numAnimationDefinitions = this._io.readS2be();
      this._debug.numAnimationDefinitions.end = this._io.pos;
      this._debug.currentAnimationIdx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.currentAnimationIdx = this._io.readS2be();
      this._debug.currentAnimationIdx.end = this._io.pos;
      this._debug.u3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u3 = this._io.readU4be();
      this._debug.u3.end = this._io.pos;
      this._debug.isPlaying = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.isPlaying = this._io.readU4be();
      this._debug.isPlaying.end = this._io.pos;
      this._debug.timeDelta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.timeDelta = this._io.readF4be();
      this._debug.timeDelta.end = this._io.pos;
      this._debug.nextAnimIdx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.nextAnimIdx = new Array(5);
      this._debug.nextAnimIdx.arr = new Array(5);
      for (var i = 0; i < 5; i++) {
        this._debug.nextAnimIdx.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.nextAnimIdx[i] = this._io.readS2be();
        this._debug.nextAnimIdx.arr[i].end = this._io.pos;
      }
      this._debug.nextAnimIdx.end = this._io.pos;
      this._debug.pad = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pad = this._io.readU2be();
      this._debug.pad.end = this._io.pos;
      this._debug.nextIsPlaying = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.nextIsPlaying = new Array(5);
      this._debug.nextIsPlaying.arr = new Array(5);
      for (var i = 0; i < 5; i++) {
        this._debug.nextIsPlaying.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.nextIsPlaying[i] = this._io.readU4be();
        this._debug.nextIsPlaying.arr[i].end = this._io.pos;
      }
      this._debug.nextIsPlaying.end = this._io.pos;
      this._debug.nextTimeDelta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.nextTimeDelta = new Array(5);
      this._debug.nextTimeDelta.arr = new Array(5);
      for (var i = 0; i < 5; i++) {
        this._debug.nextTimeDelta.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.nextTimeDelta[i] = this._io.readU4be();
        this._debug.nextTimeDelta.arr[i].end = this._io.pos;
      }
      this._debug.nextTimeDelta.end = this._io.pos;
      this._debug.nextAnimSlotIdx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.nextAnimSlotIdx = this._io.readS2be();
      this._debug.nextAnimSlotIdx.end = this._io.pos;
      this._debug.u15 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u15 = this._io.readU2be();
      this._debug.u15.end = this._io.pos;
      this._debug.animationDefinitionsPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.animationDefinitionsPtr = this._io.readU4be();
      this._debug.animationDefinitionsPtr.end = this._io.pos;
      this._debug.curTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.curTime = this._io.readF4be();
      this._debug.curTime.end = this._io.pos;
    }
    Object.defineProperty(Animation.prototype, 'animationDefinitions', {
      get: function() {
        if (this._m_animationDefinitions !== undefined)
          return this._m_animationDefinitions;
        if (this.animationDefinitionsPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.animationDefinitionsPtr);
          this._debug._m_animationDefinitions = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_animationDefinitions = new Array(this.numAnimationDefinitions);
          this._debug._m_animationDefinitions.arr = new Array(this.numAnimationDefinitions);
          for (var i = 0; i < this.numAnimationDefinitions; i++) {
            this._debug._m_animationDefinitions.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_animationDefinitions[i] = new AnimationDefinition(this._io, this, this._root);
            this._debug._m_animationDefinitions.arr[i].end = this._io.pos;
          }
          this._debug._m_animationDefinitions.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_animationDefinitions;
      }
    });

    return Animation;
  })();

  var Mesh = GloverObjbank.Mesh = (function() {
    function Mesh(_io, _parent, _root) {
      this.__type = 'Mesh';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Mesh.prototype._read = function() {
      this._debug.id = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.id = this._io.readU4be();
      this._debug.id.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.alpha = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.alpha = this._io.readU2be();
      this._debug.alpha.end = this._io.pos;
      this._debug.numScale = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numScale = this._io.readU2be();
      this._debug.numScale.end = this._io.pos;
      this._debug.numTranslation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numTranslation = this._io.readU2be();
      this._debug.numTranslation.end = this._io.pos;
      this._debug.numRotation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numRotation = this._io.readU2be();
      this._debug.numRotation.end = this._io.pos;
      this._debug.geometryPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.geometryPtr = this._io.readU4be();
      this._debug.geometryPtr.end = this._io.pos;
      this._debug.displayListPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.displayListPtr = this._io.readU4be();
      this._debug.displayListPtr.end = this._io.pos;
      this._debug.scalePtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.scalePtr = this._io.readU4be();
      this._debug.scalePtr.end = this._io.pos;
      this._debug.translationPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.translationPtr = this._io.readU4be();
      this._debug.translationPtr.end = this._io.pos;
      this._debug.rotationPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.rotationPtr = this._io.readU4be();
      this._debug.rotationPtr.end = this._io.pos;
      this._debug.numSprites = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numSprites = this._io.readU4be();
      this._debug.numSprites.end = this._io.pos;
      this._debug.spritesPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.spritesPtr = this._io.readU4be();
      this._debug.spritesPtr.end = this._io.pos;
      this._debug.numChildren = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numChildren = this._io.readU2be();
      this._debug.numChildren.end = this._io.pos;
      this._debug.renderMode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.renderMode = this._io.readU2be();
      this._debug.renderMode.end = this._io.pos;
      this._debug.childPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.childPtr = this._io.readU4be();
      this._debug.childPtr.end = this._io.pos;
      this._debug.siblingPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.siblingPtr = this._io.readU4be();
      this._debug.siblingPtr.end = this._io.pos;
      this._debug.u15 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u15 = this._io.readU4be();
      this._debug.u15.end = this._io.pos;
    }
    Object.defineProperty(Mesh.prototype, 'rotation', {
      get: function() {
        if (this._m_rotation !== undefined)
          return this._m_rotation;
        if (this.rotationPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.rotationPtr);
          this._debug._m_rotation = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_rotation = new Array(this.numRotation);
          this._debug._m_rotation.arr = new Array(this.numRotation);
          for (var i = 0; i < this.numRotation; i++) {
            this._debug._m_rotation.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_rotation[i] = new AffineFrame(this._io, this, this._root);
            this._debug._m_rotation.arr[i].end = this._io.pos;
          }
          this._debug._m_rotation.end = this._io.pos;
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
          this._debug._m_geometry = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_geometry = new Geometry(this._io, this, this._root);
          this._debug._m_geometry.end = this._io.pos;
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
          this._debug._m_scale = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_scale = new Array(this.numScale);
          this._debug._m_scale.arr = new Array(this.numScale);
          for (var i = 0; i < this.numScale; i++) {
            this._debug._m_scale.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_scale[i] = new AffineFrame(this._io, this, this._root);
            this._debug._m_scale.arr[i].end = this._io.pos;
          }
          this._debug._m_scale.end = this._io.pos;
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
          this._debug._m_translation = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_translation = new Array(this.numTranslation);
          this._debug._m_translation.arr = new Array(this.numTranslation);
          for (var i = 0; i < this.numTranslation; i++) {
            this._debug._m_translation.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_translation[i] = new AffineFrame(this._io, this, this._root);
            this._debug._m_translation.arr[i].end = this._io.pos;
          }
          this._debug._m_translation.end = this._io.pos;
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
          this._debug._m_child = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_child = new Mesh(this._io, this, this._root);
          this._debug._m_child.end = this._io.pos;
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
          this._debug._m_sibling = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_sibling = new Mesh(this._io, this, this._root);
          this._debug._m_sibling.end = this._io.pos;
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
          this._debug._m_displayList = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_displayList = []
          this._debug._m_displayList.arr = [];
          var i = 0;
          do {
            this._debug._m_displayList.arr[this._m_displayList.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            var _ = new DisplayListCmd(this._io, this, this._root);
            this._m_displayList.push(_);
            this._debug._m_displayList.arr[this._m_displayList.length - 1].end = this._io.pos;
            i++;
          } while (!(_.cmd == 184));
          this._debug._m_displayList.end = this._io.pos;
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
          this._debug._m_sprites = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_sprites = new Array(this.numSprites);
          this._debug._m_sprites.arr = new Array(this.numSprites);
          for (var i = 0; i < this.numSprites; i++) {
            this._debug._m_sprites.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_sprites[i] = new Sprite(this._io, this, this._root);
            this._debug._m_sprites.arr[i].end = this._io.pos;
          }
          this._debug._m_sprites.end = this._io.pos;
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
      this._debug = {};

      this._read();
    }
    Fixed115.prototype._read = function() {
      this._debug.raw = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.raw = this._io.readU2be();
      this._debug.raw.end = this._io.pos;
    }
    Object.defineProperty(Fixed115.prototype, 'value', {
      get: function() {
        if (this._m_value !== undefined)
          return this._m_value;
        this._debug._m_value = {  };
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
      this._debug = {};

      this._read();
    }
    Geometry.prototype._read = function() {
      this._debug.numFaces = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numFaces = this._io.readU2be();
      this._debug.numFaces.end = this._io.pos;
      this._debug.numVertices = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numVertices = this._io.readU2be();
      this._debug.numVertices.end = this._io.pos;
      this._debug.verticesPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.verticesPtr = this._io.readU4be();
      this._debug.verticesPtr.end = this._io.pos;
      this._debug.facesPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.facesPtr = this._io.readU4be();
      this._debug.facesPtr.end = this._io.pos;
      this._debug.u1Ptr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u1Ptr = this._io.readU4be();
      this._debug.u1Ptr.end = this._io.pos;
      this._debug.uvsPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.uvsPtr = this._io.readU4be();
      this._debug.uvsPtr.end = this._io.pos;
      this._debug.u3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u3 = this._io.readU4be();
      this._debug.u3.end = this._io.pos;
      this._debug.colorsNormsPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.colorsNormsPtr = this._io.readU4be();
      this._debug.colorsNormsPtr.end = this._io.pos;
      this._debug.u5Ptr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u5Ptr = this._io.readU4be();
      this._debug.u5Ptr.end = this._io.pos;
      this._debug.textureIdsPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.textureIdsPtr = this._io.readU4be();
      this._debug.textureIdsPtr.end = this._io.pos;
    }
    Object.defineProperty(Geometry.prototype, 'textureIds', {
      get: function() {
        if (this._m_textureIds !== undefined)
          return this._m_textureIds;
        if (this.textureIdsPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.textureIdsPtr);
          this._debug._m_textureIds = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_textureIds = new Array(this.numFaces);
          this._debug._m_textureIds.arr = new Array(this.numFaces);
          for (var i = 0; i < this.numFaces; i++) {
            this._debug._m_textureIds.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_textureIds[i] = this._io.readU4be();
            this._debug._m_textureIds.arr[i].end = this._io.pos;
          }
          this._debug._m_textureIds.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_textureIds;
      }
    });
    Object.defineProperty(Geometry.prototype, 'u5', {
      get: function() {
        if (this._m_u5 !== undefined)
          return this._m_u5;
        if (this.u5Ptr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.u5Ptr);
          this._debug._m_u5 = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_u5 = new Array(this.numFaces);
          this._debug._m_u5.arr = new Array(this.numFaces);
          for (var i = 0; i < this.numFaces; i++) {
            this._debug._m_u5.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_u5[i] = this._io.readU1();
            this._debug._m_u5.arr[i].end = this._io.pos;
          }
          this._debug._m_u5.end = this._io.pos;
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
          this._debug._m_faces = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_faces = new Array(this.numFaces);
          this._debug._m_faces.arr = new Array(this.numFaces);
          for (var i = 0; i < this.numFaces; i++) {
            this._debug._m_faces.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_faces[i] = new Face(this._io, this, this._root);
            this._debug._m_faces.arr[i].end = this._io.pos;
          }
          this._debug._m_faces.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_faces;
      }
    });
    Object.defineProperty(Geometry.prototype, 'vertices', {
      get: function() {
        if (this._m_vertices !== undefined)
          return this._m_vertices;
        if (this.verticesPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.verticesPtr);
          this._debug._m_vertices = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_vertices = new Array(this.numVertices);
          this._debug._m_vertices.arr = new Array(this.numVertices);
          for (var i = 0; i < this.numVertices; i++) {
            this._debug._m_vertices.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_vertices[i] = new Vertex(this._io, this, this._root);
            this._debug._m_vertices.arr[i].end = this._io.pos;
          }
          this._debug._m_vertices.end = this._io.pos;
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
          this._debug._m_u1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_u1 = new Array(this.numFaces);
          this._debug._m_u1.arr = new Array(this.numFaces);
          for (var i = 0; i < this.numFaces; i++) {
            this._debug._m_u1.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_u1[i] = this._io.readU4be();
            this._debug._m_u1.arr[i].end = this._io.pos;
          }
          this._debug._m_u1.end = this._io.pos;
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
          this._debug._m_uvs = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_uvs = new Array(this.numFaces);
          this._debug._m_uvs.arr = new Array(this.numFaces);
          for (var i = 0; i < this.numFaces; i++) {
            this._debug._m_uvs.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_uvs[i] = new Uv(this._io, this, this._root);
            this._debug._m_uvs.arr[i].end = this._io.pos;
          }
          this._debug._m_uvs.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_uvs;
      }
    });
    Object.defineProperty(Geometry.prototype, 'colorsNorms', {
      get: function() {
        if (this._m_colorsNorms !== undefined)
          return this._m_colorsNorms;
        if (this.colorsNormsPtr != 0) {
          var _pos = this._io.pos;
          this._io.seek(this.colorsNormsPtr);
          this._debug._m_colorsNorms = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this._m_colorsNorms = new Array(this.numVertices);
          this._debug._m_colorsNorms.arr = new Array(this.numVertices);
          for (var i = 0; i < this.numVertices; i++) {
            this._debug._m_colorsNorms.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_colorsNorms[i] = this._io.readU4be();
            this._debug._m_colorsNorms.arr[i].end = this._io.pos;
          }
          this._debug._m_colorsNorms.end = this._io.pos;
          this._io.seek(_pos);
        }
        return this._m_colorsNorms;
      }
    });

    return Geometry;
  })();

  return GloverObjbank;
})();
return GloverObjbank;
}));
