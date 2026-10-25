import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../core/app_config.dart';
import '../../core/login_resolver.dart';
import '../models/app_user.dart';

class AuthService {
  AuthService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;

  Stream<User?> get authStateChanges => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  Future<void> signIn({required String login, required String password}) async {
    final raw = login.trim().toLowerCase();
    final member = await _findMember(raw);
    final candidates = loginEmailCandidates(
      login: raw,
      memberAuthEmail: _text(member?['authEmail']),
      memberEmail: _text(member?['email']),
    );

    if (candidates.isEmpty) {
      throw const AuthFailure('Enter your username or email.');
    }

    FirebaseAuthException? lastError;
    for (final email in candidates) {
      try {
        await _auth.signInWithEmailAndPassword(email: email, password: password);
        return;
      } on FirebaseAuthException catch (error) {
        lastError = error;
        if (error.code == 'too-many-requests' || error.code == 'user-disabled') {
          rethrow;
        }
      }
    }

    throw lastError ?? const AuthFailure('Invalid username or password.');
  }

  Future<void> sendPasswordReset(String email) async {
    final value = email.trim();
    if (value.isEmpty || !value.contains('@')) {
      throw const AuthFailure('Enter the email address on your account.');
    }
    await _auth.sendPasswordResetEmail(email: value.toLowerCase());
  }

  Future<void> signOut() => _auth.signOut();

  Future<AppUser?> loadProfile(User firebaseUser) async {
    final email = firebaseUser.email?.toLowerCase();
    final localPart = email?.split('@').first;
    final uid = firebaseUser.uid;

    for (var attempt = 0; attempt < 3; attempt++) {
      final staff = await _findProfile(
        collection: 'users',
        id: uid,
        emails: [email],
        usernames: [localPart],
      );
      if (staff != null) {
        return AppUser.fromMap(
          staff.id,
          staff.data,
          fallbackRole: AppRole.staff,
        );
      }

      final member = await _findProfile(
        collection: 'members',
        id: uid,
        emails: [email],
        usernames: [localPart],
      );
      if (member != null) {
        return AppUser.fromMap(
          member.id,
          member.data,
          fallbackRole: AppRole.member,
        );
      }

      if (attempt < 2) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
      }
    }

    // Last resort: a member document whose id matches the Auth uid.
    for (final collection in ['members', 'users']) {
      try {
        final doc = await _db.collection(collection).doc(uid).get();
        if (doc.exists) {
          return AppUser.fromMap(
            doc.id,
            doc.data() ?? const <String, dynamic>{},
            fallbackRole: collection == 'users' ? AppRole.staff : AppRole.member,
          );
        }
      } catch (_) {
        // Rules can deny this lookup; the queries above are the normal path.
      }
    }
    return null;
  }

  Future<Map<String, dynamic>?> _findMember(String login) async {
    final synthetic = '$login${AppConfig.authDomainSuffix}';
    final queries = <MapEntry<String, String>>[
      MapEntry('username', login),
      MapEntry('authEmail', login),
      if (!login.contains('@')) MapEntry('authEmail', synthetic),
      if (login.contains('@')) MapEntry('email', login),
    ];

    for (final query in queries) {
      try {
        final snap = await _db
            .collection('members')
            .where(query.key, isEqualTo: query.value)
            .limit(1)
            .get();
        if (snap.docs.isNotEmpty) {
          return snap.docs.first.data();
        }
      } catch (_) {
        // Public member reads should succeed; ignore transient failures and
        // let Firebase Auth produce the user-facing error.
      }
    }
    return null;
  }

  Future<({String id, Map<String, dynamic> data})?> _findProfile({
    required String collection,
    required String id,
    required List<String?> emails,
    required List<String?> usernames,
  }) async {
    final cleanEmails = emails.whereType<String>().where((value) => value.isNotEmpty).toSet();
    final cleanUsernames = usernames.whereType<String>().where((value) => value.isNotEmpty).toSet();

    for (final field in ['authEmail', 'email']) {
      for (final value in cleanEmails) {
        final data = await _queryOne(collection, field, value);
        if (data != null) return data;
      }
    }
    for (final value in cleanUsernames) {
      final data = await _queryOne(collection, 'username', value);
      if (data != null) return data;
    }
    for (final field in ['uid', 'authUid']) {
      final data = await _queryOne(collection, field, id);
      if (data != null) return data;
    }
    return null;
  }

  Future<({String id, Map<String, dynamic> data})?> _queryOne(
    String collection,
    String field,
    String value,
  ) async {
    try {
      final snap = await _db
          .collection(collection)
          .where(field, isEqualTo: value)
          .limit(1)
          .get();
      if (snap.docs.isEmpty) return null;
      final doc = snap.docs.first;
      return (id: doc.id, data: doc.data());
    } catch (_) {
      return null;
    }
  }

  static String? _text(Object? value) {
    final text = value?.toString().trim();
    return text == null || text.isEmpty ? null : text;
  }
}

class AuthFailure implements Exception {
  const AuthFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

String authErrorMessage(Object error) {
  if (error is AuthFailure) return error.message;
  if (error is FirebaseAuthException) {
    return switch (error.code) {
      'invalid-credential' || 'wrong-password' || 'user-not-found' => 'Invalid username or password.',
      'too-many-requests' => 'Too many attempts. Please try again later.',
      'network-request-failed' => 'Network error. Check your connection and try again.',
      'user-disabled' => 'This account has been disabled.',
      'weak-password' => 'Password must be at least 8 characters.',
      'email-already-in-use' => 'That username or email is already registered.',
      _ => 'Sign-in failed. Please try again.',
    };
  }
  return 'Something went wrong. Please try again.';
}
