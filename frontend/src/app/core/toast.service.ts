import { Injectable, signal } from '@angular/core';
import { AppNotification } from './models';

export interface Toast {
  id: number;
  key: string; // translation key
  params?: Record<string, unknown>;
  kind: 'success' | 'error' | 'info';
  /** A live notification, rendered in the current UI language instead of `key`. */
  notification?: AppNotification;
  /** Picks the singular/plural variant of `key` (see PluralPipe). */
  count?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  show(key: string, kind: Toast['kind'] = 'info', params?: Record<string, unknown>, extra: Partial<Toast> = {}, ms = 4500): void {
    const toast = { id: this.nextId++, key, kind, params, ...extra };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    setTimeout(() => this.dismiss(toast.id), ms);
  }

  success(key: string, params?: Record<string, unknown>, count?: number) {
    this.show(key, 'success', params, { count });
  }

  error(key: string, params?: Record<string, unknown>, count?: number) {
    this.show(key, 'error', params, { count });
  }

  /** A notification that just arrived on the live stream. */
  notification(n: AppNotification) {
    this.show('NOTIFY.NEW', 'info', undefined, { notification: n }, 7000);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
