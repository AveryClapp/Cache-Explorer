// Simple array traversal for cache analysis (no_std - links without Rust runtime)
// Uses volatile operations to prevent optimization
#![no_std]
#![no_main]

use core::panic::PanicInfo;
use core::ptr;

const SIZE: usize = 1024;
static mut ARRAY: [i32; SIZE] = [0; SIZE];

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

// Sequential access - good cache behavior
// Uses volatile to prevent optimization
#[inline(never)]
unsafe fn sequential_walk() -> i32 {
    let mut sum = 0i32;
    let base = ARRAY.as_mut_ptr();
    let mut i = 0usize;
    while i < SIZE {
        // Volatile write
        ptr::write_volatile(base.add(i), i as i32);
        // Volatile read
        sum = sum.wrapping_add(ptr::read_volatile(base.add(i)));
        i += 1;
    }
    sum
}

// Strided access - poor cache behavior (stride = 16 = 64 bytes = cache line)
#[inline(never)]
unsafe fn strided_walk() -> i32 {
    let mut sum = 0i32;
    let base = ARRAY.as_mut_ptr();
    let stride = 16usize; // Jump 64 bytes (16 * 4 bytes per i32)
    let mut i = 0usize;
    while i < SIZE {
        ptr::write_volatile(base.add(i), i as i32);
        sum = sum.wrapping_add(ptr::read_volatile(base.add(i)));
        i += stride;
    }
    sum
}

#[no_mangle]
pub extern "C" fn main() -> i32 {
    unsafe {
        let s1 = sequential_walk();
        let s2 = strided_walk();
        // Use the result to prevent dead code elimination
        s1.wrapping_add(s2)
    }
}
