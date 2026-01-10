# BAM Versions by Toontown Version

Toontown: BAM 6.24 (3967 files)
ToontownLegacy: BAM 4.3 (1720 files)
Toontown_1.0.10.10: BAM 4.9 (2221 files)
Toontown_1.0.13.21: BAM 4.9 (2277 files)
Toontown_1.0.15.38: BAM 4.14 (2604 files)
Toontown_1.0.38.34: BAM 6.15 (3368 files)
Toontown_1.0.47.22: BAM 6.24 (3960 files)
Toontown_1.0.47.31: BAM 6.24 (3967 files)
Toontown_1.0.47.7: BAM 6.24 (3946 files)
Toontown_1.0.7.12: BAM 4.6 (1821 files)

# BAM Changelog

This is a list of revisions that changed the version number of the .bam format in chronological order.

|      | Committed                                                                                        | Comment                                                           |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 2.3  | [2000-11-21](https://github.com/panda3d/panda3d/commit/174bdd8807726dbb3be0440cfbb4631b897adacd) | dual-image textures.                                              |
| 2.4  | [2000-11-28](https://github.com/panda3d/panda3d/commit/0287c81e94ef0a871b8fad598d98be7f33ef1788) | anisotropic texture filtering.                                    |
| 3.0  | [2000-12-08](https://github.com/panda3d/panda3d/commit/d69d3fc470f953b7b47b72b385fe913691c159ab) | change float64's to float32's.                                    |
| 3.1  | [2000-12-15](https://github.com/panda3d/panda3d/commit/ba2608b7b429d0408467bb39051ce3531004bee3) | add FFT-style channel                                             |
| 3.2  | [2001-02-15](https://github.com/panda3d/panda3d/commit/032f773b53e453288fa8c00b807c5e449cc42b24) | add `ModelNode::_preserve_transform`.                             |
| 3.3  | [2001-04-11](https://github.com/panda3d/panda3d/commit/e1f0c9a90863410250484993ac0ed4cc5dac1107) | support correctly ordered children.                               |
| 3.4  | [2001-12-11](https://github.com/panda3d/panda3d/commit/fc6db22bb173173244d3939faf547ab538068276) | transpose quaternions.                                            |
| 3.5  | [2001-12-13](https://github.com/panda3d/panda3d/commit/4a0b5d3d7ea4ffb502a5b777795b6a07568f0fee) | remove obsolete fields from Texture.                              |
| 3.6  | [2002-05-16](https://github.com/panda3d/panda3d/commit/e46050a69e6929544af360c32912431124fe6c77) | add `ImageBuffer::_filename`.                                     |
| 3.7  | [2002-05-19](https://github.com/panda3d/panda3d/commit/d4482780b5ae47ecb3bd91a3ea1c18d4371be5b3) | add `CharacterJoint::_net_transform_nodes`, etc.                  |
| 4.0  | [2002-04-10](https://github.com/panda3d/panda3d/commit/a23a7572a2682cae2255c52583c2cef45d2eeb9b) | store new scene graph.                                            |
| 4.1  | [2003-04-10](https://github.com/panda3d/panda3d/commit/6e686caf8c0a42dc2d3741ee6f1041df9096d90f) | add `CullFaceAttrib::reverse`.                                    |
| 4.2  | [2003-04-12](https://github.com/panda3d/panda3d/commit/28743b123bc283e998bd676b6054d6cb62985e98) | add num_components to texture.                                    |
| 4.3  | [2003-04-15](https://github.com/panda3d/panda3d/commit/df2a60cfb09c24ed56e42c0eafd1d7ca759f818e) | add `ImageBuffer::_alpha_file_channel`.                           |
| 4.4  | [2003-06-12](https://github.com/panda3d/panda3d/commit/c03d886691380dd05fafdf4745d47659ecb24562) | add `PandaNode::set_tag()`.                                       |
| 4.5  | [2003-07-09](https://github.com/panda3d/panda3d/commit/f7569695f82a923bf4dae7eb58357d0c93bc66e6) | add rawdata mode to texture                                       |
| 4.6  | [2003-07-22](https://github.com/panda3d/panda3d/commit/344ca11ffd2e7e7f2f7c5cb416df02f0faac526f) | add shear to scene graph and animation data.                      |
| 4.7  | [2003-11-10](https://github.com/panda3d/panda3d/commit/2536db25f45f9df28dee0366e5f570651772767d) | add `CollisionSolid::_effective_normal`                           |
| 4.8  | [2003-11-12](https://github.com/panda3d/panda3d/commit/e1a8ff794c4b2eeede97903044bfecae28ee8103) | add `FFTCompressor::reject_compression`                           |
| 4.9  | [2003-12-02](https://github.com/panda3d/panda3d/commit/35f5cd7d67c8d7d85adaaca2a9b2a4dff9fc996d) | change CollisionPolygon internals.                                |
| 4.10 | [2004-04-23](https://github.com/panda3d/panda3d/commit/dec4cb4bdb9c3ef449a76a0cb291ccd4866c0da7) | make ComputedVertices use uint32's.                               |
| 4.11 | [2004-07-26](https://github.com/panda3d/panda3d/commit/c7c639797e7abad770f7eff31956d7b8a5d58dc5) | add multitexture pointers.                                        |
| 4.12 | [2004-09-22](https://github.com/panda3d/panda3d/commit/0369f07074e1f21c73937d709c2b991a34b52f66) | add `PandaNode::into_collide_mask`.                               |
| 4.13 | [2004-09-24](https://github.com/panda3d/panda3d/commit/d850afd71aaa95abfb8d3521f0abf17a4c8c5207) | store actual LODNode switch distances instead of squares.         |
| 4.14 | [2004-11-18](https://github.com/panda3d/panda3d/commit/8747959c7b41c5ef03677f665e707e383184ebed) | differentiate old_hpr from new_hpr in compressed anim channels.   |
| 4.15 | [2005-01-16](https://github.com/panda3d/panda3d/commit/d9d30855d014525415de9aad34f0955fecb76b4a) | remove width from GeomLine, etc.                                  |
| 4.16 | [2005-02-24](https://github.com/panda3d/panda3d/commit/ffdbf61985855d4ac855eee214392d49f0f3a77f) | add `TextureStage::rgb_scale`, etc.                               |
| 4.17 | [2005-03-03](https://github.com/panda3d/panda3d/commit/87d03ccb34c914fa47258a17a0524f8535d9fc9c) | add 3-d textures, etc.                                            |
| 4.18 | [2005-04-05](https://github.com/panda3d/panda3d/commit/8dd9c1419cb6be8c3453e69c4c4b424ba4b7a4ee) | add `RenderModeAttrib::perspective`.                              |
| 4.19 | [2005-04-19](https://github.com/panda3d/panda3d/commit/e0dca3b43bba2a74f97407f28339c0a67704cf29) | add nonindexed qpgeom primitives.                                 |
| 5.0  | [2005-05-06](https://github.com/panda3d/panda3d/commit/bc0d5090900a2314d1eacbd764d5a5f2f1fd3bab) | new Geom implementation.                                          |
| 5.1  | [2005-07-14](https://github.com/panda3d/panda3d/commit/ba139578e0dc7416a31a21bea68fa130c1cef1c0) | add `TextureStage::_saved_result`.                                |
| 5.2  | [2005-07-21](https://github.com/panda3d/panda3d/commit/65458d9edd882aa410509b10211da8a91e95d174) | add `TransformState::is_2d`.                                      |
| 5.3  | [2005-08-25](https://github.com/panda3d/panda3d/commit/1e81e656ab3935547de4c3a4c71b9c6f67e4e3da) | add `ModelNode::_preserve_attributes`.                            |
| 5.4  | [2005-09-27](https://github.com/panda3d/panda3d/commit/54655719635ac32c706b8d8fd6412b69a425eb15) | make SequenceNode inherit from AnimInterface.                     |
| 5.5  | [2005-12-22](https://github.com/panda3d/panda3d/commit/ef0f4859329cdd34ff3d3a673b47abc488ff05cf) | add `Texture::_border_color`.                                     |
| 5.6  | [2006-01-14](https://github.com/panda3d/panda3d/commit/cf01ef9cd6e70355d64dcc5e68b5bd69bfaac202) | add `Material::_name`.                                            |
| 6.0  | [2006-02-11](https://github.com/panda3d/panda3d/commit/1d2282a879145b237fcb2d5f6fbf55510df663e6) | factor out `PandaNode::CData`.                                    |
| 6.1  | [2006-03-12](https://github.com/panda3d/panda3d/commit/e6369ba5a4211ddc1e6cd320f33c75a4d4e1dcb1) | add `Texture::_compression`.                                      |
| 6.2  | [2006-03-17](https://github.com/panda3d/panda3d/commit/725e82e6f465d0cabc7ec1a3f70f77817f1e2f1e) | add `PandaNode::_draw_control_mask`.                              |
| 6.3  | [2006-03-21](https://github.com/panda3d/panda3d/commit/f803ef85ceeaa8247ff72e73a259300ff01c9a63) | add `Texture::_ram_images`.                                       |
| 6.4  | [2006-07-26](https://github.com/panda3d/panda3d/commit/8e178ae9d605940f1c8b9125cb9f70e5828277c0) | add `CharacterJoint::_character`.                                 |
| 6.5  | [2006-11-15](https://github.com/panda3d/panda3d/commit/ccec9eb3df572159d03509f14474ea11b2659b64) | add `PartBundleNode::_num_bundles`.                               |
| 6.6  | [2007-02-05](https://github.com/panda3d/panda3d/commit/63edecf517525d39c61cfb9aaac3533fab4032ad) | change `GeomPrimitive::_num_vertices`.                            |
| 6.7  | [2007-02-15](https://github.com/panda3d/panda3d/commit/e43f4f5c64a3a2eeac38d6954e43ea67af9217fc) | change SliderTable.                                               |
| 6.8  | [2007-05-12](https://github.com/panda3d/panda3d/commit/0329972a41939b40c79ddb681b5a7afb6c6e5ae2) | change `GeomVertexArrayData::_data`.                              |
| 6.9  | [2007-05-15](https://github.com/panda3d/panda3d/commit/7e08d7b759a5ef23a817c90cbce8bc9ab664af54) | add `PlaneNode::_clip_effect`.                                    |
| 6.10 | [2007-06-19](https://github.com/panda3d/panda3d/commit/823bd7a56c76f85ba9bf5b29524f3e23344e7a4b) | properly write PartBundles.                                       |
| 6.11 | [2007-06-20](https://github.com/panda3d/panda3d/commit/4bce07faaa667c35cf5604b9a6d236baf9528467) | write frozen joints to PartGroups.                                |
| 6.12 | [2007-07-03](https://github.com/panda3d/panda3d/commit/81ae62f553607abd1e9b85e7dcd8e8135c3b3b98) | rework control/frozen joints more.                                |
| 6.13 | [2007-08-15](https://github.com/panda3d/panda3d/commit/1ccd464d81f9d4b982cc9ac9b43d0ab3235f284b) | reverse CollisionPolygon vertices.                                |
| 6.14 | [2007-12-19](https://github.com/panda3d/panda3d/commit/775466b4bd74c15e09f17b67b19cba2840091757) | change default ColorAttrib.                                       |
| 6.15 | [2008-04-09](https://github.com/panda3d/panda3d/commit/a667e91dce10bacfabdf59ecdc9bc0457b97de17) | add `TextureAttrib::_implicit_sort`.                              |
| 6.16 | [2008-05-13](https://github.com/panda3d/panda3d/commit/acb0faae46e383d4a7a9dabd1062d6d91256fe68) | add `Texture::_quality_level`.                                    |
| 6.17 | [2008-08-06](https://github.com/panda3d/panda3d/commit/35baf6a2eeee00403b40a96ad6a230bfcae65028) | add `PartBundle::_anim_preload`.                                  |
| 6.18 | [2008-08-14](https://github.com/panda3d/panda3d/commit/617a769ef760f7564bd3d64ddfbe6629a55c748c) | add `Texture::_simple_ram_image`.                                 |
|      | [2008-08-14](https://github.com/panda3d/panda3d/commit/b07dbcc262263b1bb74288d47d3d95ae7e1994bb) | remove support for pre-6.14 bams                                  |
| 6.19 | [2008-08-14](https://github.com/panda3d/panda3d/commit/ddbad778518638a4aae0b6357c578789f0931213) | add `PandaNode::_bounds_type`.                                    |
| 6.20 | [2009-04-21](https://github.com/panda3d/panda3d/commit/aee550231c7b5b5b234efc625b72d71b5ca7b58c) | add `MovingPartBase::_forced_channel`.                            |
| 6.21 | [2008-02-26](https://github.com/panda3d/panda3d/commit/aefe3d35c2f2fbcf67a46ed92e5c0a409bfc1172) | add `BamEnums::BamObjectCode`.                                    |
| 6.22 | [2009-07-31](https://github.com/panda3d/panda3d/commit/8db00b4f74e0edae94c2a8cda91c4e126e48033c) | add UvScrollNode R speed.                                         |
| 6.23 | [2010-05-04](https://github.com/panda3d/panda3d/commit/9d62ca9f98b29995f770fbfd083b5760ef52e523) | add internal TextureAttrib overrides.                             |
| 6.24 | [2010-05-04](https://github.com/panda3d/panda3d/commit/91e6231a3c948d3e011512bc81ed778f054a2f54) | add internal TexMatrixAttrib overrides.                           |
| 6.25 | [2011-06-22](https://github.com/panda3d/panda3d/commit/285d70c29e0d16f7bf77d51889e5116f0b0b896e) | add support for caching movie files.                              |
| 6.26 | [2011-08-05](https://github.com/panda3d/panda3d/commit/6872488839b5c979f4926bb258b17fa651a83bda) | add multiview (stereo) Textures.                                  |
| 6.27 | [2011-10-09](https://github.com/panda3d/panda3d/commit/501470169f0513d1075427eb0069a6aeea30ef5d) | add stdfloat_double.                                              |
| 6.28 | [2011-11-28](https://github.com/panda3d/panda3d/commit/3d89cef5443266eedb16ee23a72124ea8cad6ae5) | add `Texture::_auto_texture_scale`.                               |
| 6.29 | [2011-12-17](https://github.com/panda3d/panda3d/commit/a4728957da7086a3025740335807918e4173808a) | add `GeomVertexColumn::_column_alignment`.                        |
| 6.30 | [2012-01-22](https://github.com/panda3d/panda3d/commit/deb8a56b8acd7b034834aeaf79d298ed67921545) | add `Texture::_pad_*_size`.                                       |
| 6.31 | [2012-02-16](https://github.com/panda3d/panda3d/commit/3a75ebde9a805648f0d581ceb8f032ca5db5448c) | add `DepthOffsetAttrib::_min_value`, `_max_value`                 |
| 6.32 | [2012-06-11](https://github.com/panda3d/panda3d/commit/5ba7076808908cd2ff676e032beb1d8f20acf1e8) | add `Texture::_has_read_mipmaps`.                                 |
| 6.33 | [2013-08-17](https://github.com/panda3d/panda3d/commit/a585faa807765c5b297533cb45020cb93d636c56) | add `UvScrollNode::_w_speed`.                                     |
| 6.34 | [2014-09-16](https://github.com/panda3d/panda3d/commit/8b7217b4f9d80284a3b4e9fcb15d34c24add11bd) | add `ScissorAttrib::_off`.                                        |
| 6.35 | [2014-12-03](https://github.com/panda3d/panda3d/commit/0473fa7eadece14d046be963a7f505e91ea6b8ed) | change StencilAttrib.                                             |
| 6.36 | [2014-12-09](https://github.com/panda3d/panda3d/commit/95d85819b032a26b2eb1f06798f746235607cca3) | add samplers and lod settings.                                    |
| 6.37 | [2015-01-22](https://github.com/panda3d/panda3d/commit/77c9e6cf6c4bb52d5d39777f3e47c94c369f8b0c) | add `GeomVertexArrayFormat::_divisor`.                            |
| 6.38 | [2015-04-15](https://github.com/panda3d/panda3d/commit/38ac0401ce19ff326ee54f451782efef2c508d07) | add various Bullet classes.                                       |
| 6.39 | [2016-01-09](https://github.com/panda3d/panda3d/commit/3393454582a6330dbc3df775d29e94221198863a) | change lights and materials.                                      |
| 6.40 | [2016-01-11](https://github.com/panda3d/panda3d/commit/41fad59ae8c32eb23c1ef848f64f803a0d54eec9) | make NodePaths writable.                                          |
| 6.41 | [2016-03-02](https://github.com/panda3d/panda3d/commit/2971915618053b159069b5dcb28ed55ac826f1a3) | change LensNode, Lens and Camera.                                 |
| 6.42 | [2016-04-08](https://github.com/panda3d/panda3d/commit/f0cd1ce3158e52c4b3b8ed338ec510c9d2a33398) | expand ColorBlendAttrib.                                          |
| 6.43 | [2018-12-06](https://github.com/panda3d/panda3d/commit/89236ac1360e5f0249d425e61d537deef40e71c3) | change BillboardEffect and CompassEffect.                         |
| 6.44 | [2018-12-23](https://github.com/panda3d/panda3d/commit/bd6ef2b0ea2832ff1095f9e41b3137452f0619f4) | rename CollisionTube to CollisionCapsule.                         |
| 6.45 | [2020-03-18](https://github.com/panda3d/panda3d/commit/e138096578c5cd7a7f509dfb0c2dbc30c369a7dc) | add `Texture::_clear_color`.                                      |
