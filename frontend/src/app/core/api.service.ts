import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouteSummary, SearchResponse, TripDetails } from './models';

type Params = Record<string, string | number | boolean | undefined | null>;
const toParams = (p: Params) =>
  Object.entries(p).reduce((acc, [k, v]) => (v === undefined || v === null || v === '' ? acc : acc.set(k, String(v))), new HttpParams());

/** Promise-based client for the catalogue and booking endpoints. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private get<T>(url: string, params: Params = {}) {
    return firstValueFrom(this.http.get<T>(`/api${url}`, { params: toParams(params) }));
  }

  cities() {
    return this.get<{ cities: string[] }>('/cities');
  }
  popularRoutes() {
    return this.get<{ routes: RouteSummary[] }>('/routes/popular');
  }
  search(params: Params) {
    return this.get<SearchResponse>('/trips/search', params);
  }
  trip(id: string) {
    return this.get<TripDetails>(`/trips/${id}`);
  }
}
