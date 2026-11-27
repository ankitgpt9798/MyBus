import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { CommunityComment, CommunityPost, ContentReportReason, PublicProfile, ShareNetwork } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { Icon } from '../../shared/icons';
import { PhotoGallery } from '../../shared/photo-gallery';
import { ReportDialog } from '../../shared/report-dialog';
import { ShareBar } from '../../shared/share-bar';
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
const SOURCES: ShareNetwork[] = ['whatsapp', 'x', 'facebook', 'telegram', 'copy', 'native'];
const commentControl = () => new FormControl('', { nonNullable: true, validators: [Validators.required, trimmedMin(COMMENT_MIN), Validators.maxLength(COMMENT_MAX)] });

/** A community post: article with photos, likes, sharing and reporting, an author card, and comments with one level of replies. */
@Component({
  selector: 'app-post-detail',
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink, TranslatePipe, Icon, Dialog, FieldError, PhotoGallery, ReportDialog, ShareBar, AppDatePipe, CityPipe, NumPipe, PluralPipe, TranslateOrPipe],
  templateUrl: './post-detail.html',
  styleUrl: './post-detail.scss',
})
export class PostDetailPage {
  readonly id = input.required<string>();
  /** Set when someone arrives through a shared link; counted once as a visit back, then removed from the URL. */
  readonly utmSource = input<string | undefined>(undefined, { alias: 'utm_source' });

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly icons = BOARD_ICONS;
  protected readonly max = COMMENT_MAX;

  protected readonly post = signal<CommunityPost | null>(null);
  protected readonly comments = signal<CommunityComment[]>([]);
  /** The author's public profile for the author card (badges and stats); optional. */
  protected readonly author = signal<PublicProfile | null>(null);
  protected readonly myInitial = computed(() => this.auth.user()?.name.charAt(0) ?? '');
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
  protected readonly visible = computed(() => this.post()?.status === 'visible');
  /** The share page renders link previews (Open Graph) and forwards people to this post. */
  protected readonly shareUrl = computed(() => `${location.origin}/share/posts/${this.id()}`);
  protected readonly reporting = signal<{ kind: 'post' } | { kind: 'comment'; comment: CommunityComment } | null>(null);
  protected readonly reportError = signal<string | null>(null);

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
      this.countVisit(res.post);
      this.loadAuthor(res.post.author.id);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  private loadAuthor(id: string | null | undefined): void {
    this.author.set(null);
    if (id) void this.api.userProfile(id).then((p) => this.author.set(p)).catch(() => undefined);
  }

  private countVisit(post: CommunityPost): void {
    const source = SOURCES.find((s) => s === this.utmSource());
    if (!source) return;
    if (post.status === 'visible') void this.api.visitPost(post.id, source).catch(() => undefined);
    void this.router.navigate([], { queryParams: { utm_source: null, utm_medium: null, utm_campaign: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected shared(network: ShareNetwork): void {
    const p = this.post();
    if (!p) return;
    void this.api
      .sharePost(p.id, network)
      .then((res) => this.post.update((x) => (x ? { ...x, shareCount: res.shareCount } : x)))
      .catch(() => undefined);
  }

  protected openReport(target: { kind: 'post' } | { kind: 'comment'; comment: CommunityComment }): void {
    if (!this.canAct()) return;
    this.reportError.set(null);
    this.reporting.set(target);
  }

  protected async sendReport(report: { reason: ContentReportReason; note?: string }): Promise<void> {
    const target = this.reporting();
    const p = this.post();
    if (!target || !p) return;
    this.busy.set('report');
    this.reportError.set(null);
    try {
      if (target.kind === 'post') {
        const res = await this.api.reportPost(p.id, report);
        this.reporting.set(null);
        if (res.hidden) {
          // Enough reports: the post is hidden until a moderator looks at it.
          this.toast.success('COMMUNITY.REPORT_HID_POST');
          await this.router.navigate(['/community']);
          return;
        }
        this.post.set({ ...p, reportedByMe: true });
      } else {
        const id = target.comment.id;
        const res = await this.api.reportComment(id, report);
        this.reporting.set(null);
        this.comments.update((list) =>
          list
            .filter((c) => !(res.hidden && c.id === id))
            .map((c) => ({
              ...c,
              reportedByMe: c.reportedByMe || c.id === id,
              replies: c.replies.filter((r) => !(res.hidden && r.id === id)).map((r) => ({ ...r, reportedByMe: r.reportedByMe || r.id === id })),
            })),
        );
        this.post.set({ ...p, commentCount: res.commentCount });
      }
      this.toast.success('COMMUNITY.REPORT_THANKS');
    } catch (err) {
      this.reportError.set(errorKey(err));
    } finally {
      this.busy.set(null);
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
