import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/models/app_user.dart';
import '../../widgets/fitcore_ui.dart';
import '../dashboard/dashboard_page.dart';
import '../profile/profile_view.dart';
import 'feature_placeholder.dart';
import 'more_page.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.user});

  final AppUser user;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  List<_NavItem> get _items => switch (widget.user.role) {
        AppRole.member => const [
            _NavItem('Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard_rounded),
            _NavItem('My QR', Icons.qr_code_2_outlined, Icons.qr_code_2_rounded),
            _NavItem('Attendance', Icons.fact_check_outlined, Icons.fact_check_rounded),
            _NavItem('Sessions', Icons.event_available_outlined, Icons.event_available_rounded),
            _NavItem('Profile', Icons.person_outline_rounded, Icons.person_rounded),
          ],
        AppRole.trainer => const [
            _NavItem('Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard_rounded),
            _NavItem('Schedule', Icons.calendar_month_outlined, Icons.calendar_month_rounded),
            _NavItem('Assigned', Icons.assignment_ind_outlined, Icons.assignment_ind_rounded),
            _NavItem('Library', Icons.menu_book_outlined, Icons.menu_book_rounded),
            _NavItem('Profile', Icons.person_outline_rounded, Icons.person_rounded),
          ],
        AppRole.staff || AppRole.admin => const [
            _NavItem('Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard_rounded),
            _NavItem('Members', Icons.groups_2_outlined, Icons.groups_2_rounded),
            _NavItem('Billing', Icons.payments_outlined, Icons.payments_rounded),
            _NavItem('Scanner', Icons.qr_code_scanner_outlined, Icons.qr_code_scanner_rounded),
            _NavItem('More', Icons.grid_view_outlined, Icons.grid_view_rounded),
          ],
      };

  List<Widget> _pages() {
    final user = widget.user;
    return switch (user.role) {
      AppRole.member => [
          DashboardPage(user: user, onSelectTab: _select),
          const FeaturePlaceholder(
            icon: Icons.qr_code_2_rounded,
            title: 'My QR',
            message: 'Your check-in QR will live here, generated from the same signed token as the web app.',
            items: ['Refresh code', 'Save to gallery', 'Copy token'],
          ),
          const FeaturePlaceholder(
            icon: Icons.fact_check_rounded,
            title: 'My attendance',
            message: 'See your gym visits and check-in/out history.',
            items: ['Today status', 'Visit history', 'Total visits'],
          ),
          const FeaturePlaceholder(
            icon: Icons.event_available_rounded,
            title: 'My sessions',
            message: 'Book a trainer session and manage upcoming bookings.',
            items: ['Available slots', 'Book or reschedule', 'Session status'],
          ),
          ProfileView(user: user),
        ],
      AppRole.trainer => [
          DashboardPage(user: user, onSelectTab: _select),
          const FeaturePlaceholder(
            icon: Icons.calendar_month_rounded,
            title: 'Schedule',
            message: 'The full session calendar with trainer availability.',
            items: ['Day, week and month views', 'Create sessions', 'Filter by trainer'],
          ),
          const FeaturePlaceholder(
            icon: Icons.assignment_ind_rounded,
            title: 'My assigned sessions',
            message: 'Sessions assigned to you, ready for confirmation and completion.',
            items: ['Pending requests', 'Today’s sessions', 'Completed history'],
          ),
          const FeaturePlaceholder(
            icon: Icons.menu_book_rounded,
            title: 'Exercise library',
            message: 'Browse the FitCore exercise catalogue and build workout plans.',
            items: ['Muscle filters', 'Workout builder', 'Member plans'],
          ),
          ProfileView(user: user),
        ],
      AppRole.staff || AppRole.admin => [
          DashboardPage(user: user, onSelectTab: _select),
          const FeaturePlaceholder(
            icon: Icons.groups_2_rounded,
            title: 'Members',
            message: 'Search member records, open profiles, add members and manage expiry.',
            items: ['Search and filter', 'Add or edit member', 'Membership status'],
          ),
          const FeaturePlaceholder(
            icon: Icons.payments_rounded,
            title: 'Billing',
            message: 'Record payments, confirm renewals and open receipts.',
            items: ['Cash, GCash and bank', 'Confirm payment', 'Renewals and receipts'],
          ),
          const FeaturePlaceholder(
            icon: Icons.qr_code_scanner_rounded,
            title: 'Scanner',
            message: 'Scan a member QR or paste a token to check them in or out.',
            items: ['Camera scanner', 'Manual token entry', 'Check-in and checkout'],
          ),
          MorePage(user: user),
        ],
    };
  }

  void _select(int index) {
    if (index == _index) return;
    setState(() => _index = index);
  }

  void _openProfile() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('My profile')),
          body: ProfileView(user: widget.user),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final safeIndex = _index < items.length ? _index : items.length - 1;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: 20,
        title: Row(
          children: [
            const FitCoreLogo(size: 30),
            const SizedBox(width: 10),
            Text(
              items[safeIndex].label,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
          ],
        ),
        actions: [
          GestureDetector(
            onTap: _openProfile,
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: AvatarCircle(user: widget.user, radius: 17),
            ),
          ),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1),
        ),
      ),
      body: IndexedStack(index: safeIndex, children: _pages()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: safeIndex,
        onDestinationSelected: _select,
        backgroundColor: FitCoreColors.surface,
        indicatorColor: FitCoreColors.primary.withValues(alpha: 0.16),
        height: 72,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          for (final item in items)
            NavigationDestination(
              icon: Icon(item.icon),
              selectedIcon: Icon(item.selectedIcon, color: FitCoreColors.primary),
              label: item.label,
            ),
        ],
      ),
    );
  }
}

class _NavItem {
  const _NavItem(this.label, this.icon, this.selectedIcon);

  final String label;
  final IconData icon;
  final IconData selectedIcon;
}
