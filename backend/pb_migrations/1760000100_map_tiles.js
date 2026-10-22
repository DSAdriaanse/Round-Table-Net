/// <reference path="../pb_data/types.d.ts" />
//
// Map tiles: lets the club use a tile provider that needs an API key (MapTiler, Stadia, Thunderforest,
// Mapbox and similar) instead of the free CARTO tiles. All three fields are optional; empty means CARTO.
//
//   map_tile_url     tile address with {z}/{x}/{y} and, where the provider wants a key, a {key} placeholder
//   map_attribution  the credit line the provider asks for (plain text)
//   map_api_key      the key. Map keys are visible to anyone who opens the map in a browser (restrict them to
//                    the club's domain at the provider), so they sit with the other non-secret settings.
//                    The settings collection is readable only by the signed-in club account.
migrate((app) => {
  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.add(new TextField({ name: "map_tile_url", max: 500 }));
  settings.fields.add(new TextField({ name: "map_attribution", max: 300 }));
  settings.fields.add(new TextField({ name: "map_api_key", max: 300 }));
  app.save(settings);
}, (app) => {
  const settings = app.findCollectionByNameOrId("settings");
  for (const f of ["map_tile_url", "map_attribution", "map_api_key"]) settings.fields.removeByName(f);
  app.save(settings);
});
