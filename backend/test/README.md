# Backend tests

End-to-end checks of the access rules and hook routes against a real PocketBase, with fake
Anthropic and WordPress services. Nothing real is ever contacted.

```bash
# 1. fake third-party services
node backend/test/mock-services.mjs 9100 &

# 2. PocketBase with test settings (use a throwaway data dir)
export NCO_PIN=test-pin-1234 ANTHROPIC_API_KEY=a ANTHROPIC_API_URL=http://127.0.0.1:9100/anthropic \
  SLACK_BOT_TOKEN=xoxb-test SLACK_SIGNING_SECRET=test-signing-secret SLACK_API_URL=http://127.0.0.1:9100/slack \
  WORDPRESS_APP_PASSWORD=wp RATE_LIMIT_DEFAULTS=off PIN_RATE_LIMIT=10 PUBLIC_RATE_LIMIT=1000 TZ=America/Phoenix
./pocketbase superuser upsert admin@test.local testpass1234 --dir /tmp/rttest --migrationsDir backend/pb_migrations --hooksDir backend/pb_hooks
./pocketbase serve --dir /tmp/rttest --migrationsDir backend/pb_migrations --hooksDir backend/pb_hooks --http 127.0.0.1:8090 &

# 3. run
node --test backend/test/api.test.mjs
```

The last test floods the PIN route to prove rate limiting. The limit window is 60 seconds, so
wait a minute before running the suite a second time against the same server.
