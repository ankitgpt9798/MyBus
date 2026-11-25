import { Router } from 'express';
import mongoose from 'mongoose';
import * as admin from '../controllers/admin.controller';
import * as auth from '../controllers/auth.controller';
import * as bookings from '../controllers/booking.controller';
import * as community from '../controllers/community.controller';
import * as notifications from '../controllers/notification.controller';
import * as profiles from '../controllers/profile.controller';
import * as promotions from '../controllers/promotion.controller';
import * as reviews from '../controllers/review.controller';
import * as trips from '../controllers/trip.controller';
import * as users from '../controllers/user.controller';
import { optionalAuth, requireAdmin, requireAuth, requireVerified } from '../middleware/auth';
import { photoUpload } from '../services/upload.service';

export const api = Router();

api.get('/health', (_req, res) => {
  const db = mongoose.connection.readyState === mongoose.ConnectionStates.connected ? 'connected' : 'disconnected';
  res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db, time: new Date().toISOString() });
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

// Public profiles (R1): visible activity only; never an email
api.get('/users/:id/profile', optionalAuth, profiles.profile);
api.get('/users/:id/posts', optionalAuth, profiles.posts);
api.get('/users/:id/comments', optionalAuth, profiles.comments);
api.get('/users/:id/reviews', optionalAuth, profiles.reviews);
api.get('/users/:id/activity', optionalAuth, profiles.activity);

// Catalogue & search
api.get('/cities', trips.listCities);
api.get('/routes', trips.listAllRoutes);
api.get('/routes/popular', trips.popularRoutes);
api.get('/routes/:id', trips.getRoute);
api.get('/routes/:id/reviews', optionalAuth, reviews.listForRoute);

// Community (R1): reading and sharing are public; posting, commenting, liking and reporting need a verified account
api.get('/community/boards', community.boards);
api.get('/community/trending', optionalAuth, community.trending);
api.get('/community/contributors', community.contributors);
api.get('/community/posts', optionalAuth, community.listPosts);
api.get('/community/posts/:id', optionalAuth, community.getPost);
api.post('/community/posts', requireAuth, requireVerified, photoUpload, community.createPost);
api.patch('/community/posts/:id', requireAuth, requireVerified, photoUpload, community.updatePost);
api.delete('/community/posts/:id', requireAuth, community.deletePost);
api.post('/community/posts/:id/like', requireAuth, requireVerified, community.likePost);
api.post('/community/posts/:id/report', requireAuth, requireVerified, community.reportPost);
api.post('/community/posts/:id/share', community.sharePost);
api.post('/community/posts/:id/visit', community.visitPost);
api.post('/community/posts/:id/comments', requireAuth, requireVerified, community.addComment);
api.delete('/community/comments/:id', requireAuth, community.deleteComment);
api.post('/community/comments/:id/like', requireAuth, requireVerified, community.likeComment);
api.post('/community/comments/:id/report', requireAuth, requireVerified, community.reportComment);

// Reviews (R6): only verified users who completed the journey can post; edits within 24 h
api.get('/reviews/eligible', requireAuth, reviews.eligible);
api.post('/reviews', requireAuth, requireVerified, reviews.create);
api.patch('/reviews/:id', requireAuth, requireVerified, reviews.update);
api.post('/reviews/:id/report', requireAuth, requireVerified, reviews.report);
api.post('/reviews/:id/helpful', requireAuth, requireVerified, reviews.toggleHelpful);
api.get('/trips/search', trips.searchTrips);
api.get('/trips/:id', trips.getTrip);

// Bookings
api.post('/bookings', requireAuth, bookings.createBooking);
api.get('/bookings/me', requireAuth, bookings.myBookings);
api.get('/bookings/:id', requireAuth, bookings.getBooking);
api.put('/bookings/:id/passengers', requireAuth, bookings.updateBookingDetails);
api.post('/bookings/:id/pay', requireAuth, bookings.payBooking);
api.post('/bookings/:id/cancel', requireAuth, bookings.cancelBooking);

// Notifications (in-app inbox)
api.get('/notifications', requireAuth, notifications.listMine);
api.get('/notifications/unread-count', requireAuth, notifications.unreadCount);
api.get('/notifications/push/public-key', notifications.pushPublicKey);
api.post('/notifications/push/subscribe', requireAuth, notifications.pushSubscribe);
api.post('/notifications/push/unsubscribe', requireAuth, notifications.pushUnsubscribe);
api.post('/notifications/stream-token', requireAuth, notifications.streamToken);
api.get('/notifications/stream', notifications.stream); // authenticated by the short-lived stream token
api.post('/notifications/read-all', requireAuth, notifications.markAllRead);
api.post('/notifications/:id/read', requireAuth, notifications.markRead);

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
adminRouter.get('/notifications', notifications.adminList);
adminRouter.post('/notifications/:id/retry', notifications.adminRetry);
adminRouter.get('/reviews', reviews.adminList);
adminRouter.post('/reviews/:id/hide', reviews.adminHide);
adminRouter.post('/reviews/:id/remove', reviews.adminRemove);
adminRouter.post('/reviews/:id/restore', reviews.adminRestore);
adminRouter.get('/community', community.adminList);
adminRouter.post('/community/:type/:id/hide', community.adminHide);
adminRouter.post('/community/:type/:id/remove', community.adminRemove);
adminRouter.post('/community/:type/:id/restore', community.adminRestore);
adminRouter.get('/promotions', promotions.list);
adminRouter.post('/promotions/preview', promotions.preview);
adminRouter.post('/promotions', promotions.send);
api.use('/admin', adminRouter);
