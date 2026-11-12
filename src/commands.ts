// chisato's commands. Each one is a registration (what people see) and a
// handler (what happens). Buttons and modals live here too.

import type {
  CommandContextLike,
  CommandDefinition,
  ComponentHandler,
  ModalHandler,
  Poll,
} from "./bot";
import type { JsonObject } from "./types";

const PINK = 0xff6b9d;
const VIOLET = 0x8b5cf6;
const MINT = 0x2dd4bf;

export const commands: CommandDefinition[] = [
  {
    registration: {
      type: 1,
      name: "ping",
      description: "Check that I'm awake",
      options: [],
    },
    handler: async (ctx) => {
      const started = performance.now();
      const roundTrip = Math.max(0, Math.round(performance.now() - started));
      await ctx.reply(`Pong! \`${roundTrip}ms\``);
    },
  },
  {
    registration: {
      type: 1,
      name: "roll",
      description: "Roll some dice",
      options: [
        {
          type: 4,
          name: "sides",
          description: "How many sides each die has (default 6)",
          min_value: 2,
          max_value: 1000,
        },
        {
          type: 4,
          name: "count",
          description: "How many dice to roll (default 1, at most 20)",
          min_value: 1,
          max_value: 20,
        },
      ],
    },
    handler: async (ctx) => {
      const sides = clamp(ctx.optionInt("sides") ?? 6, 2, 1000);
      const count = clamp(ctx.optionInt("count") ?? 1, 1, 20);
      const rolls = Array.from({ length: count }, () =>
        Math.floor(Math.random() * sides) + 1,
      );
      const total = rolls.reduce((sum, value) => sum + value, 0);
      const content =
        rolls.length === 1
          ? `🎲 You rolled **${rolls[0]}** (d${sides}).`
          : `🎲 You rolled ${rolls.map((value) => `**${value}**`).join(", ")} (d${sides}).\nTotal: **${total}**.`;
      await ctx.reply(content);
    },
  },
  {
    registration: {
      type: 1,
      name: "8ball",
      description: "Ask the magic 8-ball a question",
      options: [
        {
          type: 3,
          name: "question",
          description: "What do you want to know?",
          required: true,
          max_length: 500,
        },
      ],
    },
    handler: async (ctx) => {
      const question = (ctx.optionString("question") ?? "").trim().slice(0, 500);
      if (question === "") {
        await ctx.reply("Ask me something first.", { ephemeral: true });
        return;
      }
      const answer = pick(EIGHT_BALL);
      await ctx.reply({
        content: `> ${question}`,
        embeds: [
          embed({
            title: "🎱 The 8-ball says",
            description: `**${answer}**`,
            color: VIOLET,
            footer: "Not legal advice. Probably.",
          }),
        ],
      });
    },
  },
  {
    registration: {
      type: 1,
      name: "poll",
      description: "Start a poll with buttons",
      options: [
        {
          type: 3,
          name: "question",
          description: "What are we voting on?",
          required: true,
          max_length: 200,
        },
        {
          type: 3,
          name: "choices",
          description: "Comma-separated choices (2 to 5; default Yes, No)",
          max_length: 400,
        },
      ],
    },
    handler: async (ctx) => {
      const question = (ctx.optionString("question") ?? "").trim().slice(0, 200);
      if (question === "") {
        await ctx.reply("A poll needs a question.", { ephemeral: true });
        return;
      }
      let options = (ctx.optionString("choices") ?? "Yes, No")
        .split(",")
        .map((choice) => choice.trim())
        .filter((choice) => choice !== "");
      if (options.length < 2) options = ["Yes", "No"];
      options = options.slice(0, 5).map((choice) => choice.slice(0, 60));

      const poll: Poll = {
        id: shortId(),
        question,
        options,
        votes: options.map(() => 0),
        voters: new Map(),
        roomId: ctx.interaction.room_id,
        spaceId: ctx.interaction.space_id,
        createdAt: Date.now(),
      };
      ctx.bot.polls.set(poll.id, poll);

      const response = await ctx.reply(
        { content: pollContent(poll), components: [pollRow(poll)] },
        { withResponse: true },
      );
      poll.messageId =
        response?.interaction.response_message_id ??
        response?.resource.message?.id;
    },
  },
  {
    registration: {
      type: 1,
      name: "feedback",
      description: "Tell me what you think, in a form",
      options: [],
    },
    handler: async (ctx) => {
      await ctx.openModal({
        custom_id: "feedback",
        title: "Feedback for chisato",
        components: [
          {
            type: 18,
            label: "What should I know?",
            description: "It goes to my logs, not to a channel.",
            component: {
              type: 4,
              custom_id: "feedback_text",
              style: 2,
              min_length: 3,
              max_length: 500,
              required: true,
              placeholder: "Be honest. I can take it.",
            },
          },
        ],
      });
    },
  },
  {
    registration: {
      type: 1,
      name: "chisato",
      description: "A line from the café",
      options: [],
    },
    handler: async (ctx) => {
      await ctx.reply({
        embeds: [
          embed({
            title: "Chisato says",
            description: `*${pick(LINES)}*`,
            color: PINK,
            footer: "Lycoris Recoil",
          }),
        ],
      });
    },
  },
  {
    // Subcommands and a group of them: `/cafe menu`, `/cafe order drink`,
    // `/cafe order food`. The reply says which one came, and with what.
    registration: {
      type: 1,
      name: "cafe",
      description: "Café LycoReco",
      options: [
        { type: 1, name: "menu", description: "What's on today" },
        {
          type: 2,
          name: "order",
          description: "Order something",
          options: [
            {
              type: 1,
              name: "drink",
              description: "Order a drink",
              options: [
                {
                  type: 3,
                  name: "drink",
                  description: "Which one",
                  required: true,
                  choices: [
                    { name: "Coffee", value: "coffee" },
                    { name: "Matcha", value: "matcha" },
                    { name: "Cocoa", value: "cocoa" },
                  ],
                },
                { type: 4, name: "cups", description: "How many (default 1)", min_value: 1, max_value: 5 },
              ],
            },
            {
              type: 1,
              name: "food",
              description: "Order something to eat",
              options: [
                { type: 3, name: "dish", description: "What you'd like", required: true, max_length: 40 },
              ],
            },
          ],
        },
      ],
    },
    handler: async (ctx) => {
      const used = ["/cafe", ...ctx.subcommand].join(" ");
      switch (ctx.subcommand.join(" ")) {
        case "menu":
          await ctx.reply(`${used}: coffee, matcha, cocoa, and whatever Mizuki baked.`);
          return;
        case "order drink": {
          const cups = clamp(ctx.optionInt("cups") ?? 1, 1, 5);
          await ctx.reply(`${used} drink=${ctx.optionString("drink")} cups=${cups}: coming right up ☕`);
          return;
        }
        case "order food":
          await ctx.reply(`${used} dish=${ctx.optionString("dish")}: one ${ctx.optionString("dish")}, coming up.`);
          return;
        default:
          await ctx.reply(`I don't know ${used}.`, { ephemeral: true });
      }
    },
  },
  {
    registration: {
      type: 1,
      name: "help",
      description: "List what I can do",
      options: [],
    },
    handler: async (ctx) => {
      const lines = [...ctx.bot.commands.values()]
        .map(
          (command) =>
            `**/${command.registration.name}** — ${command.registration.description}`,
        )
        .join("\n");
      await ctx.reply({
        embeds: [
          embed({
            title: "chisato's commands",
            description: `${lines}\n\nButtons and forms work too: try \`/poll\` and \`/feedback\`.`,
            color: MINT,
            footer: "A calm day is a good day.",
          }),
        ],
      }, { ephemeral: true });
    },
  },
  {
    registration: {
      type: 1,
      name: "server",
      description: "Where are we, and what rooms are here?",
      options: [],
    },
    handler: async (ctx) => {
      const cached = ctx.bot.state.space(ctx.interaction.space_id);
      if (!cached) {
        await ctx.reply("I'm still learning this place. Try again in a moment.", {
          ephemeral: true,
        });
        return;
      }
      const text = ctx.bot.state.textRooms(cached.space.id);
      const member = ctx.interaction.member;
      const name = member.alias ?? member.user.alias ?? member.user.username;
      await ctx.reply({
        embeds: [
          embed({
            title: cached.space.name,
            description: cached.space.description ?? "No description.",
            color: MINT,
            fields: [
              { name: "Rooms", value: `${text.length} text`, inline: true },
              { name: "You", value: name, inline: true },
              {
                name: "Text rooms",
                value:
                  text.length > 0
                    ? text
                        .slice(0, 20)
                        .map((room) => `#${room.name}`)
                        .join(", ")
                    : "None I can see.",
              },
            ],
            footer: `space ${cached.space.id}`,
          }),
        ],
      }, { ephemeral: true });
    },
  },
];

