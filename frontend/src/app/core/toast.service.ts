import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  key: string; // translation key
  params?: Record<string, unknown>;
  kind: 'success' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  show(key: string, kind: Toast['kind'] = 'info', params?: Record<string, unknown>): void {
    const toast = { id: this.nextId++, key, kind, params };
    this.toasts.update((list) => [...list, toast]);
    setTimeout(() => this.dismiss(toast.id), 4500);
  }

  success(key: string, params?: Record<string, unknown>) {
    this.show(key, 'success', params);
  }

  error(key: string, params?: Record<string, unknown>) {
    this.show(key, 'error', params);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
