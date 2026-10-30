/// <reference path="../pb_data/types.d.ts" />
//
// Per-net absence limit. max_absences is how many sessions in a row a roster station can miss
// before it is made inactive (backend/pb_hooks/lib/roster.js). 3 is the default; 0 switches the
// rule off for that net (nobody is dropped, and absences are not counted).
// Nets that already exist keep today's behaviour, so they are set to 3 here.
migrate((app) => {
  const nets = app.findCollectionByNameOrId("nets");
  nets.fields.add(new NumberField({ name: "max_absences", min: 0, max: 52, onlyInt: true }));
  app.save(nets);

  const all = app.findAllRecords("nets");
  for (let i = 0; i < all.length; i++) {
    all[i].set("max_absences", 3);
    app.save(all[i]);
  }
}, (app) => {
  const nets = app.findCollectionByNameOrId("nets");
  nets.fields.removeByName("max_absences");
  app.save(nets);
});
