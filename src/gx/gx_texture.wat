(module
  (type $t0 (func))
  (type $t1 (func (param i32 i32 i32 i32)))
  (func $_start (export "_start") (type $t0))
  (func $decode_CMPR (export "decode_CMPR") (type $t1) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32) (local $l8 i32) (local $l9 i32) (local $l10 i32) (local $l11 i32) (local $l12 i32) (local $l13 i32) (local $l14 i32) (local $l15 i32) (local $l16 i32) (local $l17 i32) (local $l18 i32) (local $l19 i32) (local $l20 i32)
    get_global $g0
    i32.const 16
    i32.sub
    set_local $l0
    block $B0
      get_local $p3
      i32.eqz
      br_if $B0
      get_local $p2
      i32.const 2
      i32.shl
      set_local $l1
      get_local $p2
      i32.const 4
      i32.shl
      set_local $l2
      get_local $p2
      i32.const 5
      i32.shl
      set_local $l3
      i32.const 0
      set_local $l4
      loop $L1
        block $B2
          get_local $p2
          i32.eqz
          br_if $B2
          i32.const 0
          set_local $l5
          get_local $p0
          set_local $l6
          loop $L3
            get_local $l6
            set_local $l7
            get_local $p1
            set_local $l8
            i32.const 0
            set_local $l9
            loop $L4
              i32.const 0
              set_local $l10
              get_local $l7
              set_local $l11
              get_local $l8
              set_local $l12
              loop $L5
                get_local $l12
                i32.const 3
                i32.add
                i32.load8_u
                set_local $l13
                get_local $l12
                i32.const 1
                i32.add
                i32.load8_u
                set_local $l14
                get_local $l12
                i32.load8_u offset=2
                set_local $l15
                get_local $l12
                i32.load8_u
                set_local $l16
                get_local $l0
                i32.const 255
                i32.store8 offset=3
                get_local $l0
                i32.const 255
                i32.store8 offset=7
                get_local $l0
                get_local $l16
                i32.const 248
                i32.and
                get_local $l16
                i32.const 5
                i32.shr_u
                i32.or
                tee_local $l17
                i32.store8
                get_local $l0
                get_local $l15
                i32.const 248
                i32.and
                get_local $l15
                i32.const 5
                i32.shr_u
                i32.or
                tee_local $l18
                i32.store8 offset=4
                get_local $l0
                get_local $l14
                i32.const 2
                i32.shr_u
                i32.const 7
                i32.and
                get_local $l14
                i32.const 3
                i32.shl
                i32.or
                tee_local $l19
                i32.store8 offset=2
                get_local $l0
                get_local $l13
                i32.const 2
                i32.shr_u
                i32.const 7
                i32.and
                get_local $l13
                i32.const 3
                i32.shl
                i32.or
                tee_local $l20
                i32.store8 offset=6
                get_local $l0
                get_local $l16
                i32.const 1
                i32.shr_u
                i32.const 3
                i32.and
                get_local $l14
                get_local $l16
                i32.const 8
                i32.shl
                i32.or
                tee_local $l14
                i32.const 3
                i32.shr_u
                i32.const 252
                i32.and
                i32.or
                tee_local $l16
                i32.store8 offset=1
                get_local $l0
                get_local $l15
                i32.const 1
                i32.shr_u
                i32.const 3
                i32.and
                get_local $l13
                get_local $l15
                i32.const 8
                i32.shl
                i32.or
                tee_local $l13
                i32.const 3
                i32.shr_u
                i32.const 252
                i32.and
                i32.or
                tee_local $l15
                i32.store8 offset=5
                block $B6
                  block $B7
                    get_local $l14
                    get_local $l13
                    i32.le_u
                    br_if $B7
                    i32.const 255
                    set_local $l13
                    get_local $l0
                    i32.const 255
                    i32.store8 offset=11
                    get_local $l0
                    get_local $l15
                    i32.const 3
                    i32.mul
                    get_local $l16
                    i32.const 5
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    i32.store8 offset=9
                    get_local $l0
                    get_local $l18
                    i32.const 3
                    i32.mul
                    get_local $l17
                    i32.const 5
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    i32.store8 offset=8
                    get_local $l0
                    get_local $l18
                    i32.const 5
                    i32.mul
                    get_local $l17
                    i32.const 3
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    i32.store8 offset=12
                    get_local $l0
                    get_local $l15
                    i32.const 5
                    i32.mul
                    get_local $l16
                    i32.const 3
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    i32.store8 offset=13
                    get_local $l0
                    get_local $l20
                    i32.const 255
                    i32.and
                    tee_local $l15
                    i32.const 3
                    i32.mul
                    get_local $l19
                    i32.const 255
                    i32.and
                    tee_local $l16
                    i32.const 5
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    i32.store8 offset=10
                    get_local $l15
                    i32.const 5
                    i32.mul
                    get_local $l16
                    i32.const 3
                    i32.mul
                    i32.add
                    i32.const 3
                    i32.shr_u
                    set_local $l15
                    br $B6
                  end
                  get_local $l0
                  get_local $l15
                  get_local $l16
                  i32.add
                  i32.const 1
                  i32.shr_u
                  tee_local $l15
                  i32.store8 offset=9
                  get_local $l0
                  get_local $l18
                  get_local $l17
                  i32.add
                  i32.const 1
                  i32.shr_u
                  tee_local $l16
                  i32.store8 offset=8
                  get_local $l0
                  get_local $l16
                  i32.store8 offset=12
                  get_local $l0
                  get_local $l15
                  i32.store8 offset=13
                  get_local $l0
                  i32.const 255
                  i32.store8 offset=11
                  get_local $l0
                  get_local $l20
                  i32.const 255
                  i32.and
                  get_local $l19
                  i32.const 255
                  i32.and
                  i32.add
                  i32.const 1
                  i32.shr_u
                  tee_local $l15
                  i32.store8 offset=10
                  i32.const 0
                  set_local $l13
                end
                get_local $l0
                get_local $l13
                i32.store8 offset=15
                get_local $l0
                get_local $l15
                i32.store8 offset=14
                i32.const 0
                set_local $l14
                get_local $l11
                set_local $l15
                loop $L8
                  get_local $l15
                  get_local $l0
                  get_local $l12
                  get_local $l14
                  i32.add
                  i32.const 4
                  i32.add
                  i32.load8_u
                  tee_local $l16
                  i32.const 4
                  i32.shr_u
                  i32.const 12
                  i32.and
                  i32.or
                  tee_local $l13
                  i32.load8_u
                  i32.store8
                  get_local $l15
                  i32.const 1
                  i32.add
                  get_local $l13
                  i32.load8_u offset=1
                  i32.store8
                  get_local $l15
                  i32.const 2
                  i32.add
                  get_local $l13
                  i32.load8_u offset=2
                  i32.store8
                  get_local $l15
                  i32.const 3
                  i32.add
                  get_local $l13
                  i32.load8_u offset=3
                  i32.store8
                  get_local $l15
                  i32.const 4
                  i32.add
                  get_local $l0
                  get_local $l16
                  i32.const 2
                  i32.shr_u
                  i32.const 12
                  i32.and
                  i32.or
                  tee_local $l13
                  i32.load8_u
                  i32.store8
                  get_local $l15
                  i32.const 5
                  i32.add
                  get_local $l13
                  i32.load8_u offset=1
                  i32.store8
                  get_local $l15
                  i32.const 6
                  i32.add
                  get_local $l13
                  i32.load8_u offset=2
                  i32.store8
                  get_local $l15
                  i32.const 7
                  i32.add
                  get_local $l13
                  i32.load8_u offset=3
                  i32.store8
                  get_local $l15
                  i32.const 8
                  i32.add
                  get_local $l0
                  get_local $l16
                  i32.const 12
                  i32.and
                  i32.or
                  tee_local $l13
                  i32.load8_u
                  i32.store8
                  get_local $l15
                  i32.const 9
                  i32.add
                  get_local $l13
                  i32.load8_u offset=1
                  i32.store8
                  get_local $l15
                  i32.const 10
                  i32.add
                  get_local $l13
                  i32.load8_u offset=2
                  i32.store8
                  get_local $l15
                  i32.const 11
                  i32.add
                  get_local $l13
                  i32.load8_u offset=3
                  i32.store8
                  get_local $l15
                  i32.const 12
                  i32.add
                  get_local $l0
                  get_local $l16
                  i32.const 2
                  i32.shl
                  i32.const 12
                  i32.and
                  i32.or
                  tee_local $l16
                  i32.load8_u
                  i32.store8
                  get_local $l15
                  i32.const 13
                  i32.add
                  get_local $l16
                  i32.load8_u offset=1
                  i32.store8
                  get_local $l15
                  i32.const 14
                  i32.add
                  get_local $l16
                  i32.load8_u offset=2
                  i32.store8
                  get_local $l15
                  i32.const 15
                  i32.add
                  get_local $l16
                  i32.load8_u offset=3
                  i32.store8
                  get_local $l15
                  get_local $l1
                  i32.add
                  set_local $l15
                  get_local $l14
                  i32.const 1
                  i32.add
                  tee_local $l14
                  i32.const 4
                  i32.ne
                  br_if $L8
                end
                get_local $l11
                i32.const 16
                i32.add
                set_local $l11
                get_local $l12
                i32.const 8
                i32.add
                set_local $l12
                get_local $l10
                i32.const 4
                i32.add
                tee_local $l10
                i32.const 8
                i32.lt_u
                br_if $L5
              end
              get_local $l7
              get_local $l2
              i32.add
              set_local $l7
              get_local $l8
              i32.const 16
              i32.add
              set_local $l8
              get_local $l9
              i32.const 4
              i32.add
              tee_local $l9
              i32.const 8
              i32.lt_u
              br_if $L4
            end
            get_local $l6
            i32.const 32
            i32.add
            set_local $l6
            get_local $p1
            i32.const 32
            i32.add
            set_local $p1
            get_local $l5
            i32.const 8
            i32.add
            tee_local $l5
            get_local $p2
            i32.lt_u
            br_if $L3
          end
        end
        get_local $p0
        get_local $l3
        i32.add
        set_local $p0
        get_local $l4
        i32.const 8
        i32.add
        tee_local $l4
        get_local $p3
        i32.lt_u
        br_if $L1
      end
    end)
  (func $decode_I8 (export "decode_I8") (type $t1) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32) (local $l8 i32)
    block $B0
      get_local $p3
      i32.eqz
      br_if $B0
      block $B1
        get_local $p2
        i32.eqz
        br_if $B1
        get_local $p2
        i32.const 2
        i32.shl
        set_local $l0
        get_local $p2
        i32.const 4
        i32.shl
        set_local $l1
        i32.const 0
        set_local $l2
        loop $L2
          get_local $p0
          set_local $l3
          i32.const 0
          set_local $l4
          loop $L3
            i32.const 0
            set_local $l5
            get_local $l3
            set_local $l6
            loop $L4
              get_local $l6
              i32.const 1
              i32.add
              get_local $p1
              get_local $l5
              i32.add
              tee_local $l7
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 2
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 3
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 5
              i32.add
              get_local $l7
              i32.const 1
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 4
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 6
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 7
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 9
              i32.add
              get_local $l7
              i32.const 2
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 8
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 10
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 11
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 13
              i32.add
              get_local $l7
              i32.const 3
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 12
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 14
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 15
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 17
              i32.add
              get_local $l7
              i32.const 4
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 16
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 18
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 19
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 21
              i32.add
              get_local $l7
              i32.const 5
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 20
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 22
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 23
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 25
              i32.add
              get_local $l7
              i32.const 6
              i32.add
              i32.load8_u
              tee_local $l8
              i32.store8
              get_local $l6
              i32.const 24
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 26
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 27
              i32.add
              get_local $l8
              i32.store8
              get_local $l6
              i32.const 29
              i32.add
              get_local $l7
              i32.const 7
              i32.add
              i32.load8_u
              tee_local $l7
              i32.store8
              get_local $l6
              i32.const 28
              i32.add
              get_local $l7
              i32.store8
              get_local $l6
              i32.const 30
              i32.add
              get_local $l7
              i32.store8
              get_local $l6
              i32.const 31
              i32.add
              get_local $l7
              i32.store8
              get_local $l6
              get_local $l0
              i32.add
              set_local $l6
              get_local $l5
              i32.const 8
              i32.add
              tee_local $l5
              i32.const 32
              i32.ne
              br_if $L4
            end
            get_local $l3
            i32.const 32
            i32.add
            set_local $l3
            get_local $p1
            i32.const 32
            i32.add
            set_local $p1
            get_local $l4
            i32.const 8
            i32.add
            tee_local $l4
            get_local $p2
            i32.lt_u
            br_if $L3
          end
          get_local $p0
          get_local $l1
          i32.add
          set_local $p0
          get_local $l2
          i32.const 4
          i32.add
          tee_local $l2
          get_local $p3
          i32.lt_u
          br_if $L2
          br $B0
        end
      end
      i32.const 0
      set_local $l6
      loop $L5
        get_local $l6
        i32.const 4
        i32.add
        tee_local $l6
        get_local $p3
        i32.lt_u
        br_if $L5
      end
    end)
  (func $decode_I4 (export "decode_I4") (type $t1) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32) (local $l8 i32) (local $l9 i32)
    block $B0
      get_local $p3
      i32.eqz
      br_if $B0
      block $B1
        get_local $p2
        i32.eqz
        br_if $B1
        get_local $p2
        i32.const 2
        i32.shl
        set_local $l0
        get_local $p2
        i32.const 5
        i32.shl
        set_local $l1
        i32.const 0
        set_local $l2
        loop $L2
          get_local $p0
          set_local $l3
          i32.const 0
          set_local $l4
          loop $L3
            get_local $p1
            set_local $l5
            i32.const 0
            set_local $l6
            get_local $l3
            set_local $p1
            loop $L4
              get_local $p1
              i32.const 1
              i32.add
              get_local $l5
              get_local $l6
              i32.add
              tee_local $l7
              i32.load8_u
              tee_local $l8
              i32.const 4
              i32.shl
              get_local $l8
              i32.const 15
              i32.and
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 2
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 3
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 5
              i32.add
              get_local $l7
              i32.load8_u
              tee_local $l8
              i32.const 240
              i32.and
              get_local $l8
              i32.const 4
              i32.shr_u
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              i32.const 4
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 6
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 7
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 9
              i32.add
              get_local $l7
              i32.const 1
              i32.add
              tee_local $l9
              i32.load8_u
              tee_local $l8
              i32.const 4
              i32.shl
              get_local $l8
              i32.const 15
              i32.and
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              i32.const 8
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 10
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 11
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 13
              i32.add
              get_local $l9
              i32.load8_u
              tee_local $l8
              i32.const 240
              i32.and
              get_local $l8
              i32.const 4
              i32.shr_u
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              i32.const 12
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 14
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 15
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 17
              i32.add
              get_local $l7
              i32.const 2
              i32.add
              tee_local $l9
              i32.load8_u
              tee_local $l8
              i32.const 4
              i32.shl
              get_local $l8
              i32.const 15
              i32.and
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              i32.const 16
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 18
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 19
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 21
              i32.add
              get_local $l9
              i32.load8_u
              tee_local $l8
              i32.const 240
              i32.and
              get_local $l8
              i32.const 4
              i32.shr_u
              i32.or
              tee_local $l8
              i32.store8
              get_local $p1
              i32.const 20
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 22
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 23
              i32.add
              get_local $l8
              i32.store8
              get_local $p1
              i32.const 25
              i32.add
              get_local $l7
              i32.const 3
              i32.add
              tee_local $l8
              i32.load8_u
              tee_local $l7
              i32.const 4
              i32.shl
              get_local $l7
              i32.const 15
              i32.and
              i32.or
              tee_local $l7
              i32.store8
              get_local $p1
              i32.const 24
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              i32.const 26
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              i32.const 27
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              i32.const 29
              i32.add
              get_local $l8
              i32.load8_u
              tee_local $l7
              i32.const 240
              i32.and
              get_local $l7
              i32.const 4
              i32.shr_u
              i32.or
              tee_local $l7
              i32.store8
              get_local $p1
              i32.const 28
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              i32.const 30
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              i32.const 31
              i32.add
              get_local $l7
              i32.store8
              get_local $p1
              get_local $l0
              i32.add
              set_local $p1
              get_local $l6
              i32.const 4
              i32.add
              tee_local $l6
              i32.const 32
              i32.ne
              br_if $L4
            end
            get_local $l3
            i32.const 32
            i32.add
            set_local $l3
            get_local $l5
            get_local $l6
            i32.add
            set_local $p1
            get_local $l4
            i32.const 8
            i32.add
            tee_local $l4
            get_local $p2
            i32.lt_u
            br_if $L3
          end
          get_local $p0
          get_local $l1
          i32.add
          set_local $p0
          get_local $l5
          get_local $l6
          i32.add
          set_local $p1
          get_local $l2
          i32.const 8
          i32.add
          tee_local $l2
          get_local $p3
          i32.lt_u
          br_if $L2
          br $B0
        end
      end
      i32.const 0
      set_local $p1
      loop $L5
        get_local $p1
        i32.const 8
        i32.add
        tee_local $p1
        get_local $p3
        i32.lt_u
        br_if $L5
      end
    end)
  (func $__wasm_call_ctors (type $t0))
  (table $T0 1 1 anyfunc)
  (memory $memory (export "memory") 2)
  (global $g0 (mut i32) (i32.const 66560))
  (global $__heap_base (export "__heap_base") i32 (i32.const 66560))
  (global $__data_end (export "__data_end") i32 (i32.const 1024)))
