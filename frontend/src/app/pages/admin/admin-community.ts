import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AdminCommunityItem, ContentRemoveReason } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

type Filter = 'reported' | 'hidden' | 'removed' | 'all';
type ContentType = 'post' | 'comment';
type Action = 'hide' | 'remove' | 'restore';
const STATUS_BADGE = { visible: 'badge-success', hidden: 'badge-warning', removed: 'badge-danger' } as const;
const ACTION_KEYS: Record<Action, { title: string; button: string; done: string; effect: string }> = {
  hide: { title: 'ADMIN.COMMUNITY.CONFIRM_HIDE', button: 'ADMIN.REVIEWS.HIDE', done: 'ADMIN.COMMUNITY.DONE_HIDE', effect: 'ADMIN.COMMUNITY.EFFECT_HIDE' },
  remove: { title: 'ADMIN.COMMUNITY.CONFIRM_REMOVE', button: 'ADMIN.REVIEWS.REMOVE', done: 'ADMIN.COMMUNITY.DONE_REMOVE', effect: 'ADMIN.COMMUNITY.EFFECT_REMOVE' },
  restore: { title: 'ADMIN.COMMUNITY.CONFIRM_RESTORE', button: 'ADMIN.REVIEWS.RESTORE', done: 'ADMIN.COMMUNITY.DONE_RESTORE', effect: 'ADMIN.COMMUNITY.EFFECT_RESTORE' },
};

