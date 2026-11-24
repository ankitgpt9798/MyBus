import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { LANGUAGES } from '../../core/language.service';
import { AdminPromotion, Lang, PromotionDraft, PromotionTarget } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { notBlank } from '../../shared/validators';
import { PluralPipe } from '../../shared/plural.pipe';

const OTHER_LANGS: Lang[] = ['hi', 'mr', 'bn', 'te'];

/** A translation is optional, but once one of its fields is filled the other is required too. */
const requiredWithSibling =
  (sibling: string): ValidatorFn =>
  (c: AbstractControl): ValidationErrors | null =>
    String(c.parent?.get(sibling)?.value ?? '').trim() && !String(c.value ?? '').trim() ? { required: true } : null;

/** Admin: compose an offer (English required, other languages optional), choose who gets it, preview, send. */
@Component({
  selector: 'app-admin-offers',
  imports: [ReactiveFormsModule, TranslatePipe, FieldError, AppDatePipe, CityPipe, NumPipe, TranslateOrPipe, PluralPipe],
  template: `
    <form class="card offer-form" [formGroup]="form" (ngSubmit)="send()" novalidate>
      <h2 class="sub-title">{{ 'ADMIN.OFFER.NEW' | translate }}</h2>
      <p class="muted small">{{ 'ADMIN.OFFER.HINT' | translate }}</p>
      @if (error(); as e) {
        <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
      }

      <fieldset class="lang-block" lang="en">
        <legend>{{ 'ADMIN.OFFER.ENGLISH' | translate }}</legend>
        <div class="form-field">
          <label for="o-title">{{ 'ADMIN.OFFER.TITLE' | translate }}</label>
          <input id="o-title" formControlName="title" maxlength="80" />
          <app-field-error [control]="form.controls.title" [submitted]="submitted()" />
        </div>
        <div class="form-field">
          <label for="o-body">{{ 'ADMIN.OFFER.BODY' | translate }}</label>
          <textarea id="o-body" formControlName="body" rows="3" maxlength="500"></textarea>
          <app-field-error [control]="form.controls.body" [submitted]="submitted()" />
        </div>
      </fieldset>

      <details class="translations" [open]="translationsOpen()" (toggle)="translationsOpen.set($any($event.target).open)">
        <summary>{{ 'ADMIN.OFFER.OTHER_LANGUAGES' | translate }}</summary>
        <p class="muted small">{{ 'ADMIN.OFFER.FALLBACK_HINT' | translate }}</p>
        <div formGroupName="translations">
          @for (l of otherLangs; track l.code) {
            <fieldset class="lang-block" [formGroupName]="l.code" [attr.lang]="l.code" [attr.data-lang]="l.code">
              <legend>{{ l.label }}</legend>
              <div class="form-grid two">
                <div class="form-field">
                  <label [for]="'o-title-' + l.code">{{ 'ADMIN.OFFER.TITLE' | translate }}</label>
                  <input [id]="'o-title-' + l.code" formControlName="title" maxlength="80" />
                  <app-field-error [control]="langControl(l.code, 'title')" [submitted]="submitted()" />
                </div>
                <div class="form-field">
                  <label [for]="'o-body-' + l.code">{{ 'ADMIN.OFFER.BODY' | translate }}</label>
                  <textarea [id]="'o-body-' + l.code" formControlName="body" rows="2" maxlength="500"></textarea>
                  <app-field-error [control]="langControl(l.code, 'body')" [submitted]="submitted()" />
                </div>
              </div>
            </fieldset>
          }
        </div>
      </details>

      <fieldset class="audience" formGroupName="target">
        <legend>{{ 'ADMIN.OFFER.AUDIENCE' | translate }}</legend>
        <label class="check"><input type="radio" formControlName="kind" value="all" /> {{ 'ADMIN.OFFER.TARGET_ALL' | translate }}</label>
        <label class="check"><input type="radio" formControlName="kind" value="route" /> {{ 'ADMIN.OFFER.TARGET_ROUTE' | translate }}</label>
        @if (form.controls.target.controls.kind.value === 'route') {
          <div class="form-grid two target-fields">
            <div class="form-field">
              <label for="o-from">{{ 'SEARCH.FROM' | translate }}</label>
              <select id="o-from" formControlName="from">
                <option value="">{{ 'SEARCH.SELECT_CITY' | translate }}</option>
                @for (c of cities(); track c) {
                  <option [value]="c">{{ c | city }}</option>
                }
              </select>
              <app-field-error [control]="form.controls.target.controls.from" [submitted]="submitted() || previewTried()" />
            </div>
            <div class="form-field">
              <label for="o-to">{{ 'SEARCH.TO' | translate }}</label>
              <select id="o-to" formControlName="to">
                <option value="">{{ 'SEARCH.SELECT_CITY' | translate }}</option>
                @for (c of cities(); track c) {
                  <option [value]="c">{{ c | city }}</option>
                }
              </select>
              <app-field-error [control]="form.controls.target.controls.to" [submitted]="submitted() || previewTried()" />
            </div>
          </div>
        }
        <label class="check"><input type="radio" formControlName="kind" value="city" /> {{ 'ADMIN.OFFER.TARGET_CITY' | translate }}</label>
        @if (form.controls.target.controls.kind.value === 'city') {
          <div class="form-field target-fields">
            <label for="o-city">{{ 'ADMIN.OFFER.CITY' | translate }}</label>
            <select id="o-city" formControlName="city">
              <option value="">{{ 'SEARCH.SELECT_CITY' | translate }}</option>
              @for (c of cities(); track c) {
                <option [value]="c">{{ c | city }}</option>
              }
            </select>
            <app-field-error [control]="form.controls.target.controls.city" [submitted]="submitted() || previewTried()" />
          </div>
        }
        <p class="muted small">{{ 'ADMIN.OFFER.OPT_IN_NOTE' | translate }}</p>
      </fieldset>

      <div class="preview-row">
        <button type="button" class="btn btn-outline preview-btn" [disabled]="previewing()" (click)="runPreview()">
          {{ (previewing() ? 'COMMON.PLEASE_WAIT' : 'ADMIN.OFFER.PREVIEW') | translate }}
        </button>
        @if (preview(); as p) {
          <p class="alert preview-result" [class.alert-info]="p.recipients" [class.alert-warning]="!p.recipients" role="status">
            @if (p.recipients) {
              {{ 'ADMIN.OFFER.PREVIEW_RESULT' | plural: p.recipients : { count: (p.recipients | num) } }}
            } @else {
              {{ 'ADMIN.OFFER.PREVIEW_NONE' | translate }}
            }
            {{ 'ADMIN.OFFER.PREVIEW_MATCHED' | plural: p.matched : { matched: (p.matched | num) } }}
          </p>
        }
      </div>
      <button type="submit" class="btn btn-primary send-btn" [disabled]="!canSend()">
        @if (sending()) {
          {{ 'COMMON.PLEASE_WAIT' | translate }}
        } @else {
          {{ 'ADMIN.OFFER.SEND' | plural: preview()?.recipients ?? 0 : { count: (preview()?.recipients ?? 0 | num) } }}
        }
      </button>
    </form>

    <div class="card table-card">
      <h2 class="sub-title">{{ 'ADMIN.OFFER.RECENT' | translate }}</h2>
      @if (campaigns().length) {
        <div class="table-wrap">
          <table class="table offers-table">
            <thead>
              <tr>
                <th>{{ 'ADMIN.TIME' | translate }}</th>
                <th>{{ 'ADMIN.OFFER.TITLE' | translate }}</th>
                <th>{{ 'ADMIN.OFFER.AUDIENCE' | translate }}</th>
                <th>{{ 'ADMIN.OFFER.LANGUAGES' | translate }}</th>
                <th>{{ 'ADMIN.STATUS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (c of campaigns(); track c.id) {
                <tr [attr.data-campaign]="c.id">
                  <td class="nowrap">{{ c.createdAt | appDate: 'datetime' }}</td>
                  <td>{{ c.title }}</td>
                  <td>{{ audienceKey(c.target) | translate: { from: ($any(c.target).from | city), to: ($any(c.target).to | city), city: ($any(c.target).city | city) } }}</td>
                  <td class="nowrap">{{ c.languages.join(', ').toUpperCase() }}</td>
                  <td class="nowrap">
                    <span [class]="'badge ' + (c.status === 'sent' ? 'badge-success' : 'badge-info')">{{ (c.status === 'sent' ? 'ADMIN.OFFER.STATUS_SENT' : 'ADMIN.OFFER.STATUS_SENDING') | translate }}</span>
                    <div class="muted small progress">{{ 'ADMIN.OFFER.PROGRESS' | translate: { sent: (c.sent | num), total: (c.recipients | num) } }}</div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="empty-row">{{ 'ADMIN.OFFER.NONE_YET' | translate }}</p>
      }
    </div>
  `,
  styleUrl: './admin.scss',
  styles: `
    .offer-form { margin-bottom: 1.25rem; }
    .lang-block, .audience { margin: 0 0 1rem; padding: 0.75rem 1rem 0.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
    legend { padding: 0 0.35rem; font-weight: 700; }
    .translations { margin-bottom: 1rem; }
    .translations summary { margin-bottom: 0.5rem; font-weight: 600; cursor: pointer; }
    .audience { padding-bottom: 0.75rem; }
    .target-fields { margin: 0.25rem 0 0.5rem 1.6rem; }
    .preview-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .preview-result { flex: 1 1 260px; margin: 0; }
    .nowrap { white-space: nowrap; }
    @media (max-width: 640px) { .target-fields { margin-left: 0; } }
  `,
})
export class AdminOffersPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly otherLangs = LANGUAGES.filter((l) => OTHER_LANGS.includes(l.code));

  protected readonly form = this.fb.group({
    title: ['', [Validators.required, notBlank, Validators.minLength(3), Validators.maxLength(80)]],
    body: ['', [Validators.required, notBlank, Validators.minLength(3), Validators.maxLength(500)]],
    translations: this.fb.group(
      Object.fromEntries(
        OTHER_LANGS.map((l) => [
          l,
          this.fb.group({ title: ['', [requiredWithSibling('body'), Validators.maxLength(80)]], body: ['', [requiredWithSibling('title'), Validators.maxLength(500)]] }),
        ]),
      ),
    ),
    target: this.fb.group({ kind: ['all' as PromotionTarget['kind']], from: [''], to: [''], city: [''] }),
  });

  protected readonly cities = signal<string[]>([]);
  protected readonly campaigns = signal<AdminPromotion[]>([]);
  protected readonly preview = signal<{ recipients: number; matched: number } | null>(null);
  protected readonly previewing = signal(false);
  protected readonly previewTried = signal(false);
  protected readonly sending = signal(false);
  protected readonly submitted = signal(false);
  protected readonly translationsOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canSend = computed(() => !this.sending() && (this.preview()?.recipients ?? 0) > 0);
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // A different audience needs a fresh preview before sending.
    this.form.controls.target.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.preview.set(null));
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    void this.api.cities().then((r) => this.cities.set(r.cities)).catch(() => undefined);
    void this.loadCampaigns();
  }

  protected langControl(lang: Lang, field: 'title' | 'body'): AbstractControl {
    return this.form.get(['translations', lang, field])!;
  }

  private target(): PromotionTarget | null {
    const t = this.form.controls.target;
    const { kind, from, to, city } = t.getRawValue();
    const need = (name: 'from' | 'to' | 'city', ok: boolean) => {
      t.controls[name].setErrors(ok ? null : { required: true });
      if (!ok) t.controls[name].markAsTouched();
      return ok;
    };
    if (kind === 'route') {
      const okFrom = need('from', !!from);
      const okTo = need('to', !!to);
      if (okFrom && okTo && from === to) {
        t.controls.to.setErrors({ invalid: true });
        return null;
      }
      return okFrom && okTo ? { kind, from, to } : null;
    }
    if (kind === 'city') return need('city', !!city) ? { kind, city } : null;
    return { kind: 'all' };
  }

  protected async runPreview(): Promise<void> {
    this.previewTried.set(true);
    const target = this.target();
    if (!target) return;
    this.previewing.set(true);
    this.error.set(null);
    try {
      this.preview.set(await this.api.adminPromotionPreview(target));
    } catch (err) {
      if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.previewing.set(false);
    }
  }

  protected async send(): Promise<void> {
    this.submitted.set(true);
    for (const l of OTHER_LANGS) for (const f of ['title', 'body'] as const) this.langControl(l, f).updateValueAndValidity();
    const target = this.target();
    if (this.form.invalid || !target || !this.canSend()) {
      this.form.markAllAsTouched();
      if (this.form.controls.translations.invalid) this.translationsOpen.set(true);
      return;
    }
    const v = this.form.getRawValue();
    const translations: PromotionDraft['translations'] = {};
    for (const l of OTHER_LANGS) {
      const tr = v.translations[l];
      if (tr.title.trim() && tr.body.trim()) translations[l] = { title: tr.title.trim(), body: tr.body.trim() };
    }
    this.sending.set(true);
    this.error.set(null);
    try {
      const { promotion } = await this.api.adminSendPromotion({ title: v.title.trim(), body: v.body.trim(), translations, target });
      this.toast.success('ADMIN.OFFER.SENT', { count: promotion.recipients }, promotion.recipients);
      this.form.reset({ title: '', body: '', target: { kind: 'all', from: '', to: '', city: '' } });
      this.submitted.set(false);
      this.previewTried.set(false);
      this.preview.set(null);
      await this.loadCampaigns();
    } catch (err) {
      if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
      if (this.form.controls.translations.invalid) this.translationsOpen.set(true);
    } finally {
      this.sending.set(false);
    }
  }

  private async loadCampaigns(): Promise<void> {
    try {
      const { promotions } = await this.api.adminPromotions();
      this.campaigns.set(promotions);
      // Keep the progress fresh while a campaign is still sending.
      if (promotions.some((p) => p.status === 'sending')) {
        this.poll ??= setInterval(() => void this.loadCampaigns(), 2000);
      } else {
        this.stopPolling();
      }
    } catch {
      /* the list shows what it has */
    }
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  protected audienceKey(t: PromotionTarget): string {
    return t.kind === 'route' ? 'ADMIN.OFFER.AUDIENCE_ROUTE' : t.kind === 'city' ? 'ADMIN.OFFER.AUDIENCE_CITY' : 'ADMIN.OFFER.AUDIENCE_ALL';
  }
}
