# How Duvet handles bots

Notes from the Duvet API, the gateway and the live server,
as the bot uses them. This is the contract `libduvet` and chisato are built on.

## Identity and auth

- A bot is a real user with `is_bot = true`, no email and no password.
- Its token is 96 hex characters. Keep it secret: it is the bot's only credential.
- REST: `Authorization: Bot <token>`. No session token, no cookie, no refresh.
  A `401` is final; a `500` is a database failure and can be retried.
- Gateway: `wss://ws.duvet.chat/gateway?token=<bot token>`; the same token in
  the `identify` frame.
- `GET /api/applications/@me` is the bot-only route: it returns the application
  (`id`, `team_id`, `name`, `public`, `bot_user_id`). A bot needs it because a
  token alone doesn't name its team, and command routes live under a team.
- `GET /api/users/@me` works too: the bot's own profile.

## Lifecycle (done by a person, for context)

1. Create a team, then an application:
   `POST /api/users/@me/teams/:teamId/applications`.
2. Give it a bot: `POST .../applications/:appId/bot` → `{ "token": "…" }`.
3. `PATCH .../bot` (multipart: `username`, `alias`, `avatar`, `banner`,
   `remove_avatar`, `remove_banner`) edits the bot's profile.
4. `POST .../bot/reset-token` replaces the token **and disconnects live
   sockets**.
5. `DELETE .../bot` removes the bot user and its memberships.
6. Add it to a space: `POST /api/spaces/:spaceId/bots/:botUserId`, which needs
   **Manage Bots**. The app must be `public`, or the caller must be on its
   team. The bot gets the space's `@everyone` role, a `SPACE_CREATE` is
   requested, and its presence is per space.
   Remove with `DELETE /api/spaces/:spaceId/bots/:botUserId`.
7. Invite links are client-side: `https://duvet.chat/invite?bot=<bot user id>`.

## Gateway

- Connect to `ws.duvet.chat/gateway?token=…` (the HTTP upgrade is authenticated
  with the token in the query).
- `identify`: `{"type":"identify","data":{"token":"…"}}`.
  Bots may add `shard_id` and `num_shards` (both required together, 0 ≤ id <
  count, count ≤ 64). A person who sends them is closed with `4000`.
- Spaces are sharded by `fnv32a(spaceID) % num_shards`; a connection gets the
  events of the spaces its shard holds.
- Bot `READY` is reduced:

  ```json
  {
    "user": { "id": "…", "username": "…", "is_bot": true, … },
    "sessionToken": "…",
    "guild_ids": ["…"],
    "shard": [0, 1]
  }
  ```

  No read states, no calls, no ICE servers. Then one `SPACE_CREATE` per space
  the shard holds: `space`, `rooms`, `roles_permissions`, `member_roles`,
  `overwrites`, `member_statuses`, `member_client_status`.
- Envelope: `{"op":1,"event":"payload","d":{"type":"…","data":{…}},"s":<seq>}`.
- Heartbeat: `{"type":"heartbeat","data":{}}` every 45 s; the gateway answers
  `heartbeat_ack`; 15 s without one drops the socket.
- Resume: identify with `last_seq` and the `sessionToken` from `READY`. The
  gateway replays the missed events; no new `READY` comes.
- Close reasons: `4000` bad shard options, `4003` not identified,
  `4004` invalid credentials, `4005` already identified,
  `4006` superseded by a newer socket.
- Bots receive normal space events (`MESSAGE_CREATE`, reactions, typing, …) for
  the rooms they can see, and `INTERACTION_CREATE` on the shard that holds the
  interaction's space.
- Bots **cannot** join voice or calls: `VOICE_*`, `CALL_*`, `WEBRTC_*` and
  `ACTIVITY_UPDATE` from a bot are ignored. Bots **cannot** use conversations:
  those routes are `RequireHuman`.

## Interactions

### Types

| `type` | What |
|---|---|
| `2` | an application command |
| `3` | a button or select on one of the bot's messages |
| `5` | a modal submit |

### Delivery

- **Push**: `INTERACTION_CREATE` on the gateway, only on the shard that holds
  the interaction's space.
- **Poll**: `GET /api/applications/:appId/interactions/next` waits up to 20 s
  (3 s with `?wait=short`), answers `204` when none comes, and is limited to
  600 requests a minute. A bot may only poll its own application; a team admin
  may poll it too.
