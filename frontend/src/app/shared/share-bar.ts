import { Component, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ShareNetwork } from '../core/models';
import { ToastService } from '../core/toast.service';
import { Icon } from './icons';

type Network = Exclude<ShareNetwork, 'copy' | 'native'>;
const NETWORKS: { id: Network; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'x', label: 'X' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'telegram', label: 'Telegram' },
];

/** The link with UTM parameters, so visits that come back from a share can be attributed to the network. */
export function withUtm(url: string, source: ShareNetwork, campaign: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

/** Plain share links (no SDKs or external scripts) for WhatsApp, X, Facebook and Telegram, plus copy and the native share sheet. */
@Component({
  selector: 'app-share-bar',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="share-bar" role="group" [attr.aria-label]="'SHARE.LABEL' | translate">
      <span class="share-label small muted"><app-icon name="share" [size]="14" /> {{ 'SHARE.LABEL' | translate }}</span>
      @for (n of networks; track n.id) {
        <a class="btn btn-sm btn-outline share-link" [attr.data-network]="n.id" [href]="href(n.id)" target="_blank" rel="noopener noreferrer"
          [attr.aria-label]="'SHARE.ON' | translate: { network: n.label }" (click)="shared.emit(n.id)">{{ n.label }}</a>
      }
      <button type="button" class="btn btn-sm btn-outline copy-link" (click)="copy()"><app-icon name="link" [size]="14" /> {{ 'SHARE.COPY' | translate }}</button>
      @if (canShareNatively) {
        <button type="button" class="btn btn-sm btn-primary native-share" (click)="shareNatively()"><app-icon name="share" [size]="14" /> {{ 'SHARE.MORE' | translate }}</button>
      }
    </div>
  `,
  styles: `
    :host { display: block; flex: 1 1 100%; }
    .share-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
    .share-label { display: inline-flex; align-items: center; gap: 0.3rem; margin-right: 0.2rem; }
    .share-link { text-decoration: none; }
  `,
})
export class ShareBar {
  /** Absolute link to share, without UTM parameters. */
  readonly url = input.required<string>();
  readonly title = input.required<string>();
  readonly campaign = input('community');
  readonly shared = output<ShareNetwork>();

  private readonly toast = inject(ToastService);
  protected readonly networks = NETWORKS;
  protected readonly canShareNatively = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  protected href(network: Network): string {
    const url = encodeURIComponent(withUtm(this.url(), network, this.campaign()));
    const title = encodeURIComponent(this.title());
    switch (network) {
      case 'whatsapp':
        return `https://wa.me/?text=${title}%20${url}`;
      case 'x':
        return `https://x.com/intent/tweet?text=${title}&url=${url}`;
      case 'facebook':
        return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
      case 'telegram':
        return `https://t.me/share/url?url=${url}&text=${title}`;
    }
  }

  protected async copy(): Promise<void> {
    const link = withUtm(this.url(), 'copy', this.campaign());
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Older browsers / no clipboard permission: copy through a temporary text field.
      const field = document.createElement('textarea');
      field.value = link;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      if (!ok) {
        this.toast.error('SHARE.COPY_FAILED');
        return;
      }
    }
    this.toast.success('SHARE.COPIED');
    this.shared.emit('copy');
  }

  protected async shareNatively(): Promise<void> {
    try {
      await navigator.share({ title: this.title(), url: withUtm(this.url(), 'native', this.campaign()) });
      this.shared.emit('native');
    } catch {
      // cancelled by the user
    }
  }
}
