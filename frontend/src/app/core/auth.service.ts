import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthResponse, User } from './models';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(readStorage(STORAGE_KEYS.token));
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => !!this.user());
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly isVerified = computed(() => !!this.user()?.emailVerified);

  /** Called once at startup: restores the session from a stored token. */
  async restore(): Promise<void> {
    if (!this.token()) return;
    try {
      const { user } = await firstValueFrom(this.http.get<{ user: User }>('/api/users/me'));
      this.user.set(user);
    } catch {
      this.clearSession();
    }
  }

  async login(email: string, password: string): Promise<User> {
    const res = await firstValueFrom(this.http.post<AuthResponse>('/api/auth/login', { email, password }));
    this.setSession(res.token, res.user);
    return res.user;
  }

  async register(data: { name: string; email: string; password: string }): Promise<User> {
    const res = await firstValueFrom(this.http.post<AuthResponse>('/api/auth/register', data));
    this.setSession(res.token, res.user);
    return res.user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      /* token may already be invalid — the local session is cleared either way */
    }
    this.clearSession();
    await this.router.navigateByUrl('/');
  }

  /** Consumes the emailed verification token. Updates the session if the verified account is the one logged in. */
  async verifyEmail(token: string): Promise<User> {
    const { user } = await firstValueFrom(this.http.post<{ user: User }>('/api/auth/verify-email', { token }));
    if (this.user()?.id === user.id) this.user.set(user);
    return user;
  }

  async resendVerification(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/resend-verification', {}));
  }

  async updateProfile(patch: Partial<Pick<User, 'name' | 'phone'>>): Promise<User> {
    const { user } = await firstValueFrom(this.http.patch<{ user: User }>('/api/users/me', patch));
    this.user.set(user);
    return user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/users/me/password', { currentPassword, newPassword }));
  }

  clearSession(): void {
    this.token.set(null);
    this.user.set(null);
    writeStorage(STORAGE_KEYS.token, null);
  }

  private setSession(token: string, user: User): void {
    this.token.set(token);
    writeStorage(STORAGE_KEYS.token, token);
    this.user.set(user);
  }
}
