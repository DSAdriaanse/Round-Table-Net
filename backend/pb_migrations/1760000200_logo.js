/// <reference path="../pb_data/types.d.ts" />
//
// Group logo: one optional image shown at the top of the sidebar, uploaded in Settings.
// PNG (transparent works), JPEG or WebP, up to 1 MB. SVG is left out on purpose: an SVG can carry
// script. The server cannot read image dimensions, so the 512 x 512 pixel limit is checked in the
// browser (web/src/lib/logo.ts); the type and size limits here are enforced by the server.
// The file is not "protected", so its address works in an <img> tag without a sign-in token;
// the name is random and the logo is only shown inside the signed-in app.
migrate((app) => {
  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.add(new FileField({
    name: "logo",
    maxSelect: 1,
    maxSize: 1048576,
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
    protected: false,
  }));
  app.save(settings);
}, (app) => {
  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.removeByName("logo");
  app.save(settings);
});
