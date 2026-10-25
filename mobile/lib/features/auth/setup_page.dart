import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../widgets/fitcore_ui.dart';

class SetupPage extends StatelessWidget {
  const SetupPage({super.key, required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: FitCoreCard(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.cloud_off_rounded, size: 46, color: FitCoreColors.gold),
                    const SizedBox(height: 16),
                    const Text(
                      'Firebase is not configured',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Register the Android app in the Firebase console, then add google-services.json to android/app/.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: FitCoreColors.muted, height: 1.5),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: FitCoreColors.surfaceAlt,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: SelectableText(
                        error,
                        style: const TextStyle(
                          color: FitCoreColors.muted,
                          fontSize: 11.5,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Package name: io.github.merjohnpagente.fitcoregms',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: FitCoreColors.primary, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'After adding the file, rebuild with: flutter build apk --debug',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: FitCoreColors.muted, fontSize: 12),
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
