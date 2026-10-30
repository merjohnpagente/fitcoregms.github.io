// ============================================================
// GMS ⇄ FIREBASE SYNC ADAPTER (db-firebase.js)
// ------------------------------------------------------------
// Strategy: online-first. Business collections are read from Firestore
// snapshots kept in memory; localStorage is never used as a business-data
// cache. This adapter:
//   1. Pushes local writes to Firestore (diff-based batches)
//   2. Keeps every device live via onSnapshot listeners
//   3. Replaces password auth with Firebase Authentication
//      (usernames map to synthetic in-app email identities)
// Only device-local security counters (login lockouts) stay in sessionStorage.
// ============================================================
(function(){
  'use strict';
  if(!window.firebase||!window.FIREBASE_CONFIG){window.GMSFB={enabled:false};return;}

  var COLMAP={
    gms_users:'users', gms_members:'members', gms_payments:'payments',
    gms_sessions:'sessions', gms_plans:'plans', gms_attendance:'attendance',
    gms_walkins:'walkins', gms_notifications:'notifications',
    gms_messages:'messages', gms_announcements:'announcements',
    gms_settings:'settings', gms_activity_log:'activitylog',
    gms_workouts:'workouts', gms_workout_plans:'workoutPlans',
    gms_measurements:'measurements', gms_goals:'goals',
    gms_exercise_library:'exerciseLibrary'
  };
  var REVCOL={};Object.keys(COLMAP).forEach(function(k){REVCOL[COLMAP[k]]=k;});
  var AUTH_DOMAIN_SUFFIX='@fitcoregym.local';
  var GMSFB={
    enabled:true, ready:false, _applying:false,
    _lastCloud:{}, _listeners:[], _syncErr:{}, _listenersStarted:false, _unsubs:[],
    _pendingPushes:{}, _flushTimer:null,
    // Short-lived local doc patches. A stale snapshot must not undo a payment
    // confirmation that has already been committed to Firestore.
    _localPatches:{},
    // ---------- bootstrap ----------
    init:function(){
      try{
        this.app=firebase.initializeApp(window.FIREBASE_CONFIG);
        this.auth=firebase.auth();
        this.db=firebase.firestore();
        this.db.settings({ignoreUndefinedProperties:true});
        // Secondary app: creating accounts must NOT kick the admin out of their session
        this.secondary=(firebase.apps.find(function(a){return a.name==='gms-admin-tasks';})
          ||firebase.initializeApp(window.FIREBASE_CONFIG,'gms-admin-tasks'));
        this.ready=true;
        // Online-only: purge every app key cached by older builds. Nothing
        // business-related is ever written to localStorage again; only
        // session-local security counters remain (in sessionStorage).
        try{
          Object.keys(localStorage).forEach(function(k){
            if(k.indexOf('gms_')===0||k==='fitcore_sidebar_collapsed')localStorage.removeItem(k);
          });
        }catch(e){}
        var self=this;
        // Re-attach fresh listeners whenever the signed-in identity changes
        // (login, logout, registration flows). A failed listener never
        // recovers by itself, so every auth change gets clean new ones.
        this.auth.onAuthStateChanged(function(){
          self.restartListeners();
          // Flush any write that failed before this user signed in.
          setTimeout(function(){self.flushPending();},1200);
        });
        if(typeof window!=='undefined'&&window.addEventListener){
          window.addEventListener('online',function(){self.flushPending();});
        }
        this.startListeners();
      }catch(e){console.error('[GMSFB] init failed',e);this.enabled=false;}
    },
    // ---------- live listeners ----------
    // Listeners are (re)started on every auth state change (see init).
    // Before anyone signs in, Firestore denies reads — that is expected and
    // must NOT mark the device degraded.
    startListeners:function(){
      if(this._listenersStarted||!this.ready)return;
      this._listenersStarted=true;
      var self=this;
      Object.keys(COLMAP).forEach(function(key){
        var un=self.db.collection(COLMAP[key]).onSnapshot(
          function(snap){delete self._syncErr[COLMAP[key]];self._onSnap(key,snap);},
          function(err){
            console.warn('[GMSFB] snapshot',COLMAP[key],err.code);
            if((err&&err.code)==='permission-denied'&&!self.auth.currentUser){
              // Guest device (nobody signed in): the rules keep personal
              // collections private, but plans must still render so the
              // landing page and member signup work. Seed the local default
              // catalogue; once the public-read rules are live the snapshot
              // delivers the real cloud plans anyway.
              if(COLMAP[key]==='plans')self.ensureSeededPlans();
              return;
            }
            self._syncErr[COLMAP[key]]=(err&&err.code)||'error';
            if(typeof updateSyncWarning==='function')updateSyncWarning();
          });
        self._unsubs.push(un);
      });
    },
    stopListeners:function(){
      this._unsubs.forEach(function(u){try{u();}catch(e){}});
      this._unsubs=[];this._listenersStarted=false;
    },
    restartListeners:function(){
      this.stopListeners();this._syncErr={};
      this.startListeners();
    },
    // ---------- one-time fresh start on this device ----------
    bootstrapLocal:function(){
      if(sessionStorage.getItem('gms_fb_fresh')==='2')return;
      Object.keys(COLMAP).forEach(function(k){localStorage.removeItem(k);});
      localStorage.removeItem('gms_login_attempts');
      localStorage.removeItem('gms_seeded');
      sessionStorage.setItem('gms_fb_fresh','2');
    },
    // ---------- sync health ----------
    // True when at least one collection listener is failing (offline,
    // permission-denied, etc.). Devices in this state may show stale data.
    degraded:function(){return Object.keys(this._syncErr).length>0;},
    // Resolves as soon as the first snapshot for a collection has arrived
    // (empty or not), or after `ms` milliseconds. Used by login so accounts
    // are always validated against the CLOUD user list, never an empty cache.
    // Increased default to 8000ms for slow/mobile networks; polls every 80ms.
    waitForSnap:function(key,ms){
      var deadline=Date.now()+(ms||8000);
      var col=COLMAP[key]||key;
      // allow caller to pass either storage key (gms_*) or col name
      var checkKey = key;
      if(COLMAP[key]) checkKey = COLMAP[key];
      // also accept col name directly
      return new Promise(function(res){
        (function poll(){
          if(GMSFB._lastCloud[checkKey]!==undefined||GMSFB._lastCloud[col]!==undefined||Date.now()>deadline)return res(GMSFB._lastCloud[checkKey]!==undefined||GMSFB._lastCloud[col]!==undefined);
          setTimeout(poll,80);
        })();
      });
    },
    // ---------- Firestore → in-memory cache ----------
    // onSnapshot updates _lastCloud (the source of truth).  No localStorage
    // writes — all reads go through DB.get() which reads from _lastCloud.
    _onSnap:function(storageKey,snap){
      var arr=[];
      snap.forEach(function(d){var v=d.data();v.id=d.id;arr.push(v);});
      var col=COLMAP[storageKey];
      var map={};
      arr.forEach(function(v){map[v.id]=v;});
      // Overlay just-committed local patches. Firestore can deliver a cached
      // snapshot from before a write; without this the Payment Queue card
      // reappears right after "Confirm Payment" until the server catches up.
      var patches=this._localPatches[col]||{};
      Object.keys(patches).forEach(function(id){
        var p=patches[id];
        if(!p){return;}
        if(Date.now()-p.ts>60000){delete patches[id];return;}
        var doc=map[id];
        if(!doc){
          // Newly created doc (e.g. a just-committed payment) can be missing
          // from a cached snapshot. Re-insert the full patched doc; patches
          // for existing docs never carry an id, so deleted docs stay gone.
          if(p.patch&&p.patch.id===id)map[id]=Object.assign({},p.patch);
          return;
        }
        var same=true;
        Object.keys(p.patch).forEach(function(k){
          if(JSON.stringify(doc[k])!==JSON.stringify(p.patch[k]))same=false;
        });
        if(same){delete patches[id];return;}
        map[id]=Object.assign({},doc,p.patch);
      });
      this._applying=true; // prevent DB.set→pushCollection loop during notify
      this._lastCloud[col]=map;
      // also store by storageKey alias for waitForSnap flexibility
      this._lastCloud[storageKey]=map;
      this._notify(storageKey);
      this._applying=false;
    },
    // Keeps a confirmed field (member status, QR, etc.) visible even if an
    // older snapshot arrives. Removed automatically once a snapshot matches.
    applyLocalPatch:function(storageKey,id,patch){
      var col=COLMAP[storageKey];if(!col||!id||!patch)return;
      var bucket=this._localPatches[col]||(this._localPatches[col]={});
      var cur=bucket[id]||{patch:{},ts:0};
      cur.patch=Object.assign({},cur.patch,patch);
      cur.ts=Date.now();
      bucket[id]=cur;
      var self=this;
      [col,storageKey].forEach(function(k){
        if(self._lastCloud[k]&&self._lastCloud[k][id])self._lastCloud[k][id]=Object.assign({},self._lastCloud[k][id],patch);
      });
    },
    clearLocalPatch:function(storageKey,id){
      var col=COLMAP[storageKey];if(!col)return;
      if(this._localPatches[col])delete this._localPatches[col][id];
    },
    // Roll back an optimistic patch after a failed cloud commit, without
    // pushing the old value back to Firestore.
    revertLocalPatch:function(storageKey,id,doc){
      var col=COLMAP[storageKey];if(!col||!id||!doc)return;
      this.clearLocalPatch(storageKey,id);
      var self=this;
      [col,storageKey].forEach(function(k){
        if(self._lastCloud[k]&&self._lastCloud[k][id])self._lastCloud[k][id]=Object.assign({},doc);
      });
    },
    _notify:function(storageKey){
      try{if(storageKey==='gms_members'&&typeof updateHeroMemberCount==='function')updateHeroMemberCount();
        if(storageKey==='gms_plans'){
          var plansMap=this._lastCloud['plans']||this._lastCloud[storageKey]||{};
          var arr=Object.keys(plansMap).map(function(id){return plansMap[id];});
          if(!arr.length){
            // Empty snapshot arrived: clear the seed latch so the default
            // catalogue can be (re)seeded and pickers never stay blank.
            this._plansSeedTried=false;
            this.ensureSeededPlans();
          }
          if(typeof renderExplorePlans==='function')renderExplorePlans();
          var mo=document.getElementById('memberSignup');
          if(mo&&mo.style.display!=='none'&&typeof populateMsPlanSelect==='function'){
            var pick=(typeof _msPlanPicked!=='undefined'&&_msPlanPicked)||(typeof _memberSignupPlanId!=='undefined'&&_memberSignupPlanId)||undefined;
            populateMsPlanSelect(pick);
          }
        }
        if(storageKey==='gms_settings'){
          if(typeof syncStaticWalkinPrice==='function')syncStaticWalkinPrice();
          if(typeof renderExplorePlans==='function')renderExplorePlans();
        }
        var appEl=document.getElementById('app');
        if(appEl&&appEl.classList.contains('active')&&typeof _lastPanel!=='undefined'&&_lastPanel&&typeof renderPanel==='function'){renderPanel(_lastPanel);}
        if(typeof updateSyncWarning==='function')updateSyncWarning();
        if(typeof updateQueueBadge==='function')updateQueueBadge();
        if(typeof updateMessageBadge==='function')updateMessageBadge();
        if(typeof updatePendingBadge==='function')updatePendingBadge();
        if(typeof scanRenewals==='function')scanRenewals();
      }catch(e){console.warn('[GMSFB] notify',e);}
    },
    // ---------- direct atomic writes ----------
    // Used for money/activation changes: the UI must only say "confirmed"
    // after Firestore has acknowledged the member + payment docs.
    // ops: [{col, id, data, merge}] or [{col, id, delete:true}]
    commitDocs:function(ops){
      if(!this.ready||!this.db)return Promise.resolve({ok:false,reason:'not-ready'});
      if(!this.auth||!this.auth.currentUser)return Promise.resolve({ok:false,reason:'no-auth'});
      if(!ops||!ops.length)return Promise.resolve({ok:true,ops:0});
      var batch=this.db.batch(),self=this;
      try{
        ops.forEach(function(op){
          var ref=self.db.collection(op.col).doc(op.id);
          if(op.delete){batch.delete(ref);return;}
          batch.set(ref,self._clean(op.data||{}),{merge:!!op.merge});
        });
      }catch(e){
        return Promise.resolve({ok:false,error:(e&&e.code)||'batch-build'});
      }
      return batch.commit().then(function(){
        // Reflect the committed docs in the live snapshot immediately. This
        // is what makes the queue card disappear and the payment show up in
        // Billing without waiting for Firestore's next snapshot.
        ops.forEach(function(op){
          var keys=[op.col];
          var sk=REVCOL[op.col];
          if(sk&&sk!==op.col)keys.push(sk);
          keys.forEach(function(k){
            var m=self._lastCloud[k];
            if(!m)return;
            if(op.delete){delete m[op.id];if(self._localPatches[op.col])delete self._localPatches[op.col][op.id];}
            else m[op.id]=Object.assign({},m[op.id]||{},op.data||{});
          });
        });
        return {ok:true,ops:ops.length};
      }).catch(function(e){
        console.warn('[GMSFB] commitDocs',e&&e.code,e);
        return {ok:false,error:(e&&e.code)||'commit-failed'};
      });
    },
    // ---------- cache → Firestore (diff batch) ----------
    // Returns a Promise that resolves when the batch commits (or immediately if no ops).
    // IMPORTANT: This function ONLY pushes local changes UP to Firestore.
    // It NEVER deletes cloud documents — deletions are handled explicitly
    // by delete functions (deleteQueueItem, resetAllMembers, etc.).
    // This prevents cross-device data loss when the local cache is stale.
    pushCollection:function(storageKey,arr){
      if(!this.ready)return Promise.resolve({ok:false,reason:'not-ready'});
      var col=COLMAP[storageKey];if(!col)return Promise.resolve({ok:false,reason:'no-col'});
      // The audit trail is internal-only: never push a member-authored entry.
      if(col==='activitylog'&&Array.isArray(arr)){
        arr=arr.filter(function(v){return !v||String(v.byRole||'').toLowerCase()!=='member';});
      }
      var last=this._lastCloud[col]||{};
      var next={};var self=this;
      (arr||[]).forEach(function(v){if(v&&v.id)next[v.id]=v;});
      var batch=self.db.batch();var ops=0;
      Object.keys(next).forEach(function(id){
        var clean=self._clean(next[id]);
        if(!last[id]||JSON.stringify(clean)!==JSON.stringify(self._clean(last[id]))){batch.set(self.db.collection(col).doc(id),clean);ops++;}
      });
      // REMOVED: delete loop that deleted cloud docs not in local array.
      // This caused members registered on other devices to disappear when
      // the admin performed any save action on a stale local cache.
      if(!ops){delete this._pendingPushes[storageKey];return Promise.resolve({ok:true,ops:0});}
      return batch.commit().then(function(){
        // Merge push result into _lastCloud instead of replacing —
        // this preserves cloud-only docs that haven't synced to local yet.
        self._lastCloud[col]=self._lastCloud[col]||{};
        Object.keys(next).forEach(function(id){self._lastCloud[col][id]=next[id];});
        self._lastCloud[storageKey]=self._lastCloud[col];
        delete self._pendingPushes[storageKey];
        return {ok:true,ops:ops};
      }).catch(function(e){
        console.warn('[GMSFB] push',col,e&&e.code,e);
        // Keep the latest snapshot and retry: all business data must reach
        // Firestore, even after a transient network or auth failure.
        self.queuePush(storageKey,arr);
        return {ok:false,error:e&&e.code};
      });
    },
    // Latest unsynced snapshot per collection. Retried on reconnect/login.
    queuePush:function(storageKey,arr){
      if(!COLMAP[storageKey])return;
      if(COLMAP[storageKey]==='activitylog'&&Array.isArray(arr)){
        arr=arr.filter(function(v){return !v||String(v.byRole||'').toLowerCase()!=='member';});
      }
      this._pendingPushes[storageKey]=arr;
      if(this._flushTimer)return;
      var self=this;
      this._flushTimer=setTimeout(function(){self._flushTimer=null;self.flushPending();},5000);
    },
    flushPending:function(){
      if(!this.ready||!this.auth||!this.auth.currentUser)return;
      if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
      var self=this;
      Object.keys(this._pendingPushes).forEach(function(key){
        var arr=self._pendingPushes[key];
        delete self._pendingPushes[key];
        self.pushCollection(key,arr).then(function(res){
          if(!res||!res.ok)self.queuePush(key,arr);
        }).catch(function(){self.queuePush(key,arr);});
      });
    },
    _clean:function(v){
      var c=Array.isArray(v)?v.slice():Object.assign({},v);
      // SECURITY: password material never leaves the device. Firebase Auth is
      // the credential store; the in-app salted hash exists only as a local
      // fallback for legacy/admin-reset accounts. Syncing it to Firestore
      // exposed every account to offline cracking (and members used to be
      // able to write another user's hash and log in as them).
      delete c.password;
      delete c.passwordHash;
      var self=this;
      Object.keys(c).forEach(function(k){
        if(c[k]===undefined)c[k]=null;
        else if(c[k]&&typeof c[k]==='object'&&!Array.isArray(c[k]))c[k]=self._clean(c[k]);
      });
      return c;
    },
    // One-time containment for docs written before _clean stripped hashes.
    // Runs after an admin signs in; safe to call repeatedly.
    scrubSensitiveFields:function(){
      if(!this.db||!this.auth||!this.auth.currentUser)return Promise.resolve({ok:false,reason:'no-auth'});
      var self=this;
      return Promise.all(['users','members'].map(function(col){
        return self.db.collection(col).get().then(function(snap){
          var batch=self.db.batch(),n=0;
          snap.forEach(function(doc){
            var d=doc.data()||{};
            if(Object.prototype.hasOwnProperty.call(d,'passwordHash')||Object.prototype.hasOwnProperty.call(d,'password')){
              batch.update(doc.ref,{
                passwordHash:firebase.firestore.FieldValue.delete(),
                password:firebase.firestore.FieldValue.delete()
              });
              n++;
            }
          });
          if(!n)return{collection:col,removed:0};
          return batch.commit().then(function(){return{collection:col,removed:n};})
            .catch(function(e){return{collection:col,removed:0,error:e&&e.code};});
        }).catch(function(e){return{collection:col,removed:0,error:e&&e.code};});
      })).then(function(results){return{ok:true,results:results};});
    },
    // ---------- direct fetch helpers (cross-device login reliability) ----------
    // After a successful Firebase Auth sign-in we can directly query Firestore
    // for the member/user doc instead of waiting for the snapshot listener.
    // This fixes slow-sync devices where waitForSnap(4000) times out.
    fetchMemberByLogin:function(login){
      if(!this.db) return Promise.resolve(null);
      var raw=String(login||'').trim().toLowerCase();
      var synth=raw.indexOf('@')>-1 && raw.endsWith(AUTH_DOMAIN_SUFFIX) ? raw : raw + AUTH_DOMAIN_SUFFIX;
      var uname=raw.split('@')[0];
      var self=this;
      // 1) by username exact
      return self.db.collection('members').where('username','==',raw).limit(1).get().then(function(snap){
        if(!snap.empty) return snap.docs[0].data();
        // 2) by authEmail — try raw first (members use real email), then .synth (legacy)
        return self.db.collection('members').where('authEmail','==',raw).limit(1).get().then(function(s2){
          if(!s2.empty) return s2.docs[0].data();
          return self.db.collection('members').where('authEmail','==',synth).limit(1).get().then(function(s2b){
            if(!s2b.empty) return s2b.docs[0].data();
            // 3) by email (contact email)
            if(raw.indexOf('@')>-1){
              return self.db.collection('members').where('email','==',raw).limit(1).get().then(function(s3){
                if(!s3.empty) return s3.docs[0].data();
                if(uname!==raw) return self.db.collection('members').where('username','==',uname).limit(1).get().then(function(s4){
                  if(!s4.empty) return s4.docs[0].data();
                  return null;
                });
                return null;
              });
            }
            return null;
          });
        });
      }).catch(function(e){ console.warn('[GMSFB] fetchMemberByLogin',e&&e.code); return null; });
    },
    fetchUserByLogin:function(login){
      if(!this.db||!this.auth||!this.auth.currentUser) return Promise.resolve(null);
      var raw=String(login||'').trim().toLowerCase();
      var synth=raw.indexOf('@')>-1 && raw.endsWith(AUTH_DOMAIN_SUFFIX) ? raw : raw + AUTH_DOMAIN_SUFFIX;
      var uname=raw.split('@')[0];
      var self=this;
      return self.db.collection('users').where('username','==',raw).limit(1).get().then(function(snap){
        if(!snap.empty) return snap.docs[0].data();
        return self.db.collection('users').where('authEmail','==',synth).limit(1).get().then(function(s2){
          if(!s2.empty) return s2.docs[0].data();
          // 3) by email (real email) — fallback so Gmail can find account even if username mistyped
          if(raw.indexOf('@')>-1){
            return self.db.collection('users').where('email','==',raw).limit(1).get().then(function(s3){
              if(!s3.empty) return s3.docs[0].data();
              if(uname!==raw) return self.db.collection('users').where('username','==',uname).limit(1).get().then(function(s4){
                return s4.empty?null:s4.docs[0].data();
              });
              return null;
            });
          }
          return null;
        });
      }).catch(function(e){ console.warn('[GMSFB] fetchUserByLogin',e&&e.code); return null; });
    },
    // Direct doc fetch by ID (used for status re-check on pendingGate)
    fetchDoc:function(col, id){
      if(!this.db||!this.auth||!this.auth.currentUser) return Promise.resolve(null);
      return this.db.collection(col).doc(id).get().then(function(d){ return d.exists?d.data():null; }).catch(function(){ return null; });
    },
    // ---------- auth helpers ----------
    adminAuthEmail:'admin@fitcoregym.local',
    authEmailFor:function(u){
      if(u&&u.authEmail)return String(u.authEmail).toLowerCase();
      if(u&&u.email&&String(u.email).toLowerCase().endsWith(AUTH_DOMAIN_SUFFIX)) return String(u.email).toLowerCase();
      // Do NOT use real email for synthetic identity — username only.
      var un=(u&&u.username?u.username:'user').toLowerCase().trim();
      // strip domain if user typed email by mistake
      if(un.indexOf('@')>-1) un=un.split('@')[0];
      return un+AUTH_DOMAIN_SUFFIX;
    },
    _mapAuthError:function(e){
      var c=e&&e.code||'';
      if(c.indexOf('invalid-credential')>-1||c.indexOf('wrong-password')>-1||c.indexOf('user-not-found')>-1)return'Invalid username or password.';
      if(c.indexOf('too-many-requests')>-1)return'Account locked. Too many failed attempts — try again in 15 minutes.';
      if(c.indexOf('email-already-in-use')>-1)return'That username/email is already registered. Please log in instead.';
      if(c.indexOf('weak-password')>-1)return'Password must be at least 8 characters.';
      if(c.indexOf('network')>-1)return'Network error. Please check your internet connection.';
      return'Authentication error. Please try again.';
    },
    signIn:function(email,pass){
      var self=this;
      return this.auth.signInWithEmailAndPassword(email,pass).then(function(){return{ok:true};})
        .catch(function(e){return{ok:false,error:self._mapAuthError(e),code:e&&e.code};});
    },
    createUserCreds:function(email,pass,phone){
      // NOTE: the secondary app stays signed in as the new user afterwards so
      // secSetDoc() can write the profile doc with full authentication.
      // Call secondarySignOut() once all profile writes are done.
      var sec=this.secondary;var self=this;
      return sec.auth().createUserWithEmailAndPassword(email,pass).then(function(cred){
        // Also store phone on the Firebase Auth profile (E.164 when possible)
        var upd=Promise.resolve();
        if(phone&&cred.user&&typeof cred.user.updateProfile==='function'){
          var raw=String(phone).replace(/[^\d+]/g,'');
          var e164=raw;
          if(e164.charAt(0)==='0') e164='+63'+e164.slice(1);
          else if(e164.charAt(0)==='9') e164='+63'+e164;
          else if(e164.indexOf('+')!==0) e164='+'+e164;
          upd=cred.user.updateProfile({phoneNumber:e164}).catch(function(){});
        }
        return upd.then(function(){return{ok:true,uid:cred.user.uid,email:email};});
      }).catch(function(e){return{ok:false,error:self._mapAuthError(e),code:e&&e.code};});
    },
    setAuthPhone:function(phone){
      // Best-effort: write phone onto the currently signed-in Auth user
      var u=this.secondary&&this.secondary.auth&&this.secondary.auth().currentUser;
      if(!u||!phone||typeof u.updateProfile!=='function')return Promise.resolve();
      var raw=String(phone).replace(/[^\d+]/g,'');
      var e164=raw;
      if(e164.charAt(0)==='0') e164='+63'+e164.slice(1);
      else if(e164.charAt(0)==='9') e164='+63'+e164;
      else if(e164.indexOf('+')!==0) e164='+'+e164;
      return u.updateProfile({phoneNumber:e164}).catch(function(){});
    },
    secondarySignOut:function(){try{if(this.secondary)this.secondary.auth().signOut();}catch(e){}},
    // Sign the SECONDARY app in. Used by registration recovery: when the Auth
    // account already exists (half-finished signup), verifying the password on
    // the secondary app re-authenticates the context that secSetDoc writes
    // through — so the profile doc still reaches the cloud.
    secSignIn:function(email,pass){
      if(!this.secondary)return Promise.resolve({ok:false});
      return this.secondary.auth().signInWithEmailAndPassword(email,pass)
        .then(function(){return{ok:true};})
        .catch(function(e){return{ok:false,code:e&&e.code};});
    },
    // Write a profile doc through the SECONDARY app's Firestore. Right after
    // createUserCreds the secondary app is authenticated as the new user, so
    // this write always passes security rules — on any device. Guarantees
    // registrations reach the cloud.
    secSetDoc:function(col,doc){
      if(!this.secondary)return Promise.resolve({ok:false});
      try{
        return this.secondary.firestore().collection(col).doc(doc.id).set(this._clean(doc))
          .then(function(){return{ok:true};})
          .catch(function(e){console.warn('[GMSFB] secSetDoc',col,e&&e.code);return{ok:false};});
      }catch(e){console.warn('[GMSFB] secSetDoc',col,e);return Promise.resolve({ok:false});}
    },
    // Sign the PRIMARY app out (used on logout and after registration flows
    // that had to authenticate the default app as a freshly created user).
    signOut:function(){try{if(this.auth)this.auth.signOut();}catch(e){}},
    // ---------- explicit cloud deletion ----------
    // Used by renumberMembers, resetAllMembers, deleteQueueItem, etc.
    // to explicitly remove documents from Firestore.  pushCollection no
    // longer auto-deletes (to prevent cross-device data loss).
    deleteDocs:function(storageKey,ids){
      if(!this.ready||!ids||!ids.length)return Promise.resolve({ok:true,ops:0});
      var col=COLMAP[storageKey];if(!col)return Promise.resolve({ok:false,reason:'no-col'});
      var batch=this.db.batch();var self=this;
      ids.forEach(function(id){batch.delete(self.db.collection(col).doc(id));});
      return batch.commit().then(function(){
        // Remove from both _lastCloud[col] and _lastCloud[storageKey]
        // (DB.set breaks the alias, so they may be different objects)
        ids.forEach(function(id){
          if(self._lastCloud[col])delete self._lastCloud[col][id];
          if(self._lastCloud[storageKey]&&self._lastCloud[storageKey]!==self._lastCloud[col])delete self._lastCloud[storageKey][id];
          if(self._localPatches[col])delete self._localPatches[col][id];
        });
        return {ok:true,ops:ids.length};
      }).catch(function(e){
        console.warn('[GMSFB] deleteDocs',col,e&&e.code,e);
        return {ok:false,error:e&&e.code};
      });
    },
    // ---------- default plan seeding ----------
    // Seeds the default plan catalogue once when the plans collection is
    // empty. Called right after a successful ADMIN sign-in or when an empty
    // plans snapshot arrives. Stores NO password anywhere: the cloud write
    // simply runs under whoever is authenticated, as the rules require.
    ensureSeededPlans:function(){
      if(this._plansSeedTried)return;
      var plansMap=this._lastCloud['plans']||this._lastCloud['gms_plans']||{};
      var planCount=Object.keys(plansMap).length;
      if(planCount){this._plansSeedTried=true;return;}
      this._plansSeedTried=true;
      var defaults=[
        {id:'pl1',name:'Basic',price:500,duration:1,sessions:8,benefits:'Gym access\nLocker use',status:'Active'},
        {id:'pl2',name:'Standard',price:900,duration:1,sessions:16,benefits:'Gym access\nLocker use\n1 trainer session',status:'Active'},
        {id:'pl3',name:'Premium',price:1500,duration:3,sessions:'Unlimited',benefits:'Full access\nPriority trainer\nFree assessment',status:'Active'}
      ];
      // Seed the in-memory cloud mirror first so plan pickers render without waiting
      // on the network; the live snapshot then reconciles with cloud truth.
      var planMap={};defaults.forEach(function(p){planMap[p.id]=p;});
      this._lastCloud['plans']=planMap;
      this._lastCloud['gms_plans']=planMap;
      if(typeof renderExplorePlans==='function')renderExplorePlans();
      var mo=document.getElementById('memberSignup');
      if(mo&&mo.style.display!=='none'&&typeof populateMsPlanSelect==='function')populateMsPlanSelect();
      // Cloud write requires an authenticated session (firestore.rules).
      if(!this.auth||!this.auth.currentUser)return;
      var self=this;var batch=this.db.batch();
      defaults.forEach(function(p){batch.set(self.db.collection('plans').doc(p.id),p);});
      batch.commit().catch(function(e){console.warn('[GMSFB] plan seed',e&&e.code);});
    },
  };
  window.GMSFB=GMSFB;
  // Expose COLMAP so DB.set() can update both storageKey and collectionName aliases
  GMSFB._colmap=COLMAP;
  GMSFB.init();
})();
