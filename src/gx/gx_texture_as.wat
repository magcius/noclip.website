(module
 (type $iiiiiv (func (param i32 i32 i32 i32 i32)))
 (type $i (func (result i32)))
 (global $HEAP_BASE i32 (i32.const 4))
 (memory $0 1)
 (export "decode_I4" (func $src/gx/gx_texture_as/decode_I4))
 (export "decode_I8" (func $src/gx/gx_texture_as/decode_I8))
 (export "decode_IA4" (func $src/gx/gx_texture_as/decode_IA4))
 (export "decode_IA8" (func $src/gx/gx_texture_as/decode_IA8))
 (export "decode_RGB565" (func $src/gx/gx_texture_as/decode_RGB565))
 (export "decode_RGB5A3" (func $src/gx/gx_texture_as/decode_RGB5A3))
 (export "decode_RGBA8" (func $src/gx/gx_texture_as/decode_RGBA8))
 (export "decode_CMPR" (func $src/gx/gx_texture_as/decode_CMPR))
 (export "memory" (memory $0))
 (func $src/gx/gx_texture_as/decode_I4 (; 0 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 8)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 8)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get|inlined.0 (result i32)
                     (set_local $12
                      (i32.add
                       (get_local $2)
                       (i32.shr_u
                        (get_local $5)
                        (i32.const 1)
                       )
                      )
                     )
                     (br $src/gx/gx_texture_as/get|inlined.0
                      (i32.load8_u
                       (get_local $12)
                      )
                     )
                    )
                   )
                   (set_local $14
                    (i32.and
                     (i32.shr_u
                      (i32.and
                       (get_local $13)
                       (i32.const 255)
                      )
                      (if (result i32)
                       (i32.and
                        (get_local $5)
                        (i32.const 1)
                       )
                       (i32.const 0)
                       (i32.const 4)
                      )
                     )
                     (i32.const 15)
                    )
                   )
                   (set_local $15
                    (block $src/gx/gx_texture_as/expand4to8|inlined.0 (result i32)
                     (br $src/gx/gx_texture_as/expand4to8|inlined.0
                      (i32.and
                       (i32.or
                        (i32.shl
                         (get_local $14)
                         (i32.const 4)
                        )
                        (get_local $14)
                       )
                       (i32.const 255)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.0
                    (set_local $16
                     (i32.add
                      (get_local $11)
                      (i32.const 0)
                     )
                    )
                    (i32.store8
                     (get_local $16)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.1
                    (set_local $17
                     (i32.add
                      (get_local $11)
                      (i32.const 1)
                     )
                    )
                    (i32.store8
                     (get_local $17)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.2
                    (set_local $18
                     (i32.add
                      (get_local $11)
                      (i32.const 2)
                     )
                    )
                    (i32.store8
                     (get_local $18)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.3
                    (set_local $19
                     (i32.add
                      (get_local $11)
                      (i32.const 3)
                     )
                    )
                    (i32.store8
                     (get_local $19)
                     (get_local $15)
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 1)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 8)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 8)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_I8 (; 1 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 4)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 8)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get|inlined.1 (result i32)
                     (set_local $12
                      (i32.add
                       (get_local $2)
                       (get_local $5)
                      )
                     )
                     (br $src/gx/gx_texture_as/get|inlined.1
                      (i32.load8_u
                       (get_local $12)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.4
                    (set_local $14
                     (i32.add
                      (get_local $11)
                      (i32.const 0)
                     )
                    )
                    (i32.store8
                     (get_local $14)
                     (get_local $13)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.5
                    (set_local $15
                     (i32.add
                      (get_local $11)
                      (i32.const 1)
                     )
                    )
                    (i32.store8
                     (get_local $15)
                     (get_local $13)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.6
                    (set_local $16
                     (i32.add
                      (get_local $11)
                      (i32.const 2)
                     )
                    )
                    (i32.store8
                     (get_local $16)
                     (get_local $13)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.7
                    (set_local $17
                     (i32.add
                      (get_local $11)
                      (i32.const 3)
                     )
                    )
                    (i32.store8
                     (get_local $17)
                     (get_local $13)
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 1)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 8)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_IA4 (; 2 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 4)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 8)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get|inlined.2 (result i32)
                     (set_local $12
                      (i32.add
                       (get_local $2)
                       (get_local $5)
                      )
                     )
                     (br $src/gx/gx_texture_as/get|inlined.2
                      (i32.load8_u
                       (get_local $12)
                      )
                     )
                    )
                   )
                   (set_local $15
                    (block $src/gx/gx_texture_as/expand4to8|inlined.1 (result i32)
                     (set_local $14
                      (i32.shr_u
                       (i32.and
                        (get_local $13)
                        (i32.const 255)
                       )
                       (i32.const 4)
                      )
                     )
                     (br $src/gx/gx_texture_as/expand4to8|inlined.1
                      (i32.and
                       (i32.or
                        (i32.shl
                         (get_local $14)
                         (i32.const 4)
                        )
                        (get_local $14)
                       )
                       (i32.const 255)
                      )
                     )
                    )
                   )
                   (set_local $17
                    (block $src/gx/gx_texture_as/expand4to8|inlined.2 (result i32)
                     (set_local $16
                      (i32.and
                       (get_local $13)
                       (i32.const 15)
                      )
                     )
                     (br $src/gx/gx_texture_as/expand4to8|inlined.2
                      (i32.and
                       (i32.or
                        (i32.shl
                         (get_local $16)
                         (i32.const 4)
                        )
                        (get_local $16)
                       )
                       (i32.const 255)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.8
                    (set_local $18
                     (i32.add
                      (get_local $11)
                      (i32.const 0)
                     )
                    )
                    (i32.store8
                     (get_local $18)
                     (get_local $17)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.9
                    (set_local $19
                     (i32.add
                      (get_local $11)
                      (i32.const 1)
                     )
                    )
                    (i32.store8
                     (get_local $19)
                     (get_local $17)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.10
                    (set_local $20
                     (i32.add
                      (get_local $11)
                      (i32.const 2)
                     )
                    )
                    (i32.store8
                     (get_local $20)
                     (get_local $17)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.11
                    (set_local $21
                     (i32.add
                      (get_local $11)
                      (i32.const 3)
                     )
                    )
                    (i32.store8
                     (get_local $21)
                     (get_local $15)
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 1)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 8)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_IA8 (; 3 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 4)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 4)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get|inlined.3 (result i32)
                     (set_local $12
                      (i32.add
                       (i32.add
                        (get_local $2)
                        (get_local $5)
                       )
                       (i32.const 0)
                      )
                     )
                     (br $src/gx/gx_texture_as/get|inlined.3
                      (i32.load8_u
                       (get_local $12)
                      )
                     )
                    )
                   )
                   (set_local $15
                    (block $src/gx/gx_texture_as/get|inlined.4 (result i32)
                     (set_local $14
                      (i32.add
                       (i32.add
                        (get_local $2)
                        (get_local $5)
                       )
                       (i32.const 1)
                      )
                     )
                     (br $src/gx/gx_texture_as/get|inlined.4
                      (i32.load8_u
                       (get_local $14)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.12
                    (set_local $16
                     (i32.add
                      (get_local $11)
                      (i32.const 0)
                     )
                    )
                    (i32.store8
                     (get_local $16)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.13
                    (set_local $17
                     (i32.add
                      (get_local $11)
                      (i32.const 1)
                     )
                    )
                    (i32.store8
                     (get_local $17)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.14
                    (set_local $18
                     (i32.add
                      (get_local $11)
                      (i32.const 2)
                     )
                    )
                    (i32.store8
                     (get_local $18)
                     (get_local $15)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.15
                    (set_local $19
                     (i32.add
                      (get_local $11)
                      (i32.const 3)
                     )
                    )
                    (i32.store8
                     (get_local $19)
                     (get_local $13)
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 2)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 4)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_RGB565 (; 4 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 4)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 4)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get16be|inlined.0 (result i32)
                     (set_local $12
                      (i32.add
                       (get_local $2)
                       (get_local $5)
                      )
                     )
                     (br $src/gx/gx_texture_as/get16be|inlined.0
                      (i32.and
                       (i32.or
                        (i32.shl
                         (i32.load8_u
                          (get_local $12)
                         )
                         (i32.const 8)
                        )
                        (i32.load8_u
                         (i32.add
                          (get_local $12)
                          (i32.const 1)
                         )
                        )
                       )
                       (i32.const 65535)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.16
                    (set_local $14
                     (i32.add
                      (get_local $11)
                      (i32.const 0)
                     )
                    )
                    (set_local $16
                     (block $src/gx/gx_texture_as/expand5to8|inlined.0 (result i32)
                      (set_local $15
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $13)
                          (i32.const 65535)
                         )
                         (i32.const 11)
                        )
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.0
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $15)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $15)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $14)
                     (get_local $16)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.17
                    (set_local $17
                     (i32.add
                      (get_local $11)
                      (i32.const 1)
                     )
                    )
                    (set_local $19
                     (block $src/gx/gx_texture_as/expand6to8|inlined.0 (result i32)
                      (set_local $18
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $13)
                          (i32.const 65535)
                         )
                         (i32.const 5)
                        )
                        (i32.const 63)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand6to8|inlined.0
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $18)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 6)
                          )
                         )
                         (i32.shr_u
                          (get_local $18)
                          (i32.sub
                           (i32.const 12)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $17)
                     (get_local $19)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.18
                    (set_local $20
                     (i32.add
                      (get_local $11)
                      (i32.const 2)
                     )
                    )
                    (set_local $22
                     (block $src/gx/gx_texture_as/expand5to8|inlined.1 (result i32)
                      (set_local $21
                       (i32.and
                        (get_local $13)
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.1
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $21)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $21)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $20)
                     (get_local $22)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.19
                    (set_local $23
                     (i32.add
                      (get_local $11)
                      (i32.const 3)
                     )
                    )
                    (set_local $24
                     (i32.const 255)
                    )
                    (i32.store8
                     (get_local $23)
                     (get_local $24)
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 2)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 4)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_RGB5A3 (; 5 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  (local $34 i32)
  (local $35 i32)
  (local $36 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $8
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $8)
              (i32.const 4)
             )
             (block
              (block $break|3
               (set_local $9
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $9)
                  (i32.const 4)
                 )
                 (block
                  (block
                   (set_local $10
                    (i32.add
                     (i32.add
                      (i32.mul
                       (get_local $3)
                       (i32.add
                        (get_local $6)
                        (i32.and
                         (get_local $8)
                         (i32.const 255)
                        )
                       )
                      )
                      (get_local $7)
                     )
                     (i32.and
                      (get_local $9)
                      (i32.const 255)
                     )
                    )
                   )
                   (set_local $11
                    (i32.add
                     (get_local $1)
                     (i32.mul
                      (get_local $10)
                      (i32.const 4)
                     )
                    )
                   )
                   (set_local $13
                    (block $src/gx/gx_texture_as/get16be|inlined.1 (result i32)
                     (set_local $12
                      (i32.add
                       (get_local $2)
                       (get_local $5)
                      )
                     )
                     (br $src/gx/gx_texture_as/get16be|inlined.1
                      (i32.and
                       (i32.or
                        (i32.shl
                         (i32.load8_u
                          (get_local $12)
                         )
                         (i32.const 8)
                        )
                        (i32.load8_u
                         (i32.add
                          (get_local $12)
                          (i32.const 1)
                         )
                        )
                       )
                       (i32.const 65535)
                      )
                     )
                    )
                   )
                   (if
                    (i32.and
                     (get_local $13)
                     (i32.const 32768)
                    )
                    (block
                     (block $src/gx/gx_texture_as/set|inlined.20
                      (set_local $14
                       (i32.add
                        (get_local $11)
                        (i32.const 0)
                       )
                      )
                      (set_local $16
                       (block $src/gx/gx_texture_as/expand5to8|inlined.2 (result i32)
                        (set_local $15
                         (i32.and
                          (i32.shr_u
                           (i32.and
                            (get_local $13)
                            (i32.const 65535)
                           )
                           (i32.const 10)
                          )
                          (i32.const 31)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand5to8|inlined.2
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $15)
                            (i32.sub
                             (i32.const 8)
                             (i32.const 5)
                            )
                           )
                           (i32.shr_u
                            (get_local $15)
                            (i32.sub
                             (i32.const 10)
                             (i32.const 8)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $14)
                       (get_local $16)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.21
                      (set_local $17
                       (i32.add
                        (get_local $11)
                        (i32.const 1)
                       )
                      )
                      (set_local $19
                       (block $src/gx/gx_texture_as/expand5to8|inlined.3 (result i32)
                        (set_local $18
                         (i32.and
                          (i32.shr_u
                           (i32.and
                            (get_local $13)
                            (i32.const 65535)
                           )
                           (i32.const 5)
                          )
                          (i32.const 31)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand5to8|inlined.3
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $18)
                            (i32.sub
                             (i32.const 8)
                             (i32.const 5)
                            )
                           )
                           (i32.shr_u
                            (get_local $18)
                            (i32.sub
                             (i32.const 10)
                             (i32.const 8)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $17)
                       (get_local $19)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.22
                      (set_local $20
                       (i32.add
                        (get_local $11)
                        (i32.const 2)
                       )
                      )
                      (set_local $22
                       (block $src/gx/gx_texture_as/expand5to8|inlined.4 (result i32)
                        (set_local $21
                         (i32.and
                          (get_local $13)
                          (i32.const 31)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand5to8|inlined.4
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $21)
                            (i32.sub
                             (i32.const 8)
                             (i32.const 5)
                            )
                           )
                           (i32.shr_u
                            (get_local $21)
                            (i32.sub
                             (i32.const 10)
                             (i32.const 8)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $20)
                       (get_local $22)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.23
                      (set_local $23
                       (i32.add
                        (get_local $11)
                        (i32.const 3)
                       )
                      )
                      (set_local $24
                       (i32.const 255)
                      )
                      (i32.store8
                       (get_local $23)
                       (get_local $24)
                      )
                     )
                    )
                    (block
                     (block $src/gx/gx_texture_as/set|inlined.24
                      (set_local $25
                       (i32.add
                        (get_local $11)
                        (i32.const 0)
                       )
                      )
                      (set_local $27
                       (block $src/gx/gx_texture_as/expand4to8|inlined.3 (result i32)
                        (set_local $26
                         (i32.and
                          (i32.shr_u
                           (i32.and
                            (get_local $13)
                            (i32.const 65535)
                           )
                           (i32.const 8)
                          )
                          (i32.const 15)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand4to8|inlined.3
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $26)
                            (i32.const 4)
                           )
                           (get_local $26)
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $25)
                       (get_local $27)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.25
                      (set_local $28
                       (i32.add
                        (get_local $11)
                        (i32.const 1)
                       )
                      )
                      (set_local $30
                       (block $src/gx/gx_texture_as/expand4to8|inlined.4 (result i32)
                        (set_local $29
                         (i32.and
                          (i32.shr_u
                           (i32.and
                            (get_local $13)
                            (i32.const 65535)
                           )
                           (i32.const 4)
                          )
                          (i32.const 15)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand4to8|inlined.4
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $29)
                            (i32.const 4)
                           )
                           (get_local $29)
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $28)
                       (get_local $30)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.26
                      (set_local $31
                       (i32.add
                        (get_local $11)
                        (i32.const 2)
                       )
                      )
                      (set_local $33
                       (block $src/gx/gx_texture_as/expand4to8|inlined.5 (result i32)
                        (set_local $32
                         (i32.and
                          (get_local $13)
                          (i32.const 15)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand4to8|inlined.5
                         (i32.and
                          (i32.or
                           (i32.shl
                            (get_local $32)
                            (i32.const 4)
                           )
                           (get_local $32)
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $31)
                       (get_local $33)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.27
                      (set_local $34
                       (i32.add
                        (get_local $11)
                        (i32.const 3)
                       )
                      )
                      (set_local $36
                       (block $src/gx/gx_texture_as/expand3to8|inlined.0 (result i32)
                        (set_local $35
                         (i32.shr_u
                          (i32.and
                           (get_local $13)
                           (i32.const 65535)
                          )
                          (i32.const 12)
                         )
                        )
                        (br $src/gx/gx_texture_as/expand3to8|inlined.0
                         (i32.and
                          (i32.or
                           (i32.or
                            (i32.shl
                             (get_local $35)
                             (i32.sub
                              (i32.const 8)
                              (i32.const 3)
                             )
                            )
                            (i32.shl
                             (get_local $35)
                             (i32.sub
                              (i32.const 8)
                              (i32.const 6)
                             )
                            )
                           )
                           (i32.shr_u
                            (i32.and
                             (get_local $35)
                             (i32.const 255)
                            )
                            (i32.sub
                             (i32.const 9)
                             (i32.const 8)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $34)
                       (get_local $36)
                      )
                     )
                    )
                   )
                   (set_local $5
                    (i32.add
                     (get_local $5)
                     (i32.const 2)
                    )
                   )
                  )
                  (set_local $9
                   (i32.add
                    (get_local $9)
                    (i32.const 1)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $8
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 4)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_RGBA8 (; 6 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (set_local $5
   (i32.const 0)
  )
  (block $break|0
   (set_local $6
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $6)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $7
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $7)
          (get_local $3)
         )
         (block
          (block
           (block $break|2
            (set_local $8
             (i32.const 0)
            )
            (loop $continue|2
             (if
              (i32.lt_u
               (get_local $8)
               (i32.const 4)
              )
              (block
               (block $break|3
                (set_local $9
                 (i32.const 0)
                )
                (loop $continue|3
                 (if
                  (i32.lt_u
                   (get_local $9)
                   (i32.const 4)
                  )
                  (block
                   (block
                    (set_local $10
                     (i32.add
                      (i32.add
                       (i32.mul
                        (get_local $3)
                        (i32.add
                         (get_local $6)
                         (get_local $8)
                        )
                       )
                       (get_local $7)
                      )
                      (get_local $9)
                     )
                    )
                    (set_local $11
                     (i32.add
                      (get_local $1)
                      (i32.mul
                       (get_local $10)
                       (i32.const 4)
                      )
                     )
                    )
                    (block $src/gx/gx_texture_as/set|inlined.28
                     (set_local $12
                      (i32.add
                       (get_local $11)
                       (i32.const 3)
                      )
                     )
                     (set_local $14
                      (block $src/gx/gx_texture_as/get|inlined.5 (result i32)
                       (set_local $13
                        (i32.add
                         (i32.add
                          (get_local $2)
                          (get_local $5)
                         )
                         (i32.const 0)
                        )
                       )
                       (br $src/gx/gx_texture_as/get|inlined.5
                        (i32.load8_u
                         (get_local $13)
                        )
                       )
                      )
                     )
                     (i32.store8
                      (get_local $12)
                      (get_local $14)
                     )
                    )
                    (block $src/gx/gx_texture_as/set|inlined.29
                     (set_local $15
                      (i32.add
                       (get_local $11)
                       (i32.const 0)
                      )
                     )
                     (set_local $17
                      (block $src/gx/gx_texture_as/get|inlined.6 (result i32)
                       (set_local $16
                        (i32.add
                         (i32.add
                          (get_local $2)
                          (get_local $5)
                         )
                         (i32.const 1)
                        )
                       )
                       (br $src/gx/gx_texture_as/get|inlined.6
                        (i32.load8_u
                         (get_local $16)
                        )
                       )
                      )
                     )
                     (i32.store8
                      (get_local $15)
                      (get_local $17)
                     )
                    )
                    (set_local $5
                     (i32.add
                      (get_local $5)
                      (i32.const 2)
                     )
                    )
                   )
                   (set_local $9
                    (i32.add
                     (get_local $9)
                     (i32.const 1)
                    )
                   )
                   (br $continue|3)
                  )
                 )
                )
               )
               (set_local $8
                (i32.add
                 (get_local $8)
                 (i32.const 1)
                )
               )
               (br $continue|2)
              )
             )
            )
           )
           (block $break|4
            (set_local $18
             (i32.const 0)
            )
            (loop $continue|4
             (if
              (i32.lt_u
               (get_local $18)
               (i32.const 4)
              )
              (block
               (block $break|5
                (set_local $19
                 (i32.const 0)
                )
                (loop $continue|5
                 (if
                  (i32.lt_u
                   (get_local $19)
                   (i32.const 4)
                  )
                  (block
                   (block
                    (set_local $20
                     (i32.add
                      (i32.add
                       (i32.mul
                        (get_local $3)
                        (i32.add
                         (get_local $6)
                         (get_local $18)
                        )
                       )
                       (get_local $7)
                      )
                      (get_local $19)
                     )
                    )
                    (set_local $21
                     (i32.add
                      (get_local $1)
                      (i32.mul
                       (get_local $20)
                       (i32.const 4)
                      )
                     )
                    )
                    (block $src/gx/gx_texture_as/set|inlined.30
                     (set_local $22
                      (i32.add
                       (get_local $21)
                       (i32.const 1)
                      )
                     )
                     (set_local $24
                      (block $src/gx/gx_texture_as/get|inlined.7 (result i32)
                       (set_local $23
                        (i32.add
                         (i32.add
                          (get_local $2)
                          (get_local $5)
                         )
                         (i32.const 0)
                        )
                       )
                       (br $src/gx/gx_texture_as/get|inlined.7
                        (i32.load8_u
                         (get_local $23)
                        )
                       )
                      )
                     )
                     (i32.store8
                      (get_local $22)
                      (get_local $24)
                     )
                    )
                    (block $src/gx/gx_texture_as/set|inlined.31
                     (set_local $25
                      (i32.add
                       (get_local $21)
                       (i32.const 2)
                      )
                     )
                     (set_local $27
                      (block $src/gx/gx_texture_as/get|inlined.8 (result i32)
                       (set_local $26
                        (i32.add
                         (i32.add
                          (get_local $2)
                          (get_local $5)
                         )
                         (i32.const 1)
                        )
                       )
                       (br $src/gx/gx_texture_as/get|inlined.8
                        (i32.load8_u
                         (get_local $26)
                        )
                       )
                      )
                     )
                     (i32.store8
                      (get_local $25)
                      (get_local $27)
                     )
                    )
                    (set_local $5
                     (i32.add
                      (get_local $5)
                      (i32.const 2)
                     )
                    )
                   )
                   (set_local $19
                    (i32.add
                     (get_local $19)
                     (i32.const 1)
                    )
                   )
                   (br $continue|5)
                  )
                 )
                )
               )
               (set_local $18
                (i32.add
                 (get_local $18)
                 (i32.const 1)
                )
               )
               (br $continue|4)
              )
             )
            )
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 4)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
 (func $src/gx/gx_texture_as/decode_CMPR (; 7 ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  (local $34 i32)
  (local $35 i32)
  (local $36 i32)
  (local $37 i32)
  (local $38 i32)
  (local $39 i32)
  (local $40 i32)
  (local $41 i32)
  (local $42 i32)
  (local $43 i32)
  (local $44 i32)
  (local $45 i32)
  (local $46 i32)
  (local $47 i32)
  (local $48 i32)
  (local $49 i32)
  (local $50 i32)
  (local $51 i32)
  (local $52 i32)
  (local $53 i32)
  (local $54 i32)
  (local $55 i32)
  (local $56 i32)
  (local $57 i32)
  (local $58 i32)
  (local $59 i32)
  (local $60 i32)
  (local $61 i32)
  (local $62 i32)
  (local $63 i32)
  (local $64 i32)
  (local $65 i32)
  (local $66 i32)
  (local $67 i32)
  (local $68 i32)
  (local $69 i32)
  (local $70 i32)
  (local $71 i32)
  (local $72 i32)
  (local $73 i32)
  (local $74 i32)
  (local $75 i32)
  (local $76 i32)
  (local $77 i32)
  (local $78 i32)
  (local $79 i32)
  (local $80 i32)
  (local $81 i32)
  (local $82 i32)
  (local $83 i32)
  (local $84 i32)
  (local $85 i32)
  (local $86 i32)
  (local $87 i32)
  (local $88 i32)
  (local $89 i32)
  (local $90 i32)
  (local $91 i32)
  (local $92 i32)
  (local $93 i32)
  (local $94 i32)
  (local $95 i32)
  (local $96 i32)
  (local $97 i32)
  (local $98 i32)
  (local $99 i32)
  (local $100 i32)
  (local $101 i32)
  (local $102 i32)
  (local $103 i32)
  (local $104 i32)
  (local $105 i32)
  (local $106 i32)
  (local $107 i32)
  (local $108 i32)
  (local $109 i32)
  (local $110 i32)
  (local $111 i32)
  (local $112 i32)
  (local $113 i32)
  (local $114 i32)
  (local $115 i32)
  (local $116 i32)
  (local $117 i32)
  (local $118 i32)
  (local $119 i32)
  (local $120 i32)
  (local $121 i32)
  (local $122 i32)
  (local $123 i32)
  (local $124 i32)
  (local $125 i32)
  (local $126 i32)
  (local $127 i32)
  (local $128 i32)
  (local $129 i32)
  (local $130 i32)
  (local $131 i32)
  (local $132 i32)
  (local $133 i32)
  (local $134 i32)
  (local $135 i32)
  (set_local $5
   (get_local $0)
  )
  (set_local $6
   (get_local $2)
  )
  (block $break|0
   (set_local $7
    (i32.const 0)
   )
   (loop $continue|0
    (if
     (i32.lt_u
      (get_local $7)
      (get_local $4)
     )
     (block
      (block $break|1
       (set_local $8
        (i32.const 0)
       )
       (loop $continue|1
        (if
         (i32.lt_u
          (get_local $8)
          (get_local $3)
         )
         (block
          (block $break|2
           (set_local $9
            (i32.const 0)
           )
           (loop $continue|2
            (if
             (i32.lt_u
              (get_local $9)
              (i32.const 8)
             )
             (block
              (block $break|3
               (set_local $10
                (i32.const 0)
               )
               (loop $continue|3
                (if
                 (i32.lt_u
                  (get_local $10)
                  (i32.const 8)
                 )
                 (block
                  (block
                   (set_local $12
                    (block $src/gx/gx_texture_as/get16be|inlined.2 (result i32)
                     (set_local $11
                      (i32.add
                       (get_local $6)
                       (i32.const 0)
                      )
                     )
                     (br $src/gx/gx_texture_as/get16be|inlined.2
                      (i32.and
                       (i32.or
                        (i32.shl
                         (i32.load8_u
                          (get_local $11)
                         )
                         (i32.const 8)
                        )
                        (i32.load8_u
                         (i32.add
                          (get_local $11)
                          (i32.const 1)
                         )
                        )
                       )
                       (i32.const 65535)
                      )
                     )
                    )
                   )
                   (set_local $14
                    (block $src/gx/gx_texture_as/get16be|inlined.3 (result i32)
                     (set_local $13
                      (i32.add
                       (get_local $6)
                       (i32.const 2)
                      )
                     )
                     (br $src/gx/gx_texture_as/get16be|inlined.3
                      (i32.and
                       (i32.or
                        (i32.shl
                         (i32.load8_u
                          (get_local $13)
                         )
                         (i32.const 8)
                        )
                        (i32.load8_u
                         (i32.add
                          (get_local $13)
                          (i32.const 1)
                         )
                        )
                       )
                       (i32.const 65535)
                      )
                     )
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.32
                    (set_local $15
                     (i32.add
                      (get_local $5)
                      (i32.const 0)
                     )
                    )
                    (set_local $17
                     (block $src/gx/gx_texture_as/expand5to8|inlined.5 (result i32)
                      (set_local $16
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $12)
                          (i32.const 65535)
                         )
                         (i32.const 11)
                        )
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.5
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $16)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $16)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $15)
                     (get_local $17)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.33
                    (set_local $18
                     (i32.add
                      (get_local $5)
                      (i32.const 1)
                     )
                    )
                    (set_local $20
                     (block $src/gx/gx_texture_as/expand6to8|inlined.1 (result i32)
                      (set_local $19
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $12)
                          (i32.const 65535)
                         )
                         (i32.const 5)
                        )
                        (i32.const 63)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand6to8|inlined.1
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $19)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 6)
                          )
                         )
                         (i32.shr_u
                          (get_local $19)
                          (i32.sub
                           (i32.const 12)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $18)
                     (get_local $20)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.34
                    (set_local $21
                     (i32.add
                      (get_local $5)
                      (i32.const 2)
                     )
                    )
                    (set_local $23
                     (block $src/gx/gx_texture_as/expand5to8|inlined.6 (result i32)
                      (set_local $22
                       (i32.and
                        (get_local $12)
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.6
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $22)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $22)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $21)
                     (get_local $23)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.35
                    (set_local $24
                     (i32.add
                      (get_local $5)
                      (i32.const 3)
                     )
                    )
                    (set_local $25
                     (i32.const 255)
                    )
                    (i32.store8
                     (get_local $24)
                     (get_local $25)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.36
                    (set_local $26
                     (i32.add
                      (get_local $5)
                      (i32.const 4)
                     )
                    )
                    (set_local $28
                     (block $src/gx/gx_texture_as/expand5to8|inlined.7 (result i32)
                      (set_local $27
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $14)
                          (i32.const 65535)
                         )
                         (i32.const 11)
                        )
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.7
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $27)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $27)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $26)
                     (get_local $28)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.37
                    (set_local $29
                     (i32.add
                      (get_local $5)
                      (i32.const 5)
                     )
                    )
                    (set_local $31
                     (block $src/gx/gx_texture_as/expand6to8|inlined.2 (result i32)
                      (set_local $30
                       (i32.and
                        (i32.shr_u
                         (i32.and
                          (get_local $14)
                          (i32.const 65535)
                         )
                         (i32.const 5)
                        )
                        (i32.const 63)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand6to8|inlined.2
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $30)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 6)
                          )
                         )
                         (i32.shr_u
                          (get_local $30)
                          (i32.sub
                           (i32.const 12)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $29)
                     (get_local $31)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.38
                    (set_local $32
                     (i32.add
                      (get_local $5)
                      (i32.const 6)
                     )
                    )
                    (set_local $34
                     (block $src/gx/gx_texture_as/expand5to8|inlined.8 (result i32)
                      (set_local $33
                       (i32.and
                        (get_local $14)
                        (i32.const 31)
                       )
                      )
                      (br $src/gx/gx_texture_as/expand5to8|inlined.8
                       (i32.and
                        (i32.or
                         (i32.shl
                          (get_local $33)
                          (i32.sub
                           (i32.const 8)
                           (i32.const 5)
                          )
                         )
                         (i32.shr_u
                          (get_local $33)
                          (i32.sub
                           (i32.const 10)
                           (i32.const 8)
                          )
                         )
                        )
                        (i32.const 255)
                       )
                      )
                     )
                    )
                    (i32.store8
                     (get_local $32)
                     (get_local $34)
                    )
                   )
                   (block $src/gx/gx_texture_as/set|inlined.39
                    (set_local $35
                     (i32.add
                      (get_local $5)
                      (i32.const 7)
                     )
                    )
                    (set_local $36
                     (i32.const 255)
                    )
                    (i32.store8
                     (get_local $35)
                     (get_local $36)
                    )
                   )
                   (if
                    (i32.gt_u
                     (i32.and
                      (get_local $12)
                      (i32.const 65535)
                     )
                     (i32.and
                      (get_local $14)
                      (i32.const 65535)
                     )
                    )
                    (block
                     (block $src/gx/gx_texture_as/set|inlined.40
                      (set_local $37
                       (i32.add
                        (get_local $5)
                        (i32.const 8)
                       )
                      )
                      (set_local $43
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.0 (result i32)
                        (set_local $39
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.9 (result i32)
                           (set_local $38
                            (i32.add
                             (get_local $5)
                             (i32.const 4)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.9
                            (i32.load8_u
                             (get_local $38)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $41
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.10 (result i32)
                           (set_local $40
                            (i32.add
                             (get_local $5)
                             (i32.const 0)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.10
                            (i32.load8_u
                             (get_local $40)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $42
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $39)
                             (i32.const 1)
                            )
                            (get_local $39)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $41)
                             (i32.const 2)
                            )
                            (get_local $41)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.0
                         (i32.and
                          (get_local $42)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $37)
                       (get_local $43)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.41
                      (set_local $44
                       (i32.add
                        (get_local $5)
                        (i32.const 9)
                       )
                      )
                      (set_local $50
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.1 (result i32)
                        (set_local $46
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.11 (result i32)
                           (set_local $45
                            (i32.add
                             (get_local $5)
                             (i32.const 5)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.11
                            (i32.load8_u
                             (get_local $45)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $48
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.12 (result i32)
                           (set_local $47
                            (i32.add
                             (get_local $5)
                             (i32.const 1)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.12
                            (i32.load8_u
                             (get_local $47)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $49
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $46)
                             (i32.const 1)
                            )
                            (get_local $46)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $48)
                             (i32.const 2)
                            )
                            (get_local $48)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.1
                         (i32.and
                          (get_local $49)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $44)
                       (get_local $50)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.42
                      (set_local $51
                       (i32.add
                        (get_local $5)
                        (i32.const 10)
                       )
                      )
                      (set_local $57
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.2 (result i32)
                        (set_local $53
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.13 (result i32)
                           (set_local $52
                            (i32.add
                             (get_local $5)
                             (i32.const 6)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.13
                            (i32.load8_u
                             (get_local $52)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $55
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.14 (result i32)
                           (set_local $54
                            (i32.add
                             (get_local $5)
                             (i32.const 2)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.14
                            (i32.load8_u
                             (get_local $54)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $56
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $53)
                             (i32.const 1)
                            )
                            (get_local $53)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $55)
                             (i32.const 2)
                            )
                            (get_local $55)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.2
                         (i32.and
                          (get_local $56)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $51)
                       (get_local $57)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.43
                      (set_local $58
                       (i32.add
                        (get_local $5)
                        (i32.const 11)
                       )
                      )
                      (set_local $59
                       (i32.const 255)
                      )
                      (i32.store8
                       (get_local $58)
                       (get_local $59)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.44
                      (set_local $60
                       (i32.add
                        (get_local $5)
                        (i32.const 12)
                       )
                      )
                      (set_local $66
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.3 (result i32)
                        (set_local $62
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.15 (result i32)
                           (set_local $61
                            (i32.add
                             (get_local $5)
                             (i32.const 0)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.15
                            (i32.load8_u
                             (get_local $61)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $64
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.16 (result i32)
                           (set_local $63
                            (i32.add
                             (get_local $5)
                             (i32.const 4)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.16
                            (i32.load8_u
                             (get_local $63)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $65
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $62)
                             (i32.const 1)
                            )
                            (get_local $62)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $64)
                             (i32.const 2)
                            )
                            (get_local $64)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.3
                         (i32.and
                          (get_local $65)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $60)
                       (get_local $66)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.45
                      (set_local $67
                       (i32.add
                        (get_local $5)
                        (i32.const 13)
                       )
                      )
                      (set_local $73
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.4 (result i32)
                        (set_local $69
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.17 (result i32)
                           (set_local $68
                            (i32.add
                             (get_local $5)
                             (i32.const 1)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.17
                            (i32.load8_u
                             (get_local $68)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $71
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.18 (result i32)
                           (set_local $70
                            (i32.add
                             (get_local $5)
                             (i32.const 5)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.18
                            (i32.load8_u
                             (get_local $70)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $72
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $69)
                             (i32.const 1)
                            )
                            (get_local $69)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $71)
                             (i32.const 2)
                            )
                            (get_local $71)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.4
                         (i32.and
                          (get_local $72)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $67)
                       (get_local $73)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.46
                      (set_local $74
                       (i32.add
                        (get_local $5)
                        (i32.const 14)
                       )
                      )
                      (set_local $80
                       (block $src/gx/gx_texture_as/s3tcblend|inlined.5 (result i32)
                        (set_local $76
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.19 (result i32)
                           (set_local $75
                            (i32.add
                             (get_local $5)
                             (i32.const 2)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.19
                            (i32.load8_u
                             (get_local $75)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $78
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.20 (result i32)
                           (set_local $77
                            (i32.add
                             (get_local $5)
                             (i32.const 6)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.20
                            (i32.load8_u
                             (get_local $77)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $79
                         (i32.shr_u
                          (i32.add
                           (i32.add
                            (i32.shl
                             (get_local $76)
                             (i32.const 1)
                            )
                            (get_local $76)
                           )
                           (i32.add
                            (i32.shl
                             (get_local $78)
                             (i32.const 2)
                            )
                            (get_local $78)
                           )
                          )
                          (i32.const 3)
                         )
                        )
                        (br $src/gx/gx_texture_as/s3tcblend|inlined.5
                         (i32.and
                          (get_local $79)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $74)
                       (get_local $80)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.47
                      (set_local $81
                       (i32.add
                        (get_local $5)
                        (i32.const 15)
                       )
                      )
                      (set_local $82
                       (i32.const 255)
                      )
                      (i32.store8
                       (get_local $81)
                       (get_local $82)
                      )
                     )
                    )
                    (block
                     (block $src/gx/gx_texture_as/set|inlined.48
                      (set_local $83
                       (i32.add
                        (get_local $5)
                        (i32.const 8)
                       )
                      )
                      (set_local $89
                       (block $src/gx/gx_texture_as/halfblend|inlined.0 (result i32)
                        (set_local $85
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.21 (result i32)
                           (set_local $84
                            (i32.add
                             (get_local $5)
                             (i32.const 0)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.21
                            (i32.load8_u
                             (get_local $84)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $87
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.22 (result i32)
                           (set_local $86
                            (i32.add
                             (get_local $5)
                             (i32.const 4)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.22
                            (i32.load8_u
                             (get_local $86)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $88
                         (i32.shr_u
                          (i32.add
                           (get_local $85)
                           (get_local $87)
                          )
                          (i32.const 1)
                         )
                        )
                        (br $src/gx/gx_texture_as/halfblend|inlined.0
                         (i32.and
                          (get_local $88)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $83)
                       (get_local $89)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.49
                      (set_local $90
                       (i32.add
                        (get_local $5)
                        (i32.const 9)
                       )
                      )
                      (set_local $96
                       (block $src/gx/gx_texture_as/halfblend|inlined.1 (result i32)
                        (set_local $92
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.23 (result i32)
                           (set_local $91
                            (i32.add
                             (get_local $5)
                             (i32.const 1)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.23
                            (i32.load8_u
                             (get_local $91)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $94
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.24 (result i32)
                           (set_local $93
                            (i32.add
                             (get_local $5)
                             (i32.const 5)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.24
                            (i32.load8_u
                             (get_local $93)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $95
                         (i32.shr_u
                          (i32.add
                           (get_local $92)
                           (get_local $94)
                          )
                          (i32.const 1)
                         )
                        )
                        (br $src/gx/gx_texture_as/halfblend|inlined.1
                         (i32.and
                          (get_local $95)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $90)
                       (get_local $96)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.50
                      (set_local $97
                       (i32.add
                        (get_local $5)
                        (i32.const 10)
                       )
                      )
                      (set_local $103
                       (block $src/gx/gx_texture_as/halfblend|inlined.2 (result i32)
                        (set_local $99
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.25 (result i32)
                           (set_local $98
                            (i32.add
                             (get_local $5)
                             (i32.const 2)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.25
                            (i32.load8_u
                             (get_local $98)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $101
                         (i32.and
                          (block $src/gx/gx_texture_as/get|inlined.26 (result i32)
                           (set_local $100
                            (i32.add
                             (get_local $5)
                             (i32.const 6)
                            )
                           )
                           (br $src/gx/gx_texture_as/get|inlined.26
                            (i32.load8_u
                             (get_local $100)
                            )
                           )
                          )
                          (i32.const 255)
                         )
                        )
                        (set_local $102
                         (i32.shr_u
                          (i32.add
                           (get_local $99)
                           (get_local $101)
                          )
                          (i32.const 1)
                         )
                        )
                        (br $src/gx/gx_texture_as/halfblend|inlined.2
                         (i32.and
                          (get_local $102)
                          (i32.const 255)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $97)
                       (get_local $103)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.51
                      (set_local $104
                       (i32.add
                        (get_local $5)
                        (i32.const 11)
                       )
                      )
                      (set_local $105
                       (i32.const 255)
                      )
                      (i32.store8
                       (get_local $104)
                       (get_local $105)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.52
                      (set_local $106
                       (i32.add
                        (get_local $5)
                        (i32.const 12)
                       )
                      )
                      (set_local $108
                       (block $src/gx/gx_texture_as/get|inlined.27 (result i32)
                        (set_local $107
                         (i32.add
                          (get_local $5)
                          (i32.const 8)
                         )
                        )
                        (br $src/gx/gx_texture_as/get|inlined.27
                         (i32.load8_u
                          (get_local $107)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $106)
                       (get_local $108)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.53
                      (set_local $109
                       (i32.add
                        (get_local $5)
                        (i32.const 13)
                       )
                      )
                      (set_local $111
                       (block $src/gx/gx_texture_as/get|inlined.28 (result i32)
                        (set_local $110
                         (i32.add
                          (get_local $5)
                          (i32.const 9)
                         )
                        )
                        (br $src/gx/gx_texture_as/get|inlined.28
                         (i32.load8_u
                          (get_local $110)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $109)
                       (get_local $111)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.54
                      (set_local $112
                       (i32.add
                        (get_local $5)
                        (i32.const 14)
                       )
                      )
                      (set_local $114
                       (block $src/gx/gx_texture_as/get|inlined.29 (result i32)
                        (set_local $113
                         (i32.add
                          (get_local $5)
                          (i32.const 10)
                         )
                        )
                        (br $src/gx/gx_texture_as/get|inlined.29
                         (i32.load8_u
                          (get_local $113)
                         )
                        )
                       )
                      )
                      (i32.store8
                       (get_local $112)
                       (get_local $114)
                      )
                     )
                     (block $src/gx/gx_texture_as/set|inlined.55
                      (set_local $115
                       (i32.add
                        (get_local $5)
                        (i32.const 15)
                       )
                      )
                      (set_local $116
                       (i32.const 0)
                      )
                      (i32.store8
                       (get_local $115)
                       (get_local $116)
                      )
                     )
                    )
                   )
                   (block $break|4
                    (set_local $117
                     (i32.const 0)
                    )
                    (loop $continue|4
                     (if
                      (i32.lt_s
                       (get_local $117)
                       (i32.const 4)
                      )
                      (block
                       (block
                        (set_local $119
                         (block $src/gx/gx_texture_as/get|inlined.30 (result i32)
                          (set_local $118
                           (i32.add
                            (i32.add
                             (get_local $6)
                             (i32.const 4)
                            )
                            (get_local $117)
                           )
                          )
                          (br $src/gx/gx_texture_as/get|inlined.30
                           (i32.load8_u
                            (get_local $118)
                           )
                          )
                         )
                        )
                        (block $break|5
                         (set_local $120
                          (i32.const 0)
                         )
                         (loop $continue|5
                          (if
                           (i32.lt_s
                            (get_local $120)
                            (i32.const 4)
                           )
                           (block
                            (block
                             (set_local $121
                              (i32.add
                               (i32.add
                                (i32.add
                                 (i32.mul
                                  (i32.add
                                   (i32.add
                                    (get_local $7)
                                    (get_local $9)
                                   )
                                   (get_local $117)
                                  )
                                  (get_local $3)
                                 )
                                 (get_local $8)
                                )
                                (get_local $10)
                               )
                               (get_local $120)
                              )
                             )
                             (set_local $122
                              (i32.add
                               (get_local $1)
                               (i32.mul
                                (get_local $121)
                                (i32.const 4)
                               )
                              )
                             )
                             (set_local $123
                              (i32.and
                               (i32.shr_u
                                (i32.and
                                 (get_local $119)
                                 (i32.const 255)
                                )
                                (i32.const 6)
                               )
                               (i32.const 3)
                              )
                             )
                             (block $src/gx/gx_texture_as/set|inlined.56
                              (set_local $124
                               (i32.add
                                (get_local $122)
                                (i32.const 0)
                               )
                              )
                              (set_local $126
                               (block $src/gx/gx_texture_as/get|inlined.31 (result i32)
                                (set_local $125
                                 (i32.add
                                  (i32.add
                                   (get_local $5)
                                   (i32.and
                                    (i32.mul
                                     (get_local $123)
                                     (i32.const 4)
                                    )
                                    (i32.const 255)
                                   )
                                  )
                                  (i32.const 0)
                                 )
                                )
                                (br $src/gx/gx_texture_as/get|inlined.31
                                 (i32.load8_u
                                  (get_local $125)
                                 )
                                )
                               )
                              )
                              (i32.store8
                               (get_local $124)
                               (get_local $126)
                              )
                             )
                             (block $src/gx/gx_texture_as/set|inlined.57
                              (set_local $127
                               (i32.add
                                (get_local $122)
                                (i32.const 1)
                               )
                              )
                              (set_local $129
                               (block $src/gx/gx_texture_as/get|inlined.32 (result i32)
                                (set_local $128
                                 (i32.add
                                  (i32.add
                                   (get_local $5)
                                   (i32.and
                                    (i32.mul
                                     (get_local $123)
                                     (i32.const 4)
                                    )
                                    (i32.const 255)
                                   )
                                  )
                                  (i32.const 1)
                                 )
                                )
                                (br $src/gx/gx_texture_as/get|inlined.32
                                 (i32.load8_u
                                  (get_local $128)
                                 )
                                )
                               )
                              )
                              (i32.store8
                               (get_local $127)
                               (get_local $129)
                              )
                             )
                             (block $src/gx/gx_texture_as/set|inlined.58
                              (set_local $130
                               (i32.add
                                (get_local $122)
                                (i32.const 2)
                               )
                              )
                              (set_local $132
                               (block $src/gx/gx_texture_as/get|inlined.33 (result i32)
                                (set_local $131
                                 (i32.add
                                  (i32.add
                                   (get_local $5)
                                   (i32.and
                                    (i32.mul
                                     (get_local $123)
                                     (i32.const 4)
                                    )
                                    (i32.const 255)
                                   )
                                  )
                                  (i32.const 2)
                                 )
                                )
                                (br $src/gx/gx_texture_as/get|inlined.33
                                 (i32.load8_u
                                  (get_local $131)
                                 )
                                )
                               )
                              )
                              (i32.store8
                               (get_local $130)
                               (get_local $132)
                              )
                             )
                             (block $src/gx/gx_texture_as/set|inlined.59
                              (set_local $133
                               (i32.add
                                (get_local $122)
                                (i32.const 3)
                               )
                              )
                              (set_local $135
                               (block $src/gx/gx_texture_as/get|inlined.34 (result i32)
                                (set_local $134
                                 (i32.add
                                  (i32.add
                                   (get_local $5)
                                   (i32.and
                                    (i32.mul
                                     (get_local $123)
                                     (i32.const 4)
                                    )
                                    (i32.const 255)
                                   )
                                  )
                                  (i32.const 3)
                                 )
                                )
                                (br $src/gx/gx_texture_as/get|inlined.34
                                 (i32.load8_u
                                  (get_local $134)
                                 )
                                )
                               )
                              )
                              (i32.store8
                               (get_local $133)
                               (get_local $135)
                              )
                             )
                             (set_local $119
                              (i32.shl
                               (get_local $119)
                               (i32.const 2)
                              )
                             )
                            )
                            (set_local $120
                             (i32.add
                              (get_local $120)
                              (i32.const 1)
                             )
                            )
                            (br $continue|5)
                           )
                          )
                         )
                        )
                       )
                       (set_local $117
                        (i32.add
                         (get_local $117)
                         (i32.const 1)
                        )
                       )
                       (br $continue|4)
                      )
                     )
                    )
                   )
                   (set_local $6
                    (i32.add
                     (get_local $6)
                     (i32.const 8)
                    )
                   )
                  )
                  (set_local $10
                   (i32.add
                    (get_local $10)
                    (i32.const 4)
                   )
                  )
                  (br $continue|3)
                 )
                )
               )
              )
              (set_local $9
               (i32.add
                (get_local $9)
                (i32.const 4)
               )
              )
              (br $continue|2)
             )
            )
           )
          )
          (set_local $8
           (i32.add
            (get_local $8)
            (i32.const 8)
           )
          )
          (br $continue|1)
         )
        )
       )
      )
      (set_local $7
       (i32.add
        (get_local $7)
        (i32.const 8)
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
)
