import { BookingStatus } from '../../core/models';

/** Badge colour class for a booking status. */
export function statusBadge(status: BookingStatus | undefined): string {
  switch (status) {
    case 'confirmed':
      return 'badge-success';
    case 'completed':
      return 'badge-info';
    case 'pending':
      return 'badge-warning';
    default:
      return 'badge-danger';
  }
}
