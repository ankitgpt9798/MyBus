import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AppNotification } from './models';
import { PushService } from './push.service';
import { ToastService } from './toast.service';

/** Fallback polling interval while the live stream is not connected. */
const POLL_MS = 30_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 20_000;
const LATEST_LIMIT = 6;

/**
 * Unread count + latest notifications for the header bell.
 * While signed in, a Server-Sent Events stream delivers new notifications live (count, panel and a toast)
 * and keeps tabs in sync. If the stream drops it reconnects with backoff, and the count is polled meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly push = inject(PushService);

  readonly unread = signal(0);
  readonly latest = signal<AppNotification[]>([]);
  readonly loading = signal(false);
  /** True while the live stream is connected. */
  readonly live = signal(false);
  /** Live stream events for pages that keep their own list (the history page). */
  readonly events = new Subject<{ kind: 'notification'; notification: AppNotification } | { kind: 'unread'; unread: number }>();

  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private heartbeatMs = 15_000;
  private reconnectDelay = RECONNECT_MIN_MS;
  private generation = 0;

  constructor() {
    effect(() => {
      const signedIn = this.auth.isLoggedIn();
      untracked(() => {
        if (signedIn) {
          void this.refreshCount();
          void this.connect();
        } else {
          this.disconnect();
          this.unread.set(0);
          this.latest.set([]);
        }
        void this.push.refresh(signedIn);
      });
    });
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (!this.live()) void this.refreshCount();
      });
    const poll = setInterval(() => {
      if (!this.live()) void this.refreshCount();
    }, POLL_MS);
    const online = () => this.reconnectNow();
    // A page kept in the back/forward cache would otherwise hold its stream (and an HTTP/1.1 connection slot) open.
    const pageHide = () => this.disconnect();
    const pageShow = (e: PageTransitionEvent) => {
      if (e.persisted) this.reconnectNow();
    };
    window.addEventListener('online', online);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(poll);
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      this.disconnect();
    });
  }

  async refreshCount(): Promise<void> {
    if (!this.auth.isLoggedIn()) return;
    try {
      this.unread.set((await this.api.unreadCount()).unread);
    } catch {
      /* keep the last known count */
    }
  }

  async loadLatest(limit = LATEST_LIMIT): Promise<void> {
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
    this.markAllLocal();
  }

  // ---------- live stream

  private async connect(): Promise<void> {
    this.disconnect();
    if (typeof EventSource === 'undefined') return; // polling only
    const gen = this.generation;
    try {
      // EventSource can't send headers: exchange the session for a short-lived stream token.
      const { token } = await this.api.notificationStreamToken();
      if (gen !== this.generation || !this.auth.isLoggedIn()) return;
      const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
      this.source = es;
      // The token is only valid for a minute, so instead of letting EventSource retry with the same URL
      // we close it and reconnect with a fresh token.
      const drop = () => {
        if (this.source !== es) return;
        es.close();
        this.source = null;
        this.live.set(false);
        this.clearWatchdog();
        this.scheduleReconnect();
      };
      // Any event proves the connection is alive; silence for ~2.5 heartbeats means it is dead
      // (e.g. a proxy kept the browser's side open after the API restarted).
      const alive = () => {
        this.clearWatchdog();
        this.watchdog = setTimeout(drop, Math.max(5_000, this.heartbeatMs * 2.5));
      };
      es.addEventListener('ready', (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as { unread: number; heartbeatMs?: number };
        if (data.heartbeatMs) this.heartbeatMs = data.heartbeatMs;
        this.live.set(true);
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.unread.set(data.unread);
        alive();
      });
      es.addEventListener('ping', alive);
      es.addEventListener('notification', (e) => {
        alive();
        this.onNotification(JSON.parse((e as MessageEvent<string>).data));
      });
      es.addEventListener('unread', (e) => {
        alive();
        const { unread } = JSON.parse((e as MessageEvent<string>).data) as { unread: number };
        this.unread.set(unread);
        if (unread === 0) this.markAllLocal();
        this.events.next({ kind: 'unread', unread });
      });
      es.onerror = drop;
    } catch {
      if (gen === this.generation) this.scheduleReconnect();
    }
  }

  private onNotification({ notification, unread }: { notification: AppNotification; unread: number }): void {
    this.unread.set(unread);
    if (!this.latest().some((x) => x.id === notification.id)) {
      this.latest.update((list) => [notification, ...list].slice(0, LATEST_LIMIT));
    }
    this.toast.notification(notification);
    this.events.next({ kind: 'notification', notification });
  }

  private scheduleReconnect(): void {
    if (!this.auth.isLoggedIn() || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.refreshCount();
      void this.connect();
    }, delay);
  }

  private reconnectNow(): void {
    if (!this.auth.isLoggedIn() || this.live()) return;
    this.reconnectDelay = RECONNECT_MIN_MS;
    void this.connect();
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private disconnect(): void {
    this.generation++;
    this.clearWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
    this.live.set(false);
  }

  private markAllLocal(): void {
    this.unread.set(0);
    this.latest.update((list) => list.map((x) => (x.read ? x : { ...x, read: true })));
  }
}
