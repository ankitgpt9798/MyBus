import { EventEmitter } from 'node:events';

/**
 * Domain events emitted by the booking/admin modules.
 * The notification system subscribes to these (booking confirmed/cancelled, trip rescheduled/cancelled)
 * instead of being called directly, so booking code never waits on email or push delivery.
 */
export interface AppEvents {
  'user.registered': { userId: string };
  'booking.confirmed': { bookingId: string };
  'booking.cancelled': { bookingId: string; by: 'user' | 'admin' | 'system' };
  'trip.rescheduled': {
    tripId: string;
    oldDepartureTime: Date;
    newDepartureTime: Date;
    oldArrivalTime: Date;
    newArrivalTime: Date;
  };
  'trip.cancelled': { tripId: string };
}

type Listener<K extends keyof AppEvents> = (payload: AppEvents[K]) => void | Promise<void>;

class AppEventBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof AppEvents>(event: K, listener: Listener<K>): void {
    this.emitter.on(event, (payload: AppEvents[K]) => {
      Promise.resolve()
        .then(() => listener(payload))
        .catch((err) => console.error(`[events] ${event} listener failed`, err));
    });
  }
}

export const appEvents = new AppEventBus();
