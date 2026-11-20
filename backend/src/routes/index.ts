import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import * as auth from '../controllers/auth.controller';
import * as bookings from '../controllers/booking.controller';
import * as trips from '../controllers/trip.controller';
import * as users from '../controllers/user.controller';
import { requireAdmin, requireAuth } from '../middleware/auth';

export const api = Router();

api.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Auth
api.post('/auth/register', auth.register);
api.post('/auth/login', auth.login);
api.post('/auth/logout', requireAuth, auth.logout);
api.post('/auth/verify-email', auth.verifyEmail);
api.post('/auth/resend-verification', requireAuth, auth.resendVerification);

// Profile & preferences
api.get('/users/me', requireAuth, users.getMe);
api.patch('/users/me', requireAuth, users.updateMe);
api.post('/users/me/password', requireAuth, users.changePassword);

// Catalogue & search
api.get('/cities', trips.listCities);
api.get('/routes/popular', trips.popularRoutes);
api.get('/routes/:id', trips.getRoute);
api.get('/trips/search', trips.searchTrips);
api.get('/trips/:id', trips.getTrip);

// Bookings
api.post('/bookings', requireAuth, bookings.createBooking);
api.get('/bookings/me', requireAuth, bookings.myBookings);
api.get('/bookings/:id', requireAuth, bookings.getBooking);
api.post('/bookings/:id/pay', requireAuth, bookings.payBooking);
api.post('/bookings/:id/cancel', requireAuth, bookings.cancelBooking);

// Admin
const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.get('/stats', admin.stats);
adminRouter.get('/routes', admin.listRoutes);
adminRouter.get('/buses', admin.listBuses);
adminRouter.get('/trips', admin.listTrips);
adminRouter.post('/trips', admin.createTrip);
adminRouter.patch('/trips/:id', admin.updateTrip);
adminRouter.get('/bookings', admin.listBookings);
api.use('/admin', adminRouter);
