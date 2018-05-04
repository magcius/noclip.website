;; TODO(jstpierre): Optimize. This seems to be running slower than JS.
;;
;; Roughly compiled from:
;;
;; void decompress(unsigned char*pDst, unsigned char*pSrc, int dstSize) {
;;   while(1) {
;;     int i = 8;
;;     char cmd = *src++;
;;     while(i--) {
;;       if(cmd & (i << i)) {
;;         dstsize--;
;;         *dst++ = *src++;
;;       } else {
;;         unsigned short t = (src[0] << 8) | (src[1]);
;;         src += 2;
;;         unsigned short w = (t & 0x0FFF) + 1;
;;         unsigned short n = (t >> 12) + 2;
;;         if(n == 2)
;;           n += *src++ + 0x10;
;;         dstsize -= n;
;;         while(n--) {
;;           *dst = dst[-w];
;;           dst++;
;;         }
;;       }
;;       if(dstsize <= 0)
;;         return;
;;     }
;;   }
;; }

(module
  (import "env" "mem" (memory $mem 1))
  (func $decompress (param $pDst i32) (param $pSrc i32) (param $dstSize i32)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32)
    loop $L0
      get_local $pSrc
      i32.const 1
      i32.add
      set_local $l6
      get_local $pSrc
      i32.load8_s
      set_local $l0
      i32.const 8
      set_local $l4
      block $B1
        block $B2
          loop $L3
            get_local $l4
            tee_local $pSrc
            i32.const -1
            i32.add
            set_local $l4
            get_local $pSrc
            i32.eqz
            br_if $B2
            get_local $l6
            i32.load8_u
            set_local $l3
            block $B4
              i32.const 1
              get_local $l4
              i32.shl
              get_local $l0
              i32.and
              i32.eqz
              br_if $B4
              get_local $pDst
              get_local $l3
              i32.store8
              get_local $pDst
              i32.const 1
              i32.add
              set_local $pDst
              get_local $l6
              i32.const 1
              i32.add
              set_local $l6
              get_local $dstSize
              i32.const -1
              i32.add
              tee_local $dstSize
              i32.const 0
              i32.gt_s
              br_if $L3
              br $B1
            end
            get_local $l6
            i32.load8_u offset=1
            set_local $l2
            block $B5
              block $B6
                get_local $l3
                i32.const 4
                i32.shr_u
                tee_local $pSrc
                i32.eqz
                br_if $B6
                get_local $l6
                i32.const 2
                i32.add
                set_local $l5
                get_local $pSrc
                i32.const 2
                i32.add
                set_local $pSrc
                br $B5
              end
              get_local $l6
              i32.const 3
              i32.add
              set_local $l5
              get_local $l6
              i32.const 2
              i32.add
              i32.load8_u
              i32.const 18
              i32.add
              set_local $pSrc
            end
            get_local $dstSize
            get_local $pSrc
            i32.const 65535
            i32.and
            i32.sub
            set_local $dstSize
            block $B7
              get_local $pSrc
              i32.eqz
              br_if $B7
              get_local $pDst
              i32.const -1
              i32.add
              set_local $l6
              get_local $l3
              i32.const 8
              i32.shl
              i32.const 3840
              i32.and
              get_local $l2
              i32.or
              i32.const -1
              i32.xor
              i32.const 1
              i32.add
              set_local $l2
              get_local $pSrc
              i32.const 65535
              i32.add
              i32.const 65535
              i32.and
              set_local $l1
              loop $L8
                get_local $l6
                i32.const 1
                i32.add
                tee_local $l3
                get_local $l6
                get_local $l2
                i32.add
                i32.load8_u
                i32.store8
                get_local $l3
                set_local $l6
                get_local $pSrc
                i32.const -1
                i32.add
                tee_local $pSrc
                i32.const 65535
                i32.and
                br_if $L8
              end
              get_local $pDst
              get_local $l1
              i32.add
              i32.const 1
              i32.add
              set_local $pDst
            end
            get_local $l5
            set_local $l6
            get_local $dstSize
            i32.const 0
            i32.gt_s
            br_if $L3
            br $B1
          end
        end
        get_local $l6
        set_local $pSrc
        br $L0
      end
    end)
  (export "decompress" (func $decompress))
)
