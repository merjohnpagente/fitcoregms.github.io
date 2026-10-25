import 'package:firebase_core/firebase_core.dart';

/// Public Firebase client configuration, mirroring the web app.
///
/// The Android app should be registered in the Firebase console and
/// `google-services.json` placed at `android/app/google-services.json`.
/// Until that file exists, the app falls back to these options so a debug
/// build can still boot against the same project.
class AppConfig {
  AppConfig._();

  static const String appName = 'FitCore GMS';
  static const String version = '0.1.0';
  static const String authDomainSuffix = '@fitcoregym.local';

  static const FirebaseOptions firebaseOptions = FirebaseOptions(
    apiKey: 'AIzaSyC_mQ7sjRO1JNNn138wJ5pJodg5jlbSaj0',
    authDomain: 'fitcoregym-1019f.firebaseapp.com',
    projectId: 'fitcoregym-1019f',
    storageBucket: 'fitcoregym-1019f.firebasestorage.app',
    messagingSenderId: '1093645658735',
    appId: '1:1093645658735:web:96ad8b1b02e9a116b4fb9a',
  );
}
