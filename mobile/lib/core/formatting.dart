import 'package:intl/intl.dart';

String formatPeso(num? amount) {
  if (amount == null) return '—';
  return '₱${amount.toStringAsFixed(2)}';
}

String formatDate(DateTime? date) {
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy').format(date);
}

String formatDateTime(DateTime? date) {
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy • h:mm a').format(date);
}

int? daysLeft(DateTime? date) {
  if (date == null) return null;
  final today = DateTime.now();
  final start = DateTime(today.year, today.month, today.day);
  final end = DateTime(date.year, date.month, date.day);
  return end.difference(start).inDays;
}

String membershipLabel({required bool expired, int? days}) {
  if (expired) return 'Expired';
  if (days == null) return 'No expiry set';
  if (days <= 0) return 'Expires today';
  return '$days day${days == 1 ? '' : 's'} left';
}
