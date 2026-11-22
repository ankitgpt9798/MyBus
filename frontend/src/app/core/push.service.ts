import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/** unsupported: browser can't do push · denied: user blocked notifications · off/on: this browser's subscription. */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'busy';

const SW_URL = '/push-sw.js';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Web Push for this browser: permission, service worker, subscription and server registration.
 * Permission is only ever requested from a user click (enable()).
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(ApiService);
  readonly state = signal<PushState>('off');
  /** Translation key of the last problem, if any. */
  readonly message = signal<string | null>(null);

  get supported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  private async currentSubscription(): Promise<PushSubscription | null> {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription()) ?? null;
  }

  /** Reads the current state. When signed in, an existing browser subscription is (re)linked to this account. */
  async refresh(signedIn: boolean): Promise<void> {
    if (!this.supported) return this.state.set('unsupported');
    if (Notification.permission === 'denied') return this.state.set('denied');
    try {
      const sub = await this.currentSubscription();
      if (sub && signedIn) {
        await this.api.pushSubscribe(sub.toJSON());
        this.state.set('on');
      } else {
        this.state.set('off');
      }
    } catch {
      this.state.set('off');
    }
  }

  /** Must be called from a user gesture: asks for permission, subscribes and registers with the server. */
  async enable(): Promise<boolean> {
    if (!this.supported) {
      this.state.set('unsupported');
      return false;
    }
    this.message.set(null);
    this.state.set('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.state.set(permission === 'denied' ? 'denied' : 'off');
        if (permission !== 'denied') this.message.set('NOTIFY.PUSH.DISMISSED');
        return false;
      }
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      await navigator.serviceWorker.ready;
      const { publicKey } = await this.api.pushPublicKey();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await this.api.pushSubscribe(sub.toJSON(), true);
      this.state.set('on');
      return true;
    } catch {
      this.message.set('NOTIFY.PUSH.ERROR');
      this.state.set(Notification.permission === 'denied' ? 'denied' : 'off');
      return false;
    }
  }

  /** Turns push off for this browser (server first, while still signed in). */
  async disable(): Promise<void> {
    if (!this.supported) return;
    this.message.set(null);
    this.state.set('busy');
    try {
      const sub = await this.currentSubscription();
      if (sub) {
        await this.api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
    } finally {
      this.state.set(Notification.permission === 'denied' ? 'denied' : 'off');
    }
  }
}
