const std = @import("std");

pub fn main() void {
    var matrix: [10][10]i32 = undefined;
    var i: usize = 0;
    while (i < 10) : (i += 1) {
        var j: usize = 0;
        while (j < 10) : (j += 1) {
            matrix[i][j] = @as(i32, @intCast(i * j));
        }
    }
}
