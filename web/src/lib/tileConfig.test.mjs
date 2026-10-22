import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TILES, tileLayerFor } from "./tileConfig.ts";

const MT = "https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key={key}";

test("nothing set: free CARTO tiles", () => {
  for (const s of [null, undefined, {}, { map_tile_url: "  ", map_api_key: "abc" }]) {
    const t = tileLayerFor(s);
    assert.equal(t.url, DEFAULT_TILES.url);
    assert.equal(t.custom, false);
    assert.equal(t.problem, "");
  }
});

test("the key replaces {key}, leaving Leaflet's {z}/{x}/{y}/{s}/{r} alone", () => {
  const t = tileLayerFor({ map_tile_url: "https://{s}.example.org/{z}/{x}/{y}{r}.png?k={key}", map_api_key: " a b&c " });
  assert.equal(t.url, "https://{s}.example.org/{z}/{x}/{y}{r}.png?k=a%20b%26c");
  assert.equal(t.custom, true);
});

test("a {key} address without a key is rejected and says why", () => {
  const t = tileLayerFor({ map_tile_url: MT, map_api_key: "" });
  assert.equal(t.url, DEFAULT_TILES.url);
  assert.match(t.problem, /no API key/);
});

test("an address that is not https, or lacks {z}{x}{y}, is rejected", () => {
  assert.match(tileLayerFor({ map_tile_url: "http://t.example.org/{z}/{x}/{y}.png" }).problem, /https/);
  assert.match(tileLayerFor({ map_tile_url: "https://t.example.org/tiles.png" }).problem, /\{z\}/);
  assert.match(tileLayerFor({ map_tile_url: "javascript:alert(1)" }).problem, /https/);
});

test("an address that needs no key works without one", () => {
  const t = tileLayerFor({ map_tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" });
  assert.equal(t.custom, true);
  assert.equal(t.url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
});

test("the credit line is escaped; empty falls back to the host name", () => {
  assert.equal(tileLayerFor({ map_tile_url: MT, map_api_key: "k", map_attribution: '<img src=x onerror=alert(1)>' }).attribution, "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(tileLayerFor({ map_tile_url: MT, map_api_key: "k" }).attribution, "Map tiles: api.maptiler.com");
});
