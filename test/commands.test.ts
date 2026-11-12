// The handlers without a network: a fake context records what they answer.

import { describe, expect, test } from "bun:test";
import { usedCommand, type Chisato, type CommandContextLike } from "../src/bot";
import {
  commands,
  componentHandlers,
  modalHandlers,
} from "../src/commands";
import type {
  CallbackResponse,
  CommandData,
  Interaction,
  InteractionMessage,
  JsonValue,
  Message,
  Modal,
} from "../src/types";

interface Reply {
  message: InteractionMessage;
  ephemeral: boolean;
  withResponse: boolean;
}

class FakeContext implements CommandContextLike {
  readonly interaction: Interaction;
  readonly bot: Chisato;
  readonly replies: Reply[] = [];
  readonly updates: InteractionMessage[] = [];
  readonly follows: InteractionMessage[] = [];
  readonly edits: InteractionMessage[] = [];
  modal?: Modal;
  responded = false;
  readonly subcommand: string[] = [];
  private readonly values = new Map<string, JsonValue>();

  constructor(interaction: Interaction, bot: Chisato) {
    this.interaction = interaction;
    this.bot = bot;
    if (interaction.type === 2) {
      const used = usedCommand(interaction.data as CommandData);
      this.subcommand = used.path.slice(1);
      for (const option of used.options) {
        if (option.value !== undefined) this.values.set(option.name, option.value);
      }
    }
  }

  option(name: string): JsonValue | undefined {
    return this.values.get(name);
  }

  optionString(name: string): string | undefined {
    const value = this.values.get(name);
    return typeof value === "string" ? value : undefined;
  }

  optionInt(name: string): number | undefined {
    const value = this.values.get(name);
    return typeof value === "number" ? Math.trunc(value) : undefined;
  }

  async reply(
    message: string | InteractionMessage,
    options: { ephemeral?: boolean; withResponse?: boolean } = {},
  ): Promise<CallbackResponse | null> {
    this.responded = true;
    this.replies.push({
      message:
        typeof message === "string" ? { content: message } : message,
      ephemeral: options.ephemeral ?? false,
      withResponse: options.withResponse ?? false,
    });
    return null;
  }

  async defer(): Promise<void> {
    this.responded = true;
  }

  async update(
    message: InteractionMessage,
  ): Promise<CallbackResponse | null> {
    this.responded = true;
    this.updates.push(message);
    return null;
  }

  async openModal(modal: Modal): Promise<void> {
    this.responded = true;
    this.modal = modal;
  }

  async followUp(message: InteractionMessage): Promise<Message> {
    this.follows.push(message);
    return { id: "m3" };
  }

  async editOriginal(message: InteractionMessage): Promise<void> {
    this.edits.push(message);
  }

  log(): void {}
}

function bot(): Chisato {
  return {
    commands: new Map(commands.map((command) => [command.registration.name, command])),
    polls: new Map(),
    state: {
      space: () => ({
        space: { id: "s1", name: "Test space", description: null },
        rooms: new Map(),
      }),
      textRooms: () => [{ id: "r1", name: "general", position: 0 }],
    },
  } as unknown as Chisato;
}

function interaction(
  type: number,
  data: Record<string, unknown>,
): Interaction {
  return {
    id: "i1",
    application_id: "app1",
    type,
    data,
    space_id: "s1",
    space: { id: "s1", name: "Test space" },
    room_id: "r1",
    room: { id: "r1", name: "general" },
    member: {
      id: "m1",
      space_id: "s1",
      user_id: "u1",
      alias: null,
      user: { id: "u1", username: "tester", alias: null, avatar: null },
      permissions: 4,
    },
    token: "itok",
    version: 1,
    app_permissions: 4,
    context: 0,
  } as unknown as Interaction;
}

async function runCommand(
  name: string,
  options: Record<string, JsonValue> = {},
): Promise<FakeContext> {
  const definition = commands.find(
    (command) => command.registration.name === name,
  );
  if (!definition) throw new Error(`no /${name}`);
  const ctx = new FakeContext(
    interaction(2, {
      id: "c1",
      name,
      type: 1,
      options: Object.entries(options).map(([key, value]) => ({
        name: key,
        type: typeof value === "number" ? 4 : 3,
        value,
      })),
    }),
    bot(),
  );
  await definition.handler(ctx);
  return ctx;
}

