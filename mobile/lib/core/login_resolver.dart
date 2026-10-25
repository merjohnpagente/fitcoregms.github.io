import 'app_config.dart';

/// Builds the email candidates used for Firebase Auth, in priority order.
///
/// Members can log in with a username, a real email, or the legacy synthetic
/// email. Staff have no public profile lookup, so their username is mapped to
/// the synthetic domain and real emails are tried as-is.
List<String> loginEmailCandidates({
  required String login,
  String? memberAuthEmail,
  String? memberEmail,
}) {
  final raw = login.trim().toLowerCase();
  if (raw.isEmpty) return const <String>[];

  final candidates = <String>[];
  void add(String? value) {
    final email = value?.trim().toLowerCase();
    if (email == null || !email.contains('@') || candidates.contains(email)) return;
    candidates.add(email);
  }

  add(memberAuthEmail);
  add(memberEmail);
  if (raw.contains('@')) {
    add(raw);
    add('${raw.split('@').first}${AppConfig.authDomainSuffix}');
  } else {
    add('$raw${AppConfig.authDomainSuffix}');
  }
  return candidates;
}
