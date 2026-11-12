# chisato

A Duvet bot in TypeScript on [Bun](https://bun.sh), running the REST calls and
the gateway through [`libduvet`](https://github.com/duvetchat/lib-gleam)'s
JavaScript client: the Gleam client compiled to JavaScript, so no Erlang.

The bot logic, command definitions, components and modal handling are in
`src/`. libduvet owns the network: bot-token auth, REST, the WebSocket gateway,
heartbeats, reconnects, resume and sharding.

## Requirements

- Bun 1.2+

## Setup

```sh
bun install
cp .env.example .env    # paste the bot token
bun start
```

libduvet comes from its GitHub release tarball (`package.json`), not npm.

## Configuration

| Variable | Default | What |
|---|---|---|
| `DUVET_BOT_TOKEN` | — | the bot token (required) |
| `DUVET_SHARDS` | `1` | gateway shards, 1–64 |
| `DUVET_RESUME` | `true` | resume a dropped gateway session |
| `DUVET_API` | `api.duvet.chat` | REST host, no scheme |
| `DUVET_WS` | `ws.duvet.chat` | gateway host, no scheme |
| `DUVET_SECURE` | `true` | https/wss; `false` for a local stack |
| `DUVET_TIMEOUT_MS` | `20000` | idle timeout for a request |

## Commands

The bot registers these at startup (`PUT .../commands`, overwriting whatever the
application had):

| Command | What it does |
|---|---|
| `/ping` | round-trip check |
| `/roll [sides] [count]` | dice, up to 20 |
| `/8ball <question>` | an embed with an answer |
| `/poll <question> [choices]` | a message with 2–5 buttons; votes update in place |
| `/feedback` | opens a modal; the submit is acknowledged privately and logged |
| `/chisato` | a line from the café |
| `/cafe menu`, `/cafe order drink <drink> [cups]`, `/cafe order food <dish>` | subcommands and a group; the reply echoes which one came and its values |
| `/help` | the command list, ephemerally |
| `/server` | space and room information, ephemerally |

Buttons (`poll:<id>:<index>`) and modal submits are routed by `custom_id` in
`src/commands.ts`.

## How an interaction is answered

The gateway pushes `INTERACTION_CREATE` to the bot's shard. The bot has **3
seconds** for its first response:

- a normal reply is callback type `4`;
- a handler that takes longer than 2.2 s is automatically deferred with type
  `5`, and can then edit `@original`;
- a poll button uses type `7` to edit the message the button is on;
- `/feedback` uses type `9` to open a modal.

The interaction token lasts 15 minutes. `CommandContext` wraps libduvet's bot calls
(`reply`, `defer`, `update`, `openModal`, `followUp`, `editOriginal`) so a
handler never has to know the wire details.

## Layout

```
src/
  index.ts        environment, signals, logging
  bot.ts          interaction dispatch, CommandContext, poll store
  commands.ts     the commands, the poll button, the feedback modal
  state.ts        spaces and rooms from READY / SPACE_CREATE
  types.ts        the wire types (API, gateway)
test/
  integration.test.ts        fake API + fake gateway, real libduvet client
  commands.test.ts           handlers against a fake context
docs/BOT_API.md              how the API handles bots
```

## Tests

```sh
bun run check                 # tsc --noEmit
bun test                      # both suites
```

`test/integration.test.ts` runs the bot on libduvet against a fake REST API
and a fake WebSocket gateway: it registers the commands, sends `READY`,
`SPACE_CREATE` and an `INTERACTION_CREATE`, and checks the callback.

## Limits

Bots cannot join voice or calls: the gateway ignores `VOICE_*`, `CALL_*` and
WebRTC messages from bots. Bots have no conversations (DMs): those routes are
human-only. Polls live in memory and vanish on restart. The bot sends
content, embeds and components; it doesn't do file uploads yet. Command
registration overwrites the application's commands, so the code is the source
of truth.

See [`docs/BOT_API.md`](docs/BOT_API.md) for the endpoints, tokens and limits
this builds on.
