import { getPrismaClient } from "@treasury/database";
import type { KnownEventType, DomainEvent } from "@treasury/types";
import { randomUUID } from "crypto";

type EventListenerFn<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * Append-only domain event store.
 * Persists events to the database and notifies in-process listeners.
 */
export class EventStore {
  private readonly listeners = new Map<string, Set<EventListenerFn>>();

  /**
   * Emit a domain event — persists immediately to the database
   * and notifies any registered in-process listeners.
   */
  async emit<T = unknown>(params: {
    eventType: KnownEventType | string;
    aggregateId: string;
    aggregateType: string;
    actorId?: string;
    actorType?: "user" | "system" | "provider";
    payload: T;
    metadata?: Record<string, unknown>;
  }): Promise<DomainEvent<T>> {
    const db = getPrismaClient();
    const id = randomUUID();
    const occurredAt = new Date();

    await db.eventLog.create({
      data: {
        id,
        eventType: params.eventType,
        aggregateId: params.aggregateId,
        aggregateType: params.aggregateType,
        actorId: params.actorId,
        actorType: params.actorType,
        payload: params.payload as Record<string, unknown>,
        metadata: params.metadata ?? {},
        occurredAt,
      },
    });

    const event: DomainEvent<T> = {
      id,
      eventType: params.eventType,
      aggregateId: params.aggregateId,
      aggregateType: params.aggregateType,
      actorId: params.actorId,
      actorType: params.actorType,
      payload: params.payload,
      metadata: params.metadata,
      occurredAt,
    };

    // Notify wildcard and specific listeners (fire-and-forget, non-blocking)
    const notify = async () => {
      const handlers = [
        ...(this.listeners.get("*") ?? []),
        ...(this.listeners.get(params.eventType) ?? []),
      ];
      for (const handler of handlers) {
        try {
          await handler(event as DomainEvent<unknown>);
        } catch (err) {
          console.error(`[EventStore] Listener error for ${params.eventType}:`, err);
        }
      }
    };
    // do not await — listeners are background notifications
    void notify();

    return event;
  }

  /** Subscribe to a specific event type or "*" for all events */
  on<T = unknown>(
    eventType: KnownEventType | "*" | string,
    listener: EventListenerFn<T>,
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as EventListenerFn);

    return () => {
      this.listeners.get(eventType)?.delete(listener as EventListenerFn);
    };
  }

  /** Query events from the database */
  async query(params: {
    aggregateId?: string;
    aggregateType?: string;
    eventType?: string;
    fromDate?: Date;
    toDate?: Date;
    actorId?: string;
    limit?: number;
    offset?: number;
  }) {
    const db = getPrismaClient();
    const where: Record<string, unknown> = {};

    if (params.aggregateId) where["aggregateId"] = params.aggregateId;
    if (params.aggregateType) where["aggregateType"] = params.aggregateType;
    if (params.eventType) where["eventType"] = params.eventType;
    if (params.actorId) where["actorId"] = params.actorId;
    if (params.fromDate || params.toDate) {
      where["occurredAt"] = {
        ...(params.fromDate ? { gte: params.fromDate } : {}),
        ...(params.toDate ? { lte: params.toDate } : {}),
      };
    }

    const [items, total] = await Promise.all([
      db.eventLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        take: params.limit ?? 50,
        skip: params.offset ?? 0,
      }),
      db.eventLog.count({ where }),
    ]);

    return { items, total };
  }

  /** Replay all events for an aggregate (for audit/rebuild) */
  async replayAggregate(aggregateId: string, aggregateType: string) {
    const db = getPrismaClient();
    return db.eventLog.findMany({
      where: { aggregateId, aggregateType },
      orderBy: { occurredAt: "asc" },
    });
  }
}

// Singleton instance
export const eventStore = new EventStore();