/** Community moderation: reported / hidden / removed posts and comments, with hide, remove (reason) and restore. */
@Component({
  selector: 'app-admin-community',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, Dialog, AppDatePipe, CityPipe, NumPipe, TranslateOrPipe, PluralPipe],
  template: `
    <div class="card filter-bar">
      <div class="chips" role="group" [attr.aria-label]="'ADMIN.REVIEWS.FILTER' | translate">
        @for (f of filters; track f) {
          <button type="button" class="chip" [class.active]="filter() === f" [attr.aria-pressed]="filter() === f" [attr.data-filter]="f" (click)="setFilter(f)">
            {{ 'ADMIN.REVIEWS.FILTERS.' + f | translate }}
          </button>
        }
      </div>
      <div class="chips" role="group" [attr.aria-label]="'ADMIN.COMMUNITY.TYPE' | translate">
        @for (t of types; track t) {
          <button type="button" class="chip" [class.active]="type() === t" [attr.aria-pressed]="type() === t" [attr.data-type]="t" (click)="setType(t)">
            {{ 'ADMIN.COMMUNITY.TYPES.' + t | translate }}
          </button>
        }
      </div>
    </div>

    @if (error(); as e) {
      <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
    }
    <p class="muted small found">{{ 'ADMIN.COMMUNITY.FOUND' | plural: total() : { count: (total() | num) } }}</p>
    <div class="cards" [class.dim]="loading()">
      @for (it of items(); track it.id) {
        <article class="card item" [attr.data-item]="it.id" [attr.data-status]="it.status">
          <div class="it-head">
            <span [class]="'badge ' + statusBadge(it.status)">{{ 'COMMUNITY.STATUS.' + it.status | translate }}</span>
            @if (it.reportCount) {
              <span class="badge badge-danger report-count">{{ 'ADMIN.REVIEWS.REPORTS' | plural: it.reportCount : { count: (it.reportCount | num) } }}</span>
            }
            @if (it.board) {
              <span class="badge">{{ 'COMMUNITY.BOARDS.' + it.board + '.NAME' | translate }}</span>
            }
            <span class="muted small">{{ 'COMMUNITY.LIKES' | plural: it.likeCount : { count: (it.likeCount | num) } }}</span>
          </div>
          @if (it.type === 'post') {
            <h3 class="it-title"><a [routerLink]="['/community/posts', it.id]">{{ it.title }}</a></h3>
          } @else if (it.post; as post) {
            <p class="it-context small">
              {{ (it.reply ? 'USER.REPLIED_ON' : 'USER.COMMENTED_ON') | translate }}
              <a [routerLink]="['/community/posts', post.id]" fragment="comments">{{ post.title }}</a>
            </p>
          }
          <p class="it-text">{{ it.text }}</p>
          <p class="it-meta small muted">
            @if (it.author; as a) {
              <a [routerLink]="['/users', a.id]">{{ a.name }}</a><span class="email">&nbsp;({{ a.email }})</span> ·
            }
            @if (it.route; as route) {
              {{ route.from | city }} → {{ route.to | city }} ·
            }
            {{ it.createdAt | appDate: 'datetime' }}
          </p>
          @if (it.reports.length) {
            <details class="reports" [open]="it.status !== 'removed'">
              <summary>{{ 'ADMIN.REVIEWS.REPORT_LIST' | translate }}</summary>
              <ul>
                @for (rep of it.reports; track $index) {
                  <li>
                    <strong>{{ 'COMMUNITY.REPORT_REASONS.' + rep.reason | translate }}</strong>
                    @if (rep.note) {
                      – “{{ rep.note }}”
                    }
                    <span class="muted small rep-meta">· {{ rep.user ?? '—' }} · {{ rep.createdAt | appDate: 'datetime' }}</span>
                  </li>
                }
              </ul>
            </details>
          }
          @if (it.moderation; as m) {
            <p class="moderation small">
              @if (m.auto) {
                {{ 'ADMIN.REVIEWS.AUTO_HIDDEN' | translate: { date: (m.at | appDate: 'datetime') } }}
              } @else {
                {{ (it.status === 'removed' ? 'ADMIN.REVIEWS.REMOVED_BY' : 'ADMIN.REVIEWS.HIDDEN_BY') | translate: { name: m.by ?? '—', date: (m.at | appDate: 'datetime') } }}
                @if (it.status === 'removed') {
                  · {{ 'COMMUNITY.REMOVE_REASONS.' + m.reason | translate }}
                }
              }
              @if (m.note) {
                – “{{ m.note }}”
              }
            </p>
          }
          <div class="it-actions">
            @if (it.status === 'visible') {
              <button type="button" class="btn btn-sm btn-outline hide-btn" (click)="open(it, 'hide')">{{ 'ADMIN.REVIEWS.HIDE' | translate }}</button>
            } @else {
              <button type="button" class="btn btn-sm btn-primary restore-btn" (click)="open(it, 'restore')">{{ 'ADMIN.REVIEWS.RESTORE' | translate }}</button>
            }
            @if (it.status !== 'removed') {
              <button type="button" class="btn btn-sm btn-danger-outline remove-btn" (click)="open(it, 'remove')">{{ 'ADMIN.REVIEWS.REMOVE' | translate }}</button>
            }
          </div>
        </article>
      } @empty {
        @if (!loading()) {
          <p class="card empty-row">{{ 'ADMIN.COMMUNITY.NONE' | translate }}</p>
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
            @if (a.item.title) {
              <strong>{{ a.item.title }}</strong>
            }
            <span>{{ a.item.text }}</span>
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
                    <option [value]="reason">{{ 'COMMUNITY.REMOVE_REASONS.' + reason | translate }}</option>
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
          <p class="muted small">{{ keys[a.action].effect | translate }}</p>
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
    .filter-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .found { margin: 0.75rem 0; }
    .cards { display: grid; gap: 0.75rem; &.dim { opacity: 0.6; } }
    .it-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; }
    .it-title { margin: 0.5rem 0 0; font-size: 1.02rem; overflow-wrap: anywhere; }
    .it-context { margin: 0.5rem 0 0; overflow-wrap: anywhere; }
    .it-text { margin: 0.4rem 0; white-space: pre-line; overflow-wrap: anywhere; }
    .it-meta { margin: 0 0 0.5rem; overflow-wrap: anywhere; }
    .reports { margin: 0 0 0.5rem; font-size: 0.9rem; summary { cursor: pointer; font-weight: 600; } ul { margin: 0.35rem 0 0; padding-left: 1.1rem; } li { overflow-wrap: anywhere; } }
    .moderation { margin: 0 0 0.5rem; padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); background: var(--color-warning-soft); color: var(--color-warning); overflow-wrap: anywhere; }
    .rep-meta { margin-left: 0.3rem; }
    .it-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .quote { display: grid; gap: 0.25rem; margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-left: 3px solid var(--color-border); font-size: 0.9rem; overflow-wrap: anywhere; max-height: 9em; overflow: hidden; }
    .dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.5rem; }
    .clear-reports { font-weight: 600; }
    .pager { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-top: 1rem; }
  `,
})
export class AdminCommunityPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly filters: Filter[] = ['reported', 'hidden', 'removed', 'all'];
  protected readonly types: ContentType[] = ['post', 'comment'];
  protected readonly keys = ACTION_KEYS;
  protected readonly removeReasons: ContentRemoveReason[] = ['spam', 'offensive', 'irrelevant', 'misleading', 'personal_info', 'other'];

  protected readonly filter = signal<Filter>('reported');
  protected readonly type = signal<ContentType>('post');
  protected readonly items = signal<AdminCommunityItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = 10;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly acting = signal<{ item: AdminCommunityItem; action: Action } | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly actionForm = inject(FormBuilder).nonNullable.group({
    reason: ['' as ContentRemoveReason | ''],
    note: ['', Validators.maxLength(300)],
    clearReports: [true],
  });

  ngOnInit(): void {
    void this.load(1);
  }

  protected statusBadge(status: AdminCommunityItem['status']): string {
    return STATUS_BADGE[status];
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
    void this.load(1);
  }

  protected setType(t: ContentType): void {
    this.type.set(t);
    void this.load(1);
  }

  protected async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.adminCommunity({ filter: this.filter(), type: this.type(), page, limit: this.limit });
      this.items.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(item: AdminCommunityItem, action: Action): void {
    // Restore clears the reports by default: the admin has judged them unfounded.
    this.actionForm.reset({ reason: '', note: '', clearReports: true });
    this.actionForm.controls.reason.setValidators(action === 'remove' ? Validators.required : null);
    this.actionForm.controls.reason.updateValueAndValidity();
    this.actionError.set(null);
    this.acting.set({ item, action });
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
      const { type, id } = a.item;
      if (a.action === 'hide') await this.api.adminHideContent(type, id, note.trim() || undefined);
      else if (a.action === 'remove') await this.api.adminRemoveContent(type, id, reason as ContentRemoveReason, note.trim() || undefined);
      else await this.api.adminRestoreContent(type, id, clearReports);
      this.acting.set(null);
      this.toast.success(ACTION_KEYS[a.action].done);
      await this.load(this.page());
    } catch (err) {
      this.actionError.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }
}
