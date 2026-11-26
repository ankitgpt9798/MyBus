import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { SavedRoute } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { FieldError } from '../../shared/field-error';
import { Icon } from '../../shared/icons';
import { AppDatePipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

export const SAVED_NAME_MAX = 60;

/** The signed-in user's saved routes: one click plans it again; rename and delete in place. */
@Component({
  selector: 'app-saved-routes',
  imports: [ReactiveFormsModule, TranslatePipe, Dialog, FieldError, Icon, AppDatePipe, NumPipe, PluralPipe, TranslateOrPipe],
  template: `
    <section class="card saved" aria-labelledby="saved-title">
      <div class="saved-head">
        <h2 class="sub-title" id="saved-title"><app-icon name="star" [size]="16" /> {{ 'PLANNER.SAVED_TITLE' | translate }}</h2>
        @if (list().length > 1) {
          <label class="sr-only" for="saved-sort">{{ 'PLANNER.SAVED_SORT' | translate }}</label>
          <select id="saved-sort" class="saved-sort" [value]="sort()" (change)="sort.set($any($event.target).value)">
            <option value="used">{{ 'PLANNER.SAVED_MOST_USED' | translate }}</option>
            <option value="recent">{{ 'PLANNER.SAVED_RECENT' | translate }}</option>
          </select>
        }
      </div>
      @if (error(); as e) {
        <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
      }
      <ul class="saved-list">
        @for (s of list(); track s.id) {
          <li class="saved-item" [attr.data-saved]="s.id">
            <button type="button" class="saved-load" (click)="load.emit(s)">
              <strong class="saved-name">{{ s.name }}</strong>
              <span class="small muted">
                {{ s.start.label }} → {{ s.end.label }}
                @if (s.waypoints.length) {
                  · {{ 'PLANNER.VIA_STOPS' | plural: s.waypoints.length : { count: s.waypoints.length } }}
                }
              </span>
              <span class="small muted saved-uses">
                {{ 'PLANNER.USED_TIMES' | plural: s.useCount : { count: (s.useCount | num) } }}
                @if (s.lastUsedAt) {
                  · {{ s.lastUsedAt | appDate: 'date' }}
                }
              </span>
            </button>
            <div class="saved-actions">
              <button type="button" class="icon-btn saved-rename" (click)="startRename(s)" [attr.aria-label]="'PLANNER.RENAME_ROUTE' | translate: { name: s.name }">
                <app-icon name="settings" [size]="15" />
              </button>
              <button type="button" class="icon-btn saved-delete" (click)="deleting.set(s)" [attr.aria-label]="'PLANNER.DELETE_ROUTE' | translate: { name: s.name }">
                <app-icon name="close" [size]="15" />
              </button>
            </div>
          </li>
        } @empty {
          @if (!loading()) {
            <li class="saved-empty small muted">{{ 'PLANNER.SAVED_EMPTY' | translate }}</li>
          }
        }
      </ul>
    </section>

    @if (renaming(); as r) {
      <app-dialog [title]="'PLANNER.RENAME_TITLE' | translate" (closed)="renaming.set(null)">
        <form (submit)="rename($event)" class="dialog-form" novalidate>
          <div class="form-field">
            <label for="saved-new-name">{{ 'PLANNER.ROUTE_NAME' | translate }}</label>
            <input id="saved-new-name" [formControl]="name" [attr.maxlength]="max" />
            <app-field-error [control]="name" [submitted]="submitted()" />
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" (click)="renaming.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
            <button type="submit" class="btn btn-primary confirm-rename" [disabled]="busy()">{{ 'PLANNER.SAVE_NAME' | translate }}</button>
          </div>
        </form>
      </app-dialog>
    }
    @if (deleting(); as d) {
      <app-dialog [title]="'PLANNER.DELETE_TITLE' | translate" (closed)="deleting.set(null)">
        <p>{{ 'PLANNER.DELETE_TEXT' | translate: { name: d.name } }}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" (click)="deleting.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
          <button type="button" class="btn btn-danger confirm-delete" [disabled]="busy()" (click)="remove(d)">{{ 'COMMUNITY.DELETE' | translate }}</button>
        </div>
      </app-dialog>
    }
  `,
  styles: `
    .saved { display: grid; gap: 0.5rem; }
    .saved-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; .sub-title { display: flex; align-items: center; gap: 0.35rem; margin: 0; } }
    .saved-sort { width: auto; min-height: 32px; padding: 0.2rem 0.5rem; font-size: 0.82rem; }
    .saved-list { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; }
    .saved-item { display: flex; align-items: center; gap: 0.35rem; }
    .saved-load {
      display: grid; gap: 0.05rem; flex: 1; min-width: 0; padding: 0.45rem 0.6rem; text-align: left; font: inherit; color: var(--color-text); cursor: pointer;
      background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      &:hover { border-color: var(--color-primary); }
      &:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
      span, strong { overflow-wrap: anywhere; }
    }
    .saved-actions { display: flex; gap: 0.1rem; .icon-btn { width: 32px; height: 32px; } }
    .saved-empty { padding: 0.25rem 0; }
    .dialog-form { display: grid; gap: 0.75rem; }
    .dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.5rem; }
  `,
})
export class SavedRoutesPanel {
  /** Bumped by the planner after a save or a load, so the list is fetched again. */
  readonly version = input(0);
  readonly load = output<SavedRoute>();

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly max = SAVED_NAME_MAX;
  protected readonly list = signal<SavedRoute[]>([]);
  protected readonly sort = signal<'used' | 'recent'>('used');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly renaming = signal<SavedRoute | null>(null);
  protected readonly deleting = signal<SavedRoute | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(SAVED_NAME_MAX)] });

  constructor() {
    effect(() => {
      this.version();
      const sort = this.sort();
      untracked(() => void this.fetch(sort));
    });
  }

  private async fetch(sort: 'used' | 'recent'): Promise<void> {
    this.loading.set(true);
    try {
      this.list.set((await this.api.savedRoutes(sort)).saved);
      this.error.set(null);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected startRename(s: SavedRoute): void {
    this.name.reset(s.name);
    this.submitted.set(false);
    this.renaming.set(s);
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const target = this.renaming();
    this.submitted.set(true);
    this.name.setValue(this.name.value.trim());
    if (!target || this.name.invalid) return;
    this.busy.set(true);
    try {
      const { saved } = await this.api.renameSavedRoute(target.id, this.name.value);
      this.list.update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      this.renaming.set(null);
      this.toast.success('PLANNER.RENAMED');
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(s: SavedRoute): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteSavedRoute(s.id);
      this.list.update((list) => list.filter((x) => x.id !== s.id));
      this.deleting.set(null);
      this.toast.success('PLANNER.DELETED');
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(false);
    }
  }
}
