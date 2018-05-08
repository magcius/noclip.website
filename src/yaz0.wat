(module
  (type $t0 (func))
  (type $t1 (func (param i32 i32 i32)))
  (func $_start (export "_start") (type $t0))
  (func $decompress (export "decompress") (type $t1) (param $p0 i32) (param $p1 i32) (param $p2 i32)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32)
    loop $L0
      get_local $p1
      i32.load8_u
      set_local $l0
      i32.const 8
      set_local $l1
      get_local $p1
      i32.const 1
      i32.add
      set_local $p1
      block $B1
        block $B2
          loop $L3
            get_local $l1
            i32.eqz
            br_if $B2
            block $B4
              block $B5
                i32.const 1
                get_local $l1
                i32.const -1
                i32.add
                tee_local $l1
                i32.shl
                get_local $l0
                i32.and
                i32.eqz
                br_if $B5
                get_local $p0
                get_local $p1
                i32.load8_u
                i32.store8
                get_local $p0
                i32.const 1
                i32.add
                set_local $p0
                get_local $p1
                i32.const 1
                i32.add
                set_local $p1
                i32.const 0
                set_local $l2
                get_local $p2
                i32.const -1
                i32.add
                tee_local $p2
                i32.const 0
                i32.gt_s
                br_if $L3
                br $B4
              end
              get_local $p1
              i32.load8_u
              tee_local $l2
              i32.const 8
              i32.shl
              i32.const 3840
              i32.and
              get_local $p1
              i32.const 1
              i32.add
              i32.load8_u
              i32.or
              i32.const 1
              i32.add
              set_local $l3
              block $B6
                block $B7
                  get_local $l2
                  i32.const 4
                  i32.shr_u
                  tee_local $l2
                  i32.eqz
                  br_if $B7
                  get_local $p1
                  i32.const 2
                  i32.add
                  set_local $l4
                  get_local $l2
                  i32.const 2
                  i32.add
                  set_local $l2
                  br $B6
                end
                get_local $p1
                i32.const 3
                i32.add
                set_local $l4
                get_local $p1
                i32.const 2
                i32.add
                i32.load8_u
                i32.const 18
                i32.add
                set_local $l2
              end
              get_local $p0
              i32.const -1
              i32.add
              set_local $p1
              get_local $l2
              i32.const 65535
              i32.and
              set_local $l5
              i32.const 1
              get_local $l3
              i32.const 65535
              i32.and
              i32.sub
              set_local $l6
              get_local $l2
              i32.const -1
              i32.add
              i32.const 65535
              i32.and
              set_local $l7
              loop $L8
                get_local $p1
                i32.const 1
                i32.add
                tee_local $l3
                get_local $p1
                get_local $l6
                i32.add
                i32.load8_u
                i32.store8
                get_local $l3
                set_local $p1
                get_local $l2
                i32.const -1
                i32.add
                tee_local $l2
                i32.const 65535
                i32.and
                br_if $L8
              end
              get_local $p0
              get_local $l7
              i32.add
              i32.const 1
              i32.add
              set_local $p0
              get_local $l4
              set_local $p1
              i32.const 0
              set_local $l2
              get_local $p2
              get_local $l5
              i32.sub
              tee_local $p2
              i32.const 0
              i32.gt_s
              br_if $L3
            end
          end
          get_local $l2
          br_if $L0
          br $B1
        end
        i32.const 1
        br_if $L0
      end
    end)
  (func $__wasm_call_ctors (type $t0))
  (table $T0 1 1 anyfunc)
  (memory $memory (export "memory") 2)
  (global $g0 (mut i32) (i32.const 66560))
  (global $__heap_base (export "__heap_base") i32 (i32.const 66560))
  (global $__data_end (export "__data_end") i32 (i32.const 1024)))
