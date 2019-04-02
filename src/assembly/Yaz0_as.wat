(module
 (type $FUNCSIG$viii (func (param i32 i32 i32)))
 (type $FUNCSIG$v (func))
 (memory $0 0)
 (table $0 1 funcref)
 (elem (i32.const 0) $null)
 (export "memory" (memory $0))
 (export "table" (table $0))
 (export "decompress" (func $Yaz0_as/decompress))
 (func $Yaz0_as/decompress (; 0 ;) (type $FUNCSIG$viii) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  loop $continue|0
   local.get $1
   local.tee $3
   i32.const 1
   i32.add
   local.set $1
   local.get $3
   i32.load8_u
   local.set $7
   i32.const 8
   local.set $6
   loop $continue|1
    local.get $6
    local.tee $3
    i32.const 1
    i32.sub
    local.set $6
    local.get $3
    if
     local.get $7
     i32.const 1
     local.get $6
     i32.shl
     i32.and
     if
      local.get $2
      i32.const 1
      i32.sub
      local.set $2
      local.get $0
      local.tee $3
      i32.const 1
      i32.add
      local.set $0
      local.get $1
      local.tee $4
      i32.const 1
      i32.add
      local.set $1
      local.get $3
      local.get $4
      i32.load8_u
      i32.store8
     else      
      local.get $1
      i32.load16_u
      local.tee $3
      i32.const 8
      i32.shl
      local.get $3
      i32.const 8
      i32.shr_u
      i32.or
      local.set $3
      local.get $1
      i32.const 2
      i32.add
      local.set $1
      local.get $3
      i32.const 4095
      i32.and
      i32.const 1
      i32.add
      local.set $4
      local.get $3
      i32.const 65535
      i32.and
      i32.const 12
      i32.shr_u
      i32.const 2
      i32.add
      i32.const 255
      i32.and
      local.tee $5
      i32.const 2
      i32.eq
      if
       local.get $1
       local.tee $3
       i32.const 1
       i32.add
       local.set $1
       local.get $3
       i32.load8_u
       i32.const 16
       i32.add
       local.get $5
       i32.add
       local.set $5
      end
      local.get $0
      local.get $4
      i32.const 65535
      i32.and
      i32.sub
      local.set $3
      local.get $2
      local.get $5
      i32.sub
      local.set $2
      loop $continue|2
       local.get $5
       local.tee $4
       i32.const 1
       i32.sub
       local.set $5
       local.get $4
       i32.const 65535
       i32.and
       if
        local.get $0
        local.tee $4
        i32.const 1
        i32.add
        local.set $0
        local.get $3
        local.tee $8
        i32.const 1
        i32.add
        local.set $3
        local.get $4
        local.get $8
        i32.load8_u
        i32.store8
        br $continue|2
       end
      end
     end
     local.get $2
     i32.const 0
     i32.le_s
     if
      return
     end
     br $continue|1
    end
   end
   br $continue|0
   unreachable
  end
  unreachable
 )
 (func $null (; 1 ;) (type $FUNCSIG$v)
  nop
 )
)
