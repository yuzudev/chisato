// The bot: wires the gateway's frames to commands, components and modals, and
// gives handlers a small, safe way to answer an interaction.

import { DuvetClient, DuvetError, type GatewayManager } from "libduvet";
import { commands, componentHandlers, modalHandlers } from "./commands";
import { BotState } from "./state";
import type {
  Application,
  CallbackResponse,
  CommandData,
  CommandRegistration,
  CommandUseOption,
  ComponentData,
  GatewayFrame,
  Interaction,
  InteractionMessage,
  JsonObject,
  RegisteredCommand,
  JsonValue,
  Message,
  Modal,
  ModalSubmitData,
} from "./types";

export interface CommandContextLike {
  readonly interaction: Interaction;
  readonly bot: Chisato;
  /** The group and subcommand used, after the command's name: `["order", "drink"]`. */
  readonly subcommand: string[];
  option(name: string): JsonValue | undefined;
  optionString(name: string): string | undefined;
  optionInt(name: string): number | undefined;
  reply(
    message: string | InteractionMessage,
    options?: { ephemeral?: boolean; withResponse?: boolean },
  ): Promise<CallbackResponse | null>;
  defer(): Promise<void>;
  update(message: InteractionMessage): Promise<CallbackResponse | null>;
  openModal(modal: Modal): Promise<void>;
  followUp(message: InteractionMessage): Promise<Message>;
  editOriginal(message: InteractionMessage): Promise<void>;
  log(message: string): void;
}

export interface CommandDefinition {
  registration: CommandRegistration;
  handler: (ctx: CommandContextLike) => Promise<void>;
}

export interface ComponentHandler {
  /** The custom_id prefix this handler answers. */
  prefix: string;
  handler: (
    ctx: CommandContextLike,
    customId: string,
  ) => Promise<void>;
}

export interface ModalHandler {
  customId: string;
  handler: (ctx: CommandContextLike) => Promise<void>;
}

/** A poll's votes, kept in memory while the bot runs. */
export interface Poll {
  id: string;
  question: string;
  options: string[];
  votes: number[];
  /** User ID → option index. One vote per person; a new one moves it. */
  voters: Map<string, number>;
  messageId?: string;
  roomId: string;
  spaceId: string;
  createdAt: number;
}

