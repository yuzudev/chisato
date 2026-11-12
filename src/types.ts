// The wire types the bot reads and writes. They are deliberately the API's
// shapes: libduvet carries the bytes, and this side decides what they mean.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Duvet models (the parts a bot uses)
// ---------------------------------------------------------------------------

export interface BotUser {
  id: string;
  username: string;
  alias: string | null;
  avatar: string | null;
  banner?: string | null;
  custom?: string;
  is_bot?: boolean;
  flags?: number;
  badges?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Application {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  bot_user_id: string | null;
  public: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Space {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  icon: string | null;
  banner: string | null;
  locale: string | null;
  created_at: string;
  updated_at: string;
}

/** A text room (1), a voice room (2) or a category (3). */
export interface Room {
  id: string;
  space_id: string;
  parent_id: string | null;
  type: number;
  name: string;
  description: string | null;
  position: number;
  nsfw: boolean;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  space_id: string;
  name: string;
  color_from: number | null;
  color_via: number | null;
  color_to: number | null;
  flags: number;
  permissions: number;
  hoisted: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  space_id: string;
  user_id: string;
  alias: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReadyData {
  user: BotUser;
  /** The session token to resume with, not the bot token. */
  sessionToken: string;
  guild_ids: string[];
  /** [shard id, shard count]. */
  shard: [number, number];
}

export interface SpaceCreateData {
  space: Space;
  rooms: Record<string, Room>;
  roles_permissions: Record<string, Role>;
  member_roles: Record<string, string[]>;
  overwrites: Record<string, JsonObject[]>;
  owner_id: string;
  member_statuses?: Record<string, number>;
  member_client_status?: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  room_id?: string;
  author_id?: string;
  content?: string | null;
  type?: number;
  created_at?: string;
  updated_at?: string;
  embeds?: JsonObject[];
  components?: JsonObject[];
  attachments?: JsonObject[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export interface CommandUseOption {
  name: string;
  /** 1 a subcommand and 2 a group, which carry `options`; the others a `value`. */
  type: number;
  value?: JsonValue;
  options?: CommandUseOption[];
}

export interface ResolvedData {
  users?: Record<string, BotUser>;
  members?: Record<string, Member>;
  roles?: Record<string, Role>;
  rooms?: Record<string, Room>;
}

export interface CommandData {
  id: string;
  name: string;
  /** 1, a chat command. */
  type: number;
  options?: CommandUseOption[];
  resolved?: ResolvedData;
}

export interface ComponentData {
  custom_id: string;
  component_type: number;
  id?: number;
  values?: string[];
  resolved?: ResolvedData;
}

export interface ModalAnswer {
  type: number;
  id: number;
  custom_id?: string;
  /** A text input's text, a radio group's choice or a checkbox's state. */
  value?: JsonValue;
  /** A select's or a checkbox group's choice. */
  values?: string[];
  component?: ModalAnswer;
}

export interface ModalSubmitData {
  custom_id: string;
  components: ModalAnswer[];
  resolved?: ResolvedData;
}

export interface InteractionMember extends Member {
  user: BotUser;
  /** The member's permissions in the room. */
  permissions: number;
}

export interface Interaction {
  id: string;
  application_id: string;
  /** 2: a command, 3: a component, 5: a modal submit. */
  type: number;
  data: CommandData | ComponentData | ModalSubmitData;
  space_id: string;
  space: Space;
  room_id: string;
  room: Room;
  member: InteractionMember;
  /** The interaction's token: its first response and follow-ups take it. */
  token: string;
  version: number;
  /** The message whose component was used, for a component's interaction. */
  message?: Message;
  app_permissions: number;
  /** 0: a space, 1: a private chat, 2: a private room. */
  context: number;
}

export interface InteractionMessage {
  content?: string;
  embeds?: JsonObject[];
  components?: JsonObject[];
  flags?: number;
}

export interface Modal {
  custom_id: string;
  title: string;
  components: JsonObject[];
}

/** A message with the interaction's answer, or an edit of one. */
export interface CallbackResponse {
  interaction: {
    id: string;
    type: number;
    response_message_id?: string;
    response_message_loading?: boolean;
    response_message_ephemeral?: boolean;
  };
  resource: {
    type: number;
    message?: Message;
  };
}

/** What PUT .../commands answers for each command. */
export interface RegisteredCommand {
  id: string;
  type?: number;
  application_id: string;
  name: string;
  description: string;
  options: JsonObject[];
  version?: string;
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

export interface GatewayFrame {
  op: number;
  event: string;
  s?: number;
  d?: {
    type: string;
    data: unknown;
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandChoice {
  name: string;
  value: string | number;
}

export interface CommandOption {
  /**
   * 1 subcommand, 2 subcommand group, 3 string, 4 integer, 5 boolean, 6 user,
   * 7 room, 8 role, 9 mentionable, 10 number.
   */
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: CommandChoice[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  room_types?: number[];
  /** A subcommand's options, or a group's subcommands. */
  options?: CommandOption[];
}

export interface CommandRegistration {
  type: 1;
  name: string;
  description: string;
  options: CommandOption[];
}
