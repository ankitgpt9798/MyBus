import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AppNotification } from './models';

const POLL_MS = 60_000;

/**
 * Unread count + latest notifications for the header bell.
 * Refreshes on login, on every navigation and once a minute while signed in.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly unread = signal(0);
  readonly latest = signal<AppNotification[]>([]);
  readonly loading = signal(false);

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) void this.refreshCount();
      else {
        this.unread.set(0);
        this.latest.set([]);
      }
    });
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => void this.refreshCount());
    const timer = setInterval(() => void this.refreshCount(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async refreshCount(): Promise<void> {
    if (!this.auth.isLoggedIn()) return;
    try {
      this.unread.set((await this.api.unreadCount()).unread);
    } catch {
      /* keep the last known count */
    }
  }

  async loadLatest(limit = 6): Promise<void> {
    if (!this.auth.isLoggedIn()) return;
    this.loading.set(true);
    try {
      const res = await this.api.notifications(1, limit);
      this.latest.set(res.notifications);
      this.unread.set(res.unread);
    } catch {
      /* the panel shows what it has */
    } finally {
      this.loading.set(false);
    }
  }

  async markRead(n: AppNotification): Promise<void> {
    if (n.read) return;
    const { unread } = await this.api.markNotificationRead(n.id);
    this.unread.set(unread);
    this.latest.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
  }

  async markAllRead(): Promise<void> {
    await this.api.markAllNotificationsRead();
    this.unread.set(0);
    this.latest.update((list) => list.map((x) => ({ ...x, read: true })));
  }
}
