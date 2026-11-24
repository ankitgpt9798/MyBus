import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon } from './icons';

let nextId = 0;

/** In-page modal dialog (no window.confirm): focuses its first control, closes on Esc or the backdrop. */
@Component({
  selector: 'app-dialog',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()"></div>
    <div class="dialog card" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" tabindex="-1">
      <div class="dialog-head">
        <h2 class="dialog-title" [id]="titleId">{{ title() }}</h2>
        <button type="button" class="icon-btn close" (click)="closed.emit()" [attr.aria-label]="'COMMON.CLOSE' | translate">
          <app-icon name="close" [size]="16" />
        </button>
      </div>
      <ng-content />
    </div>
  `,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  styles: `
    .dialog-backdrop { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / 0.45); }
    .dialog {
      position: fixed; z-index: 91; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
      box-shadow: var(--shadow-lg);
    }
    .dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem; }
    .dialog-title { margin: 0; font-size: 1.1rem; }
    .close { flex: none; width: 32px; height: 32px; }
  `,
})
export class Dialog {
  readonly title = input.required<string>();
  readonly closed = output<void>();
  protected readonly titleId = `dialog-title-${++nextId}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const first = el.querySelector<HTMLElement>('.dialog input, .dialog select, .dialog textarea, .dialog button:not(.close)');
      (first ?? el.querySelector<HTMLElement>('.dialog'))?.focus();
    });
  }
}
