import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the JWT to API calls and ends the session when the server says the token is no longer valid. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Translation files and other static assets pass straight through. Resolving AuthService for them would
  // create a DI cycle at startup (TranslateService -> HttpClient -> AuthService -> Router -> TitleStrategy -> TranslateService).
  if (!req.url.startsWith('/api/')) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && err.error?.code === 'AUTH_TOKEN_INVALID') {
        // Only redirect an active session; a stale token found at startup is cleared silently.
        const hadSession = auth.isLoggedIn();
        auth.clearSession();
        if (hadSession) router.navigate(['/login'], { queryParams: { returnUrl: router.url, expired: 1 } });
      }
      return throwError(() => err);
    }),
  );
};
