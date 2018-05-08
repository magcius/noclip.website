(module
  (type (;0;) (func (param i32 i32 i32)))
  (type (;1;) (func (param i32) (result i32)))
  (type (;2;) (func (param i32 i32)))
  (func $get (type 1) (param i32) (result i32)
    block  ;; label = @1
      get_local 0
      i32.load8_u
      return
      unreachable
    end
    unreachable)
  (func $set (type 2) (param i32 i32)
    block  ;; label = @1
      get_local 0
      get_local 1
      i32.store8
    end)
  (func $get16be (type 1) (param i32) (result i32)
    block  ;; label = @1
      get_local 0
      i32.load8_u
      i32.const 8
      i32.shl
      i32.const 255
      i32.and
      get_local 0
      i32.const 1
      i32.add
      i32.load8_u
      i32.or
      i32.const 255
      i32.and
      return
      unreachable
    end
    unreachable)
  (func $decompress (type 0) (param i32 i32 i32)
    (local i32 i32 i32 i32 i32 i32 i32 i32)
    block  ;; label = @1
      get_local 1
      set_local 3
      get_local 0
      set_local 4
      block  ;; label = @2
        loop  ;; label = @3
          i32.const 1
          if  ;; label = @4
            block  ;; label = @5
              get_local 3
              i32.const 1
              i32.add
              tee_local 3
              i32.const 1
              i32.sub
              call $get
              set_local 5
              i32.const 8
              set_local 6
              block  ;; label = @6
                loop  ;; label = @7
                  get_local 6
                  i32.const 1
                  i32.sub
                  i32.const 255
                  i32.and
                  tee_local 6
                  i32.const 1
                  i32.add
                  if  ;; label = @8
                    block  ;; label = @9
                      get_local 5
                      i32.const 1
                      get_local 6
                      i32.shl
                      i32.const 255
                      i32.and
                      i32.and
                      i32.const 255
                      i32.and
                      if  ;; label = @10
                        get_local 2
                        i32.const 1
                        i32.sub
                        set_local 2
                        get_local 4
                        i32.const 1
                        i32.add
                        tee_local 4
                        i32.const 1
                        i32.sub
                        get_local 3
                        i32.const 1
                        i32.add
                        tee_local 3
                        i32.const 1
                        i32.sub
                        call $get
                        call $set
                      else
                        get_local 3
                        call $get16be
                        set_local 7
                        get_local 3
                        i32.const 2
                        i32.add
                        set_local 3
                        get_local 7
                        i32.const 4095
                        i32.and
                        i32.const 65535
                        i32.and
                        i32.const 1
                        i32.add
                        i32.const 65535
                        i32.and
                        set_local 8
                        get_local 7
                        i32.const 12
                        i32.shr_u
                        i32.const 65535
                        i32.and
                        i32.const 2
                        i32.add
                        i32.const 65535
                        i32.and
                        set_local 9
                        get_local 9
                        i32.const 2
                        i32.eq
                        if  ;; label = @11
                          get_local 9
                          get_local 3
                          i32.const 1
                          i32.add
                          tee_local 3
                          i32.const 1
                          i32.sub
                          call $get
                          i32.const 16
                          i32.add
                          i32.const 255
                          i32.and
                          i32.add
                          set_local 9
                        end
                        get_local 4
                        get_local 8
                        i32.sub
                        set_local 10
                        get_local 2
                        get_local 9
                        i32.sub
                        set_local 2
                        block  ;; label = @11
                          loop  ;; label = @12
                            get_local 9
                            i32.const 1
                            i32.sub
                            tee_local 9
                            i32.const 1
                            i32.add
                            if  ;; label = @13
                              get_local 4
                              i32.const 1
                              i32.add
                              tee_local 4
                              i32.const 1
                              i32.sub
                              get_local 10
                              i32.const 1
                              i32.add
                              tee_local 10
                              i32.const 1
                              i32.sub
                              call $get
                              call $set
                              br 1 (;@12;)
                            end
                          end
                        end
                      end
                      get_local 2
                      i32.const 0
                      i32.le_u
                      if  ;; label = @10
                        return
                      end
                    end
                    br 1 (;@7;)
                  end
                end
              end
            end
            br 1 (;@3;)
          end
        end
      end
    end)
  (memory (;0;) 1)
  (export "decompress" (func $decompress))
  (export "memory" (memory 0)))
