import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

// Formatting follows the active UI language: the pipes read ngx-translate's currentLang signal,
// so templates re-render with the new locale when the language changes.

// Marathi keeps its month/day names but uses Latin digits, matching seat numbers and times elsewhere in the UI.
const LOCALES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN-u-nu-latn' };
const localeOf = (translate: TranslateService) => LOCALES[translate.currentLang() ?? 'en'] ?? 'en-IN';

type DateStyle = 'time' | 'date' | 'datetime' | 'day';
const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  // 24-hour times (as on Indian bus tickets) also avoid Latin "am/pm" inside Hindi and Marathi text.
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  day: { weekday: 'short', day: 'numeric', month: 'short' },
};
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Locale-aware date/time, always in IST: {{ value | appDate:'time' }}. A bare YYYY-MM-DD is treated as an IST calendar day. */
@Pipe({ name: 'appDate', pure: false })
export class AppDatePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: string | Date | null | undefined, style: DateStyle = 'datetime'): string {
    if (!value) return '';
    const locale = localeOf(this.translate);
    const key = `${locale}|${style}`;
    let fmt = formatters.get(key);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone: 'Asia/Kolkata' });
      formatters.set(key, fmt);
    }
    const date = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value) : value;
    return Number.isNaN(date.getTime()) ? '' : fmt.format(date);
  }
}

/** Rupee amount: {{ 499 | inr }} -> ₹499 */
@Pipe({ name: 'inr', pure: false })
export class InrPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return new Intl.NumberFormat(localeOf(this.translate), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
  }
}

/** Localized number: {{ 12 | num }} */
@Pipe({ name: 'num', pure: false })
export class NumPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return new Intl.NumberFormat(localeOf(this.translate), { maximumFractionDigits: 1 }).format(value);
  }
}

/** Minutes -> "5h 30m" with translated units (COMMON.DURATION). */
@Pipe({ name: 'duration', pure: false })
export class DurationPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(minutes: number | null | undefined): string {
    if (minutes === null || minutes === undefined) return '';
    return this.translate.instant('COMMON.DURATION', { h: Math.floor(minutes / 60), m: minutes % 60 });
  }
}

/** City names are translated via CITY.<name>; unknown cities are shown as stored. */
@Pipe({ name: 'city', pure: false })
export class CityPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(name: string | null | undefined): string {
    if (!name) return '';
    const key = `CITY.${name}`;
    const value = this.translate.instant(key);
    return value === key ? name : value;
  }
}