describe("commands", () => {
  test("cafe reads its group, subcommand and their options", async () => {
    const cafe = commands.find((command) => command.registration.name === "cafe")!;
    const ctx = new FakeContext(
      interaction(2, {
        id: "c1",
        name: "cafe",
        type: 1,
        options: [
          {
            name: "order",
            type: 2,
            options: [
              {
                name: "drink",
                type: 1,
                options: [
                  { name: "drink", type: 3, value: "matcha" },
                  { name: "cups", type: 4, value: 2 },
                ],
              },
            ],
          },
        ],
      }),
      bot(),
    );
    await cafe.handler(ctx);
    expect(ctx.replies[0]?.message.content).toStartWith("/cafe order drink drink=matcha cups=2");
  });

  test("ping pongs", async () => {
    const ctx = await runCommand("ping");
    expect(ctx.replies[0]?.message.content).toMatch(/Pong/);
  });

  test("roll uses the options", async () => {
    const ctx = await runCommand("roll", { sides: 20, count: 3 });
    const content = ctx.replies[0]?.message.content ?? "";
    expect(content).toContain("d20");
    // Three rolls and their total, each bolded.
    expect(content.match(/\*\*\d+\*\*/g)?.length).toBe(4);
  });

  test("8ball answers with an embed", async () => {
    const ctx = await runCommand("8ball", { question: "Is this a test?" });
    expect(ctx.replies[0]?.message.embeds?.[0]?.title).toBe(
      "🎱 The 8-ball says",
    );
  });

  test("poll stores a poll and sends buttons", async () => {
    const ctx = await runCommand("poll", {
      question: "Lunch?",
      choices: "Pizza, Sushi",
    });
    expect(ctx.replies[0]?.withResponse).toBe(true);
    const row = ctx.replies[0]?.message.components?.[0] as {
      components: Array<{ label: string }>;
    };
    expect(row.components.map((button) => button.label)).toEqual([
      "Pizza (0)",
      "Sushi (0)",
    ]);
    expect(ctx.bot.polls.size).toBe(1);
  });

  test("a poll button moves a vote and updates the message", async () => {
    const pollCtx = await runCommand("poll", {
      question: "Lunch?",
      choices: "Pizza, Sushi",
    });
    const poll = [...pollCtx.bot.polls.values()][0];
    if (!poll) throw new Error("no poll");

    const componentCtx = new FakeContext(
      interaction(3, {
        custom_id: `poll:${poll.id}:1`,
        component_type: 2,
      }),
      pollCtx.bot,
    );
    await componentHandlers[0]?.handler(
      componentCtx,
      `poll:${poll.id}:1`,
    );

    expect(poll.votes).toEqual([0, 1]);
    expect(poll.voters.get("u1")).toBe(1);
    const row = componentCtx.updates[0]?.components?.[0] as {
      components: Array<{ label: string }>;
    };
    expect(row.components[1]?.label).toBe("Sushi (1)");
  });

  test("feedback opens a modal and its submit thanks the person", async () => {
    const feedback = await runCommand("feedback");
    expect(feedback.modal?.custom_id).toBe("feedback");
    expect(feedback.modal?.components[0]?.type).toBe(18);

    const submit = new FakeContext(
      interaction(5, {
        custom_id: "feedback",
        components: [
          {
            type: 18,
            id: 1,
            component: {
              type: 4,
              id: 2,
              custom_id: "feedback_text",
              value: "I like the buttons",
            },
          },
        ],
      }),
      bot(),
    );
    const handler = modalHandlers.find(
      (modal) => modal.customId === "feedback",
    );
    await handler?.handler(submit);
    expect(submit.replies[0]?.ephemeral).toBe(true);
    expect(submit.replies[0]?.message.content).toContain("I like the buttons");
  });

  test("help lists every command", async () => {
    const ctx = await runCommand("help");
    const description = String(ctx.replies[0]?.message.embeds?.[0]?.description);
    for (const command of commands) {
      expect(description).toContain(`/${command.registration.name}`);
    }
  });
});
