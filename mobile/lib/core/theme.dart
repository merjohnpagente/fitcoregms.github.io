import 'package:flutter/material.dart';

class FitCoreColors {
  FitCoreColors._();

  static const background = Color(0xFF0A0A0A);
  static const surface = Color(0xFF121412);
  static const surfaceAlt = Color(0xFF1A1D1A);
  static const primary = Color(0xFF7FFA88);
  static const primaryDark = Color(0xFF4ADE80);
  static const text = Color(0xFFF5F7F5);
  static const muted = Color(0xFFB3BCB5);
  static const line = Color(0xFF2A2E2A);
  static const danger = Color(0xFFEF4444);
  static const gold = Color(0xFFFBBF24);
  static const cyan = Color(0xFF67E8F9);
}

class FitCoreTheme {
  FitCoreTheme._();

  static ThemeData get dark {
    final scheme = ColorScheme.fromSeed(
      seedColor: FitCoreColors.primary,
      brightness: Brightness.dark,
    ).copyWith(
      primary: FitCoreColors.primary,
      onPrimary: Colors.black,
      secondary: FitCoreColors.gold,
      onSecondary: Colors.black,
      surface: FitCoreColors.surface,
      onSurface: FitCoreColors.text,
      error: FitCoreColors.danger,
      outline: FitCoreColors.line,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: FitCoreColors.background,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: const AppBarTheme(
        backgroundColor: FitCoreColors.background,
        foregroundColor: FitCoreColors.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: FitCoreColors.surfaceAlt,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        hintStyle: const TextStyle(color: FitCoreColors.muted),
        labelStyle: const TextStyle(color: FitCoreColors.muted),
        prefixIconColor: FitCoreColors.muted,
        suffixIconColor: FitCoreColors.muted,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: FitCoreColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: FitCoreColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: FitCoreColors.primary, width: 1.4),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: FitCoreColors.danger),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: FitCoreColors.danger, width: 1.4),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: FitCoreColors.primary,
          foregroundColor: Colors.black,
          disabledBackgroundColor: FitCoreColors.primary.withValues(alpha: 0.4),
          disabledForegroundColor: Colors.black54,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: FitCoreColors.primary),
      ),
      dividerTheme: const DividerThemeData(color: FitCoreColors.line, thickness: 1),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: FitCoreColors.surfaceAlt,
        contentTextStyle: const TextStyle(color: FitCoreColors.text),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}
