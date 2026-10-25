import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/services/auth_controller.dart';
import '../shell/app_shell.dart';
import '../../widgets/fitcore_ui.dart';
import 'login_page.dart';
import 'pending_page.dart';

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final user = auth.user;

    return switch (auth.phase) {
      AuthPhase.initializing => const _SplashPage(),
      AuthPhase.signedOut => const LoginPage(),
      AuthPhase.pending => user == null ? const LoginPage() : PendingPage(user: user),
      AuthPhase.signedIn => user == null ? const LoginPage() : AppShell(user: user),
    };
  }
}

class _SplashPage extends StatelessWidget {
  const _SplashPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const FitCoreLogo(),
            const SizedBox(height: 22),
            const Text(
              'FITCORE',
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                letterSpacing: 5,
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
