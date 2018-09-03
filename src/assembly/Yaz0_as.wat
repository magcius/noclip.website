(module
 (type $iiiv (func (param i32 i32 i32)))
 (memory $0 0)
 (export "memory" (memory $0))
 (export "decompress" (func $assembly/Yaz0_as/decompress))
 (func $assembly/Yaz0_as/decompress (; 0 ;) (; has Stack IR ;) (type $iiiv) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (loop $continue|0
   (set_local $1
    (i32.add
     (tee_local $6
      (get_local $1)
     )
     (i32.const 1)
    )
   )
   (set_local $6
    (i32.load8_u
     (get_local $6)
    )
   )
   (set_local $7
    (i32.const 8)
   )
   (loop $continue|1
    (if
     (block (result i32)
      (set_local $7
       (i32.sub
        (tee_local $3
         (get_local $7)
        )
        (i32.const 1)
       )
      )
      (i32.and
       (get_local $3)
       (i32.const 255)
      )
     )
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
        (set_local $0
         (i32.add
          (tee_local $3
           (get_local $0)
          )
          (i32.const 1)
         )
        )
        (set_local $1
         (i32.add
          (tee_local $4
           (get_local $1)
          )
          (i32.const 1)
         )
        )
        (i32.store8
         (get_local $3)
         (i32.load8_u
          (get_local $4)
         )
        )
       )
       (block
        (set_local $4
         (i32.or
          (i32.shl
           (i32.load8_u
            (get_local $1)
           )
           (i32.const 8)
          )
          (i32.load8_u
           (i32.add
            (get_local $1)
            (i32.const 1)
           )
          )
         )
        )
        (set_local $1
         (i32.add
          (get_local $1)
          (i32.const 2)
         )
        )
        (set_local $3
         (i32.add
          (i32.and
           (get_local $4)
           (i32.const 4095)
          )
          (i32.const 1)
         )
        )
        (if
         (i32.eq
          (tee_local $5
           (i32.and
            (i32.add
             (i32.shr_u
              (i32.and
               (get_local $4)
               (i32.const 65535)
              )
              (i32.const 12)
             )
             (i32.const 2)
            )
            (i32.const 255)
           )
          )
          (i32.const 2)
         )
         (block
          (set_local $1
           (i32.add
            (tee_local $4
             (get_local $1)
            )
            (i32.const 1)
           )
          )
          (set_local $5
           (i32.add
            (get_local $5)
            (i32.add
             (i32.load8_u
              (get_local $4)
             )
             (i32.const 16)
            )
           )
          )
         )
        )
        (set_local $4
         (i32.sub
          (get_local $0)
          (i32.and
           (get_local $3)
           (i32.const 65535)
          )
         )
        )
        (set_local $2
         (i32.sub
          (get_local $2)
          (get_local $5)
         )
        )
        (loop $continue|2
         (if
          (block (result i32)
           (set_local $5
            (i32.sub
             (tee_local $3
              (get_local $5)
             )
             (i32.const 1)
            )
           )
           (i32.and
            (get_local $3)
            (i32.const 65535)
           )
          )
          (block
           (set_local $0
            (i32.add
             (tee_local $3
              (get_local $0)
             )
             (i32.const 1)
            )
           )
           (i32.store8
            (get_local $3)
            (block (result i32)
             (set_local $4
              (i32.add
               (tee_local $3
                (get_local $4)
               )
               (i32.const 1)
              )
             )
             (i32.load8_u
              (get_local $3)
             )
            )
           )
           (br $continue|2)
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
      (br $continue|1)
     )
    )
   )
   (br $continue|0)
  )
 )
)
