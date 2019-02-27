(module
 (type $iiiii_ (func (param i32 i32 i32 i32 i32)))
 (type $_ (func))
 (memory $0 0)
 (table $0 1 funcref)
 (elem (i32.const 0) $null)
 (export "memory" (memory $0))
 (export "table" (table $0))
 (export "decode_I4" (func $gx_texture_as/decode_I4))
 (export "decode_I8" (func $gx_texture_as/decode_I8))
 (export "decode_IA4" (func $gx_texture_as/decode_IA4))
 (export "decode_IA8" (func $gx_texture_as/decode_IA8))
 (export "decode_RGB565" (func $gx_texture_as/decode_RGB565))
 (export "decode_RGB5A3" (func $gx_texture_as/decode_RGB5A3))
 (export "decode_RGBA8" (func $gx_texture_as/decode_RGBA8))
 (export "decode_CMPR" (func $gx_texture_as/decode_CMPR))
 (func $gx_texture_as/decode_I4 (; 0 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  i32.const 0
  local.set $0
  loop $repeat|0
   block $break|0
    local.get $5
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $5
    i32.mul
    local.set $9
    i32.const 0
    local.set $6
    loop $repeat|1
     block $break|1
      local.get $6
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $6
      local.get $9
      i32.add
      local.set $10
      i32.const 0
      local.set $7
      loop $repeat|2
       block $break|2
        local.get $7
        i32.const 8
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $7
        i32.mul
        local.get $10
        i32.add
        local.set $11
        i32.const 0
        local.set $8
        loop $repeat|3
         block $break|3
          local.get $8
          i32.const 8
          i32.ge_s
          br_if $break|3
          local.get $8
          local.get $11
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.get $0
          i32.const 1
          i32.shr_u
          local.get $2
          i32.add
          i32.load8_u
          i32.const 0
          i32.const 4
          local.get $0
          i32.const 1
          i32.and
          select
          i32.shr_u
          i32.const 15
          i32.and
          local.tee $12
          local.get $12
          i32.const 4
          i32.shl
          i32.or
          i32.const 16843009
          i32.mul
          i32.store
          local.get $0
          i32.const 1
          i32.add
          local.set $0
          local.get $8
          i32.const 1
          i32.add
          local.set $8
          br $repeat|3
         end
        end
        local.get $7
        i32.const 1
        i32.add
        local.set $7
        br $repeat|2
       end
      end
      local.get $6
      i32.const 8
      i32.add
      local.set $6
      br $repeat|1
     end
    end
    local.get $5
    i32.const 8
    i32.add
    local.set $5
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_I8 (; 1 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  i32.const 0
  local.set $0
  loop $repeat|0
   block $break|0
    local.get $0
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $0
    local.get $3
    i32.mul
    local.set $9
    i32.const 0
    local.set $5
    loop $repeat|1
     block $break|1
      local.get $5
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $5
      local.get $9
      i32.add
      local.set $10
      i32.const 0
      local.set $6
      loop $repeat|2
       block $break|2
        local.get $6
        i32.const 4
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $6
        i32.mul
        local.get $10
        i32.add
        local.set $11
        i32.const 0
        local.set $7
        loop $repeat|3
         block $break|3
          local.get $7
          i32.const 8
          i32.ge_s
          br_if $break|3
          local.get $7
          local.get $11
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.get $2
          local.get $8
          i32.add
          i32.load8_u
          i32.const 16843009
          i32.mul
          i32.store
          local.get $8
          i32.const 1
          i32.add
          local.set $8
          local.get $7
          i32.const 1
          i32.add
          local.set $7
          br $repeat|3
         end
        end
        local.get $6
        i32.const 1
        i32.add
        local.set $6
        br $repeat|2
       end
      end
      local.get $5
      i32.const 8
      i32.add
      local.set $5
      br $repeat|1
     end
    end
    local.get $0
    i32.const 4
    i32.add
    local.set $0
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_IA4 (; 2 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  loop $repeat|0
   block $break|0
    local.get $5
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $5
    i32.mul
    local.set $11
    i32.const 0
    local.set $6
    loop $repeat|1
     block $break|1
      local.get $6
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $6
      local.get $11
      i32.add
      local.set $12
      i32.const 0
      local.set $7
      loop $repeat|2
       block $break|2
        local.get $7
        i32.const 4
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $7
        i32.mul
        local.get $12
        i32.add
        local.set $13
        i32.const 0
        local.set $8
        loop $repeat|3
         block $break|3
          local.get $8
          i32.const 8
          i32.ge_s
          br_if $break|3
          local.get $2
          local.get $9
          i32.add
          i32.load8_u
          local.tee $10
          i32.const 4
          i32.shr_u
          local.tee $0
          local.get $0
          i32.const 4
          i32.shl
          i32.or
          local.set $0
          local.get $8
          local.get $13
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.get $10
          i32.const 15
          i32.and
          local.tee $10
          local.get $10
          i32.const 4
          i32.shl
          i32.or
          i32.const 255
          i32.and
          i32.const 65793
          i32.mul
          local.get $0
          i32.const 255
          i32.and
          i32.const 24
          i32.shl
          i32.or
          i32.store
          local.get $9
          i32.const 1
          i32.add
          local.set $9
          local.get $8
          i32.const 1
          i32.add
          local.set $8
          br $repeat|3
         end
        end
        local.get $7
        i32.const 1
        i32.add
        local.set $7
        br $repeat|2
       end
      end
      local.get $6
      i32.const 8
      i32.add
      local.set $6
      br $repeat|1
     end
    end
    local.get $5
    i32.const 4
    i32.add
    local.set $5
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_IA8 (; 3 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  i32.const 0
  local.set $0
  loop $repeat|0
   block $break|0
    local.get $5
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $5
    i32.mul
    local.set $9
    i32.const 0
    local.set $6
    loop $repeat|1
     block $break|1
      local.get $6
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $6
      local.get $9
      i32.add
      local.set $10
      i32.const 0
      local.set $7
      loop $repeat|2
       block $break|2
        local.get $7
        i32.const 4
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $7
        i32.mul
        local.get $10
        i32.add
        local.set $11
        i32.const 0
        local.set $8
        loop $repeat|3
         block $break|3
          local.get $8
          i32.const 4
          i32.ge_s
          br_if $break|3
          local.get $8
          local.get $11
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.get $0
          local.get $2
          i32.add
          i32.const 1
          i32.add
          i32.load8_u
          i32.const 65793
          i32.mul
          local.get $0
          local.get $2
          i32.add
          i32.load8_u
          i32.const 24
          i32.shl
          i32.or
          i32.store
          local.get $0
          i32.const 2
          i32.add
          local.set $0
          local.get $8
          i32.const 1
          i32.add
          local.set $8
          br $repeat|3
         end
        end
        local.get $7
        i32.const 1
        i32.add
        local.set $7
        br $repeat|2
       end
      end
      local.get $6
      i32.const 4
      i32.add
      local.set $6
      br $repeat|1
     end
    end
    local.get $5
    i32.const 4
    i32.add
    local.set $5
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_RGB565 (; 4 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
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
  loop $repeat|0
   block $break|0
    local.get $5
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $5
    i32.mul
    local.set $12
    i32.const 0
    local.set $6
    loop $repeat|1
     block $break|1
      local.get $6
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $6
      local.get $12
      i32.add
      local.set $13
      i32.const 0
      local.set $7
      loop $repeat|2
       block $break|2
        local.get $7
        i32.const 4
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $7
        i32.mul
        local.get $13
        i32.add
        local.set $14
        i32.const 0
        local.set $8
        loop $repeat|3
         block $break|3
          local.get $8
          i32.const 4
          i32.ge_s
          br_if $break|3
          local.get $8
          local.get $14
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.tee $10
          local.get $2
          local.get $9
          i32.add
          i32.load16_u
          local.tee $0
          i32.const 8
          i32.shl
          local.get $0
          i32.const 8
          i32.shr_u
          i32.or
          local.tee $11
          i32.const 65535
          i32.and
          i32.const 11
          i32.shr_u
          local.tee $0
          i32.const 3
          i32.shl
          local.get $0
          i32.const 2
          i32.shr_u
          i32.or
          i32.store8
          local.get $10
          i32.const 1
          i32.add
          local.get $11
          i32.const 65535
          i32.and
          i32.const 5
          i32.shr_u
          i32.const 63
          i32.and
          local.tee $0
          i32.const 2
          i32.shl
          local.get $0
          i32.const 4
          i32.shr_u
          i32.or
          i32.store8
          local.get $10
          i32.const 2
          i32.add
          local.get $11
          i32.const 31
          i32.and
          local.tee $0
          i32.const 3
          i32.shl
          local.get $0
          i32.const 2
          i32.shr_u
          i32.or
          i32.store8
          local.get $10
          i32.const 3
          i32.add
          i32.const 255
          i32.store8
          local.get $9
          i32.const 2
          i32.add
          local.set $9
          local.get $8
          i32.const 1
          i32.add
          local.set $8
          br $repeat|3
         end
        end
        local.get $7
        i32.const 1
        i32.add
        local.set $7
        br $repeat|2
       end
      end
      local.get $6
      i32.const 4
      i32.add
      local.set $6
      br $repeat|1
     end
    end
    local.get $5
    i32.const 4
    i32.add
    local.set $5
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_RGB5A3 (; 5 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
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
  loop $repeat|0
   block $break|0
    local.get $7
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $7
    i32.mul
    local.set $12
    i32.const 0
    local.set $8
    loop $repeat|1
     block $break|1
      local.get $8
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $8
      local.get $12
      i32.add
      local.set $13
      i32.const 0
      local.set $9
      loop $repeat|2
       block $break|2
        local.get $9
        i32.const 4
        i32.ge_s
        br_if $break|2
        local.get $3
        local.get $9
        i32.mul
        local.get $13
        i32.add
        local.set $14
        i32.const 0
        local.set $10
        loop $repeat|3
         block $break|3
          local.get $10
          i32.const 4
          i32.ge_s
          br_if $break|3
          local.get $10
          local.get $14
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.set $5
          local.get $2
          local.get $11
          i32.add
          i32.load16_u
          local.tee $0
          i32.const 8
          i32.shl
          local.get $0
          i32.const 8
          i32.shr_u
          i32.or
          local.tee $6
          i32.const 32768
          i32.and
          if
           local.get $5
           local.get $6
           i32.const 65535
           i32.and
           i32.const 10
           i32.shr_u
           i32.const 31
           i32.and
           local.tee $0
           i32.const 3
           i32.shl
           local.get $0
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 1
           i32.add
           local.get $6
           i32.const 65535
           i32.and
           i32.const 5
           i32.shr_u
           i32.const 31
           i32.and
           local.tee $0
           i32.const 3
           i32.shl
           local.get $0
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 2
           i32.add
           local.get $6
           i32.const 31
           i32.and
           local.tee $0
           i32.const 3
           i32.shl
           local.get $0
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 3
           i32.add
           i32.const 255
           i32.store8
          else           
           local.get $5
           local.get $6
           i32.const 65535
           i32.and
           i32.const 8
           i32.shr_u
           i32.const 15
           i32.and
           local.tee $0
           local.get $0
           i32.const 4
           i32.shl
           i32.or
           i32.store8
           local.get $5
           i32.const 1
           i32.add
           local.get $6
           i32.const 65535
           i32.and
           i32.const 4
           i32.shr_u
           i32.const 15
           i32.and
           local.tee $0
           local.get $0
           i32.const 4
           i32.shl
           i32.or
           i32.store8
           local.get $5
           i32.const 2
           i32.add
           local.get $6
           i32.const 15
           i32.and
           local.tee $0
           local.get $0
           i32.const 4
           i32.shl
           i32.or
           i32.store8
           local.get $5
           i32.const 3
           i32.add
           local.get $6
           i32.const 65535
           i32.and
           i32.const 12
           i32.shr_u
           local.tee $0
           i32.const 5
           i32.shl
           local.get $0
           i32.const 2
           i32.shl
           i32.or
           local.get $0
           i32.const 255
           i32.and
           i32.const 1
           i32.shr_u
           i32.or
           i32.store8
          end
          local.get $11
          i32.const 2
          i32.add
          local.set $11
          local.get $10
          i32.const 1
          i32.add
          local.set $10
          br $repeat|3
         end
        end
        local.get $9
        i32.const 1
        i32.add
        local.set $9
        br $repeat|2
       end
      end
      local.get $8
      i32.const 4
      i32.add
      local.set $8
      br $repeat|1
     end
    end
    local.get $7
    i32.const 4
    i32.add
    local.set $7
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_RGBA8 (; 6 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  loop $repeat|0
   block $break|0
    local.get $7
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $7
    i32.mul
    local.set $13
    i32.const 0
    local.set $8
    loop $repeat|1
     block $break|1
      local.get $8
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $8
      local.get $13
      i32.add
      local.set $12
      i32.const 0
      local.set $0
      loop $repeat|2
       block $break|2
        local.get $0
        i32.const 4
        i32.ge_u
        br_if $break|2
        local.get $0
        local.get $3
        i32.mul
        local.get $12
        i32.add
        local.set $9
        i32.const 0
        local.set $5
        loop $repeat|3
         block $break|3
          local.get $5
          i32.const 4
          i32.ge_u
          br_if $break|3
          local.get $5
          local.get $9
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.tee $10
          i32.const 3
          i32.add
          local.get $2
          local.get $6
          i32.add
          local.tee $11
          i32.load8_u
          i32.store8
          local.get $10
          local.get $11
          i32.const 1
          i32.add
          i32.load8_u
          i32.store8
          local.get $6
          i32.const 2
          i32.add
          local.set $6
          local.get $5
          i32.const 1
          i32.add
          local.set $5
          br $repeat|3
         end
        end
        local.get $0
        i32.const 1
        i32.add
        local.set $0
        br $repeat|2
       end
      end
      i32.const 0
      local.set $0
      loop $repeat|4
       block $break|4
        local.get $0
        i32.const 4
        i32.ge_u
        br_if $break|4
        local.get $0
        local.get $3
        i32.mul
        local.get $12
        i32.add
        local.set $9
        i32.const 0
        local.set $5
        loop $repeat|5
         block $break|5
          local.get $5
          i32.const 4
          i32.ge_u
          br_if $break|5
          local.get $5
          local.get $9
          i32.add
          i32.const 2
          i32.shl
          local.get $1
          i32.add
          local.tee $10
          i32.const 1
          i32.add
          local.get $2
          local.get $6
          i32.add
          local.tee $11
          i32.load8_u
          i32.store8
          local.get $10
          i32.const 2
          i32.add
          local.get $11
          i32.const 1
          i32.add
          i32.load8_u
          i32.store8
          local.get $6
          i32.const 2
          i32.add
          local.set $6
          local.get $5
          i32.const 1
          i32.add
          local.set $5
          br $repeat|5
         end
        end
        local.get $0
        i32.const 1
        i32.add
        local.set $0
        br $repeat|4
       end
      end
      local.get $8
      i32.const 4
      i32.add
      local.set $8
      br $repeat|1
     end
    end
    local.get $7
    i32.const 4
    i32.add
    local.set $7
    br $repeat|0
   end
  end
 )
 (func $gx_texture_as/decode_CMPR (; 7 ;) (type $iiiii_) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
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
  local.get $0
  local.set $5
  loop $repeat|0
   block $break|0
    local.get $10
    local.get $4
    i32.ge_u
    br_if $break|0
    local.get $3
    local.get $10
    i32.mul
    local.set $14
    i32.const 0
    local.set $11
    loop $repeat|1
     block $break|1
      local.get $11
      local.get $3
      i32.ge_u
      br_if $break|1
      local.get $11
      local.get $14
      i32.add
      local.set $15
      i32.const 0
      local.set $12
      loop $repeat|2
       block $break|2
        local.get $12
        i32.const 8
        i32.ge_u
        br_if $break|2
        local.get $3
        local.get $12
        i32.mul
        local.get $15
        i32.add
        local.set $16
        i32.const 0
        local.set $13
        loop $repeat|3
         block $break|3
          block $continue|3 (result i32)
           local.get $13
           i32.const 8
           i32.ge_u
           br_if $break|3
           local.get $11
           local.get $13
           i32.add
           local.get $3
           i32.ge_u
           local.tee $0
           i32.eqz
           if
            local.get $10
            local.get $12
            i32.add
            local.get $4
            i32.gt_u
            local.set $0
           end
           local.get $2
           i32.const 8
           i32.add
           local.get $0
           br_if $continue|3
           drop
           local.get $2
           local.tee $0
           i32.load16_u
           local.tee $9
           i32.const 8
           i32.shl
           local.get $9
           i32.const 8
           i32.shr_u
           i32.or
           local.set $6
           local.get $0
           i32.const 2
           i32.add
           i32.load16_u
           local.tee $7
           i32.const 8
           i32.shl
           local.get $7
           i32.const 8
           i32.shr_u
           i32.or
           local.set $9
           local.get $5
           local.get $6
           i32.const 65535
           i32.and
           i32.const 11
           i32.shr_u
           local.tee $8
           i32.const 3
           i32.shl
           local.get $8
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 1
           i32.add
           local.get $6
           i32.const 65535
           i32.and
           i32.const 5
           i32.shr_u
           i32.const 63
           i32.and
           local.tee $7
           i32.const 2
           i32.shl
           local.get $7
           i32.const 4
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 2
           i32.add
           local.get $6
           i32.const 31
           i32.and
           local.tee $8
           i32.const 3
           i32.shl
           local.get $8
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 3
           i32.add
           i32.const 255
           i32.store8
           local.get $5
           i32.const 4
           i32.add
           local.get $9
           i32.const 65535
           i32.and
           i32.const 11
           i32.shr_u
           local.tee $8
           i32.const 3
           i32.shl
           local.get $8
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 5
           i32.add
           local.get $9
           i32.const 65535
           i32.and
           i32.const 5
           i32.shr_u
           i32.const 63
           i32.and
           local.tee $7
           i32.const 2
           i32.shl
           local.get $7
           i32.const 4
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 6
           i32.add
           local.get $9
           i32.const 31
           i32.and
           local.tee $8
           i32.const 3
           i32.shl
           local.get $8
           i32.const 2
           i32.shr_u
           i32.or
           i32.store8
           local.get $5
           i32.const 7
           i32.add
           i32.const 255
           i32.store8
           local.get $6
           i32.const 65535
           i32.and
           local.get $9
           i32.const 65535
           i32.and
           i32.gt_u
           if
            local.get $5
            i32.const 8
            i32.add
            local.get $5
            i32.const 4
            i32.add
            i32.load8_u
            local.tee $8
            local.get $8
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 9
            i32.add
            local.get $5
            i32.const 5
            i32.add
            i32.load8_u
            local.tee $7
            local.get $7
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.const 1
            i32.add
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 10
            i32.add
            local.get $5
            i32.const 6
            i32.add
            i32.load8_u
            local.tee $9
            local.get $9
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.const 2
            i32.add
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 11
            i32.add
            i32.const 255
            i32.store8
            local.get $5
            i32.const 12
            i32.add
            local.get $5
            i32.load8_u
            local.tee $7
            local.get $7
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.const 4
            i32.add
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 13
            i32.add
            local.get $5
            i32.const 1
            i32.add
            i32.load8_u
            local.tee $8
            local.get $8
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.const 5
            i32.add
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 14
            i32.add
            local.get $5
            i32.const 2
            i32.add
            i32.load8_u
            local.tee $9
            local.get $9
            i32.const 1
            i32.shl
            i32.add
            local.get $5
            i32.const 6
            i32.add
            i32.load8_u
            local.tee $6
            local.get $6
            i32.const 2
            i32.shl
            i32.add
            i32.add
            i32.const 3
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 15
            i32.add
            i32.const 255
            i32.store8
           else            
            local.get $5
            i32.const 8
            i32.add
            local.get $5
            i32.load8_u
            local.get $5
            i32.const 4
            i32.add
            i32.load8_u
            i32.add
            i32.const 1
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 9
            i32.add
            local.get $5
            i32.const 1
            i32.add
            i32.load8_u
            local.get $5
            i32.const 5
            i32.add
            i32.load8_u
            i32.add
            i32.const 1
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 10
            i32.add
            local.get $5
            i32.const 6
            i32.add
            i32.load8_u
            local.get $5
            i32.const 2
            i32.add
            i32.load8_u
            i32.add
            i32.const 1
            i32.shr_u
            i32.store8
            local.get $5
            i32.const 11
            i32.add
            i32.const 255
            i32.store8
            local.get $5
            i32.const 12
            i32.add
            local.get $5
            i32.const 8
            i32.add
            i32.load8_u
            i32.store8
            local.get $5
            i32.const 13
            i32.add
            local.get $5
            i32.const 9
            i32.add
            i32.load8_u
            i32.store8
            local.get $5
            i32.const 14
            i32.add
            local.get $5
            i32.const 10
            i32.add
            i32.load8_u
            i32.store8
            local.get $5
            i32.const 15
            i32.add
            i32.const 0
            i32.store8
           end
           local.get $13
           local.get $16
           i32.add
           local.set $8
           i32.const 0
           local.set $7
           loop $repeat|4
            block $break|4
             local.get $7
             i32.const 4
             i32.ge_s
             br_if $break|4
             local.get $2
             i32.const 4
             i32.add
             local.get $7
             i32.add
             i32.load8_u
             local.set $6
             local.get $3
             local.get $7
             i32.mul
             local.get $8
             i32.add
             local.set $9
             i32.const 0
             local.set $0
             loop $repeat|5
              block $break|5
               local.get $0
               i32.const 4
               i32.ge_s
               br_if $break|5
               local.get $0
               local.get $9
               i32.add
               i32.const 2
               i32.shl
               local.get $1
               i32.add
               local.get $6
               i32.const 255
               i32.and
               i32.const 6
               i32.shr_u
               i32.const 2
               i32.shl
               local.get $5
               i32.add
               i32.load
               i32.store
               local.get $6
               i32.const 2
               i32.shl
               local.set $6
               local.get $0
               i32.const 1
               i32.add
               local.set $0
               br $repeat|5
              end
             end
             local.get $7
             i32.const 1
             i32.add
             local.set $7
             br $repeat|4
            end
           end
           local.get $2
           i32.const 8
           i32.add
          end
          local.set $2
          local.get $13
          i32.const 4
          i32.add
          local.set $13
          br $repeat|3
         end
        end
        local.get $12
        i32.const 4
        i32.add
        local.set $12
        br $repeat|2
       end
      end
      local.get $11
      i32.const 8
      i32.add
      local.set $11
      br $repeat|1
     end
    end
    local.get $10
    i32.const 8
    i32.add
    local.set $10
    br $repeat|0
   end
  end
 )
 (func $null (; 8 ;) (type $_)
  nop
 )
)
