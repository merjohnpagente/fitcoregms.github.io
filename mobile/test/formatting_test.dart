import 'package:fitcore_gms/core/formatting.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('formats peso amounts', () {
    expect(formatPeso(1234.5), '₱1234.50');
    expect(formatPeso(null), '—');
  });

  test('formats dates', () {
    expect(formatDate(DateTime(2026, 1, 5)), 'Jan 5, 2026');
    expect(formatDate(null), '—');
  });

  test('counts membership days from today', () {
    final today = DateTime.now();
    final expiry = DateTime(today.year, today.month, today.day).add(const Duration(days: 7));
    expect(daysLeft(expiry), 7);
    expect(membershipLabel(expired: false, days: 7), '7 days left');
    expect(membershipLabel(expired: true, days: -1), 'Expired');
  });
}
