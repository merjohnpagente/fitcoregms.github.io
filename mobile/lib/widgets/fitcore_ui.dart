import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../data/models/app_user.dart';

class FitCoreLogo extends StatelessWidget {
  const FitCoreLogo({super.key, this.size = 76});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [FitCoreColors.primary, FitCoreColors.primaryDark],
        ),
        boxShadow: [
          BoxShadow(
            color: FitCoreColors.primary.withValues(alpha: 0.28),
            blurRadius: 30,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Icon(
        Icons.fitness_center_rounded,
        color: Colors.black,
        size: size * 0.44,
      ),
    );
  }
}

class FitCoreCard extends StatelessWidget {
  const FitCoreCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.color,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? FitCoreColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderColor ?? FitCoreColors.line),
      ),
      child: child,
    );
  }
}

class RoleBadge extends StatelessWidget {
  const RoleBadge({super.key, required this.role});

  final AppRole role;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: FitCoreColors.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: FitCoreColors.primary.withValues(alpha: 0.35)),
      ),
      child: Text(
        role.label.toUpperCase(),
        style: const TextStyle(
          color: FitCoreColors.primary,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.1,
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class AvatarCircle extends StatelessWidget {
  const AvatarCircle({super.key, required this.user, this.radius = 26});

  final AppUser user;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final avatar = user.avatarUrl;
    if (avatar != null && avatar.startsWith('http')) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: FitCoreColors.surfaceAlt,
        backgroundImage: NetworkImage(avatar),
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: FitCoreColors.primary.withValues(alpha: 0.14),
      child: Text(
        user.initials,
        style: TextStyle(
          color: FitCoreColors.primary,
          fontWeight: FontWeight.w900,
          fontSize: radius * 0.7,
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: FitCoreColors.muted),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: FitCoreColors.muted, height: 1.45),
            ),
          ],
        ),
      ),
    );
  }
}
