import test from "node:test";
import assert from "node:assert/strict";
import { logoProblem, MAX_LOGO_BYTES, MAX_LOGO_PX } from "./logo.ts";

const png = (size = 50_000) => ({ type: "image/png", size });

test("a PNG within the limits is accepted, including exactly the maximum", () => {
  assert.equal(logoProblem(png(), 200, 80), "");
  assert.equal(logoProblem(png(MAX_LOGO_BYTES), MAX_LOGO_PX, MAX_LOGO_PX), "");
});

test("small logos are accepted (they are scaled up in the sidebar)", () => {
  assert.equal(logoProblem(png(), 32, 32), "");
});

test("too many pixels in either direction is rejected with the actual size", () => {
  assert.match(logoProblem(png(), 513, 100), /513 x 100 pixels/);
  assert.match(logoProblem(png(), 100, 2000), /100 x 2000 pixels/);
});

test("too large a file is rejected", () => {
  assert.match(logoProblem(png(MAX_LOGO_BYTES + 1), 100, 100), /MB/);
});

test("only PNG, JPEG and WebP are accepted; SVG and GIF are not", () => {
  for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) assert.match(logoProblem({ type, size: 100 }, 100, 100), /PNG, JPG or WebP/);
  for (const type of ["image/jpeg", "image/webp"]) assert.equal(logoProblem({ type, size: 100 }, 100, 100), "");
});

test("an image with no readable size is rejected", () => {
  assert.match(logoProblem(png(), 0, 0), /could not be read/);
});
