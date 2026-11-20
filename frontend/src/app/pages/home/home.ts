import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-home',
  imports: [TranslatePipe],
  template: `
    <section class="hero">
      <div class="container">
        <h1>{{ 'HOME.TITLE' | translate }}</h1>
        <p class="hero-sub">{{ 'HOME.SUBTITLE' | translate }}</p>
        <span class="api-status" [class.online]="api() === 'online'" [class.offline]="api() === 'offline'" role="status">
          {{ 'HOME.API_STATUS.' + api().toUpperCase() | translate }}
        </span>
      </div>
    </section>
  `,
  styles: `
    .hero { padding: 3.5rem 0 4rem; background: var(--hero-gradient); color: #fff; }
    h1 { margin: 0 0 0.5rem; font-size: clamp(1.7rem, 4vw, 2.6rem); }
    .hero-sub { margin: 0 0 1.5rem; font-size: 1.1rem; opacity: 0.92; }
    .api-status { display: inline-block; padding: 0.3rem 0.8rem; border-radius: 999px; background: rgba(255, 255, 255, 0.18); font-size: 0.85rem; }
    .api-status.online::before, .api-status.offline::before { content: '●  '; }
    .api-status.online::before { color: #7ee2a0; }
    .api-status.offline::before { color: #ffd2d2; }
  `,
})
export class HomePage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly api = signal<'checking' | 'online' | 'offline'>('checking');

  async ngOnInit(): Promise<void> {
    try {
      await firstValueFrom(this.http.get('/api/health'));
      this.api.set('online');
    } catch {
      this.api.set('offline');
    }
  }
}
