import 'package:firebase_core/firebase_core.dart';

import 'app_config.dart';

class FirebaseBootstrapResult {
  const FirebaseBootstrapResult({required this.ready, this.error});

  final bool ready;
  final String? error;
}

class FirebaseBootstrap {
  FirebaseBootstrap._();

  static Future<FirebaseBootstrapResult> initialize() async {
    try {
      if (Firebase.apps.isEmpty) {
        try {
          // Uses android/app/google-services.json when present.
          await Firebase.initializeApp();
        } catch (_) {
          await Firebase.initializeApp(options: AppConfig.firebaseOptions);
        }
      }
      return const FirebaseBootstrapResult(ready: true);
    } catch (error) {
      return FirebaseBootstrapResult(ready: false, error: error.toString());
    }
  }
}
