// The bot's copy of the spaces it's in, built from the gateway's frames. A bot
// needs room IDs to send anything, and SPACE_CREATE is where they come from.

import type {
  BotUser,
  GatewayFrame,
  ReadyData,
  Role,
  Room,
  Space,
  SpaceCreateData,
} from "./types";

export interface CachedSpace {
  space: Space;
  rooms: Map<string, Room>;
  roles: Map<string, Role>;
  /** Member ID → role IDs. */
  memberRoles: Map<string, string[]>;
  overwrites: Record<string, unknown>;
}

export class BotState {
  me: BotUser | null = null;
  sessionToken: string | null = null;
  shard: [number, number] | null = null;
  /** The spaces READY listed, in order. */
  guildIds: string[] = [];
  readonly spaces = new Map<string, CachedSpace>();
  private readyWaiters: Array<() => void> = [];

  apply(frame: GatewayFrame): void {
    const type = frame.d?.type;
    if (!type) return;
    const data = frame.d?.data;
    switch (type) {
      case "READY": {
        const ready = data as ReadyData;
        this.me = ready.user;
        this.sessionToken = ready.sessionToken;
        this.shard = ready.shard;
        this.guildIds = ready.guild_ids ?? [];
        for (const waiter of this.readyWaiters.splice(0)) waiter();
        return;
      }
      case "SPACE_CREATE":
        this.addSpace(data as SpaceCreateData);
        return;
      case "SPACE_UPDATE": {
        const space = data as Space;
        const cached = this.spaces.get(space.id);
        if (cached) cached.space = space;
        return;
      }
      case "SPACE_DELETE": {
        const id = (data as { id?: string })?.id;
        if (id) this.spaces.delete(id);
        return;
      }
      case "ROOM_CREATE":
      case "ROOM_UPDATE": {
        const room = data as Room;
        const cached = this.spaces.get(room.space_id);
        if (cached) cached.rooms.set(room.id, room);
        return;
      }
      case "ROOM_DELETE": {
        const deleted = data as { id?: string; space_id?: string };
        if (deleted.space_id) {
          this.spaces.get(deleted.space_id)?.rooms.delete(deleted.id ?? "");
        }
        return;
      }
      case "ROLE_CREATE":
      case "ROLE_UPDATE": {
        const role = data as Role;
        const cached = this.spaces.get(role.space_id);
        if (cached) cached.roles.set(role.id, role);
        return;
      }
      case "ROLE_DELETE": {
        const deleted = data as { id?: string; space_id?: string };
        if (deleted.space_id) {
          this.spaces.get(deleted.space_id)?.roles.delete(deleted.id ?? "");
        }
        return;
      }
      default:
        return;
    }
  }

  space(id: string): CachedSpace | undefined {
    return this.spaces.get(id);
  }

  /** The space's rooms of one type, by position: 1 text, 2 voice, 3 category. */
  roomsOfType(spaceId: string, type: number): Room[] {
    const cached = this.spaces.get(spaceId);
    if (!cached) return [];
    return [...cached.rooms.values()]
      .filter((room) => room.type === type)
      .sort((a, b) => a.position - b.position);
  }

  textRooms(spaceId: string): Room[] {
    return this.roomsOfType(spaceId, 1);
  }

  /** Resolves once READY has come; false on timeout. */
  waitForReady(timeoutMs = 20_000): Promise<boolean> {
    if (this.me) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const at = this.readyWaiters.indexOf(ready);
        if (at >= 0) this.readyWaiters.splice(at, 1);
        resolve(false);
      }, timeoutMs);
      const ready = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.readyWaiters.push(ready);
    });
  }

  private addSpace(data: SpaceCreateData): void {
    const rooms = new Map<string, Room>();
    for (const [id, room] of Object.entries(data.rooms ?? {})) {
      rooms.set(id, room);
    }
    const roles = new Map<string, Role>();
    for (const [id, role] of Object.entries(data.roles_permissions ?? {})) {
      roles.set(id, role);
    }
    this.spaces.set(data.space.id, {
      space: data.space,
      rooms,
      roles,
      memberRoles: new Map(Object.entries(data.member_roles ?? {})),
      overwrites: data.overwrites ?? {},
    });
  }
}
