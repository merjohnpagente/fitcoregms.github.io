import 'package:cloud_firestore/cloud_firestore.dart';

enum AppRole { member, trainer, staff, admin }

extension AppRoleLabel on AppRole {
  String get label => switch (this) {
        AppRole.member => 'Member',
        AppRole.trainer => 'Trainer',
        AppRole.staff => 'Staff',
        AppRole.admin => 'Admin',
      };

  String get dashboardTitle => switch (this) {
        AppRole.member => 'My dashboard',
        AppRole.trainer => 'Trainer dashboard',
        AppRole.staff => 'Front desk',
        AppRole.admin => 'Admin dashboard',
      };

  static AppRole parse(Object? value, {AppRole fallback = AppRole.member}) {
    final raw = (value ?? '').toString().trim().toLowerCase();
    return switch (raw) {
      'member' || 'client' => AppRole.member,
      'trainer' || 'coach' => AppRole.trainer,
      'staff' || 'employee' => AppRole.staff,
      'admin' || 'owner' || 'administrator' => AppRole.admin,
      _ => fallback,
    };
  }
}

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.status,
    this.email,
    this.planName,
    this.expiry,
    this.avatarUrl,
    this.raw = const <String, dynamic>{},
  });

  final String id;
  final String name;
  final String username;
  final String? email;
  final AppRole role;
  final String status;
  final String? planName;
  final DateTime? expiry;
  final String? avatarUrl;
  final Map<String, dynamic> raw;

  bool get isActive => status == 'active' || status == 'approved' || status.isEmpty;
  bool get isPending => status == 'pending' || status == 'waiting';
  bool get isLocked => status == 'locked' || status == 'disabled' || status == 'inactive';
  bool get isExpired {
    final end = expiry;
    if (end == null) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final expiryDay = DateTime(end.year, end.month, end.day);
    return expiryDay.isBefore(today);
  }

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return '${parts.first.substring(0, 1)}${parts.last.substring(0, 1)}'.toUpperCase();
  }

  factory AppUser.fromMap(
    String id,
    Map<String, dynamic> data, {
    required AppRole fallbackRole,
  }) {
    final first = _text(data['firstName'] ?? data['first_name']);
    final last = _text(data['lastName'] ?? data['last_name']);
    final joined = [first, last].whereType<String>().where((part) => part.isNotEmpty).join(' ');
    final name = _text(data['name'] ?? data['fullName'] ?? data['displayName']) ??
        (joined.isNotEmpty ? joined : null) ??
        _text(data['username']) ??
        'FitCore user';
    final username = _text(data['username']) ?? (name.toLowerCase().replaceAll(RegExp(r'\s+'), ''));
    final role = AppRoleLabel.parse(data['role'], fallback: fallbackRole);

    final locked = data['locked'] == true || data['disabled'] == true;
    final approved = data['approved'];
    final explicitStatus = _text(data['status'] ?? data['accountStatus']);
    final status = explicitStatus?.toLowerCase() ??
        (locked
            ? 'locked'
            : approved == false
                ? 'pending'
                : 'active');

    return AppUser(
      id: id,
      name: name,
      username: username,
      email: _text(data['email']),
      role: role,
      status: status,
      planName: _text(data['planName'] ?? data['plan'] ?? data['membershipPlan']),
      expiry: _date(data['expiry'] ?? data['expiryDate'] ?? data['membershipExpiry'] ?? data['planExpiry']),
      avatarUrl: _text(data['avatar'] ?? data['photoUrl'] ?? data['avatarUrl']),
      raw: Map<String, dynamic>.unmodifiable(data),
    );
  }

  static String? _text(Object? value) {
    final text = value?.toString().trim();
    return text == null || text.isEmpty ? null : text;
  }

  static DateTime? _date(Object? value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    if (value is Timestamp) return value.toDate();
    if (value is int) {
      return DateTime.fromMillisecondsSinceEpoch(value);
    }
    return DateTime.tryParse(value.toString());
  }
}
