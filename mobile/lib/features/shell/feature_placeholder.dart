import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../widgets/fitcore_ui.dart';

class FeaturePlaceholder extends StatelessWidget {
  const FeaturePlaceholder({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.items = const <String>[],
  });

  final IconData icon;
  final String title;
  final String message;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
      children: [
        Center(
          child: Container(
            width: 74,
            height: 74,
            decoration: BoxDecoration(
              color: FitCoreColors.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
              border: Border.all(color: FitCoreColors.primary.withValues(alpha: 0.3)),
            ),
            child: Icon(icon, color: FitCoreColors.primary, size: 34),
          ),
        ),
        const SizedBox(height: 18),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: FitCoreColors.muted, height: 1.5),
        ),
        if (items.isNotEmpty) ...[
          const SizedBox(height: 24),
          FitCoreCard(
            child: Column(
              children: [
                for (var index = 0; index < items.length; index++) ...[
                  Row(
                    children: [
                      const Icon(Icons.check_circle_outline_rounded,
                          size: 18, color: FitCoreColors.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          items[index],
                          style: const TextStyle(fontSize: 13.5, height: 1.4),
                        ),
                      ),
                    ],
                  ),
                  if (index != items.length - 1) const SizedBox(height: 12),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 18),
        const Text(
          'This module is next in the build queue.',
          textAlign: TextAlign.center,
          style: TextStyle(color: FitCoreColors.muted, fontSize: 12),
        ),
      ],
    );
  }
}

void openPlaceholder(
  BuildContext context, {
  required IconData icon,
  required String title,
  required String message,
  List<String> items = const <String>[],
}) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: FeaturePlaceholder(
          icon: icon,
          title: title,
          message: message,
          items: items,
        ),
      ),
    ),
  );
}
