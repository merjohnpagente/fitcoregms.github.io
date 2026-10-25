import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/app_user.dart';
import 'auth_service.dart';

enum AuthPhase { initializing, signedOut, signedIn, pending }

class AuthController extends ChangeNotifier {
  AuthController({AuthService? service}) : _service = service ?? AuthService() {
    _subscription = _service.authStateChanges.listen(_onAuthStateChanged);
  }

  final AuthService _service;
  late final StreamSubscription<User?> _subscription;

  AuthPhase _phase = AuthPhase.initializing;
  AppUser? _user;
  String? _error;
  bool _busy = false;

  AuthPhase get phase => _phase;
  AppUser? get user => _user;
  String? get error => _error;
  bool get busy => _busy;

  Future<void> login({required String login, required String password}) async {
    if (_busy) return;
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      await _service.signIn(login: login, password: password);
      // The auth-state listener loads the profile and clears busy.
    } catch (error) {
      _busy = false;
      _phase = AuthPhase.signedOut;
      _error = authErrorMessage(error);
      notifyListeners();
    }
  }

  Future<void> logout() async {
    if (_busy) return;
    _busy = true;
    notifyListeners();
    try {
      await _service.signOut();
    } catch (error) {
      _busy = false;
      _error = authErrorMessage(error);
      notifyListeners();
    }
  }

  Future<void> refreshProfile() async {
    final current = _service.currentUser;
    if (current == null) return;
    await _loadProfile(current);
  }

  Future<void> sendPasswordReset(String email) => _service.sendPasswordReset(email);

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  Future<void> _loadProfile(User firebaseUser) async {
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      final profile = await _service.loadProfile(firebaseUser);
      if (profile == null) {
        await _service.signOut();
        _phase = AuthPhase.signedOut;
        _error = 'Your account profile could not be found. Contact the gym admin.';
      } else {
        _user = profile;
        _phase = profile.isPending || profile.isLocked ? AuthPhase.pending : AuthPhase.signedIn;
      }
    } catch (error) {
      _user = null;
      _phase = AuthPhase.signedOut;
      _error = authErrorMessage(error);
      await _service.signOut();
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  void _onAuthStateChanged(User? firebaseUser) {
    if (firebaseUser == null) {
      _user = null;
      _busy = false;
      _phase = AuthPhase.signedOut;
      notifyListeners();
      return;
    }
    _loadProfile(firebaseUser);
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
