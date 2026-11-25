import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { CommunityComment, CommunityPost } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { Icon } from '../../shared/icons';
import { PhotoGallery } from '../../shared/photo-gallery';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { BOARD_ICONS } from '../../shared/post-card';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

export const COMMENT_MIN = 2;
export const COMMENT_MAX = 1000;
const trimmedMin =
  (min: number) =>
  (c: AbstractControl): ValidationErrors | null => {
    const len = String(c.value ?? '').trim().length;
    return len && len < min ? { minlength: { requiredLength: min } } : null;
  };
const commentControl = () => new FormControl('', { nonNullable: true, validators: [Validators.required, trimmedMin(COMMENT_MIN), Validators.maxLength(COMMENT_MAX)] });

/** A community post with its photos, likes and comments (one level of replies). */
@Component({
  selector: 'app-post-detail',
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink, TranslatePipe, Icon, Dialog, FieldError, PhotoGallery, AppDatePipe, CityPipe, NumPipe, PluralPipe, TranslateOrPipe],
  templateUrl: './post-detail.html',
  styleUrl: './post-detail.scss',
})
export class PostDetailPage {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly icons = BOARD_ICONS;
  protected readonly max = COMMENT_MAX;

  protected readonly post = signal<CommunityPost | null>(null);
  protected readonly comments = signal<CommunityComment[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly verifyPrompt = signal(false);
  protected readonly replyingTo = signal<string | null>(null);
  protected readonly confirmDelete = signal<{ kind: 'post' } | { kind: 'comment'; id: string } | null>(null);
  protected readonly commentForm = new FormGroup({ body: commentControl() });
  protected readonly replyForm = new FormGroup({ body: commentControl() });
  protected readonly commentSubmitted = signal(false);
  protected readonly replySubmitted = signal(false);
  protected readonly canWrite = computed(() => this.auth.isLoggedIn() && this.auth.isVerified());

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.communityPost(id);
      this.post.set(res.post);
      this.comments.set(res.comments);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Liking and commenting need a signed-in, verified account. */
  private canAct(): boolean {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return false;
    }
    if (!this.auth.isVerified()) {
      this.verifyPrompt.set(true);
      return false;
    }
    return true;
  }

  protected async likePost(): Promise<void> {
    const p = this.post();
    if (!p || !this.canAct()) return;
    this.busy.set('post');
    try {
      const res = await this.api.likePost(p.id);
      this.post.set({ ...p, likedByMe: res.liked, likeCount: res.likeCount });
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async likeComment(c: CommunityComment): Promise<void> {
    if (!this.canAct()) return;
    this.busy.set(c.id);
    try {
      const res = await this.api.likeComment(c.id);
      const patch = (x: CommunityComment): CommunityComment =>
        x.id === c.id ? { ...x, likedByMe: res.liked, likeCount: res.likeCount } : { ...x, replies: x.replies.map(patch) };
      this.comments.update((list) => list.map(patch));
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected startReply(c: CommunityComment): void {
    if (!this.canAct()) return;
    this.replyForm.reset({ body: '' });
    this.replySubmitted.set(false);
    this.replyingTo.set(c.id);
  }

  protected async submit(parentId?: string): Promise<void> {
    const p = this.post();
    const form = parentId ? this.replyForm : this.commentForm;
    (parentId ? this.replySubmitted : this.commentSubmitted).set(true);
    if (!p || form.invalid) {
      form.markAllAsTouched();
      return;
    }
    this.busy.set(parentId ?? 'comment');
    try {
      const res = await this.api.addComment(p.id, form.controls.body.value.trim(), parentId);
      if (parentId) {
        this.comments.update((list) => list.map((c) => (c.id === parentId ? { ...c, replies: [...c.replies, res.comment] } : c)));
        this.replyingTo.set(null);
      } else {
        this.comments.update((list) => [...list, res.comment]);
      }
      this.post.set({ ...p, commentCount: res.commentCount });
      form.reset({ body: '' });
      (parentId ? this.replySubmitted : this.commentSubmitted).set(false);
      this.toast.success('COMMUNITY.COMMENT_POSTED');
    } catch (err) {
      if (!applyServerErrors(form, err)) this.toast.error(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async confirmDeletion(): Promise<void> {
    const target = this.confirmDelete();
    const p = this.post();
    if (!target || !p) return;
    this.busy.set('delete');
    try {
      if (target.kind === 'post') {
        await this.api.deletePost(p.id);
        this.toast.success('COMMUNITY.POST_DELETED');
        await this.router.navigate(['/community'], { queryParams: { board: p.board } });
      } else {
        const res = await this.api.deleteComment(target.id);
        this.comments.update((list) => list.filter((c) => c.id !== target.id).map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== target.id) })));
        this.post.set({ ...p, commentCount: res.commentCount });
        this.toast.success('COMMUNITY.COMMENT_DELETED');
      }
      this.confirmDelete.set(null);
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected length(form: FormGroup<{ body: FormControl<string> }>): number {
    return form.controls.body.value.trim().length;
  }
}