- A bot uses one or the other, not both: each way gets every interaction.

### Payload

`id`, `application_id`, `type`, `data`, `space_id`, `space`, `room_id`, `room`,
`member` (with `user` and the member's room `permissions`), `token`, `version`,
`message` (for a component's interaction), `app_permissions`, and `context`
(0 space, 1 private chat, 2 private room).

`data` by type:

- command: `id`, `name`, `type` (1), `options` (`{name, type, value}`), and
  `resolved` (the users/members/roles/rooms the values name).
- component: `custom_id`, `component_type`, the component `id`, `values` (for a
  select), and `resolved`.
- modal submit: `custom_id`, `components` (labels with the input they hold and
  what was entered; text inputs have `value`, selects `values`), and `resolved`.

### First response

`POST /api/interactions/:interactionId/:interactionToken/callback` — the
interaction token is the authentication, no bot header is needed.

| `type` | What it sends |
|---|---|
| `4` | a message in the interaction's room |
| `5` | a deferred response: a LOADING message, completed by editing `@original` |
| `6` | deferred update: shows nothing, the bot edits the component's message |
| `7` | update the component's message now |
| `9` | open a modal for the person |

- A body is `{ "type": …, "data": … }`. For `4`/`7`, `data` is a message
  (`content`, `embeds`, `components`, `flags`); for `9`, a modal (`custom_id`,
  `title`, `components`).
- The bot has **3 seconds** for its first response. After that the person's
  request fails with a timeout; a response that began just before gets a 10 s
  grace.
- `?with_response=true` answers with
  `{interaction:{id,type,response_message_id,…}, resource:{type,message}}`.
- A first response may be sent once. A second is refused.

### Follow-ups and edits

The application's ID stands where a webhook's does:

- `POST /api/webhooks/:appId/:token` — a follow-up message.
- `GET|PATCH|DELETE /api/webhooks/:appId/:token/messages/:ref` — `ref` is
  `@original` or a follow-up's message ID.
- Editing `@original` completes a deferred response.
- The interaction token works for **15 minutes**.
- `flags` `64` makes a message ephemeral (only the invoker sees it); `32768` is
  `IS_COMPONENTS_V2`.

## Commands

Registered by the bot (or a team admin) under:

```
GET|POST|PUT /api/users/@me/teams/:teamId/applications/:appId/commands
GET|PATCH|DELETE .../commands/:commandId
```

`PUT` overwrites the whole list. A bot with its token may manage its own
application's commands.

Rules (Discord's, minus subcommands and attachments):

- At most 100 commands per application.
- `type` is `1` (chat input); `0` is accepted as the same.
- Names: 1–32 characters, lowercase, letters/digits/`-`/`_`.
- Descriptions: 1–100 characters, not only spaces.
- At most 25 options; required options come before optional ones.
- Option types: 3 string, 4 integer, 5 boolean, 6 user, 7 room, 8 role,
  9 mentionable, 10 number. No 1/2 (subcommands) or 11 (attachment).
- Choices: 25 per option; string/integer/number only.
- 8000 characters across names, descriptions and choices.

Clients discover commands with `GET /api/spaces/:spaceId/commands`, which lists
the applications whose bots are in the space. A person then creates an
interaction with `POST /api/interactions` (`type: 2`, `application_id`, and the
command's options). That route is human-only.

## Messages

- `POST /api/rooms/:roomId/messages` with content, embeds, components and flags.
  Only bots may send `components` or `flags`; a person gets a 400.
- `PATCH /api/rooms/:roomId/messages/:messageId` edits the bot's own message;
  a bot may change content, embeds, components and flags.
- Reactions, typing, pins and history work within the bot's permissions.
- Bots cannot create or join conversations (DMs).

## Permissions

Bots obey roles and room overwrites exactly as people do. Adding one gives it
`@everyone`; grant more with normal roles. `Manage Bots` is what lets a person
add or remove one from a space.

## Rate limits

- 50 requests a second per user (administered globally).
- 64 a minute per authenticated route (the `X-RateLimit-*` headers).
- Interaction polling: 600 a minute.
- Interaction-token routes (callbacks, follow-ups, edits): 60 a minute per
  token.
- Webhook execution: 30 a minute per webhook and IP.
