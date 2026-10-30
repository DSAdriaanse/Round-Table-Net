/// <reference path="../pb_data/types.d.ts" />
//
// Team chat through Slack, set per net.
//
//   nets.slack_enabled   chat is on for this net (off by default, so nothing changes until someone turns it on)
//   nets.slack_channel   the Slack channel ID, such as C0123ABCD (not the name)
//   net_sessions.slack_thread_ts, slack_channel
//                        the Slack thread that belongs to one session. Replies in that thread
//                        come back to the session; the net itself does not need its own channel.
//   chat_messages        what was said in a session's thread, both directions. Signed-in operators can
//                        read it (the chat panel watches it live); only the server writes to it.
//                        Deleting a session deletes its chat messages.
migrate((app) => {
  const NCO = `@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true`;

  const nets = app.findCollectionByNameOrId("nets");
  nets.fields.add(new BoolField({ name: "slack_enabled" }));
  nets.fields.add(new TextField({ name: "slack_channel", max: 40 }));
  app.save(nets);

  const sessions = app.findCollectionByNameOrId("net_sessions");
  sessions.fields.add(new TextField({ name: "slack_thread_ts", max: 40 }));
  sessions.fields.add(new TextField({ name: "slack_channel", max: 40 }));
  app.save(sessions);
  // Inbound Slack replies find their session by thread.
  sessions.indexes = (sessions.indexes || []).concat(["CREATE INDEX idx_sessions_slack_thread ON net_sessions (slack_thread_ts)"]);
  app.save(sessions);

  const chat = new Collection({
    type: "base",
    name: "chat_messages",
    listRule: NCO,
    viewRule: NCO,
    createRule: null, // server only (backend/pb_hooks/slack.pb.js)
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "relation", name: "session_id", required: true, collectionId: sessions.id, maxSelect: 1, cascadeDelete: true },
      { type: "relation", name: "net_id", collectionId: nets.id, maxSelect: 1, cascadeDelete: true },
      { type: "select", name: "source", required: true, maxSelect: 1, values: ["nco", "slack"] },
      { type: "text", name: "author", max: 100 },
      { type: "text", name: "text", required: true, max: 4000 },
      { type: "text", name: "slack_ts", max: 40 }, // Slack's id for the message; stops a retried delivery being stored twice
      { type: "autodate", name: "created_date", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX idx_chat_session ON chat_messages (session_id, created_date)",
      "CREATE UNIQUE INDEX idx_chat_session_ts ON chat_messages (session_id, slack_ts) WHERE slack_ts != ''",
    ],
  });
  app.save(chat);
}, (app) => {
  const chat = app.findCollectionByNameOrId("chat_messages");
  app.delete(chat);

  const sessions = app.findCollectionByNameOrId("net_sessions");
  sessions.indexes = (sessions.indexes || []).filter((i) => i.indexOf("idx_sessions_slack_thread") < 0);
  app.save(sessions);
  sessions.fields.removeByName("slack_thread_ts");
  sessions.fields.removeByName("slack_channel");
  app.save(sessions);

  const nets = app.findCollectionByNameOrId("nets");
  nets.fields.removeByName("slack_enabled");
  nets.fields.removeByName("slack_channel");
  app.save(nets);
});
