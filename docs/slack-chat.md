# Team chat with Slack

The net control screen can talk to a Slack channel while a net is running. Each session gets **its own thread**
in the channel; the operator's messages are posted there as "CALLSIGN (NCO)" and anyone replying in the thread is
shown to the operator. Each net chooses whether to use it and which channel (Manage Nets), so one channel can serve
several nets.

The Slack app is made once for the whole server. These steps are done by someone who can add apps to the Slack workspace.

## 1. Create the Slack app

1. Go to <https://api.slack.com/apps>, choose **Create New App**, then **From a manifest**, pick the workspace.
2. Paste this manifest, replacing `YOUR-DOMAIN` with the address the club's server answers on (it must be `https`
   and reachable from the internet, because Slack calls it):

```yaml
display_information:
  name: Round Table Net
features:
  bot_user:
    display_name: Round Table Net
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - channels:history
      - groups:history
      - users:read
settings:
  event_subscriptions:
    request_url: https://YOUR-DOMAIN/api/rt/slack/events
    bot_events:
      - message.channels
      - message.groups
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

3. **Install App** to the workspace. Copy the **Bot User OAuth Token** (starts `xoxb-`).
4. Under **Basic Information**, copy the **Signing Secret**.

The request URL is checked when Slack saves it, so do step 2 of the next section first if it shows a red "Your URL didn't respond" note, then press **Retry**.

## 2. Give the server the two secrets

In `/etc/round-table-net/env` (see `.env.example`):

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

then `systemctl restart round-table-net`. The secrets are never stored in the database or shown in the app.

## 3. Turn it on for a net

1. In Slack, add the app to the channel: open the channel and type `/invite @Round Table Net`.
2. Find the channel ID: right-click the channel, **View channel details**; the ID is at the bottom (`C0123ABCD`).
3. In Round Table Net, **Manage Nets**, edit the net, switch **Team chat with Slack** on, paste the ID and press **Send test message**.
   If the test arrives in Slack, save.

## The chat bubble

While a net with team chat on has a session open, a green **Chat with us** bubble sits in the bottom-right corner of every screen.
It shows a red badge with the number of new replies from Slack, and opens a panel with the session's thread:
Slack people on the left with their Slack name, the operator's own messages on the right with the NCO callsign.
The bell in the panel mutes it: no badge and no pulse (messages are still collected). Mute is remembered in that browser.
The bubble is hidden when printing and goes away when the session closes.

## What it does and does not do

- Chat is only available while a session is open. Opening a session posts the thread's first message; closing posts "Net closed".
- Only people's replies **in the thread** reach the screen. Other channel chatter, bots and top-level messages are ignored.
- Typed `@channel` and `@here` are escaped, so the operator cannot ping the channel by accident.
- All operators share one sign-in, so the NCO callsign on the session is the only name shown for the operator side.
- Not handled yet: edited or deleted Slack messages, files and images, and Slack user mentions are shown as `@name` only.
- If Slack is down, nets still open, close and check people in; the chat message fails with a plain-words reason.

## Troubleshooting

| Message | Meaning |
|---|---|
| "The Slack app is not in that channel" | `/invite` the app to the channel. |
| "Slack cannot find that channel" | Wrong ID, or a private channel the app has not been invited to. |
| "The Slack bot token is not valid" | Check `SLACK_BOT_TOKEN`, then restart the service. |
| Replies in Slack never appear | The request URL is wrong or unreachable, or the signing secret differs. Slack's **Event Subscriptions** page shows whether it verified. |
