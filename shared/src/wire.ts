// WebSocket wire protocol — server -> browser entity state messages.
// Every entity (including the chaser) reaches the server via the HMAC
// webhook; there is no browser -> server inbound path (see plan decision D4).
import { z } from 'zod';
import { EntitySchema, type Entity } from './entity.js';

export interface SnapshotMessage {
  type: 'snapshot';
  entities: Entity[];
  serverTs: number;
}

export interface UpsertMessage {
  type: 'upsert';
  entities: Entity[];
  serverTs: number;
}

export interface RemoveMessage {
  type: 'remove';
  id: string;
  serverTs: number;
}

export type WireMessage = SnapshotMessage | UpsertMessage | RemoveMessage;

export const WireMessageSchema: z.ZodType<WireMessage> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    entities: z.array(EntitySchema),
    serverTs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('upsert'),
    entities: z.array(EntitySchema),
    serverTs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('remove'),
    id: z.string().min(1),
    serverTs: z.number().int().positive(),
  }),
]);
