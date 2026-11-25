import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PostPhoto } from '../core/models';
import { Icon } from './icons';

/** Photo grid; a photo opens enlarged in an overlay (Esc closes, ← → browse, focus returns to the thumbnail). */
@Component({
  selector: 'app-photo-gallery',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="gallery" [class.single]="photos().length === 1">
      @for (p of photos(); track p.url; let i = $index) {
        <button type="button" class="thumb" (click)="open(i)" [attr.aria-label]="'COMMUNITY.OPEN_PHOTO' | translate: { n: i + 1, total: photos().length }">
          <img [src]="p.url" [alt]="p.alt" loading="lazy" />
        </button>
      }
    </div>
    @if (current(); as p) {
      <div class="lightbox" role="dialog" aria-modal="true" [attr.aria-label]="'COMMUNITY.PHOTO_OF' | translate: { n: index()! + 1, total: photos().length }"
        (keydown)="onKey($event)" (click)="close()">
        <figure (click)="$event.stopPropagation()">
          <img [src]="p.url" [alt]="p.alt" />
          <figcaption>
            <span>{{ 'COMMUNITY.PHOTO_OF' | translate: { n: index()! + 1, total: photos().length } }}</span>
            @if (p.alt) {
              <span>· {{ p.alt }}</span>
            }
          </figcaption>
        </figure>
        <button #closeBtn type="button" class="lb-btn lb-close" (click)="close()" [attr.aria-label]="'COMMON.CLOSE' | translate"><app-icon name="close" /></button>
        @if (photos().length > 1) {
          <button type="button" class="lb-btn lb-prev" (click)="$event.stopPropagation(); step(-1)" [attr.aria-label]="'COMMUNITY.PREV_PHOTO' | translate"><app-icon name="chevron-left" /></button>
          <button type="button" class="lb-btn lb-next" (click)="$event.stopPropagation(); step(1)" [attr.aria-label]="'COMMUNITY.NEXT_PHOTO' | translate"><app-icon name="chevron-right" /></button>
        }
      </div>
    }
  `,
  styles: `
    .gallery { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
    .gallery.single { grid-template-columns: 1fr; }
    .thumb { padding: 0; border: 0; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-2); cursor: zoom-in; aspect-ratio: 16 / 10; }
    .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .thumb:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
    .lightbox { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; padding: 3.5rem 1rem 1rem; background: rgb(0 0 0 / 0.88); }
    figure { margin: 0; max-width: min(1100px, 100%); text-align: center; }
    figure img { max-width: 100%; max-height: calc(100vh - 9rem); object-fit: contain; border-radius: var(--radius-sm); }
    figcaption { margin-top: 0.5rem; color: #f2f2f2; font-size: 0.9rem; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.3rem; }
    .lb-btn { position: absolute; display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.15); color: #fff; cursor: pointer; }
    .lb-btn:hover, .lb-btn:focus-visible { background: rgb(255 255 255 / 0.3); outline: 2px solid #fff; }
    .lb-close { top: 0.75rem; right: 0.75rem; }
    .lb-prev { left: 0.75rem; top: 50%; }
    .lb-next { right: 0.75rem; top: 50%; }
  `,
})
export class PhotoGallery {
  readonly photos = input.required<PostPhoto[]>();
  protected readonly index = signal<number | null>(null);
  protected readonly current = computed(() => (this.index() === null ? null : this.photos()[this.index()!]));
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected open(i: number): void {
    this.index.set(i);
    setTimeout(() => this.closeBtn()?.nativeElement.focus());
  }

  protected close(): void {
    const i = this.index();
    this.index.set(null);
    setTimeout(() => this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.thumb')[i ?? 0]?.focus());
  }

  protected step(d: number): void {
    const n = this.photos().length;
    this.index.update((i) => ((i ?? 0) + d + n) % n);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'Tab') {
      // keep focus inside the overlay
      const buttons = [...this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.lb-btn')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
}