// ---------------------------------------------------------------------------
// Buttons: polls
// ---------------------------------------------------------------------------

const POLL_PREFIX = "poll:";

export const componentHandlers: ComponentHandler[] = [
  {
    prefix: POLL_PREFIX,
    handler: async (ctx, customId) => {
      const [id, rawChoice] = customId.slice(POLL_PREFIX.length).split(":");
      const choice = Number(rawChoice);
      const poll = id ? ctx.bot.polls.get(id) : undefined;
      if (
        !poll ||
        !Number.isInteger(choice) ||
        choice < 0 ||
        choice >= poll.options.length
      ) {
        await ctx.reply("This poll isn't tracked any more.", {
          ephemeral: true,
        });
        return;
      }

      const voter = ctx.interaction.member.user.id;
      const previous = poll.voters.get(voter);
      if (previous === undefined) {
        poll.votes[choice] = (poll.votes[choice] ?? 0) + 1;
      } else if (previous !== choice) {
        poll.votes[previous] = Math.max(0, (poll.votes[previous] ?? 0) - 1);
        poll.votes[choice] = (poll.votes[choice] ?? 0) + 1;
      }
      poll.voters.set(voter, choice);

      await ctx.update({
        content: pollContent(poll),
        components: [pollRow(poll)],
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Modals: feedback
// ---------------------------------------------------------------------------

export const modalHandlers: ModalHandler[] = [
  {
    customId: "feedback",
    handler: async (ctx) => {
      const text = modalText(ctx, "feedback_text").trim();
      if (text === "") {
        await ctx.reply("The form came back empty. That's fine too.", {
          ephemeral: true,
        });
        return;
      }
      ctx.log(
        `feedback from ${ctx.interaction.member.user.username} (${ctx.interaction.member.user.id}) in ${ctx.interaction.space_id}: ${text}`,
      );
      await ctx.reply(
        `Thanks! I noted:\n> ${text.slice(0, 400).replace(/\n/g, "\n> ")}`,
        { ephemeral: true },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pollContent(poll: Poll): string {
  const total = poll.votes.reduce((sum, value) => sum + value, 0);
  return `**${poll.question}**\n\n${total} vote${total === 1 ? "" : "s"} so far. Click an option; clicking another moves your vote.`;
}

function pollRow(poll: Poll): JsonObject {
  return {
    type: 1,
    components: poll.options.map((label, index) => ({
      type: 2,
      style: index === 0 ? 3 : 2,
      label: `${label} (${poll.votes[index] ?? 0})`.slice(0, 80),
      custom_id: `${POLL_PREFIX}${poll.id}:${index}`,
    })),
  };
}

function modalText(ctx: CommandContextLike, customId: string): string {
  if (ctx.interaction.type !== 5) return "";
  const data = ctx.interaction.data as {
    components?: Array<{
      component?: { custom_id?: string; value?: unknown };
    }>;
  };
  for (const label of data.components ?? []) {
    const input = label.component;
    if (input?.custom_id === customId && typeof input.value === "string") {
      return input.value;
    }
  }
  return "";
}

function embed(options: {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
}): JsonObject {
  const embed: JsonObject = {};
  if (options.title) embed.title = options.title;
  if (options.description) embed.description = options.description;
  if (options.color !== undefined) embed.color = { color_from: options.color };
  if (options.footer) embed.footer = { text: options.footer };
  if (options.fields) {
    embed.fields = options.fields.map((field) => ({
      name: field.name,
      value: field.value,
      inline: field.inline ?? false,
    }));
  }
  return embed;
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)] as T;
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value));
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

const EIGHT_BALL = [
  "It is certain.",
  "Without a doubt.",
  "Yes, definitely.",
  "You may rely on it.",
  "Most likely.",
  "Outlook good.",
  "Signs point to yes.",
  "Reply hazy; try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Outlook not so good.",
  "Very doubtful.",
] as const;

const LINES = [
  "The café is open. The safety is on.",
  "Coffee first. Paperwork later.",
  "A calm day is a good day. Let's keep it that way.",
  "If it's for a friend, I'll make it happen.",
  "I'll take the sweet one. You can have the bitter one.",
  "Rule one: nobody gets hurt. Rule two: the coffee stays hot.",
  "I can dodge anything except an empty cup.",
  "You look like you need a parfait and a nap.",
] as const;
