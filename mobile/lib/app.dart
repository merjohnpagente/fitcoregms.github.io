import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/app_config.dart';
import 'core/theme.dart';
import 'data/services/auth_controller.dart';
import 'features/auth/auth_gate.dart';
import 'features/auth/setup_page.dart';

class FitCoreApp extends StatelessWidget {
  const FitCoreApp({super.key, this.firebaseError});

  final String? firebaseError;

  @override
  Widget build(BuildContext context) {
    if (firebaseError != null) {
      return MaterialApp(
        title: AppConfig.appName,
        debugShowCheckedModeBanner: false,
        theme: FitCoreTheme.dark,
        darkTheme: FitCoreTheme.dark,
        themeMode: ThemeMode.dark,
        home: SetupPage(error: firebaseError!),
      );
    }

    return ChangeNotifierProvider<AuthController>(
      create: (_) => AuthController(),
      child: MaterialApp(
        title: AppConfig.appName,
        debugShowCheckedModeBanner: false,
        theme: FitCoreTheme.dark,
        darkTheme: FitCoreTheme.dark,
        themeMode: ThemeMode.dark,
        home: const AuthGate(),
      ),
    );
  }
}