export interface ChisatoOptions {
  /** The bot's token. It never reaches argv or the logs. */
  token: string;
  /** Gateway shards, 1–64. */
  shards?: number;
  resume?: boolean;
  /** The API's and the gateway's hosts, no scheme. */
  api?: string;
  ws?: string;
  secure?: boolean;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export class Chisato {
  readonly client: DuvetClient;
  readonly gateway: GatewayManager;
  private readonly shards: number;
  readonly state = new BotState();
  readonly commands = new Map<string, CommandDefinition>();
  readonly componentHandlers: ComponentHandler[] = [];
  readonly modalHandlers = new Map<string, ModalHandler>();
  readonly polls = new Map<string, Poll>();
  application: Application | null = null;
  private readonly logLine: (line: string) => void;

  constructor(
    options: ChisatoOptions,
  ) {
    this.logLine = options.log ?? ((line) => console.error(`[chisato] ${line}`));
    const { api, ws, secure, timeoutMs } = options;
    this.client = DuvetClient.bot(options.token, { api, ws, secure, timeoutMs });
    this.gateway = this.client.gatewayManager({
      resume: options.resume ?? true,
      log: (message) => this.logLine(`gateway: ${message}`),
    });
    this.shards = Math.min(64, Math.max(1, Math.trunc(options.shards ?? 1)));
    for (const command of commands) {
      this.commands.set(command.registration.name, command);
    }
    this.componentHandlers.push(...componentHandlers);
    for (const modal of modalHandlers) {
      this.modalHandlers.set(modal.customId, modal);
    }
  }

  async start(): Promise<void> {
    // Before connecting: READY can come as soon as a socket opens.
    this.gateway.on("raw", (text) => this.onFrame(JSON.parse(text) as GatewayFrame));
    const application = (await this.client.bot.getApplication()) as Application;
    this.application = application;
    this.logLine(
      `application ${application.name} (${application.id}), ${this.shards} shard(s)`,
    );
    await this.registerCommands();
    await this.gateway.connectAll(this.shards);
    const ready = await this.state.waitForReady();
    if (ready && this.state.me) {
      this.logLine(`online as ${this.state.me.username} (${this.state.me.id})`);
    } else {
      this.logLine("connected, but READY hasn't come yet");
    }
  }

  async stop(): Promise<void> {
    this.gateway.destroy();
  }

  log(message: string): void {
    this.logLine(message);
  }

  private async registerCommands(): Promise<void> {
    const app = this.application;
    if (!app) return;
    const registrations = [...this.commands.values()].map(
      (command) => command.registration,
    );
    try {
      const saved = (await this.client.bot.overwriteCommands(
        app.team_id,
        app.id,
        registrations,
      )) as RegisteredCommand[];
      this.logLine(
        `registered ${saved.length} command(s): ${saved
          .map((command) => `/${command.name}`)
          .join(", ")}`,
      );
    } catch (error) {
      // Existing commands still work; the rest of the bot can run.
      this.logLine(`couldn't register commands: ${errorText(error)}`);
    }
  }

  private onFrame(frame: GatewayFrame): void {
    this.state.apply(frame);
    if (frame.d?.type === "INTERACTION_CREATE") {
      const interaction = frame.d.data as Interaction;
      void this.handleInteraction(interaction);
    }
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    const who = interaction.member?.user?.username ?? "someone";
    this.logLine(
      `${who} used ${describe(interaction)} in ${interaction.space?.name ?? "?"} / #${interaction.room?.name ?? "?"}`,
    );
    switch (interaction.type) {
      case 2: {
        const data = interaction.data as CommandData;
        const command = this.commands.get(data.name);
        if (!command) {
          await this.run(interaction, async (ctx) => {
            await ctx.reply(`I don't know \`/${data.name}\` any more.`, {
              ephemeral: true,
            });
          });
          return;
        }
        await this.run(interaction, command.handler);
        return;
      }
      case 3: {
        const data = interaction.data as ComponentData;
        const found = this.componentHandlers.find((candidate) =>
          data.custom_id.startsWith(candidate.prefix),
        );
        if (!found) {
          await this.run(interaction, async (ctx) => {
            await ctx.reply("That button is from an older version of me.", {
              ephemeral: true,
            });
          });
          return;
        }
        await this.run(interaction, (ctx) =>
          found.handler(ctx, data.custom_id),
        );
        return;
      }
      case 5: {
        const data = interaction.data as ModalSubmitData;
        const handler = this.modalHandlers.get(data.custom_id);
        if (!handler) {
          await this.run(interaction, async (ctx) => {
            await ctx.reply("That form is from an older version of me.", {
              ephemeral: true,
            });
          });
          return;
        }
        await this.run(interaction, handler.handler);
        return;
      }
      default:
        this.log(`ignoring interaction type ${interaction.type}`);
    }
  }

  private async run(
    interaction: Interaction,
    handler: (ctx: CommandContextLike) => Promise<void>,
  ): Promise<void> {
    const ctx = new CommandContext(this, interaction);
    // The API gives a bot 3 seconds for its first response. A handler that
    // takes longer gets a deferred one, so the person sees something and the
    // window stays open for an edit.
    const autoDefer = setTimeout(() => {
      if (ctx.responded) return;
      ctx.defer().catch((error) => {
        this.logLine(
          `couldn't defer interaction ${interaction.id}: ${errorText(error)}`,
        );
      });
    }, 2_200);
    try {
      await handler(ctx);
    } catch (error) {
      this.logLine(
        `interaction ${interaction.id} (${describe(interaction)}) failed: ${errorText(error)}`,
      );
      if (!ctx.responded) {
        await ctx
          .reply("Something went wrong on my side.", { ephemeral: true })
          .catch(() => {});
      }
    } finally {
      clearTimeout(autoDefer);
    }
    if (!ctx.responded) {
      await ctx
        .reply("I had nothing to say to that.", { ephemeral: true })
        .catch(() => {});
    }
  }
}

export class CommandContext implements CommandContextLike {
  readonly interaction: Interaction;
  readonly bot: Chisato;
  responded = false;
  deferred = false;
  readonly subcommand: string[] = [];
  private readonly options = new Map<string, JsonValue>();

