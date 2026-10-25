import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config.dart';
import '../../core/theme.dart';
import '../../data/models/app_user.dart';
import '../../data/services/auth_controller.dart';
import '../../widgets/fitcore_ui.dart';
import '../profile/profile_view.dart';
import 'feature_placeholder.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key, required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final tools = user.role == AppRole.admin
        ? const [
            _Tool(
              Icons.manage_accounts_outlined,
              'Users',
              'Staff, trainers, approvals',
              'Manage staff, trainers and admin accounts, approve pending registrations and lock accounts.',
              ['Staff and trainer list', 'Approve pending users', 'Role and lock controls'],
            ),
            _Tool(
              Icons.workspace_premium_outlined,
              'Plans',
              'Membership catalogue',
              'Create and edit the membership plans shown on the landing page and signup flow.',
              ['Plan name and price', 'Duration and inclusions', 'Unlimited toggle'],
            ),
            _Tool(
              Icons.insights_outlined,
              'Reports',
              'Revenue and attendance',
              'Generate revenue, membership and attendance summaries for the gym.',
              ['Date range filters', 'Member and trainer reports', 'CSV export'],
            ),
            _Tool(
              Icons.history_rounded,
              'Activity log',
              'Audit trail',
              'Review staff actions across members, billing and account management.',
              ['Newest first', 'Staff and admin only', 'Print and export'],
            ),
          ]
        : const [
            _Tool(
              Icons.groups_2_outlined,
              'Queue',
              'Walk-in queue',
              'Track the walk-in queue and send visitors to the next available station.',
              ['Live queue', 'Select and remove entries', 'Badge count'],
            ),
            _Tool(
              Icons.directions_walk_rounded,
              'Walk-ins',
              'Day passes',
              'Record day-pass visitors and collect the walk-in fee.',
              ['Visitor details', 'Fee settings', 'Receipt'],
            ),
            _Tool(
              Icons.calendar_month_outlined,
              'Schedule',
              'Sessions and trainers',
              'View trainer schedules, create sessions and manage bookings.',
              ['Day, week and month views', 'Trainer availability', 'Session status'],
            ),
            _Tool(
              Icons.replay_rounded,
              'Renewals',
              'Expiring memberships',
              'Find expiring memberships and send them to billing for renewal.',
              ['Expiry scanning', 'Renewal list', 'Receipt lookup'],
            ),
          ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        FitCoreCard(
          child: Row(
            children: [
              AvatarCircle(user: user, radius: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      user.email ?? user.username,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: FitCoreColors.muted, fontSize: 12),
                    ),
                  ],
                ),
              ),
              RoleBadge(role: user.role),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const SectionTitle('Management'),
        FitCoreCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var index = 0; index < tools.length; index++) ...[
                _tile(
                  context,
                  icon: tools[index].icon,
                  title: tools[index].title,
                  subtitle: tools[index].subtitle,
                  onTap: () => openPlaceholder(
                    context,
                    icon: tools[index].icon,
                    title: tools[index].title,
                    message: tools[index].message,
                    items: tools[index].items,
                  ),
                ),
                if (index != tools.length - 1)
                  const Divider(height: 1, indent: 58),
              ],
            ],
          ),
        ),
        const SizedBox(height: 18),
        const SectionTitle('Account'),
        FitCoreCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _tile(
                context,
                icon: Icons.person_outline_rounded,
                title: 'My profile',
                subtitle: 'Details, membership and sign out',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => Scaffold(
                      appBar: AppBar(title: const Text('My profile')),
                      body: ProfileView(user: user),
                    ),
                  ),
                ),
              ),
              const Divider(height: 1, indent: 58),
              _tile(
                context,
                icon: Icons.logout_rounded,
                title: 'Sign out',
                subtitle: 'End this session',
                color: FitCoreColors.danger,
                onTap: auth.busy ? null : () => _logout(context),
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        Text(
          '${AppConfig.appName} v${AppConfig.version}',
          textAlign: TextAlign.center,
          style: const TextStyle(color: FitCoreColors.muted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _tile(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    VoidCallback? onTap,
    Color? color,
  }) {
    final tile = ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: (color ?? FitCoreColors.primary).withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, size: 18, color: color ?? FitCoreColors.primary),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: Text(subtitle, style: const TextStyle(color: FitCoreColors.muted, fontSize: 11.5)),
      trailing: const Icon(Icons.chevron_right_rounded, color: FitCoreColors.muted, size: 20),
    );

    if (onTap != null) return tile;
    return Opacity(
      opacity: 0.55,
      child: tile,
    );
  }

  Future<void> _logout(BuildContext context) async {
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
}

class _Tool {
  const _Tool(this.icon, this.title, this.subtitle, this.message, this.items);

  final IconData icon;
  final String title;
  final String subtitle;
  final String message;
  final List<String> items;
}
