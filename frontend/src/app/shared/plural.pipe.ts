import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Singular/plural without an extra library: count strings are stored as variants keyed by the
 * Intl.PluralRules category of each language, e.g. "SEARCH.RESULTS_COUNT": { "one": "1 bus found", "other": "{{count}} buses found" }.
 * en/hi/mr/bn/te only use "one" and "other"; a missing category falls back to "other".
 */
const rules = new Map<string, Intl.PluralRules>();

function category(lang: string, count: number): Intl.LDMLPluralRule {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)));
  return r.select(count);
}

/** Translation of the variant of `key` that fits `count` in the current language. */
export function translatePlural(translate: TranslateService, key: string, count: number, params: Record<string, unknown> = {}): string {
  const lang = translate.currentLang() ?? 'en';
  const variant = `${key}.${category(lang, count)}`;
  const text = translate.instant(variant, params) as string;
  return text === variant ? (translate.instant(`${key}.other`, params) as string) : text;
}

/** {{ 'SEARCH.RESULTS_COUNT' | plural: trips.length : { count: (trips.length | num) } }} */
@Pipe({ name: 'plural', pure: false })
export class PluralPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(key: string, count: number | null | undefined, params: Record<string, unknown> = {}): string {
    return translatePlural(this.translate, key, Number(count ?? 0), { count, ...params });
  }
}
