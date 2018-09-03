(module
 (type $iiiiiv (func (param i32 i32 i32 i32 i32)))
 (memory $0 0)
 (export "memory" (memory $0))
 (export "decode_I4" (func $assembly/gx_texture_as/decode_I4))
 (export "decode_I8" (func $assembly/gx_texture_as/decode_I8))
 (export "decode_IA4" (func $assembly/gx_texture_as/decode_IA4))
 (export "decode_IA8" (func $assembly/gx_texture_as/decode_IA8))
 (export "decode_RGB565" (func $assembly/gx_texture_as/decode_RGB565))
 (export "decode_RGB5A3" (func $assembly/gx_texture_as/decode_RGB5A3))
 (export "decode_RGBA8" (func $assembly/gx_texture_as/decode_RGBA8))
 (export "decode_CMPR" (func $assembly/gx_texture_as/decode_CMPR))
 (func $assembly/gx_texture_as/decode_I4 (; 0 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (set_local $0
   (i32.const 0)
  )
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $6)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $7
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $7)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $8
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $8)
          (i32.const 8)
         )
        )
        (block $break|3
         (set_local $9
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $9)
            (i32.const 8)
           )
          )
          (i32.store8
           (tee_local $10
            (i32.add
             (get_local $1)
             (i32.shl
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
              (i32.const 2)
             )
            )
           )
           (tee_local $5
            (i32.or
             (i32.shl
              (tee_local $5
               (i32.and
                (i32.shr_u
                 (i32.load8_u
                  (i32.add
                   (get_local $2)
                   (i32.shr_u
                    (get_local $0)
                    (i32.const 1)
                   )
                  )
                 )
                 (select
                  (i32.const 0)
                  (i32.const 4)
                  (i32.and
                   (get_local $0)
                   (i32.const 1)
                  )
                 )
                )
                (i32.const 15)
               )
              )
              (i32.const 4)
             )
             (get_local $5)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $10)
            (i32.const 1)
           )
           (get_local $5)
          )
          (i32.store8
           (i32.add
            (get_local $10)
            (i32.const 2)
           )
           (get_local $5)
          )
          (i32.store8
           (i32.add
            (get_local $10)
            (i32.const 3)
           )
           (get_local $5)
          )
          (set_local $0
           (i32.add
            (get_local $0)
            (i32.const 1)
           )
          )
          (set_local $9
           (i32.add
            (get_local $9)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $8
         (i32.add
          (get_local $8)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $7
       (i32.add
        (get_local $7)
        (i32.const 8)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $6
     (i32.add
      (get_local $6)
      (i32.const 8)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_I8 (; 1 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (block $break|0
   (set_local $0
    (i32.const 0)
   )
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $0)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $5
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $5)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $6
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $6)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $7
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $7)
            (i32.const 8)
           )
          )
          (i32.store8
           (tee_local $9
            (i32.add
             (get_local $1)
             (i32.shl
              (i32.add
               (i32.add
                (i32.mul
                 (get_local $3)
                 (i32.add
                  (get_local $0)
                  (i32.and
                   (get_local $6)
                   (i32.const 255)
                  )
                 )
                )
                (get_local $5)
               )
               (i32.and
                (get_local $7)
                (i32.const 255)
               )
              )
              (i32.const 2)
             )
            )
           )
           (tee_local $10
            (i32.load8_u
             (i32.add
              (get_local $2)
              (get_local $8)
             )
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 1)
           )
           (get_local $10)
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 2)
           )
           (get_local $10)
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 3)
           )
           (get_local $10)
          )
          (set_local $8
           (i32.add
            (get_local $8)
            (i32.const 1)
           )
          )
          (set_local $7
           (i32.add
            (get_local $7)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $6
         (i32.add
          (get_local $6)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $5
       (i32.add
        (get_local $5)
        (i32.const 8)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $0
     (i32.add
      (get_local $0)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_IA4 (; 2 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (block $break|0
   (set_local $0
    (i32.const 0)
   )
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $0)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $6
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $6)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $7
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $7)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $8
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $8)
            (i32.const 8)
           )
          )
          (set_local $10
           (i32.or
            (i32.shl
             (tee_local $10
              (i32.shr_u
               (tee_local $5
                (i32.load8_u
                 (i32.add
                  (get_local $2)
                  (get_local $9)
                 )
                )
               )
               (i32.const 4)
              )
             )
             (i32.const 4)
            )
            (get_local $10)
           )
          )
          (i32.store8
           (tee_local $11
            (i32.add
             (get_local $1)
             (i32.shl
              (i32.add
               (i32.add
                (i32.mul
                 (get_local $3)
                 (i32.add
                  (get_local $0)
                  (i32.and
                   (get_local $7)
                   (i32.const 255)
                  )
                 )
                )
                (get_local $6)
               )
               (i32.and
                (get_local $8)
                (i32.const 255)
               )
              )
              (i32.const 2)
             )
            )
           )
           (tee_local $5
            (i32.or
             (i32.shl
              (tee_local $5
               (i32.and
                (get_local $5)
                (i32.const 15)
               )
              )
              (i32.const 4)
             )
             (get_local $5)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 1)
           )
           (get_local $5)
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 2)
           )
           (get_local $5)
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 3)
           )
           (get_local $10)
          )
          (set_local $9
           (i32.add
            (get_local $9)
            (i32.const 1)
           )
          )
          (set_local $8
           (i32.add
            (get_local $8)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $7
         (i32.add
          (get_local $7)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 8)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $0
     (i32.add
      (get_local $0)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_IA8 (; 3 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (set_local $0
   (i32.const 0)
  )
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $5)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $6
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $6)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $7
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $7)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $8
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $8)
            (i32.const 4)
           )
          )
          (set_local $11
           (i32.load8_u
            (i32.add
             (get_local $2)
             (get_local $0)
            )
           )
          )
          (i32.store8
           (tee_local $9
            (i32.add
             (get_local $1)
             (i32.shl
              (i32.add
               (i32.add
                (i32.mul
                 (get_local $3)
                 (i32.add
                  (get_local $5)
                  (i32.and
                   (get_local $7)
                   (i32.const 255)
                  )
                 )
                )
                (get_local $6)
               )
               (i32.and
                (get_local $8)
                (i32.const 255)
               )
              )
              (i32.const 2)
             )
            )
           )
           (tee_local $10
            (i32.load8_u
             (i32.add
              (i32.add
               (get_local $2)
               (get_local $0)
              )
              (i32.const 1)
             )
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 1)
           )
           (get_local $10)
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 2)
           )
           (get_local $10)
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 3)
           )
           (get_local $11)
          )
          (set_local $0
           (i32.add
            (get_local $0)
            (i32.const 2)
           )
          )
          (set_local $8
           (i32.add
            (get_local $8)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $7
         (i32.add
          (get_local $7)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $5
     (i32.add
      (get_local $5)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_RGB565 (; 4 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $5)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $6
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $6)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $7
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $7)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $8
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $8)
            (i32.const 4)
           )
          )
          (i32.store8
           (tee_local $11
            (i32.add
             (get_local $1)
             (i32.shl
              (i32.add
               (i32.add
                (i32.mul
                 (get_local $3)
                 (i32.add
                  (get_local $5)
                  (i32.and
                   (get_local $7)
                   (i32.const 255)
                  )
                 )
                )
                (get_local $6)
               )
               (i32.and
                (get_local $8)
                (i32.const 255)
               )
              )
              (i32.const 2)
             )
            )
           )
           (i32.or
            (i32.shl
             (tee_local $0
              (i32.shr_u
               (tee_local $9
                (i32.or
                 (i32.shl
                  (i32.load8_u
                   (tee_local $9
                    (i32.add
                     (get_local $2)
                     (get_local $10)
                    )
                   )
                  )
                  (i32.const 8)
                 )
                 (i32.load8_u
                  (i32.add
                   (get_local $9)
                   (i32.const 1)
                  )
                 )
                )
               )
               (i32.const 11)
              )
             )
             (i32.const 3)
            )
            (i32.shr_u
             (get_local $0)
             (i32.const 2)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 1)
           )
           (i32.or
            (i32.shl
             (tee_local $0
              (i32.and
               (i32.shr_u
                (i32.and
                 (get_local $9)
                 (i32.const 65535)
                )
                (i32.const 5)
               )
               (i32.const 63)
              )
             )
             (i32.const 2)
            )
            (i32.shr_u
             (get_local $0)
             (i32.const 4)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 2)
           )
           (i32.or
            (i32.shl
             (tee_local $0
              (i32.and
               (get_local $9)
               (i32.const 31)
              )
             )
             (i32.const 3)
            )
            (i32.shr_u
             (get_local $0)
             (i32.const 2)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $11)
            (i32.const 3)
           )
           (i32.const 255)
          )
          (set_local $10
           (i32.add
            (get_local $10)
            (i32.const 2)
           )
          )
          (set_local $8
           (i32.add
            (get_local $8)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $7
         (i32.add
          (get_local $7)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $6
       (i32.add
        (get_local $6)
        (i32.const 4)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $5
     (i32.add
      (get_local $5)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_RGB5A3 (; 5 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $7)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $8
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $8)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $9
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $9)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $10
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $10)
            (i32.const 4)
           )
          )
          (set_local $6
           (i32.add
            (get_local $1)
            (i32.shl
             (i32.add
              (i32.add
               (i32.mul
                (get_local $3)
                (i32.add
                 (get_local $7)
                 (i32.and
                  (get_local $9)
                  (i32.const 255)
                 )
                )
               )
               (get_local $8)
              )
              (i32.and
               (get_local $10)
               (i32.const 255)
              )
             )
             (i32.const 2)
            )
           )
          )
          (if
           (i32.and
            (tee_local $5
             (i32.or
              (i32.shl
               (i32.load8_u
                (tee_local $5
                 (i32.add
                  (get_local $2)
                  (get_local $11)
                 )
                )
               )
               (i32.const 8)
              )
              (i32.load8_u
               (i32.add
                (get_local $5)
                (i32.const 1)
               )
              )
             )
            )
            (i32.const 32768)
           )
           (block
            (i32.store8
             (get_local $6)
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 10)
                 )
                 (i32.const 31)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $0)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 1)
             )
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 5)
                 )
                 (i32.const 31)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $0)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 2)
             )
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (get_local $5)
                 (i32.const 31)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $0)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 3)
             )
             (i32.const 255)
            )
           )
           (block
            (i32.store8
             (get_local $6)
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 8)
                 )
                 (i32.const 15)
                )
               )
               (i32.const 4)
              )
              (get_local $0)
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 1)
             )
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 4)
                 )
                 (i32.const 15)
                )
               )
               (i32.const 4)
              )
              (get_local $0)
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 2)
             )
             (i32.or
              (i32.shl
               (tee_local $0
                (i32.and
                 (get_local $5)
                 (i32.const 15)
                )
               )
               (i32.const 4)
              )
              (get_local $0)
             )
            )
            (i32.store8
             (i32.add
              (get_local $6)
              (i32.const 3)
             )
             (i32.or
              (i32.or
               (i32.shl
                (tee_local $0
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 12)
                 )
                )
                (i32.const 5)
               )
               (i32.shl
                (get_local $0)
                (i32.const 2)
               )
              )
              (i32.shr_u
               (i32.and
                (get_local $0)
                (i32.const 255)
               )
               (i32.const 1)
              )
             )
            )
           )
          )
          (set_local $11
           (i32.add
            (get_local $11)
            (i32.const 2)
           )
          )
          (set_local $10
           (i32.add
            (get_local $10)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $9
         (i32.add
          (get_local $9)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $8
       (i32.add
        (get_local $8)
        (i32.const 4)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $7
     (i32.add
      (get_local $7)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_RGBA8 (; 6 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $7)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $8
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $8)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $0
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $0)
          (i32.const 4)
         )
        )
        (block $break|3
         (set_local $5
          (i32.const 0)
         )
         (loop $repeat|3
          (br_if $break|3
           (i32.ge_u
            (get_local $5)
            (i32.const 4)
           )
          )
          (i32.store8
           (i32.add
            (tee_local $9
             (i32.add
              (get_local $1)
              (i32.shl
               (i32.add
                (i32.add
                 (i32.mul
                  (get_local $3)
                  (i32.add
                   (get_local $7)
                   (get_local $0)
                  )
                 )
                 (get_local $8)
                )
                (get_local $5)
               )
               (i32.const 2)
              )
             )
            )
            (i32.const 3)
           )
           (i32.load8_u
            (i32.add
             (get_local $2)
             (get_local $6)
            )
           )
          )
          (i32.store8
           (get_local $9)
           (i32.load8_u
            (i32.add
             (i32.add
              (get_local $2)
              (get_local $6)
             )
             (i32.const 1)
            )
           )
          )
          (set_local $6
           (i32.add
            (get_local $6)
            (i32.const 2)
           )
          )
          (set_local $5
           (i32.add
            (get_local $5)
            (i32.const 1)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $0
         (i32.add
          (get_local $0)
          (i32.const 1)
         )
        )
        (br $repeat|2)
       )
      )
      (block $break|4
       (set_local $0
        (i32.const 0)
       )
       (loop $repeat|4
        (br_if $break|4
         (i32.ge_u
          (get_local $0)
          (i32.const 4)
         )
        )
        (block $break|5
         (set_local $5
          (i32.const 0)
         )
         (loop $repeat|5
          (br_if $break|5
           (i32.ge_u
            (get_local $5)
            (i32.const 4)
           )
          )
          (i32.store8
           (i32.add
            (tee_local $9
             (i32.add
              (get_local $1)
              (i32.shl
               (i32.add
                (i32.add
                 (i32.mul
                  (get_local $3)
                  (i32.add
                   (get_local $7)
                   (get_local $0)
                  )
                 )
                 (get_local $8)
                )
                (get_local $5)
               )
               (i32.const 2)
              )
             )
            )
            (i32.const 1)
           )
           (i32.load8_u
            (i32.add
             (get_local $2)
             (get_local $6)
            )
           )
          )
          (i32.store8
           (i32.add
            (get_local $9)
            (i32.const 2)
           )
           (i32.load8_u
            (i32.add
             (i32.add
              (get_local $2)
              (get_local $6)
             )
             (i32.const 1)
            )
           )
          )
          (set_local $6
           (i32.add
            (get_local $6)
            (i32.const 2)
           )
          )
          (set_local $5
           (i32.add
            (get_local $5)
            (i32.const 1)
           )
          )
          (br $repeat|5)
         )
        )
        (set_local $0
         (i32.add
          (get_local $0)
          (i32.const 1)
         )
        )
        (br $repeat|4)
       )
      )
      (set_local $8
       (i32.add
        (get_local $8)
        (i32.const 4)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $7
     (i32.add
      (get_local $7)
      (i32.const 4)
     )
    )
    (br $repeat|0)
   )
  )
 )
 (func $assembly/gx_texture_as/decode_CMPR (; 7 ;) (; has Stack IR ;) (type $iiiiiv) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (block $break|0
   (loop $repeat|0
    (br_if $break|0
     (i32.ge_u
      (get_local $9)
      (get_local $4)
     )
    )
    (block $break|1
     (set_local $10
      (i32.const 0)
     )
     (loop $repeat|1
      (br_if $break|1
       (i32.ge_u
        (get_local $10)
        (get_local $3)
       )
      )
      (block $break|2
       (set_local $11
        (i32.const 0)
       )
       (loop $repeat|2
        (br_if $break|2
         (i32.ge_u
          (get_local $11)
          (i32.const 8)
         )
        )
        (block $break|3
         (set_local $12
          (i32.const 0)
         )
         (loop $repeat|3
          (set_local $2
           (block $continue|3 (result i32)
            (br_if $break|3
             (i32.ge_u
              (get_local $12)
              (i32.const 8)
             )
            )
            (drop
             (br_if $continue|3
              (i32.add
               (get_local $2)
               (i32.const 8)
              )
              (if (result i32)
               (tee_local $5
                (i32.ge_u
                 (i32.add
                  (get_local $10)
                  (get_local $12)
                 )
                 (get_local $3)
                )
               )
               (get_local $5)
               (i32.gt_u
                (i32.add
                 (get_local $9)
                 (get_local $11)
                )
                (get_local $4)
               )
              )
             )
            )
            (set_local $8
             (i32.or
              (i32.shl
               (i32.load8_u
                (tee_local $8
                 (i32.add
                  (get_local $2)
                  (i32.const 2)
                 )
                )
               )
               (i32.const 8)
              )
              (i32.load8_u
               (i32.add
                (get_local $8)
                (i32.const 1)
               )
              )
             )
            )
            (i32.store8
             (get_local $0)
             (i32.or
              (i32.shl
               (tee_local $6
                (i32.shr_u
                 (tee_local $5
                  (i32.or
                   (i32.shl
                    (i32.load8_u
                     (get_local $2)
                    )
                    (i32.const 8)
                   )
                   (i32.load8_u
                    (i32.add
                     (get_local $2)
                     (i32.const 1)
                    )
                   )
                  )
                 )
                 (i32.const 11)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $6)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 1)
             )
             (i32.or
              (i32.shl
               (tee_local $7
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $5)
                   (i32.const 65535)
                  )
                  (i32.const 5)
                 )
                 (i32.const 63)
                )
               )
               (i32.const 2)
              )
              (i32.shr_u
               (get_local $7)
               (i32.const 4)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 2)
             )
             (i32.or
              (i32.shl
               (tee_local $6
                (i32.and
                 (get_local $5)
                 (i32.const 31)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $6)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 3)
             )
             (i32.const 255)
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 4)
             )
             (i32.or
              (i32.shl
               (tee_local $6
                (i32.shr_u
                 (i32.and
                  (get_local $8)
                  (i32.const 65535)
                 )
                 (i32.const 11)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $6)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 5)
             )
             (i32.or
              (i32.shl
               (tee_local $7
                (i32.and
                 (i32.shr_u
                  (i32.and
                   (get_local $8)
                   (i32.const 65535)
                  )
                  (i32.const 5)
                 )
                 (i32.const 63)
                )
               )
               (i32.const 2)
              )
              (i32.shr_u
               (get_local $7)
               (i32.const 4)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 6)
             )
             (i32.or
              (i32.shl
               (tee_local $6
                (i32.and
                 (get_local $8)
                 (i32.const 31)
                )
               )
               (i32.const 3)
              )
              (i32.shr_u
               (get_local $6)
               (i32.const 2)
              )
             )
            )
            (i32.store8
             (i32.add
              (get_local $0)
              (i32.const 7)
             )
             (i32.const 255)
            )
            (if
             (i32.gt_u
              (i32.and
               (get_local $5)
               (i32.const 65535)
              )
              (i32.and
               (get_local $8)
               (i32.const 65535)
              )
             )
             (block
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 8)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $6
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 4)
                     )
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $6)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (get_local $0)
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 9)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $7
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 5)
                     )
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $7)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 1)
                     )
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 10)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $7
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 6)
                     )
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $7)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 2)
                     )
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 11)
               )
               (i32.const 255)
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 12)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $7
                    (i32.load8_u
                     (get_local $0)
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $7)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 4)
                     )
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 13)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $6
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 1)
                     )
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $6)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 5)
                     )
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 14)
               )
               (i32.shr_u
                (i32.add
                 (i32.add
                  (i32.shl
                   (tee_local $7
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 2)
                     )
                    )
                   )
                   (i32.const 1)
                  )
                  (get_local $7)
                 )
                 (i32.add
                  (i32.shl
                   (tee_local $5
                    (i32.load8_u
                     (i32.add
                      (get_local $0)
                      (i32.const 6)
                     )
                    )
                   )
                   (i32.const 2)
                  )
                  (get_local $5)
                 )
                )
                (i32.const 3)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 15)
               )
               (i32.const 255)
              )
             )
             (block
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 8)
               )
               (i32.shr_u
                (i32.add
                 (i32.load8_u
                  (get_local $0)
                 )
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.const 4)
                  )
                 )
                )
                (i32.const 1)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 9)
               )
               (i32.shr_u
                (i32.add
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.const 1)
                  )
                 )
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.const 5)
                  )
                 )
                )
                (i32.const 1)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 10)
               )
               (i32.shr_u
                (i32.add
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.const 2)
                  )
                 )
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.const 6)
                  )
                 )
                )
                (i32.const 1)
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 11)
               )
               (i32.const 255)
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 12)
               )
               (i32.load8_u
                (i32.add
                 (get_local $0)
                 (i32.const 8)
                )
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 13)
               )
               (i32.load8_u
                (i32.add
                 (get_local $0)
                 (i32.const 9)
                )
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 14)
               )
               (i32.load8_u
                (i32.add
                 (get_local $0)
                 (i32.const 10)
                )
               )
              )
              (i32.store8
               (i32.add
                (get_local $0)
                (i32.const 15)
               )
               (i32.const 0)
              )
             )
            )
            (block $break|4
             (set_local $6
              (i32.const 0)
             )
             (loop $repeat|4
              (br_if $break|4
               (i32.ge_s
                (get_local $6)
                (i32.const 4)
               )
              )
              (set_local $7
               (i32.load8_u
                (i32.add
                 (i32.add
                  (get_local $2)
                  (i32.const 4)
                 )
                 (get_local $6)
                )
               )
              )
              (block $break|5
               (set_local $5
                (i32.const 0)
               )
               (loop $repeat|5
                (br_if $break|5
                 (i32.ge_s
                  (get_local $5)
                  (i32.const 4)
                 )
                )
                (i32.store8
                 (tee_local $13
                  (i32.add
                   (get_local $1)
                   (i32.shl
                    (i32.add
                     (i32.add
                      (i32.add
                       (i32.mul
                        (i32.add
                         (i32.add
                          (get_local $9)
                          (get_local $11)
                         )
                         (get_local $6)
                        )
                        (get_local $3)
                       )
                       (get_local $10)
                      )
                      (get_local $12)
                     )
                     (get_local $5)
                    )
                    (i32.const 2)
                   )
                  )
                 )
                 (i32.load8_u
                  (i32.add
                   (get_local $0)
                   (i32.shl
                    (tee_local $8
                     (i32.shr_u
                      (i32.and
                       (get_local $7)
                       (i32.const 255)
                      )
                      (i32.const 6)
                     )
                    )
                    (i32.const 2)
                   )
                  )
                 )
                )
                (i32.store8
                 (i32.add
                  (get_local $13)
                  (i32.const 1)
                 )
                 (i32.load8_u
                  (i32.add
                   (i32.add
                    (get_local $0)
                    (i32.shl
                     (get_local $8)
                     (i32.const 2)
                    )
                   )
                   (i32.const 1)
                  )
                 )
                )
                (i32.store8
                 (i32.add
                  (get_local $13)
                  (i32.const 2)
                 )
                 (i32.load8_u
                  (i32.add
                   (i32.add
                    (get_local $0)
                    (i32.shl
                     (get_local $8)
                     (i32.const 2)
                    )
                   )
                   (i32.const 2)
                  )
                 )
                )
                (i32.store8
                 (i32.add
                  (get_local $13)
                  (i32.const 3)
                 )
                 (i32.load8_u
                  (i32.add
                   (i32.add
                    (get_local $0)
                    (i32.shl
                     (get_local $8)
                     (i32.const 2)
                    )
                   )
                   (i32.const 3)
                  )
                 )
                )
                (set_local $7
                 (i32.shl
                  (get_local $7)
                  (i32.const 2)
                 )
                )
                (set_local $5
                 (i32.add
                  (get_local $5)
                  (i32.const 1)
                 )
                )
                (br $repeat|5)
               )
              )
              (set_local $6
               (i32.add
                (get_local $6)
                (i32.const 1)
               )
              )
              (br $repeat|4)
             )
            )
            (i32.add
             (get_local $2)
             (i32.const 8)
            )
           )
          )
          (set_local $12
           (i32.add
            (get_local $12)
            (i32.const 4)
           )
          )
          (br $repeat|3)
         )
        )
        (set_local $11
         (i32.add
          (get_local $11)
          (i32.const 4)
         )
        )
        (br $repeat|2)
       )
      )
      (set_local $10
       (i32.add
        (get_local $10)
        (i32.const 8)
       )
      )
      (br $repeat|1)
     )
    )
    (set_local $9
     (i32.add
      (get_local $9)
      (i32.const 8)
     )
    )
    (br $repeat|0)
   )
  )
 )
)
