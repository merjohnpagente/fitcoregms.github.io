import 'package:flutter/material.dart';

import 'app.dart';
import 'core/firebase_bootstrap.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final firebase = await FirebaseBootstrap.initialize();
  runApp(FitCoreApp(firebaseError: firebase.ready ? null : firebase.error));
}
