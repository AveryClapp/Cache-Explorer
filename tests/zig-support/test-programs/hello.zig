const std = @import("std");

pub fn main() void {
    var arr: [100]i32 = undefined;
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        arr[i] = @as(i32, @intCast(i * 2));
    }
}
