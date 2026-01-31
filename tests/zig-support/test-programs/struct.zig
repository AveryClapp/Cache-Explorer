const std = @import("std");

const Point = struct {
    x: i32,
    y: i32,
};

pub fn main() void {
    var points: [50]Point = undefined;
    var i: usize = 0;
    while (i < 50) : (i += 1) {
        points[i].x = @as(i32, @intCast(i));
        points[i].y = @as(i32, @intCast(i * 2));
    }
}