  constructor(bot: Chisato, interaction: Interaction) {
    this.bot = bot;
    this.interaction = interaction;
    if (interaction.type === 2) {
      const used = usedCommand(interaction.data as CommandData);
      this.subcommand = used.path.slice(1);
      for (const option of used.options) {
        if (option.value !== undefined) this.options.set(option.name, option.value);
      }
    }
  }

  option(name: string): JsonValue | undefined {
    return this.options.get(name);
  }

  optionString(name: string): string | undefined {
    const value = this.options.get(name);
    return typeof value === "string" ? value : undefined;
  }

  optionInt(name: string): number | undefined {
    const value = this.options.get(name);
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return undefined;
  }

  async reply(
    message: string | InteractionMessage,
    options: { ephemeral?: boolean; withResponse?: boolean } = {},
  ): Promise<CallbackResponse | null> {
    this.responded = true;
    const data: InteractionMessage =
      typeof message === "string" ? { content: message } : { ...message };
    if (options.ephemeral) data.flags = (data.flags ?? 0) | 64;
    return this.bot.client.bot.respond(
      this.interaction.id,
      this.interaction.token,
      4,
      data,
      options.withResponse ?? false,
    ) as Promise<CallbackResponse | null>;
  }

  async defer(): Promise<void> {
    if (this.responded) return;
    this.responded = true;
    this.deferred = true;
    await this.bot.client.bot.respond(
      this.interaction.id,
      this.interaction.token,
      5,
      null,
      false,
    );
  }

  async update(
    message: InteractionMessage,
  ): Promise<CallbackResponse | null> {
    this.responded = true;
    return this.bot.client.bot.respond(
      this.interaction.id,
      this.interaction.token,
      7,
      message,
      false,
    ) as Promise<CallbackResponse | null>;
  }

  async openModal(modal: Modal): Promise<void> {
    this.responded = true;
    await this.bot.client.bot.respond(
      this.interaction.id,
      this.interaction.token,
      9,
      modal,
      false,
    );
  }

  followUp(message: InteractionMessage): Promise<Message> {
    return this.bot.client.bot.followUp(
      this.interaction.application_id,
      this.interaction.token,
      message,
    ) as Promise<Message>;
  }

  async editOriginal(message: InteractionMessage): Promise<void> {
    await this.bot.client.bot.editMessage(
      this.interaction.application_id,
      this.interaction.token,
      "@original",
      message,
    );
  }

  log(message: string): void {
    this.bot.log(message);
  }
}

/**
 * A command use's path, `["cafe", "order", "drink"]`, and the options of the
 * subcommand at its end: a group holds one subcommand, which holds the values.
 */
export function usedCommand(data: CommandData): {
  path: string[];
  options: CommandUseOption[];
} {
  const path = [data.name];
  let options = data.options ?? [];
  while (options.length === 1 && (options[0]!.type === 1 || options[0]!.type === 2)) {
    path.push(options[0]!.name);
    options = options[0]!.options ?? [];
  }
  return { path, options };
}

export function describe(interaction: Interaction): string {
  if (interaction.type === 2) {
    return `/${usedCommand(interaction.data as CommandData).path.join(" ")}`;
  }
  if (interaction.type === 3) {
    return `component ${(interaction.data as ComponentData).custom_id}`;
  }
  return `modal ${(interaction.data as ModalSubmitData).custom_id}`;
}

function errorText(error: unknown): string {
  // The API's answer says why it refused; the message alone has only the status.
  if (error instanceof DuvetError) return `${error.message} ${JSON.stringify(error.detail)}`;
  return error instanceof Error ? error.message : String(error);
}
