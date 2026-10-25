import 'package:fitcore_gms/core/login_resolver.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('loginEmailCandidates', () {
    test('prefers the member auth email', () {
      final result = loginEmailCandidates(
        login: 'Juan',
        memberAuthEmail: 'juan@fitcoregym.local',
        memberEmail: 'juan@gmail.com',
      );
      expect(result.first, 'juan@fitcoregym.local');
      expect(result, contains('juan@gmail.com'));
    });

    test('uses a real email as-is', () {
      final result = loginEmailCandidates(login: 'juan@gmail.com');
      expect(result.first, 'juan@gmail.com');
    });

    test('maps a bare username to the synthetic domain', () {
      final result = loginEmailCandidates(login: '  Admin  ');
      expect(result, ['admin@fitcoregym.local']);
    });

    test('deduplicates candidates', () {
      final result = loginEmailCandidates(
        login: 'juan@fitcoregym.local',
        memberAuthEmail: 'juan@fitcoregym.local',
      );
      expect(result.where((email) => email == 'juan@fitcoregym.local').length, 1);
    });

    test('returns nothing for an empty login', () {
      expect(loginEmailCandidates(login: '   '), isEmpty);
    });
  });
}
