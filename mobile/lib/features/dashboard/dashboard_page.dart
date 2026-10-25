import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatting.dart';
import '../../core/theme.dart';
import '../../data/models/app_user.dart';
import '../../data/services/auth_controller.dart';
import '../../widgets/fitcore_ui.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key, required this.user, required this.onSelectTab});

  final AppUser user;
  final ValueChanged<int> onSelectTab;

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthController>();
    return RefreshIndicator(
      color: FitCoreColors.primary,
      backgroundColor: FitCoreColors.surfaceAlt,
      onRefresh: auth.refreshProfile,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          _header(context),
          const SizedBox(height: 18),
          if (user.role == AppRole.member) ...[
            _membershipCard(),
            const SizedBox(height: 18),
          ],
          const SectionTitle('Quick tools'),
          _quickActions(),
          const SizedBox(height: 18),
          const SectionTitle('Account'),
          _accountCard(),
          const SizedBox(height: 18),
          _coreNote(),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    return FitCoreCard(
      padding: const EdgeInsets.all(18),
      color: FitCoreColors.surface,
      child: Row(
        children: [
          AvatarCircle(user: user, radius: 30),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$_greeting, ${user.name.split(' ').first}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 5),
                Row(
                  children: [
                    RoleBadge(role: user.role),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        user.role.dashboardTitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: FitCoreColors.muted, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Refresh profile',
            onPressed: () => context.read<AuthController>().refreshProfile(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
    );
  }

  Widget _membershipCard() {
    final expired = user.isExpired;
    final days = daysLeft(user.expiry);
    final label = membershipLabel(expired: expired, days: days);
    final color = expired ? FitCoreColors.danger : FitCoreColors.primary;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withValues(alpha: 0.16),
            FitCoreColors.surface,
          ],
        ),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.card_membership_rounded, color: color, size: 20),
              const SizedBox(width: 8),
              Text(
                'MEMBERSHIP',
                style: TextStyle(
                  color: color,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.4,
                ),
              ),
              const Spacer(),
              Text(
                label,
                style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            user.planName ?? 'No plan on profile',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            user.expiry == null ? 'Ask the front desk to set your expiry.' : 'Expires ${formatDate(user.expiry)}',
            style: const TextStyle(color: FitCoreColors.muted, fontSize: 12.5),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => onSelectTab(1),
            style: OutlinedButton.styleFrom(
              foregroundColor: color,
              side: BorderSide(color: color.withValues(alpha: 0.55)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.qr_code_2_rounded, size: 18),
            label: const Text('Open my QR'),
          ),
        ],
      ),
    );
  }

  Widget _quickActions() {
    final actions = switch (user.role) {
      AppRole.member => const [
          _Action(Icons.qr_code_2_rounded, 'My QR', 'Check-in code'),
          _Action(Icons.fact_check_outlined, 'Attendance', 'My visits'),
          _Action(Icons.event_available_outlined, 'Sessions', 'Bookings'),
          _Action(Icons.person_outline_rounded, 'Profile', 'Account'),
        ],
      AppRole.trainer => const [
          _Action(Icons.calendar_month_outlined, 'Schedule', 'All sessions'),
          _Action(Icons.assignment_ind_outlined, 'Assigned', 'My members'),
          _Action(Icons.menu_book_rounded, 'Library', 'Exercises'),
          _Action(Icons.person_outline_rounded, 'Profile', 'Account'),
        ],
      AppRole.staff || AppRole.admin => const [
          _Action(Icons.groups_2_outlined, 'Members', 'Records'),
          _Action(Icons.payments_outlined, 'Billing', 'Payments'),
          _Action(Icons.qr_code_scanner_rounded, 'Scanner', 'Check-in'),
          _Action(Icons.grid_view_rounded, 'More', 'Tools'),
        ],
    };

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: actions.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 2.25,
      ),
      itemBuilder: (context, index) {
        final action = actions[index];
        return Material(
          color: FitCoreColors.surface,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => onSelectTab(index),
            child: Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: FitCoreColors.line),
              ),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: FitCoreColors.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(action.icon, color: FitCoreColors.primary, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          action.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                        ),
                        Text(
                          action.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: FitCoreColors.muted, fontSize: 10.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _accountCard() {
    final expired = user.isExpired;
    return FitCoreCard(
      child: Column(
        children: [
          _row(Icons.alternate_email_rounded, 'Email', user.email ?? '—'),
          const Divider(height: 22),
          _row(Icons.badge_outlined, 'Username', user.username),
          const Divider(height: 22),
          _row(Icons.verified_user_outlined, 'Status', user.status.isEmpty ? 'active' : user.status),
          if (user.role == AppRole.member) ...[
            const Divider(height: 22),
            _row(
              Icons.event_busy_outlined,
              'Membership',
              expired ? 'Expired' : 'Active',
              valueColor: expired ? FitCoreColors.danger : FitCoreColors.primary,
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(IconData icon, String label, String value, {Color? valueColor}) {
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
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: valueColor,
            ),
          ),
        ),
      ],
    );
  }

  Widget _coreNote() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: FitCoreColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: FitCoreColors.primary.withValues(alpha: 0.18)),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, size: 17, color: FitCoreColors.primary),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'Core build: auth, dashboards, members, billing, attendance and schedule arrive in the next milestones.',
              style: TextStyle(color: FitCoreColors.muted, fontSize: 11.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

class _Action {
  const _Action(this.icon, this.label, this.subtitle);

  final IconData icon;
  final String label;
  final String subtitle;
}
