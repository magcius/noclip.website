(module
 (type $iiiv (func (param i32 i32 i32)))
 (type $i (func (result i32)))
 (global $HEAP_BASE i32 (i32.const 4))
 (memory $0 1)
 (export "decompress" (func $src/yaz0_as/decompress))
 (export "memory" (memory $0))
 (func $src/yaz0_as/decompress (; 0 ;) (type $iiiv) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  (local $4 i32)
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
  (set_local $3
   (get_local $0)
  )
  (set_local $4
   (get_local $1)
  )
  (block $break|0
   (loop $continue|0
    (if
     (i32.const 1)
     (block
      (block
       (set_local $6
        (block $src/yaz0_as/get|inlined.0 (result i32)
         (set_local $5
          (block (result i32)
           (set_local $5
            (get_local $4)
           )
           (set_local $4
            (i32.add
             (get_local $5)
             (i32.const 1)
            )
           )
           (get_local $5)
          )
         )
         (br $src/yaz0_as/get|inlined.0
          (i32.load8_u
           (get_local $5)
          )
         )
        )
       )
       (set_local $7
        (i32.const 8)
       )
       (block $break|1
        (loop $continue|1
         (if
          (i32.and
           (block (result i32)
            (set_local $8
             (get_local $7)
            )
            (set_local $7
             (i32.sub
              (get_local $8)
              (i32.const 1)
             )
            )
            (get_local $8)
           )
           (i32.const 255)
          )
          (block
           (block
            (if
             (i32.and
              (i32.and
               (get_local $6)
               (i32.shl
                (i32.const 1)
                (get_local $7)
               )
              )
              (i32.const 255)
             )
             (block
              (set_local $2
               (i32.sub
                (get_local $2)
                (i32.const 1)
               )
              )
              (block $src/yaz0_as/set|inlined.0
               (set_local $8
                (block (result i32)
                 (set_local $8
                  (get_local $3)
                 )
                 (set_local $3
                  (i32.add
                   (get_local $8)
                   (i32.const 1)
                  )
                 )
                 (get_local $8)
                )
               )
               (set_local $10
                (block $src/yaz0_as/get|inlined.1 (result i32)
                 (set_local $9
                  (block (result i32)
                   (set_local $9
                    (get_local $4)
                   )
                   (set_local $4
                    (i32.add
                     (get_local $9)
                     (i32.const 1)
                    )
                   )
                   (get_local $9)
                  )
                 )
                 (br $src/yaz0_as/get|inlined.1
                  (i32.load8_u
                   (get_local $9)
                  )
                 )
                )
               )
               (i32.store8
                (get_local $8)
                (get_local $10)
               )
              )
             )
             (block
              (set_local $11
               (block $src/yaz0_as/get16be|inlined.0 (result i32)
                (br $src/yaz0_as/get16be|inlined.0
                 (i32.and
                  (i32.or
                   (i32.shl
                    (i32.load8_u
                     (get_local $4)
                    )
                    (i32.const 8)
                   )
                   (i32.load8_u
                    (i32.add
                     (get_local $4)
                     (i32.const 1)
                    )
                   )
                  )
                  (i32.const 65535)
                 )
                )
               )
              )
              (set_local $4
               (i32.add
                (get_local $4)
                (i32.const 2)
               )
              )
              (set_local $12
               (i32.add
                (i32.and
                 (get_local $11)
                 (i32.const 4095)
                )
                (i32.const 1)
               )
              )
              (set_local $13
               (i32.and
                (i32.add
                 (i32.shr_u
                  (i32.and
                   (get_local $11)
                   (i32.const 65535)
                  )
                  (i32.const 12)
                 )
                 (i32.const 2)
                )
                (i32.const 255)
               )
              )
              (if
               (i32.eq
                (get_local $13)
                (i32.const 2)
               )
               (block
                (set_local $15
                 (i32.and
                  (block $src/yaz0_as/get|inlined.2 (result i32)
                   (set_local $14
                    (block (result i32)
                     (set_local $14
                      (get_local $4)
                     )
                     (set_local $4
                      (i32.add
                       (get_local $14)
                       (i32.const 1)
                      )
                     )
                     (get_local $14)
                    )
                   )
                   (br $src/yaz0_as/get|inlined.2
                    (i32.load8_u
                     (get_local $14)
                    )
                   )
                  )
                  (i32.const 255)
                 )
                )
                (set_local $13
                 (i32.add
                  (get_local $13)
                  (i32.add
                   (get_local $15)
                   (i32.const 16)
                  )
                 )
                )
               )
              )
              (set_local $16
               (i32.sub
                (get_local $3)
                (i32.and
                 (get_local $12)
                 (i32.const 65535)
                )
               )
              )
              (set_local $2
               (i32.sub
                (get_local $2)
                (get_local $13)
               )
              )
              (block $break|2
               (loop $continue|2
                (if
                 (i32.and
                  (block (result i32)
                   (set_local $17
                    (get_local $13)
                   )
                   (set_local $13
                    (i32.sub
                     (get_local $17)
                     (i32.const 1)
                    )
                   )
                   (get_local $17)
                  )
                  (i32.const 65535)
                 )
                 (block
                  (block $src/yaz0_as/set|inlined.1
                   (set_local $17
                    (block (result i32)
                     (set_local $17
                      (get_local $3)
                     )
                     (set_local $3
                      (i32.add
                       (get_local $17)
                       (i32.const 1)
                      )
                     )
                     (get_local $17)
                    )
                   )
                   (set_local $19
                    (block $src/yaz0_as/get|inlined.3 (result i32)
                     (set_local $18
                      (block (result i32)
                       (set_local $18
                        (get_local $16)
                       )
                       (set_local $16
                        (i32.add
                         (get_local $18)
                         (i32.const 1)
                        )
                       )
                       (get_local $18)
                      )
                     )
                     (br $src/yaz0_as/get|inlined.3
                      (i32.load8_u
                       (get_local $18)
                      )
                     )
                    )
                   )
                   (i32.store8
                    (get_local $17)
                    (get_local $19)
                   )
                  )
                  (br $continue|2)
                 )
                )
               )
              )
             )
            )
            (if
             (i32.le_s
              (get_local $2)
              (i32.const 0)
             )
             (return)
            )
           )
           (br $continue|1)
          )
         )
        )
       )
      )
      (br $continue|0)
     )
    )
   )
  )
 )
)
