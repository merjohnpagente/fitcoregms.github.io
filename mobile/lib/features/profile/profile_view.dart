import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config.dart';
import '../../core/formatting.dart';
import '../../core/theme.dart';
import '../../data/models/app_user.dart';
import '../../data/services/auth_controller.dart';
import '../../widgets/fitcore_ui.dart';

class ProfileView extends StatelessWidget {
  const ProfileView({super.key, required this.user});

  final AppUser user;

  Future<void> _confirmLogout(BuildContext context) async {
    final auth = context.read<AuthController>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: FitCoreColors.surface,
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again to use FitCore.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(minimumSize: const Size(96, 44)),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await auth.logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final expired = user.isExpired;
    final days = daysLeft(user.expiry);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        FitCoreCard(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              AvatarCircle(user: user, radius: 38),
              const SizedBox(height: 12),
              Text(
                user.name,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              Text(
                user.email ?? user.username,
                textAlign: TextAlign.center,
                style: const TextStyle(color: FitCoreColors.muted, fontSize: 12.5),
              ),
              const SizedBox(height: 10),
              RoleBadge(role: user.role),
            ],
          ),
        ),
        if (user.role == AppRole.member) ...[
          const SizedBox(height: 16),
          FitCoreCard(
            borderColor: (expired ? FitCoreColors.danger : FitCoreColors.primary)
                .withValues(alpha: 0.4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'MEMBERSHIP',
                  style: TextStyle(
                    color: FitCoreColors.muted,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.4,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  user.planName ?? 'No plan on profile',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text(
                  user.expiry == null
                      ? 'No expiry set'
                      : '${formatDate(user.expiry)} • ${membershipLabel(expired: expired, days: days)}',
                  style: TextStyle(
                    color: expired ? FitCoreColors.danger : FitCoreColors.primary,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        FitCoreCard(
          child: Column(
            children: [
              _infoRow(Icons.badge_outlined, 'Username', user.username),
              const Divider(height: 22),
              _infoRow(Icons.alternate_email_rounded, 'Email', user.email ?? '—'),
              const Divider(height: 22),
              _infoRow(Icons.verified_user_outlined, 'Status', user.status),
              const Divider(height: 22),
              _infoRow(Icons.person_pin_circle_outlined, 'Account ID', user.id),
            ],
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.tonalIcon(
          onPressed: auth.busy ? null : auth.refreshProfile,
          style: FilledButton.styleFrom(
            backgroundColor: FitCoreColors.surfaceAlt,
            foregroundColor: FitCoreColors.text,
            minimumSize: const Size.fromHeight(50),
          ),
          icon: auth.busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: FitCoreColors.primary,
                  ),
                )
              : const Icon(Icons.refresh_rounded, size: 19),
          label: const Text('Refresh profile'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: auth.busy ? null : () => _confirmLogout(context),
          style: OutlinedButton.styleFrom(
            foregroundColor: FitCoreColors.danger,
            side: BorderSide(color: FitCoreColors.danger.withValues(alpha: 0.5)),
            minimumSize: const Size.fromHeight(50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          icon: const Icon(Icons.logout_rounded, size: 19),
          label: const Text('Sign out'),
        ),
        const SizedBox(height: 22),
        const Text(
          '${AppConfig.appName} v${AppConfig.version}',
          textAlign: TextAlign.center,
          style: TextStyle(color: FitCoreColors.muted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 18, color: FitCoreColors.muted),
        const SizedBox(width: 10),
        Expanded(
          child: Text(label, style: const TextStyle(color: FitCoreColors.muted, fontSize: 12.5)),
        ),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}
