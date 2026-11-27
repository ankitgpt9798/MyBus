import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { LanguageService } from '../../core/language.service';
import { Board } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { Icon } from '../../shared/icons';
import { CityPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { BOARD_ICONS } from '../../shared/post-card';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

const BOARDS: Board[] = ['stories', 'tips', 'routes', 'destinations', 'advice'];
export const TITLE = { min: 5, max: 120 };
export const BODY = { min: 20, max: 5000 };
const MAX_PHOTOS = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const trimmedMin =
  (min: number) =>
  (c: AbstractControl): ValidationErrors | null => {
    const len = String(c.value ?? '').trim().length;
    return len && len < min ? { minlength: { requiredLength: min } } : null;
  };

/** A photo in the editor: already on the post (file) or newly picked (blob + preview URL). */
interface EditorPhoto {
  key: string;
  preview: string;
  alt: string;
  file?: string; // existing photo (its stored name)
  blob?: File; // new upload
}

/** Write (/community/new) or edit (/community/posts/:id/edit) a post: board cards, title and text, tags, photos (pick or drag and drop) and the guidelines. */
@Component({
  selector: 'app-post-editor',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, Icon, CityPipe, NumPipe, PluralPipe, TranslateOrPipe],
  templateUrl: './post-editor.html',
  styleUrl: './post-editor.scss',
})
export class PostEditorPage {
  /** Route param when editing. */
  readonly id = input<string | undefined>(undefined);
  /** ?board / ?routeId / ?city prefill a new post (e.g. from a route page). */
  readonly board = input<string | undefined>(undefined);
  readonly routeId = input<string | undefined>(undefined);
  readonly city = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly language = inject(LanguageService);
  protected readonly auth = inject(AuthService);
  protected readonly boards = BOARDS;
  protected readonly icons = BOARD_ICONS;
  protected readonly title = TITLE;
  protected readonly bodyLimits = BODY;
  protected readonly maxPhotos = MAX_PHOTOS;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    board: ['' as Board | '', Validators.required],
    title: ['', [Validators.required, trimmedMin(TITLE.min), Validators.maxLength(TITLE.max)]],
    body: ['', [Validators.required, trimmedMin(BODY.min), Validators.maxLength(BODY.max)]],
    routeId: [''],
    city: [''],
  });
  private readonly titleValue = toSignal(this.form.controls.title.valueChanges, { initialValue: '' });
  private readonly bodyValue = toSignal(this.form.controls.body.valueChanges, { initialValue: '' });
  protected readonly boardValue = toSignal(this.form.controls.board.valueChanges, { initialValue: '' as Board | '' });
  protected readonly titleLength = computed(() => this.titleValue().trim().length);
  protected readonly bodyLength = computed(() => this.bodyValue().trim().length);

  protected readonly routes = signal<{ id: string; from: string; to: string }[]>([]);
  protected readonly cities = signal<string[]>([]);
  protected readonly photos = signal<EditorPhoto[]>([]);
  protected readonly photoError = signal<string | null>(null);
  /** Photos are being dragged over the drop zone. */
  protected readonly dragOver = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly blocked = signal<string | null>(null);
  protected readonly resent = signal(false);
  protected readonly editing = computed(() => !!this.id());
  private nextKey = 1;

  constructor() {
    void this.api.allRoutes().then((r) => this.routes.set(r.routes)).catch(() => undefined);
    void this.api.cities().then((r) => this.cities.set(r.cities)).catch(() => undefined);
    effect(() => {
      const id = this.id();
      const prefill = { board: this.board(), routeId: this.routeId(), city: this.city() };
      untracked(() => (id ? void this.loadPost(id) : this.prefill(prefill)));
    });
    // Free the preview URLs of new photos when leaving the page.
    inject(DestroyRef).onDestroy(() => this.photos().forEach((p) => p.blob && URL.revokeObjectURL(p.preview)));
  }

  private prefill(p: { board?: string; routeId?: string; city?: string }): void {
    this.form.patchValue({
      board: BOARDS.includes(p.board as Board) ? (p.board as Board) : '',
      routeId: p.routeId ?? '',
      city: p.city ?? '',
    });
  }

  private async loadPost(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const { post } = await this.api.communityPost(id);
      if (!post.mine) return this.blocked.set('ERRORS.COMMUNITY_NOT_AUTHOR');
      this.form.reset({ board: post.board, title: post.title, body: post.body, routeId: post.route?.id ?? '', city: post.city ?? '' });
      this.photos.set(post.photos.map((ph) => ({ key: `e${this.nextKey++}`, preview: ph.url, alt: ph.alt, file: ph.url.split('/').pop() })));
    } catch (err) {
      this.blocked.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Client-side checks for a quick answer; the server checks the real file type again by its first bytes. */
  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    this.addFiles(picked);
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  /** Same checks for picked and dropped files. */
  private addFiles(picked: File[]): void {
    this.photoError.set(null);
    const room = MAX_PHOTOS - this.photos().length;
    if (picked.length > room) this.photoError.set('ERRORS.COMMUNITY_TOO_MANY_PHOTOS');
    for (const file of picked.slice(0, Math.max(0, room))) {
      if (!TYPES.includes(file.type)) {
        this.photoError.set('ERRORS.COMMUNITY_PHOTO_TYPE');
        continue;
      }
      if (file.size > MAX_BYTES) {
        this.photoError.set('ERRORS.COMMUNITY_PHOTO_TOO_LARGE');
        continue;
      }
      this.photos.update((list) => [...list, { key: `n${this.nextKey++}`, preview: URL.createObjectURL(file), alt: '', blob: file }]);
    }
  }

  protected remove(p: EditorPhoto): void {
    if (p.blob) URL.revokeObjectURL(p.preview);
    this.photos.update((list) => list.filter((x) => x.key !== p.key));
    this.photoError.set(null);
  }

  protected setAlt(p: EditorPhoto, alt: string): void {
    this.photos.update((list) => list.map((x) => (x.key === p.key ? { ...x, alt } : x)));
  }

  protected async resend(): Promise<void> {
    try {
      await this.auth.resendVerification();
      this.resent.set(true);
    } catch (err) {
      this.toast.error(errorKey(err));
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const data = new FormData();
    data.append('board', v.board);
    data.append('title', v.title.trim());
    data.append('body', v.body.trim());
    data.append('routeId', v.routeId);
    data.append('city', v.city);
    data.append('language', this.language.current());
    const added = this.photos().filter((p) => p.blob);
    for (const p of added) data.append('photos', p.blob!, p.blob!.name);
    data.append('alts', JSON.stringify(added.map((p) => p.alt.trim())));
    if (this.editing()) data.append('keep', JSON.stringify(this.photos().filter((p) => p.file).map((p) => ({ file: p.file, alt: p.alt.trim() }))));

    this.saving.set(true);
    this.error.set(null);
    try {
      const { post } = this.editing() ? await this.api.updatePost(this.id()!, data) : await this.api.createPost(data);
      this.toast.success(this.editing() ? 'COMMUNITY.POST_UPDATED' : 'COMMUNITY.POST_PUBLISHED');
      await this.router.navigate(['/community/posts', post.id]);
    } catch (err) {
      if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }
}
