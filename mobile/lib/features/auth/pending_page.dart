import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../data/models/app_user.dart';
import '../../data/services/auth_controller.dart';
import '../../widgets/fitcore_ui.dart';

class PendingPage extends StatelessWidget {
  const PendingPage({super.key, required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final locked = user.isLocked;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: FitCoreCard(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      locked ? Icons.lock_outline_rounded : Icons.hourglass_top_rounded,
                      size: 48,
                      color: locked ? FitCoreColors.danger : FitCoreColors.gold,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      locked ? 'Account unavailable' : 'Waiting for approval',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      locked
                          ? 'This account has been locked or disabled. Please contact the gym admin.'
                          : 'Your account is pending admin approval. You can refresh once the front desk confirms it.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: FitCoreColors.muted, height: 1.5),
                    ),
                    const SizedBox(height: 22),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: FitCoreColors.surfaceAlt,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        children: [
                          AvatarCircle(user: user, radius: 22),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user.name,
                                  style: const TextStyle(fontWeight: FontWeight.w800),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${user.role.label} • ${user.status}',
                                  style: const TextStyle(
                                    color: FitCoreColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (auth.error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        auth.error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: FitCoreColors.danger, fontSize: 12.5),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: auth.busy ? null : auth.refreshProfile,
                      child: auth.busy
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: Colors.black,
                              ),
                            )
                          : const Text('Refresh status'),
                    ),
                    const SizedBox(height: 6),
                    TextButton(
                      onPressed: auth.busy ? null : auth.logout,
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
