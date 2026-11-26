import { createLucideIcon } from "lucide-react";

// Extend Lucide's 24px, currentColor outline system for fruit it does not include.
export const Watermelon = createLucideIcon("watermelon", [
  ["path", { d: "M2 6h20c0 7-4.5 12-10 12S2 13 2 6Z", key: "rind" }],
  ["path", { d: "M5 6c0 5 3 9 7 9s7-4 7-9M8 9v1m4-1v2m4-2v1", key: "flesh" }]
]);
export const Pear = createLucideIcon("pear", [
  ["path", { d: "M12 5c-3 0-3 4-5 6-2 2-3 3-3 5a8 6 0 0 0 16 0c0-2-1-3-3-5-2-2-2-6-5-6Zm0 0V3l2-1", key: "body" }]
]);
export const Strawberry = createLucideIcon("strawberry", [
  ["path", { d: "m12 5-3-3v4L5 5l2 4m5-4 3-3v4l4-1-2 4M7 8c-3 0-4 2-3 5s5 9 8 9 7-6 8-9-1-5-3-5", key: "body" }],
  ["path", { d: "M8 12h.01M12 11h.01M16 12h.01M10 16h.01M14 16h.01M12 19h.01", key: "seeds" }]
]);
export const Peach = createLucideIcon("peach", [
  ["path", { d: "M12 7c-5-4-10 0-10 5 0 6 7 10 10 10s10-4 10-10c0-5-5-9-10-5Zm0 0c3 4 3 9 0 13M12 7V4m0 0c0-3 5-3 6-2-1 3-3 4-6 2", key: "body" }]
]);
export const Pineapple = createLucideIcon("pineapple", [
  ["path", { d: "m9 8-3-5 5 2 1-4 2 4 4-2-3 5M12 8a6 7 0 0 0 0 14 6 7 0 0 0 0-14Z", key: "body" }],
  ["path", { d: "m8 11 9 7m-9-3 6 5m2-9-9 7m9-3-6 5", key: "skin" }]
]);
export const Kiwi = createLucideIcon("kiwi", [
  ["ellipse", { cx: "12", cy: "12", rx: "9", ry: "10", key: "body" }],
  ["ellipse", { cx: "12", cy: "12", rx: "2", ry: "4", key: "core" }],
  ["path", { d: "M12 5v1m0 12v1M6 12h1m10 0h1M7 7l1 1m8 8 1 1M7 17l1-1m8-8 1-1", key: "seeds" }]
]);
export const Mango = createLucideIcon("mango", [
  ["path", { d: "M15 4c-7-3-14 4-12 11 1 5 9 8 14 4 5-4 6-12 1-14l-3-1Zm0 0 3-2M8 16c-2-3 0-7 3-8", key: "body" }]
]);
export const Melon = createLucideIcon("melon", [
  ["circle", { cx: "12", cy: "13", r: "9", key: "body" }],
  ["path", { d: "M12 4V2m0 2c-5 3-5 15 0 18m0-18c5 3 5 15 0 18M3 13h18", key: "ridges" }]
]);
export const Blueberries = createLucideIcon("blueberries", [
  ["circle", { cx: "8", cy: "15", r: "6", key: "left" }],
  ["path", { d: "M12 10a6 6 0 1 1 2 10m-8-6 2 1 2-1m5-3 2 1 2-1M10 9c0-5 5-7 8-6-1 4-4 6-8 6Z", key: "right" }]
]);
export const Coconut = createLucideIcon("coconut", [
  ["path", { d: "M3 9v3a9 9 0 0 0 18 0V9M3 9c0 3 18 3 18 0S3 6 3 9Z", key: "shell" }],
  ["path", { d: "M7 13v3m5-2v4m5-5v3", key: "fibres" }]
]);
export const Avocado = createLucideIcon("avocado", [
  ["path", { d: "M12 2c-4 0-3 5-6 8-5 5-3 12 6 12s11-7 6-12c-3-3-2-8-6-8Z", key: "body" }],
  ["circle", { cx: "12", cy: "15", r: "4", key: "seed" }]
]);
