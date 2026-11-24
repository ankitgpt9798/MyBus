import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AdminReview, RemoveReason } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { Stars } from '../../shared/stars';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

type Filter = 'reported' | 'hidden' | 'removed' | 'all';
type Action = 'hide' | 'remove' | 'restore';
const STATUS_BADGE = { visible: 'badge-success', hidden: 'badge-warning', removed: 'badge-danger' } as const;
const ACTION_KEYS: Record<Action, { title: string; button: string; done: string }> = {
  hide: { title: 'ADMIN.REVIEWS.CONFIRM_HIDE', button: 'ADMIN.REVIEWS.HIDE', done: 'ADMIN.REVIEWS.DONE_HIDE' },
  remove: { title: 'ADMIN.REVIEWS.CONFIRM_REMOVE', button: 'ADMIN.REVIEWS.REMOVE', done: 'ADMIN.REVIEWS.DONE_REMOVE' },
  restore: { title: 'ADMIN.REVIEWS.CONFIRM_RESTORE', button: 'ADMIN.REVIEWS.RESTORE', done: 'ADMIN.REVIEWS.DONE_RESTORE' },
};

/** Review moderation: reported / hidden / removed reviews with hide, remove (reason) and restore actions. */
@Component({
  selector: 'app-admin-reviews',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, Dialog, Stars, AppDatePipe, CityPipe, NumPipe, TranslateOrPipe],
  template: `
    <div class="card filter-bar">
      <div class="chips" role="group" [attr.aria-label]="'ADMIN.REVIEWS.FILTER' | translate">
        @for (f of filters; track f) {
          <button type="button" class="chip" [class.active]="filter() === f" [attr.aria-pressed]="filter() === f" [attr.data-filter]="f" (click)="setFilter(f)">
            {{ 'ADMIN.REVIEWS.FILTERS.' + f | translate }}
          </button>
        }
      </div>
      <div class="form-field route-filter">
        <label for="rv-route">{{ 'ADMIN.ROUTE' | translate }}</label>
        <select id="rv-route" [value]="routeId()" (change)="setRoute($any($event.target).value)">
          <option value="">{{ 'ADMIN.ALL_ROUTES' | translate }}</option>
          @for (r of routes(); track r.id) {
            <option [value]="r.id">{{ r.from | city }} → {{ r.to | city }}</option>
          }
        </select>
      </div>
    </div>

    @if (error(); as e) {
      <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
    }
    <p class="muted small found">{{ 'ADMIN.REVIEWS.FOUND' | translate: { count: (total() | num) } }}</p>
    <div class="review-cards" [class.dim]="loading()">
      @for (r of items(); track r.id) {
        <article class="card review-card" [attr.data-review]="r.id" [attr.data-status]="r.status">
          <div class="rc-head">
            <app-stars [value]="r.rating" />
            <span [class]="'badge ' + statusBadge(r.status)">{{ 'REVIEWS.STATUS.' + r.status | translate }}</span>
            @if (r.reportCount) {
              <span class="badge badge-danger report-count">{{ 'ADMIN.REVIEWS.REPORTS' | translate: { count: (r.reportCount | num) } }}</span>
            }
            <span class="muted small">{{ 'REVIEWS.HELPFUL_COUNT' | translate: { count: (r.helpfulCount | num) } }}</span>
          </div>
          <p class="rc-text">{{ r.text }}</p>
          <p class="rc-meta small muted">
            {{ r.user?.name }} <span class="email">({{ r.user?.email }})</span> ·
            @if (r.route; as route) {
              <a [routerLink]="['/routes', route.id]" fragment="reviews">{{ route.from | city }} → {{ route.to | city }}</a> ·
            }
            {{ r.createdAt | appDate: 'datetime' }}
            @if (r.editedAt) {
              · {{ 'REVIEWS.EDITED' | translate }}
            }
          </p>
          @if (r.reports.length) {
            <details class="reports" [open]="r.status !== 'removed'">
              <summary>{{ 'ADMIN.REVIEWS.REPORT_LIST' | translate }}</summary>
              <ul>
                @for (rep of r.reports; track $index) {
                  <li>
                    <strong>{{ 'REVIEWS.REASONS.' + rep.reason | translate }}</strong>
                    @if (rep.note) {
                      – “{{ rep.note }}”
                    }
                    <span class="muted small rep-meta">· {{ rep.user ?? '—' }} · {{ rep.createdAt | appDate: 'datetime' }}</span>
                  </li>
                }
              </ul>
            </details>
          }
          @if (r.moderation; as m) {
            <p class="moderation small">
              @if (m.auto) {
                {{ 'ADMIN.REVIEWS.AUTO_HIDDEN' | translate: { date: (m.at | appDate: 'datetime') } }}
              } @else {
                {{ (r.status === 'removed' ? 'ADMIN.REVIEWS.REMOVED_BY' : 'ADMIN.REVIEWS.HIDDEN_BY') | translate: { name: m.by ?? '—', date: (m.at | appDate: 'datetime') } }}
                @if (r.status === 'removed') {
                  · {{ 'REVIEWS.REMOVE_REASONS.' + m.reason | translate }}
                }
              }
              @if (m.note) {
                – “{{ m.note }}”
              }
            </p>
          }
          <div class="rc-actions">
            @if (r.status === 'visible') {
              <button type="button" class="btn btn-sm btn-outline hide-btn" (click)="open(r, 'hide')">{{ 'ADMIN.REVIEWS.HIDE' | translate }}</button>
            } @else {
              <button type="button" class="btn btn-sm btn-primary restore-btn" (click)="open(r, 'restore')">{{ 'ADMIN.REVIEWS.RESTORE' | translate }}</button>
            }
            @if (r.status !== 'removed') {
              <button type="button" class="btn btn-sm btn-danger-outline remove-btn" (click)="open(r, 'remove')">{{ 'ADMIN.REVIEWS.REMOVE' | translate }}</button>
            }
          </div>
        </article>
      } @empty {
        @if (!loading()) {
          <p class="card empty-row">{{ 'ADMIN.REVIEWS.NONE' | translate }}</p>
        }
      }
    </div>
    @if (pages() > 1) {
      <div class="pager">
        <button type="button" class="btn btn-sm btn-outline" [disabled]="page() <= 1" (click)="load(page() - 1)">{{ 'ADMIN.PREV' | translate }}</button>
        <span class="small">{{ 'ADMIN.PAGE_OF' | translate: { page: page(), pages: pages() } }}</span>
        <button type="button" class="btn btn-sm btn-outline" [disabled]="page() >= pages()" (click)="load(page() + 1)">{{ 'ADMIN.NEXT' | translate }}</button>
      </div>
    }

    @if (acting(); as a) {
      <app-dialog [title]="keys[a.action].title | translate" (closed)="acting.set(null)">
        <form [formGroup]="actionForm" (ngSubmit)="confirm()" class="action-form" novalidate>
          <blockquote class="quote">
            <app-stars [value]="a.review.rating" [size]="14" />
            <span>{{ a.review.text }}</span>
          </blockquote>
          @if (actionError(); as e) {
            <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
          }
          @switch (a.action) {
            @case ('remove') {
              <div class="form-field">
                <label for="rm-reason">{{ 'ADMIN.REVIEWS.REMOVE_REASON' | translate }}</label>
                <select id="rm-reason" formControlName="reason">
                  <option value="">{{ 'ADMIN.REVIEWS.PICK_REASON' | translate }}</option>
                  @for (reason of removeReasons; track reason) {
                    <option [value]="reason">{{ 'REVIEWS.REMOVE_REASONS.' + reason | translate }}</option>
                  }
                </select>
                @if (actionForm.controls.reason.invalid && actionForm.controls.reason.touched) {
                  <p class="field-error" role="alert">{{ 'ADMIN.REVIEWS.PICK_REASON' | translate }}</p>
                }
              </div>
            }
            @case ('restore') {
              <label class="check clear-reports">
                <input type="checkbox" formControlName="clearReports" />
                {{ 'ADMIN.REVIEWS.CLEAR_REPORTS' | translate }}
              </label>
              <p class="muted small">{{ 'ADMIN.REVIEWS.CLEAR_REPORTS_HINT' | translate }}</p>
            }
          }
          @if (a.action !== 'restore') {
            <div class="form-field">
              <label for="act-note">{{ 'ADMIN.REVIEWS.NOTE' | translate }}</label>
              <textarea id="act-note" formControlName="note" rows="2" maxlength="300"></textarea>
            </div>
          }
          <p class="muted small">{{ 'ADMIN.REVIEWS.AVERAGE_NOTE' | translate }}</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" (click)="acting.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
            <button type="submit" class="btn confirm-action" [class.btn-danger]="a.action === 'remove'" [class.btn-primary]="a.action !== 'remove'" [disabled]="saving()">
              {{ keys[a.action].button | translate }}
            </button>
          </div>
        </form>
      </app-dialog>
    }
  `,
  styleUrl: './admin.scss',
  styles: `
    .filter-bar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .route-filter { margin: 0; min-width: 220px; }
    .found { margin: 0.75rem 0; }
    .review-cards { display: grid; gap: 0.75rem; &.dim { opacity: 0.6; } }
    .rc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; }
    .rc-text { margin: 0.5rem 0; white-space: pre-line; overflow-wrap: anywhere; }
    .rc-meta { margin: 0 0 0.5rem; overflow-wrap: anywhere; }
    .reports { margin: 0 0 0.5rem; font-size: 0.9rem; summary { cursor: pointer; font-weight: 600; } ul { margin: 0.35rem 0 0; padding-left: 1.1rem; } li { overflow-wrap: anywhere; } }
    .moderation { margin: 0 0 0.5rem; padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); background: var(--color-warning-soft); color: var(--color-warning); overflow-wrap: anywhere; }
    .rep-meta { margin-left: 0.3rem; }
    .rc-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .quote { display: grid; gap: 0.25rem; margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-left: 3px solid var(--color-border); font-size: 0.9rem; overflow-wrap: anywhere; }
    .dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.5rem; }
    .clear-reports { font-weight: 600; }
    .pager { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-top: 1rem; }
  `,
})
export class AdminReviewsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly filters: Filter[] = ['reported', 'hidden', 'removed', 'all'];
  protected readonly keys = ACTION_KEYS;
  protected readonly removeReasons: RemoveReason[] = ['spam', 'offensive', 'irrelevant', 'fake', 'personal_info', 'other'];

  protected readonly filter = signal<Filter>('reported');
  protected readonly routeId = signal('');
  protected readonly routes = signal<{ id: string; from: string; to: string }[]>([]);
  protected readonly items = signal<AdminReview[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = 10;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly acting = signal<{ review: AdminReview; action: Action } | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly actionForm = inject(FormBuilder).nonNullable.group({
    reason: ['' as RemoveReason | ''],
    note: ['', Validators.maxLength(300)],
    clearReports: [true],
  });

  ngOnInit(): void {
    void this.api.adminRoutes().then((r) => this.routes.set(r.routes)).catch(() => undefined);
    void this.load(1);
  }

  protected statusBadge(status: AdminReview['status']): string {
    return STATUS_BADGE[status];
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
    void this.load(1);
  }

  protected setRoute(id: string): void {
    this.routeId.set(id);
    void this.load(1);
  }

  protected async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.adminReviews({ filter: this.filter(), routeId: this.routeId(), page, limit: this.limit });
      this.items.set(res.reviews);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(review: AdminReview, action: Action): void {
    // Restore clears the reports by default: the admin has judged them unfounded.
    this.actionForm.reset({ reason: '', note: '', clearReports: true });
    this.actionForm.controls.reason.setValidators(action === 'remove' ? Validators.required : null);
    this.actionForm.controls.reason.updateValueAndValidity();
    this.actionError.set(null);
    this.acting.set({ review, action });
  }

  protected async confirm(): Promise<void> {
    const a = this.acting();
    if (!a) return;
    if (this.actionForm.invalid) {
      this.actionForm.markAllAsTouched();
      return;
    }
    const { reason, note, clearReports } = this.actionForm.getRawValue();
    this.saving.set(true);
    this.actionError.set(null);
    try {
      const res =
        a.action === 'hide'
          ? await this.api.adminHideReview(a.review.id, note.trim() || undefined)
          : a.action === 'remove'
            ? await this.api.adminRemoveReview(a.review.id, reason as RemoveReason, note.trim() || undefined)
            : await this.api.adminRestoreReview(a.review.id, clearReports);
      this.acting.set(null);
      this.toast.success(ACTION_KEYS[a.action].done, { avg: res.summary.avg.toFixed(1), count: res.summary.count });
      await this.load(this.page());
    } catch (err) {
      this.actionError.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }
}
