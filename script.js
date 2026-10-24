// ============================= DATA LAYER =============================
const KEY={users:'gms_users',members:'gms_members',payments:'gms_payments',sessions:'gms_sessions',plans:'gms_plans',attendance:'gms_attendance',walkins:'gms_walkins',loginAttempts:'gms_login_attempts',activityLog:'gms_activity_log',settings:'gms_settings',notifications:'gms_notifications',messages:'gms_messages',announcements:'gms_announcements',workouts:'gms_workouts',workoutPlans:'gms_workout_plans',measurements:'gms_measurements',goals:'gms_goals',exerciseLibrary:'gms_exercise_library'};
const PENDING_ARCHIVE_DAYS=7;
const QR_SCAN_DUP_WINDOW_MIN=30;
// Safe deep clone for Repository reads — structuredClone when available,
// JSON fallback for older browsers. undefined/null pass through.
function deepClone(v){
  if(v===null||v===undefined)return v;
  if(typeof structuredClone==='function'){try{return structuredClone(v);}catch(e){}}
  try{return JSON.parse(JSON.stringify(v));}catch(e){return v;}
}
// Business data is online-only: Firestore is the single source of truth and
// nothing is mirrored to localStorage. Only device-local security counters
// (login lockouts) stay on the device. This prevents a stale browser cache
// from resurrecting a paid member or showing payments that were deleted.
const LOCAL_ONLY_KEYS=new Set(['gms_login_attempts']);
function _cloudDataKey(k){return !!(!LOCAL_ONLY_KEYS.has(k)&&window.GMSFB&&GMSFB.enabled);}
function _cloudMap(k){
  if(!window.GMSFB||!GMSFB.ready||!GMSFB._lastCloud)return null;
  if(GMSFB._lastCloud[k])return GMSFB._lastCloud[k];
  const col=GMSFB._colmap&&GMSFB._colmap[k];
  return (col&&GMSFB._lastCloud[col])||null;
}
const DB={
  // Reads come from the live Firestore snapshot. Before the first snapshot
  // the list is empty (never the old localStorage copy).
  get:(k)=>{
    if(_cloudDataKey(k)){
      const m=_cloudMap(k);
      if(!m)return[];
      return Object.keys(m).map(function(id){return m[id];});
    }
    try{return JSON.parse(localStorage.getItem(k))||[];}catch{return[];}
  },
  getObj:(k)=>{
    if(_cloudDataKey(k))return _cloudMap(k)||{};
    try{const v=JSON.parse(localStorage.getItem(k));return(v&&typeof v==='object'&&!Array.isArray(v))?v:{};}catch{return{};}
  },
  set:(k,v)=>{
    if(_cloudDataKey(k)){
      // Do NOT write business data to localStorage. Update the in-memory
      // snapshot so this tab updates immediately, then push to Firestore.
      const mapped=!!(GMSFB._colmap&&GMSFB._colmap[k]);
      if(mapped&&GMSFB.ready&&!GMSFB._applying){
        GMSFB._lastCloud[k]={};
        (Array.isArray(v)?v:[]).forEach(function(item){if(item&&item.id)GMSFB._lastCloud[k][item.id]=item;});
        try{GMSFB.pushCollection(k,v);}catch(e){try{GMSFB.queuePush(k,v);}catch(_){}}
      }else if(mapped&&typeof GMSFB.queuePush==='function'){
        try{GMSFB.queuePush(k,v);}catch(e){}
      }
      return;
    }
    try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}
  },
  getOne:(k,id)=>{
    if(_cloudDataKey(k)){
      const m=_cloudMap(k);
      return (m&&m[id])||null;
    }
    return DB.get(k).find(x=>x.id===id);
  }
};

// ============================= OOP DATA LAYER (Repository Pattern) =============================
// Every collection in localStorage is now accessed through a Repository instance instead of
// raw DB.get(KEY.x) / DB.set(KEY.x, ...) calls scattered through the app. This gives each
// entity a single owner of its persistence logic and a place to hang domain behaviour.
class Repository{
  constructor(storageKey){this.storageKey=storageKey;}
  // Deep clone on read: callers must NEVER mutate the _lastCloud cache in place.
  // In-place mutation made pushCollection's JSON diff see next[id] === last[id]
  // (same object ref) → ops=0 → status changes (cancel/complete/accept) never
  // reached Firestore, so staff/member devices kept showing stale Pending.
  all(){return deepClone(DB.get(this.storageKey));}
  save(arr){DB.set(this.storageKey,arr);return arr;}
  one(id){return deepClone(DB.getOne(this.storageKey,id));}
  add(item){const arr=this.all();arr.push(item);this.save(arr);return item;}
  update(id,patch){const arr=this.all();const i=arr.findIndex(x=>x.id===id);if(i>-1){arr[i]={...arr[i],...patch};this.save(arr);}return arr[i];}
  remove(id){const arr=this.all().filter(x=>x.id!==id);this.save(arr);
    // Explicit cloud delete — pushCollection NEVER deletes (stale-cache safety),
    // so user-initiated remove must call deleteDocs or docs resurrect on refresh.
    try{if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.deleteDocs==='function')GMSFB.deleteDocs(this.storageKey,[id]);}catch(e){}
    return arr;}
  count(){return this.all().length;}
}
// A tiny repository for the login-attempts map, which is stored as an object, not an array.
// Entries carry a timestamp so lockouts expire automatically (prevents permanent self-DoS).
const LOGIN_LOCK_MS=15*60*1000;
// Account locks after this many failed login attempts within the lock window
const LOGIN_MAX_ATTEMPTS=7;
class AttemptTracker{
  constructor(storageKey){this.storageKey=storageKey;}
  all(){return DB.getObj(this.storageKey);}
  save(obj){DB.set(this.storageKey,obj);return obj;}
  get(username){const e=this.all()[username];if(!e||typeof e==='number')return 0;return(Date.now()-e.last)<LOGIN_LOCK_MS?e.count:0;}
  register(username){const a=this.all();const e=a[username];const fresh=(e&&typeof e==='object'&&(Date.now()-e.last)<LOGIN_LOCK_MS)?e.count:0;a[username]={count:fresh+1,last:Date.now()};this.save(a);return a[username].count;}
  reset(username){const a=this.all();delete a[username];this.save(a);}
}
const Users=new Repository(KEY.users);
const Members=new Repository(KEY.members);
const Payments=new Repository(KEY.payments);
const Sessions=new Repository(KEY.sessions);
const Plans=new Repository(KEY.plans);
const Attendance=new Repository(KEY.attendance);
const Walkins=new Repository(KEY.walkins);
const Notifications=new Repository(KEY.notifications);
const Messages=new Repository(KEY.messages);
const Announcements=new Repository(KEY.announcements);
const Workouts=new Repository(KEY.workouts);
const WorkoutPlans=new Repository(KEY.workoutPlans);
const Measurements=new Repository(KEY.measurements);
const Goals=new Repository(KEY.goals);
const ExerciseLibrary=new Repository(KEY.exerciseLibrary);
// Shared anti-spam guard: every account-creation attempt (staff/trainer/member)
// consumes a slot. Max 5 attempts per 10 minutes per browser, then blocked.
const SIGNUP_RATE_LIMIT=5;
const SIGNUP_RATE_WINDOW_MS=10*60*1000;
function signupRateCheck(){
  const key='gms_signup_rate';
  let count=parseInt(localStorage.getItem(key)||'0',10);
  let first=parseInt(localStorage.getItem(key+'_t')||'0',10);
  const now=Date.now();
  // Anti-spam: one account-creation attempt per 30 seconds per browser.
  const last=parseInt(localStorage.getItem(key+'_last')||'0',10);
  if(last&&now-last<30*1000){localStorage.setItem(key,String(count+1));return true;}
  localStorage.setItem(key+'_last',String(now));
  if(!first||now-first>SIGNUP_RATE_WINDOW_MS){first=now;count=0;localStorage.setItem(key+'_t',String(now));}
  localStorage.setItem(key,String(count+1));
  return count>=SIGNUP_RATE_LIMIT;
}
// Generic client-side anti-spam limiter. It stops accidental/rapid abuse but
// is NOT a security boundary — a determined attacker can clear storage.
// Real spam protection belongs in Firebase App Check + server-side quotas.
function rateLimitOk(key,max,windowMs){
  const now=Date.now();
  let hits=[];
  try{hits=JSON.parse(localStorage.getItem(key)||'[]');}catch(e){}
  if(!Array.isArray(hits))hits=[];
  hits=hits.filter(t=>typeof t==='number'&&now-t<windowMs);
  if(hits.length>=max)return false;
  hits.push(now);
  try{localStorage.setItem(key,JSON.stringify(hits));}catch(e){}
  return true;
}
function pushPendingPaymentNotif(member){
  const plan=member.planId?Plans.one(member.planId):null;
  const existing=Notifications.all().find(n=>n.memberId===member.id&&n.type==='pending_payment'&&n.status==='open');
  if(existing)return existing;
  const notif={id:'NTF-'+uid(),memberId:member.id,planId:member.planId||'',type:'pending_payment',status:'open',createdAt:member.createdAt||today()};
  Notifications.add(notif);
  return notif;
}
function resolveNotifsForMember(memberId){
  const all=Notifications.all();
  let changed=false;
  all.forEach(n=>{if(n.memberId===memberId&&n.status==='open'){n.status='resolved';changed=true;}});
  if(changed)Notifications.save(all);
}
function openPendingNotifs(){return Notifications.all().filter(n=>n.type==='pending_payment'&&n.status==='open');}
const ActivityLog=new Repository(KEY.activityLog);
// Internal audit trail only. Member-originated entries are private and are
// filtered from every view, then pruned from this device and Firestore.
function _isMemberActivity(e){
  if(!e)return false;
  if(String(e.byRole||'').toLowerCase()==='member')return true;
  // Legacy entries written before byRole was always stored.
  if(e.category==='Member Profile')return true;
  if(e.category==='Member'&&(e.action==='Signup'||e.action==='Message'))return true;
  if(e.category==='Workout Plan'&&/Member self-/.test(e.extra||''))return true;
  return false;
}
function pruneMemberActivity(){
  if(!currentUser||currentUser.role==='member')return;
  try{
    const all=ActivityLog.all()||[];
    const removed=all.filter(_isMemberActivity);
    if(!removed.length)return;
    ActivityLog.save(all.filter(e=>!_isMemberActivity(e)));
    if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.deleteDocs==='function'){
      GMSFB.deleteDocs(KEY.activityLog,removed.map(e=>e.id).filter(Boolean)).catch(()=>{});
    }
  }catch(e){console.warn('[activity] prune failed',e);}
}
const LoginAttempts=new AttemptTracker(KEY.loginAttempts);
const Settings=new Repository(KEY.settings);
function getWalkinFee(){return Number((Settings.one('walkin')||{}).fee)||100;}
function setWalkinFee(fee){Settings.save([{id:'walkin',fee:Number(fee)}]);}
function formatPeso(n){return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function syncStaticWalkinPrice(){document.querySelectorAll('.js-walkin-price').forEach(el=>{el.textContent='₱'+getWalkinFee().toLocaleString()+'/day';});document.querySelectorAll('.js-walkin-price-prose').forEach(el=>{el.textContent='₱'+getWalkinFee().toLocaleString();});}
function cleanDigits(s){return String(s||'').replace(/\D/g,'');}
function isPhDial(code){return String(code||'').trim()==='+63';}
function validatePhone(raw,dialCode){
  const digits=cleanDigits(raw);
  if(isPhDial(dialCode)){
    let norm=digits;
    if(/^63\d{10}$/.test(norm)) norm='0'+norm.slice(2);
    else if(/^639\d{9}$/.test(norm)) norm='0'+norm.slice(2);
    else if(/^9\d{9}$/.test(norm)) norm='0'+norm;
    return /^09\d{9}$/.test(norm);
  }
  return digits.length>=6&&digits.length<=15;
}
function normalizeContact(raw,dialCode){
  const digits=cleanDigits(raw);
  if(isPhDial(dialCode)){
    let norm=digits;
    if(/^63\d{10}$/.test(norm)) norm='0'+norm.slice(2);
    else if(/^639\d{9}$/.test(norm)) norm='0'+norm.slice(2);
    else if(/^9\d{9}$/.test(norm)) norm='0'+norm;
    if(!norm.startsWith('0')&&norm.length===10) norm='0'+norm;
    return norm;
  }
  const stripped=digits.replace(/^0+/,'');
  return String(dialCode||'').trim()+stripped;
}
function phoneErrorMsg(dialCode){
  if(isPhDial(dialCode)) return 'Please enter a valid PH mobile number — 11 digits starting with 09 (e.g. 09171234567).';
  return 'Please enter a valid contact number (6-15 digits).';
}
function playScanSound(kind){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return;
    const ctx=new AC();
    if(ctx.state==='suspended') ctx.resume();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    if(kind==='success'){
      osc.type='sine';osc.frequency.value=880;
      gain.gain.setValueAtTime(0.28,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.22);
      osc.start();osc.stop(ctx.currentTime+0.22);
      setTimeout(()=>{try{
        const ctx2=new AC();if(ctx2.state==='suspended') ctx2.resume();
        const o2=ctx2.createOscillator();const g2=ctx2.createGain();
        o2.connect(g2);g2.connect(ctx2.destination);
        o2.type='sine';o2.frequency.value=1100;
        g2.gain.setValueAtTime(0.22,ctx2.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.01,ctx2.currentTime+0.16);
        o2.start();o2.stop(ctx2.currentTime+0.16);
      }catch(e){}},140);
    } else if(kind==='duplicate'){
      osc.type='square';osc.frequency.value=180;
      gain.gain.setValueAtTime(0.32,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.42);
      osc.start();osc.stop(ctx.currentTime+0.42);
      setTimeout(()=>{try{
        const ctx2=new AC();if(ctx2.state==='suspended') ctx2.resume();
        const o2=ctx2.createOscillator();const g2=ctx2.createGain();
        o2.connect(g2);g2.connect(ctx2.destination);
        o2.type='square';o2.frequency.value=140;
        g2.gain.setValueAtTime(0.24,ctx2.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.01,ctx2.currentTime+0.32);
        o2.start();o2.stop(ctx2.currentTime+0.32);
      }catch(e){}},170);
    }
  }catch(e){}
}

// ============================= DOMAIN / ENTITY CLASSES =============================
// Lightweight classes that wrap the plain data objects and carry the business rules that used
// to live inline inside render functions (e.g. computing a member's status from their expiry
// date). Plain objects from the repositories can be "upgraded" into these classes with wrap().
class GymUser{
  constructor(data){Object.assign(this,data);}
  get isLocked(){return this.status==='locked';}
  get isPending(){return this.status==='pending';}
  static wrap(data){return data?new GymUser(data):null;}
}
class Admin extends GymUser{}
class Staff extends GymUser{}
class TrainerAccount extends GymUser{
  get specializationList(){return Array.isArray(this.specializations)?this.specializations:(typeof this.specializations==='string'?this.specializations.split(',').map(s=>s.trim()).filter(Boolean):[]);}
  isAvailableOn(day){return (this.availableDays||[]).includes(day);}
}
class Plan{
  constructor(data){Object.assign(this,data);}
  get isUnlimited(){return this.sessions==='Unlimited';}
  priceLabel(){return '₱'+Number(this.price).toLocaleString();}
  static wrap(data){return data?new Plan(data):null;}
}
class Member{
  constructor(data){Object.assign(this,data);}
  get daysUntilExpiry(){return daysUntil(this.expiryDate);}
  // Single source of truth for a member's lifecycle state, replacing duplicated
  // expiry-comparison logic that used to be repeated across render functions.
  computeStatus(){
    if(this.status==='Archived')return'Archived';
    if(this.status==='pending_payment')return'pending_payment';
    const d=this.daysUntilExpiry;
    if(d<0)return'Expired';
    if(d<=3)return this.status==='Suspended'?'Suspended':'Expiring Soon';
    return this.status==='Suspended'?'Suspended':'Active';
  }
  refreshStatus(){this.status=this.computeStatus();return this.status;}
  static wrap(data){return data?new Member(data):null;}
}
class PaymentRecord{
  constructor(data){Object.assign(this,data);}
  get amountLabel(){return '₱'+Number(this.amount).toLocaleString();}
  static wrap(data){return data?new PaymentRecord(data):null;}
}
class WorkoutEntry{
  constructor(data){Object.assign(this,data);}
  static wrap(d){return d?new WorkoutEntry(d):null;}
}
class WorkoutPlan{
  constructor(data){Object.assign(this,data);}
  get exerciseCount(){return (this.exercises||[]).length;}
  static wrap(d){return d?new WorkoutPlan(d):null;}
}
class Measurement{
  constructor(data){Object.assign(this,data);}
  static wrap(d){return d?new Measurement(d):null;}
}
class Goal{
  constructor(data){Object.assign(this,data);}
  get progressPct(){ if(!this.target||!this.current) return 0; return Math.min(100, Math.round((Number(this.current)/Number(this.target))*100)); }
  static wrap(d){return d?new Goal(d):null;}
}

// ============================= AUTH SERVICE =============================
// Encapsulates the rules that used to live directly inside doLogin()/doRegister(): lockouts,
// pending approval, credential checks and session persistence. The old global functions below
// (doLogin, doRegister, getSession, ...) now simply delegate to this service so every existing
// onclick="..." handler in the HTML keeps working unchanged.
class AuthService{
  getSession(){try{return JSON.parse(sessionStorage.getItem('gms_session'));}catch{return null;}}
  setSession(u){sessionStorage.setItem('gms_session',JSON.stringify(u));}
  clearSession(){sessionStorage.removeItem('gms_session');}
  findByUsername(username){return Users.all().find(x=>x.username===username);}
// Returns {ok:true,user} or {ok:false,error}
  async login(username,password){
    if(!username||!password)return{ok:false,error:'Please fill in all required fields.'};
    const unameLower=String(username).trim().toLowerCase();
    const loginKey=unameLower.split('@')[0];
    if(LoginAttempts.get(username)>=LOGIN_MAX_ATTEMPTS)return{ok:false,error:'Account locked. Too many failed attempts — try again in 15 minutes.'};
    // case-insensitive lookup so "Mike" == "mike" on any device
    const found=Users.all().find(x=>x.username&&x.username.toLowerCase()===unameLower) || Users.all().find(x=>x.authEmail&&x.authEmail.toLowerCase()===unameLower+'@fitcoregym.local');
    if(found&&found.status==='locked')return{ok:false,error:'Account locked. Please contact the administrator.'};
    if(found&&found.status==='pending')return{ok:false,error:'Your account is pending admin approval. Please wait.'};
    // SECURITY: the old salted-hash fallback was removed for staff/trainer/admin.
    // It let anyone who could write a user doc (or set a reset hash) turn that
    // hash into a privileged login. Member legacy resets keep their own local
    // fallback below; privileged accounts must use Firebase Auth / a reset link.
    // ---------- ONLINE (Firebase Auth) ----------
    if(window.GMSFB&&GMSFB.enabled){
      // Give the first Firestore snapshot a moment to arrive so this login is
      // validated against the CLOUD user list, not a possibly-empty local
      // cache (prevents a device from silently falling back to local accounts).
      // Increased to 5000ms for slow/mobile networks (cross-device login fix).
      if(GMSFB._lastCloud&&GMSFB._lastCloud.users===undefined&&typeof GMSFB.waitForSnap==='function'){
        await GMSFB.waitForSnap('users',5000);
        await GMSFB.waitForSnap('gms_users',5000);
      }
      if(found){
        const r=await GMSFB.signIn(GMSFB.authEmailFor(found),password);
        if(r.ok){LoginAttempts.reset(username);if(found.role==='admin')GMSFB.ensureSeededPlans();this.setSession(found);return{ok:true,user:found};}
        // Do not lock on network errors — only on credential failures
        if(r.code&&r.code.indexOf('network')>-1) return{ok:false,error:r.error};
        // SECURITY: no hash fallback for privileged accounts. A forged
        // passwordHash must never become an admin/staff session.
        if(found.role!=='admin'){
          LoginAttempts.register(username);
          return{ok:false,error:r.error};
        }
        // admin falls through to bootstrap block
      }
      const member=Members.all().find(m=>m.username&&m.username.toLowerCase()===unameLower);
      // also try by email in case member typed email on login form
      const memberByEmail=!member&&unameLower.indexOf('@')>-1 ? Members.all().find(m=>m.email&&m.email.toLowerCase()===unameLower) : null;
      const effMemberRaw=member||memberByEmail;
      const effMember=effMemberRaw?_withLocalPwOverride(effMemberRaw):null;
      if(effMember){
        if(effMember.status==='Archived')return{ok:false,error:'Your account has been archived. Please contact the front desk.'};
        if(isMemberExpired(effMember))return{ok:false,error:EXPIRED_LOGIN_MSG};
        const r=await GMSFB.signIn(GMSFB.authEmailFor(effMember),password);
        if(r.ok){
          LoginAttempts.reset(username);
          const sess={id:effMember.id,email:effMember.email||'',username:effMember.username,name:effMember.name,contact:effMember.contact,role:'member',memberId:effMember.id,status:effMember.status,authEmail:GMSFB.authEmailFor(effMember)};
          this.setSession(sess);
          return{ok:true,user:sess};
        }
        if(r.code&&r.code.indexOf('network')>-1) return{ok:false,error:r.error};
        if(effMember.passwordHash && verifyPassword(password, effMember.passwordHash)){
          LoginAttempts.reset(username);
          const sess={id:effMember.id,email:effMember.email||'',username:effMember.username,name:effMember.name,contact:effMember.contact,role:'member',memberId:effMember.id,status:effMember.status,authEmail:GMSFB.authEmailFor(effMember)};
          this.setSession(sess);
          return{ok:true,user:sess};
        }
        LoginAttempts.register(username);
        return{ok:false,error:r.error};
      }
      // Built-in admin: the AUTH account lives in Firebase Authentication
      // (admin@fitcoregym.local). If it has never been created, the FIRST
      // admin login bootstraps it in the cloud with the password entered,
      // then self-heals the Firestore profile doc. From then on every device
      // authenticates the same cloud admin — never a device-local copy.
      if(unameLower==='admin' || loginKey==='admin'){
        let admin=Users.all().find(x=>x.role==='admin'&&x.username.toLowerCase()==='admin');
        // Try canonical admin email first, then fall back to any stored authEmail
        // (handles legacy admin1@fitcore.com accounts that haven't been migrated)
        let r=await GMSFB.signIn(GMSFB.adminAuthEmail,password);
        if(!r.ok){
          const legacyEmail=admin&&admin.authEmail?admin.authEmail.toLowerCase():'';
          if(legacyEmail && legacyEmail!==GMSFB.adminAuthEmail){
            r=await GMSFB.signIn(legacyEmail,password);
            // If legacy login worked, migrate the doc to the canonical email
            if(r.ok && admin){
              try{
                const users=Users.all();
                const ui=users.findIndex(u=>u.id===admin.id);
                if(ui>-1){users[ui].authEmail=GMSFB.adminAuthEmail;Users.save(users);}
                if(window.GMSFB&&GMSFB.enabled){await GMSFB.pushCollection(KEY.users,Users.all());}
              }catch(e){}
            }
          }
        }
        // First-run bootstrap: create the admin identity in Firebase Auth
        // Always try when signIn fails for admin — the account may have been
        // deleted from Firebase Console even though the Firestore doc exists.
        if(!r.ok){
          const notFound=r.code==='auth/user-not-found'||(r.code&&r.code.indexOf('user-not-found')>-1)||(r.code&&r.code.indexOf('invalid-credential')>-1);
          if(notFound){
            const cu=await GMSFB.createUserCreds(GMSFB.adminAuthEmail,password);
            GMSFB.secondarySignOut();
            if(cu.ok){
              r=await GMSFB.signIn(GMSFB.adminAuthEmail,password);
            } else if(cu.code&&cu.code.indexOf('email-already-in-use')>-1){
              // Account exists with different password — can't recover from client
              return{ok:false,error:'Admin account exists with a different password. Please contact support or reset via Firebase Console.'};
            }
          }
        }
        if(r.ok){
          if(!admin){
            admin={id:'u1',name:'System Admin',username:'admin',authEmail:GMSFB.adminAuthEmail,role:'admin',status:'active',contact:'09150435696',createdAt:today()};
            Users.add(admin);
          }
          LoginAttempts.reset(username);
          GMSFB.ensureSeededPlans();
          this.setSession(admin);
          return{ok:true,user:admin};
        }
        if(r.code&&r.code.indexOf('network')>-1) return{ok:false,error:r.error};
        // fall through to cache-miss fallback for admin as well
      }
      // ---------- CACHE-MISS FALLBACK (cross-device fix) ----------
      // Registration is cloud-only, so a freshly registered account may not
      // be in this device's local cache yet (Firestore denies reads before
      // anyone signs in). Validate directly against Firebase Auth using the
      // deterministic identity, then pull the profile via direct Firestore query
      // (more reliable than waiting for onSnapshot on slow networks) AND via cache.
      const synth=loginKey+'@fitcoregym.local';
      const finishFallback=async()=>{
        // Try direct Firestore fetch first (fast, reliable cross-device)
        let u=null, m=null;
        try{
          if(typeof GMSFB.fetchUserByLogin==='function'){
            u=await GMSFB.fetchUserByLogin(unameLower);
            if(!u) u=await GMSFB.fetchUserByLogin(loginKey);
          }
        }catch(e){}
        try{
          if(typeof GMSFB.fetchMemberByLogin==='function'){
            m=await GMSFB.fetchMemberByLogin(unameLower);
            if(!m) m=await GMSFB.fetchMemberByLogin(loginKey);
          }
        }catch(e){}
        // Fallback to cache + longer snapshot wait (covers listener path)
        if(!u&&!m){
          await GMSFB.waitForSnap('users',7000);
          await GMSFB.waitForSnap('members',7000);
          await GMSFB.waitForSnap('gms_users',5000);
          await GMSFB.waitForSnap('gms_members',5000);
          // also wait a bit for listeners to re-attach after signIn
          await new Promise(r=>setTimeout(r,600));
          u=Users.all().find(x=>(x.authEmail&&x.authEmail.toLowerCase()===synth)||(x.username&&x.username.toLowerCase()===unameLower&&x.role!=='member')||(x.username&&x.username.toLowerCase()===loginKey&&x.role!=='member'));
          if(!u&&unameLower.indexOf('@')>-1){
            u=Users.all().find(x=>x.email&&x.email.toLowerCase()===unameLower);
          }
          m=Members.all().find(x=>(x.authEmail&&x.authEmail.toLowerCase()===synth)||(x.username&&x.username.toLowerCase()===unameLower)||(x.username&&x.username.toLowerCase()===loginKey)||(x.email&&x.email.toLowerCase()===unameLower));
        }
        if(u){
          if(u.status==='pending'){GMSFB.signOut();return{ok:false,error:'Your account is pending admin approval. Please wait.'};}
          if(u.status==='locked'){GMSFB.signOut();return{ok:false,error:'Account locked. Please contact the administrator.'};}
          LoginAttempts.reset(username);
          if(u.role==='admin')GMSFB.ensureSeededPlans();
          this.setSession(u);
          return{ok:true,user:u};
        }
        if(m){
          if(m.status==='Archived'){GMSFB.signOut();return{ok:false,error:'Your account has been archived. Please contact the front desk.'};}
          // Note: pending_payment is ALLOWED to log in — they land on pendingGate
          // with auto-refresh, so they see their status live. No block here.
          if(isMemberExpired(m)){GMSFB.signOut();return{ok:false,error:EXPIRED_LOGIN_MSG};}
          LoginAttempts.reset(username);
          const sess={id:m.id,email:m.email||'',username:m.username,name:m.name,contact:m.contact,role:'member',memberId:m.id,status:m.status,authEmail:GMSFB.authEmailFor(m)};
          this.setSession(sess);
          return{ok:true,user:sess};
        }
        GMSFB.signOut();
        return{ok:false,error:'Invalid username or password. If you signed up with an email, please try your username instead.'};
      };
      let fr=await GMSFB.signIn(synth,password);
      if(fr.ok)return await finishFallback();
      // If username contained @, also try raw email as auth (in case account was created with real email as authEmail)
      if(unameLower.indexOf('@')>-1){
        fr=await GMSFB.signIn(unameLower,password);
        if(fr.ok)return await finishFallback();
        // also try loginKey synth if input was email like nicole.ramos@example.com -> try nicole.ramos@fitcoregym.local is synth, but also try nicole@fitcoregym.local
        if(loginKey!==unameLower){
          fr=await GMSFB.signIn(loginKey+'@fitcoregym.local',password);
          if(fr.ok)return await finishFallback();
        }
      }
      // Cross-device fix: synth failed, but the member may exist in Firestore
      // with a real-email authEmail (old registrations). Fetch the doc and try
      // their stored authEmail directly.
      try{
        if(typeof GMSFB.fetchMemberByLogin==='function'){
          const _doc=await GMSFB.fetchMemberByLogin(unameLower)||await GMSFB.fetchMemberByLogin(loginKey);
          if(_doc&&_doc.authEmail&&_doc.authEmail!==synth){
            fr=await GMSFB.signIn(_doc.authEmail,password);
            if(fr.ok)return await finishFallback();
          }
        }
      }catch(e){}
      // Hint for pending Payment Queue: check local cache before locking
      const hintPending=Members.all().find(x=>x.username&&x.username.toLowerCase()===loginKey&&x.status==='pending_payment');
      if(hintPending){
        // Do not lock — guide them
        return{ok:false,error:'Invalid username or password. If you just registered, your payment may still be pending — please wait for front-desk confirmation, then try again.'};
      }
      LoginAttempts.register(username);
      return{ok:false,error:'Invalid username or password.'};
    }
    // ---------- ONLINE-ONLY ----------
    // There is no offline/local fallback anymore: every account lives in
    // Firebase. Without a cloud connection nobody can log in.
    return{ok:false,error:'No internet connection. FitCore runs live in the cloud — please connect to the internet and try again. If you are online, please refresh (Ctrl+F5) and try again.'};
  }
  logout(){this.clearSession();}
  async register(role,payload){
    const users=Users.all();
    // case-insensitive check across cached users AND cloud (admin approval relies on this)
    const unameLower=String(payload.username||'').trim().toLowerCase();
    if(users.find(x=>x.username&&x.username.toLowerCase()===unameLower))return{ok:false,error:'Username already taken. Please choose a different username.'};
    // All staff/trainer registrations require admin approval — no instant login (fixes "can log in right after register" bug)
    const status='pending';
    const {password,...rest}=payload;
    // Sanitize free-text fields at write time (defense in depth against stored XSS)
    ['name','firstName','middleName','lastName','suffix','address','province','city','barangay','street','contact','username','coachName','bio'].forEach(k=>{if(typeof rest[k]==='string')rest[k]=sanitizeText(rest[k]);});
    const user={id:uid(),role,status,createdAt:today(),...rest};
    // ---------- CLOUD-ONLY REGISTRATION ----------
    // The profile doc is written straight to Firestore through the secondary
    // app's authenticated context. Nothing is stored in localStorage here —
    // every device (including this one) receives the record via the live
    // snapshot, so Firebase stays the single source of truth.
    if(!(window.GMSFB&&GMSFB.enabled)){
      if(window.GMSFB&&GMSFB.secondarySignOut)GMSFB.secondarySignOut();
      return{ok:false,error:'Registration requires an internet connection. Please connect to the internet and try again.'};
    }
    const authEmail=(payload.email||'').trim().toLowerCase();
    if(!authEmail)return{ok:false,error:'A valid email address is required for your account.'};
    if(authEmail.endsWith('@fitcoregym.local'))return{ok:false,error:'Please use your real email address (e.g. juan@gmail.com), not a staff-managed email.'};
    const r=await GMSFB.createUserCreds(authEmail,password,payload.contact);
    if(!r.ok){
      // Auth account may exist from an earlier attempt whose profile never
      // reached the cloud — recover by verifying the password on the SECONDARY
      // app (the context secSetDoc writes through).
      if(r.code==='auth/email-already-in-use'){
        const si=await GMSFB.secSignIn(authEmail,password);
        if(!si.ok)return{ok:false,error:'Username already taken. Please choose a different username.'};
      } else return{ok:false,error:r.error};
    }
    user.authEmail=authEmail;
    const wr=await GMSFB.secSetDoc('users',user);
    // Staff/trainer signup entry so admins see pending registrations in the
    // internal audit trail before approving them. Member signups are excluded.
    if(wr&&wr.ok&&role!=='member'){
      const act={id:'ACT'+Date.now(),action:'Signup',category:role==='trainer'?'Trainer':'Staff',detail:rest.name||payload.username,extra:'ID: '+user.id+' | Awaiting admin approval',by:rest.name||payload.username,byUsername:payload.username,byRole:role,at:new Date().toISOString()};
      await GMSFB.secSetDoc('activitylog',act);
    }
    GMSFB.secondarySignOut();
    if(!wr||!wr.ok){
      // NEVER keep a cloud-bound registration as a local-only record — it
      // would be invisible to admins on other devices. Fail loudly instead.
      return{ok:false,error:'Registration could not reach the server. Please check your internet connection and try again.'};
    }
    return{ok:true,user};
  }
}
const Auth=new AuthService();

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function nextId(key,prefix){
  const items=DB.get(key);
  const re=new RegExp('^'+prefix+'-0*(\\d+)$');
  let max=0;
  for(const it of items){
    if(!it||typeof it.id!=='string')continue;
    const m=it.id.match(re);
    if(m)max=Math.max(max,parseInt(m[1],10));
  }
  return `${prefix}-${(max+1).toString().padStart(4,'0')}`;
}
// Dashboard and Billing both show newest payments first. Date is the
// authoritative field; timestamp breaks ties for same-day records.
function newestPaymentFirst(a,b){
  const da=String((a&&a.date)||''),db=String((b&&b.date)||'');
  return db.localeCompare(da)||((Number(b&&b.timestamp)||0)-(Number(a&&a.timestamp)||0));
}
function nextMemberId(){const n=Members.all().filter(m=>m.status!=='Archived').length;return 'MEM-'+String(n+1).padStart(4,'0');}
function addDays(dateStr,days){const d=new Date(dateStr);d.setDate(d.getDate()+days);return d.toISOString().split('T')[0];}
function addMonths(dateStr,months){const d=new Date(dateStr);d.setMonth(d.getMonth()+months);return d.toISOString().split('T')[0];}
function today(){return new Date().toISOString().split('T')[0];}
function daysUntil(dateStr){const ms=new Date(dateStr)-new Date(today());return Math.ceil(ms/(1000*60*60*24));}
// Expired member check for login gate + session force-logout.
// pending_payment and Archived are intentionally excluded — they have their own flows
// (pendingGate / archived block). A missing expiryDate is also not treated as expired.
const EXPIRED_LOGIN_MSG='Your membership has expired. Please visit the front desk to renew your plan to continue.';
function isMemberExpired(m){
  if(!m)return false;
  if(m.status==='Archived'||m.status==='pending_payment')return false;
  if(m.status==='Expired')return true;
  return !!(m.expiryDate&&daysUntil(m.expiryDate)<0);
}
// ===== DOB / AGE POLICY (gym age limits) =====
function calcAge(dobStr){
  if(!dobStr) return NaN;
  const dob=new Date(dobStr);
  if(isNaN(dob.getTime())) return NaN;
  const t=new Date();
  let age=t.getFullYear()-dob.getFullYear();
  const m=t.getMonth()-dob.getMonth();
  if(m<0 || (m===0 && t.getDate() < dob.getDate())) age--;
  return age;
}
function dobPolicy(age){
  if(isNaN(age)) return {ok:false, color:'var(--gray-500)', msg:''};
  if(age<0) return {ok:false, color:'var(--red)', msg:'Invalid date of birth.'};
  if(age<13) return {ok:false, color:'var(--red)', msg:'Under 13 — Not allowed. FitCore does not permit members under 13.'};
  if(age<=15) return {ok:true, color:'var(--gold)', msg:'13–15 — Requires parent/guardian present + waiver (verified at front desk).'};
  if(age<=17) return {ok:true, color:'var(--orange)', msg:'16–17 — Requires parent/guardian written consent on file.'};
  return {ok:true, color:'var(--green)', msg:'✓ Eligible — 18+ Full access.'};
}
function onMsDobChange(){
  const dobEl=document.getElementById('msDob');
  const hint=document.getElementById('msAgeHint');
  if(!dobEl||!hint) return;
  const dob=dobEl.value;
  const age=calcAge(dob);
  if(!dob||isNaN(age)){hint.textContent=''; hint.style.display='none'; const gs=document.getElementById('msGuardianSection');if(gs)gs.classList.remove('show'); return;}
  const p=dobPolicy(age);
  hint.textContent='Age: '+age+' — '+p.msg;
  hint.style.color=p.color;
  hint.style.display='block';
  hint.style.fontSize='11px';
  // Show/hide guardian consent section for ages 13-17
  const gs=document.getElementById('msGuardianSection');
  const check1315=document.getElementById('msGuardianCheck1315');
  const check1617=document.getElementById('msGuardianCheck1617');
  if(gs){
    if(age>=13&&age<=17){
      gs.classList.add('show');
      if(check1315) check1315.style.display=age<=15?'flex':'none';
      if(check1617) check1617.style.display=age>=16&&age<=17?'flex':'none';
    } else {
      gs.classList.remove('show');
    }
  }
}
function onMfDobChange(){
  const dobEl=document.getElementById('mf_dob');
  const ageEl=document.getElementById('mf_age');
  const hint=document.getElementById('mf_age_hint');
  if(!dobEl) return;
  const dob=dobEl.value;
  const age=calcAge(dob);
  if(ageEl){
    if(!dob||isNaN(age)){ ageEl.value=''; }
    else ageEl.value=String(age);
  }
  if(hint){
    if(!dob||isNaN(age)){ hint.textContent=''; hint.style.display='none'; return; }
    const p=dobPolicy(age);
    hint.textContent='Age: '+age+' — '+p.msg;
    hint.style.color=p.color;
    hint.style.display='block';
  }
}
// Legacy demo-grade hash (FNV-1a 32-bit). Kept ONLY to verify/upgrade records hashed before the
// salted-SHA-256 upgrade; never used for new hashes.
function hashStr(str){
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return (h>>>0).toString(16).padStart(8,'0');
}
// ============================= CRYPTO (sync, browser-safe) =============================
// Pure-JS SHA-256 so password hashing and QR signatures work synchronously in the browser
// and in Node test harnesses. Standard FIPS-180-4 algorithm.
function sha256hex(msg){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr(x,n){return (x>>>n)|(x<<(32-n));}
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes=[];
  for(let i=0;i<msg.length;i++){
    const c=msg.charCodeAt(i);
    if(c<128)bytes.push(c);
    else if(c<2048)bytes.push(0xc0|(c>>6),0x80|(c&63));
    else bytes.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
  }
  const bitLen=bytes.length*8;
  bytes.push(0x80);
  while(bytes.length%64!==56)bytes.push(0);
  for(let i=7;i>=0;i--)bytes.push((bitLen/Math.pow(2,8*i))&255);
  for(let o=0;o<bytes.length;o+=64){
    const w=new Array(64);
    for(let i=0;i<16;i++)w[i]=(bytes[o+i*4]<<24)|(bytes[o+i*4+1]<<16)|(bytes[o+i*4+2]<<8)|bytes[o+i*4+3];
    for(let i=16;i<64;i++){
      const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);
      const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(let i=0;i<64;i++){
      const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
      const ch=(e&f)^(~e&g);
      const t1=(h+S1+ch+K[i]+w[i])>>>0;
      const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
      const maj=(a&b)^(a&c)^(b&c);
      const t2=(S0+maj)>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
  }
  return H.map(x=>x.toString(16).padStart(8,'0')).join('');
}
// Salted, iterated password hashing (h2$salt$digest). 1000 SHA-256 rounds with a per-user
// random salt: kills rainbow tables and cross-account correlation. Kept synchronous so the
// whole app (and tests) stays synchronous; a real deployment should use bcrypt/argon2 server-side.
const PW_ITER=1000;
function hashPassword(pw){
  const salt=Math.random().toString(36).slice(2,12)+Date.now().toString(36);
  let d=sha256hex(salt+'|'+pw);
  for(let i=0;i<PW_ITER-1;i++)d=sha256hex(d+salt);
  return 'h2$'+salt+'$'+d;
}
function verifyPassword(pw,stored){
  if(!stored||!pw)return false;
  if(stored.startsWith('h2$')){
    const parts=stored.split('$');
    if(parts.length!==3)return false;
    const salt=parts[1];
    let d=sha256hex(salt+'|'+pw);
    for(let i=0;i<PW_ITER-1;i++)d=sha256hex(d+salt);
    return d===parts[2];
  }
  if(stored.startsWith('h1$'))return stored==='h1$'+hashStr(pw+'::fitcore');
  return false;
}
function qrSig(memberId,dateStr,nonce,secret){
  return sha256hex(memberId+'|'+dateStr+'|'+nonce+'|'+secret).slice(0,16);
}
function getQrSecret(){
  const s=Settings.one('qr');
  if(s&&s.secret)return s.secret;
  const secret=sha256hex('fc-secret-'+Date.now()+'-'+Math.random()).slice(0,32);
  Settings.save([...Settings.all().filter(x=>x.id!=='qr'),{id:'qr',secret}]);
  return secret;
}
function newQrNonce(memberId){return sha256hex(memberId+'|'+Date.now()+'-'+Math.random()).slice(0,8);}
function getMemberNonce(memberId){
  const m=Members.one(memberId);
  if(!m)return'';
  if(!m.qrNonce){m.qrNonce=newQrNonce(memberId);Members.update(memberId,{qrNonce:m.qrNonce});}
  return m.qrNonce;
}
function qrTokenFor(memberId,dateStr){
  const d=dateStr||today();
  const sig=qrSig(memberId,d,getMemberNonce(memberId),getQrSecret());
  return 'FCG.'+memberId+'.'+d.replace(/-/g,'')+'.'+sig;
}
function parseQrToken(token){
  const parts=String(token||'').trim().split('.');
  if(parts.length!==4||parts[0]!=='FCG')return null;
  const memberId=parts[1],dateNum=parts[2],sig=parts[3];
  if(!/^\d{8}$/.test(dateNum))return null;
  const dateStr=dateNum.slice(0,4)+'-'+dateNum.slice(4,6)+'-'+dateNum.slice(6,8);
  const expected=qrSig(memberId,dateStr,getMemberNonce(memberId),getQrSecret());
  if(sig!==expected)return null;
  return{memberId,dateStr};
}
function renderQrTo(el,token,cell=5){
  if(!el)return;
  el.innerHTML='';
  try{
    const qr=qrcode(0,'M');
    qr.addData(token);
    qr.make();
    el.innerHTML=qr.createImgTag(cell,cell*2);
    const img=el.querySelector('img');
    if(img){img.style.imageRendering='pixelated';img.style.display='block';}
  }catch(e){el.innerHTML='<div style="color:var(--red);font-size:12px">QR generation failed</div>';}
}
function formatDate(dateStr){if(!dateStr)return'—';const d=new Date(dateStr);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function formatDateTime(dateStr){if(!dateStr)return'—';const d=new Date(dateStr);return d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function formatFullDate(dateStr){const d=new Date(dateStr);return d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});}

// ============================= XSS DEFENSE =============================
// Escape user-controlled strings before injecting into innerHTML. All data that flows
// from Members/Users/Payments/Walkins/Plans into HTML must pass through esc().
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function onImagePick(input,urlField,previewId,clearId){
  const f=input.files&&input.files[0];
  if(!f)return;
  const isImg=/^image\//.test(f.type)||/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name||'');
  if(!isImg){toast('Please select an image file.','error');return;}
  if(f.size>20*1024*1024){toast('Image too large — max 20MB (your file is '+(f.size/1024/1024).toFixed(1)+'MB).','error');return;}
  const r=new FileReader();
  r.onload=async function(ev){
    let data=ev.target.result;
    // auto-compress large DataURLs to stay under Firestore limit
    if(data&&data.length>650000){
      toast('Compressing image...','info');
      try{ data=await compressDataUrl(data,700,650000); }catch(e){}
    }
    const u=document.getElementById(urlField);if(u) u.value=data;
    const p=document.getElementById(previewId);if(p){p.src=data;p.style.display='block';p.style.cursor='zoom-in';p.title='Click to zoom';p.onclick=function(){openAvatarZoom(data, 'Preview');};}
    const c=document.getElementById(clearId);if(c) c.style.display='inline-flex';
    // Keep exactly one visible preview: image instead of the initials tile.
    if(urlField==='sep_avatar') updateSepAvatar((document.getElementById('sep_name')||{}).value||'');
    if(urlField==='uf_avatar') updateUfAvatar((document.getElementById('uf_name')||{}).value||'');
    input.value='';
  };
  r.readAsDataURL(f);
}
function removeImage(urlField,previewId,clearId){
  const u=document.getElementById(urlField);if(u)u.value='';
  const p=document.getElementById(previewId);if(p){p.src='';p.style.display='none';}
  const c=document.getElementById(clearId);if(c)c.style.display='none';
  if(urlField==='sep_avatar') updateSepAvatar((document.getElementById('sep_name')||{}).value||'');
  if(urlField==='uf_avatar') updateUfAvatar((document.getElementById('uf_name')||{}).value||'');
}
// Compress DataURL to stay under Firestore 1MB limit (~650k chars ≈ 480KB binary)
function compressDataUrl(dataUrl,maxDim=700,maxChars=650000){
  return new Promise(resolve=>{
    if(!dataUrl||dataUrl.length<=maxChars) return resolve(dataUrl);
    const img=new Image();
    img.onload=function(){
      let w=img.width,h=img.height;
      if(w>maxDim||h>maxDim){
        const r=Math.min(maxDim/w,maxDim/h);
        w=Math.round(w*r);h=Math.round(h*r);
      }
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      let q=0.78, out=canvas.toDataURL('image/jpeg',q);
      while(out.length>maxChars&&q>0.35){
        q-=0.08;
        out=canvas.toDataURL('image/jpeg',q);
      }
      if(out.length>maxChars){
        const c2=document.createElement('canvas');
        const r2=0.8;
        c2.width=Math.round(w*r2);c2.height=Math.round(h*r2);
        c2.getContext('2d').drawImage(canvas,0,0,c2.width,c2.height);
        out=c2.toDataURL('image/jpeg',0.6);
      }
      resolve(out.length<=maxChars?out:dataUrl);
    };
    img.onerror=function(){resolve(dataUrl);};
    img.src=dataUrl;
  });
}
// Strip HTML-significant characters and control chars at WRITE time (defense in depth).
// Newlines/tabs are preserved so multi-line plan benefits and notes stay intact.
function sanitizeText(v){
  return String(v==null?'':v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/[<>]/g,'').trim();
}
// Upgrade records saved by pre-v14 seeds: convert plaintext staff passwords to salted hashes.
// Member h1$ (FNV) hashes are upgraded lazily on successful login (plaintext is never recoverable).
function migrateLegacyPasswords(){
  const users=Users.all();
  let changed=false;
  users.forEach(u=>{
    if(!u.passwordHash&&typeof u.password==='string'&&u.password){
      u.passwordHash=hashPassword(u.password);
      delete u.password;
      changed=true;
    }
  });
  if(changed)Users.save(users);
}

// ============================= SEED DATA =============================
function seedData(){
  // Online (Firebase) mode: cloud is the source of truth — start with a clean
  // local mirror and let onSnapshot listeners populate it. No local seeds.
  if(window.GMSFB&&GMSFB.enabled){GMSFB.bootstrapLocal();return;}
  if(localStorage.getItem('gms_seeded')==='15'){
    migrateLegacyPasswords();
    return;
  }
  // Clean production: wipe any legacy demo data (MEM-0001..0006) and start empty.
  // Previous versions seeded 6 demo members + 5 payments which re-appeared every
  // reload due to version guard mismatch (13 vs 14). Bump to 15 does a
  // one-time purge and thereafter stays idempotent — no pre-filled members.
  Object.values(KEY).forEach(k=>localStorage.removeItem(k));
  localStorage.removeItem('gms_login_attempts');
  LoginAttempts.save({});
  // Users — NONE. All accounts live in Firebase Auth + cloud. No local creds.
  Users.save([]);
  // Plans — keep default catalogue (required for landing page & member signup)
  const plans=[
    {id:'pl1',name:'Basic',price:500,duration:1,sessions:8,benefits:'Gym access\nLocker use',status:'Active'},
    {id:'pl2',name:'Standard',price:900,duration:1,sessions:16,benefits:'Gym access\nLocker use\n1 trainer session',status:'Active'},
    {id:'pl3',name:'Premium',price:1500,duration:3,sessions:'Unlimited',benefits:'Full access\nPriority trainer\nFree assessment',status:'Active'}
  ];
  Plans.save(plans);
  // No demo members/payments in production — start empty (clean inbox)
  Members.save([]);
  Payments.save([]);
  Sessions.save([]);
  Walkins.save([]);
  Attendance.save([]);
  Notifications.save([]);
  Messages.save([]);
  Announcements.save([]);
  setWalkinFee(100);
  getQrSecret();
  localStorage.setItem('gms_seeded','15');
}
let _wxMediaMap=null,_wxMediaByName=null,_wxMediaLoading=false,_wxMediaError='';
function _wxNameKey(name){return String(name==null?'':name).trim().toLowerCase();}
function mergeWorkoutXExercises(list){
  if(!Array.isArray(list)||!list.length) return false;
  const all=ExerciseLibrary.all();
  const byId=new Map(all.map(e=>[e.id,e]));
  const byName=new Map(all.map(e=>[_wxNameKey(e.name),e]));
  let changed=false;
  list.forEach(raw=>{
    if(!raw||!raw.apiId||!raw.name) return;
    const id=raw.id||('wx_'+raw.apiId);
    const key=_wxNameKey(raw.name);
    const existing=byId.get(id)||byName.get(key);
    const record={...raw};
    // Signed WorkoutX links expire; never persist them in Firestore.
    delete record.media;
    record.id=existing?existing.id:id;
    record.apiId=raw.apiId;
    record.source='workoutx';
    if(existing){
      let did=false;
      ['apiId','name','muscle','equipment','level','desc','target','bodyPart','instructions','tips','recommendedSets','recommendedReps','model','source'].forEach(field=>{
        if(record[field]===undefined) return;
        if(JSON.stringify(existing[field])!==JSON.stringify(record[field])){existing[field]=record[field];did=true;}
      });
      if(did) changed=true;
    }else{
      all.push(record);
      byId.set(record.id,record);
      byName.set(key,record);
      changed=true;
    }
  });
  if(changed){
    ExerciseLibrary.save(all);
    if(window.GMSFB&&GMSFB.enabled) GMSFB.pushCollection(KEY.exerciseLibrary, all);
  }
  return changed;
}
const STARTER_EXERCISES=[
  {id:'ex1',name:'Barbell Squat',muscle:'Legs',equipment:'Barbell',level:'Intermediate',target:'Quads, Glutes',bodyPart:'Legs',desc:'Compound lower-body lift for quads, glutes, and core strength.',instructions:['Set the bar on your upper back, not your neck. Stand with feet shoulder-width apart and toes slightly out.','Brace your core, keep your chest up, and push your hips back and down.','Lower until your thighs are about parallel to the floor, or as deep as you can control. Keep your knees tracking over your toes.','Drive through your mid-foot to stand tall, squeezing your glutes at the top.'],tips:['Keep your heels planted and your whole foot pressed into the floor.','Do not let your knees cave inward on the way up.','Keep your spine neutral and use a spotter or safety bars for heavy sets.'],recommendedSets:'3-4',recommendedReps:'6-10'},
  {id:'ex2',name:'Bench Press',muscle:'Chest',equipment:'Barbell',level:'Intermediate',target:'Pectorals, Triceps',bodyPart:'Chest',desc:'Classic barbell press for the chest, front delts, and triceps.',instructions:['Lie on a flat bench with your eyes under the bar and your feet flat on the floor. Pull your shoulder blades together.','Grip the bar slightly wider than shoulder width. Unrack it and hold it over your mid-chest with straight arms.','Lower the bar under control to your mid-chest, keeping your elbows about 45 to 75 degrees from your torso.','Press the bar back up until your arms are straight, without bouncing or locking out harshly.'],tips:['Keep your wrists stacked over your elbows.','Do not bounce the bar off your chest.','Use a spotter or safety pins when lifting heavy.','Keep your hips and feet planted on the bench and floor.'],recommendedSets:'3-4',recommendedReps:'6-10'},
  {id:'ex3',name:'Deadlift',muscle:'Back',equipment:'Barbell',level:'Advanced',target:'Hamstrings, Glutes, Back',bodyPart:'Back',desc:'Full-body hinge that trains the posterior chain, grip, and core.',instructions:['Stand with the bar over your mid-foot, feet hip-width apart, and the bar close to your shins.','Hinge at the hips and grip the bar just outside your knees. Brace your core, lift your chest, and tighten your lats.','Push the floor away and stand tall, keeping the bar close to your body.','Hinge back down with control and reset your setup before the next rep.'],tips:['Keep your spine neutral; stop if your lower back rounds.','Do not jerk the bar off the floor.','Keep the bar close to your legs throughout the lift.','Use a weight you can control with good form.'],recommendedSets:'3-4',recommendedReps:'4-6'},
  {id:'ex4',name:'Pull-up',muscle:'Back',equipment:'Bodyweight',level:'Intermediate',target:'Lats, Upper Back',bodyPart:'Back',desc:'Bodyweight vertical pull for the lats, upper back, and grip.',instructions:['Hang from a pull-up bar with an overhand grip slightly wider than your shoulders.','Brace your core and pull your shoulder blades down and back.','Drive your elbows toward your ribs until your chin clears the bar.','Lower yourself slowly to a full hang and repeat.'],tips:['Avoid swinging or kipping unless your workout calls for it.','Do not shrug your shoulders toward your ears.','Use a band or assisted machine if you cannot complete clean reps.','Control the lowering phase.'],recommendedSets:'3',recommendedReps:'5-8'},
  {id:'ex5',name:'Shoulder Press',muscle:'Shoulders',equipment:'Dumbbell',level:'Beginner',target:'Deltoids, Triceps',bodyPart:'Shoulders',desc:'Overhead dumbbell press for shoulder strength and stability.',instructions:['Sit or stand with a dumbbell in each hand at shoulder height, palms facing forward.','Brace your core and press the dumbbells overhead without arching your lower back.','Extend your arms and keep the weights over your shoulders.','Lower the dumbbells with control back to shoulder height.'],tips:['Keep your ribs down and your core tight.','Do not clang the dumbbells together at the top.','Keep your wrists neutral and elbows under the weights.','Use a lighter weight if you need to arch your back.'],recommendedSets:'3',recommendedReps:'8-12'},
  {id:'ex6',name:'Plank',muscle:'Core',equipment:'Bodyweight',level:'Beginner',target:'Core',bodyPart:'Core',desc:'Isometric hold for core stability, posture, and breathing control.',instructions:['Place your forearms on the floor under your shoulders and your feet hip-width apart.','Lift your hips until your body forms a straight line from your head to your heels.','Brace your abs and glutes, and breathe steadily.','Hold for the target time, then lower your knees with control.'],tips:['Do not let your hips sag or pike up.','Keep your neck neutral and look at the floor.','Squeeze your glutes to protect your lower back.','Stop if you feel sharp lower-back pain.'],recommendedSets:'2-3',recommendedReps:'20-60 sec'},
  {id:'ex7',name:'Lunges',muscle:'Legs',equipment:'Dumbbell',level:'Beginner',target:'Quads, Glutes',bodyPart:'Legs',desc:'Single-leg movement for quads, glutes, and balance.',instructions:['Stand tall with a dumbbell in each hand at your sides and your feet hip-width apart.','Step forward and lower until both knees are bent to about 90 degrees.','Keep your front knee over your mid-foot and your torso upright.','Push through your front foot to return, then alternate legs.'],tips:['Take a stride length that feels stable for you.','Do not let your front knee cave inward.','Keep your heels down and your core braced.','Use a wall or chair for balance if needed.'],recommendedSets:'3',recommendedReps:'8-12 per leg'},
  {id:'ex8',name:'Bicep Curl',muscle:'Arms',equipment:'Dumbbell',level:'Beginner',target:'Biceps',bodyPart:'Arms',desc:'Dumbbell curl for bicep strength and arm size.',instructions:['Stand with a dumbbell in each hand at your sides, palms facing forward.','Keep your elbows close to your torso and curl the weights up.','Squeeze your biceps at the top without swinging your elbows forward.','Lower the weights slowly to full extension.'],tips:['Keep your elbows pinned to your sides.','Do not use momentum or swing your body.','Keep your wrists neutral.','Control the lowering phase for better results.'],recommendedSets:'3',recommendedReps:'10-15'},
  {id:'ex9',name:'Triceps Dip',muscle:'Arms',equipment:'Bodyweight',level:'Intermediate',target:'Triceps',bodyPart:'Arms',desc:'Bodyweight press for triceps and chest strength.',instructions:['Grip parallel bars or place your hands on a sturdy bench behind you.','Start with your arms straight and your shoulders down.','Bend your elbows to lower your body until your upper arms are about parallel to the floor.','Press back up to straight arms without shrugging.'],tips:['Keep your elbows pointing back, not flared out.','Stop if you feel shoulder pain.','Use a bench or assistance if full dips are too hard.','Lower only as far as you can control.'],recommendedSets:'3',recommendedReps:'8-12'},
  {id:'ex10',name:'Treadmill Run',muscle:'Cardio',equipment:'Machine',level:'Beginner',target:'Cardiovascular',bodyPart:'Cardio',desc:'Steady treadmill run for heart health and endurance.',instructions:['Start with 3 to 5 minutes of easy walking to warm up.','Increase the speed to a comfortable jog or run.','Keep your posture tall, your shoulders relaxed, and land lightly.','Cool down with 3 to 5 minutes of walking.'],tips:['Use the safety clip and avoid holding the rails.','Increase speed gradually.','Stop if you feel dizzy, short of breath, or sharp pain.','Choose a pace you can maintain for the full session.'],recommendedSets:'1',recommendedReps:'15-30 min'},
  {id:'ex11',name:'Leg Press',muscle:'Legs',equipment:'Machine',level:'Beginner',target:'Quads, Glutes',bodyPart:'Legs',desc:'Machine press for quads and glutes with back support.',instructions:['Sit with your back and hips against the pads and your feet shoulder-width on the platform.','Release the safeties and lower the platform by bending your knees toward your chest.','Stop before your lower back rounds or your hips lift off the seat.','Press through your mid-foot to extend your legs without locking your knees.'],tips:['Keep your knees tracking over your toes.','Do not let your lower back lift off the pad.','Avoid locking your knees at the top.','Use a controlled tempo on the way down.'],recommendedSets:'3-4',recommendedReps:'8-12'},
  {id:'ex12',name:'Lat Pulldown',muscle:'Back',equipment:'Cable',level:'Beginner',target:'Lats, Upper Back',bodyPart:'Back',desc:'Cable pull for the lats and upper-back strength.',instructions:['Sit with your thighs under the pads and grip the bar wider than shoulder width.','Brace your core and pull your shoulder blades down.','Pull the bar toward your upper chest, driving your elbows down and back.','Return the bar slowly to a full stretch.'],tips:['Do not pull the bar behind your neck.','Avoid leaning far back or using momentum.','Keep your chest up and your core braced.','Control the weight on the way up.'],recommendedSets:'3',recommendedReps:'8-12'}
];
function _starterKey(name){return String(name||'').trim().toLowerCase();}
function mergeStarterExercises(list){
  const byId=new Map(list.map(e=>[e.id,e]));
  const byName=new Map(list.map(e=>[_starterKey(e.name),e]));
  let changed=false;
  STARTER_EXERCISES.forEach(src=>{
    const existing=byId.get(src.id)||byName.get(_starterKey(src.name));
    if(!existing){
      list.push({...src});
      changed=true;
      return;
    }
    // WorkoutX already supplies a full write-up for some matching names; only fill gaps there.
    const fields=existing.apiId?['instructions','tips','recommendedSets','recommendedReps']:['target','bodyPart','desc','instructions','tips','recommendedSets','recommendedReps'];
    fields.forEach(f=>{
      if(src[f]===undefined) return;
      if(existing.apiId){
        const missing=existing[f]===undefined||existing[f]===''||(Array.isArray(existing[f])&&!existing[f].length);
        if(!missing) return;
      }
      if(JSON.stringify(existing[f])===JSON.stringify(src[f])) return;
      existing[f]=Array.isArray(src[f])?src[f].slice():src[f];
      changed=true;
    });
  });
  if(changed){
    ExerciseLibrary.save(list);
    if(window.GMSFB&&GMSFB.enabled) GMSFB.pushCollection(KEY.exerciseLibrary, list);
  }
  return changed;
}
function seedExerciseLibrary(){
  // Snapshot notifications render while GMSFB._applying is true; a write
  // in that window only reaches localStorage and is overwritten by the
  // snapshot. Re-run once the snapshot handler finishes.
  if(window.GMSFB&&GMSFB._applying){
    clearTimeout(window._exSeedTimer);
    window._exSeedTimer=setTimeout(()=>{if(document.getElementById('panelExerciseLibrary'))renderExerciseLibrary();},0);
    return;
  }
  let current=ExerciseLibrary.all();
  if(!current.length){
    ExerciseLibrary.save(STARTER_EXERCISES);
    if(window.GMSFB&&GMSFB.enabled) GMSFB.pushCollection(KEY.exerciseLibrary, STARTER_EXERCISES);
    current=ExerciseLibrary.all();
  }else{
    mergeStarterExercises(current);
    current=ExerciseLibrary.all();
  }
  const wx=window.WORKOUTX_EXERCISES;
  if(!Array.isArray(wx)||!wx.length) return;
  const ids=new Set(current.map(e=>e.apiId).filter(Boolean));
  // Re-check on every render: a late Firestore snapshot can replace the
  // in-memory library with an older 12-item list.
  if(wx.some(e=>!ids.has(e.apiId))) mergeWorkoutXExercises(wx);
}

// ============================= AUTH =============================
// These globals now delegate straight to the AuthService instance (Auth) defined above.
let currentUser=null;
let _regDoneSavedUser='';
function getSession(){return Auth.getSession();}
function setSession(u){Auth.setSession(u);}
function clearSession(){Auth.clearSession();}

function showLandingSection(section, linkEl) {
  const sections = ['home','features','explore','register','trainers','reviews'];
  sections.forEach(s => {
    const el = document.getElementById('landing' + s.charAt(0).toUpperCase() + s.slice(1));
    if(el) el.style.display = 'none';
  });
  const mq=document.querySelector('.marquee');if(mq)mq.style.display=section==='home'?'block':'none';
  const extraEl = document.getElementById('landingExploreExtra');
  if(extraEl) extraEl.style.display = 'none';
  const target = document.getElementById('landing' + section.charAt(0).toUpperCase() + section.slice(1));
  if(target) target.style.display = 'flex';
  if(section === 'explore' && extraEl) extraEl.style.display = 'block';
  if(section === 'explore') renderExplorePlans();
  if(section === 'trainers') renderTrainers();
  document.querySelectorAll('.ln-link').forEach(l => l.classList.remove('active'));
  if(linkEl) linkEl.classList.add('active');
  // Hide LOG IN button when already on the login/register section
  const ctaBtns = document.querySelectorAll('.ln-cta');
  ctaBtns.forEach(btn => { btn.style.display = section === 'register' ? 'none' : ''; });
  // Reset scroll: the navbar is fixed, so staying at the old scroll position
  // renders hero content underneath it (chip colliding with the brand).
  window.scrollTo({top:0,left:0,behavior:'auto'});
  iconize(document);
  initReveals();
}
async function doLogin(){
  const u=document.getElementById('loginUser').value.trim();
  const p=document.getElementById('loginPass').value;
  const btn=document.querySelector('#loginForm .btn-primary');
  if(btn){btn.disabled=true;btn.textContent='Logging in…';}
  try{
    const result=await Auth.login(u,p);
    if(!result.ok){showLoginError(result.error);return;}
    currentUser=result.user;
    loadApp();
  }catch(e){
    console.error('[login]',e);
    showLoginError('Login failed. Please refresh the page (Ctrl+F5) and try again.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Log In';}
  }
}

function confirmLogout(){
  closeSidebar();
  if(currentUser){
    const roleMeta={
      admin:{label:'Admin',bg:'rgba(179,188,181,.2)',color:'var(--orange)'},
      staff:{label:'Staff',bg:'rgba(179,188,181,.2)',color:'#d7ddd8'},
      trainer:{label:'Trainer',bg:'rgba(127,250,136,.15)',color:'var(--green)'},
      member:{label:'Member',bg:'rgba(251,191,36,.15)',color:'var(--gold)'}
    };
    const rm=roleMeta[currentUser.role]||{label:currentUser.role,bg:'rgba(255,255,255,.1)',color:'var(--gray-300)'};
    openConfirm(
      'Confirm Logout',
      '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 0"><div style="font-size:36px">🚪</div><div style="font-size:14px;color:var(--gray-300);text-align:center;line-height:1.6">You are logged in as <strong style="color:var(--white)">'+esc(currentUser.name)+'</strong> <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px;background:'+rm.bg+';color:'+rm.color+';margin-left:6px;text-transform:uppercase">'+esc(rm.label)+'</span><br>Are you sure you want to log out?</div></div>',
      doLogout,
      '🚪 Yes, Log Out',
      'btn-danger'
    );
  } else {
    doLogout();
  }
}
function doLogout(){
  clearSession();currentUser=null;
  if(window.GMSFB&&GMSFB.enabled)GMSFB.signOut();
  if(_pendingPoll){clearInterval(_pendingPoll);_pendingPoll=null;}
  const pg=document.getElementById('pendingGate');if(pg)pg.style.display='none';
  document.getElementById('app').classList.remove('active');
  document.getElementById('loginPage').style.display='block';
  document.getElementById('landingNav').style.display='flex';
  showLandingSection('register', null);
  showLogin();
  const lu=document.getElementById('loginUser');if(lu) lu.value='';
  const lp=document.getElementById('loginPass');if(lp){lp.value='';lp.type='password';const w=lp.closest('.input-wrap');const b=w&&w.querySelector('.pw-toggle');if(b) b.innerHTML=iconSvg('eyeOff',16);}
  document.getElementById('loginError').style.display='none';
  _resetPwVis();
}
function showLoginError(msg){const el=document.getElementById('loginError');el.textContent=msg;el.style.display='block';}
// ============================= FORGOT PASSWORD — 3-step (email only) =============================
let _fpCode=null, _fpCodeExp=0, _fpCooldown=0, _fpVerified=null, _fpCodeTimer=null, _fpStep=1, _fpForcedMode=false;
try{
  const _fpStored=sessionStorage.getItem('gms_fp_verified');
  if(_fpStored) _fpVerified=JSON.parse(_fpStored);
}catch(e){}
function clearFpVerified(){
  _fpVerified=null;
  try{ sessionStorage.removeItem('gms_fp_verified'); }catch(e){}
}
// ── LOCAL PASSWORD OVERRIDE (admin-reset fallback) ──────────
// A member who logs in with the admin's temporary password is authenticated
// by the hash fallback, NOT by Firebase Auth. Firestore rejects that member's
// writes, so the new password can't reach the cloud. Keep a per-device copy
// so the member can finish the forced reset and log in again on this device.
// Cross-device sync still requires a real Auth session or a Cloud Function.
const _pwOverrides={};
function _readPwOverrides(){return _pwOverrides;}
function _savePwOverride(id,newHash,baseHash){_pwOverrides[id]={hash:newHash,base:baseHash||'',at:Date.now()};}
function _withLocalPwOverride(m){
  if(!m)return m;
  try{
    const o=_readPwOverrides()[m.id];
    if(o&&o.hash&&(o.base===m.passwordHash||m.passwordHash===o.hash)) return {...m,passwordHash:o.hash,mustChangePassword:false};
  }catch(e){}
  return m;
}
async function ensureCloudWriteAuth(){
  try{
    if(!(window.GMSFB&&GMSFB.enabled&&GMSFB.auth)) return false;
    if(GMSFB.auth.currentUser) return true;
    if(typeof GMSFB.auth.signInAnonymously!=='function') return false;
    await GMSFB.auth.signInAnonymously();
    return !!GMSFB.auth.currentUser;
  }catch(e){ return false; }
}
function setFpBtnLoading(btn,on,label){
  if(!btn)return;
  if(on){
    if(!btn.dataset.fpIdle)btn.dataset.fpIdle=btn.textContent;
    btn.disabled=true;
    btn.style.opacity='0.7';
    btn.style.cursor='wait';
    btn.setAttribute('aria-busy','true');
    btn.innerHTML='<span class="btn-spinner" aria-hidden="true"></span>'+(label||'Please wait…');
  } else {
    btn.disabled=false;
    btn.style.opacity='';
    btn.style.cursor='';
    btn.removeAttribute('aria-busy');
    btn.textContent=btn.dataset.fpIdle||btn.textContent;
    delete btn.dataset.fpIdle;
  }
}
function showFpStep(n){
  _fpStep=n;
  ['fpStep1','fpStep2','fpStep3'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.style.display=(i+1===n)?'block':'none';
  });
  const f1=document.getElementById('fpFoot1');
  const f2=document.getElementById('fpFoot2');
  const f3=document.getElementById('fpFoot3');
  if(f1) f1.style.display=n===1?'flex':'none';
  if(f2) f2.style.display=n===2?'block':'none';
  if(f3) f3.style.display=n===3?'flex':'none';
  document.querySelectorAll('[data-fp-dot]').forEach(d=>{
    const num=Number(d.getAttribute('data-fp-dot'));
    d.classList.toggle('active',num===n);
    d.classList.toggle('done',num<n);
  });
  document.querySelectorAll('[data-fp-line]').forEach(l=>{
    const num=Number(l.getAttribute('data-fp-line'));
    l.classList.toggle('done',num<n);
  });
  const t=document.getElementById('fpModalTitle');
  if(t) t.textContent=_fpForcedMode?'Set New Password':(n===2?'Verify Code':'Reset Password');
}
function getFpOtp(){
  return Array.from(document.querySelectorAll('.fp-otp-box')).map(b=>b.value).join('');
}
function setFpOtp(val){
  const digits=String(val||'').replace(/\D/g,'').slice(0,6);
  document.querySelectorAll('.fp-otp-box').forEach((b,i)=>{
    b.value=digits[i]||'';
    b.classList.toggle('filled',!!digits[i]);
  });
  const h=document.getElementById('fp_code_input');
  if(h) h.value=digits;
  updateFpVerifyBtnState();
}
function initFpOtp(){
  document.querySelectorAll('.fp-otp-box').forEach(b=>{
    if(b._fpBound) return;
    b._fpBound=true;
    b.addEventListener('input',function(){
      b.value=b.value.replace(/\D/g,'').slice(0,1);
      b.classList.toggle('filled',!!b.value);
      const h=document.getElementById('fp_code_input');
      if(h) h.value=getFpOtp();
      onFpCodeInput();
      if(b.value){
        const i=Number(b.dataset.i);
        const next=document.querySelector('.fp-otp-box[data-i="'+(i+1)+'"]');
        if(next) next.focus();
      }
    });
    b.addEventListener('keydown',function(e){
      if(e.key==='Backspace'&&!b.value){
        const i=Number(b.dataset.i);
        if(i>0){
          const prev=document.querySelector('.fp-otp-box[data-i="'+(i-1)+'"]');
          if(prev){prev.focus();prev.value='';prev.classList.remove('filled');}
          const h=document.getElementById('fp_code_input');
          if(h) h.value=getFpOtp();
          e.preventDefault();
        }
      } else if(e.key==='Enter'){
        if(_fpStep===2) fpVerifyCode();
        else if(_fpStep===1) fpSubmitCode();
      }
    });
  });
}
function onFpOtpPaste(e){
  e.preventDefault();
  const dt=e.clipboardData||window.clipboardData;
  const t=(dt&&dt.getData('text'))||'';
  setFpOtp(t);
  const boxes=document.querySelectorAll('.fp-otp-box');
  const empty=Array.from(boxes).find(b=>!b.value);
  (empty||boxes[5]||{focus:function(){}}).focus();
}
function openForgotModal(){
  _fpForcedMode=false;
  const prog=document.getElementById('fpProgress'); if(prog) prog.style.display='none';
  const closeBtn=document.querySelector('#forgotModal .modal-close'); if(closeBtn) closeBtn.style.display='';
  const t=document.getElementById('fpModalTitle'); if(t) t.textContent='Reset Password';
  document.getElementById('fp_user').value='';
  document.getElementById('fp_method').value='email';
  const em=document.getElementById('fp_email');
  if(em){
    em.value='';
    const loginVal=(document.getElementById('loginUser')||{}).value||'';
    if(loginVal && loginVal.indexOf('@')>-1) em.value=loginVal.trim();
  }
  setFpOtp('');
  const legacyOtp=document.getElementById('fp_otp'); if(legacyOtp) legacyOtp.value='';
  document.getElementById('forgotError').style.display='none';
  document.getElementById('forgotSuccess').style.display='none';
  const _hint=document.getElementById('fp_otp_hint'); if(_hint) _hint.style.display='none';
  const codeHint=document.getElementById('fp_code_hint'); if(codeHint) codeHint.style.display='none';
  const codeErr=document.getElementById('fp_code_error'); if(codeErr) codeErr.style.display='none';
  const resend=document.getElementById('fp_resend'); if(resend){ resend.style.display='none'; resend.textContent='Resend Code'; }
  const btn=document.getElementById('fp_verify_btn'); if(btn){ btn.textContent='Continue'; btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; }
  const cb=document.getElementById('fp_confirm_btn'); if(cb) setFpBtnLoading(cb,false);
  const sb=document.getElementById('fp_submit_btn'); if(sb){ sb.disabled=false; sb.style.opacity=''; sb.style.cursor=''; sb.textContent='Send Reset Link'; }
  const _fp1=document.getElementById('fp_new_pass'); if(_fp1) _fp1.value='';
  const _fp2=document.getElementById('fp_new_pass2'); if(_fp2) _fp2.value='';
  const _fe=document.getElementById('fpsError'); if(_fe) _fe.style.display='none';
  const _fs=document.getElementById('fpsSuccess'); if(_fs) _fs.style.display='none';
  const banner=document.getElementById('fpsBanner'); if(banner) banner.style.display='none';
  const cancel=document.getElementById('fp_cancel_btn');
  if(cancel){ cancel.style.display=''; cancel.textContent='Cancel'; cancel.onclick=function(){ closeModal('forgotModal'); }; }
  const _lb=document.getElementById('fpsLabel'); if(_lb) _lb.textContent='';
  ['fps1','fps2','fps3'].forEach(id=>{const b=document.getElementById(id); if(b) b.className='pw-strength-bar';});
  _fpCode=null; _fpCodeExp=0; _fpCooldown=0;
  if(_fpCodeTimer){ clearInterval(_fpCodeTimer); _fpCodeTimer=null; }
  if(window._fpPendingTarget){ try{ delete window._fpPendingTarget; }catch(e){ window._fpPendingTarget=null; } }
  initFpOtp();
  showFpStep(1);
  openModal('forgotModal');
  updateFpVerifyBtnState();
}
function fpBackToLogin(){
  closeModal('forgotModal');
  showLogin();
}
function fpBackToStep1(){
  showFpStep(1);
  const err=document.getElementById('forgotError'); if(err) err.style.display='none';
}
function toggleFpMethod(){ /* email-only flow — method fixed to email */ }
function updateFpVerifyBtnState(){
  const btn=document.getElementById('fp_verify_btn');
  if(!btn) return;
  const code=(document.getElementById('fp_code_input')?document.getElementById('fp_code_input').value.trim():getFpOtp());
  const shouldDisable = code.length!==6;
  btn.disabled=shouldDisable;
  btn.style.opacity=shouldDisable?'0.5':'';
  btn.style.cursor=shouldDisable?'not-allowed':'';
}
function onFpCodeInput(){
  const err=document.getElementById('fp_code_error'); if(err) err.style.display='none';
  const forgotErr=document.getElementById('forgotError'); if(forgotErr) forgotErr.style.display='none';
  updateFpVerifyBtnState();
}
function sendForgotCode(){
  if(_fpStep===2) resendForgotCode();
  else fpSubmitCode();
}
function fpBackToLoginAlias(){ fpBackToLogin(); }
async function resendForgotCode(){
  // Firebase Auth generates and rate-limits the reset link now; there is no
  // client-side OTP to resend. Reuse the same rate-limited send path.
  return fpSubmitCode();
}
function updateFpStrength(val){
  const bars=[document.getElementById('fps1'),document.getElementById('fps2'),document.getElementById('fps3')];
  const lbl=document.getElementById('fpsLabel');
  if(!bars[0]||!lbl) return;
  bars.forEach(b=>{b.className='pw-strength-bar'});
  if(!val){lbl.textContent='';return;}
  let score=0;
  if(val.length>=6)score++;if(val.length>=10)score++;
  if(/[A-Z]/.test(val)&&/[0-9]/.test(val))score++;
  const levels=['weak','fair','strong'];
  const labels=['Weak','Fair','Strong'];
  for(let i=0;i<score;i++)bars[i].classList.add(levels[Math.min(score-1,2)]);
  lbl.textContent=labels[Math.min(score-1,2)]||'';
}
async function fpSubmitCode(){
  const err=document.getElementById('forgotError');
  const suc=document.getElementById('forgotSuccess');
  if(err) err.style.display='none'; if(suc) suc.style.display='none';
  const sb=document.getElementById('fp_submit_btn');
  const email=(document.getElementById('fp_email')?document.getElementById('fp_email').value.trim():'');
  const emailLower=email.toLowerCase();
  if(!email){if(err){err.textContent='Please enter your email.';err.style.display='block';}return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){if(err){err.textContent='Please enter a valid email address.';err.style.display='block';}return;}
  if(Date.now()<_fpCooldown){if(err){err.textContent='Please wait '+Math.ceil((_fpCooldown-Date.now())/1000)+'s before sending again.';err.style.display='block';}return;}
  if(!rateLimitOk('gms_rl_forgot',3,15*60*1000)){
    if(err){err.textContent='Too many reset requests. Please wait 15 minutes and try again.';err.style.display='block';}
    return;
  }
  if(sb){ sb.disabled=true; sb.style.opacity='0.7'; sb.textContent='Sending…'; }
  // SECURITY: Firebase Auth generates and verifies the reset link server-side.
  // There is no client-side OTP or password hash to forge, and the response is
  // intentionally generic so the form cannot be used to enumerate accounts.
  let sent=false;
  try{
    if(window.GMSFB&&GMSFB.enabled&&GMSFB.auth&&typeof GMSFB.auth.sendPasswordResetEmail==='function'){
      await GMSFB.auth.sendPasswordResetEmail(emailLower);
      sent=true;
    }
  }catch(e){
    console.warn('[reset] sendPasswordResetEmail',e&&e.code);
  }
  _fpCooldown=Date.now()+60*1000;
  if(sb){ sb.disabled=false; sb.style.opacity=''; sb.textContent='Send Reset Link'; }
  const prog=document.getElementById('fpProgress'); if(prog) prog.style.display='none';
  if(suc){
    suc.innerHTML='If <strong>'+esc(emailLower)+'</strong> is linked to an account, a secure reset link is on its way. Check your inbox and spam folder.<br><span style="font-size:12px;color:var(--gray-400)">No email? Your account may use a staff-managed password — please contact the front desk.</span>';
    suc.style.display='block';
  }
  toast(sent?'Password reset link sent — check your email.':'If an account exists, a reset link has been sent.','info');
}
async function fpVerifyCode(){
  const err=document.getElementById('forgotError');
  const codeErr=document.getElementById('fp_code_error');
  if(err) err.style.display='none';
  if(codeErr) codeErr.style.display='none';
  const entered=getFpOtp()||(document.getElementById('fp_code_input')?document.getElementById('fp_code_input').value.trim():'');
  const legacyOtp=(document.getElementById('fp_otp')?document.getElementById('fp_otp').value.trim():'');
  const finalCode=entered || legacyOtp;
  if(!finalCode){ if(err){err.textContent='Please enter the 6-digit verification code.';err.style.display='block';} if(codeErr){codeErr.textContent='Please enter the 6-digit code.';codeErr.style.display='block';} return;}
  if(finalCode.length!==6 || !/^\d{6}$/.test(finalCode)){ if(err){err.textContent='Code must be 6 digits.';err.style.display='block';} if(codeErr){codeErr.textContent='Code must be 6 digits.';codeErr.style.display='block';} return;}
  if(!_fpCode || Date.now()>_fpCodeExp){
    const msg='Code expired. Please tap Resend Code to get a new one.';
    if(err){err.textContent=msg;err.style.display='block';}
    if(codeErr){codeErr.textContent=msg;codeErr.style.display='block';}
    return;
  }
  if(finalCode!==_fpCode){
    const msg='Invalid code. Please check and try again.';
    if(err){err.textContent=msg;err.style.display='block';}
    if(codeErr){codeErr.textContent=msg;codeErr.style.display='block';}
    return;
  }
  const verifyBtn=document.getElementById('fp_verify_btn');
  setFpBtnLoading(verifyBtn,true,'Verifying…');
  await new Promise(r=>setTimeout(r,350));
  const pending=window._fpPendingTarget || {};
  let username=pending.username || '';
  let targetId=pending.targetId;
  let targetType=pending.targetType;
  _fpVerified={username:username,targetId:targetId,targetType:targetType,expiresAt:Date.now()+10*60*1000};
  try{ sessionStorage.setItem('gms_fp_verified', JSON.stringify(_fpVerified)); }catch(e){}
  try{ delete window._fpPendingTarget; }catch(e){ window._fpPendingTarget=null; }
  const _n1=document.getElementById('fp_new_pass'); if(_n1) _n1.value='';
  const _n2=document.getElementById('fp_new_pass2'); if(_n2) _n2.value='';
  const _e2=document.getElementById('fpsError'); if(_e2) _e2.style.display='none';
  const _s2=document.getElementById('fpsSuccess'); if(_s2) _s2.style.display='none';
  const _lbl=document.getElementById('fpsLabel'); if(_lbl) _lbl.textContent='';
  ['fps1','fps2','fps3'].forEach(id=>{const b=document.getElementById(id); if(b) b.className='pw-strength-bar';});
  showFpStep(3);
  setFpBtnLoading(verifyBtn,false);
  toast('Code verified — now set your new password.','success');
  _fpCode=null; _fpCodeExp=0;
  if(_fpCodeTimer){clearInterval(_fpCodeTimer); _fpCodeTimer=null;}
}
async function handleForgotVerify(){ return _fpStep===2 ? fpVerifyCode() : fpSubmitCode(); }
async function verifyForgotCode(){ return fpVerifyCode(); }
function submitForgotPassword(){ return _fpStep===2 ? fpVerifyCode() : fpSubmitCode(); }
async function confirmForgotPassword(){
  const err=document.getElementById('fpsError');
  const suc=document.getElementById('fpsSuccess');
  if(err) err.style.display='none'; if(suc) suc.style.display='none';
  const passEl=document.getElementById('fp_new_pass');
  const pass2El=document.getElementById('fp_new_pass2');
  const pass=passEl?passEl.value:'';
  const pass2=pass2El?pass2El.value:'';
  const isForcedMode=_fpForcedMode===true;
  if(!pass||!pass2){if(err){err.textContent='Please enter new password.';err.style.display='block';}return;}
  if(pass.length<8){if(err){err.textContent='Password must be at least 8 characters.';err.style.display='block';}return;}
  if(pass!==pass2){if(err){err.textContent='Passwords do not match.';err.style.display='block';}return;}
  let verified=_fpVerified;
  if(!verified){
    try{
      const stored=sessionStorage.getItem('gms_fp_verified');
      if(stored) verified=JSON.parse(stored);
    }catch(e){}
  }
  if(!verified){if(err){err.textContent='Verification expired. Please verify again.';err.style.display='block';}return;}
  if(Date.now()>verified.expiresAt){clearFpVerified(); if(err){err.textContent='Verification expired. Please verify again.';err.style.display='block';}return;}
  const confirmBtn=document.getElementById('fp_confirm_btn');
  setFpBtnLoading(confirmBtn,true,'Saving…');
  const username=verified.username;
  const targetId=verified.targetId;
  const targetType=verified.targetType;
  // Privileged accounts are reset only through the Firebase Auth email link.
  // Never fall back to a client-side hash write for staff/trainer/admin.
  if(targetType==='user'){
    setFpBtnLoading(confirmBtn,false);
    clearFpVerified();
    if(err){err.textContent='Staff, trainer and admin passwords are reset through the Forgot Password email link, not this screen.';err.style.display='block';}
    return;
  }
  let target=Members.all().find(m=>m.id===targetId) || Members.all().find(m=>m.username&&m.username.toLowerCase()===username.toLowerCase());
  if(!target && window.GMSFB && GMSFB.enabled){
    try{
      let authed=false;
      if(!GMSFB.auth.currentUser){
        try{ const r=await GMSFB.auth.signInAnonymously(); authed=r.user!=null; }catch(e){ authed=false; }
      } else authed=true;
      if(authed){
        if(targetType==='user' && typeof GMSFB.fetchUserByLogin==='function'){
          const u=await GMSFB.fetchUserByLogin(username.toLowerCase());
          if(u) target=u;
        } else if(targetType==='member' && typeof GMSFB.fetchMemberByLogin==='function'){
          const m=await GMSFB.fetchMemberByLogin(username.toLowerCase());
          if(m) target=m;
        } else {
          if(typeof GMSFB.fetchUserByLogin==='function'){
            const u=await GMSFB.fetchUserByLogin(username.toLowerCase());
            if(u) target=u;
          }
          if(!target && typeof GMSFB.fetchMemberByLogin==='function'){
            const m=await GMSFB.fetchMemberByLogin(username.toLowerCase());
            if(m) target=m;
          }
        }
        if(!target && typeof GMSFB.fetchDoc==='function'){
          try{
            const doc=await GMSFB.fetchDoc(targetType==='member'?'members':'users', targetId);
            if(doc){ target=doc; if(!target.id) target.id=targetId; }
          }catch(e){}
        }
      }
    }catch(e){}
  }
  if(!target){ setFpBtnLoading(confirmBtn,false); if(err){err.textContent='Account not found. Please try again.';err.style.display='block';}return;}
  // Members who logged in with the admin temp password have no Firebase Auth
  // session, so Firestore rejects their writes. Try anonymous auth so the new
  // password can still reach the cloud; the local override below covers
  // devices where anonymous auth is disabled.
  await ensureCloudWriteAuth();
  const newHash=hashPassword(pass);
  let oldMemberHash='';
  let ok=false;
  try{
    if(targetType==='user'){
      const users=Users.all();
      const idx=users.findIndex(u=>u.id===target.id);
      if(idx>-1){ users[idx].passwordHash=newHash; users[idx].mustChangePassword=false; delete users[idx].password; Users.save(users); ok=true; }
      else {
        target.passwordHash=newHash;
        target.mustChangePassword=false;
        if(window.GMSFB && GMSFB.enabled){
          await GMSFB.pushCollection(KEY.users, Users.all()).catch(()=>{});
          try{ await GMSFB.secSetDoc('users', target); }catch(e){}
        }
        ok=true;
      }
      if(window.GMSFB && GMSFB.enabled && target.authEmail){
        try{
          await GMSFB.auth.sendPasswordResetEmail(target.authEmail).catch(()=>{});
        }catch(e){}
      }
    } else {
      // SINGLE WRITE: passwordHash + mustChangePassword=false together.
      // Clearing only in forced mode (or in a second delayed write) left the
      // flag true on cloud → loadApp re-opened the force-reset gate forever.
      const members=Members.all();
      const sun=(username||'').toLowerCase();
      const sessMid=(currentUser&&(currentUser.memberId||currentUser.id))||'';
      let idx=members.findIndex(m=>m.id===target.id);
      if(idx<0&&targetId) idx=members.findIndex(m=>m.id===targetId);
      if(idx<0&&sun) idx=members.findIndex(m=>m.username&&String(m.username).toLowerCase()===sun);
      if(idx<0&&sessMid) idx=members.findIndex(m=>m.id===sessMid);
      if(idx>-1){
        oldMemberHash=members[idx].passwordHash||'';
        members[idx].passwordHash=newHash;
        members[idx].authEmail=members[idx].authEmail||target.authEmail;
        members[idx].mustChangePassword=false;
        delete members[idx].password;
        Members.save(members);
        target=members[idx];
        ok=true;
      } else {
        oldMemberHash=target.passwordHash||'';
        target.passwordHash=newHash;
        target.mustChangePassword=false;
        if(window.GMSFB && GMSFB.enabled){
          try{ await GMSFB.secSetDoc('members', target); }catch(e){}
        }
        ok=true;
      }
      if(window.GMSFB && GMSFB.enabled){
        try{ await GMSFB.pushCollection(KEY.members, members); }catch(e){}
        // Belt-and-suspenders: force the flag off on the cloud doc even if
        // the collection push no-ops (stale _lastCloud diff).
        if(target&&target.id){
          try{ await GMSFB.secSetDoc('members',{...target,mustChangePassword:false,passwordHash:newHash}); }catch(e){}
        }
      }
      // NOTE: For members with real email, Firebase Auth password is NOT updated
      // client-side. The hash fallback in login handles authentication. If the
      // member needs cross-device Firebase Auth sync, they should use the
      // "Forgot Password" flow from the login screen to trigger a proper
      // Firebase Auth reset email.
    }
  }catch(e){ console.error(e); }
  if(ok){
    try{ LoginAttempts.reset(username); }catch(e){}
    // Keep the new hash on this device: members who logged in with the admin
    // temp password have no Auth session, so the cloud write may have failed.
    if(targetType==='member'){
      const ovId=(target&&target.id)||targetId;
      if(ovId) _savePwOverride(ovId,newHash,oldMemberHash);
    }
    // Safety net: if this was a member reset, force the flag off in local
    // cache + cloud even when the primary write path missed (id mismatch).
    if(targetType==='member'){
      try{
        const members=Members.all();
        const sun2=(username||'').toLowerCase();
        const sessMid2=(currentUser&&(currentUser.memberId||currentUser.id))||'';
        let changed=false;
        members.forEach(m=>{
          const isTarget=m.id===target.id||(targetId&&m.id===targetId);
          const match=isTarget||(sun2&&String(m.username||'').toLowerCase()===sun2)||(sessMid2&&m.id===sessMid2);
          if(isTarget&&m.passwordHash!==newHash){ m.passwordHash=newHash; changed=true; }
          if(match&&m.mustChangePassword!==false){m.mustChangePassword=false;changed=true;}
        });
        if(changed){
          Members.save(members);
          if(window.GMSFB&&GMSFB.enabled){ try{ await GMSFB.pushCollection(KEY.members,Members.all()); }catch(e){} }
        }
        if(currentUser&&currentUser.role==='member'){
          const mid=currentUser.memberId||currentUser.id;
          const live=Members.one(mid);
          if(live&&live.mustChangePassword) Members.update(mid,{mustChangePassword:false});
        }
      }catch(e){}
    }
    if(suc){suc.textContent=isForcedMode?'Password updated — opening your dashboard…':'Password reset successful! You can now log in with your new password.'; suc.style.display='block';}
    if(err) err.style.display='none';
    toast(isForcedMode?'Password updated successfully.':'Password reset - please log in with the new password.','success');
    _fpCode=null;
    clearFpVerified();
    if(isForcedMode){
      // Forced mode: clear flag state BEFORE close (closeModal is blocked while forced)
      setTimeout(()=>{
        _fpForcedMode=false;
        const banner=document.getElementById('fpsBanner');if(banner)banner.style.display='none';
        const prog=document.getElementById('fpProgress');if(prog)prog.style.display='';
        const closeBtn=document.querySelector('#forgotModal .modal-close');if(closeBtn)closeBtn.style.display='';
        closeModal('forgotModal');
        loadApp();
      },1800);
    } else {
      setTimeout(()=>{
        closeModal('forgotModal');
        document.getElementById('loginUser').value=username;
        document.getElementById('loginPass').value='';
        const _lp=document.getElementById('loginPass'); if(_lp) _lp.focus();
      },1800);
    }
  } else {
    setFpBtnLoading(confirmBtn,false);
    if(err){err.textContent='Reset failed. Please check internet and try again, or contact admin.';err.style.display='block';}
  }
}


const PH_ADDR_API='https://psgc.gitlab.io/api/';
const _phAddrCache={};
const _phReq={ms:{city:0,brgy:0},reg:{city:0,brgy:0}};
let _phProvincesPromise=null;
function phAddrFetch(path){
  if(_phAddrCache[path])return Promise.resolve(_phAddrCache[path]);
  const ctl=typeof AbortController==='function'?new AbortController():null;
  const timer=ctl?setTimeout(()=>ctl.abort(),15000):null;
  return fetch(PH_ADDR_API+path,ctl?{signal:ctl.signal}:undefined).then(r=>{
    if(!r.ok)throw new Error('Address data '+r.status);
    return r.json();
  }).then(data=>{
    if(!Array.isArray(data))throw new Error('Invalid address data');
    _phAddrCache[path]=data;
    return data;
  }).finally(()=>{if(timer)clearTimeout(timer);});
}
function phAddrReset(sel,label){
  if(!sel)return;
  sel.textContent='';
  const o=document.createElement('option');o.value='';o.textContent=label;sel.appendChild(o);
  sel.value='';
}
function phAddrFill(sel,items,label){
  if(!sel)return;
  const current=sel.value;
  phAddrReset(sel,label);
  items.forEach(item=>{
    const name=String(item.name||'').trim();
    if(!item.code||!name)return;
    const o=document.createElement('option');o.value=item.code;o.textContent=name;sel.appendChild(o);
  });
  sel.value=current&&items.some(i=>i.code===current)?current:'';
  sel.disabled=false;
}
function phAddrError(sel,label){
  if(!sel)return;
  phAddrReset(sel,label);
  sel.disabled=false;
}
async function loadPhProvinces(){
  if(_phProvincesPromise)return _phProvincesPromise;
  _phProvincesPromise=(async()=>{
    const list=await phAddrFetch('provinces/');
    const provinces=[{code:'130000000',name:'Metro Manila'}].concat(list)
      .map(p=>({code:p.code,name:String(p.name||'').trim()}))
      .filter(p=>p.code&&p.name)
      .sort((a,b)=>a.name.localeCompare(b.name));
    ['ms','reg'].forEach(prefix=>phAddrFill(document.getElementById(prefix+'Province'),provinces,'Select Province'));
    return provinces;
  })().catch(err=>{_phProvincesPromise=null;throw err;});
  return _phProvincesPromise;
}
function retryPhProvinces(sel){
  if(sel&&sel.options.length<=1)loadPhProvinces().catch(()=>{});
}
async function loadPhCities(prefix,provinceCode){
  const city=document.getElementById(prefix+'City');
  const brgy=document.getElementById(prefix+'Barangay');
  const req=++_phReq[prefix].city;
  ++_phReq[prefix].brgy;
  if(brgy){phAddrReset(brgy,'Select Barangay');brgy.disabled=true;}
  if(!city)return;
  if(!provinceCode){phAddrReset(city,'Select City');city.disabled=true;return;}
  city.disabled=true;phAddrReset(city,'Loading cities…');
  try{
    const path=provinceCode==='130000000'
      ?'regions/130000000/cities-municipalities/'
      :'provinces/'+encodeURIComponent(provinceCode)+'/cities-municipalities/';
    const cities=await phAddrFetch(path);
    if(req!==_phReq[prefix].city)return;
    const items=cities.map(c=>({code:c.code,name:String(c.name||'').trim()})).filter(c=>c.code&&c.name).sort((a,b)=>a.name.localeCompare(b.name));
    if(!items.length){phAddrError(city,'No cities found — reselect province');return;}
    phAddrFill(city,items,'Select City');
  }catch(e){
    if(req===_phReq[prefix].city)phAddrError(city,'Unable to load cities — reselect province');
  }
}
async function loadPhBarangays(prefix,cityCode){
  const sel=document.getElementById(prefix+'Barangay');
  if(!sel)return;
  const req=++_phReq[prefix].brgy;
  if(!cityCode){phAddrReset(sel,'Select Barangay');sel.disabled=true;return;}
  sel.disabled=true;phAddrReset(sel,'Loading barangays…');
  try{
    const data=await phAddrFetch('cities-municipalities/'+encodeURIComponent(cityCode)+'/barangays/');
    if(req!==_phReq[prefix].brgy)return;
    const items=data.map(b=>({code:b.code,name:String(b.name||'').trim()})).filter(b=>b.code&&b.name).sort((a,b)=>a.name.localeCompare(b.name));
    if(!items.length){phAddrError(sel,'No barangays found — reselect city');return;}
    phAddrFill(sel,items,'Select Barangay');
  }catch(e){
    if(req===_phReq[prefix].brgy)phAddrError(sel,'Unable to load barangays — reselect city');
  }
}
function resetPhAddress(prefix){
  ++_phReq[prefix].city;++_phReq[prefix].brgy;
  const p=document.getElementById(prefix+'Province');
  const c=document.getElementById(prefix+'City');
  const b=document.getElementById(prefix+'Barangay');
  if(p)p.value='';
  if(c){phAddrReset(c,'Select City');c.disabled=true;}
  if(b){phAddrReset(b,'Select Barangay');b.disabled=true;}
}
function getAddressParts(prefix){
  const v=id=>{
    const el=document.getElementById(prefix+id);
    if(!el)return '';
    if(el.tagName==='SELECT'){
      const opt=el.options[el.selectedIndex];
      return opt&&opt.value?String(opt.textContent||'').trim():'';
    }
    return String(el.value||'').trim();
  };
  const province=v('Province'),city=v('City'),barangay=v('Barangay'),street=v('Street');
  return {province,city,barangay,street,complete:!!(province&&city&&barangay&&street),full:[street,barangay,city,province].filter(Boolean).join(', ')};
}
function resetRegisterForm(){
  ['regName','regFirstName','regMiddleName','regLastName','regSuffix','regProvince','regCity','regBarangay','regStreet','regContact','regUser','regPass','regPass2','regCoachName','regBio'].forEach(function(id){const el=document.getElementById(id);if(el)el.value='';});
  const roleEl=document.getElementById('regRole');if(roleEl)roleEl.value='';
  // Reset role cards
  ['roleCardStaff','roleCardTrainer','roleCardMember'].forEach(function(id){const c=document.getElementById(id);if(c){c.classList.remove('selected');c.style.borderColor='rgba(255,255,255,.12)';c.style.background='rgba(255,255,255,.05)';c.style.boxShadow='none';}});
  document.querySelectorAll('#regSpecGrid input[type=checkbox]').forEach(function(cb){cb.checked=false;});
  document.querySelectorAll('#regAvailDays input[type=checkbox]').forEach(function(cb){cb.checked=false;});
  const fromEl=document.getElementById('regAvailFrom');if(fromEl)fromEl.value='';
  const toEl=document.getElementById('regAvailTo');if(toEl)toEl.value='';
  const bars=['ps1','ps2','ps3'];bars.forEach(function(id){const b=document.getElementById(id);if(b)b.className='pw-strength-bar';});
  const lbl=document.getElementById('psLabel');if(lbl)lbl.textContent='';
  _resetPwVis();
  ['regError','regError2','regError3','regSuccess','regSuccess3'].forEach(function(id){const el=document.getElementById(id);if(el)el.style.display='none';});
  const rd=document.getElementById('regDone');if(rd)rd.style.display='none';
  const rdm=document.getElementById('regDoneMsg');if(rdm){rdm.textContent='';rdm.style.display='none';}
  resetPhAddress('reg');
}
function selectRegRole(role){
  document.getElementById('regRole').value=role;
  const cards={staff:document.getElementById('roleCardStaff'),trainer:document.getElementById('roleCardTrainer'),member:document.getElementById('roleCardMember')};
  Object.keys(cards).forEach(r=>{
    const c=cards[r];
    if(c){
      c.classList.toggle('selected',r===role);
      c.style.borderColor=(r===role)?'var(--green)':'rgba(255,255,255,.12)';
      c.style.background=(r===role)?'rgba(127,250,136,.1)':'rgba(255,255,255,.05)';
      c.style.boxShadow=(r===role)?'0 0 0 3px rgba(127,250,136,.15)':'none';
    }
  });
  document.getElementById('regError').style.display='none';
}
function regStep1Next(){
  // Public registration is Member-only; Staff/Trainer creation via Admin User Management (openUserModal)
  showRegTab('member');
}
function regGoStep1(){
  document.getElementById('regStep2').style.display='none';
  document.getElementById('regStep3').style.display='none';
  const rd=document.getElementById('regDone');if(rd)rd.style.display='none';
  document.getElementById('regStep1').style.display='block';
}
function regGoStep2(){
  document.getElementById('regStep3').style.display='none';
  const rd=document.getElementById('regDone');if(rd)rd.style.display='none';
  document.getElementById('regStep2').style.display='block';
}
function regStep2Next(){
  const role=document.getElementById('regRole').value;
  const firstNameEl=document.getElementById('regFirstName');const middleNameEl=document.getElementById('regMiddleName');const lastNameEl=document.getElementById('regLastName');const suffixEl=document.getElementById('regSuffix');
  const firstName=firstNameEl?firstNameEl.value.trim():'';
  const middleName=middleNameEl?middleNameEl.value.trim():'';
  const lastName=lastNameEl?lastNameEl.value.trim():'';
  const suffix=suffixEl?suffixEl.value.trim():'';
  // Fallback for legacy single field
  const legacyNameEl=document.getElementById('regName');
  const legacyName=legacyNameEl?legacyNameEl.value.trim():'';
  let name='';
  if(firstName||lastName||middleName||suffix){
    name=(sanitizeText(firstName)+(middleName?' '+sanitizeText(middleName):'')+' '+sanitizeText(lastName)+(suffix?' '+sanitizeText(suffix):'')).replace(/\s+/g,' ').trim();
  } else { name=legacyName; }
  const contact=document.getElementById('regContact').value.trim();
  const user=document.getElementById('regUser').value.trim();
  const pass=document.getElementById('regPass').value;
  const pass2=document.getElementById('regPass2').value;
  const err=document.getElementById('regError2');
  err.style.display='none';
  if(!firstName||!lastName){err.textContent='Please fill in First Name and Last Name.';err.style.display='block';return;}
  const regAddr=getAddressParts('reg');
  if(!regAddr.complete){err.textContent='Please fill in your complete address (Province, City, Barangay, Street).';err.style.display='block';return;}
  const regEmail=(document.getElementById('regEmail')?document.getElementById('regEmail').value.trim():'');
  if(!regEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)){err.textContent='Please enter a valid email address.';err.style.display='block';return;}
  if(!contact||!user||!pass||!pass2){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  const dialCode=(document.getElementById('phoneDialCode')?document.getElementById('phoneDialCode').textContent.trim():'+63');
  if(!validatePhone(contact,dialCode)){err.textContent=phoneErrorMsg(dialCode);err.style.display='block';return;}
  if(pass.length<8){err.textContent='Password must be at least 8 characters.';err.style.display='block';return;}
  if(pass!==pass2){err.textContent='Passwords do not match.';err.style.display='block';return;}
  const users=Users.all();
  if(users.find(x=>x.username===user)){err.textContent='Username already taken. Please choose a different username.';err.style.display='block';return;}
  if(role==='trainer'){
    document.getElementById('regStep2').style.display='none';
    document.getElementById('regStep3').style.display='block';
  } else {
    doRegister();
  }
}
function showLogin(){document.getElementById('loginForm').style.display='block';document.getElementById('registerForm').style.display='none';const rd=document.getElementById('regDone');if(rd)rd.style.display='none';document.getElementById('loginError').style.display='none';const ms=document.getElementById('memberSignup');if(ms)ms.style.display='none';const lc=document.getElementById('loginCard');if(lc)lc.style.display='block';_resetPwVis();}
function showRegister(){
  resetRegisterForm();
  document.getElementById('loginForm').style.display='none';
  // Public registration is Member-only (Staff/Trainer via Admin)
  showRegTab('member');
  // Bypass role selection grid entirely for public
  const rf=document.getElementById('registerForm'); if(rf) rf.style.display='none';
  const ms=document.getElementById('memberSignup'); if(ms) ms.style.display='block';
  const lc=document.getElementById('loginCard'); if(lc) lc.style.display='none';
}
function regGoMember(){
  showRegTab('member');
}
function showRegTab(tab){
  const isMember=tab==='member';
  const ms=document.getElementById('memberSignup');
  const rf=document.getElementById('registerForm');
  const lc=document.getElementById('loginCard');if(lc)lc.style.display=isMember?'none':'block';
  if(ms)ms.style.display=isMember?'block':'none';
  if(rf){
    rf.style.display=isMember?'none':'block';
    if(!isMember){
      document.getElementById('regStep1').style.display='block';
      document.getElementById('regStep2').style.display='none';
      document.getElementById('regStep3').style.display='none';
      const e=document.getElementById('regError');if(e)e.style.display='none';
    }
  }
  const le=document.getElementById('loginError');if(le)le.style.display='none';
  const re=document.getElementById('regError');if(re)re.style.display='none';
  if(isMember){
    resetMemberSignupForm();
    const dobIn=document.getElementById('msDob'); if(dobIn) dobIn.max=today();
    populateMsPlanSelect(_memberSignupPlanId);
    const e=document.getElementById('msError');if(e)e.style.display='none';
    const s=document.getElementById('msSuccess');if(s)s.style.display='none';
    iconize(document.getElementById('memberSignup'));
  }
}
// ============================= MEMBER SELF-SIGNUP (Guest → Member) =============================
let _memberSignupPlanId=null;let _msPlanPicked=null;
function populateMsPlanSelect(selectedId){
  const sel=document.getElementById('msPlanSelect');
  const opts=document.getElementById('msPlanOptions');
  if(!sel||!opts)return;
  if(!Plans.all().length&&window.GMSFB&&GMSFB.enabled&&typeof GMSFB.ensureSeededPlans==='function')GMSFB.ensureSeededPlans();
  const plans=Plans.all().filter(p=>p.status==='Active');
  sel.innerHTML=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const pick=plans.find(p=>p.id===selectedId)?selectedId:(plans.length?plans[0].id:'');
  sel.value=pick;_msPlanPicked=pick;
  opts.innerHTML=plans.map(p=>{
    const price=Number(p.price).toLocaleString();
    const dur=p.duration===1?'1 month':p.duration+' months';
    const sess=p.sessions==='Unlimited'?'Unlimited sessions':p.sessions+' sessions';
    const feats=(p.benefits||p.perks||'').split(/\n|,/).map(b=>b.trim()).filter(Boolean).map(b=>`<span class="ms-plan-opt-feat">${esc(b)}</span>`).join('');
    const isSel=p.id===pick;
    return `<div class="ms-plan-opt${isSel?' selected':''}" id="msPlanOpt-${p.id}" onclick="pickMsPlan('${p.id}')">
      <div class="ms-plan-opt-head">
        <div>
          <div class="ms-plan-opt-name">${esc(p.name)}</div>
          <div class="ms-plan-opt-sub">${dur} · ${sess}</div>
        </div>
        <div class="ms-plan-opt-right">
          <div class="ms-plan-opt-price">₱${price}<span class="ms-plan-opt-per">${p.duration===1?'/mo':'/'+p.duration+'mo'}</span></div>
          <div class="ms-plan-opt-check">✓</div>
        </div>
      </div>
      ${isSel&&feats?`<div class="ms-plan-opt-feats">${feats}</div>`:''}
    </div>`;}).join('');
  updateMsPlanCard();
}
function pickMsPlan(planId){
  populateMsPlanSelect(planId);
}
function updateMsPlanCard(){
  const sel=document.getElementById('msPlanSelect');
  const plan=sel?Plans.one(sel.value):null;
  const nameEl=document.getElementById('msPlanName');if(nameEl)nameEl.textContent=plan?plan.name:'—';
  const priceEl=document.getElementById('msPlanPrice');if(priceEl)priceEl.textContent=plan?'₱'+Number(plan.price).toLocaleString()+(plan.duration===1?'/mo':'/'+plan.duration+'mo'):'—';
  const durEl=document.getElementById('msPlanDur');if(durEl)durEl.textContent=plan?(plan.duration+' month(s) · '+(plan.sessions==='Unlimited'?'Unlimited sessions':plan.sessions+' sessions')):'';
  const perksEl=document.getElementById('msPlanPerks');if(perksEl)perksEl.innerHTML=plan?(plan.benefits||plan.perks||'').split(/\n|,/).map(b=>b.trim()).filter(Boolean).map(b=>`<li>✓ ${b}</li>`).join(''):'';
}
function startMemberSignup(planId){
  _memberSignupPlanId=planId;
  showLandingSection('register', document.querySelector('.ln-cta'));
  showRegTab('member');
}
function msBackToLogin(){
  _memberSignupPlanId=null;
  showLogin();
}
function msStep1Next(){
  const sel=document.getElementById('msPlanSelect');
  const err=document.getElementById('msStep1Error');
  if(!_memberSignupPlanId&&!_msPlanPicked&&!(sel&&sel.value)){
    if(err){err.textContent='Please choose a plan to continue.';err.style.display='block';}
    return;
  }
  if(err)err.style.display='none';
  document.getElementById('msStep1').style.display='none';
  document.getElementById('msStep2').style.display='block';
}
function msStep2Next(){
  const firstName=(document.getElementById('firstName')?document.getElementById('firstName').value.trim():'');
  const lastName=(document.getElementById('lastName')?document.getElementById('lastName').value.trim():'');
  const contact=document.getElementById('msContact').value.trim();
  const email=document.getElementById('msEmail').value.trim();
  const err=document.getElementById('msStep2Error');
  if(err)err.style.display='none';
  if(!firstName||!lastName){if(err){err.textContent='Please fill in First Name and Last Name.';err.style.display='block';}return;}
  if(!contact||!email){if(err){err.textContent='Please fill in your contact number and email.';err.style.display='block';}return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){if(err){err.textContent='Please enter a valid email address.';err.style.display='block';}return;}
  const msDial=(document.getElementById('msPhoneDialCode')?document.getElementById('msPhoneDialCode').textContent.trim():'+63');
  if(!validatePhone(contact,msDial)){if(err){err.textContent=phoneErrorMsg(msDial);err.style.display='block';}return;}
  if(Members.all().find(m=>m.email&&m.email.toLowerCase()===email.toLowerCase())){if(err){err.textContent='Email already registered. Please log in instead.';err.style.display='block';}return;}
  const normContact2=normalizeContact(contact,msDial);
  if(Members.all().find(m=>m.contact===normContact2)){if(err){err.textContent='Phone number already registered. Please log in or use another number.';err.style.display='block';}return;}
  const err3=document.getElementById('msStep3Error');if(err3)err3.style.display='none';
  document.getElementById('msStep2').style.display='none';
  document.getElementById('msStep3').style.display='block';
}
function msGoStep1(){
  document.getElementById('msStep2').style.display='none';
  document.getElementById('msStep3').style.display='none';
  document.getElementById('msStep4').style.display='none';
  document.getElementById('msStep5').style.display='none';
  document.getElementById('msStep1').style.display='block';
  const suc=document.getElementById('msSuccess');if(suc)suc.style.display='none';
  const e=document.getElementById('msError');if(e)e.style.display='none';
}
function msGoStep2(){
  document.getElementById('msStep3').style.display='none';
  document.getElementById('msStep4').style.display='none';
  document.getElementById('msStep2').style.display='block';
  const suc=document.getElementById('msSuccess');if(suc)suc.style.display='none';
  const e=document.getElementById('msError');if(e)e.style.display='none';
}
function msGoStep3(){
  document.getElementById('msStep4').style.display='none';
  document.getElementById('msStep3').style.display='block';
  const suc=document.getElementById('msSuccess');if(suc)suc.style.display='none';
  const e=document.getElementById('msError');if(e)e.style.display='none';
}
function resetMemberSignupForm(){
  ['msName','firstName','middleName','lastName','suffix','msProvince','msCity','msBarangay','msStreet','msUsername','msContact','msEmail','msPass','msPass2','msDob','msGuardianName','msEcName','msEcNum','msMedical'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const msSex=document.getElementById('msSex'); if(msSex) msSex.value='';
  const hint=document.getElementById('msAgeHint'); if(hint){hint.textContent=''; hint.style.display='none';}
  const gs=document.getElementById('msGuardianSection');if(gs)gs.classList.remove('show');
  const cw=document.getElementById('msConsentWaiver');if(cw)cw.checked=false;
  const cc=document.getElementById('msConsentWritten');if(cc)cc.checked=false;
  ['mps1','mps2','mps3'].forEach(id=>{const b=document.getElementById(id);if(b)b.className='pw-strength-bar';});
  const lbl=document.getElementById('msPsLabel');if(lbl)lbl.textContent='';
  const pw=document.getElementById('msPwStrength');if(pw)pw.style.display='none';
  if(lbl)lbl.style.display='none';
  _resetPwVis();
  const s1=document.getElementById('msStep1');if(s1)s1.style.display='block';
  const s2=document.getElementById('msStep2');if(s2)s2.style.display='none';
  const s3=document.getElementById('msStep3');if(s3)s3.style.display='none';
  const s4=document.getElementById('msStep4');if(s4)s4.style.display='none';
  const done=document.getElementById('msStep5');if(done)done.style.display='none';
  const se=document.getElementById('msStep1Error');if(se)se.style.display='none';
  const se2=document.getElementById('msStep2Error');if(se2)se2.style.display='none';
  const se3=document.getElementById('msStep3Error');if(se3)se3.style.display='none';
  const msuc=document.getElementById('msSuccess');if(msuc)msuc.style.display='none';
  const merr=document.getElementById('msError');if(merr)merr.style.display='none';
  resetPhAddress('ms');
}
function updateMsStrength(val){
  const bars=[document.getElementById('mps1'),document.getElementById('mps2'),document.getElementById('mps3')];
  const lbl=document.getElementById('msPsLabel');
  const wrap=document.getElementById('msPwStrength');
  if(wrap)wrap.style.display=val?'flex':'none';
  if(lbl)lbl.style.display=val?'block':'none';
  bars.forEach(b=>{b.className='pw-strength-bar'});
  if(!val){if(lbl)lbl.textContent='';return;}
  let score=0;
  if(val.length>=8)score++;
  if(val.length>=12)score++;
  if(/[A-Z]/.test(val)&&/[0-9]/.test(val))score++;
  if(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val))score++;
  const levels=['weak','fair','fair','strong'];
  const labels=['Weak','Fair','Good','Strong'];
  const clamped=Math.min(score-1,3);
  for(let i=0;i<=clamped;i++)bars[i].classList.add(levels[clamped]);
  lbl.textContent=labels[clamped]||'';
  // Store score for submit validation
  window._msPwScore=score;
}
function msStep3Next(){
  const msAddr=getAddressParts('ms');
  const dob=document.getElementById('msDob')?document.getElementById('msDob').value.trim():'';
  const err=document.getElementById('msStep3Error');
  if(err)err.style.display='none';
  if(!msAddr.complete){if(err){err.textContent='Please fill in your complete address (Province, City, Barangay, Street).';err.style.display='block';}return;}
  if(!dob){if(err){err.textContent='Please enter your Date of Birth.';err.style.display='block';}return;}
  const age=calcAge(dob);
  if(isNaN(age)){if(err){err.textContent='Please enter a valid date of birth.';err.style.display='block';}return;}
  const pol=dobPolicy(age);
  if(!pol.ok){if(err){err.textContent=pol.msg+' Please check the Age Policy.';err.style.display='block';}return;}
  if(age>=13&&age<=17){
    const gName=(document.getElementById('msGuardianName')?document.getElementById('msGuardianName').value.trim():'');
    if(!gName){if(err){err.textContent='Please enter your Parent/Guardian name (required for ages 13-17).';err.style.display='block';}return;}
    if(age<=15){
      const wc=document.getElementById('msConsentWaiver');
      if(!wc||!wc.checked){if(err){err.textContent='Please confirm that a parent/guardian will be present during all visits.';err.style.display='block';}return;}
    }
    if(age>=16&&age<=17){
      const cc=document.getElementById('msConsentWritten');
      if(!cc||!cc.checked){if(err){err.textContent='Please confirm parental/guardian written consent has been signed on file.';err.style.display='block';}return;}
    }
  }
  document.getElementById('msStep3').style.display='none';
  document.getElementById('msStep4').style.display='block';
}
function msValidateCredentials(err){
  const fail=msg=>{if(err){err.textContent=msg;err.style.display='block';}return null;};
  const firstName=(document.getElementById('firstName')?document.getElementById('firstName').value.trim():'');
  const middleName=(document.getElementById('middleName')?document.getElementById('middleName').value.trim():'');
  const lastName=(document.getElementById('lastName')?document.getElementById('lastName').value.trim():'');
  const suffix=(document.getElementById('suffix')?document.getElementById('suffix').value.trim():'');
  const msAddr=getAddressParts('ms'); const address=msAddr.full;
  const legacyNameEl=document.getElementById('msName');
  let name='';
  if(firstName||lastName){ name=(sanitizeText(firstName)+(middleName?' '+sanitizeText(middleName):'')+' '+sanitizeText(lastName)+(suffix?' '+sanitizeText(suffix):'')).replace(/\s+/g,' ').trim(); } else if(legacyNameEl){ name=legacyNameEl.value.trim(); }
  if(!firstName||!lastName) return fail('Please fill in First Name and Last Name.');
  if(!msAddr.complete) return fail('Please fill in your complete address (Province, City, Barangay, Street).');
  const uname=document.getElementById('msUsername').value.trim();
  const contact=document.getElementById('msContact').value.trim();
  const email=document.getElementById('msEmail').value.trim();
  const dob=document.getElementById('msDob')?document.getElementById('msDob').value.trim():'';
  const sex=document.getElementById('msSex')?document.getElementById('msSex').value:'';
  const pass=document.getElementById('msPass').value;
  const pass2=document.getElementById('msPass2').value;
  const msDial=(document.getElementById('msPhoneDialCode')?document.getElementById('msPhoneDialCode').textContent.trim():'+63');
  if(!uname||!contact||!email||!dob||!pass||!pass2)return fail('Please fill in all required fields (including Address and Date of Birth).');
  const ageM=calcAge(dob);
  const polM=dobPolicy(ageM);
  if(isNaN(ageM)) return fail('Please enter a valid date of birth.');
  if(!polM.ok) return fail(polM.msg);
  // ── Guardian consent enforcement (ages 13-17) ──
  if(ageM>=13&&ageM<=17){
    const gName=(document.getElementById('msGuardianName')?document.getElementById('msGuardianName').value.trim():'');
    if(!gName) return fail('Please enter your Parent/Guardian name (required for ages 13-17).');
    if(ageM<=15){ const wc=document.getElementById('msConsentWaiver'); if(!wc||!wc.checked) return fail('Please confirm that a parent/guardian will be present during all visits.'); }
    if(ageM>=16&&ageM<=17){ const cc=document.getElementById('msConsentWritten'); if(!cc||!cc.checked) return fail('Please confirm parental/guardian written consent has been signed on file.'); }
  }
  if(!/^[a-zA-Z0-9._]{3,20}$/.test(uname))return fail('Username must be 3–20 characters (letters, numbers, dots, underscores only).');
  if(Members.all().find(m=>m.username&&m.username.toLowerCase()===uname.toLowerCase())||Users.all().find(u=>u.username&&u.username.toLowerCase()===uname.toLowerCase()))return fail('Username already taken. Please choose another.');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail('Please enter a valid email address.');
  if(!validatePhone(contact,msDial))return fail(phoneErrorMsg(msDial));
  if(pass.length<8)return fail('Password must be at least 8 characters.');
  if(pass!==pass2)return fail('Passwords do not match.');
  // Require at least "Fair" password strength (score >= 2)
  if((window._msPwScore||0)<2)return fail('Password is too weak. Please add uppercase, numbers, or special characters.');
  const normContact=normalizeContact(contact,msDial);
  if(Members.all().find(m=>m.contact===normContact))return fail('Phone number already registered. Please log in instead or use another number.');
  return{name,uname,contact:normContact,email,pass,dob,sex,age:ageM,address,province:msAddr.province,city:msAddr.city,barangay:msAddr.barangay,street:msAddr.street,firstName,middleName,lastName,suffix};
}
async function submitMemberSignup(){
  const btn=document.getElementById('msSubmitBtn'); const sp=document.getElementById('msSubmitSpinner'); const tx=document.getElementById('msSubmitText');
  if(btn){ btn.disabled=true; btn.style.opacity='0.85'; btn.style.cursor='not-allowed'; btn.style.boxShadow='0 0 0 3px rgba(127,250,136,.25), 0 0 24px rgba(127,250,136,.45)'; }
  if(sp) sp.style.display='inline-block'; if(tx) tx.textContent='Creating Account…';
  const err=document.getElementById('msError');
  const restoreBtn=()=>{ if(btn){ btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; btn.style.boxShadow=''; } if(sp) sp.style.display='none'; if(tx) tx.textContent='Create My Account'; };
  if(signupRateCheck()){err.textContent='Too many sign-up attempts. Please wait a few minutes and try again.';err.style.display='block'; restoreBtn(); return;}
  const sel=document.getElementById('msPlanSelect');
  const planId=_memberSignupPlanId||_msPlanPicked||(sel?sel.value:'');
  if(!planId){err.textContent='Please choose a plan first.';err.style.display='block'; restoreBtn(); return;}
  const v=msValidateCredentials(err);
  if(!v){ restoreBtn(); return; }
  // ---------- CLOUD-ONLY REGISTRATION ----------
  // The member doc and pending-payment notification are written straight to
  // Firestore through the secondary app's authenticated context. Nothing is
  // stored in localStorage here — the live snapshot delivers the new member
  // to every device, including this one. Member activity is intentionally
  // kept out of the internal activity log (member privacy).
  if(!(window.GMSFB&&GMSFB.enabled)){
    err.textContent='Registration requires an internet connection. Please connect to the internet and try again.';err.style.display='block'; restoreBtn(); return;
  }
  // SECURITY: use the member's real email as the Firebase Auth identity.
  // The old synthetic username@fitcoregym.local identity made secure
  // Firebase password-reset emails impossible (the inbox did not exist).
  const authEmail=String(v.email||'').trim().toLowerCase();
  if(!authEmail){err.textContent='A valid email address is required for your login account.';err.style.display='block';restoreBtn();return;}
  // Server-side duplicate check (catches cross-device duplicates)
  try{
    const dupUser=await GMSFB.db.collection('members').where('username','==',v.uname.toLowerCase()).limit(1).get();
    if(!dupUser.empty){err.textContent='Username already taken. Please choose another.';err.style.display='block'; restoreBtn(); return;}
    const dupContact=await GMSFB.db.collection('members').where('contact','==',v.contact).limit(1).get();
    if(!dupContact.empty){err.textContent='Phone number already registered. Please log in instead.';err.style.display='block'; restoreBtn(); return;}
    if(v.email){
      const dupEmail=await GMSFB.db.collection('members').where('email','==',v.email.toLowerCase()).limit(1).get();
      if(!dupEmail.empty){err.textContent='Email already registered. Please log in instead.';err.style.display='block'; restoreBtn(); return;}
    }
  }catch(e){}
  const r=await GMSFB.createUserCreds(authEmail,v.pass,v.contact);
  if(!r.ok){
    if(r.code==='auth/email-already-in-use'){
      // Recover earlier half-finished signups: verify the password on the
      // SECONDARY app (the context secSetDoc writes through).
      const si=await GMSFB.secSignIn(authEmail,v.pass);
      if(!si.ok){err.textContent='Email already registered. Please log in instead.';err.style.display='block'; restoreBtn(); return;}
    } else {err.textContent=r.error;err.style.display='block'; restoreBtn(); return;}
  }
  const plan=planId?Plans.one(planId):null;
  // Collision-safe ID: the local cache may be empty on guest devices, so also
  // skip any ID that already exists in the cloud mirror.
  let id=nextMemberId();
  const cloudMembers=(window.GMSFB&&GMSFB._lastCloud&&GMSFB._lastCloud.members)||{};
  while(cloudMembers[id])id='MEM-'+String(parseInt(id.split('-')[1],10)+1).padStart(4,'0');
  const dob=v.dob||''; const calcAgeVal=v.age||calcAge(dob);
  const addr=sanitizeText(v.address||'');
  // Guardian consent fields (ages 13-17)
  const gName=(document.getElementById('msGuardianName')?document.getElementById('msGuardianName').value.trim():'');
  const consentWaiver=calcAgeVal>=13&&calcAgeVal<=15?!!(document.getElementById('msConsentWaiver')&&document.getElementById('msConsentWaiver').checked):true;
  const consentWritten=calcAgeVal>=16&&calcAgeVal<=17?!!(document.getElementById('msConsentWritten')&&document.getElementById('msConsentWritten').checked):true;
  const ecName=(document.getElementById('msEcName')?document.getElementById('msEcName').value.trim():'');
  const ecNum=(document.getElementById('msEcNum')?document.getElementById('msEcNum').value.trim():'');
  const medicalNotes=(document.getElementById('msMedical')?document.getElementById('msMedical').value.trim():'');
  const member={id,name:sanitizeText(v.name),firstName:sanitizeText(v.firstName||''),middleName:sanitizeText(v.middleName||''),lastName:sanitizeText(v.lastName||''),suffix:sanitizeText(v.suffix||''),username:v.uname,contact:v.contact,email:sanitizeText(v.email),dob:dob,age:String(calcAgeVal),sex:sanitizeText(v.sex||''),planId,status:'pending_payment',startDate:'',expiryDate:'',planStart:'',qrToken:'',address:addr,province:sanitizeText(v.province||''),city:sanitizeText(v.city||''),barangay:sanitizeText(v.barangay||''),street:sanitizeText(v.street||''),ecName:sanitizeText(ecName),ecNum:sanitizeText(ecNum),notes:sanitizeText(medicalNotes),createdAt:today(),createdBy:'Self',createdByUsername:v.uname,createdByRole:'member',bgCheckStatus:'Pending',bgCheckDate:'',bgCheckBy:'',bgCheckNotes:'',authEmail,guardianName:sanitizeText(gName||''),consentWaiver:consentWaiver,consentWritten:consentWritten};
  const wr=await GMSFB.secSetDoc('members',member);
  if(!wr||!wr.ok){
    GMSFB.secondarySignOut();
    err.textContent='Registration could not reach the server. Please check your internet connection and try again.';err.style.display='block'; restoreBtn(); return;
  }
  const notif={id:'NTF-'+uid(),memberId:member.id,planId:member.planId||'',type:'pending_payment',status:'open',createdAt:member.createdAt||today()};
  await GMSFB.secSetDoc('notifications',notif);
  GMSFB.secondarySignOut();
  restoreBtn();
  _memberSignupPlanId=null;
  document.getElementById('msStep3').style.display='none';
  document.getElementById('msStep4').style.display='none';
  const done=document.getElementById('msStep5');
  const msg=document.getElementById('msDoneMsg');
  if(msg)msg.textContent='Account registered! Please pay at the front desk (Cash or GCash) to activate your membership. You can log in once our staff confirms your payment.';
  if(done)done.style.display='block';
}
function onRegRoleChange(val){}
async function doRegister(){
  const role=document.getElementById('regRole').value;
  const rateErr=role==='trainer'?document.getElementById('regError3'):document.getElementById('regError2');
  if(rateErr&&signupRateCheck()){rateErr.textContent='Too many sign-up attempts. Please wait a few minutes and try again.';rateErr.style.display='block';return;}
  const _rf=document.getElementById('regFirstName');const _rm=document.getElementById('regMiddleName');const _rl=document.getElementById('regLastName');const _rs=document.getElementById('regSuffix');
  const firstName=_rf?_rf.value.trim():'';const middleName=_rm?_rm.value.trim():'';const lastName=_rl?_rl.value.trim():'';const suffix=_rs?_rs.value.trim():'';
  const legacyNameEl=document.getElementById('regName');const legacyName=legacyNameEl?legacyNameEl.value.trim():'';
  let name='';
  if(firstName||lastName){ name=(sanitizeText(firstName)+(middleName?' '+sanitizeText(middleName):'')+' '+sanitizeText(lastName)+(suffix?' '+sanitizeText(suffix):'')).replace(/\s+/g,' ').trim(); } else { name=legacyName; }
  if(!firstName||!lastName){ const errEl=document.getElementById(role==='trainer'?'regError3':'regError2'); if(errEl){errEl.textContent='Please fill in First Name and Last Name.';errEl.style.display='block';} return; }
  const contact=document.getElementById('regContact').value.trim();
  const user=document.getElementById('regUser').value.trim();
  const pass=document.getElementById('regPass').value;
  const dialCode=document.getElementById('phoneDialCode')?document.getElementById('phoneDialCode').textContent.trim():'+63';
  if(!validatePhone(contact,dialCode)){
    const errEl=document.getElementById(role==='trainer'?'regError3':'regError2');
    if(errEl){errEl.textContent=phoneErrorMsg(dialCode);errEl.style.display='block';}
    return;
  }
  const fullContact=normalizeContact(contact,dialCode);
  const regAddr=getAddressParts('reg'); const address=regAddr.full;
  if(!regAddr.complete){ const errEl=document.getElementById(role==='trainer'?'regError3':'regError2'); if(errEl){errEl.textContent='Please fill in your complete address (Province, City, Barangay, Street).';errEl.style.display='block';} return; }
  if(role==='admin'){return;}
  let trainerData={};
  if(role==='trainer'){
    const coachName=document.getElementById('regCoachName').value.trim();
    const specs=[...document.querySelectorAll('#regSpecGrid input[type=checkbox]:checked')].map(c=>c.value);
    const days=[...document.querySelectorAll('#regAvailDays input[type=checkbox]:checked')].map(c=>c.value);
    const from=document.getElementById('regAvailFrom').value;
    const to=document.getElementById('regAvailTo').value;
    const bio=document.getElementById('regBio').value.trim();
    const err3=document.getElementById('regError3');
    err3.style.display='none';
    if(!coachName){err3.textContent='Please enter a Coach/Display Name.';err3.style.display='block';return;}
    if(specs.length===0){err3.textContent='Please select at least one specialization.';err3.style.display='block';return;}
    if(days.length===0||!from||!to){err3.textContent='Please fill in your availability (days and hours).';err3.style.display='block';return;}
    trainerData={coachName,specializations:specs,availableDays:days,availableFrom:from,availableTo:to,bio};
  }
  const result=await Auth.register(role,{name,firstName,middleName,lastName,suffix,address:sanitizeText(address),province:regAddr.province,city:regAddr.city,barangay:regAddr.barangay,street:regAddr.street,contact:fullContact,username:user,email:(document.getElementById('regEmail')?document.getElementById('regEmail').value.trim():''),password:pass,...trainerData});
  if(!result.ok){
    const errId=role==='trainer'?'regError3':'regError2';
    const errEl=document.getElementById(errId);
    errEl.textContent=result.error;errEl.style.display='block';
    return;
  }
  const savedUser=user;
  _regDoneSavedUser=savedUser;
  document.getElementById('regStep1').style.display='none';
  document.getElementById('regStep2').style.display='none';
  document.getElementById('regStep3').style.display='none';
  const regDone=document.getElementById('regDone');
  const regDoneMsg=document.getElementById('regDoneMsg');
  if(regDoneMsg){
    regDoneMsg.textContent=(role==='trainer'?'Trainer account submitted!':'Staff account submitted!')+' Please wait for admin approval.';
    regDoneMsg.style.display='block';
  }
  if(regDone)regDone.style.display='block';
}
function regDoneBack(){
  const savedUser=_regDoneSavedUser;
  const rd=document.getElementById('regDone');if(rd)rd.style.display='none';
  resetRegisterForm();
  showLogin();
  if(savedUser){
    const lu=document.getElementById('loginUser');
    if(lu)lu.value=savedUser;
  }
  _regDoneSavedUser='';
}
function togglePw(id,btn){
  const el=document.getElementById(id);
  if(!el||!btn) return;
  const newType=el.type==='password'?'text':'password';
  el.type=newType;
  // masked (password) -> closed/crossed eyeOff, visible (text) -> open eye
  btn.innerHTML=newType==='password'?iconSvg('eyeOff',16):iconSvg('eye',16);
  const map={'regPass':'regPass2','msPass':'msPass2','fp_new_pass':'fp_new_pass2','uf_pass':'uf_pass2'};
  const confirmId=map[id];
  if(confirmId){
    const el2=document.getElementById(confirmId);
    if(el2){
      el2.type=newType;
      const wrap=el2.closest('.input-wrap');
      const btn2=wrap&&wrap.querySelector('.pw-toggle');
      if(btn2)btn2.innerHTML=newType==='password'?iconSvg('eyeOff',16):iconSvg('eye',16);
    }
  }
}
function _resetPwVis(){
  const ids=['loginPass','regPass','regPass2','msPass','msPass2','fp_new_pass','fp_new_pass2','uf_pass','uf_pass2'];
  ids.forEach(function(pid){
    const el=document.getElementById(pid);
    if(el) el.type='password';
    const wrap=el&&el.closest('.input-wrap');
    const btn=wrap&&wrap.querySelector('.pw-toggle');
    if(btn) btn.innerHTML=iconSvg('eyeOff',16);
  });
}
// Floating label: toggle .has-value on .input-wrap
(function(){
  document.querySelectorAll('.fl-group input').forEach(function(inp){
    var wrap=inp.closest('.input-wrap');
    if(!wrap)return;
    function sync(){wrap.classList.toggle('has-value',inp.value.length>0)}
    inp.addEventListener('input',sync);
    inp.addEventListener('blur',sync);
    sync();
  });
})();
function updateStrength(val){
  const bars=[document.getElementById('ps1'),document.getElementById('ps2'),document.getElementById('ps3')];
  const lbl=document.getElementById('psLabel');
  bars.forEach(b=>{b.className='pw-strength-bar'});
  if(!val){lbl.textContent='';return;}
  let score=0;
  if(val.length>=6)score++;if(val.length>=10)score++;
  if(/[A-Z]/.test(val)&&/[0-9]/.test(val))score++;
  const levels=['weak','fair','strong'];
  const labels=['Weak','Fair','Strong'];
  for(let i=0;i<score;i++)bars[i].classList.add(levels[Math.min(score-1,2)]);
  lbl.textContent=labels[Math.min(score-1,2)]||'';
}

// ============================= APP LOAD =============================
let _pendingPoll=null;
function showPendingGate(mem){
  const archived=mem.status==='Archived';
  const plan=mem.planId?Plans.one(mem.planId):null;
  document.getElementById('loginPage').style.display='none';
  const nav=document.getElementById('landingNav');if(nav)nav.style.display='none';
  document.getElementById('app').classList.remove('active');
  const g=document.getElementById('pendingGate');
  if(g){
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    const ico=document.getElementById('pgIco');if(ico)ico.textContent=archived?'🗄':'⏳';
    const t=document.getElementById('pgTitle');if(t)t.textContent=archived?'Account Archived':'Payment Pending';
    const msg=document.getElementById('pgMsg');
    if(msg)msg.innerHTML=archived
      ?'Your sign-up was archived. Please visit the front desk to sign up again.'
      :'Your account is pending. Please visit the front desk to complete your payment (<strong>Cash</strong> or <strong>GCash</strong>) and activate your account.';
    const note=document.getElementById('pgNote');
    if(note)note.textContent=archived?'Visit the front desk to register again.':'Your QR code unlocks automatically once payment is confirmed.';
    set('pgName',mem.name);
    set('pgId',mem.id);
    set('pgPlanName',plan?plan.name:'—');
    set('pgPlanPrice',plan?'₱'+Number(plan.price).toLocaleString()+(plan.duration===1?'/mo':'/'+plan.duration+'mo'):'—');
    g.style.display='flex';
  }
  if(_pendingPoll)clearInterval(_pendingPoll);
  _pendingPoll=null;
  // Auto-refresh: poll for payment confirmation (cross-device fix)
  // Member stays on gate but we check every 4s if their Firestore doc became Active
  // via direct fetch (reliable) and via local cache (synced by listener). On success
  // we auto-redirect to dashboard so they don't need to log out/in manually.
  if(!archived){
    let _pollTries=0;
    _pendingPoll=setInterval(async()=>{
      _pollTries++;
      try{
        let live=null;
        // Try direct cloud fetch first (most reliable right after admin confirms)
        if(window.GMSFB&&GMSFB.enabled&&GMSFB.auth&&GMSFB.auth.currentUser&&typeof GMSFB.fetchDoc==='function'){
          live=await GMSFB.fetchDoc('members', mem.id);
          // fetchDoc returns raw data without id wrapper in some paths — ensure id
          if(live&&!live.id) live.id=mem.id;
        }
        if(!live) live=Members.one(mem.id);
        if(live&&live.status==='Active'){
          clearInterval(_pendingPoll); _pendingPoll=null;
          toast('Payment confirmed — welcome to FitCore!');
          // update session status
          try{
            const sess=JSON.parse(sessionStorage.getItem('gms_session')||'null');
            if(sess){ sess.status='Active'; sessionStorage.setItem('gms_session',JSON.stringify(sess)); currentUser={...currentUser,...sess, status:'Active'}; }
          }catch(e){}
          // brief success state then load app
          const g2=document.getElementById('pendingGate');
          if(g2){
            const t2=document.getElementById('pgTitle'); if(t2) t2.textContent='Payment Confirmed!';
            const ico2=document.getElementById('pgIco'); if(ico2) ico2.textContent='✅';
            const msg2=document.getElementById('pgMsg'); if(msg2) msg2.innerHTML='Your membership is now <strong style="color:var(--green)">Active</strong>. Redirecting to dashboard…';
            const note2=document.getElementById('pgNote'); if(note2) note2.textContent='Your QR code is now active on any device.';
          }
          setTimeout(()=>{ loadApp(); },1200);
          return;
        }
        if(live&&live.status==='Archived'){
          clearInterval(_pendingPoll); _pendingPoll=null;
          showPendingGate(live);
          return;
        }
        // update last-checked hint every 12s
        if(_pollTries%3===0){
          const note=document.getElementById('pgNote');
          if(note) note.textContent='Waiting for front-desk confirmation… last checked '+new Date().toLocaleTimeString()+' (auto-refreshes every 4s)';
        }
        // stop after 15 min to save battery
        if(_pollTries>225){ clearInterval(_pendingPoll); _pendingPoll=null; const note=document.getElementById('pgNote'); if(note) note.textContent='Still pending. Please check with the front desk or tap Refresh.'; }
      }catch(e){}
    },4000);
  }
}
function checkPendingStatus(){
  const sess=getSession();
  const mid=(sess&&sess.memberId)||(currentUser&&currentUser.memberId)||(currentUser&&currentUser.id);
  if(!mid){ toast('No member session found. Please log in again.','error'); return; }
  toast('Checking payment status…','info');
  // force a quick check: fetch + local
  (async()=>{
    let live=null;
    try{
      if(window.GMSFB&&GMSFB.enabled&&GMSFB.auth&&GMSFB.auth.currentUser&&typeof GMSFB.fetchDoc==='function'){
        live=await GMSFB.fetchDoc('members', mid);
        if(live&&!live.id) live.id=mid;
      }
    }catch(e){}
    if(!live) live=Members.one(mid);
    if(live&&live.status==='Active'){
      if(_pendingPoll){ clearInterval(_pendingPoll); _pendingPoll=null; }
      toast('Payment confirmed — welcome!');
      try{ const s=JSON.parse(sessionStorage.getItem('gms_session')||'null'); if(s){ s.status='Active'; sessionStorage.setItem('gms_session',JSON.stringify(s)); } }catch(e){}
      if(currentUser) currentUser.status='Active';
      loadApp();
    } else if(live&&live.status==='Archived'){
      if(_pendingPoll){ clearInterval(_pendingPoll); _pendingPoll=null; }
      showPendingGate(live);
      toast('Account archived — please visit front desk.','error');
    } else {
      toast('Still pending — please wait for front-desk confirmation.','info');
      const note=document.getElementById('pgNote');
      if(note) note.textContent='Still pending. Last checked '+new Date().toLocaleTimeString()+' — auto-checks every 4s.';
    }
  })();
}
// ── FORCE PASSWORD CHANGE GATE ──────────────────────────────
// Shown when mustChangePassword flag is set on a member doc (after admin
// password reset). Blocks dashboard access until member sets a new password.
function showForcePasswordChange(mem){
  document.getElementById('loginPage').style.display='none';
  const nav=document.getElementById('landingNav');if(nav)nav.style.display='none';
  document.getElementById('app').classList.remove('active');
  const pg=document.getElementById('pendingGate');
  if(pg) pg.style.display='none';
  // Set up verification state so confirmForgotPassword() can find the target
  _fpVerified={username:mem.username,targetId:mem.id,targetType:'member',expiresAt:Date.now()+10*60*1000};
  try{ sessionStorage.setItem('gms_fp_verified',JSON.stringify(_fpVerified)); }catch(e){}
  _fpForcedMode=true;
  _fpStep=3;
  const fc=document.getElementById('fp_confirm_btn'); if(fc) setFpBtnLoading(fc,false);
  const fm=document.getElementById('fp_new_pass');if(fm)fm.value='';
  const fm2=document.getElementById('fp_new_pass2');if(fm2)fm2.value='';
  const fe=document.getElementById('fpsError');if(fe)fe.style.display='none';
  const fs=document.getElementById('fpsSuccess');if(fs)fs.style.display='none';
  const fl=document.getElementById('fpsLabel');if(fl)fl.textContent='';
  ['fps1','fps2','fps3'].forEach(id=>{const b=document.getElementById(id);if(b)b.className='pw-strength-bar';});
  // Forced mode is a single step — hide 1-2-3 dots so it doesn't look unfinished
  const prog=document.getElementById('fpProgress');if(prog)prog.style.display='none';
  const t=document.getElementById('fpModalTitle');if(t)t.textContent='Set New Password';
  const closeBtn=document.querySelector('#forgotModal .modal-close');if(closeBtn)closeBtn.style.display='none';
  // Banner: only show the admin-reset notice when the flag is actually still set
  const banner=document.getElementById('fpsBanner');
  const stillForced=!!(mem&&mem.mustChangePassword);
  if(banner){
    if(stillForced){
      banner.style.display='block';
      banner.innerHTML='⚠️ <strong>Password Reset Required</strong> — An administrator has reset your password. Please set a new password to continue.';
    } else {
      banner.style.display='none';
    }
  }
  // Forced mode: Cancel becomes "Back to Login" so a member is never trapped
  // on this screen. Logging out does not bypass the gate — it returns on the
  // next login — but it lets them leave without finishing the change now.
  const cancel=document.getElementById('fp_cancel_btn');
  if(cancel){
    cancel.style.display='';
    cancel.textContent='Back to Login';
    cancel.onclick=function(e){ if(e)e.preventDefault(); clearFpVerified(); _fpForcedMode=false; closeModal('forgotModal'); doLogout(); };
  }
  initFpOtp();
  showFpStep(3);
  openModal('forgotModal');
}
// SECURITY: a sessionStorage user object is client-controlled. Verify that the
// signed-in Firebase Auth identity matches the profile before trusting the
// session's role/id. Legacy/offline sessions without an Auth user are left to
// the existing local fallback.
function authSessionEmailOk(sessionUser, liveDoc){
  const fb=(window.GMSFB&&GMSFB.enabled)?GMSFB:null;
  const au=fb&&fb.auth?fb.auth.currentUser:null;
  if(!au||!au.email)return true;
  const got=String(au.email).toLowerCase();
  const expected=[];
  if(liveDoc&&typeof fb.authEmailFor==='function')expected.push(fb.authEmailFor(liveDoc));
  if(sessionUser&&sessionUser.authEmail)expected.push(sessionUser.authEmail);
  if(sessionUser&&sessionUser.role==='admin'&&fb.adminAuthEmail)expected.push(fb.adminAuthEmail);
  const list=expected.filter(Boolean).map(x=>String(x).toLowerCase());
  if(!list.length)return true;
  return list.some(x=>x===got);
}
function loadApp(){
  if(!currentUser)return;
  // Reject a tampered/swapped session before any panel or Firestore write.
  if(window.GMSFB&&GMSFB.enabled&&GMSFB.auth&&GMSFB.auth.currentUser){
    const liveCheck=currentUser.role==='member'
      ? Members.one(currentUser.memberId||currentUser.id)
      : Users.one(currentUser.id);
    if(!authSessionEmailOk(currentUser,liveCheck)){
      doLogout();
      showLoginError('Session expired — please log in again.');
      return;
    }
  }
  if(currentUser&&currentUser.role==='member'){
    let live=Members.one(currentUser.memberId||currentUser.id);
    if(live) live=_withLocalPwOverride(live);
    if(live)currentUser={...currentUser,name:live.name,email:live.email,contact:live.contact,status:live.status};
    if(live&&(live.status==='pending_payment'||live.status==='Archived')){
      showPendingGate(live);
      return;
    }
    // Force-logout expired members on session restore / loadApp so open
    // sessions cannot keep using the app after the plan ends.
    if(live&&isMemberExpired(live)){
      doLogout();
      showLoginError(EXPIRED_LOGIN_MSG);
      return;
    }
    // ── MUST-CHANGE-PASSWORD gate ──
    // After an admin/staff password reset, force the member to set a new
    // password before they can access the dashboard.
    // Only boolean true gates — missing/undefined/false all pass (avoids
    // resurrecting the gate after a successful reset that didn't stringify).
    if(live&&live.mustChangePassword===true){
      showForcePasswordChange(live);
      return;
    }
    // Stale truthy values from old docs ("true", 1) — clear and continue.
    if(live&&live.mustChangePassword&&live.mustChangePassword!==true){
      try{ Members.update(live.id||live.memberId||'',{mustChangePassword:false}); }catch(e){}
    }
  }
  if(currentUser&&currentUser.role!=='member'){
    // Re-validate staff/trainer/admin sessions against the Users table so demoted,
    // locked or deleted accounts lose access immediately on the next load.
    const live=Users.one(currentUser.id);
    if(!live||live.status==='locked'||live.status==='pending'){
      doLogout();
      return;
    }
    currentUser={...currentUser,...live};
  }
  // One-time containment: remove legacy password hashes that were synced to
  // Firestore before _clean stripped them. Runs once per browser session.
  if(currentUser.role==='admin'&&window.GMSFB&&GMSFB.enabled&&typeof GMSFB.scrubSensitiveFields==='function'){
    if(!sessionStorage.getItem('gms_sec_scrub')){
      sessionStorage.setItem('gms_sec_scrub','1');
      GMSFB.scrubSensitiveFields().then(r=>console.info('[security] credential scrub',r)).catch(()=>{});
    }
  }
  document.getElementById('loginPage').style.display='none';
  document.getElementById('landingNav').style.display='none';
  document.getElementById('app').classList.add('active');
  const pg=document.getElementById('pendingGate');if(pg)pg.style.display='none';
  buildSidebar();
  renderTopbar();
  scanRenewals();
  seedExerciseLibrary();
  try{if(currentUser&&currentUser.role!=='member')pruneMemberActivity();}catch(e){}
  try{if(window.GMSFB&&typeof GMSFB.flushPending==='function')GMSFB.flushPending();}catch(e){}
  updatePendingBadge();
  updateSchedPendingBadge();
  updateQueueBadge();
  updateMessageBadge();
  updateSyncWarning();
  navigate('dashboard');
}
function buildSidebar(){
  const u=currentUser;
  const av=document.getElementById('sideUserAvatar');
  av.className='user-avatar avatar-'+u.role;
  setUserAvatar(av,u.name,userAvatarOf());
  // make avatar clickable for zoom (stop propagation so sidebar edit not triggered)
  const avSrc=userAvatarOf();
  if(avSrc){
    av.style.cursor='zoom-in';
    av.title='Click to view photo';
    av.onclick=function(e){ e.stopPropagation(); openAvatarZoom(avSrc, u.name); };
  } else {
    av.style.cursor='default';
    av.title='';
    av.onclick=function(e){ e.stopPropagation(); openStaffEditModal(); };
  }
  document.getElementById('sideUserName').textContent=u.name;
  const rb=document.getElementById('sideUserRole');
  rb.className='role-badge rb-'+u.role;rb.textContent=u.role;
  const nav=document.getElementById('sideNav');
  const items=[
    {id:'dashboard',group:'Overview',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,label:'Dashboard',roles:['admin','staff','trainer','member']},
    {id:'myqr',group:'Membership',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><path d="M21 21h-3v-3h3z"/></svg>`,label:'My QR Code',roles:['member']},
    {id:'myattendance',group:'Membership',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,label:'My Attendance',roles:['member']},
    {id:'myMessages',group:'Support',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,label:'Messages',roles:['member'],badge:'myMsgBadge'},
    {id:'myWorkoutPlan',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1"/><path d="M3 3l1 1"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/></svg>`,label:'My Workout Plan',roles:['member']},
    {id:'myWorkouts',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,label:'My Workouts',roles:['member']},
    {id:'myProgress',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,label:'Progress',roles:['member']},
    {id:'myGoals',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,label:'My Goals',roles:['member']},
    {id:'exerciseLibrary',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,label:'Exercise Library',roles:['member','trainer']},
    {id:'mySessions',group:'Workout',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,label:'My Sessions',roles:['member']},
    {id:'workoutBuilder',group:'Coaching',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,label:'Workout Builder',roles:['trainer']},
    {id:'memberLogs',group:'Coaching',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="22" y1="3" x2="22" y2="3"/></svg>`,label:'Member Logs',roles:['trainer']},
    {id:'members',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,label:'Members',roles:['admin','staff']},
    {id:'history',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 14"/></svg>`,label:'Member History',roles:['admin','staff']},
    {id:'queue',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,label:'Payment Queue',roles:['admin','staff'],badge:'queueBadge'},
    {id:'billing',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,label:'Billing & Payments',roles:['admin','staff']},
    {id:'walkin',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M14 8H10l-2 6h2l1 5h2l1-5h2l-2-6z"/><path d="M9 14l-2 4"/><path d="M15 14l2 4"/></svg>`,label:'Walk-In',roles:['admin','staff']},
    {id:'schedule',group:'Operations',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,label:'Trainer Schedule',roles:['admin','staff','trainer'],badge:'schedPendingBadge'},
    {id:'myassigned',group:'Operations',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,label:'My Assigned Members',roles:['trainer']},
    {id:'scanner',group:'Operations',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/></svg>`,label:'QR Scanner',roles:['admin','staff']},
    {id:'notifications',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,label:'Member Renewals',roles:['admin','staff'],badge:'notifBadge'},
    {id:'messages',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,label:'Member Messages',roles:['admin','staff'],badge:'msgBadge'},
    {id:'announcements',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a5 5 0 0 1 0 8"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/></svg>`,label:'Announcements',roles:['admin']},
    {id:'plans',group:'Management',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,label:'Membership Plans',roles:['admin','staff']},
    {id:'reports',group:'Operations',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,label:'Reports',roles:['admin']},
    {id:'activityLog',group:'Operations',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,label:'Activity Log',roles:['admin','staff','trainer']},
    {id:'users',group:'Administration',icon:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,label:'User Management',roles:['admin'],badge:'pendingBadge'}
  ];
  const visible=items.filter(i=>i.roles.includes(u.role));
  const groups=[];
  visible.forEach(i=>{
    let g=groups.find(x=>x.name===i.group);
    if(!g){g={name:i.group,items:[]};groups.push(g);}
    g.items.push(i);
  });
  nav.innerHTML=groups.map((g,gi)=>`
    <div class="nav-group${gi===0?' first':''}">${g.name}</div>
    ${g.items.map(i=>`
      <div class="nav-item" id="nav-${i.id}" onclick="navigate('${i.id}')">
        <span class="nav-icon">${i.icon}</span> ${i.label}
        ${i.badge?`<span class="nav-badge" id="${i.badge}" style="display:none">0</span>`:''}
      </div>`).join('')}
  `).join('');
}
function renderTopbar(){
  const av=document.getElementById('topAvatar');
  av.className='user-avatar avatar-'+currentUser.role;
  setUserAvatar(av,currentUser.name,userAvatarOf());
  const avSrc2=userAvatarOf();
  if(avSrc2){
    av.style.cursor='zoom-in';
    av.title='Click to view photo';
    av.onclick=function(e){ e.stopPropagation(); openAvatarZoom(avSrc2, currentUser.name); };
  } else {
    av.style.cursor='pointer';
    av.title='Edit Profile';
    av.onclick=function(){ openStaffEditModal(); };
  }
  startClock();
}
let _clockInterval=null;
function startClock(){
  if(_clockInterval)clearInterval(_clockInterval);
  function tick(){
    const now=new Date();
    const timeStr=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    const dateStr=now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    const el=document.getElementById('topDate');
    if(el)el.innerHTML=`<span class="live-dot"></span><span style="color:var(--white);font-weight:700;letter-spacing:1px;font-size:13px">${timeStr}</span> <span style="color:var(--gray-500);font-size:11px">${dateStr}</span>`;
  }
  tick();
  _clockInterval=setInterval(tick,1000);
}
let _lastPanel=null;
const PANEL_ROLES={myqr:['member'],myattendance:['member'],myMessages:['member'],myWorkoutPlan:['member'],myWorkouts:['member'],myProgress:['member'],myGoals:['member'],exerciseLibrary:['member','trainer'],mySessions:['member'],members:['admin','staff'],history:['admin','staff'],queue:['admin','staff'],billing:['admin','staff'],walkin:['admin','staff'],schedule:['admin','staff','trainer'],scanner:['admin','staff'],notifications:['admin','staff'],messages:['admin','staff'],announcements:['admin'],plans:['admin','staff'],reports:['admin'],activityLog:['admin','staff','trainer'],users:['admin'],myassigned:['trainer'],workoutBuilder:['trainer'],memberLogs:['trainer']};
function navigate(panel){
  // ── ACTIVATION GATE: block pending/archived members on every navigation ──
  // This is the route guard that prevents bypassing the pendingGate via
  // direct sidebar clicks, back-button, or page refresh.
  if(currentUser&&currentUser.role==='member'){
    const _liveMember=Members.one(currentUser.memberId||currentUser.id);
    if(_liveMember){
      currentUser={...currentUser,name:_liveMember.name,email:_liveMember.email,contact:_liveMember.contact,status:_liveMember.status};
      if(_liveMember.status==='pending_payment'||_liveMember.status==='Archived'){
        showPendingGate(_liveMember);return;
      }
    }
  }
  if(currentUser&&PANEL_ROLES[panel]&&!PANEL_ROLES[panel].includes(currentUser.role)){toast('You do not have access to this section.','error');return;}
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const ni=document.getElementById('nav-'+panel);
  if(ni)ni.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const titles={dashboard:'Dashboard',members:'Member Management',history:'Member History',billing:'Billing & Payments',walkin:'Walk-In Management',schedule:'Trainer Schedule',notifications:'Member Renewals',messages:'Member Messages',plans:'Membership Plans',reports:'Reports',activityLog:'Activity Log',users:'User Management',queue:'Payment Queue',scanner:'QR Scanner',myqr:'My QR Code',myattendance:'My Attendance',myassigned:'My Assigned Members',myMessages:'Message the Gym',myWorkoutPlan:'My Workout Plan',myWorkouts:'My Workouts',myProgress:'Progress Tracker',myGoals:'My Goals',exerciseLibrary:'Exercise Library',workoutBuilder:'Workout Builder',memberLogs:'Member Logs',mySessions:'My Sessions'};
  document.getElementById('pageTitle').textContent=titles[panel]||'';
  const panelEl=document.getElementById('panel'+capitalize(panel));
  if(panelEl)panelEl.classList.add('active');
  if(panel==='schedule'&&_lastPanel!=='schedule'&&currentUser&&currentUser.role==='trainer'){
    schedTrainerFilter=currentUser.id;
  }
  _lastPanel=panel;
  renderPanel(panel);
  if(panel!=='scanner')stopScanner();
}
function capitalize(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function initials(name){return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function memberAvatarOf(){
  if(!currentUser||currentUser.role!=='member')return'';
  const m=Members.one(currentUser.memberId||currentUser.id);
  return(m&&m.avatar)?m.avatar:'';
}
function userAvatarOf(){
  const u=currentUser;
  if(!u)return '';
  if(u.role==='member')return memberAvatarOf();
  return u.avatar||'';
}
function setUserAvatar(el,name,avatar){
  if(!el)return;
  if(avatar){el.style.backgroundImage='url("'+avatar+'")';el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.style.backgroundRepeat='no-repeat';el.textContent='';}
  else{el.style.backgroundImage='';el.textContent=initials(name);}
}
function openAvatarZoom(src,name){
  if(!src||src.length<20){toast('No photo available to zoom.','info');return;}
  const img=document.getElementById('zoomAvatarImg');
  const nm=document.getElementById('zoomAvatarName');
  const dl=document.getElementById('zoomAvatarDownload');
  if(img) img.src=src;
  if(nm) nm.textContent=name||'Profile Photo';
  if(dl){ dl.href=src; dl.download=(name||'fitcore-avatar').replace(/\s+/g,'_')+'.jpg'; }
  openModal('avatarZoomModal');
  // ESC closes
  const escHandler=function(e){ if(e.key==='Escape'){ closeModal('avatarZoomModal'); document.removeEventListener('keydown',escHandler); } };
  document.addEventListener('keydown',escHandler);
}

// ============================= TOAST =============================
function toast(msg,type='success'){
  const wrap=document.getElementById('toastWrap');
  const icons={success:'check',error:'x',info:'info'};
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.innerHTML=`<span class="toast-icon">${iconSvg(icons[type],14)}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(()=>{t.classList.add('removing');setTimeout(()=>t.remove(),300);},3000);
}

// ============================= SVG ICON ENGINE =============================
// Replaces emoji pictographs throughout the UI with crisp, modern line icons.
// Runs after every render so both static markup and JS-generated HTML get
// the same treatment. Icons scale with the surrounding font size.
const ICONS={
  search:`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  calendar:`<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  clipboard:`<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`,
  card:`<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  check:`<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  x:`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  info:`<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
  logout:`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  logIn:`<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>`,
  pencil:`<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`,
  eye:`<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff:`<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`,
  receipt:`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>`,
  chart:`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  trend:`<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`,
  pen:`<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`,
  printer:`<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
  download:`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  money:`<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  users:`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  user:`<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  dumbbell:`<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>`,
  monitor:`<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
  userPlus:`<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>`,
  phone:`<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  trash:`<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
  refresh:`<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
  link:`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  zap:`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  mapPin:`<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  mail:`<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`,
  bell:`<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  warn:`<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
  save:`<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
  clock:`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  alarm:`<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="M22 6l-3-3"/><line x1="6" y1="19" x2="4" y2="21"/><line x1="18" y1="19" x2="20" y2="21"/>`,
  hourglass:`<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>`,
  running:`<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  lock:`<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  unlock:`<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
  flag:`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`,
  menu:`<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  file:`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
  archive:`<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>`,
  cloud:`<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>`,
  ban:`<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>`,
  message:`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  key:`<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>`,
  bulb:`<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/>`,
  gear:`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  wave:`<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>`,
  ticket:`<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>`,
  star:`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  camera:`<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`,
  play:`<polygon points="5 3 19 12 5 21 5 3"/>`
};
// Keys use the base codepoint only (no variation selector) so both "⚠" and
// "⚠️" forms match; trailing U+FE0F is skipped by iconize().
const ICON_EMOJI={
  '🔍':'search','📅':'calendar','📋':'clipboard','💳':'card','✅':'check','🚪':'logout',
  '✏':'pencil','✎':'pencil','👁':'eye','🧾':'receipt','📊':'chart','📈':'trend','📝':'pen',
  '🖨':'printer','📥':'download','💰':'money','👥':'users','👤':'user','🏋':'dumbbell','🖥':'monitor',
  '🚶':'userPlus','📞':'phone','🗑':'trash','🔄':'refresh','🔗':'link','⚡':'zap','🔔':'bell',
  '⚠':'warn','💾':'save','🕐':'clock','🕓':'clock','⏰':'alarm','⏳':'hourglass',
  '🏃':'running',  '🔒':'lock','🔓':'unlock','🏁':'flag','☰':'menu','💡':'bulb','⚙':'gear','📄':'file',
  '🕒':'clock',
  '📍':'mapPin','✉':'mail',
  '🗄':'archive','☁':'cloud','🚫':'ban','💬':'message','🔑':'key','🗓':'calendar','⭐':'star','⚑':'flag',
  '✓':'check','✔':'check','✕':'x','🙈':'eyeOff','👋':'wave','🎟':'ticket','★':'star','✦':'star'
};
function iconSvg(name,size=16){
  const body=ICONS[name]||'';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.16em;flex-shrink:0;display:inline-block" aria-hidden="true">${body}</svg>`;
}
function _iconSvgNode(name,size){
  const div=document.createElement('div');
  div.innerHTML=iconSvg(name,size);
  return div.firstChild;
}
function iconize(root){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const text=node.nodeValue;if(!text)return;
    let hit=false;
    for(const ch of text){if(ICON_EMOJI[ch]){hit=true;break;}}
    if(!hit)return;
    const parent=node.parentNode;if(!parent)return;
    const fs=parseFloat(getComputedStyle(parent).fontSize)||16;
    const size=Math.max(12,Math.min(40,Math.round(fs)));
    const frag=document.createDocumentFragment();let buf='';let wasIcon=false;
    for(const ch of text){
      const name=ICON_EMOJI[ch];
      if(name){
        if(buf){frag.appendChild(document.createTextNode(buf));buf='';}
        frag.appendChild(_iconSvgNode(name,size));
        wasIcon=true;
      } else {
        if(ch!=='\uFE0F'||!wasIcon)buf+=ch;
        wasIcon=false;
      }
    }
    if(buf)frag.appendChild(document.createTextNode(buf));
    parent.replaceChild(frag,node);
  });
}

// ============================= MODALS =============================
function openModal(id){document.getElementById(id).classList.add('open');iconize(document.getElementById(id));}
function closeModal(id){
  // Force-change gate must be completed (or just completed) before dismiss —
  // otherwise the member is left on a blank shell with the flag still set.
  if(id==='forgotModal'&&_fpForcedMode===true){
    toast('Please set a new password to continue.','error');
    return;
  }
  const el=document.getElementById(id);if(el) el.classList.remove('open');_resetPwVis();
}
let currentProfileId=null;
function openConfirm(title,msg,onOk,btnLabel='Delete',btnClass='btn-danger'){
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmMsg').innerHTML=msg;
  const btn=document.getElementById('confirmOkBtn');
  btn.textContent=btnLabel;
  btn.className='btn-sm '+btnClass;
  btn.onclick=()=>{onOk();closeModal('confirmModal');};
  openModal('confirmModal');
}

// ============================= RENEWALS SCAN =============================
function scanRenewals(){
  // Update statuses in place, but only save when something actually changed.
  // The old unconditional save ran on every Firestore snapshot and could push
  // a stale members array back over a just-confirmed activation.
  const all=Members.all();
  let changed=false;
  all.forEach(m=>{
    if(m.status==='Archived')return;
    const next=Member.wrap(m).computeStatus();
    if(m.status!==next){m.status=next;changed=true;}
  });
  // Auto-archive unpaid sign-ups older than PENDING_ARCHIVE_DAYS
  const now=Date.now();
  all.forEach(m=>{
    if(m.status!=='pending_payment')return;
    const created=new Date(m.createdAt||now).getTime();
    if(now-created>PENDING_ARCHIVE_DAYS*86400000){
      m.status='Archived';changed=true;
      resolveNotifsForMember(m.id);
    }
  });
  if(changed)Members.save(all);
  const badge=document.getElementById('notifBadge');
  if(badge){const c=Members.all().filter(m=>m.status!=='Archived'&&(m.status==='Expiring Soon'||m.status==='Expired')&&!_dismissedIds.has(m.id)).length;badge.textContent=c;badge.style.display=c>0?'flex':'none';}
  updateQueueBadge();
}

// ============================= PENDING APPROVALS BADGE =============================
function updatePendingBadge(){
  if(!currentUser||currentUser.role!=='admin')return;
  const pending=Users.all().filter(u=>u.status==='pending').length;
  const badge=document.getElementById('pendingBadge');
  if(badge){badge.textContent=pending;badge.style.display=pending>0?'flex':'none';}
}
function updateSchedPendingBadge(){
  if(!currentUser||currentUser.role!=='trainer') return;
  const badge=document.getElementById('schedPendingBadge');
  if(!badge) return;
  const n=Sessions.all().filter(s=> s.trainerId===currentUser.id && s.status==='Pending').length;
  badge.textContent=n;
  badge.style.display=n>0?'flex':'none';
}

// ============================= CLOUD SYNC WARNING =============================
// Surfaces Firebase connectivity problems that would otherwise silently split
// devices onto separate localStorage databases (e.g. an admin who never sees a
// staff registration made on another device).
function ensureSyncWarnEl(){
  let el=document.getElementById('syncWarn');
  if(!el){el=document.createElement('div');el.id='syncWarn';el.className='sync-warn';document.body.appendChild(el);}
  return el;
}
function updateSyncWarning(){
  const el=ensureSyncWarnEl();
  if(!window.GMSFB||!GMSFB.enabled){
    el.className='sync-warn';
    el.innerHTML='⚠️ <strong>Offline mode.</strong> Data is saved on this device only — it will NOT appear on your other devices. Connect to the internet and refresh the page.';
    el.style.display='flex';
    return;
  }
  if(typeof GMSFB.degraded==='function'&&GMSFB.degraded()){
    el.className='sync-warn warn';
    el.innerHTML='⚠️ <strong>Cloud sync problem.</strong> This device may be showing outdated data — registrations and approvals from other devices may not appear here. Check your internet connection and refresh.';
    el.style.display='flex';
    return;
  }
  el.style.display='none';
}

// ============================= PANEL ROUTER =============================
function renderPanel(p){
  const map={dashboard:renderDashboard,members:renderMembers,history:renderHistory,billing:renderBilling,walkin:renderWalkin,schedule:renderSchedule,notifications:renderNotifications,renewed:renderRenewed,messages:renderMessages,announcements:renderAnnouncements,plans:renderPlans,reports:renderReports,activityLog:renderActivityLog,users:renderUsers,queue:renderQueue,scanner:renderScanner,myqr:renderMyQr,myattendance:renderMyAttendance,myassigned:renderMyAssigned,myMessages:renderMyMessages,myWorkoutPlan:renderMyWorkoutPlan,myWorkouts:renderMyWorkouts,myProgress:renderMyProgress,myGoals:renderMyGoals,exerciseLibrary:renderExerciseLibrary,workoutBuilder:renderWorkoutBuilder,memberLogs:renderMemberLogs,mySessions:renderMySessions};
  if(map[p])map[p]();
  iconize(document.getElementById('panel'+p.charAt(0).toUpperCase()+p.slice(1)));
}

// ======================================================================
// PANEL: DASHBOARD
// ======================================================================
function greet(){
  const h=new Date().getHours();
  if(h<12)return'Good Morning';if(h<18)return'Good Afternoon';return'Good Evening';
}
function dashHero(actions){
  const first=(currentUser.name||'Trainer').split(' ')[0];
  return`<div class="dash-hero">
    <div class="dh-left">
      <div class="dh-greet">${greet()}, <span>${first}</span> ${iconSvg('wave',18)}</div>
      <div class="dh-sub">${formatFullDate(today())} — here's what's happening at FitCore today.</div>
    </div>
    ${actions?`<div class="dh-actions">${actions}</div>`:''}
  </div>`;
}
function renderDashboard(){
  const el=document.getElementById('panelDashboard');
  const role=currentUser.role;
  if(role==='member'){el.innerHTML=buildMemberDashboard();refreshMyQr();}
  else if(role==='admin')el.innerHTML=buildAdminDashboard();
  else if(role==='staff')el.innerHTML=buildStaffDashboard();
  else el.innerHTML=buildTrainerDashboard();
}
function updateQueueBadge(){
  if(!currentUser||(currentUser.role!=='admin'&&currentUser.role!=='staff'))return;
  const pending=Members.all().filter(m=>m.status==='pending_payment').length;
  const badge=document.getElementById('queueBadge');
  if(badge){badge.textContent=pending;badge.style.display=pending>0?'flex':'none';}
}
function buildAdminDashboard(){
  const members=Members.all().filter(m=>m.status!=='Archived');
  const active=members.filter(m=>m.status==='Active'||m.status==='Expiring Soon');
  const expiring=members.filter(m=>{const d=daysUntil(m.expiryDate);return d>=0&&d<=7;});
  const payments=Payments.all();
  const thisMonth=new Date();
  const monthRev=payments.filter(p=>{const d=new Date(p.date);return d.getMonth()===thisMonth.getMonth()&&d.getFullYear()===thisMonth.getFullYear();}).reduce((a,p)=>a+Number(p.amount),0);
  const walkinThisMonth=Walkins.all().filter(w=>{const d=new Date(w.date);return d.getMonth()===thisMonth.getMonth()&&d.getFullYear()===thisMonth.getFullYear();});
  const walkinRevMonth=walkinThisMonth.reduce((a,w)=>a+Number(w.fee),0);
  const totalMonthRev=monthRev+walkinRevMonth;
  const pendingUsers=Users.all().filter(u=>u.status==='pending');
  const recent=payments.slice().sort(newestPaymentFirst).slice(0,5);
  const revData=[];
  for(let i=5;i>=0;i--){
    const d=new Date();d.setMonth(d.getMonth()-i);
    const mn=d.toLocaleString('en-US',{month:'short'});
    const yr=d.getFullYear();const mo=d.getMonth();
    const rev=payments.filter(p=>{const pd=new Date(p.date);return pd.getMonth()===mo&&pd.getFullYear()===yr;}).reduce((a,p)=>a+Number(p.amount),0);
    revData.push({label:mn,value:rev});
  }
  const maxRev=Math.max(...revData.map(r=>r.value),100);
  const barW=40;const chartH=120;const gap=14;
  const bars=revData.map((r,i)=>{
    const bh=r.value>0?Math.max(4,(r.value/maxRev)*chartH):4;
    const x=i*(barW+gap)+10;const y=chartH-bh+20;
    return `<g>
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="url(#barGrad)"/>
      <text x="${x+barW/2}" y="${chartH+35}" text-anchor="middle" fill="#b3bcb5" font-size="10">${r.label}</text>
      ${r.value>0?`<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" fill="#b3bcb5" font-size="9">₱${r.value>=1000?(r.value/1000).toFixed(1)+'k':r.value}</text>`:''}
    </g>`;}).join('');
  // Donut chart
  const plans=Plans.all();
  const planCounts={};
  members.forEach(m=>{if(!m.planId)return;const pl=plans.find(p=>p.id===m.planId);if(pl)planCounts[pl.name]=(planCounts[pl.name]||0)+1;});
  const total=Object.values(planCounts).reduce((a,b)=>a+b,0)||1;
  const colors=['#b3bcb5','#fbbf24','#7ffa88','#b3bcb5'];
  let angle=0;const donutPaths=[];const legend=[];
  Object.entries(planCounts).forEach(([name,count],i)=>{
    const pct=count/total;const slice=pct*2*Math.PI;
    const x1=50+40*Math.sin(angle);const y1=50-40*Math.cos(angle);
    const x2=50+40*Math.sin(angle+slice);const y2=50-40*Math.cos(angle+slice);
    const big=slice>Math.PI?1:0;
    if(count>0)donutPaths.push(`<path d="M50,50 L${x1},${y1} A40,40 0 ${big},1 ${x2},${y2} Z" fill="${colors[i%colors.length]}" opacity=".85"/>`);
    legend.push(`<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#b3bcb5"><span style="width:10px;height:10px;border-radius:2px;background:${colors[i%colors.length]};flex-shrink:0"></span>${name}: ${count} (${Math.round(pct*100)}%)</div>`);
    angle+=slice;
  });
  return `
  ${dashHero(`<button class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;width:auto" onclick="navigate('scanner')">${iconSvg('camera',16)} Open QR Scanner</button>
    <button class="btn-secondary" onclick="navigate('billing')">💳 Record Payment</button>
    ${pendingUsers.length?`<button class="btn-secondary" style="background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.3);color:var(--gold)" onclick="navigate('users')">⏳ ${pendingUsers.length} Pending Approval</button>`:''}`)}
  <div class="checkin-btn-wrap" style="display:flex;align-items:center;gap:10px;margin:14px 0 16px;flex-wrap:wrap">
    <button class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;width:auto;background:var(--green);color:#0a0a0a;border-color:var(--green);font-weight:800;box-shadow:0 4px 14px rgba(127,250,136,.25)" onclick="openCheckin()">${iconSvg('logIn',16)} Manual Check-In (No QR)</button>
    <button class="btn-secondary" style="display:inline-flex;align-items:center;gap:8px;width:auto;background:rgba(179,188,181,.15);color:var(--orange);border:1px solid rgba(179,188,181,.3)" onclick="openCheckout()">🚪 Manual Check-Out</button>
    <span style="font-size:11px;color:var(--gray-500)">for members without QR — one entry per day</span>
  </div>
  <div class="stats-grid">
    <div class="stat-card orange"><div class="stat-top"><div class="stat-label">Total Members</div><span class="stat-ico">👥</span></div><div class="stat-value">${members.length}</div><div class="stat-hint">Registered members</div></div>
    <div class="stat-card green"><div class="stat-top"><div class="stat-label">Active Members</div><span class="stat-ico">✅</span></div><div class="stat-value">${active.length}</div><div class="stat-hint">Current active</div></div>
    <div class="stat-card gold"><div class="stat-top"><div class="stat-label">Expiring Soon</div><span class="stat-ico">⏳</span></div><div class="stat-value">${expiring.length}</div><div class="stat-hint">Within 7 days</div></div>
    <div class="stat-card blue"><div class="stat-top"><div class="stat-label">Monthly Revenue</div><span class="stat-ico">💰</span></div><div class="stat-value" style="font-size:24px">₱${totalMonthRev.toLocaleString()}</div><div class="stat-hint">Memberships + ${walkinThisMonth.length} walk-ins</div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">Revenue — Last 6 Months</div>
      <svg viewBox="0 0 320 160" style="height:160px">
        <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b3bcb5"/><stop offset="100%" stop-color="#fbbf24"/></linearGradient></defs>
        ${bars}
      </svg>
    </div>
    <div class="chart-card">
      <div class="chart-title">Plan Distribution</div>
      <div style="display:flex;align-items:center;gap:20px">
        <svg viewBox="0 0 100 100" style="width:100px;height:100px;flex-shrink:0">
          ${donutPaths.join('')}
          <circle cx="50" cy="50" r="22" fill="#1b2542"/>
          <text x="50" y="54" text-anchor="middle" fill="#b3bcb5" font-size="11" font-weight="700">${total}</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:6px">${legend.join('')}</div>
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="table-card">
      <div class="table-header"><h3>Recent Payments</h3></div>
      <table><thead><tr><th>Member</th><th>Plan</th><th>Amount</th><th>Date</th></tr></thead><tbody>
      ${recent.length?recent.map(p=>`<tr><td>${esc(p.memberName)}</td><td>${esc(p.planName)}</td><td style="color:var(--green)">₱${Number(p.amount).toLocaleString()}</td><td>${formatDate(p.date)}</td></tr>`).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">💳</div><p>No payments yet</p></div></td></tr>`}
      </tbody></table>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Expiring Memberships</h3></div>
      <table><thead><tr><th>Member</th><th>Plan</th><th>Expiry</th><th>Days Left</th></tr></thead><tbody>
      ${expiring.length?expiring.map(m=>{const d=daysUntil(m.expiryDate);const pl=Plans.all().find(p=>p.id===m.planId);return`<tr style="background:${d<=3?'rgba(239,68,68,.06)':'rgba(251,191,36,.05)'}"><td>${esc(m.name)}</td><td>${esc(pl?pl.name:'—')}</td><td>${formatDate(m.expiryDate)}</td><td><span class="days-badge ${d<=3?'days-urgent':'days-warn'}">${d}d</span></td></tr>`}).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">✅</div><p>No expiring memberships</p></div></td></tr>`}
      </tbody></table>
    </div>
  </div>
  ${(()=>{
    if(!pendingUsers.length)return'';
    const rows=pendingUsers.map(u=>`<tr style="background:rgba(251,191,36,.04)">
      <td><div style="display:flex;align-items:center;gap:8px"><div class="user-avatar avatar-${u.role}" style="width:26px;height:26px;font-size:10px;flex-shrink:0;${u.avatar?'padding:0;overflow:hidden':''}">${u.avatar?`<img src="${u.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(u.name))}</div><div><div style="font-weight:600;color:var(--white)">${esc(u.name)}</div><div style="font-size:11px;color:var(--gray-500);font-family:monospace">@${esc(u.username)}</div></div></div></td>
      <td><span class="badge badge-${u.role}">${u.role}</span></td>
      <td style="font-size:12px;color:var(--gray-500)">${formatDate(u.createdAt||today())}</td>
      <td><div class="td-actions">
        <button class="btn-primary btn-sm" onclick="approveUser('${u.id}');renderDashboard()" style="padding:5px 12px;font-size:11px">✔ Approve</button>
        <button class="btn-danger btn-sm" onclick="deleteUser('${u.id}')" style="padding:5px 12px;font-size:11px">✕ Reject</button>
      </div></td>
    </tr>`).join('');
    return`<div class="table-card" style="margin-top:0;border-top:2px solid var(--gold)">
      <div class="table-header" style="background:rgba(251,191,36,.04)">
        <h3 style="color:var(--gold)">⏳ Pending Account Approvals <span style="font-size:13px;font-weight:400;color:var(--gray-500);margin-left:6px">${pendingUsers.length} staff account${pendingUsers.length!==1?'s':''} awaiting review</span></h3>
        <button class="btn-secondary btn-sm" onclick="navigate('users')">View All Users →</button>
      </div>
      <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Role</th><th>Registered</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  })()}`;
}
function buildStaffDashboard(){
  const members=Members.all().filter(m=>m.status!=='Archived');
  const today_=today();
  const attendance=Attendance.all().filter(a=>a.date===today_);
  const expiring3=members.filter(m=>{const d=daysUntil(m.expiryDate);return d>=0&&d<=3;});
  const newThisMonth=members.filter(m=>{const d=new Date(m.createdAt||m.startDate);const now=new Date();return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
  const todayLog=attendance.map(a=>{const m=Members.all().find(x=>x.id===a.memberId);const pl=m?Plans.all().find(p=>p.id===m.planId):null;return{...a,memberName:m?m.name:'Unknown',planName:pl?pl.name:'—'};});
  const todayWalkins=Walkins.all().filter(w=>w.date===today_).length;
  return `
  <div class="stats-grid">
    <div class="stat-card orange"><div class="stat-label">Total Members</div><div class="stat-value">${members.length}</div></div>
    <div class="stat-card green"><div class="stat-label">Today's Check-Ins</div><div class="stat-value">${attendance.length}</div></div>
    <div class="stat-card gold"><div class="stat-label">Pending Renewals</div><div class="stat-value">${expiring3.length}</div><div class="stat-hint">Expiring within 3 days</div></div>
    <div class="stat-card blue"><div class="stat-label">Today's Walk-Ins</div><div class="stat-value">${todayWalkins}</div><div class="stat-hint">₱${(todayWalkins*getWalkinFee()).toLocaleString()} collected</div></div>
  </div>
  <div class="checkin-btn-wrap" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <button class="btn-primary" style="width:auto;display:inline-flex;align-items:center;gap:8px" onclick="navigate('scanner')">${iconSvg('camera',16)} Open QR Scanner</button>
    <button class="btn-primary" style="width:auto;display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#0a0a0a;border-color:var(--green);font-weight:800;box-shadow:0 4px 14px rgba(127,250,136,.25)" onclick="openCheckin()">${iconSvg('logIn',16)} Manual Check-In</button>
    <button class="btn-secondary" style="width:auto;display:inline-flex;align-items:center;gap:8px;background:rgba(179,188,181,.15);color:var(--orange);border:1px solid rgba(179,188,181,.3)" onclick="openCheckout()">🚪 Manual Check-Out</button>
    <button class="btn-secondary" style="background:rgba(179,188,181,.15);color:var(--orange);border:1px solid rgba(179,188,181,.3)" onclick="navigate('walkin')">🚶 Register Walk-In</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="table-card">
      <div class="table-header"><h3>Today's Check-Ins</h3></div>
      <table><thead><tr><th>Member</th><th>Check-In</th><th>Check-Out</th><th>Duration</th></tr></thead><tbody>
       ${todayLog.length?todayLog.map(a=>`<tr><td>${esc(a.memberName)}</td><td>${esc(a.checkIn||a.time)}</td><td>${a.checkOut?esc(a.checkOut):'<span style="color:var(--gold)">In Gym</span>'}</td><td>${esc(a.duration||'—')}</td></tr>`).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div><p>No check-ins today</p></div></td></tr>`}
      </tbody></table>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Renewal Reminders</h3></div>
      <table><thead><tr><th>Member</th><th>Expiry</th><th>Days</th><th></th></tr></thead><tbody>
      ${expiring3.length?expiring3.map(m=>{const d=daysUntil(m.expiryDate);return`<tr><td>${esc(m.name)}</td><td>${formatDate(m.expiryDate)}</td><td><span class="days-badge ${d<=1?'days-urgent':'days-warn'}">${d}d</span></td><td><button class="btn-primary btn-sm" onclick="openPaymentForMember('${m.id}')">Pay</button></td></tr>`;}).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">✅</div><p>No reminders</p></div></td></tr>`}
      </tbody></table>
    </div>
  </div>`;
}
function buildTrainerDashboard(){
  const u=currentUser;
  const today_=today();
  const week=addDays(today_,7);
  const allSessions=Sessions.all().filter(s=>s.trainerId===u.id);
  const todaySessions=allSessions.filter(s=>s.date===today_).sort((a,b)=>a.start.localeCompare(b.start));
  const weekSessions=allSessions.filter(s=>s.date>today_&&s.date<=week).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  const scheduledToday=todaySessions.filter(s=>s.status==='Scheduled').length;
  const completedToday=todaySessions.filter(s=>s.status==='Completed').length;
  const assignedMembers=[...new Set(allSessions.map(s=>s.memberId))];
  const statusBadge=s=>{const cls={Scheduled:'badge-scheduled',Completed:'badge-completed',Cancelled:'badge-cancelled'}[s.status]||'';return`<span class="badge ${cls}">${s.status}</span>`;};
  return `
  <div class="stats-grid">
    <div class="stat-card orange"><div class="stat-label">My Sessions Today</div><div class="stat-value">${todaySessions.length}</div><div class="stat-hint">${scheduledToday} scheduled · ${completedToday} done</div></div>
    <div class="stat-card green"><div class="stat-label">Upcoming This Week</div><div class="stat-value">${weekSessions.length}</div><div class="stat-hint">Next 7 days</div></div>
    <div class="stat-card gold"><div class="stat-label">Assigned Members</div><div class="stat-value">${assignedMembers.length}</div><div class="stat-hint">Unique members</div></div>
    <div class="stat-card blue"><div class="stat-label">Total Sessions</div><div class="stat-value">${allSessions.length}</div><div class="stat-hint">${allSessions.filter(s=>s.status==='Completed').length} completed overall</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="table-card">
      <div class="table-header"><h3>Today's Schedule <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${todaySessions.length} session${todaySessions.length!==1?'s':''}</span></h3></div>
      <table><thead><tr><th>Time</th><th>Member</th><th>Type</th><th>Status</th></tr></thead><tbody>
      ${todaySessions.length?todaySessions.map(s=>`<tr>
        <td>${esc(s.start)}–${esc(s.end)}</td>
        <td>${esc(s.memberName||'—')}</td>
        <td>${esc(s.type||'—')}</td>
        <td>${statusBadge(s)}</td>
      </tr>`).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📅</div><p>No sessions today</p></div></td></tr>`}
      </tbody></table>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Upcoming Sessions <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">next 7 days</span></h3></div>
      <table><thead><tr><th>Date</th><th>Time</th><th>Member</th><th>Type</th><th>Status</th></tr></thead><tbody>
      ${weekSessions.length?weekSessions.map(s=>`<tr>
        <td>${formatDate(s.date)}</td>
        <td>${esc(s.start)}–${esc(s.end)}</td>
        <td>${esc(s.memberName||'—')}</td>
        <td>${esc(s.type||'—')}</td>
        <td>${statusBadge(s)}</td>
      </tr>`).join(''):`<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📅</div><p>No upcoming sessions</p></div></td></tr>`}
      </tbody></table>
    </div>
  </div>`;
}

// ======================================================================
// TRAINER: MY ASSIGNED MEMBERS
// ======================================================================
function renderMyAssigned(){
  const el=document.getElementById('panelMyassigned');
  const u=currentUser;
  const allSessions=Sessions.all().filter(s=>s.trainerId===u.id&&s.status!=='Cancelled');
  const memberIds=[...new Set(allSessions.map(s=>s.memberId))];
  const rows=memberIds.map(id=>{
    const m=Members.one(id);
    const plan=m&&m.planId?Plans.one(m.planId):null;
    const mySessions=allSessions.filter(s=>s.memberId===id);
    const completed=mySessions.filter(s=>s.status==='Completed').length;
    const upcoming=mySessions.filter(s=>s.status==='Scheduled'&&s.date>=today()).length;
    const totalAtt=Attendance.all().filter(a=>a.memberId===id).length;
    const sessLimit=plan&&plan.sessions!=='Unlimited'?Number(plan.sessions):null;
    const left=sessLimit===null?'∞':Math.max(0,sessLimit-totalAtt);
    const statusCls=m&&(m.status==='Active'||m.status==='Expiring Soon')?'badge-active':m&&m.status==='Expired'?'badge-inactive':'badge-pending';
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar avatar-trainer" style="width:32px;height:32px;font-size:11px;flex-shrink:0;${m&&m.avatar?'padding:0;overflow:hidden':''}">${m&&m.avatar?`<img src="${m.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(m?m.name:'?'))}</div><div><div style="font-weight:600;color:var(--white)">${esc(m?m.name:'Unknown member')}</div><div style="font-size:11px;color:var(--gray-500);font-family:monospace">${esc(m?m.id:'—')}</div></div></div></td>
      <td>${esc(plan?plan.name:'—')}</td>
      <td><span class="badge ${statusCls}">${esc(m?(m.status==='Expiring Soon'?'Expiring Soon':m.status):'—')}</span></td>
      <td><span class="days-badge days-warn">${left}</span></td>
      <td>${completed}<span style="color:var(--gray-500);font-size:11px"> / ${mySessions.length} total</span></td>
      <td>${upcoming}</td>
      <td><div class="td-actions"><button class="btn-secondary btn-sm" onclick="schedTrainerFilter='${u.id}';schedView='list';navigate('schedule')">View Sessions</button></div></td>
    </tr>`;}).join('');
  el.innerHTML=`
  <div class="stats-grid">
    <div class="stat-card orange"><div class="stat-label">Assigned Members</div><div class="stat-value">${memberIds.length}</div><div class="stat-hint">Unique members</div></div>
    <div class="stat-card green"><div class="stat-label">Sessions Completed</div><div class="stat-value">${allSessions.filter(s=>s.status==='Completed').length}</div><div class="stat-hint">All time</div></div>
    <div class="stat-card gold"><div class="stat-label">Upcoming Sessions</div><div class="stat-value">${allSessions.filter(s=>s.status==='Scheduled'&&s.date>=today()).length}</div><div class="stat-hint">Scheduled</div></div>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>My Assigned Members <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${memberIds.length} member${memberIds.length!==1?'s':''}</span></h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Member</th><th>Plan Type</th><th>Status</th><th>Sessions Left</th><th>Completed</th><th>Upcoming</th><th>Actions</th></tr></thead><tbody>
    ${rows||`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div><p>No members assigned yet</p><p class="empty-sub">Sessions assigned to you by the front desk will appear here.</p></div></td></tr>`}
    </tbody></table></div>
  </div>`;
}

// ======================================================================
// MEMBER DASHBOARD (self-service portal for Member accounts)
// ======================================================================
function mbStepsHtml(mem){
  const steps=[{id:'registered',label:'Registered'},{id:'pay',label:'Awaiting Payment'},{id:'active',label:'Active'}];
  let cur='registered';
  if(mem.status==='pending_payment')cur='pay';
  else if(mem.status==='Active'||mem.status==='Expiring Soon'||mem.status==='Expired')cur='active';
  const states={registered:'todo',pay:'todo',active:'todo'};
  if(cur==='active'){states.registered='done';states.pay='done';states.active='done';}
  else if(cur==='pay'){states.registered='done';states.pay='cur';}
  else states.registered='cur';
  return `<div class="mb-steps">${steps.map((s,i)=>`${i?'<div class="mb-steps-line"></div>':''}<div class="mb-step ${states[s.id]}"><span class="mb-step-dot">${states[s.id]==='done'?'✓':'·'}</span><span>${s.label}</span></div>`).join('')}</div>`;
}
function buildMemberDashboard(){
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem)return'<div class="table-card"><div class="empty-state"><p>Member record not found. Please contact the front desk.</p></div></div>';
  const plan=mem.planId?Plans.one(mem.planId):null;
  const d=daysUntil(mem.expiryDate);
  const today_=today();
  const myAtt=Attendance.all().filter(a=>a.memberId===mem.id).slice().reverse().slice(0,6);
  const totalAtt=Attendance.all().filter(a=>a.memberId===mem.id).length;
  const locked=mem.status==='pending_payment';
  let banner='',panel='';
  if(mem.status==='pending_payment'){
    banner=`<div class="mb-banner pending">
      <div class="mb-banner-ico">⏳</div>
      <div>
        <div class="mb-banner-title">Awaiting Payment</div>
        <div class="mb-banner-sub">Your account is active as soon as the front desk confirms your payment. Visit the counter and pay in <strong>Cash</strong> or <strong>GCash</strong>.</div>
      </div>
      <button class="mb-banner-btn" onclick="mbToggleHowToPay()">💳 How to Pay</button>
    </div>`;
  } else if(mem.status==='Archived'){
    banner=`<div class="mb-banner archived">
      <div class="mb-banner-ico">🗄</div>
      <div>
        <div class="mb-banner-title">Account Archived</div>
        <div class="mb-banner-sub">Your pending sign-up was archived. Visit the front desk to sign up again.</div>
      </div>
    </div>`;
  } else if(d<0){
    banner=`<div class="mb-banner expired">
      <div class="mb-banner-ico">🚫</div>
      <div>
        <div class="mb-banner-title">Plan Expired</div>
        <div class="mb-banner-sub">Entry is blocked. Please visit the front desk to renew your membership.</div>
      </div>
    </div>`;
  } else {
    banner=`<div class="mb-banner active">
      <div class="mb-banner-ico">✅</div>
      <div>
        <div class="mb-banner-title">Membership Active</div>
        <div class="mb-banner-sub">Valid until <strong>${formatDate(mem.expiryDate)}</strong> (${d} day${d!==1?'s':''} left). Show your QR at the entrance to check in.</div>
      </div>
    </div>`;
  }
  const paySteps=locked?`
    <div class="mb-pay-steps" id="mbPaySteps" style="display:none">
      <div class="mb-pay-steps-title">💳 How to Pay</div>
      <div class="mb-pay-step"><span class="mb-pay-step-n">1</span>Visit the front desk counter at the gym.</div>
      <div class="mb-pay-step"><span class="mb-pay-step-n">2</span>Tell the staff your name: <strong>${esc(mem.name)}</strong> (<span style="font-family:monospace">${esc(mem.id)}</span>).</div>
      <div class="mb-pay-step"><span class="mb-pay-step-n">3</span>Pay in <strong>Cash</strong> or <strong>GCash</strong>${plan?` — <strong>₱${Number(plan.price).toLocaleString()}</strong> (${esc(plan.name)} plan)`:''}.</div>
      <div class="mb-pay-step"><span class="mb-pay-step-n">4</span>Your QR activates instantly once payment is confirmed.</div>
      <div class="mb-pay-steps-contact">
        <a class="btn-secondary btn-sm" href="sms:+639150435696">💬 Message Front Desk</a>
      </div>
    </div>`:'';
  const sessLeft=locked?'—':(plan?(plan.sessions==='Unlimited'?'∞':Math.max(0,Number(plan.sessions)-totalAtt)):'—');
  const workoutCta=locked?'':`<div class="mb-grid" style="margin-bottom:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
    <button class="btn-secondary btn-sm" onclick="navigate('myWorkoutPlan')" style="display:flex;align-items:center;gap:8px;padding:14px 16px;background:rgba(127,255,136,.06);border:1px solid rgba(127,255,136,.18);border-radius:12px;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/></svg>My Workout Plan</button>
    <button class="btn-secondary btn-sm" onclick="navigate('myWorkouts')" style="display:flex;align-items:center;gap:8px;padding:14px 16px;background:rgba(127,255,136,.06);border:1px solid rgba(127,255,136,.18);border-radius:12px;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Log Workout</button>
    <button class="btn-secondary btn-sm" onclick="navigate('mySessions')" style="display:flex;align-items:center;gap:8px;padding:14px 16px;background:rgba(127,255,136,.06);border:1px solid rgba(127,255,136,.18);border-radius:12px;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>My Sessions</button>
    <button class="btn-secondary btn-sm" onclick="navigate('myGoals')" style="display:flex;align-items:center;gap:8px;padding:14px 16px;background:rgba(127,255,136,.06);border:1px solid rgba(127,255,136,.18);border-radius:12px;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>My Goals</button>
  </div>`;
  const helpRow=`<div class="mb-help-strip">
    <div class="mb-help-title">Need Help?</div>
    <div class="mb-help-msg">Payments, renewals &amp; plan changes are handled at the front desk.</div>
    <div class="mb-help-actions">
      <button class="btn-secondary btn-sm" onclick="navigate('myMessages')" style="cursor:pointer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Message the Gym</button>
    </div>
  </div>`;
  const changePlan=(mem.status==='pending_payment')?`
    <div class="mb-change-plan">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--gray-500);margin-bottom:10px">Change Plan (before paying)</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="mbPlanSelect" style="flex:1;padding:9px 10px;background:var(--navy-700);border:1.5px solid var(--navy-600);border-radius:8px;color:var(--white);outline:none;font-size:13px">${Plans.all().filter(p=>p.status==='Active').map(p=>`<option value="${p.id}" ${p.id===mem.planId?'selected':''}>${esc(p.name)} — ₱${Number(p.price).toLocaleString()}</option>`).join('')}</select>
        <button class="btn-primary btn-sm" onclick="memberChangePlan('${mem.id}')">💾 Save</button>
      </div>
      <div style="font-size:11px;color:var(--gray-500);margin-top:8px;display:flex;gap:5px;align-items:center">💡 <span>Changes apply before payment is confirmed at the counter.</span></div>
    </div>`:'';
  const planCard=`<div class="mb-plan-card">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
      <div>
        <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px;font-weight:700">Your Plan</div>
        <div class="mb-plan-name">${esc(plan?plan.name:'—')}</div>
      </div>
      ${plan?`<div class="mb-plan-price">₱${Number(plan.price).toLocaleString()}<span>/${plan.duration===1?'mo':plan.duration+'mo'}</span></div>`:''}
    </div>
    ${plan?`<ul class="mb-plan-perks">${(plan.benefits||plan.perks||'').split(/\n|,/).map(b=>b.trim()).filter(Boolean).map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`:''}
    <div class="mb-plan-meta">
      <div><span>Duration</span><strong>${plan?plan.duration+' month(s)':'-'}</strong></div>
      <div><span>Start</span><strong>${mem.planStart?formatDate(mem.planStart):'—'}</strong></div>
      <div><span>Expiry</span><strong>${mem.expiryDate?formatDate(mem.expiryDate):'—'}</strong></div>
      <div><span>Sessions Left</span><strong>${sessLeft}</strong></div>
    </div>
  </div>`;
  const qrBlock=`<div class="mb-qr-box${locked?' locked':''}">
    ${locked?'<div class="mb-qr-pending">⏳ Pending payment — this QR activates once the front desk confirms it</div>':''}
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:10px;text-align:center">Entrance QR — Daily</div>
    <div class="mb-qr-frame">
      ${locked?'<div class="mb-qr-lock">🔒</div>':''}
      <div class="mb-qr-canvas-wrap"><div id="mbQrCanvas"></div></div>
    </div>
    ${mem.avatar?`<div style="text-align:center;margin-top:12px"><img class="mb-avatar-photo" src="${mem.avatar}" alt="${esc(mem.name)}"></div>`:''}
    <div style="text-align:center;font-size:12px;color:var(--white);font-weight:700">${esc(mem.name)}</div>
    <div style="text-align:center;font-size:10px;font-family:monospace;color:var(--gray-500)">${esc(mem.id)}</div>
    <div style="text-align:center;margin-top:10px"><button class="btn-secondary btn-sm" onclick="navigate('myqr')">🖨 View Full QR</button></div>
  </div>`;
  panel=`<div class="mb-grid">
    <div style="display:grid;gap:16px">
      ${planCard}
      ${changePlan}
      <div class="table-card">
        <div class="table-header"><h3>Recent Attendance</h3><button class="btn-secondary btn-sm" onclick="navigate('myattendance')">View All</button></div>
        <table><thead><tr><th>Date</th><th>Time In</th><th>Duration</th><th>Status</th></tr></thead><tbody>
        ${myAtt.length?myAtt.map(a=>`<tr><td>${formatDate(a.date)}</td><td>${esc(a.checkIn||'—')}</td><td>${esc(a.duration||'—')}</td><td><span class="badge ${a.checkOut?'badge-completed':'badge-scheduled'}">${a.checkOut?'Completed':'Checked In'}</span></td></tr>`).join(''):`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div><p>No check-ins yet</p><p class="empty-sub">${locked?'Your check-ins will appear here once your membership is active.':'Scan your QR at the entrance — your visits will show up here.'}</p></div></td></tr>`}
        </tbody></table>
      </div>
      ${locked?'':helpRow}
    </div>
    <div style="display:grid;gap:16px;align-content:start">
      ${qrBlock}
    </div>
  </div>`;
  const stepsTrack=mem.status==='pending_payment'?mbStepsHtml(mem):'';
  return `${dashHero('')}${announceStripHtml()}${banner}${stepsTrack}${paySteps}${workoutCta}${panel}`;
}
function mbToggleHowToPay(){
  const el=document.getElementById('mbPaySteps');
  if(!el)return;
  const open=el.style.display==='block';
  el.style.display=open?'none':'block';
  if(!open&&typeof el.scrollIntoView==='function')el.scrollIntoView({behavior:'smooth',block:'center'});
}
function memberChangePlan(memberId){
  const sel=document.getElementById('mbPlanSelect');
  if(!sel)return;
  const planId=sel.value;
  const mem=Members.one(memberId);
  if(!mem){toast('Member not found.','error');return;}
  if(mem.status!=='pending_payment'){toast('Plan can only be changed while payment is pending.','error');return;}
  Members.update(memberId,{planId});
  const notifs=Notifications.all();
  notifs.forEach(n=>{if(n.memberId===memberId&&n.type==='pending_payment'&&n.status==='open'){n.planId=planId;}});
  Notifications.save(notifs);
  toast('Plan updated. New plan will be confirmed at the counter.');
  renderDashboard();
}
function renderMyQr(){
  const el=document.getElementById('panelMyqr');
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem){el.innerHTML='<div class="table-card"><div class="empty-state"><p>Member record not found.</p></div></div>';return;}
  const plan=mem.planId?Plans.one(mem.planId):null;
  if(mem.status==='Archived'){
    el.innerHTML=`<div class="mb-banner archived">
      <div class="mb-banner-ico">🗄</div>
      <div>
        <div class="mb-banner-title">Account Archived</div>
        <div class="mb-banner-sub">Your sign-up was archived. Visit the front desk to sign up again.</div>
      </div>
    </div>`;
    return;
  }
  if(mem.status==='Expired'){
    el.innerHTML=`<div class="mb-banner expired">
      <div class="mb-banner-ico">🚫</div>
      <div>
        <div class="mb-banner-title">QR Not Available</div>
        <div class="mb-banner-sub">Your plan is not active. Please renew at the front desk.</div>
      </div>
    </div>`;
    return;
  }
  const locked=mem.status==='pending_payment';
  el.innerHTML=`
  <div style="max-width:480px;margin:0 auto">
    <div class="mb-qr-page${locked?' locked':''}">
      ${locked?'<div class="mb-qr-pending">⏳ Pending payment — this QR activates once the front desk confirms it</div>':''}
      <div class="mb-qr-page-brand">FIT<span>CORE</span></div>
      ${mem.avatar?`<img class="mb-avatar-photo" src="${mem.avatar}" alt="${esc(mem.name)}" style="margin-top:10px">`:''}
      <div class="mb-qr-page-name">${esc(mem.name)}</div>
      <div class="mb-qr-page-id">${esc(mem.id)}</div>
      <div class="mb-qr-frame" style="border-radius:14px;padding:18px;margin:14px 0">
        ${locked?'<div class="mb-qr-lock">🔒</div>':''}
        <div class="mb-qr-canvas-wrap"><div id="myQrCanvas"></div></div>
      </div>
      <div style="text-align:center;font-size:11px;color:var(--gray-500);line-height:1.7">
        ${plan?`<div>${esc(plan.name)} · ${mem.status==='pending_payment'?'payment pending':'valid until '+formatDate(mem.expiryDate)}</div>`:''}
        <div>Show this QR at the entrance — the QR rotates daily.</div>
      </div>
      ${locked?'':'<div style="display:flex;gap:10px;margin:14px auto 0;max-width:300px">'+
        '<button class="btn-secondary btn-sm" style="flex:1" onclick="refreshMyQr()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Refresh</button>'+
        '<button class="btn-primary btn-sm" style="flex:1" onclick="downloadMyQr()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save QR</button>'+
        '</div>'}
    </div>
  </div>`;
  refreshMyQr();
}
function downloadMyQr(){
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem)return;
  if(mem.status==='pending_payment'||mem.status==='Archived'){toast('Your QR is not active yet.','error');return;}
  const img=document.querySelector('#myQrCanvas img');
  if(!img){toast('QR not ready yet. Please try again.','error');return;}
  const plan=mem.planId?Plans.one(mem.planId):null;
  const W=720,H=960;
  const cv=document.createElement('canvas');
  cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  const im=new Image();
  im.onload=function(){
    // Background: dark navy gradient
    const bg=ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,'#0d1322');bg.addColorStop(.55,'#141d33');bg.addColorStop(1,'#0a0f1c');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    // Decorative glow circles
    const glow=ctx.createRadialGradient(640,120,10,640,120,260);
    glow.addColorStop(0,'rgba(127,250,136,.22)');glow.addColorStop(1,'rgba(127,250,136,0)');
    ctx.fillStyle=glow;ctx.fillRect(380,0,340,380);
    // Header
    ctx.fillStyle='#7ffa88';
    ctx.font='900 46px Arial';ctx.textAlign='center';
    ctx.fillText('FITCORE',W/2,84);
    ctx.fillStyle='rgba(255,255,255,.45)';
    ctx.font='600 19px Arial';ctx.letterSpacing='6px';
    ctx.fillText('G Y M   M E M B E R S H I P',W/2,118);
    // QR card
    const qrSize=430;
    const qx=(W-qrSize)/2,qy=158;
    ctx.fillStyle='rgba(255,255,255,.06)';
    ctx.beginPath();ctx.roundRect(qx-12,qy-12,qrSize+24,qrSize+24,26);ctx.fill();
    ctx.fillStyle='#ffffff';
    ctx.beginPath();ctx.roundRect(qx,qy,qrSize,qrSize,18);ctx.fill();
    ctx.drawImage(im,qx+26,qy+26,qrSize-52,qrSize-52);
    // Avatar + name
    ctx.fillStyle='rgba(127,250,136,.14)';
    ctx.beginPath();ctx.arc(W/2,706,40,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#7ffa88';
    ctx.font='900 30px Arial';
    ctx.fillText(initials(mem.name),W/2,716);
    ctx.fillStyle='#ffffff';
    ctx.font='800 34px Arial';
    ctx.fillText(mem.name,W/2,786);
    // ID chip
    const idLabel='ID '+mem.id;
    ctx.font='700 22px monospace';
    const idW=ctx.measureText(idLabel).width+36;
    ctx.fillStyle='rgba(255,255,255,.08)';
    ctx.beginPath();ctx.roundRect(W/2-idW/2,806,idW,44,22);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.85)';
    ctx.fillText(idLabel,W/2,836);
    // Plan + validity
    ctx.font='600 24px Arial';
    ctx.fillStyle='rgba(255,255,255,.6)';
    ctx.fillText(plan?plan.name+' · valid until '+formatDate(mem.expiryDate):'',W/2,898);
    // Footer
    ctx.fillStyle='rgba(255,255,255,.32)';
    ctx.font='600 18px Arial';
    ctx.fillText('Show at the FitCore entrance · QR rotates daily',W/2,H-34);
    const a=document.createElement('a');
    a.href=cv.toDataURL('image/png');
    a.download='FitCore-QR-'+mem.id+'.png';
    document.body.appendChild(a);a.click();a.remove();
    toast('QR saved to your device. You can save it to your Photos.');
  };
  im.onerror=function(){toast('Could not export QR.','error');};
  im.src=img.src;
}
function refreshMyQr(){
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem)return;
  const token=qrTokenFor(mem.id,today());
  renderQrTo(document.getElementById('myQrCanvas'),token,6);
  renderQrTo(document.getElementById('mbQrCanvas'),token,4);
}
function renderMyAttendance(){
  const el=document.getElementById('panelMyattendance');
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem){el.innerHTML='<div class="table-card"><div class="empty-state"><p>Member record not found.</p></div></div>';return;}
  const rows=Attendance.all().filter(a=>a.memberId===mem.id).slice().reverse();
  const total=rows.length;
  const thisMonth=new Date();
  const monthCount=rows.filter(a=>{const d=new Date(a.date);return d.getMonth()===thisMonth.getMonth()&&d.getFullYear()===thisMonth.getFullYear();}).length;
  el.innerHTML=`
  <div class="stats-grid">
    <div class="stat-card orange"><div class="stat-label">Total Check-Ins</div><div class="stat-value">${total}</div><div class="stat-hint">All time</div></div>
    <div class="stat-card green"><div class="stat-label">This Month</div><div class="stat-value">${monthCount}</div><div class="stat-hint">${thisMonth.toLocaleString('en-US',{month:'long'})}</div></div>
    <div class="stat-card gold"><div class="stat-label">Last Visit</div><div class="stat-value" style="font-size:20px">${rows.length?formatDate(rows[0].date):'—'}</div><div class="stat-hint">${rows.length?esc(rows[0].checkIn||''):''}</div></div>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>My Attendance <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${total} record${total!==1?'s':''}</span></h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time In</th><th>Time Out</th><th>Duration</th><th>Status</th></tr></thead><tbody>
    ${rows.length?rows.map(a=>`<tr><td>${formatDate(a.date)}</td><td>${esc(a.checkIn||'—')}</td><td>${a.checkOut?esc(a.checkOut):'<span style="color:var(--gold)">In Gym</span>'}</td><td>${esc(a.duration||'—')}</td><td><span class="badge ${a.checkOut?'badge-completed':'badge-scheduled'}">${a.checkOut?'Completed':'Checked In'}</span></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><p>No check-ins yet. Scan your QR at the entrance to start.</p></div></td></tr>`}
    </tbody></table></div>
  </div>`;
}

// ======================================================================
// PANEL: MEMBERS
// ======================================================================
let memberPage=1;let memberSearch='';let memberStatusFilter='All';let memberPlanFilter='All';
function renderMembers(){
  const el=document.getElementById('panelMembers');
  const plans=Plans.all();
  const planOpts=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  el.innerHTML=`
  <div class="page-actions">
    <div class="table-controls">
      <input class="search-input" placeholder="Search by name or ID…" value="${esc(memberSearch)}" oninput="memberSearch=this.value;memberPage=1;refreshMemberTable()">
      <select class="filter-sel" onchange="memberStatusFilter=this.value;memberPage=1;refreshMemberTable()">
        <option>All</option><option>Active</option><option>Expired</option><option>Expiring Soon</option><option value="pending_payment">Pending Payment</option>
      </select>
      <select class="filter-sel" onchange="memberPlanFilter=this.value;memberPage=1;refreshMemberTable()">
        <option value="All">All Plans</option>${planOpts}
      </select>
    </div>
    <button class="btn-primary" onclick="openMemberModal()">+ Add New Member</button>
    <button class="btn-secondary" style="display:inline-flex;align-items:center;gap:8px;padding:0 18px;height:46px;border:1.8px solid #7ffa88;color:#fff;background:rgba(127,250,136,.12);border-radius:14px;font-weight:800;letter-spacing:.6px;flex-shrink:0;box-shadow:0 0 0 1px rgba(127,250,136,.15) inset" onclick="renumberMembers()" title="Purge archived members and renumber IDs sequentially (MEM-0001, MEM-0002, …)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> RENUMBER</button>
    <button class="btn-danger" style="width:46px;height:46px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0" onclick="resetAllMembers()" title="Delete ALL members — empty member list"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
  </div>
  <div class="table-card" id="memberTableCard"></div>`;
  refreshMemberTable();
}
function refreshMemberTable(){
  let data=Members.all().filter(m=>m.status!=='Archived');
  if(memberSearch){const s=memberSearch.toLowerCase();data=data.filter(m=>m.name.toLowerCase().includes(s)||m.id.toLowerCase().includes(s));}
  if(memberStatusFilter!=='All')data=data.filter(m=>m.status===memberStatusFilter);
  if(memberPlanFilter!=='All')data=data.filter(m=>m.planId===memberPlanFilter);
  // Detect duplicate contacts (normalized) for flagging
  const contactCounts={};
  data.forEach(m=>{const nc=normalizeContact(m.contact,'+63');contactCounts[nc]=(contactCounts[nc]||0)+1;});
  const perPage=10;const total=data.length;const pages=Math.ceil(total/perPage)||1;
  const slice=data.slice((memberPage-1)*perPage,memberPage*perPage);
  const plans=Plans.all();
  const allUsers=Users.all();
  const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
  const rows=slice.length?slice.map(m=>{
    const pl=plans.find(p=>p.id===m.planId);
    const attList=Attendance.all().filter(a=>a.memberId===m.id);
    const attCount=attList.length;
    const lastAtt=attList.slice(-1)[0];
    const attHtml=attCount?`<div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px"><span style="font-size:12px;font-weight:700;color:var(--white);background:rgba(127,250,136,.12);border:1px solid rgba(127,250,136,.18);border-radius:6px;padding:2px 7px">${attCount} visit${attCount!==1?'s':''}</span>${lastAtt?`<span style=\"font-size:10px;color:var(--gray-500)\">Last: ${formatDate(lastAtt.date)} ${esc(lastAtt.checkIn||lastAtt.time||'')}</span>`:''}</div>`:`<span style="font-size:11px;color:var(--gray-500)">No visits</span>`;
    const badgeCls={Active:'badge-active',Expired:'badge-expired',Suspended:'badge-suspended','Expiring Soon':'badge-expiring','pending_payment':'badge-pending'}[m.status]||'badge-suspended';
    // Created By
    const createdByUser=m.createdBy?allUsers.find(u=>u.name===m.createdBy||u.username===m.createdByUsername):null;
    const cRoleColor=createdByUser?roleColorMap[createdByUser.role]||'var(--gray-300)':'var(--gray-300)';
    const cRoleTag=createdByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${cRoleColor};margin-left:4px;text-transform:uppercase">${createdByUser.role}</span>`:'';
    const createdLine=m.createdBy?`<div style="font-size:12px;font-weight:600;color:var(--gray-100)">${esc(m.createdBy)}${cRoleTag}</div>`:`<span style="font-size:11px;color:var(--gray-500)">—</span>`;
    // Edited By
    const editedByUser=m.editedBy?allUsers.find(u=>u.name===m.editedBy||u.username===m.editedByUsername):null;
    const eRoleColor=editedByUser?roleColorMap[editedByUser.role]||'var(--gray-300)':'var(--gray-300)';
    const eRoleTag=editedByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${eRoleColor};margin-left:4px;text-transform:uppercase">${editedByUser.role}</span>`:'';
    const editedLine=m.editedBy?`<div style="font-size:11px;color:var(--gray-500);margin-top:3px">✎ ${esc(m.editedBy)}${eRoleTag}</div>`:'';
    return`<tr>
      <td>${esc(m.id)}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="member-avatar" style="${m.avatar?'padding:0;overflow:hidden':''}">${m.avatar?`<img src="${m.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(m.name))}</div>${esc(m.name)}</div></td>
      <td><div style="display:flex;align-items:center;gap:5px">${esc(m.contact)}${(contactCounts[normalizeContact(m.contact,'+63')]||0)>1?`<span title="Duplicate contact number!" style="display:inline-flex;align-items:center;background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3);border-radius:4px;padding:1px 5px;font-size:9px;font-weight:800;cursor:help">⚠ DUP</span>`:''}</div></td>
      <td>${esc(pl?pl.name:'—')}</td>
      <td>${formatDate(m.startDate)}</td>
      <td>${formatDate(m.expiryDate)}</td>
      <td>${attHtml}</td>
      <td><span class="badge ${badgeCls}">${esc(m.status)}</span></td>
      <td><div>${createdLine}${editedLine}</div></td>
      <td><div class="td-actions">
        <button class="btn-icon" title="View" onclick="viewMember('${m.id}')">👁</button>
        ${currentUser.role==='admin'?`<button class="btn-icon" title="Edit" onclick="openMemberModal('${m.id}')">✏️</button>`:`''`}
        <button class="btn-icon" title="Delete" style="color:var(--red);border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.08)';this.style.color='var(--red)'" onclick="deleteMember('${m.id}')">✕</button>
      </div></td>
    </tr>`;}).join(''):`<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">👥</div><p>No members found</p></div></td></tr>`;
  let pag='';
  if(pages>1){
    pag=`<div class="pagination">
      <button class="page-btn" onclick="memberPage=${memberPage-1};refreshMemberTable()" ${memberPage===1?'disabled':''}>‹</button>
      ${Array.from({length:pages},(_,i)=>`<button class="page-btn ${i+1===memberPage?'active':''}" onclick="memberPage=${i+1};refreshMemberTable()">${i+1}</button>`).join('')}
      <button class="page-btn" onclick="memberPage=${memberPage+1};refreshMemberTable()" ${memberPage===pages?'disabled':''}>›</button>
      <span class="page-info">Showing ${(memberPage-1)*perPage+1}–${Math.min(memberPage*perPage,total)} of ${total}</span>
    </div>`;}
  document.getElementById('memberTableCard').innerHTML=`
    <div class="table-header"><h3>Members <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${total} record${total!==1?'s':''}</span></h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Name</th><th>Contact</th><th>Plan</th><th>Start</th><th>Expiry</th><th>Attendance</th><th>Status</th><th>Created / Edited By</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${pag}`;
}
let editingMemberId=null;
function openMemberModal(id=null){
  // Staff cannot edit members - view only
  if(id && currentUser && currentUser.role==='staff'){
    viewMember(id);
    toast('Staff can view member profiles. Only admin can edit.','info');
    return;
  }
  editingMemberId=id;
  document.getElementById('memberModalTitle').textContent=id?'Edit Member':'Add New Member';
  document.getElementById('memberFormError').style.display='none';
  const plans=Plans.all().filter(p=>p.status==='Active');
  document.getElementById('mf_plan').innerHTML=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  // Sync amount when plan changes
  document.getElementById('mf_plan').onchange=function(){
    const plan=Plans.one(this.value);
    document.getElementById('mf_amount').value=plan?plan.price:'';
  };
  // set DOB max to today (no future births)
  const dobInput=document.getElementById('mf_dob');
  if(dobInput) dobInput.max=today();
  const msDob=document.getElementById('msDob');
  if(msDob) msDob.max=today();
  if(id){
    const m=Members.one(id);
    if(!m)return;
    document.getElementById('mf_name').value=m.name||'';
    document.getElementById('mf_contact').value=m.contact||'';
    const dobVal=m.dob||'';
    if(dobInput) dobInput.value=dobVal;
    // derive age from dob if present, else use stored age
    const derived=dobVal?String(calcAge(dobVal)): (m.age||'');
    document.getElementById('mf_age').value=derived;
    if(dobVal) onMfDobChange(); else { const h=document.getElementById('mf_age_hint'); if(h){h.textContent=''; h.style.display='none';}}
    document.getElementById('mf_sex').value=m.sex||'';
    document.getElementById('mf_plan').value=m.planId||'';
    // Only admin can edit plan; staff/trainer/member cannot
    const planSelect=document.getElementById('mf_plan');
    const planNote=document.getElementById('mf_plan_note');
    if(currentUser.role!=='admin'){
      planSelect.disabled=true;
      planSelect.style.opacity='0.5';
      planSelect.style.cursor='not-allowed';
      if(planNote)planNote.style.display='flex';
    } else {
      planSelect.disabled=false;
      planSelect.style.opacity='';
      planSelect.style.cursor='';
      if(planNote)planNote.style.display='none';
    }
    document.getElementById('mf_start').value=m.startDate||'';
    document.getElementById('mf_address').value=m.address||'';
    document.getElementById('mf_ecname').value=m.ecName||'';
    document.getElementById('mf_ecnum').value=m.ecNum||'';
    document.getElementById('mf_notes').value=m.notes||'';
    // Gmail the member registered with: prefer the profile email, then a real
    // Firebase Auth email (legacy synthetic .local addresses are not shown).
    const mEmail=String(m.email||'').trim()||(m.authEmail&&!String(m.authEmail).endsWith('@fitcoregym.local')?m.authEmail:'');
    document.getElementById('mf_email').value=mEmail;
    document.getElementById('mf_paydate').value=today();
    const plan=Plans.one(m.planId);
    document.getElementById('mf_amount').value=plan?plan.price:'';
    document.getElementById('mf_method').value='';
    document.getElementById('mf_paynotes').value='';
    // Staff + Admin can edit billing; trainer/member cannot
    const billingNote=document.getElementById('mf_billing_note');
    const billingInputs=['mf_paydate','mf_method','mf_paynotes'];
    if(currentUser.role!=='admin'){
      billingInputs.forEach(fid=>{
        const el=document.getElementById(fid);
        if(el){el.disabled=true;el.style.opacity='0.5';el.style.cursor='not-allowed';}
      });
      if(billingNote)billingNote.style.display='flex';
    } else {
      billingInputs.forEach(fid=>{
        const el=document.getElementById(fid);
        if(el){el.disabled=false;el.style.opacity='';el.style.cursor='';}
      });
      if(billingNote)billingNote.style.display='none';
    }
  } else {
    ['mf_name','mf_contact','mf_age','mf_address','mf_ecname','mf_ecnum','mf_notes','mf_email'].forEach(id=>document.getElementById(id).value='');
    const dobIn=document.getElementById('mf_dob'); if(dobIn) dobIn.value='';
    const hint=document.getElementById('mf_age_hint'); if(hint){hint.textContent=''; hint.style.display='none';}
    document.getElementById('mf_sex').value='';
    document.getElementById('mf_start').value=today();
    document.getElementById('mf_paydate').value=today();
    document.getElementById('mf_method').value='';
    document.getElementById('mf_paynotes').value='';
    // auto-fill amount from first plan
    const plan=plans.length?Plans.one(plans[0].id):null;
    document.getElementById('mf_amount').value=plan?plan.price:'';
    if(plans.length)document.getElementById('mf_plan').value=plans[0].id;
    // Always unlock plan and billing for new members (any role can register)
    const ps=document.getElementById('mf_plan');
    const pn=document.getElementById('mf_plan_note');
    ps.disabled=false;ps.style.opacity='';ps.style.cursor='';
    if(pn)pn.style.display='none';
    ['mf_paydate','mf_method','mf_paynotes'].forEach(fid=>{
      const el=document.getElementById(fid);
      if(el){el.disabled=false;el.style.opacity='';el.style.cursor='';}
    });
    const bn=document.getElementById('mf_billing_note');
    if(bn)bn.style.display='none';
  }
  openModal('memberModal');
}
async function saveMember(){
  const name=document.getElementById('mf_name').value.trim();
  const contact=document.getElementById('mf_contact').value.trim();
  // If non-admin is editing, preserve the existing plan from the DB
  const planSelect=document.getElementById('mf_plan');
  const planId=editingMemberId&&currentUser.role!=='admin'
    ? (Members.one(editingMemberId)||{}).planId||planSelect.value
    : planSelect.value;
  const startDate=document.getElementById('mf_start').value;
  const dobEl=document.getElementById('mf_dob');
  const dob=dobEl?dobEl.value.trim():'';
  const ageCalc=calcAge(dob);
  const pol=dobPolicy(ageCalc);
  const err=document.getElementById('memberFormError');
  err.style.display='none';
  if(currentUser && currentUser.role==='staff' && editingMemberId){err.textContent='Only admin can edit members.';err.style.display='block';return;}
  if(!name||!contact||!planId||!startDate||!dob){err.textContent='Please fill in all required fields (including Date of Birth).';err.style.display='block';return;}
  if(isNaN(ageCalc)){err.textContent='Please enter a valid date of birth.';err.style.display='block';return;}
  if(!pol.ok){err.textContent=pol.msg;err.style.display='block';return;}
  const members=Members.all();
  // Normalize contact to PH 09xxxxxxxxx format
  const normContact=normalizeContact(contact,'+63');
  if(!editingMemberId){
    // Strict unique contact — no two active members may share a phone number
    const dupContact=members.find(m=>normalizeContact(m.contact,'+63')===normContact&&m.status!=='Archived');
    if(dupContact){err.textContent='Phone number already used by "'+dupContact.name+'" ('+dupContact.id+'). Each member must have a unique contact number.';err.style.display='block';return;}
    // Validate billing fields for new members
    const method=document.getElementById('mf_method').value;
    if(!method){err.textContent='Please select a payment method.';err.style.display='block';return;}
  }
  // Strict unique contact — applies to both add and edit
  if(editingMemberId){
    const dupContact=members.find(m=>normalizeContact(m.contact,'+63')===normContact&&m.id!==editingMemberId&&m.status!=='Archived');
    if(dupContact){err.textContent='Phone number already used by "'+dupContact.name+'" ('+dupContact.id+'). Each member must have a unique contact number.';err.style.display='block';return;}
  }
  const plan=Plans.one(planId);
  const expiryDate=addMonths(startDate,plan?plan.duration:1);
  // Member login is created by the member's own registration (Firebase Auth).
  // The admin profile only records the Gmail they used — no username/password
  // fields here, and no duplicate Gmail across members or staff accounts.
  const mfEmail=(document.getElementById('mf_email')?document.getElementById('mf_email').value.trim().toLowerCase():'');
  if(mfEmail){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mfEmail)){err.textContent='Please enter a valid Gmail / email address.';err.style.display='block';return;}
    if(mfEmail.endsWith('@fitcoregym.local')){err.textContent='Please use the member\u2019s real Gmail, not a staff-managed email.';err.style.display='block';return;}
    const dupMember=members.find(x=>x.id!==editingMemberId&&(String(x.email||'').toLowerCase()===mfEmail||String(x.authEmail||'').toLowerCase()===mfEmail));
    if(dupMember){err.textContent='Email already exists — used by member '+dupMember.name+' ('+dupMember.id+').';err.style.display='block';return;}
    const dupUser=Users.all().find(u=>String(u.authEmail||'').toLowerCase()===mfEmail||String(u.email||'').toLowerCase()===mfEmail);
    if(dupUser){err.textContent='Email already exists — used by '+dupUser.name+'.';err.style.display='block';return;}
  }
  // For 13-17 require emergency contact (guardian verification at front desk)
  const ecNameVal=document.getElementById('mf_ecname').value.trim();
  const ecNumVal=document.getElementById('mf_ecnum').value.trim();
  if(ageCalc<=17){
    if(!ecNameVal||!ecNumVal){
      err.textContent=(ageCalc<=15?'Ages 13–15 require parent/guardian name + number (guardian must be present).':'Ages 16–17 require parent/guardian emergency contact + written consent on file.');
      err.style.display='block';return;
    }
  }
  const data={
    name:sanitizeText(name),contact:sanitizeText(contact),email:mfEmail,dob:dob,age:String(ageCalc),sex:sanitizeText(document.getElementById('mf_sex').value),
    planId,startDate,expiryDate,address:sanitizeText(document.getElementById('mf_address').value.trim()),
    ecName:sanitizeText(ecNameVal),ecNum:sanitizeText(ecNumVal),
    notes:sanitizeText(document.getElementById('mf_notes').value.trim()),status:'Active'
  };
  if(editingMemberId){
    const existing=members.find(m=>m.id===editingMemberId);
    // Never activate a pending member from the profile form — activation is
    // owned by the Payment Queue (member + payment committed together).
    if(existing&&(existing.status==='pending_payment'||existing.status==='Archived'||bgCheckBlocksActivation(existing)))data.status=existing.status;
  }
  const confirmTitle=editingMemberId?'Update Member':'Add New Member';
  const confirmMsg=editingMemberId
    ?`Save changes to <strong>${esc(name)}</strong>? Billing records linked to this member will also be synced automatically.`
    :`Add <strong>${esc(name)}</strong> as a new member under the <strong>${esc(plan?plan.name:'selected')}</strong> plan? A payment record will be created automatically.`;
  openConfirm(confirmTitle, confirmMsg, async ()=>{
    try{
      const online=!!(window.GMSFB&&GMSFB.enabled);
      if(editingMemberId){
        const idx=members.findIndex(m=>m.id===editingMemberId);
        // Capture old values BEFORE overwriting to build a change log
        const oldM=members[idx]||{};
        const allPlans=Plans.all();
        const oldPlanName=(allPlans.find(p=>p.id===oldM.planId)||{name:oldM.planId||'—'}).name;
        const newPlanName=plan?plan.name:(planId||'—');
        const fieldLabels={
          name:'Name', contact:'Contact', email:'Email', age:'Age', sex:'Sex',
          planId:'Plan', startDate:'Start Date', address:'Address',
          ecName:'Emergency Contact', ecNum:'EC Number', notes:'Notes'
        };
        const changedParts=[];
        Object.keys(fieldLabels).forEach(k=>{
          const oldVal=k==='planId'?oldPlanName:(String(oldM[k]||'')).trim();
          const newVal=k==='planId'?newPlanName:(String(data[k]||'')).trim();
          if(oldVal!==newVal){
            changedParts.push(fieldLabels[k]+': "'+oldVal+'" → "'+newVal+'"');
          }
        });
        const changeDetail=changedParts.length?changedParts.join(' | '):'No field changes detected';
        const memberPatch={...data,editedBy:currentUser.name,editedByUsername:currentUser.username,editedByRole:currentUser.role,editedAt:today()};
        // AUTO-SYNC: linked payment docs carry the member's current name/plan.
        const linked=Payments.all().filter(p=>p.memberId===editingMemberId);
        const payPatches=linked.map(p=>{
          const patch={memberName:name,syncedAt:today()};
          if(planId&&planId!==p.planId){
            patch.planId=planId;
            patch.planName=plan?plan.name:p.planName;
            patch.newExpiry=addMonths(p.date,plan?plan.duration:1);
          }
          return {col:'payments',id:p.id,data:patch,merge:true};
        });
        if(online){
          if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
          const ops=[{col:'members',id:editingMemberId,data:memberPatch,merge:true}];
          if(currentUser.role==='admin')ops.push(...payPatches);
          const res=await GMSFB.commitDocs(ops);
          if(!res||!res.ok)throw new Error('Could not save to Firebase ('+((res&&(res.error||res.reason))||'error')+').');
        }else{
          if(idx>-1)members[idx]={...members[idx],...memberPatch};
          Members.save(members);
          if(currentUser.role==='admin'&&linked.length){
            const payments=Payments.all();
            payments.forEach(p=>{
              if(p.memberId===editingMemberId){
                p.memberName=name;
                if(planId&&planId!==p.planId){p.planId=planId;p.planName=plan?plan.name:p.planName;p.newExpiry=addMonths(p.date,plan?plan.duration:1);}
                p.syncedAt=today();
              }
            });
            Payments.save(payments);
          }
        }
        logActivity('Edited','Member',name,'ID: '+editingMemberId+' | '+changeDetail);
        toast(currentUser.role==='admin'?'Member updated and saved to Firebase. Billing records synced automatically.':'Member info updated and saved to Firebase.');
      } else {
        const newId=nextMemberId();
        const memberDoc={id:newId,...data,createdBy:currentUser.name,createdByUsername:currentUser.username,createdByRole:currentUser.role,createdAt:today(),bgCheckStatus:'Pending',bgCheckDate:'',bgCheckBy:'',bgCheckNotes:''};
        const payDate=document.getElementById('mf_paydate').value||today();
        const amount=parseFloat(document.getElementById('mf_amount').value)||plan.price;
        const method=document.getElementById('mf_method').value;
        const payNotes=document.getElementById('mf_paynotes').value.trim();
        const newPayId=nextId(KEY.payments,'PAY');
        const paymentDoc={
          id:newPayId,memberId:newId,memberName:name,
          planId,planName:plan?plan.name:'Unknown',
          amount,date:payDate,newExpiry:expiryDate,method,
          notes:sanitizeText(payNotes),
          recordedBy:currentUser.name,
          recordedByUsername:currentUser.username,
          status:'Paid',createdAt:today()
        };
        if(online){
          if(!GMSFB._lastCloud.members||!GMSFB._lastCloud.payments)throw new Error('Member and payment data are still loading from Firebase. Please wait a moment and try again.');
          if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
          const res=await GMSFB.commitDocs([
            {col:'members',id:newId,data:memberDoc,merge:false},
            {col:'payments',id:newPayId,data:paymentDoc,merge:false}
          ]);
          if(!res||!res.ok)throw new Error('Could not save to Firebase ('+((res&&(res.error||res.reason))||'error')+').');
        }else{
          members.push(memberDoc);
          Members.save(members);
          const payments=Payments.all();
          payments.push(paymentDoc);
          Payments.save(payments);
        }
        logActivity('Added','Member',name,'ID: '+newId+' | Plan: '+(plan?plan.name:''));
        toast('Member added & payment saved to Firebase.');
      }
      closeModal('memberModal');renderMembers();scanRenewals();updateHeroMemberCount();
      if(document.getElementById('billingTableCard'))refreshBillingTable();
    }catch(e){
      err.textContent=(e&&e.message)?e.message:'Could not save the member. Please try again.';
      err.style.display='block';
      console.error('[saveMember]',e);
    }
  },'Save','btn-primary');
}
function deleteMember(id){
  const m=Members.one(id);
  openConfirm('Delete Member',`Are you sure you want to delete ${m?esc(m.name):'this member'}? This cannot be undone.`,async ()=>{
    const members=Members.all();const idx=members.findIndex(m=>m.id===id);
    if(idx>-1){logActivity('Deleted','Member',members[idx].name,'ID: '+members[idx].id+' | Plan: '+(Plans.all().find(p=>p.id===members[idx].planId)||{name:'—'}).name);members[idx].status='Archived';}
    try{
      if(window.GMSFB&&GMSFB.enabled){
        if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
        const res=await GMSFB.commitDocs([{col:'members',id,data:{status:'Archived',archivedAt:new Date().toISOString()},merge:true}]);
        if(!res||!res.ok)throw new Error('Could not archive this member in Firebase ('+((res&&(res.error||res.reason))||'error')+').');
      }else{
        Members.save(members);
      }
      toast('Member archived.','success');renderMembers();updateHeroMemberCount();
    }catch(e){toast((e&&e.message)||'Could not archive this member.','error');console.warn('[deleteMember]',e);}
  });
}
function renumberMembers(){
  const all=Members.all();
  const archived=all.filter(m=>m.status==='Archived');
  const live=all.filter(m=>m.status!=='Archived');
  const aIds=archived.map(m=>m.id);
  const remap={};
  live.forEach((m,i)=>{remap[m.id]='MEM-'+String(i+1).padStart(4,'0');});
  const changed=live.filter(m=>remap[m.id]!==m.id).length;
  // Collect OLD IDs that will be renamed — these must be deleted from Firestore
  const renamedOldIds=live.filter(m=>remap[m.id]!==m.id).map(m=>m.id);
  openConfirm('Renumber Members','This will permanently delete '+archived.length+' archived member(s) and renumber members so IDs run sequentially from MEM-0001 (e.g. MEM-0009 → MEM-0006, MEM-0010 → MEM-0007). Payments, notifications, attendance and sessions are updated to match. Continue?',function(){
    // Collect payment IDs belonging to archived members BEFORE filtering
    const archivedPaymentIds=Payments.all().filter(p=>aIds.includes(p.memberId)).map(p=>p.id);
    Members.save(live.map(m=>{m.id=remap[m.id];return m;}));
    Payments.save(Payments.all().filter(p=>!aIds.includes(p.memberId)).map(p=>{if(remap[p.memberId])p.memberId=remap[p.memberId];return p;}));
    Notifications.save(Notifications.all().filter(n=>!aIds.includes(n.memberId)).map(n=>{if(remap[n.memberId])n.memberId=remap[n.memberId];return n;}));
    Attendance.save(Attendance.all().filter(a=>!aIds.includes(a.memberId)).map(a=>{if(remap[a.memberId])a.memberId=remap[a.memberId];return a;}));
    Sessions.save(Sessions.all().filter(s=>!aIds.includes(s.memberId)).map(s=>{if(remap[s.memberId])s.memberId=remap[s.memberId];if(remap[s.id])s.id=remap[s.id];return s;}));
    Members.all().forEach(m=>{if(m.qrToken||m.status==='Active'){try{Members.update(m.id,{qrToken:qrTokenFor(m.id,today())});}catch(e){}}});
    // Explicitly delete OLD renamed IDs from Firestore (prevents duplicates)
    if(window.GMSFB&&GMSFB.enabled&&renamedOldIds.length){
      try{GMSFB.deleteDocs('gms_members',renamedOldIds);}catch(e){}
    }
    // Explicitly delete archived members and their payments from Firestore cloud
    if(window.GMSFB&&GMSFB.enabled&&aIds.length){
      try{
        GMSFB.deleteDocs('gms_members',aIds);
        GMSFB.deleteDocs('gms_payments',archivedPaymentIds);
      }catch(e){}
    }
    logActivity('Renumbered','Members','Renumbered '+changed+' member(s) · removed '+archived.length+' archived');
    renderMembers();scanRenewals();updateHeroMemberCount();renderDashboard();
    toast('Member IDs renumbered sequentially.');
  },'Renumber','btn-primary');
}
function resetAllMembers(){
  const n=Members.count();
  const p=Payments.count();
  openConfirm('Reset All Members','This will permanently delete <strong>ALL '+n+' member(s)</strong> and their '+p+' payment record(s), attendance, sessions, notifications and messages. The member list will be empty — no member registered. Continue?',function(){
    // Collect all IDs before clearing so we can explicitly delete from cloud
    const allMemberIds=Members.all().map(m=>m.id);
    const allPaymentIds=Payments.all().map(p=>p.id);
    const allAttIds=Attendance.all().map(a=>a.id);
    const allSessIds=Sessions.all().map(s=>s.id);
    const allNotifIds=Notifications.all().map(n=>n.id);
    const allMsgIds=Messages.all().map(m=>m.id);
    Members.save([]);
    Payments.save([]);
    Attendance.save([]);
    Sessions.save([]);
    Notifications.save([]);
    Messages.save([]);
    // Explicitly delete all docs from Firestore cloud
    if(window.GMSFB&&GMSFB.enabled){
      try{
        GMSFB.deleteDocs('gms_members',allMemberIds);
        GMSFB.deleteDocs('gms_payments',allPaymentIds);
        GMSFB.deleteDocs('gms_attendance',allAttIds);
        GMSFB.deleteDocs('gms_sessions',allSessIds);
        GMSFB.deleteDocs('gms_notifications',allNotifIds);
        GMSFB.deleteDocs('gms_messages',allMsgIds);
      }catch(e){}
    }
    logActivity('Reset','Members','Deleted all members — list reset to empty');
    renderMembers();scanRenewals();updateHeroMemberCount();renderDashboard();updatePendingBadge();updateQueueBadge();
    toast('All members removed. No member registered.');
  },'Reset All','btn-danger');
}
function viewMember(id){
  currentProfileId=id;
  const m=Members.one(id);
  if(!m)return;
  const plan=Plans.one(m.planId);
  const payments=Payments.all().filter(p=>p.memberId===id);
  const sessions=Sessions.all().filter(s=>s.memberId===id);
  const attendance=Attendance.all().filter(a=>a.memberId===id).slice().reverse();
  const memberEmail=String(m.email||'').trim()||(m.authEmail&&!String(m.authEmail).endsWith('@fitcoregym.local')?m.authEmail:'');
  const badgeCls={Active:'badge-active',Expired:'badge-expired',Suspended:'badge-suspended','Expiring Soon':'badge-expiring'}[m.status]||'';
  const bgBadgeCls={Cleared:'badge-active',Flagged:'badge-suspended',Pending:'badge-pending'}[m.bgCheckStatus||'Pending']||'badge-pending';
  document.getElementById('profileModalBody').innerHTML=`
  <div class="profile-section">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div style="width:52px;height:52px;border-radius:12px;flex-shrink:0;overflow:hidden;background:linear-gradient(135deg,var(--orange),var(--orange-dark));display:flex;align-items:center;justify-content:center">${m.avatar?`<img src="${m.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:`<span style="color:#0a0a0a;font-size:18px;font-weight:800">${esc(initials(m.name))}</span>`}</div>
      <div><div style="font-size:20px;font-weight:800;font-family:'Barlow Condensed',sans-serif">${esc(m.name)}</div>
      <div style="color:var(--gray-500);font-size:12px">${esc(m.id)}</div>
      <span class="badge ${badgeCls}" style="margin-top:4px">${esc(m.status)}</span></div>
    </div>
    <h4>Personal Information</h4>
        <div class="profile-grid">
      <div class="profile-field"><label>Contact</label><p>${esc(m.contact||'—')}</p></div>
      <div class="profile-field"><label>Gmail</label><p>${esc(memberEmail||'—')}</p></div>
      <div class="profile-field"><label>Date of Birth</label><p>${m.dob?formatDate(m.dob)+' <span style="color:var(--gray-500)">('+esc(m.age||calcAge(m.dob) )+' yrs)</span>': esc(m.age||'—')}</p></div>
      <div class="profile-field"><label>Sex</label><p>${esc(m.sex||'—')}</p></div>
      <div class="profile-field"><label>Address</label><p>${esc(m.address||'—')}</p></div>
      <div class="profile-field"><label>Emergency Contact</label><p>${esc(m.ecName||'—')} ${m.ecNum?'('+esc(m.ecNum)+')':''}</p></div>
    </div>
    ${(()=>{const a=m.dob?calcAge(m.dob):parseInt(m.age||'0',10); const p=dobPolicy(a); if(!isNaN(a)) return `<div style="margin-top:8px;font-size:11px;padding:6px 10px;border-radius:6px;border:1px solid ${p.color}20;background:${p.color}10;color:${p.color}">Age ${a}: ${esc(p.msg)}</div>`; return '';})()}
  </div>
  <div class="profile-section">
    <h4>Membership</h4>
    <div class="profile-grid">
      <div class="profile-field"><label>Plan</label><p>${esc(plan?plan.name:'—')}</p></div>
      <div class="profile-field"><label>Start Date</label><p>${formatDate(m.startDate)}</p></div>
      <div class="profile-field"><label>Expiry Date</label><p>${formatDate(m.expiryDate)}</p></div>
      <div class="profile-field"><label>Days Remaining</label><p>${daysUntil(m.expiryDate)} days</p></div>
    </div>
    ${m.notes?`<div class="profile-field" style="margin-top:10px"><label>Notes</label><p>${esc(m.notes)}</p></div>`:''}
   </div>
   <div class="profile-section">
     <h4>Entrance QR — Staff Check-In</h4>
     <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="background:#fff;padding:10px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);width:120px;height:120px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><div id="profileQrCanvas"></div></div>
       <div style="flex:1;min-width:200px">
         <p style="font-size:12px;color:var(--gray-500)">Member forgot their phone? Show this QR or check them in manually from the front desk.</p>
         <input type="text" id="profileQrToken" readonly style="width:100%;font-family:monospace;font-size:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:8px 10px;color:var(--gray-400);cursor:pointer" onclick="this.select()" placeholder="QR token">
         <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
           <button class="btn-sm btn-primary" style="height:32px" onclick="profileCheckIn('${id}')">✓ Check In</button>
           <button class="btn-sm btn-secondary" style="height:32px" onclick="copyMemberToken('${id}')">Copy Token</button>
         </div>
         <div id="profileQrStatus" style="font-size:12px;margin-top:8px;min-height:16px"></div>
       </div>
     </div>
   </div>
  <div class="profile-section">
    <h4>Background Check</h4>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <span class="badge ${bgBadgeCls}">${esc(m.bgCheckStatus||'Pending')}</span>
      ${m.bgCheckDate?`<span style="font-size:11px;color:var(--gray-500)">${formatDate(m.bgCheckDate)} · by ${esc(m.bgCheckBy||'—')}</span>`:''}
    </div>
    ${bgCheckFlagged(m)?`<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:10px 12px;color:var(--red);font-size:12px;margin-bottom:10px">⚠ Flagged — entry and activation are blocked until cleared.</div>`:''}
    ${m.bgCheckNotes?`<div class="profile-field"><label>Notes</label><p>${esc(m.bgCheckNotes)}</p></div>`:''}
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button class="btn-sm" style="background:rgba(127,250,136,.15);color:var(--green);border:1px solid rgba(127,250,136,.4)" onclick="setBgCheck('${id}','Cleared')">✓ Cleared</button>
      <button class="btn-sm" style="background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.4)" onclick="setBgCheck('${id}','Flagged')">⚑ Flagged</button>
      <button class="btn-sm btn-secondary" onclick="setBgCheck('${id}','Pending')">↺ Pending</button>
    </div>
  </div>
  ${currentUser&&currentUser.role==='admin'?`<div class="profile-section">
    <h4>Admin Actions</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm btn-primary" style="height:32px" onclick="adminResetMemberPassword('${id}')">🔑 Reset Password</button>
    </div>
  </div>`:''}
  <div class="profile-section">
    <h4>Payment History</h4>
    ${payments.length?`<table style="width:100%"><thead><tr><th>ID</th><th>Plan</th><th>Amount</th><th>Date</th><th>Method</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${esc(p.id)}</td><td>${esc(p.planName)}</td><td style="color:var(--green)">₱${Number(p.amount).toLocaleString()}</td><td>${formatDate(p.date)}</td><td>${esc(p.method)}</td></tr>`).join('')}</tbody></table>`:
    '<div class="empty-state" style="padding:20px"><div class="empty-icon">💳</div><p>No payments recorded</p></div>'}
  </div>
  <div class="profile-section">
    <h4>Session History</h4>
    ${sessions.length?`<table style="width:100%"><thead><tr><th>Date</th><th>Trainer</th><th>Type</th><th>Status</th></tr></thead><tbody>${sessions.map(s=>`<tr><td>${formatDate(s.date)}</td><td>${esc(s.trainerName)}</td><td>${esc(s.type)}</td><td><span class="badge badge-${esc(s.status.toLowerCase())}">${esc(s.status)}</span></td></tr>`).join('')}</tbody></table>`:
    '<div class="empty-state" style="padding:20px"><div class="empty-icon">📅</div><p>No sessions</p></div>'}
  </div>
  <div class="profile-section">
    <h4>Attendance History <span style="font-size:11px;font-weight:400;color:var(--gray-500);margin-left:6px">${attendance.length} visit${attendance.length!==1?'s':''} • one entry per day</span></h4>
    ${attendance.length?`<table style="width:100%"><thead><tr><th>Date</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th>Source</th><th>Recorded By</th></tr></thead><tbody>${attendance.map(a=>`<tr><td>${formatDate(a.date)}</td><td>${esc(a.checkIn||a.time||'-')}</td><td>${a.checkOut?esc(a.checkOut):'<span style="color:var(--gold)">In Gym</span>'}</td><td>${esc(a.duration||'—')}</td><td><span style="font-size:11px;padding:2px 7px;border-radius:6px;background:${a.source==='qr'?'rgba(127,250,136,.12)':'rgba(255,255,255,.06)'};border:1px solid ${a.source==='qr'?'rgba(127,250,136,.18)':'rgba(255,255,255,.1)'};color:var(--gray-300)">${a.source==='qr'?'QR Scan':'Manual'}</span></td><td>${esc(a.recordedBy||a.scannedBy||'-')}</td></tr>`).join('')}</tbody></table>`:
    '<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><p>No attendance recorded</p></div>'}
  </div>`;
  document.getElementById('profileQrToken').value=qrTokenFor(m.id,today());
  openModal('profileModal');
  const cm=document.getElementById('profileQrCanvas');
  if(cm)renderQrTo(cm,qrTokenFor(m.id,today()),4);
}
// Background check lifecycle: Pending → Cleared/Flagged. Flagged blocks
// entry, and blocks activation unless the member is already active.
function bgCheckFlagged(m){return !!m&&(m.bgCheckStatus||'Pending')==='Flagged';}
function bgCheckBlocksActivation(m){return bgCheckFlagged(m)&&!['Active','Expiring Soon'].includes(m.status);}
function setBgCheck(id,status){
  const m=Members.one(id);
  if(!m){toast('Member not found.','error');return;}
  if(!['Pending','Cleared','Flagged'].includes(status))return;
  const msg=status==='Cleared'
    ?`Mark <strong>${esc(m.name)}</strong> as <strong style="color:var(--green)">Cleared</strong>? This confirms the background check passed.`
    :status==='Flagged'
      ?`Mark <strong>${esc(m.name)}</strong> as <strong style="color:var(--red)">Flagged</strong>? This records that the background check needs review.`
      :`Reset <strong>${esc(m.name)}</strong>'s background check to <strong>Pending</strong>?`;
  openConfirm('Background Check — '+status,msg,()=>{
    const members=Members.all();
    const idx=members.findIndex(x=>x.id===id);
    if(idx<0){toast('Member not found.','error');return;}
    members[idx]={...members[idx],bgCheckStatus:status,bgCheckDate:status==='Pending'?'':today(),bgCheckBy:status==='Pending'?'':currentUser.name};
    Members.save(members);
    logActivity('Background Check','Member',m.name,'Status: '+status);
    toast('Background check marked as '+status+'.');
    viewMember(id);
  },status==='Cleared'?'Mark Cleared':status==='Flagged'?'Flag Member':'Reset to Pending',status==='Flagged'?'btn-danger':'btn-primary');
}
function openEditFromProfile(){
  if(currentUser && currentUser.role==='staff'){toast('Only admin can edit members.','error');return;}
  closeModal('profileModal');openMemberModal(currentProfileId);
}
// ── ADMIN RESET MEMBER PASSWORD ──────────────────────────────
// Generates a temporary password, sets mustChangePassword flag.
// The member is forced to set a new password on next login.
async function adminResetMemberPassword(memberId){
  const m=Members.one(memberId);
  if(!m){toast('Member not found.','error');return;}
  const authEmail=String(m.authEmail||'').trim().toLowerCase();
  if(!authEmail||authEmail.endsWith('@fitcoregym.local')){
    toast('This member has no real email on the Firebase Auth account. Reset it in Firebase Console → Authentication → Users, or create a new login with a real email.','error');
    return;
  }
  if(!(window.GMSFB&&GMSFB.enabled&&GMSFB.auth&&typeof GMSFB.auth.sendPasswordResetEmail==='function')){
    toast('Password reset needs an internet connection.','error');
    return;
  }
  try{
    await GMSFB.auth.sendPasswordResetEmail(authEmail);
    logActivity('Reset Password','Member',m.name,'ID: '+memberId+' | Firebase reset link sent to '+authEmail);
    toast('Password reset link sent to '+authEmail+'.','success');
  }catch(e){
    console.warn('[adminReset]',e&&e.code);
    toast('Could not send the reset email: '+((e&&e.message)||'unknown error'),'error');
  }
}
function openMemberProfileEdit(){
  const m=Members.one(currentUser.memberId||currentUser.id);
  if(!m){toast('Member record not found.','error');return;}
  if(m.avatar){document.getElementById('mep_avatar_preview').src=m.avatar;document.getElementById('mep_avatar_preview').style.display='block';document.getElementById('mep_avatar_clear').style.display='inline-flex';}
  else {document.getElementById('mep_avatar_preview').src='';document.getElementById('mep_avatar_preview').style.display='none';document.getElementById('mep_avatar_clear').style.display='none';}
  document.getElementById('mep_avatar').value=m.avatar||'';
  document.getElementById('mep_name').value=m.name||currentUser.name||'';
  document.getElementById('mep_contact').value=m.contact||'';
  document.getElementById('mep_address').value=m.address||'';
  const err=document.getElementById('mepError');if(err){err.textContent='';err.style.display='none';}
  openModal('memberProfileEditModal');
}
function saveMemberProfileEdit(){
  const m=Members.one(currentUser.memberId||currentUser.id);
  if(!m){toast('Member record not found.','error');return;}
  const err=document.getElementById('mepError');
  const showErr=msg=>{if(err){err.textContent=msg;err.style.display='block';}};
  if(err){err.textContent='';err.style.display='none';}
  const name=document.getElementById('mep_name').value.trim();
  const contactRaw=document.getElementById('mep_contact').value.trim();
  const address=document.getElementById('mep_address').value.trim();
  if(!name){showErr('Full name is required.');return;}
  if(!contactRaw){showErr('Contact number is required.');return;}
  if(!validatePhone(contactRaw,'+63')){showErr(phoneErrorMsg('+63'));return;}
  const contact=normalizeContact(contactRaw,'+63');
  const dup=Members.all().find(x=>x.id!==m.id&&x.status!=='Archived'&&normalizeContact(x.contact,'+63')===contact);
  if(dup){showErr('Contact number is already used by '+dup.name+' ('+dup.id+').');return;}
  let avatar=document.getElementById('mep_avatar').value;
  async function finalizeSave(a){
    const cleanName=sanitizeText(name);
    const patch={avatar:a||'',name:cleanName,contact:contact,address:sanitizeText(address)};
    try{
      if(window.GMSFB&&GMSFB.enabled){
        if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
        const res=await GMSFB.commitDocs([{col:'members',id:m.id,data:patch,merge:true}]);
        if(!res||!res.ok)throw new Error('Could not save your profile to Firebase ('+((res&&(res.error||res.reason))||'error')+').');
      }else{
        Members.update(m.id,patch);
      }
      currentUser={...currentUser,name:cleanName,contact:contact};
      setSession(currentUser);
      closeModal('memberProfileEditModal');
      refreshMemberHome();
      toast('Profile updated and saved to Firebase.','success');
    }catch(e){
      showErr((e&&e.message)||'Could not save your profile. Please try again.');
      console.error('[saveMemberProfileEdit]',e);
    }
  }
  function compressIfNeeded(data,cb){
    if(!data||data.length<=900000) return cb(data);
    const img=new Image();
    img.onload=function(){
      let w=img.width,h=img.height;
      const maxDim=900;
      if(w>maxDim||h>maxDim){
        const r=Math.min(maxDim/w,maxDim/h);
        w=Math.round(w*r);h=Math.round(h*r);
      }
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      let q=0.78;let out=canvas.toDataURL('image/jpeg',q);
      while(out.length>850000&&q>0.35){q-=0.08;out=canvas.toDataURL('image/jpeg',q);}
      toast('Photo was large — compressed for storage ('+(data.length/1024).toFixed(0)+'KB → '+(out.length/1024).toFixed(0)+'KB)','info');
      cb(out);
    };
    img.onerror=function(){cb(data);};
    img.src=data;
  }
  if(avatar&&avatar.length>900000) compressIfNeeded(avatar,finalizeSave);
  else finalizeSave(avatar);
}
function refreshMemberHome(){
  buildSidebar();
  renderTopbar();
  renderDashboard();
}
function copyMemberToken(id){
  const t=qrTokenFor(id,today());
  try{navigator.clipboard.writeText(t);toast('QR token copied to clipboard.');}
  catch(e){try{prompt('Copy the member QR token:',t);}catch(_){}}
}
function profileCheckIn(id){
  const m=Members.one(id);
  const st=document.getElementById('profileQrStatus');
  const show=(msg,ok)=>{if(st){st.innerHTML='<span style="color:'+(ok?'var(--green)':'var(--red)')+'">'+msg+'</span>';}};
  if(!m){show('Member not found',false);return;}
  if(m.status==='pending_payment'){show(m.name+' has NOT paid yet — send to the counter first.',false);return;}
  if(m.status==='Archived'){show('Account archived — entry blocked.',false);return;}
  if(bgCheckFlagged(m)){show(m.name+' has a Flagged background check — entry blocked. Clear it in the member profile first.',false);return;}
  if(daysUntil(m.expiryDate)<0){show('Plan expired on '+formatDate(m.expiryDate)+' — renew at the counter, entry blocked.',false);return;}
  const now=new Date();
  const last=Attendance.all().filter(a=>a.memberId===m.id).slice(-1)[0];
  if(last&&last.date===today()&&last.checkInTs&&(now.getTime()-last.checkInTs)<QR_SCAN_DUP_WINDOW_MIN*60000){show(m.name+' already checked in at '+last.checkIn+' — duplicate blocked.',false);return;}
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  Attendance.add({id:uid(),memberId:m.id,date:today(),time,checkIn:time,checkInTs:now.getTime(),checkOut:null,checkOutTs:null,duration:null,recordedBy:currentUser.name,scannedBy:currentUser.name,source:'staff'});
  show(m.name+' checked in at '+time+'.',true);
  toast(m.name+' checked in.');
}
let historySearch='';let memberHistoryTab='All';
function renderHistory(){
  const el=document.getElementById('panelHistory');
  const counts={All:0,Active:0,'Expiring Soon':0,Expired:0,pending_payment:0,Archived:0};
  const all=Members.all();
  const payments=Payments.all();
  const eligible=all.filter(m=>m.status!=='pending_payment'||payments.some(p=>p.memberId===m.id));
  eligible.forEach(m=>{counts.All++;if(counts[m.status]!==undefined)counts[m.status]++;});
  const tab=(st,label)=>`<button class="rtab ${memberHistoryTab===st?'active':''}" onclick="memberHistoryTab='${st}';renderHistory()">${label} <span class="user-tab-count">(${counts[st]})</span></button>`;
  el.innerHTML=`
  <div class="report-tabs">
    ${tab('All','All Members')}
    ${tab('Active','Active')}
    ${tab('Expiring Soon','Expiring Soon')}
    ${tab('Expired','Expired')}
    ${tab('pending_payment','Pending Payment')}
    ${tab('Archived','Archived')}
  </div>
  <div class="page-actions">
    <div class="table-controls">
      <input class="search-input" placeholder="Search by name or ID…" value="${esc(historySearch)}" oninput="historySearch=this.value;refreshHistoryTable()">
    </div>
    <span style="font-size:11px;color:var(--gray-500)">Permanent record of every member who availed a membership</span>
  </div>
  <div class="table-card" id="historyTableCard"></div>`;
  refreshHistoryTable();
}
function refreshHistoryTable(){
  const payments=Payments.all();
  const attendance=Attendance.all();
  const sessions=Sessions.all();
  const plans=Plans.all();
  let rows=Members.all().filter(m=>m.status!=='pending_payment'||payments.some(p=>p.memberId===m.id)).filter(m=>memberHistoryTab==='All'||m.status===memberHistoryTab).map(m=>{
    const mp=payments.filter(p=>p.memberId===m.id);
    const ma=attendance.filter(a=>a.memberId===m.id);
    const ms=sessions.filter(s=>s.memberId===m.id);
    const pl=plans.find(p=>p.id===m.planId);
    const first=[...mp.map(p=>p.date),m.startDate].filter(Boolean).sort()[0]||m.createdAt||'';
    const last=[...mp.map(p=>p.date),...ma.map(a=>a.date),m.expiryDate].filter(Boolean).sort().slice(-1)[0]||'';
    const totalPaid=mp.reduce((s,p)=>s+Number(p.amount||0),0);
    return{id:m.id,name:m.name,plan:pl?pl.name:'—',totalPaid,payCount:mp.length,attCount:ma.length,sessCount:ms.length,first,last,status:m.status};
  });
  if(historySearch){const s=historySearch.toLowerCase();rows=rows.filter(r=>r.name.toLowerCase().includes(s)||r.id.toLowerCase().includes(s));}
  rows=rows.sort((a,b)=>String(b.last).localeCompare(String(a.last)));
  const totalAll=rows.reduce((s,r)=>s+r.totalPaid,0);
  const badgeCls={Active:'badge-active',Expired:'badge-expired',Suspended:'badge-suspended','Expiring Soon':'badge-expiring','pending_payment':'badge-pending',Archived:'badge-suspended'};
  const table=document.getElementById('historyTableCard');
  if(!table)return;
  table.innerHTML=`
  <div class="table-header"><h3>${memberHistoryTab==='All'?'Member History':memberHistoryTab==='pending_payment'?'Pending Payment':memberHistoryTab}</h3><span style="font-size:11px;color:var(--gray-500)">${rows.length} member(s) · Total Paid ₱${Number(totalAll).toLocaleString()}</span></div>
  <div style="overflow-x:auto"><table style="min-width:900px"><thead><tr><th>ID</th><th>Name</th><th>Plan</th><th>Total Paid</th><th>Payments</th><th>Attendance</th><th>Sessions</th><th>First Avail</th><th>Last Avail</th><th>Status</th></tr></thead>
  <tbody>${rows.length?rows.map(r=>`<tr style="cursor:pointer" onclick="viewMember('${r.id}')">
    <td>${esc(r.id)}</td>
    <td><div style="display:flex;align-items:center;gap:8px"><div class="member-avatar" style="${r.avatar?'padding:0;overflow:hidden':''}">${r.avatar?`<img src="${r.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(r.name))}</div>${esc(r.name)}</div></td>
    <td>${esc(r.plan)}</td>
    <td style="color:var(--green);font-weight:600">₱${Number(r.totalPaid).toLocaleString()}</td>
    <td>${r.payCount}</td><td>${r.attCount}</td><td>${r.sessCount}</td>
    <td>${formatDate(r.first)}</td><td>${formatDate(r.last)}</td>
    <td><span class="badge ${badgeCls[r.status]||'badge-suspended'}">${esc(r.status)}</span></td>
  </tr>`).join(''):`<tr><td colspan="10"><div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div><p>No member history found</p></div></td></tr>`}
  </tbody></table></div>`;
}

// ======================================================================
// PANEL: BILLING
// ======================================================================
let billingSearch='';let billingFromDate='';let billingToDate='';let billingPlanFilter='All';let billingPage=1;
function renderBilling(){
  const el=document.getElementById('panelBilling');
  const plans=Plans.all();
  const planOpts=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  el.innerHTML=`
  <div class="page-actions">
    <div class="table-controls">
      <input class="search-input" placeholder="Search member…" value="${esc(billingSearch)}" oninput="billingSearch=this.value;billingPage=1;refreshBillingTable()">
      <input type="date" class="search-input" style="min-width:130px" value="${esc(billingFromDate)}" onchange="billingFromDate=this.value;billingPage=1;refreshBillingTable()">
      <input type="date" class="search-input" style="min-width:130px" value="${esc(billingToDate)}" onchange="billingToDate=this.value;billingPage=1;refreshBillingTable()">
      <select class="filter-sel" onchange="billingPlanFilter=this.value;billingPage=1;refreshBillingTable()">
        <option value="All">All Plans</option>${planOpts}
      </select>
    </div>
  </div>
  <div class="table-card" id="billingTableCard"></div>`;
  refreshBillingTable();
}
function refreshBillingTable(){
  if(window.GMSFB&&GMSFB.enabled&&(_cloudMap(KEY.payments)===null||_cloudMap(KEY.members)===null)){
    const card=document.getElementById('billingTableCard');
    if(card)card.innerHTML='<div class="empty-state" style="padding:40px"><div class="empty-icon">☁️</div><p>Loading payments from Firebase…</p></div>';
    return;
  }
  let data=Payments.all();
  if(billingSearch){const s=billingSearch.toLowerCase();data=data.filter(p=>p.memberName.toLowerCase().includes(s));}
  if(billingFromDate)data=data.filter(p=>p.date>=billingFromDate);
  if(billingToDate)data=data.filter(p=>p.date<=billingToDate);
  if(billingPlanFilter!=='All')data=data.filter(p=>p.planId===billingPlanFilter);
  data=data.slice().sort(newestPaymentFirst);
  const perPage=10;const total=data.length;const pages=Math.ceil(total/perPage)||1;
  const slice=data.slice((billingPage-1)*perPage,billingPage*perPage);
  const rows=slice.length?slice.map(p=>`<tr>
    <td>${esc(p.id)}</td><td>${esc(p.memberName)}</td><td>${esc(p.planName)}</td>
    <td style="color:var(--green);font-weight:600">₱${Number(p.amount).toLocaleString()}</td>
    <td>${formatDate(p.date)}</td><td>${formatDate(p.newExpiry)}</td>
    <td>${esc(p.recordedBy||'—')}</td><td>${esc(p.method||'—')}</td>
    <td><span class="badge badge-paid">Paid</span></td>
    <td>${p.source==='renewal'?'<span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:5px;background:rgba(251,191,36,.15);color:var(--gold);letter-spacing:.5px;border:1px solid rgba(251,191,36,.3)">🔄 RENEWAL</span>':p.syncedAt?'<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;background:rgba(170,181,255,.12);color:#d7ddd8;letter-spacing:.5px;border:1px solid rgba(170,181,255,.25)" title="Auto-synced when member info was edited">🔗 SYNCED</span>':'<span style="font-size:10px;color:var(--gray-500)">—</span>'}</td>
    <td><div class="td-actions"><button class="btn-icon" title="View Receipt" onclick="viewReceipt('${p.id}')">🧾</button>${currentUser&&currentUser.role==='admin'?`<button class="btn-icon" title="Delete Payment" onclick="deletePayment('${p.id}')" style="color:#ef4444">🗑</button>`:''}</div></td>
  </tr>`).join(''):`<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">💳</div><p>No payments found</p></div></td></tr>`;
  let pag='';if(pages>1){pag=`<div class="pagination"><button class="page-btn" onclick="billingPage=${billingPage-1};refreshBillingTable()" ${billingPage===1?'disabled':''}>‹</button>${Array.from({length:pages},(_,i)=>`<button class="page-btn ${i+1===billingPage?'active':''}" onclick="billingPage=${i+1};refreshBillingTable()">${i+1}</button>`).join('')}<button class="page-btn" onclick="billingPage=${billingPage+1};refreshBillingTable()" ${billingPage===pages?'disabled':''}>›</button><span class="page-info">${total} records</span></div>`;}
  document.getElementById('billingTableCard').innerHTML=`
    <div class="table-header"><h3>Payments <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${total} record${total!==1?'s':''}</span></h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Pay ID</th><th>Member</th><th>Plan</th><th>Amount</th><th>Date</th><th>New Expiry</th><th>Recorded By</th><th>Method</th><th>Status</th><th>Source</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${pag}`;
  setTimeout(repairMicoDuplicatePayments,0);
}
let _renewalPaymentSource=null;
function openPaymentModal(prefillMemberId=null){
  const _isFromRenewal=!!_renewalPaymentSource;_renewalPaymentSource=null;
  document.getElementById('paymentModalTitle').textContent=_isFromRenewal?'🔄 Renewal Payment':'Record Payment';
  document.getElementById('paymentFormError').style.display='none';
  document.getElementById('paymentModal').dataset.fromRenewal=_isFromRenewal?'1':'';
  document.getElementById('pf_memberSearch').value='';
  document.getElementById('pf_memberId').value='';
  document.getElementById('pf_memberList').style.display='none';
  document.getElementById('pf_amount').value='';
  document.getElementById('pf_date').value=today();
  document.getElementById('pf_method').value='';
  document.getElementById('pf_notes').value='';
  const refWrap=document.getElementById('pf_refWrap');
  if(refWrap){refWrap.style.display='none';const ref=document.getElementById('pf_reference');if(ref)ref.value='';}
  const plans=Plans.all().filter(p=>p.status==='Active');
  document.getElementById('pf_plan').innerHTML=`<option value="">Select plan</option>`+plans.map(p=>`<option value="${p.id}">${esc(p.name)} — ₱${p.price}</option>`).join('');
  if(prefillMemberId){
    const m=Members.one(prefillMemberId);
    if(m){document.getElementById('pf_memberSearch').value=m.name;document.getElementById('pf_memberId').value=m.id;if(m.planId){document.getElementById('pf_plan').value=m.planId;onPayPlanChange();}}
  }
  openModal('paymentModal');
}
function togglePfReference(){
  const method=document.getElementById('pf_method').value;
  const wrap=document.getElementById('pf_refWrap');
  if(wrap)wrap.style.display=method==='GCash'?'block':'none';
}
function openPaymentForMember(id){_renewalPaymentSource=id;openPaymentModal(id);}
function filterMemberDropdown(val){
  const list=document.getElementById('pf_memberList');
  if(!val){list.style.display='none';return;}
  const members=Members.all().filter(m=>m.status!=='Archived'&&m.name.toLowerCase().includes(val.toLowerCase())).slice(0,8);
  if(!members.length){list.style.display='none';return;}
  list.innerHTML=members.map(m=>`<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05)" onmousedown="selectPayMember('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}','${m.planId||''}')" onmouseover="this.style.background='rgba(179,188,181,.1)'" onmouseout="this.style.background=''">${esc(m.name)} <span style="color:var(--gray-500);font-size:11px">${esc(m.id)}</span></div>`).join('');
  list.style.display='block';
}
function selectPayMember(id,name,planId){
  document.getElementById('pf_memberSearch').value=name;
  document.getElementById('pf_memberId').value=id;
  document.getElementById('pf_memberList').style.display='none';
  if(planId){document.getElementById('pf_plan').value=planId;onPayPlanChange();}
}
function onPayPlanChange(){
  const planId=document.getElementById('pf_plan').value;
  if(!planId){document.getElementById('pf_amount').value='';return;}
  const plan=Plans.one(planId);
  if(plan)document.getElementById('pf_amount').value=plan.price;
}
function savePayment(){
  const memberId=document.getElementById('pf_memberId').value;
  const planId=document.getElementById('pf_plan').value;
  const amount=parseFloat(document.getElementById('pf_amount').value);
  const date=document.getElementById('pf_date').value;
  const method=document.getElementById('pf_method').value;
  const notes=document.getElementById('pf_notes').value.trim();
  const err=document.getElementById('paymentFormError');
  err.style.display='none';
  if(!memberId||!planId||!amount||!date||!method){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  if(amount<=0){err.textContent='Invalid payment amount. Please enter a valid amount greater than zero.';err.style.display='block';return;}
  const reference=document.getElementById('pf_reference')?document.getElementById('pf_reference').value.trim():'';
  if(method==='GCash'&&!reference){err.textContent='Please enter the GCash reference number.';err.style.display='block';return;}
  const member=Members.one(memberId);
  const plan=Plans.one(planId);
  if(bgCheckBlocksActivation(member)){
    err.textContent='Background check is Flagged — clear it in the member profile before activating this member.';
    err.style.display='block';
    return;
  }
  const newExpiry=addMonths(date,plan?plan.duration:1);
  const fromRenewal=document.getElementById('paymentModal').dataset.fromRenewal==='1';
  const confirmTitle=fromRenewal?'🔄 Confirm Renewal Payment':'💳 Confirm Payment';
  const memberInitials=member?member.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2):'?';
  const confirmMsg='Are you sure you want to record this payment?'
    +'<div style="margin-top:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.9">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.06)">'
    +'<div style="width:36px;height:36px;border-radius:8px;background:var(--orange);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">'+memberInitials+'</div>'
    +'<div><div style="font-weight:700;color:var(--white);font-size:13px">'+(member?esc(member.name):'Unknown')+'</div>'
    +'<div style="color:var(--gray-500);font-size:11px;font-family:monospace">'+(member?esc(member.id):'')+'</div></div>'
    +(fromRenewal?'<span style="margin-left:auto;font-size:9px;font-weight:800;padding:3px 8px;border-radius:4px;background:rgba(251,191,36,.15);color:var(--gold);text-transform:uppercase;border:1px solid rgba(251,191,36,.3)">🔄 RENEWAL</span>':'<span style="margin-left:auto;font-size:9px;font-weight:800;padding:3px 8px;border-radius:4px;background:rgba(127,250,136,.12);color:var(--green);text-transform:uppercase">NEW</span>')
    +'</div>'
    +'<div><span style="color:var(--gray-500);width:100px;display:inline-block">Plan:</span> <strong style="color:var(--white)">'+(plan?esc(plan.name):'Unknown')+'</strong></div>'
    +'<div><span style="color:var(--gray-500);width:100px;display:inline-block">Method:</span> <strong style="color:var(--white)">'+esc(method)+'</strong></div>'
    +'<div><span style="color:var(--gray-500);width:100px;display:inline-block">Amount:</span> <strong style="color:var(--green)">₱'+Number(amount).toLocaleString()+'</strong></div>'
    +'<div><span style="color:var(--gray-500);width:100px;display:inline-block">Payment Date:</span> <strong style="color:var(--white)">'+formatDate(date)+'</strong></div>'
    +'<div><span style="color:var(--gray-500);width:100px;display:inline-block">New Expiry:</span> <strong style="color:var(--white)">'+formatDate(newExpiry)+'</strong></div>'
    +'</div>'
    +'<div style="margin-top:10px;font-size:11px;color:#d7ddd8;background:rgba(179,188,181,.06);border:1px solid rgba(179,188,181,.2);border-radius:6px;padding:8px 12px">&#128161; This will record the payment and update the member expiry date.</div>';
  openConfirm(confirmTitle,confirmMsg,async function(){
    try{
      const result=await applyPaymentConfirmation(memberId,amount,method,reference,{planId,date,notes,source:fromRenewal?'renewal':'billing'});
      if(!result||!result.member){err.textContent='Member not found.';err.style.display='block';return;}
      _dismissedIds.add(memberId);
      document.getElementById('paymentModal').dataset.fromRenewal='';
      toast('Payment recorded and saved to Firebase.','success');
      closeModal('paymentModal');
      renderBilling();
      updateQueueBadge();
      scanRenewals();
      if(fromRenewal){setTimeout(function(){navigate('notifications');viewRenewalReceipt(result.payment.id);},300);}
    }catch(e){
      err.textContent=(e&&e.message)?e.message:'Could not save the payment. Please try again.';
      err.style.display='block';
      console.error(e);
    }
  },'Confirm','btn-primary');
}
async function deletePayment(id){
  if(!currentUser||currentUser.role!=='admin'){toast('Only admin can delete payment records.','error');return;}
  const p=Payments.one(id);if(!p)return;
  openConfirm('Delete Payment',`Delete payment record ${p.id} for ${esc(p.memberName)}? This cannot be undone.`,async()=>{
    try{
      if(window.GMSFB&&GMSFB.enabled){
        const res=await GMSFB.deleteDocs(KEY.payments,[id]);
        if(!res||!res.ok)throw new Error('Firebase did not confirm the delete ('+((res&&(res.error||res.reason))||'error')+').');
      }else{
        Payments.remove(id);
      }
      toast('Payment record deleted.','info');
      refreshBillingTable();
      updateQueueBadge();
    }catch(e){
      toast((e&&e.message)||'Could not delete the payment.','error');
      console.error('[deletePayment]',e);
    }
  });
}
function openEditPayment(id){
  if(!currentUser||currentUser.role!=='admin'){toast('Only admin can edit payment records.','error');return;}
  const p=Payments.one(id);if(!p)return;
  document.getElementById('editPaymentError').style.display='none';
  document.getElementById('ep_id').value=p.id;
  document.getElementById('ep_memberId').value=p.memberId;
  document.getElementById('ep_memberName').value=p.memberName;
  document.getElementById('ep_amount').value=p.amount;
  document.getElementById('ep_date').value=p.date;
  document.getElementById('ep_notes').value=p.notes||'';
  const plans=Plans.all().filter(pl=>pl.status==='Active');
  document.getElementById('ep_plan').innerHTML=`<option value="">Select plan</option>`+plans.map(pl=>`<option value="${pl.id}">${esc(pl.name)} — ₱${pl.price}</option>`).join('');
  document.getElementById('ep_plan').value=p.planId;
  document.getElementById('ep_method').value=p.method||'';
  const epRef=document.getElementById('ep_reference');
  if(epRef)epRef.value=p.reference||'';
  const epRefWrap=document.getElementById('ep_refWrap');
  if(epRefWrap)epRefWrap.style.display=(p.method||'')==='GCash'?'block':'none';
  openModal('editPaymentModal');
}
function onEditPlanChange(){
  const planId=document.getElementById('ep_plan').value;
  if(!planId)return;
  const plan=Plans.one(planId);
  if(plan)document.getElementById('ep_amount').value=plan.price;
}
async function saveEditPayment(){
  if(!currentUser||currentUser.role!=='admin'){toast('Only admin can edit payment records.','error');return;}
  const id=document.getElementById('ep_id').value;
  const memberId=document.getElementById('ep_memberId').value;
  const planId=document.getElementById('ep_plan').value;
  const amount=parseFloat(document.getElementById('ep_amount').value);
  const date=document.getElementById('ep_date').value;
  const method=document.getElementById('ep_method').value;
  const notes=document.getElementById('ep_notes').value.trim();
  const err=document.getElementById('editPaymentError');
  err.style.display='none';
  if(!planId||!amount||!date||!method){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  if(amount<=0){err.textContent='Invalid amount. The payment amount must be greater than zero.';err.style.display='block';return;}
  const reference=document.getElementById('ep_reference')?document.getElementById('ep_reference').value.trim():'';
  if(method==='GCash'&&!reference){err.textContent='Please enter the GCash reference number.';err.style.display='block';return;}
  if(window.GMSFB&&GMSFB.enabled&&!GMSFB._lastCloud.settings&&typeof GMSFB.waitForSnap==='function'){
    try{await GMSFB.waitForSnap('settings',1500);}catch(e){}
  }
  const plan=Plans.one(planId);
  const old=Payments.one(id);
  if(!old){err.textContent='Payment record not found. Please refresh and try again.';err.style.display='block';return;}
  const newExpiry=addMonths(date,plan?plan.duration:1);
  const updated={...old,planId,planName:plan?plan.name:old.planName,amount,date,newExpiry,method,reference:sanitizeText(reference),notes:sanitizeText(notes),editedBy:currentUser.username,editedAt:today()};
  const member=Members.one(memberId);
  let activation=null;
  if(member){
    const nonce=newQrNonce(memberId);
    const token='FCG.'+memberId+'.'+date.replace(/-/g,'')+'.'+qrSig(memberId,date,nonce,getQrSecret());
    activation={planId,expiryDate:newExpiry,planStart:date,status:bgCheckBlocksActivation(member)?member.status:'Active',qrNonce:nonce,qrToken:token};
  }
  try{
    if(window.GMSFB&&GMSFB.enabled){
      if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
      const ops=[{col:'payments',id,data:updated,merge:true}];
      if(activation)ops.push({col:'members',id:memberId,data:activation,merge:true});
      Notifications.all().filter(n=>n.memberId===memberId&&n.type==='pending_payment'&&n.status==='open')
        .forEach(n=>ops.push({col:'notifications',id:n.id,data:{status:'resolved',resolvedAt:new Date().toISOString()},merge:true}));
      const res=await GMSFB.commitDocs(ops);
      if(!res||!res.ok)throw new Error('Could not save to Firebase ('+((res&&(res.error||res.reason))||'error')+').');
      if(activation&&typeof GMSFB.applyLocalPatch==='function')GMSFB.applyLocalPatch(KEY.members,memberId,activation);
    }else{
      const payments=Payments.all();const idx=payments.findIndex(p=>p.id===id);
      if(idx<0)throw new Error('Payment record not found.');
      payments[idx]=updated;Payments.save(payments);
      if(activation)Members.update(memberId,activation);
    }
    resolveNotifsForMember(memberId);
    _dismissedIds.add(memberId);
    toast('Payment updated and saved to Firebase.','success');
    closeModal('editPaymentModal');renderBilling();scanRenewals();
  }catch(e){
    err.textContent=(e&&e.message)?e.message:'Could not save the payment. Please try again.';
    err.style.display='block';
    console.error('[saveEditPayment]',e);
  }
}
function viewRenewalReceipt(id){viewReceipt(id);}
function viewReceipt(id){
  const p=Payments.one(id);if(!p)return;
  // Always pull the latest member name from the members DB (reflects edits)
  const liveMember=Members.one(p.memberId);
  const displayMemberName=liveMember?liveMember.name:p.memberName;
  const users=Users.all();
  let staffDisplay=p.recordedBy||'—';
  const match=users.find(u=>
    u.username===p.recordedByUsername||
    u.username===p.recordedBy||
    u.name===p.recordedBy
  );
  if(match)staffDisplay=match.name;
  const isRenewal=p.source==='renewal';
  document.getElementById('receiptBody').innerHTML=`
  <div class="receipt">
    <div class="receipt-header">
      <div class="receipt-sticker">
        <svg width="46" height="46" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="48" rx="12" fill="url(#rcGrad)"/>
          <rect x="8" y="21" width="7" height="6" rx="2" fill="white"/>
          <rect x="33" y="21" width="7" height="6" rx="2" fill="white"/>
          <rect x="13" y="17" width="5" height="14" rx="2" fill="white"/>
          <rect x="30" y="17" width="5" height="14" rx="2" fill="white"/>
          <rect x="18" y="22" width="12" height="4" rx="2" fill="white"/>
          <defs><linearGradient id="rcGrad" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stop-color="#7ffa88"/><stop offset="100%" stop-color="#4ade80"/></linearGradient></defs>
        </svg>
      </div>
      <h2>FITCORE <span>GMS</span></h2>
      <div class="receipt-sub">Gym Management System</div>
      <div class="receipt-tag ${isRenewal?'tag-renew':'tag-paid'}">${isRenewal?'🔄 Membership Renewal Receipt':'Official Receipt'}</div>
    </div>
    <div class="receipt-meta">
      <div><span>Receipt No.</span><strong>${p.id}</strong></div>
      <div><span>Payment Date</span><strong>${formatDate(p.date)}</strong></div>
    </div>
    <div class="receipt-body">
      <div class="receipt-row"><span>Member</span><strong>${esc(displayMemberName)}</strong></div>
      <div class="receipt-row"><span>Member ID</span><strong>${esc(p.memberId)}</strong></div>
      <div class="receipt-row"><span>Membership Plan</span><strong>${esc(p.planName)}</strong></div>
      <div class="receipt-row"><span>Payment Method</span><strong>${esc(p.method)}</strong></div>
      <div class="receipt-row"><span>New Expiry Date</span><strong>${formatDate(p.newExpiry)}</strong></div>
    </div>
    <div class="receipt-total">
      <span>Amount Paid</span>
      <strong>&#8369;${Number(p.amount).toLocaleString()}</strong>
    </div>
    <div class="receipt-foot">
      <div class="receipt-footer-note">Recorded by <strong>${esc(staffDisplay)}</strong> &middot; ${formatDateTime(p.createdAt)}</div>
      <div class="receipt-barcode" aria-hidden="true"></div>
      <div class="receipt-thanks">Train hard &middot; Stay strong &middot; See you at FitCore</div>
    </div>
  </div>`;
  openModal('receiptModal');
}

// ======================================================================
// PANEL: SCHEDULE
// ======================================================================
let schedView='month';let schedTrainerFilter='all';let schedMemberSearch='';
// Month calendar state
let calYear=new Date().getFullYear();let calMonth=new Date().getMonth();
function renderSchedule(){
  const el=document.getElementById('panelSchedule');
  const users=Users.all().filter(u=>u.role==='trainer');
  const canCreate=currentUser.role==='staff'||currentUser.role==='admin';
  const isTrainer=currentUser.role==='trainer';
  if(isTrainer)schedTrainerFilter=currentUser.id;
  // Deduplicate trainers by ID
  const uniqueTrainers=users.filter((u,i,a)=>a.findIndex(x=>x.id===u.id)===i);
  const trainerOpts=(isTrainer
    ? `<option value="${currentUser.id}" selected>My Schedule</option>`
    : `<option value="all" ${schedTrainerFilter==='all'?'selected':''}>All Trainers</option>`
      + uniqueTrainers.map(u=>`<option value="${u.id}" ${schedTrainerFilter===u.id?'selected':''}>${esc(u.name)}</option>`).join('')
  );
  const filterLabel=isTrainer?'<span style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px;align-self:center">View:</span>':'';
  el.innerHTML=`
  ${isTrainer?renderTrainerProfile():''}
  <div class="sched-controls">
    <div class="view-toggle">
      <button class="vt-btn ${schedView==='month'?'active':''}" onclick="schedView='month';renderSchedule()">📅 Month</button>
      <button class="vt-btn ${schedView==='week'?'active':''}" onclick="schedView='week';renderSchedule()">🗓 Week</button>
      <button class="vt-btn ${schedView==='list'?'active':''}" onclick="schedView='list';renderSchedule()">📋 List</button>
    </div>
    ${filterLabel}
    <select class="filter-sel" onchange="schedTrainerFilter=this.value;renderSchedule()">
      ${trainerOpts}
    </select>
    <input class="search-input" placeholder="Search member name…" value="${esc(schedMemberSearch)}" oninput="schedMemberSearch=this.value;if(schedView==='list'){renderListView();}" style="min-width:180px">
    ${canCreate?`<button class="btn-primary" style="margin-left:auto" onclick="openSessionModal()">+ Create Session</button>`:''}
  </div>
  <div id="schedContent"></div>`;
  if(schedView==='month')renderMonthView();else if(schedView==='week')renderWeekView();else renderListView();
  updateSchedPendingBadge();
}
function renderTrainerProfile(){
  const u=currentUser;
  const sessions=Sessions.all().filter(s=>s.trainerId===u.id);
  const scheduled=sessions.filter(s=>s.status==='Scheduled').length;
  const completed=sessions.filter(s=>s.status==='Completed').length;
  const cancelled=sessions.filter(s=>s.status==='Cancelled').length;
  const todaySessions=sessions.filter(s=>s.date===today()&&s.status==='Scheduled').length;
  const ini=u.avatar?`<img src="${u.avatar}" class="trainer-avatar-lg" style="background-size:cover;background-position:center;background-repeat:no-repeat">`:u.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  const specs=trainerSpecList(u);
  const days=Array.isArray(u.availableDays)&&u.availableDays.length?u.availableDays:[];
  const hours=(u.availableFrom&&u.availableTo)?`${u.availableFrom} – ${u.availableTo}`:'';
  const displayName=u.coachName||u.name;
  return`<div class="trainer-profile-card">
    ${u.avatar?`<div class="trainer-avatar-lg" style="position:relative;overflow:hidden"><img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:18px;position:absolute;inset:0" onerror="this.remove()"><span style="position:relative;z-index:1">${ini}</span></div>`:`<div class="trainer-avatar-lg">${ini}</div>`}
    <div class="trainer-profile-info" style="flex:1">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
        <div class="trainer-profile-name" style="margin-bottom:0">${esc(displayName)}</div>
        ${u.coachName&&u.coachName!==u.name?`<div style="font-size:12px;color:var(--gray-500)">(${esc(u.name)})</div>`:''}
        <button onclick="openTrainerEditModal()" style="background:rgba(179,188,181,.12);border:1px solid rgba(179,188,181,.3);color:var(--orange);border-radius:7px;padding:5px 13px;font-size:11px;font-weight:700;cursor:pointer;transition:.2s;letter-spacing:.5px;text-transform:uppercase" onmouseover="this.style.background='var(--orange)';this.style.color='#fff'" onmouseout="this.style.background='rgba(179,188,181,.12)';this.style.color='var(--orange)'">&#9998; Edit Profile</button>
      </div>
      <span class="trainer-profile-role">&#9679; Certified Trainer &middot; @${esc(u.username)}</span>
      ${specs.length?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 4px">${specs.map(s=>`<span style="background:rgba(179,188,181,.1);border:1px solid rgba(179,188,181,.22);color:var(--orange);border-radius:5px;padding:3px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${esc(s)}</span>`).join('')}</div>`:''}
      ${days.length||hours?`<div style="font-size:11px;color:var(--gray-500);margin-bottom:8px">&#9200; ${days.map(esc).join(', ')}${hours?' &middot; '+esc(hours):''}</div>`:''}
      ${u.bio?`<div style="font-size:12px;color:var(--gray-300);font-style:italic;margin-bottom:10px;line-height:1.5">&ldquo;${esc(u.bio)}&rdquo;</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <span class="trainer-session-badge tsb-scheduled">&#128336; ${scheduled} Scheduled</span>
        <span class="trainer-session-badge tsb-completed">&#10003; ${completed} Completed</span>
        ${cancelled?`<span class="trainer-session-badge tsb-cancelled">&#10005; ${cancelled} Cancelled</span>`:''}
      </div>
      <div class="trainer-profile-stats">
        <div class="tp-stat"><div class="tp-stat-num">${sessions.length}</div><div class="tp-stat-label">Total Sessions</div></div>
        <div class="tp-stat"><div class="tp-stat-num">${todaySessions}</div><div class="tp-stat-label">Today</div></div>
        <div class="tp-stat"><div class="tp-stat-num">${completed}</div><div class="tp-stat-label">Done</div></div>
        <div class="tp-stat"><div class="tp-stat-num">${completed&&sessions.length?Math.round(completed/sessions.length*100):0}%</div><div class="tp-stat-label">Completion</div></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;min-width:140px">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:4px">Account Info</div>
      <div style="font-size:12px;color:var(--gray-300)">&#128222; ${esc(u.contact||'&mdash;')}</div>
      <div style="font-size:12px;color:var(--gray-500);font-family:monospace">@${esc(u.username)}</div>
      <div style="margin-top:8px"><span class="badge badge-trainer">&#9679; Active</span></div>
    </div>
  </div>`;
}
function openTrainerEditModal(){
  const u=currentUser;
  const tepPreview=document.getElementById('tep_avatar_preview');
  const tepClear=document.getElementById('tep_avatar_clear');
  document.getElementById('tep_avatar').value=u.avatar||'';
  if(u.avatar){
    tepPreview.src=u.avatar;tepPreview.style.display='block';
    if(tepClear)tepClear.style.display='inline-flex';
  } else {
    tepPreview.src='';tepPreview.style.display='none';
    if(tepClear)tepClear.style.display='none';
  }
  document.getElementById('tep_fullname').value=u.name||'';
  document.getElementById('tep_coachname').value=u.coachName||'';
  document.getElementById('tep_bio').value=u.bio||'';
  document.querySelectorAll('#tep_specs input[type=checkbox]').forEach(cb=>{
    cb.checked=trainerSpecList(u).includes(cb.value);
  });
  document.querySelectorAll('#tep_days input[type=checkbox]').forEach(cb=>{
    cb.checked=Array.isArray(u.availableDays)&&u.availableDays.includes(cb.value);
  });
  document.getElementById('tep_from').value=u.availableFrom||'';
  document.getElementById('tep_to').value=u.availableTo||'';
  document.getElementById('tepError').style.display='none';
  openModal('trainerEditProfileModal');
}
async function saveTrainerProfile(){
  const fullname=document.getElementById('tep_fullname').value.trim();
  const coachname=document.getElementById('tep_coachname').value.trim();
  const avatar=document.getElementById('tep_avatar').value;
  const bio=document.getElementById('tep_bio').value.trim();
  const specs=[...document.querySelectorAll('#tep_specs input[type=checkbox]:checked')].map(c=>c.value);
  const days=[...document.querySelectorAll('#tep_days input[type=checkbox]:checked')].map(c=>c.value);
  const from=document.getElementById('tep_from').value;
  const to=document.getElementById('tep_to').value;
  const errEl=document.getElementById('tepError');
  errEl.style.display='none';
  if(!fullname){errEl.textContent='Full name is required.';errEl.style.display='block';return;}
  const patch={name:fullname,coachName:coachname||fullname,bio:bio,specializations:specs,availableDays:days,availableFrom:from,availableTo:to,avatar:avatar||''};
  try{
    if(window.GMSFB&&GMSFB.enabled){
      if(!GMSFB.auth||!GMSFB.auth.currentUser)throw new Error('Firebase session expired — please log in again.');
      const res=await GMSFB.commitDocs([{col:'users',id:currentUser.id,data:patch,merge:true}]);
      if(!res||!res.ok)throw new Error('Could not save profile to Firebase ('+((res&&(res.error||res.reason))||'error')+').');
    }else{
      const users=Users.all();
      const idx=users.findIndex(x=>x.id===currentUser.id);
      if(idx<0)throw new Error('User not found.');
      Object.assign(users[idx],patch);
      Users.save(users);
    }
  }catch(e){
    errEl.textContent=(e&&e.message)||'Could not save profile. Please try again.';
    errEl.style.display='block';
    console.warn('[saveTrainerProfile]',e);
    return;
  }
  currentUser={...currentUser,...patch};
  setSession(currentUser);
  const sn=document.getElementById('sideUserName');
  if(sn)sn.textContent=fullname;
  setUserAvatar(document.getElementById('sideUserAvatar'),fullname,avatar||'');
  setUserAvatar(document.getElementById('topAvatar'),fullname,avatar||'');
  closeModal('trainerEditProfileModal');
  toast('Profile updated successfully!','success');
  renderSchedule();
}
function updateSepAvatar(name){
  const av=document.getElementById('sep_avatar_initials');
  const img=document.getElementById('sep_avatar_preview');
  const hidden=document.getElementById('sep_avatar').value;
  const clear=document.getElementById('sep_avatar_clear');
  const uname=name||currentUser.name;
  if(hidden&&hidden.length>20){
    // One preview only: hide the initials tile when a photo is present.
    if(av){av.style.display='none';av.style.backgroundImage='';av.textContent='';av.onclick=null;}
    if(img){img.src=hidden;img.style.display='block';img.style.cursor='zoom-in';img.title='Click to zoom';img.onclick=function(){openAvatarZoom(hidden,uname);};}
    if(clear)clear.style.display='inline-flex';
  } else {
    if(av){av.style.display='';av.style.backgroundImage='';av.textContent=initials(uname);av.className='user-avatar avatar-'+(currentUser&&currentUser.role==='admin'?'admin':'staff');av.style.cursor='default';av.onclick=null;}
    if(img){img.style.display='none';img.onclick=null;}
    if(clear)clear.style.display='none';
  }
  const dn=document.getElementById('sep_display_name');
  if(dn)dn.textContent=uname;
}
function updateUfAvatar(name){
  const hidden=document.getElementById('uf_avatar');
  const prev=document.getElementById('uf_avatar_preview');
  const init=document.getElementById('uf_avatar_initials');
  const clear=document.getElementById('uf_avatar_clear');
  if(!hidden||!prev||!init)return;
  const data=hidden.value||'';
  const nm=name||((document.getElementById('uf_name')||{}).value||'Trainer');
  if(data){
    // One preview only: hide the initials tile when a photo is present.
    prev.src=data;
    prev.style.display='block';
    prev.style.cursor='zoom-in';
    prev.title='Click to zoom';
    prev.onclick=function(){openAvatarZoom(data,nm);};
    init.style.display='none';
    init.style.backgroundImage='';
    init.textContent='';
    if(clear)clear.style.display='inline-flex';
  } else {
    prev.src='';
    prev.style.display='none';
    prev.onclick=null;
    init.style.display='';
    init.style.backgroundImage='';
    init.textContent=initials(nm);
    if(clear)clear.style.display='none';
  }
}
function openStaffEditModal(){
  if(!currentUser)return;
  if(currentUser.role==='member'){openMemberProfileEdit();return;}
  if(currentUser.role==='trainer'){openTrainerEditModal();return;}
  const u={...currentUser};
  document.getElementById('sep_avatar').value=u.avatar||'';
  updateSepAvatar(u.name);
  document.getElementById('sep_name').value=u.name||'';
  document.getElementById('sep_contact').value=u.contact||'';
  document.getElementById('sep_display_name').textContent=u.name;
  document.getElementById('sep_display_username').textContent='@'+u.username;
  const badge=document.getElementById('sep_role_badge');
  if(badge){badge.textContent=u.role==='admin'?'Admin':'Staff';badge.style.background=u.role==='admin'?'rgba(179,188,181,.22)':'rgba(127,250,136,.18)';badge.style.color=u.role==='admin'?'var(--orange)':'#d7ddd8';}
  document.getElementById('sepError').style.display='none';
  openModal('staffEditProfileModal');
}
async function saveStaffProfile(){
  const name=document.getElementById('sep_name').value.trim();
  const contact=document.getElementById('sep_contact').value.trim();
  let avatar=document.getElementById('sep_avatar').value;
  const errEl=document.getElementById('sepError');
  errEl.style.display='none';
  if(!name){errEl.textContent='Full name is required.';errEl.style.display='block';return;}
  const saveBtn=document.querySelector('#staffEditProfileModal .btn-primary');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Saving...';}
  // compress large avatars to avoid Firestore 1MB limit
  if(avatar&&avatar.length>650000){
    toast('Compressing image...','info');
    try{ avatar=await compressDataUrl(avatar,700,650000); document.getElementById('sep_avatar').value=avatar; }catch(e){}
  }
  if(avatar&&avatar.length>900000){
    errEl.textContent='Image still too large after compression. Try a smaller photo (under 5MB).';errEl.style.display='block';
    if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='✓ Save Changes';}
    return;
  }
  const users=Users.all();
  const idx=users.findIndex(x=>x.id===currentUser.id);
  if(idx<0){errEl.textContent='User not found.';errEl.style.display='block'; if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='✓ Save Changes';} return;}
  users[idx].name=name;
  users[idx].contact=contact;
  users[idx].avatar=avatar||'';
  Users.save(users);
  currentUser={...currentUser,name,contact,avatar:avatar||''};
  setSession(currentUser);
  const sn=document.getElementById('sideUserName');
  if(sn)sn.textContent=name;
  if(currentUser.role==='admin'||currentUser.role==='staff'){
    const sideAv=document.getElementById('sideUserAvatar');
    if(sideAv){sideAv.className='user-avatar avatar-'+currentUser.role; setUserAvatar(sideAv,name,avatar||''); sideAv.style.cursor=avatar?'zoom-in':'default'; sideAv.title=avatar?'Click to view photo':''; sideAv.onclick=avatar?function(){openAvatarZoom(avatar,name);}:null;}
    const topAv=document.getElementById('topAvatar');
    if(topAv){topAv.className='user-avatar avatar-'+currentUser.role; setUserAvatar(topAv,name,avatar||'');}
  } else {
    setUserAvatar(document.getElementById('sideUserAvatar'),name,avatar||'');
    setUserAvatar(document.getElementById('topAvatar'),name,avatar||'');
  }
  // wait for cloud sync so photo persists on other devices
  if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
    try{
      const res=await GMSFB.pushCollection(KEY.users, Users.all());
      if(res&&res.ok===false){
        toast('Saved locally but cloud sync failed — photo may not appear on other devices until online.','error');
      } else {
        // tiny delay for snapshot to propagate
        await new Promise(r=>setTimeout(r,350));
      }
    }catch(e){ console.warn('[saveStaffProfile] sync',e); toast('Saved locally. Cloud sync will retry when online.','info'); }
  }
  closeModal('staffEditProfileModal');
  toast('Profile updated successfully!','success');
  if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='✓ Save Changes';}
  buildSidebar(); renderTopbar();
}
function getSchedSessions(){
  let s=Sessions.all();
  if(schedTrainerFilter!=='all')s=s.filter(x=>x.trainerId===schedTrainerFilter);
  return s;
}

function viewSession(id){
  const sessions=Sessions.all();
  const s=sessions.find(x=>x.id===id);
  if(!s)return;
  const statusColor=s.status==='Completed'?'#7ffa88':s.status==='Cancelled'?'#ef4444':'#fbbf24';
  const statusIcon=s.status==='Completed'?'✓ Completed':s.status==='Cancelled'?'✕ Cancelled':'● Scheduled';
  const statusBg=s.status==='Completed'?'rgba(127,250,136,.12)':s.status==='Cancelled'?'rgba(239,68,68,.12)':'rgba(251,191,36,.12)';
  const isMySession=currentUser.role==='trainer'&&s.trainerId===currentUser.id;
  const body=document.getElementById('sessionInfoBody');
  body.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:4px">Session Type</div>
          <div style="font-size:18px;font-weight:800;color:var(--white)">${esc(s.type||'—')}</div>
        </div>
        <div style="background:${statusBg};border:1px solid ${statusColor}44;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:800;color:${statusColor};letter-spacing:.5px;text-transform:uppercase">${statusIcon}</div>
      </div>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,.06)">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:var(--navy-700);border-radius:8px;padding:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:6px">👤 Member</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${esc(s.memberName||'—')}</div>
        </div>
        <div style="background:var(--navy-700);border-radius:8px;padding:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:6px">🏋️ Trainer</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${esc(s.trainerName||'—')}</div>
        </div>
        <div style="background:var(--navy-700);border-radius:8px;padding:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:6px">📅 Date</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${formatDate(s.date)}</div>
        </div>
        <div style="background:var(--navy-700);border-radius:8px;padding:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:6px">🕐 Time</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${esc(s.start)} – ${esc(s.end)}</div>
        </div>
      </div>
      ${s.notes?`<div style="background:var(--navy-700);border-radius:8px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:6px">📝 Notes</div><div style="font-size:13px;color:var(--gray-100);line-height:1.6">${esc(s.notes)}</div></div>`:''}
      <div style="background:var(--navy-700);border-radius:8px;padding:14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:8px">🕓 History</div>
        <div style="font-size:12px;color:var(--gray-300)">Created by <strong style="color:var(--gray-100)">${esc(s.createdBy||'—')}</strong>${s.createdAt?' on '+formatDate(s.createdAt):''}</div>
        ${s.editedBy?`<div style="font-size:12px;color:var(--gray-300);margin-top:4px">Last edited by <strong style="color:var(--gray-100)">${esc(s.editedBy)}</strong>${s.editedAt?' on '+formatDate(s.editedAt):''}</div>`:''}
        ${(currentUser.role==='admin'||currentUser.role==='staff')&&s.statusLog&&s.statusLog.length?`
        <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.06);padding-top:12px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray-500);margin-bottom:8px">🔄 Status Changes by Trainer</div>
          ${s.statusLog.map(log=>{
            const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
            const clr=roleColorMap[log.byRole]||'var(--gray-300)';
            const fromClr=log.from==='Completed'?'#7ffa88':log.from==='Cancelled'?'#ef4444':'#fbbf24';
            const toClr=log.to==='Completed'?'#7ffa88':log.to==='Cancelled'?'#ef4444':'#fbbf24';
            const timeStr=log.at?new Date(log.at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
            return`<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;background:rgba(255,255,255,.03);border-radius:6px;padding:8px 10px">
              <div style="flex:1">
                <div style="font-size:12px;color:var(--gray-100);font-weight:600">${esc(log.by||'—')} <span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:${clr};margin-left:2px;text-transform:uppercase">${esc(log.byRole||'')}</span></div>
                <div style="font-size:11px;color:var(--gray-500);margin-top:2px">${timeStr}</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700">
                <span style="color:${fromClr};background:rgba(255,255,255,.05);padding:2px 8px;border-radius:4px">${log.from}</span>
                <span style="color:var(--gray-500)">→</span>
                <span style="color:${toClr};background:rgba(255,255,255,.05);padding:2px 8px;border-radius:4px">${log.to}</span>
              </div>
            </div>`;
          }).join('')}
        </div>`:''}
      </div>
    </div>`;
  const foot=document.getElementById('sessionInfoFoot');
  if(isMySession&&s.status==='Scheduled'){
    foot.innerHTML=`<button class="btn-secondary" onclick="closeModal('sessionInfoModal')">Close</button>
      <button class="btn-primary" style="background:#7ffa88;border-color:#7ffa88" onclick="closeModal('sessionInfoModal');confirmCompleteSession('${id}')">✓ Mark as Done</button>
      <button class="btn-danger" onclick="closeModal('sessionInfoModal');confirmCancelSession('${id}')">✕ Cancel Session</button>`;
  } else {
    foot.innerHTML=`<button class="btn-secondary" onclick="closeModal('sessionInfoModal')">Close</button>`;
    if((currentUser.role==='admin'||currentUser.role==='staff')&&s.status!=='Cancelled'){
      foot.innerHTML=`<button class="btn-secondary" onclick="closeModal('sessionInfoModal')">Close</button>
        <button class="btn-primary" onclick="closeModal('sessionInfoModal');editSession('${id}')">✏️ Edit</button>`;
    }
  }
  openModal('sessionInfoModal');
}

function calNav(delta){
  calMonth+=delta;
  if(calMonth<0){calMonth=11;calYear--;}
  if(calMonth>11){calMonth=0;calYear++;}
  renderMonthView();
}
function calToday(){const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();renderMonthView();}
function renderMonthView(){
  const sessions=getSchedSessions();
  const canCreate=currentUser.role==='staff'||currentUser.role==='admin';
  const selTrainer=schedTrainerFilter!=='all'?Users.all().find(u=>u.id===schedTrainerFilter):null;
  const avDays=selTrainer&&Array.isArray(selTrainer.availableDays)?selTrainer.availableDays:[];
  const avFrom=selTrainer&&selTrainer.availableFrom?parseTimeToMin(selTrainer.availableFrom):null;
  const avTo=selTrainer&&selTrainer.availableTo?parseTimeToMin(selTrainer.availableTo):null;
  const hasAv=avFrom!=null&&avTo!=null&&avTo>avFrom;
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const first=new Date(calYear,calMonth,1);
  const startDow=first.getDay(); // 0=Sun
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const prevDays=new Date(calYear,calMonth,0).getDate();
  const tToday=today();
  const cells=[];
  // Leading days from previous month (dimmed, non-clickable)
  for(let i=0;i<startDow;i++)cells.push({day:prevDays-startDow+1+i,other:true,ds:''});
  for(let i=1;i<=daysInMonth;i++){
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    cells.push({day:i,other:false,ds});
  }
  const totalCells=Math.ceil(cells.length/7)*7;
  while(cells.length<totalCells)cells.push({day:cells.length-daysInMonth-startDow+1,other:true,ds:''});
  const daySessMap={};
  sessions.forEach(s=>{if(s.date){(daySessMap[s.date]=daySessMap[s.date]||[]).push(s);}});
  const header=Array.from({length:7},(_,i)=>`<div class="cal-dow">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}</div>`).join('');
  const cellHtml=cells.map(c=>{
    if(c.other||!c.ds)return `<div class="cal-cell other-month"><span class="cal-day-num">${c.day||''}</span></div>`;
    const isToday=c.ds===tToday;
    const isPast=c.ds<tToday;
    const dayAbbr=dateToDayAbbr(c.ds);
    const offDay=avDays.length&&dayAbbr&&!avDays.includes(dayAbbr);
    const daySessions=daySessMap[c.ds]||[];
    const activeSessions=daySessions.filter(s=>s.status!=='Cancelled');
    let cls='cal-cell';
    if(isToday)cls+=' today';
    if(isPast)cls+=' past';
    if(offDay)cls+=' off';
    // Click: admin/staff can create on available non-past days; any view of days with sessions shows count
    let click='';
    if(canCreate&&!isPast&&!offDay)click=`onclick="openSessionModal('${c.ds}')"`;
    else if(daySessions.length)click=`onclick="schedView='list';schedMemberSearch='';renderSchedule()" title="View sessions"`;
    const dots=daySessions.slice(0,4).map(s=>{
      const col=s.status==='Completed'?'#7ffa88':s.status==='Cancelled'?'#ef4444':(s.status==='Pending'||s.status==='Declined')?'#fbbf24':'#7ffa88';
      return `<span class="cal-dot" style="background:${col}"></span>`;
    }).join('');
    const count=activeSessions.length?`<span class="cal-count">${activeSessions.length}</span>`:'';
    const availMark=offDay?'<span class="cal-off-mark" title="Trainer unavailable">✕</span>':'';
    return`<div class="${cls}" ${click}>
      <span class="cal-day-num">${c.day}</span>${availMark}${count}
      <div class="cal-dots">${dots}</div>
    </div>`;}).join('');
  const availLegend=selTrainer&&avDays.length
    ? `<div class="sf-avail-hint" style="margin-top:10px">⏰ <strong>${esc(selTrainer.coachName||selTrainer.name)}</strong> available: ${esc(avDays.join(', '))}${hasAv?' · '+esc(selTrainer.availableFrom)+' – '+esc(selTrainer.availableTo):''} — days marked ✕ cannot be scheduled</div>`
    : (selTrainer?'':'<div class="sf-avail-hint" style="margin-top:10px;opacity:.75">Select a specific trainer above to see their available days</div>');
  document.getElementById('schedContent').innerHTML=`
  <div class="cal-grid-wrap">
    <div class="cal-nav">
      <button class="btn-secondary btn-sm" onclick="calNav(-1)">‹ Prev</button>
      <div class="cal-title">${monthNames[calMonth]} ${calYear}</div>
      <button class="btn-secondary btn-sm" onclick="calToday()">Today</button>
      <button class="btn-secondary btn-sm" onclick="calNav(1)">Next ›</button>
    </div>
    <div class="cal-grid">${header}${cellHtml}</div>
  </div>
  ${availLegend}
  <div class="cal-legend">
    <span><i class="cal-dot" style="background:#7ffa88"></i> Scheduled</span>
    <span><i class="cal-dot" style="background:#fbbf24"></i> Pending</span>
    <span><i class="cal-dot" style="background:#ef4444"></i> Cancelled</span>
    <span><i class="cal-dot" style="background:#b3bcb5"></i> Completed</span>
    ${canCreate?'<span style="color:var(--green)">+ Click an available day to create</span>':''}
  </div>`;
}
function renderWeekView(){
  const sessions=getSchedSessions();
  const mon=getMondayOf(today());
  const days=[];for(let i=0;i<7;i++)days.push(addDays(mon,i));
  const times=[];for(let h=6;h<=21;h++)times.push(`${h.toString().padStart(2,'0')}:00`);
  const colors={'u3':'#b3bcb5','u2':'#b3bcb5'};function getColor(tid){return colors[tid]||'#7ffa88';}
  // Selected trainer's availability (for dimming off-hours + off-days)
  const selTrainer=schedTrainerFilter!=='all'?Users.all().find(u=>u.id===schedTrainerFilter):null;
  const avFrom=selTrainer&&selTrainer.availableFrom?parseTimeToMin(selTrainer.availableFrom):null;
  const avTo=selTrainer&&selTrainer.availableTo?parseTimeToMin(selTrainer.availableTo):null;
  const avDays=selTrainer&&Array.isArray(selTrainer.availableDays)?selTrainer.availableDays:[];
  const hasAv=avFrom!=null&&avTo!=null&&avTo>avFrom;
  const canCreate=currentUser.role==='staff'||currentUser.role==='admin';
  const dayHeaders=days.map(d=>{const dd=new Date(d);return`<div class="wh-cell">${dd.toLocaleString('en-US',{weekday:'short'})}<br><span style="font-size:13px;font-weight:700;color:${d===today()?'var(--orange)':'inherit'}">${dd.getDate()}</span></div>`;}).join('');
  const timeSlots=times.map(t=>`<div class="time-slot">${t}</div>`).join('');
  const dayCols=days.map(d=>{
    const dayAbbr=dateToDayAbbr(d);
    const offDay=avDays.length&&dayAbbr&&!avDays.includes(dayAbbr);
    const daySessions=sessions.filter(s=>s.date===d);
    // Availability band: green strip covering availableFrom–availableTo
    let band='';
    if(hasAv&&times.length){
      const firstH=6,lastH=21;
      const bandTop=Math.max(0,((Math.max(avFrom,firstH*60)-firstH*60)/60)*48);
      const bandBot=Math.min(times.length*48,((Math.min(avTo,lastH*60+60)-firstH*60)/60)*48);
      if(bandBot>bandTop)band=`<div class="cal-band" style="top:${bandTop}px;height:${bandBot-bandTop}px" title="Available ${esc(selTrainer.availableFrom)}–${esc(selTrainer.availableTo)}"></div>`;
    }
    const blocks=daySessions.map(s=>{
      const sh=parseInt(s.start.split(':')[0]);const sm=parseInt(s.start.split(':')[1]||0);
      const eh=parseInt(s.end.split(':')[0]);const em=parseInt(s.end.split(':')[1]||0);
      const top=((sh-6)*60+sm)/15*12;
      const height=((eh-sh)*60+(em-sm))/15*12;
      const clr=getColor(s.trainerId);
      const isMyBlock=currentUser.role==='trainer'&&s.trainerId===currentUser.id;
      const isOtherTrainer=currentUser.role==='trainer'&&s.trainerId!==currentUser.id;
      const clickAttr=isMyBlock?`onclick="viewSession('${s.id}')"`:(!isOtherTrainer?`onclick="viewSession('${s.id}')"`:'' );
      const blockCursor=isOtherTrainer?'default':(currentUser.role==='trainer'?'pointer':'pointer');
      const blockOpacity=isOtherTrainer?'0.45':'1';
      const statusColor=s.status==='Completed'?'#7ffa88':s.status==='Cancelled'?'#ef4444':'#fbbf24';
      const statusIcon=s.status==='Completed'?'✓ Done':s.status==='Cancelled'?'✕ Cancelled':'● Scheduled';
      const statusBg=s.status==='Completed'?'rgba(127,250,136,0.15)':s.status==='Cancelled'?'rgba(239,68,68,0.15)':'rgba(251,191,36,0.12)';
      const borderClr=s.status==='Completed'?'#7ffa88':s.status==='Cancelled'?'#ef4444':clr;
      const blockBg=s.status==='Completed'?'rgba(127,250,136,0.08)':s.status==='Cancelled'?'rgba(239,68,68,0.08)':`${clr}20`;
      const myTag=isMyBlock?`<div style="font-size:7px;font-weight:900;color:var(--green);letter-spacing:.5px;text-transform:uppercase;margin-bottom:1px">● MINE</div>`:'';
      return`<div class="session-block" style="top:${top}px;height:${Math.max(height,48)}px;background:${blockBg};border-left:3px solid ${borderClr};position:absolute;left:2px;right:2px;border-radius:4px;padding:4px 6px;overflow:hidden;cursor:${blockCursor};opacity:${blockOpacity}" ${clickAttr}>
        ${myTag}
        <div style="font-size:10px;font-weight:700;color:${clr}">${s.start}</div>
        <div style="font-size:10px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#fff">${esc(s.memberName||'')}</div>
        <div style="font-size:9px;color:var(--gray-500)">${esc(s.trainerName||'')} · ${esc(s.type||'')}</div>
        <div style="margin-top:3px;display:inline-flex;align-items:center;gap:3px;background:${statusBg};border:1px solid ${statusColor}33;border-radius:3px;padding:1px 5px">
          <span style="font-size:8px;font-weight:800;color:${statusColor};letter-spacing:.5px;text-transform:uppercase">${statusIcon}</span>
        </div>
      </div>`;}).join('');
    // Block "+ Add Session" on unavailable days / past days / non-creators
    const isPast=d<today();
    const clickable=canCreate&&!offDay&&!isPast;
    const clickAttr=clickable?`onclick="openSessionModal('${d}')"`:`onclick="event.stopPropagation()"`;
    const offClass=offDay?' off-day':'';
    const title=offDay&&selTrainer?`title="${esc(selTrainer.coachName||selTrainer.name)} not available on ${dayAbbr}"`:'';
    return`<div class="day-col${d===today()?' today':''}${offClass}" ${title} ${clickAttr}>${band}${blocks}</div>`;}).join('');
  document.getElementById('schedContent').innerHTML=`
  <div class="week-grid">
    <div class="week-header"><div class="wh-cell">Time</div>${dayHeaders}</div>
    <div class="week-body"><div class="time-col">${timeSlots}</div>${dayCols}</div>
  </div>
  ${selTrainer&&avDays.length?`<div class="sf-avail-hint" style="margin-top:-12px">⏰ <strong>${esc(selTrainer.coachName||selTrainer.name)}</strong> available: ${esc(avDays.join(', '))}${hasAv?' · '+esc(selTrainer.availableFrom)+' – '+esc(selTrainer.availableTo):''}</div>`:''}`;
}
function renderListView(){
  let sessions=getSchedSessions().sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  if(schedMemberSearch){const s=schedMemberSearch.toLowerCase();sessions=sessions.filter(x=>(x.memberName||'').toLowerCase().includes(s));}
  const allUsers=Users.all();
  const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
  const rows=sessions.length?sessions.map(s=>{
    const statusCls={'Scheduled':'badge-scheduled','Completed':'badge-completed','Cancelled':'badge-cancelled','Pending':'badge-pending','Declined':'badge-cancelled','Accepted':'badge-scheduled'}[s.status]||'';
    const createdByUser=s.createdBy?allUsers.find(u=>u.name===s.createdBy||u.username===s.createdByUsername):null;
    const roleColor=createdByUser?roleColorMap[createdByUser.role]||'var(--gray-300)':'var(--gray-300)';
    const roleTag=createdByUser?`<span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:${roleColor};margin-left:4px;text-transform:uppercase">${createdByUser.role}</span>`:'';
    const createdLine=s.createdBy?`<div style="font-size:12px;font-weight:600;color:var(--gray-100)">${esc(s.createdBy)}${roleTag}</div>`:`<span style="font-size:11px;color:var(--gray-500)">—</span>`;
    const editedByUser=s.editedBy?allUsers.find(u=>u.name===s.editedBy||u.username===s.editedByUsername):null;
    const editedRoleColor=editedByUser?roleColorMap[editedByUser.role]||'var(--gray-300)':'var(--gray-300)';
    const editedRoleTag=editedByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${editedRoleColor};margin-left:4px;text-transform:uppercase">${editedByUser.role}</span>`:'';
    const editedLine=s.editedBy?`<div style="font-size:11px;color:var(--gray-500);margin-top:3px">✎ ${esc(s.editedBy)}${editedRoleTag}</div>`:'';
    const createdByDisplay=`<div>${createdLine}${editedLine}</div>`;
    const isMySession=currentUser.role==='trainer'&&s.trainerId===currentUser.id;
    const rowHighlight=isMySession?'background:rgba(127,250,136,.04);':'';
    const myBadge=isMySession?`<span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;background:rgba(127,250,136,.15);color:var(--green);border:1px solid rgba(127,250,136,.25);margin-left:6px">MY SESSION</span>`:'';
    return`<tr style="${rowHighlight}">
      <td>${formatDate(s.date)}</td><td>${esc(s.start)}–${esc(s.end)}</td>
      <td>${esc(s.trainerName||'—')}${myBadge}</td><td>${esc(s.memberName||'—')}</td>
      <td>${esc(s.type)}</td>
      <td><span class="badge ${statusCls}">${esc(s.status)}</span></td>
      <td>${createdByDisplay}</td>
      <td><div class="td-actions">
        ${currentUser.role==='trainer'
          ?(s.trainerId===currentUser.id
            ?(s.status==='Pending'
              ?`<button onclick="acceptSession('${s.id}')" title="Accept Session" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid rgba(127,250,136,.35);background:rgba(127,250,136,.12);color:#7ffa88;cursor:pointer;transition:.2s" onmouseover="this.style.background='#7ffa88';this.style.color='#000'" onmouseout="this.style.background='rgba(127,250,136,.12)';this.style.color='#7ffa88'">✓ Accept</button>
               <button onclick="declineSession('${s.id}')" title="Decline Session" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:var(--red);cursor:pointer;transition:.2s" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.1)';this.style.color='var(--red)'">✕ Decline</button>`
              :s.status==='Scheduled'
              ?`<button onclick="confirmCompleteSession('${s.id}')" title="Mark as Completed" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid rgba(127,250,136,.35);background:rgba(127,250,136,.12);color:#7ffa88;cursor:pointer;transition:.2s" onmouseover="this.style.background='#7ffa88';this.style.color='#000'" onmouseout="this.style.background='rgba(127,250,136,.12)';this.style.color='#7ffa88'">✓ Complete</button>
               <button onclick="confirmCancelSession('${s.id}')" title="Cancel Session" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:var(--red);cursor:pointer;transition:.2s" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.1)';this.style.color='var(--red)'">✕ Cancel</button>`
              :`<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;background:rgba(255,255,255,.05);color:var(--gray-500)">${s.status==='Completed'?'✓ Done':s.status==='Declined'?'✕ Declined':s.status==='Pending'?'⏳ Pending':'✕ Cancelled'}</span>`)
            :`<span style="font-size:11px;color:var(--gray-500)" title="View only">👁</span>`)
          :(currentUser.role==='admin'
            ?`<button class="btn-icon" onclick="editSession('${s.id}')" title="Edit">✏️</button><button class="btn-icon" title="Delete" style="color:var(--red);border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.08)';this.style.color='var(--red)'" onclick="deleteSession('${s.id}')">✕</button>`
            :`<button class="btn-icon" onclick="editSession('${s.id}')" title="Edit">✏️</button><button class="btn-icon" title="Delete" style="color:var(--red);border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.08)';this.style.color='var(--red)'" onclick="deleteSession('${s.id}')">✕</button>`)}
      </div></td>
    </tr>`;}).join(''):`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📅</div><p>No sessions found</p></div></td></tr>`;
  document.getElementById('schedContent').innerHTML=`
  <div class="table-card">
    <div class="table-header"><h3>${esc(schedTrainerFilter==='all'?'All Sessions':schedTrainerFilter===currentUser.id?'My Sessions':sessions.length&&sessions[0].trainerName?sessions[0].trainerName+"'s Sessions":'Sessions')}</h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time</th><th>Trainer</th><th>Member</th><th>Type</th><th>Status</th><th>Created / Edited By</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}
function confirmCompleteSession(id){
  const s=Sessions.one(id);
  if(!s)return;
  if(currentUser.role==='trainer'&&s.trainerId!==currentUser.id){toast('You can only update your own sessions.','error');return;}
  const detail=`<div style="margin-top:12px;background:rgba(127,250,136,.06);border:1px solid rgba(127,250,136,.2);border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.9">
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Member:</span> <strong style="color:var(--white)">${esc(s.memberName||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Type:</span> <strong style="color:var(--white)">${esc(s.type||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Date:</span> <strong style="color:var(--white)">${formatDate(s.date)}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Time:</span> <strong style="color:var(--white)">${esc(s.start)} – ${esc(s.end)}</strong></div>
  </div>`;
  openConfirm('✓ Mark Session as Completed',
    `Are you sure you want to mark this session as <strong style="color:#7ffa88">Completed</strong>?${detail}`,
    ()=>{ markSessionDone(id); },
    'Mark as Completed','btn-primary');
}

function confirmCancelSession(id){
  const s=Sessions.one(id);
  if(!s)return;
  if(currentUser.role==='trainer'&&s.trainerId!==currentUser.id){toast('You can only update your own sessions.','error');return;}
  const detail=`<div style="margin-top:12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.9">
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Member:</span> <strong style="color:var(--white)">${esc(s.memberName||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Type:</span> <strong style="color:var(--white)">${esc(s.type||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Date:</span> <strong style="color:var(--white)">${formatDate(s.date)}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Time:</span> <strong style="color:var(--white)">${esc(s.start)} – ${esc(s.end)}</strong></div>
  </div>`;
  openConfirm('✕ Cancel Session',
    `Are you sure you want to <strong style="color:#ef4444">Cancel</strong> this session?${detail}`,
    ()=>{
      const sessions=Sessions.all();
      const idx=sessions.findIndex(x=>x.id===id);
      if(idx<0)return;
      const prev=sessions[idx].status;
      // Immutable replace — never mutate the object in place (sync bug fix)
      sessions[idx]={...sessions[idx],status:'Cancelled',statusLog:[...(sessions[idx].statusLog||[]),{from:prev,to:'Cancelled',by:currentUser.name,byUsername:currentUser.username,byRole:currentUser.role,at:new Date().toISOString()}]};
      Sessions.save(sessions);
      logActivity('Status Changed','Session',(sessions[idx].memberName||'?')+' with '+(sessions[idx].trainerName||'?'),'Date: '+sessions[idx].date+' | '+sessions[idx].start+'–'+sessions[idx].end+' | '+prev+' → Cancelled');
      toast('Session cancelled.','info');
      renderSchedule();
    },
    'Yes, Cancel Session','btn-danger');
}

function markSessionDone(id){
  const sessions=Sessions.all();
  const idx=sessions.findIndex(s=>s.id===id);
  if(idx<0)return;
  if(sessions[idx].trainerId!==currentUser.id){toast('You can only mark your own sessions as done.','error');return;}
  const prevStatus=sessions[idx].status;
  // Immutable replace — never mutate the object in place (sync bug fix)
  sessions[idx]={...sessions[idx],status:'Completed',completedAt:today(),completedBy:currentUser.username,statusLog:[...(sessions[idx].statusLog||[]),{from:prevStatus,to:'Completed',by:currentUser.name,byUsername:currentUser.username,byRole:currentUser.role,at:new Date().toISOString()}]};
  Sessions.save(sessions);
  toast('Session marked as completed. Great work!','success');
  renderSchedule();
}
function getMondayOf(dateStr){const d=new Date(dateStr);const day=d.getDay();const diff=d.getDate()-day+(day===0?-6:1);return new Date(d.setDate(diff)).toISOString().split('T')[0];}
function buildTimeOptions(){
  const opts=[];for(let h=5;h<=22;h++)for(let m of[0,30]){const hh=h.toString().padStart(2,'0');const mm=m.toString().padStart(2,'0');opts.push(`<option value="${hh}:${mm}">${hh}:${mm}</option>`);}
  return opts.join('');
}
// Convert "8:00 AM" or "08:00" → total minutes for comparison
function parseTimeToMin(t){
  if(!t)return null;
  const m=String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if(!m)return null;
  let h=parseInt(m[1],10);const min=parseInt(m[2],10);
  const ap=(m[3]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12;
  if(ap==='AM'&&h===12)h=0;
  return h*60+min;
}
// "2026-09-24" → "Thu" (matches availableDays checkbox values Mon/Tue/…)
const DAY_ABBRS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function dateToDayAbbr(dateStr){
  if(!dateStr)return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d))return '';
  return DAY_ABBRS[d.getDay()];
}
// Filter start/end dropdowns to the selected trainer's availableFrom–availableTo
// and show the availability hint. Full range if trainer has no hours set.
function onSessionDateChange(){
  const s=document.getElementById('sf_start');
  const e=document.getElementById('sf_end');
  applyTrainerTimeWindow(s?s.value:'',e?e.value:'');
  refreshSessionTrainerList();
}
function onSessionTimeChange(){
  refreshSessionTrainerList();
}
// If the chosen slot no longer fits the selected trainer, clear them and show
// the available trainers again, so the form can never keep a conflicting pair.
function refreshSessionTrainerList(){
  const hidden=document.getElementById('sf_trainer');
  const search=document.getElementById('sf_trainerSearch');
  if(!hidden||!search)return;
  const type=document.getElementById('sf_type')?document.getElementById('sf_type').value:'';
  const date=document.getElementById('sf_date')?document.getElementById('sf_date').value:'';
  const start=document.getElementById('sf_start')?document.getElementById('sf_start').value:'';
  const end=document.getElementById('sf_end')?document.getElementById('sf_end').value:'';
  const selected=hidden.value?Users.one(hidden.value):null;
  if(selected&&!isTrainerAvailable(selected,type,date,start,end,editingSessionId)){
    hidden.value='';
    search.value='';
    filterSessionTrainer('');
    return;
  }
  const list=document.getElementById('sf_trainerList');
  if(list&&list.style.display==='block')filterSessionTrainer(search.value);
}
function applyTrainerTimeWindow(presetStart,presetEnd){
  const trainerId=document.getElementById('sf_trainer').value;
  const trainer=trainerId?Users.all().find(u=>u.id===trainerId):null;
  const startEl=document.getElementById('sf_start');
  const endEl=document.getElementById('sf_end');
  const hint=document.getElementById('sf_availHint');
  if(!startEl||!endEl)return;
  const fromMin=trainer&&trainer.availableFrom?parseTimeToMin(trainer.availableFrom):null;
  const toMin=trainer&&trainer.availableTo?parseTimeToMin(trainer.availableTo):null;
  const hasWindow=fromMin!=null&&toMin!=null&&toMin>fromMin;
  let opts='';
  for(let h=5;h<=22;h++)for(let m of[0,30]){
    const hh=h.toString().padStart(2,'0');const mm=m.toString().padStart(2,'0');
    const val=`${hh}:${mm}`;const mins=h*60+m;
    if(hasWindow&&(mins<fromMin||mins>toMin))continue;
    opts+=`<option value="${val}">${val}</option>`;
  }
  startEl.innerHTML=opts;endEl.innerHTML=opts;
  if(presetStart&&startEl.querySelector(`option[value="${presetStart}"]`))startEl.value=presetStart;
  else if(hasWindow)startEl.value=`${String(Math.floor(fromMin/60)).padStart(2,'0')}:${String(fromMin%60).padStart(2,'0')}`;
  else if(startEl.querySelector('option[value="08:00"]'))startEl.value='08:00';
  else if(startEl.options.length)startEl.value=startEl.options[0].value;
  const sMin=parseTimeToMin(startEl.value);
  let defaultEnd=sMin!=null?sMin+60:null;
  if(hasWindow&&defaultEnd>toMin)defaultEnd=toMin;
  const endVal=defaultEnd!=null?`${String(Math.floor(defaultEnd/60)).padStart(2,'0')}:${String(defaultEnd%60).padStart(2,'0')}`:'09:00';
  if(presetEnd&&endEl.querySelector(`option[value="${presetEnd}"]`))endEl.value=presetEnd;
  else if(endEl.querySelector(`option[value="${endVal}"]`))endEl.value=endVal;
  else if(endEl.options.length)endEl.value=endEl.options[endEl.options.length-1].value;
  if(hint){
    if(trainer){
      const date=document.getElementById('sf_date')?document.getElementById('sf_date').value:'';
      const av=trainerAvailabilityInfo(trainer,date);
      const booked=trainerBookedRanges(trainer.id,date);
      let html=`⏰ <strong>${esc(trainer.coachName||trainer.name)}</strong> available: ${esc(av.text)}`;
      if(!av.dayOk)html+=`<br><span style="color:var(--red)">Not available on ${esc(av.dayAbbr)} — choose another date.</span>`;
      if(booked.length)html+=`<br><span style="color:var(--gold)">Booked: ${esc(booked.join(', '))}</span>`;
      hint.innerHTML=html;
      hint.style.display='block';
    }else{hint.style.display='none';hint.innerHTML='';}
  }
}
let editingSessionId=null;
function filterSessionTrainer(val){
  const list=document.getElementById('sf_trainerList');
  const currentId=document.getElementById('sf_trainer').value;
  const current=currentId?Users.one(currentId):null;
  const currentName=current?(current.coachName||current.name):'';
  if(!currentId||(val||'').trim()!==currentName)document.getElementById('sf_trainer').value='';
  const type=document.getElementById('sf_type')?document.getElementById('sf_type').value:'';
  const date=document.getElementById('sf_date')?document.getElementById('sf_date').value:'';
  const start=document.getElementById('sf_start')?document.getElementById('sf_start').value:'';
  const end=document.getElementById('sf_end')?document.getElementById('sf_end').value:'';
  if(!type){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">Select a session type first</div>';
    list.style.display='block';return;
  }
  const trainers=availableTrainersFor(type,date,start,end,editingSessionId);
  const q=(val||'').toLowerCase().trim();
  const matches=q?trainers.filter(function(u){
    const specs=trainerSpecList(u);
    return (u.name||'').toLowerCase().includes(q)||(u.coachName||'').toLowerCase().includes(q)||specs.some(function(s){return s.toLowerCase().includes(q);});
  }):trainers;
  if(!matches.length){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">No available trainers for '+esc(type)+' on '+esc(date?formatDate(date):'the selected date')+'. Try another date or time.</div>';
    list.style.display='block';return;
  }
  list.innerHTML='';
  matches.forEach(function(u){
    const av=trainerAvailabilityInfo(u,date);
    const booked=trainerBookedRanges(u.id,date);
    const _uSpecs=trainerSpecList(u);
    const specs=_uSpecs.length?_uSpecs.slice(0,2).map(esc).join(', ')+(_uSpecs.length>2?' +more':''):'';
    const slotText=date&&start&&end?'✓ Available for '+esc(start)+'–'+esc(end):'✓ Available on '+esc(av.dayAbbr||'this day');
    const status='<span style="font-size:10px;color:var(--green)">'+slotText+'</span>'+(booked.length?'<span style="font-size:10px;color:var(--gray-500)">Other bookings: '+esc(booked.join(', '))+'</span>':'');
    const div=document.createElement('div');
    div.style.cssText='padding:9px 12px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;display:flex;flex-direction:column;gap:2px';
    div.innerHTML=`<span style="font-weight:600;color:var(--white)">${esc(u.coachName||u.name)}${u.coachName&&u.coachName!==u.name?' <span style="font-size:11px;color:var(--gray-500)">('+esc(u.name)+')</span>':''}</span>${specs?'<span style="font-size:10px;color:var(--orange)">'+specs+'</span>':''}<span style="font-size:10px;color:var(--gray-500)">⏰ ${esc(av.text)}</span>${status}`;
    div.addEventListener('mousedown',function(){selectSessTrainer(u.id,u.coachName||u.name);});
    div.addEventListener('mouseover',function(){this.style.background='rgba(179,188,181,.1)';});
    div.addEventListener('mouseout',function(){this.style.background='';});
    list.appendChild(div);
  });
  list.style.display='block';
}
function selectSessTrainer(id,name){
  document.getElementById('sf_trainerSearch').value=name;
  document.getElementById('sf_trainer').value=id;
  document.getElementById('sf_trainerList').style.display='none';
  updateSessionTypesByTrainer();
}
// Close trainer list on outside click
document.addEventListener('click',function(e){
  const wrap=document.getElementById('sf_trainerSearch');
  const list=document.getElementById('sf_trainerList');
  if(wrap&&list&&!wrap.contains(e.target)&&!list.contains(e.target))list.style.display='none';
  const bw=document.getElementById('bs_trainerSearch');
  const bl=document.getElementById('bs_trainerList');
  if(bw&&bl&&!bw.contains(e.target)&&!bl.contains(e.target))bl.style.display='none';
});
const DEFAULT_SESSION_TYPES=['Personal Training','Cardio','Strength Training','Flexibility','Assessment'];
// Public catalogue of trainer specializations. Session Type is built from
// this list plus whatever trainers have saved, so Boxing/Zumba/etc. remain
// selectable even before the users snapshot arrives on a member device.
const SESSION_TYPE_CATALOG=['Personal Training','Strength Training','Cardio','Yoga','Zumba','HIIT','Flexibility','CrossFit','Body Building','Muay Thai','Boxing','Pilates'];
function isBookableTrainer(u){return !!u&&u.role==='trainer'&&u.status!=='locked'&&u.status!=='pending';}
// Trainer specializations can arrive as an array (normal) or a legacy
// comma-separated string. Normalize everywhere so the Users list, profile,
// edit form and session-type filter all see the same values.
function trainerSpecList(u){
  const v=u&&u.specializations;
  if(Array.isArray(v))return v.filter(Boolean).map(String);
  if(typeof v==='string')return v.split(',').map(s=>s.trim()).filter(Boolean);
  return [];
}
function trainerSpecs(u){
  const list=trainerSpecList(u);
  return list.length?list:DEFAULT_SESSION_TYPES;
}
function sessionTypesForTrainer(trainerId){
  const trainer=Users.all().find(u=>u.id===trainerId);
  const types=(trainer?trainerSpecs(trainer):DEFAULT_SESSION_TYPES).slice();
  if(!types.includes('Assessment'))types.push('Assessment');
  return types;
}
function allSessionTypes(){
  // Session Type comes from the trainer Specializations catalogue, plus any
  // custom specialization an admin saved. Assessment is always available.
  const types=SESSION_TYPE_CATALOG.slice();
  const extra=[];
  Users.all().filter(isBookableTrainer).forEach(function(t){
    trainerSpecList(t).forEach(function(s){
      if(s&&s!=='Assessment'&&!types.includes(s)&&!extra.includes(s))extra.push(s);
    });
  });
  return types.concat(extra,['Assessment']);
}
function trainerOffersType(trainer,type){
  if(!type||type==='Assessment')return true;
  return trainerSpecs(trainer).includes(type);
}
function trainersForSessionType(type){
  return Users.all().filter(function(u){return isBookableTrainer(u)&&trainerOffersType(u,type);});
}
// One availability rule for the trainer lists AND the save/book validation.
// Empty date/start/end means "not chosen yet" — only filter by type/day then.
function isTrainerAvailable(trainer,type,date,start,end,ignoreSessionId){
  if(!isBookableTrainer(trainer))return false;
  if(!type||!trainerOffersType(trainer,type))return false;
  const av=trainerAvailabilityInfo(trainer,date);
  if(date&&!av.dayOk)return false;
  let daySessions=[];
  if(date){
    daySessions=Sessions.all().filter(function(s){
      return s.id!==ignoreSessionId&&s.trainerId===trainer.id&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined';
    });
    if(daySessions.length>=8)return false;
  }
  if(date&&start&&end){
    const sM=parseTimeToMin(start),eM=parseTimeToMin(end);
    if(sM==null||eM==null||sM>=eM)return false;
    if(av.hasHours&&(sM<av.fromMin||eM>av.toMin))return false;
    if(daySessions.some(function(s){return !(end<=s.start||start>=s.end);}))return false;
  }
  return true;
}
function availableTrainersFor(type,date,start,end,ignoreSessionId){
  return Users.all().filter(function(u){return isTrainerAvailable(u,type,date,start,end,ignoreSessionId);});
}
function trainerAvailabilityInfo(trainer,date){
  const days=Array.isArray(trainer&&trainer.availableDays)&&trainer.availableDays.length?trainer.availableDays:[];
  const dayAbbr=date?dateToDayAbbr(date):'';
  const dayOk=!days.length||!dayAbbr||days.includes(dayAbbr);
  const fromMin=trainer&&trainer.availableFrom?parseTimeToMin(trainer.availableFrom):null;
  const toMin=trainer&&trainer.availableTo?parseTimeToMin(trainer.availableTo):null;
  const hasHours=fromMin!=null&&toMin!=null&&toMin>fromMin;
  const daysText=days.length?days.join(', '):'Any day';
  const hoursText=hasHours?trainer.availableFrom+' – '+trainer.availableTo:'Any time';
  return {days,dayAbbr,dayOk,fromMin,toMin,hasHours,daysText,hoursText,text:daysText+' · '+hoursText};
}
function trainerBookedRanges(trainerId,date){
  if(!trainerId||!date)return [];
  return Sessions.all().filter(function(s){return s.trainerId===trainerId&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined';})
    .sort(function(a,b){return (a.start||'').localeCompare(b.start||'');})
    .map(function(s){return (s.start||'')+'–'+(s.end||'');});
}
function trainerAvailabilityError(trainer,date,start,end){
  if(!trainer)return 'Trainer not found. Please choose another trainer.';
  const av=trainerAvailabilityInfo(trainer,date);
  const label=trainer.coachName||trainer.name;
  if(!av.dayOk)return label+' is not available on '+av.dayAbbr+'. Available days: '+av.days.join(', ')+'.';
  if(av.hasHours){
    const sM=parseTimeToMin(start),eM=parseTimeToMin(end);
    if(sM!=null&&eM!=null&&(sM<av.fromMin||eM>av.toMin))return 'Session must be within '+label+"'s available hours ("+trainer.availableFrom+' – '+trainer.availableTo+').';
  }
  return '';
}
function populateSessionTypeOptions(selected){
  const sel=document.getElementById('sf_type');
  if(!sel)return;
  const types=allSessionTypes();
  const keep=selected!==undefined?selected:sel.value;
  sel.innerHTML='<option value="">Select type</option>'+types.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');
  if(keep){
    if(!types.includes(keep))sel.insertAdjacentHTML('beforeend','<option value="'+esc(keep)+'">'+esc(keep)+'</option>');
    sel.value=keep;
  }
}
function onSessionTypeChange(){
  document.getElementById('sf_trainer').value='';
  document.getElementById('sf_trainerSearch').value='';
  const hint=document.getElementById('sf_availHint');
  if(hint){hint.style.display='none';hint.innerHTML='';}
  // New type = no trainer yet: reset the time window, then show everyone
  // available for that type at the default slot.
  applyTrainerTimeWindow();
  filterSessionTrainer('');
}
function updateSessionTypesByTrainer(){
  const trainerId=document.getElementById('sf_trainer').value;
  const sel=document.getElementById('sf_type');
  if(!sel)return;
  populateSessionTypeOptions(sel.value);
  if(!sel.value&&trainerId){const types=sessionTypesForTrainer(trainerId);if(types.length)sel.value=types[0];}
  applyTrainerTimeWindow();
}
function openSessionModal(preDate){
  if(currentUser.role!=='staff'&&currentUser.role!=='admin'){toast('Only staff can create sessions.','error');return;}
  editingSessionId=null;
  document.getElementById('sessionModalTitle').textContent='Create Session';
  document.getElementById('sessionFormError').style.display='none';
  document.getElementById('sf_trainerSearch').value='';
  document.getElementById('sf_trainer').value='';
  document.getElementById('sf_trainerList').style.display='none';
  populateSessionTypeOptions('');
  document.getElementById('sf_memberSearch').value='';document.getElementById('sf_memberId').value='';document.getElementById('sf_memberList').style.display='none';
  // No past dates for new sessions — min=today blocks earlier days in the picker
  const dateEl=document.getElementById('sf_date');
  dateEl.min=today();
  dateEl.value=(preDate&&preDate>=today())?preDate:today();
  const timeOpts=buildTimeOptions();
  document.getElementById('sf_start').innerHTML=timeOpts;document.getElementById('sf_end').innerHTML=timeOpts;
  document.getElementById('sf_start').value='08:00';document.getElementById('sf_end').value='09:00';
  document.getElementById('sf_notes').value='';
  applyTrainerTimeWindow();
  openModal('sessionModal');
}
function editSession(id){
  const s=Sessions.one(id);if(!s)return;
  if(currentUser.role!=='staff'&&currentUser.role!=='admin'){toast('Only staff can edit sessions.','error');return;}
  editingSessionId=id;
  document.getElementById('sessionModalTitle').textContent='Edit Session';
  document.getElementById('sessionFormError').style.display='none';
  populateSessionTypeOptions(s.type||'');
  const trainers=Users.all().filter(u=>u.role==='trainer');
  const trainerObj=trainers.find(u=>u.id===s.trainerId);
  document.getElementById('sf_trainerSearch').value=trainerObj?(trainerObj.coachName||trainerObj.name):'';
  document.getElementById('sf_trainer').value=s.trainerId;
  document.getElementById('sf_trainerList').style.display='none';
  updateSessionTypesByTrainer();
  document.getElementById('sf_memberSearch').value=s.memberName||'';document.getElementById('sf_memberId').value=s.memberId||'';
  // Editing: keep original date if already past; otherwise block earlier than today
  const dateEl=document.getElementById('sf_date');
  dateEl.min=(s.date<today())?s.date:today();
  dateEl.value=s.date;
  const timeOpts=buildTimeOptions();
  document.getElementById('sf_start').innerHTML=timeOpts;document.getElementById('sf_end').innerHTML=timeOpts;
  document.getElementById('sf_start').value=s.start;document.getElementById('sf_end').value=s.end;
  document.getElementById('sf_notes').value=s.notes||'';
  applyTrainerTimeWindow(s.start,s.end);
  openModal('sessionModal');
}
function filterSessionMember(val){
  const list=document.getElementById('sf_memberList');
  if(!val){list.style.display='none';return;}
  const members=Members.all().filter(m=>m.status!=='Archived'&&m.name.toLowerCase().includes(val.toLowerCase())).slice(0,8);
  if(!members.length){list.style.display='none';return;}
  list.innerHTML='';
  members.forEach(function(m){
    const isExpired=m.status==='Expired';
    const div=document.createElement('div');
    div.style.cssText='padding:8px 12px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;align-items:center;justify-content:space-between;'+(isExpired?'cursor:not-allowed;opacity:0.5;':'cursor:pointer;');
    div.innerHTML=esc(m.name)+(isExpired?'<span style="font-size:10px;font-weight:800;color:#ef4444;background:rgba(239,68,68,.12);padding:2px 7px;border-radius:4px;letter-spacing:.5px;margin-left:8px;">EXPIRED</span>':'');
    if(!isExpired){
      div.addEventListener('mousedown',function(){selectSessMember(m.id,m.name);});
      div.addEventListener('mouseover',function(){this.style.background='rgba(179,188,181,.1)';});
      div.addEventListener('mouseout',function(){this.style.background='';});
    }
    list.appendChild(div);
  });
  list.style.display='block';
}
function selectSessMember(id,name){
  document.getElementById('sf_memberSearch').value=name;
  document.getElementById('sf_memberId').value=id;
  document.getElementById('sf_memberList').style.display='none';
}
function saveSession(){
  const trainerId=document.getElementById('sf_trainer').value;
  const memberId=document.getElementById('sf_memberId').value;
  const type=document.getElementById('sf_type').value;
  const date=document.getElementById('sf_date').value;
  const start=document.getElementById('sf_start').value;
  const end=document.getElementById('sf_end').value;
  const err=document.getElementById('sessionFormError');
  err.style.display='none';
  if(!trainerId||!memberId||!type||!date||!start||!end){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  // Block past dates (date picker min is a UI guard; this is the hard check)
  const minDate=document.getElementById('sf_date').min||today();
  if(date<minDate){err.textContent='Cannot schedule a session on a past date. Please choose today or a future date.';err.style.display='block';return;}
  const memberCheck=Members.one(memberId);
  if(memberCheck&&memberCheck.status==='Expired'){err.textContent='Cannot schedule a session for '+memberCheck.name+'. Their membership has expired. Please renew their membership first.';err.style.display='block';return;}
  if(end<=start){err.textContent='Invalid time range. The end time must be after the start time.';err.style.display='block';return;}
  if(!sessionTypesForTrainer(trainerId).includes(type)){err.textContent='The selected trainer does not offer '+type+'. Please choose another type or trainer.';err.style.display='block';return;}
  const trAvail=Users.all().find(u=>u.id===trainerId);
  if(!isBookableTrainer(trAvail)){err.textContent='That trainer is not available for booking right now. Please choose another trainer.';err.style.display='block';return;}
  const availErr=trainerAvailabilityError(trAvail,date,start,end);
  if(availErr){err.textContent=availErr;err.style.display='block';return;}
  const sessions=Sessions.all();
  // Conflict: same trainer, same date, overlapping time
  const trainerConflict=sessions.filter(s=>s.trainerId===trainerId&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined'&&s.id!==editingSessionId).find(s=>start<s.end&&end>s.start);
  if(trainerConflict){err.textContent=`Schedule Conflict: This trainer already has a session from ${trainerConflict.start}–${trainerConflict.end} on this date. Please choose a different time.`;err.style.display='block';return;}
  // Conflict: same member assigned to another session at same time
  const memberConflict=sessions.filter(s=>s.memberId===memberId&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined'&&s.id!==editingSessionId).find(s=>start<s.end&&end>s.start);
  if(memberConflict){err.textContent=`Schedule Conflict: This member already has a session from ${memberConflict.start}–${memberConflict.end} on this date.`;err.style.display='block';return;}
  if(sessions.filter(s=>s.trainerId===trainerId&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined'&&s.id!==editingSessionId).length>=8){err.textContent='Trainer not available for the selected day.';err.style.display='block';return;}
  if(!isTrainerAvailable(trAvail,type,date,start,end,editingSessionId)){err.textContent='That trainer is no longer available for the selected slot. Please choose another available trainer or time.';err.style.display='block';return;}
  const trainer=Users.all().find(u=>u.id===trainerId);
  const member=Members.one(memberId);
  const data={trainerId,trainerName:trainer?trainer.name:'Unknown',memberId,memberName:member?member.name:'Unknown',type,date,start,end,notes:sanitizeText(document.getElementById('sf_notes').value.trim()),status:'Scheduled'};
  if(editingSessionId){
    const idx=sessions.findIndex(s=>s.id===editingSessionId);
    if(idx>-1)sessions[idx]={...sessions[idx],...data,editedBy:currentUser.name,editedByUsername:currentUser.username,editedByRole:currentUser.role,editedAt:today()};
    Sessions.save(sessions);logActivity('Edited','Session',data.memberName+' with '+data.trainerName,'Date: '+data.date+' | '+data.start+'–'+data.end+' | Type: '+data.type);toast('Session updated.');
  } else {
    sessions.push({id:uid(),...data,createdBy:currentUser.name,createdByUsername:currentUser.username,createdByRole:currentUser.role,createdAt:today()});Sessions.save(sessions);logActivity('Added','Session',data.memberName+' with '+data.trainerName,'Date: '+data.date+' | '+data.start+'–'+data.end+' | Type: '+data.type);toast('Session Scheduled Successfully.');
  }
  closeModal('sessionModal');renderSchedule();if(currentUser.role==='admin'||currentUser.role==='staff'){renderDashboard();}
}
function toggleSessionStatus(id){
  const sessions=Sessions.all();const idx=sessions.findIndex(s=>s.id===id);
  if(idx<0)return;
  const s=sessions[idx];
  const cycle={Scheduled:'Completed',Completed:'Cancelled',Cancelled:'Scheduled'};
  const newStatus=cycle[s.status]||'Scheduled';
  if(newStatus==='Scheduled'){
    const live=sessions.filter(x=>x.id!==id&&x.date===s.date&&(x.status==='Scheduled'||x.status==='Accepted')&&!(s.end<=x.start||s.start>=x.end));
    if(live.some(x=>x.trainerId===s.trainerId)){toast('Cannot set to Scheduled — trainer already booked at that time.','error');return;}
    if(live.some(x=>x.memberId===s.memberId)){toast('Cannot set to Scheduled — member already has a session at that time.','error');return;}
  }
  // Immutable replace — never mutate the object in place (sync bug fix)
  sessions[idx]={...s,status:newStatus,statusLog:[...(s.statusLog||[]),{from:s.status,to:newStatus,by:currentUser.name,byUsername:currentUser.username,byRole:currentUser.role,at:new Date().toISOString()}]};
  Sessions.save(sessions);logActivity('Status Changed','Session',(s.memberName||'Unknown')+' with '+(s.trainerName||'Unknown'),'Date: '+s.date+' | '+s.start+'–'+s.end+' | '+s.status+' → '+newStatus);toast(`Session marked as ${newStatus}.`,'info');renderSchedule();
}
function deleteSession(id){
  const s=Sessions.all().find(x=>x.id===id);
  const detail=s?`<div style="margin-top:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.8">
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Member:</span> <strong style="color:var(--white)">${esc(s.memberName||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Trainer:</span> <strong style="color:var(--white)">${esc(s.trainerName||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Date:</span> <strong style="color:var(--white)">${formatDate(s.date)}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Time:</span> <strong style="color:var(--white)">${esc(s.start)}–${esc(s.end)}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Type:</span> <strong style="color:var(--white)">${esc(s.type||'—')}</strong></div>
  </div>`:'';
  openConfirm('Delete Session',`Are you sure you want to delete this session? This cannot be undone.${detail}`,()=>{
    const dS=Sessions.all().find(x=>x.id===id);if(dS)logActivity('Deleted','Session',(dS.memberName||'?')+' with '+(dS.trainerName||'?'),'Date: '+dS.date+' | '+dS.start+'–'+dS.end+' | Type: '+(dS.type||'?'));Sessions.remove(id);toast('Session deleted.');renderSchedule();
  });
}

// ======================================================================
// PANEL: NOTIFICATIONS
// ======================================================================
let dismissedNotifs=false;
let _dismissedIds=new Set();
let _notifFilter='All';
function dismissRenewal(memberId){
  _dismissedIds.add(memberId);
  renderNotifications();
  scanRenewals();
}
function dismissAllRenewals(){
  const allExpiring=Members.all().filter(m=>{
    if(m.status==='Archived')return false;
    const d=daysUntil(m.expiryDate);
    return d<=7;
  });
  const pending=allExpiring.filter(m=>!_dismissedIds.has(m.id));
  if(!pending.length){toast('No renewal reminders to dismiss.','error');return;}
  openConfirm('Dismiss All Renewal Reminders',
    `Dismiss all <strong>${pending.length}</strong> renewal reminder${pending.length!==1?'s':''}?<br><span style="font-size:12px;color:var(--gray-500)">This hides expired, urgent and upcoming reminders for now — they will reappear after the page reloads.</span>`,
    ()=>{pending.forEach(m=>_dismissedIds.add(m.id));renderNotifications();scanRenewals();},
    'Dismiss All');
}
function confirmRenew(memberId){
  const m=Members.one(memberId);
  if(!m)return;
  const pl=m.planId?Plans.one(m.planId):null;
  const price=pl?Number(pl.price):0;
  openConfirm('🔄 Renew Membership',
    `Renew <strong>${esc(m.name)}</strong>'s <strong>${esc(pl?pl.name:'—')}</strong> plan for <strong>₱${price.toLocaleString()}</strong>?<br><span style="font-size:12px;color:var(--gray-500)">You'll confirm the payment details next.</span>`,
    ()=>{openPaymentForMember(memberId);},
    'Continue','btn-primary');
}
function renderNotifications(){
  const el=document.getElementById('panelNotifications');
  const allExpiring=Members.all().filter(m=>{
    if(m.status==='Archived')return false;
    const d=daysUntil(m.expiryDate);
    return d<=7;
  });
  const members=allExpiring.filter(m=>!_dismissedIds.has(m.id));
  const plans=Plans.all();
  const bucketOf=m=>{const d=daysUntil(m.expiryDate);return d<0?'expired':(d<=2?'urgent':'upcoming');};
  const buckets={expired:[],urgent:[],upcoming:[]};
  members.forEach(m=>buckets[bucketOf(m)].push(m));
  ['expired','urgent','upcoming'].forEach(k=>buckets[k].sort((a,b)=>daysUntil(a.expiryDate)-daysUntil(b.expiryDate)));
  const visible=_notifFilter==='All'?[...buckets.expired,...buckets.urgent,...buckets.upcoming]:(buckets[_notifFilter]||[]);
  const now=new Date();
  const monthPays=Payments.all().filter(p=>{const d=new Date(p.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
  const monthRev=monthPays.reduce((a,p)=>a+Number(p.amount),0);
  const items=visible.map(m=>{
    const d=daysUntil(m.expiryDate);const pl=plans.find(p=>p.id===m.planId);
    const bucket=bucketOf(m);
    const avatarColor=bucket==='expired'?'#991b1b':bucket==='urgent'?'var(--orange)':'var(--gold)';
    const dayLabel=bucket==='expired'?`Expired ${Math.abs(d)} day${Math.abs(d)!==1?'s':''} ago`:`${d} day${d!==1?'s':''} left`;
    const badgeCls=bucket==='expired'?'badge-expired':bucket==='urgent'?'badge-urgent':'badge-expiring';
    const cls=bucket==='expired'?'expired':bucket==='urgent'?'urgent':'warning';
    const dayColor=d<0?'var(--red)':d<=2?'var(--orange)':'var(--gold)';
    return`<div class="notif-item ${cls}" style="display:flex;align-items:center;gap:12px;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.035)'" onmouseout="this.style.background=''">
      <div class="user-avatar" style="width:36px;height:36px;font-size:12px;background:${avatarColor};flex-shrink:0">${esc(initials(m.name))}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="notif-name">${esc(m.name)}</span>
          <span class="badge ${badgeCls}" style="font-size:8px">${esc(pl?pl.name:'—')}</span>
        </div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:2px">Expires ${formatDate(m.expiryDate)} <span style="color:${dayColor};font-weight:700">· ${dayLabel}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="btn-primary btn-sm" onclick="confirmRenew('${m.id}')" style="font-size:11px;padding:7px 14px;width:auto">Renew →</button>
        <button title="Dismiss this reminder for now — it returns after the page reloads" onclick="dismissRenewal('${m.id}')" style="flex-shrink:0;background:transparent;border:1px solid rgba(255,255,255,.1);color:var(--gray-500);width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;transition:.15s;display:inline-flex;align-items:center;justify-content:center" onmouseover="this.style.background='rgba(239,68,68,.12)';this.style.color='var(--red)';this.style.borderColor='rgba(239,68,68,.35)'" onmouseout="this.style.background='transparent';this.style.color='var(--gray-500)';this.style.borderColor='rgba(255,255,255,.1)'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>`;}).join('');
  const tab=(label,key,cnt)=>`<button class="filter-chip${_notifFilter===key?' active':''}" onclick="_notifFilter='${key}';renderNotifications()">${label} <span style="opacity:.7">(${cnt})</span></button>`;
  el.innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div class="section-title" style="margin-bottom:4px">Member Renewals <span class="badge badge-expired" style="margin-left:6px">${members.length}</span></div>
      <div style="font-size:12px;color:var(--gray-500)">${buckets.expired.length} expired &nbsp;·&nbsp; ${buckets.urgent.length} urgent &nbsp;·&nbsp; ${buckets.upcoming.length} upcoming</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary btn-sm" onclick="showRenewedPage()" style="width:auto">🔄 Recently Renewed</button>
      <button class="btn-secondary btn-sm" onclick="dismissAllRenewals()">Dismiss All</button>
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    ${tab('All','All',members.length)}
    ${tab('Expired','expired',buckets.expired.length)}
    ${tab('Urgent','urgent',buckets.urgent.length)}
    ${tab('Upcoming','upcoming',buckets.upcoming.length)}
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <div class="renew-mini-stat">🔄 ${monthPays.length} renewals this month</div>
    <div class="renew-mini-stat">💰 ₱${monthRev.toLocaleString()} collected</div>
  </div>
  ${visible.length?`<div class="notif-list">${items}</div>`:`<div class="table-card"><div class="empty-state"><div class="empty-icon">✅</div><p>${_notifFilter==='All'?'All members have been attended to.':'No members in this category right now.'}</p></div></div>`}`;
}

// ======================================================================
// SUB-PAGE: RECENTLY RENEWED (opened from Member Renewals button)
// ======================================================================
function showRenewedPage(){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const pe=document.getElementById('panelRenewed');
  if(pe)pe.classList.add('active');
  document.getElementById('pageTitle').textContent='Recently Renewed';
  _lastPanel='renewed';
  renderPanel('renewed');
}
function backToRenewals(){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const pe=document.getElementById('panelNotifications');
  if(pe)pe.classList.add('active');
  document.getElementById('pageTitle').textContent='Member Renewals';
  _lastPanel='notifications';
  renderNotifications();
}
let _renewedFilter='All';
function renderRenewed(){
  const el=document.getElementById('panelRenewed');
  if(!el)return;
  const list=Payments.all().slice().reverse();
  const allExpiring=Members.all().filter(m=>{
    if(m.status==='Archived')return false;
    return daysUntil(m.expiryDate)<=7;
  });
  const bucketOf=m=>{const d=daysUntil(m.expiryDate);return d<0?'expired':(d<=2?'urgent':'upcoming');};
  const buckets={expired:[],urgent:[],upcoming:[]};
  allExpiring.forEach(m=>buckets[bucketOf(m)].push(m));
  const now=new Date();
  const monthPays=Payments.all().filter(p=>{const d=new Date(p.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
  const monthRev=monthPays.reduce((a,p)=>a+Number(p.amount),0);
  const memberBucket={};allExpiring.forEach(m=>memberBucket[m.id]=bucketOf(m));
  const filtered=_renewedFilter==='All'?list:list.filter(p=>memberBucket[p.memberId]===_renewedFilter);
  const tab=(label,key,cnt)=>`<button class="filter-chip${_renewedFilter===key?' active':''}" onclick="_renewedFilter='${key}';renderRenewed()">${label} <span style="opacity:.7">(${cnt})</span></button>`;
  el.innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div class="section-title" style="margin-bottom:4px">Recently Renewed <span class="badge badge-active" style="margin-left:6px">${list.length}</span></div>
      <div style="font-size:12px;color:var(--gray-500)">All recorded membership renewals and payments, newest first.</div>
    </div>
    <button class="btn-secondary btn-sm" onclick="backToRenewals()">← Back to Member Renewals</button>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    ${tab('All','All',allExpiring.length)}
    ${tab('Expired','expired',buckets.expired.length)}
    ${tab('Urgent','urgent',buckets.urgent.length)}
    ${tab('Upcoming','upcoming',buckets.upcoming.length)}
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <div class="renew-mini-stat">🔄 ${monthPays.length} renewals this month</div>
    <div class="renew-mini-stat">💰 ₱${monthRev.toLocaleString()} collected</div>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>Renewal Records</h3></div>
    ${filtered.length?`<div style="overflow-x:auto"><table><thead><tr><th>Member</th><th>Plan</th><th>Amount</th><th>Date</th></tr></thead><tbody>
    ${filtered.map(p=>`<tr><td>${esc(p.memberName)}</td><td>${esc(p.planName)}</td><td>₱${Number(p.amount).toLocaleString()}</td><td>${formatDate(p.date)}</td></tr>`).join('')}
    </tbody></table></div>`:`<div class="empty-state"><div class="empty-icon">🔄</div><p>No renewals in this category right now.</p></div>`}
  </div>`;
}

// ======================================================================
// MEMBER MESSAGES (in-system front desk chat)
// ======================================================================
let _msgThreadId=null,_msgStaffMode=false;
function updateMessageBadge(){
  const n=Messages.all().filter(m=>m.direction==='in'&&!m.read).length;
  const b=document.getElementById('msgBadge');
  if(b){b.style.display=n?'flex':'none';b.textContent=n;}
  if(typeof updateMyBadges==='function')updateMyBadges();
}
function openMemberMessageModal(){
  const mem=Members.one(currentUser.memberId||currentUser.id);
  if(!mem)return;
  _msgThreadId=mem.id;_msgStaffMode=false;
  document.getElementById('messageModalTitle').textContent='Message the Gym';
  document.getElementById('msgInput').placeholder='Type your message…';
  renderMsgThread();
  openModal('messageModal');
}
function openMsgThread(memberId){
  _msgThreadId=memberId;_msgStaffMode=true;
  const mem=Members.one(memberId);
  document.getElementById('messageModalTitle').textContent=mem?'Message — '+mem.name:'Message';
  document.getElementById('msgInput').placeholder='Reply to '+(mem?mem.name:'member')+'…';
  const all=Messages.all();
  let changed=false;
  all.forEach(m=>{if(m.memberId===memberId&&m.direction==='in'&&!m.read){m.read=true;changed=true;}});
  if(changed)Messages.save(all);
  renderMsgThread();updateMessageBadge();
  openModal('messageModal');
}
function renderMsgThread(){
  const msgs=Messages.all().filter(m=>m.memberId===_msgThreadId).sort((a,b)=>a.ts-b.ts);
  const body=document.getElementById('messageModalBody');
  if(!body)return;
  body.innerHTML=msgs.length?msgs.map(m=>{
    // Messenger layout: the viewer's OWN messages sit on the RIGHT (green),
    // the other party's on the LEFT (dark) — in both the member view and the
    // front-desk view.
    const own=_msgStaffMode?m.direction==='out':m.direction==='in';
    const who=m.direction==='in'?(m.memberName||'Member'):'Front Desk';
    return `
    <div class="msg-row${own?' own':' other'}">
      <div class="msg-bubble">
        <div class="msg-meta">${esc(who)} · ${formatDate(m.date)} ${esc(m.time||'')}</div>
        ${esc(m.text)}
      </div>${_msgStaffMode?`<button class="msg-del" title="Delete message" onclick="deleteMsg('${m.id}')">&#10005;</button>`:''}
    </div>`;}).join(''):`<div class="empty-state" style="padding:30px"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><p>No messages yet</p><p class="empty-sub" style="font-size:12px;color:var(--gray-500)">${_msgStaffMode?'This member has not sent any messages.':'Send a message and the front desk will reply here.'}</p></div>`;
  body.scrollTop=body.scrollHeight;
}
function sendMessage(){
  const input=document.getElementById('msgInput');
  const text=(input.value||'').trim();
  if(!text)return;
  if(text.length>1000){toast('Message is too long — max 1000 characters.','error');return;}
  const rlId=currentUser?(currentUser.memberId||currentUser.id||currentUser.username||'user'):'anon';
  if(!rateLimitOk('gms_rl_msg_gap_'+rlId,1,2000)||!rateLimitOk('gms_rl_msg_'+rlId,20,10*60*1000)){
    toast('Too many messages — please wait a moment and try again.','error');return;
  }
  const mem=Members.one(_msgThreadId);
  Messages.add({id:'MSG'+uid(),memberId:_msgThreadId,memberName:mem?mem.name:'Member',text,time:new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),date:today(),ts:Date.now(),direction:_msgStaffMode?'out':'in',read:_msgStaffMode});
  input.value='';
  renderMsgThread();updateMessageBadge();
  if(_msgStaffMode&&document.getElementById('panelMessages'))renderMessages();
  toast('Message sent.');
}

// ======================================================================
// MEMBER PAGES: MESSAGE THE GYM + NOTIFICATIONS (full-page Messenger)
// ======================================================================
function myUnreadReplies(){
  if(!currentUser||currentUser.role!=='member')return 0;
  const mid=currentUser.memberId||currentUser.id;
  return Messages.all().filter(m=>m.memberId===mid&&m.direction==='out'&&!m.readByMember).length;
}
function updateMyBadges(){
  if(!currentUser||currentUser.role!=='member')return;
  const replies=myUnreadReplies();
  const mb=document.getElementById('myMsgBadge');
  if(mb){mb.style.display=replies?'flex':'none';mb.textContent=replies;}
}
function myMsgBubble(m){
  const own=m.direction==='in';
  const who=m.direction==='in'?(m.memberName||'Member'):'Front Desk';
  return `
  <div class="msg-row${own?' own':' other'}">
    <div class="msg-bubble">
      <div class="msg-meta">${esc(who)} · ${formatDate(m.date)} ${esc(m.time||'')}</div>
      ${esc(m.text)}
    </div>${own?`<button class="msg-del" title="Delete message" onclick="deleteMsg('${m.id}')">&#10005;</button>`:''}
  </div>`;
}
// Delete a chat message. Members may only delete their own; admin/staff may
// moderate (delete any) from the front-desk thread view.
function deleteMsg(id){
  const msg=Messages.one(id);
  if(!msg)return;
  const memberOwnsIt=currentUser&&currentUser.role==='member'&&msg.direction==='in'&&msg.memberId===(currentUser.memberId||currentUser.id);
  const staffAllowed=currentUser&&(currentUser.role==='admin'||currentUser.role==='staff');
  if(!memberOwnsIt&&!staffAllowed){toast('You can only delete your own messages.','error');return;}
  openConfirm('Delete Message','Delete this message? This cannot be undone.',function(){
    Messages.remove(id);
    const pg=document.getElementById('panelMyMessages');
    if(pg&&pg.classList.contains('active'))renderMyMessages();
    if(_msgThreadId){renderMsgThread();if(typeof renderMessages==='function'&&document.getElementById('panelMessages'))renderMessages();}
    updateMessageBadge();
    toast('Message deleted.');
  },'Delete','btn-danger');
}
function renderMyMessages(){
  const el=document.getElementById('panelMyMessages');
  if(!el)return;
  const mid=currentUser.memberId||currentUser.id;
  const mem=Members.one(mid);
  const all=Messages.all();
  let changed=false;
  all.forEach(m=>{if(m.memberId===mid&&m.direction==='out'&&!m.readByMember){m.readByMember=true;changed=true;}});
  if(changed)Messages.save(all);
  const msgs=all.filter(m=>m.memberId===mid).sort((a,b)=>a.ts-b.ts);
  el.innerHTML=`
  <div class="mychat">
    <div class="mychat-head">
      <div class="mychat-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>
      <div class="mychat-id">
        <div class="mychat-name">Front Desk <span class="online-dot" title="Online"></span></div>
        <div class="mychat-sub">FitCore Gym${mem?' · '+esc(mem.name):''} — replies appear here instantly</div>
      </div>
    </div>
    <div class="mychat-thread" id="myChatThread">
      ${msgs.length?msgs.map(myMsgBubble).join(''):`<div class="empty-state" style="padding:40px 20px"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><p>No messages yet</p><p class="empty-sub" style="font-size:12px;color:var(--gray-500)">Send a message below and the front desk will reply here.</p></div>`}
    </div>
    <div class="mychat-inputrow">
      <input id="myMsgInput" placeholder="Type your message…" maxlength="500" onkeydown="if(event.key==='Enter')sendMyMessage()">
      <button class="btn-primary" onclick="sendMyMessage()">Send</button>
    </div>
  </div>`;
  const t=document.getElementById('myChatThread');
  if(t)t.scrollTop=t.scrollHeight;
  updateMyBadges();
}
function sendMyMessage(){
  const input=document.getElementById('myMsgInput');
  const text=(input?input.value:'').trim();
  if(!text)return;
  const mid=currentUser.memberId||currentUser.id;
  const mem=Members.one(mid);
  Messages.add({id:'MSG'+uid(),memberId:mid,memberName:mem?mem.name:'Member',text,time:new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),date:today(),ts:Date.now(),direction:'in',read:false});
  if(input)input.value='';
  renderMyMessages();
  toast('Message sent.');
}
// ============================= WORKOUT DOMAIN (M2) =============================
// Member self-service plan form state
let _mpFormOpen=false;
let _mpEditId=null;
let _mpSelected=new Set();
let _mpSearch='';
let _mpMuscle='All';
let _mpSets='3';
let _mpReps='10';
let _mpName='';
function _mpMuscles(){const set=new Set(['All']);ExerciseLibrary.all().forEach(e=>{if(e.muscle)set.add(e.muscle);});return[...set];}
function _mpFilterLib(){
  return ExerciseLibrary.all().filter(e=>{
    if(_mpMuscle!=='All'&&e.muscle!==_mpMuscle)return false;
    if(_mpSearch&&!(e.name||'').toLowerCase().includes(_mpSearch.toLowerCase()))return false;
    return true;
  });
}
function _mpCardHtml(e){
  const on=_mpSelected.has(e.name);
  const known=['legs','back','chest','shoulders','core','arms','cardio'];
  const m=(e.muscle||'').toLowerCase().replace(/\s+/g,'');
  const mc=known.includes(m)?m:'default';
  return `<label class="mp-ex-card${on?' is-selected':''}">
    <span class="wb-cb"${on?' aria-checked="true"':''}></span>
    <input type="checkbox" ${on?'checked':''} onchange="mpToggleEx('${esc(e.name)}')" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px">
    <span class="mp-ex-name">${esc(e.name)}</span>
    <span class="wb-muscle-pill m-${mc}">${esc(e.muscle||'Other')}</span>
  </label>`;
}
function _mpSideHtml(){
  const n=_mpSelected.size;
  const chips=n?`<div class="wb-selected-bar"><span class="wb-selected-count">${n} selected</span>${[..._mpSelected].map(name=>`<span class="wb-sel-chip">${esc(name)}<button type="button" onclick="mpToggleEx('${esc(name)}')">&times;</button></span>`).join('')}${n>1?`<span class="wb-sel-clear" onclick="_mpSelected=new Set();renderMyWorkoutPlan()">Clear all</span>`:''}</div>`:`<div class="mp-side-empty">Pick exercises from the list</div>`;
  return `
    <div class="mp-form-sec mp-side-sec">
      <div class="mp-form-sec-h"><span class="mp-sec-num">3</span> Sets &amp; reps</div>
      <div class="mp-step-row">
        <span class="mp-step-label">Sets</span>
        <div class="mp-stepper">
          <button type="button" class="mp-step-btn" onclick="mpStep('sets',-1)" aria-label="Fewer sets">−</button>
          <input type="number" id="mp_sets" class="mp-step-val" value="${esc(_mpSets)}" min="1" max="99" oninput="mpSetRaw('sets',this.value)">
          <button type="button" class="mp-step-btn" onclick="mpStep('sets',1)" aria-label="More sets">+</button>
        </div>
      </div>
      <div class="mp-step-row">
        <span class="mp-step-label">Reps</span>
        <div class="mp-stepper">
          <button type="button" class="mp-step-btn" onclick="mpStep('reps',-1)" aria-label="Fewer reps">−</button>
          <input type="number" id="mp_reps" class="mp-step-val" value="${esc(_mpReps)}" min="1" max="99" oninput="mpSetRaw('reps',this.value)">
          <button type="button" class="mp-step-btn" onclick="mpStep('reps',1)" aria-label="More reps">+</button>
        </div>
      </div>
      <p class="mp-step-hint">Applies to all selected exercises</p>
      <div class="mp-form-preview" id="mp_preview"></div>
    </div>
    <div class="mp-form-sec mp-side-sec mp-side-sum">
      <div class="mp-form-sec-h"><span class="mp-sec-num">✓</span> Selected</div>
      <div id="mp_selBar">${chips}</div>
      <div class="mp-form-count-inline"><strong id="mp_count">${n}</strong> exercise${n===1?'':'s'} · <span id="mp_sum">${esc(_mpSets||'3')}×${esc(_mpReps||'10')}</span></div>
    </div>
    <div id="mpError" class="error-msg" style="display:none"></div>
    <div class="mp-form-foot mp-form-foot-side">
      <button class="btn-primary" style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px" onclick="saveMemberPlan()">${iconSvg('save',14)} ${_mpEditId?'Save Changes':'Save My Plan'}</button>
      <button class="btn-secondary" style="width:100%" onclick="cancelMemberPlanForm()">Cancel</button>
    </div>`;
}
function renderMyWorkoutPlan(){
  const el=document.getElementById('panelMyWorkoutPlan'); if(!el) return;
  const mid=currentUser.memberId||currentUser.id;
  const plans=WorkoutPlans.all().filter(p=>p.memberId===mid);
  const muscles=_mpMuscles();
  const lib=_mpFilterLib();
  const formHtml=_mpFormOpen?`
    <div class="mp-form">
      <div class="mp-form-head">
        <div class="mp-form-title">${iconSvg(_mpEditId?'pencil':'userPlus',14)} ${_mpEditId?'Edit My Plan':'Create My Plan'}</div>
        <span class="mp-form-tag">${_mpEditId?'Editing':'New plan'}</span>
      </div>
      <div class="mp-form-grid">
        <div class="mp-form-main">
          <div class="mp-form-sec">
            <div class="mp-form-sec-h"><span class="mp-sec-num">1</span> Plan details</div>
            <div class="form-group" style="margin:0;max-width:420px"><label>Plan Name *</label><input type="text" id="mp_name" placeholder="e.g. My Push Day" value="${esc(_mpEditId?((WorkoutPlans.one(_mpEditId)||{}).name||''):_mpName)}" oninput="_mpName=this.value"></div>
          </div>
          <div class="mp-form-sec">
            <div class="mp-form-sec-h"><span class="mp-sec-num">2</span> Pick exercises <span class="mp-form-count" id="mp_pickCount">${_mpSelected.size} selected</span></div>
            <div class="wb-pick-toolbar"><input type="text" class="search-input" id="mp_search" placeholder="Search exercises..." value="${esc(_mpSearch)}" oninput="mpOnSearch(this.value)"></div>
            <div class="wb-muscle-chips" id="mp_chips">${muscles.map(m=>`<span class="filter-chip${m===_mpMuscle?' active':''}" onclick="mpSetFilter('${esc(m)}')">${esc(m)}</span>`).join('')}</div>
            <div class="mp-ex-list" id="mp_exList" style="max-height:300px">
              ${lib.length?lib.map(_mpCardHtml).join(''):'<div class="mp-ex-empty">No exercises found</div>'}
            </div>
          </div>
        </div>
        <aside class="mp-form-side">
          ${_mpSideHtml()}
        </aside>
      </div>
    </div>`:'';
  const headerBtns=_mpFormOpen
    ? `<button class="btn-secondary btn-sm" style="width:auto;display:inline-flex;align-items:center;gap:6px" onclick="cancelMemberPlanForm()">${iconSvg('x',13)} Close Form</button>
       <button class="btn-secondary btn-sm" style="width:auto;display:inline-flex;align-items:center;gap:6px" onclick="navigate('exerciseLibrary'); renderExerciseLibrary()">${iconSvg('search',13)} Browse Exercises</button>`
    : `${plans.length?`<button class="btn-primary btn-sm" style="width:auto;display:inline-flex;align-items:center;gap:6px" onclick="openMemberPlanForm()">${iconSvg('userPlus',13)} Create My Plan</button>`:''}
       <button class="btn-secondary btn-sm" style="width:auto;display:inline-flex;align-items:center;gap:6px" onclick="navigate('exerciseLibrary'); renderExerciseLibrary()">${iconSvg('search',13)} Browse Exercises</button>`;
  const cardsHtml=plans.length?`<div class="mp-plan-grid">${plans.map(p=>{
      const isSelf=p.createdBy==='member'||p.trainerId==null&&p.trainerName==='Self';
      const ex=p.exercises||[];
      const done=ex.filter(e=>e.done).length;
      const pct=ex.length?Math.round(done/ex.length*100):0;
      return `
    <div class="mp-plan-card${isSelf?' is-self':''}">
      <div class="mp-plan-top">
        <div class="mp-plan-info">
          <div class="mp-plan-name">${esc(p.name||'Workout Plan')}</div>
          <div class="mp-plan-meta"><span class="mp-badge${isSelf?' badge-self':' badge-trainer'}">${isSelf?'SELF-CREATED':'TRAINER-ASSIGNED'}</span> ${formatDate(p.createdAt)} · by ${isSelf?'You':esc(p.trainerName||'Trainer')} · ${ex.length} exercise${ex.length!==1?'s':''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${isSelf?`<button class="btn-icon" title="Edit" onclick="editMemberPlan('${p.id}')">${iconSvg('pencil',13)}</button><button class="btn-icon btn-icon-danger" title="Delete" onclick="deleteMemberPlan('${p.id}')">${iconSvg('trash',13)}</button>`:''}
        </div>
      </div>
      <div class="mp-plan-progress"><div class="mp-plan-bar" style="width:${pct}%"></div></div>
      <div class="mp-plan-pct">${done}/${ex.length} done · ${pct}%</div>
      <div class="mp-plan-exs">
        ${ex.map((e,idx)=>`
          <label class="mp-ex-card mp-ex-row${e.done?' is-selected':''}">
            <span class="wb-cb"${e.done?' aria-checked="true"':''}></span>
            <input type="checkbox" ${e.done?'checked':''} onchange="togglePlanExercise('${p.id}',${idx},this.checked)" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px">
            <span class="mp-ex-name">${esc(e.name)}</span>
            <span class="mp-ex-sets">${esc(e.sets||'-')}×${esc(e.reps||'-')}${e.weight?` · ${esc(e.weight)}kg`:''}</span>
          </label>`).join('')}
      </div>
    </div>`;}).join('')}</div>`:`
    <div class="empty-state mp-empty">
      <span class="mp-empty-icon">${iconSvg('dumbbell',26)}</span>
      <div class="mp-empty-title">No workout plan yet</div>
      <p class="mp-empty-sub">Your trainer can assign one, or build your own in under a minute.</p>
      <button class="btn-primary mp-empty-cta" onclick="openMemberPlanForm()">${iconSvg('userPlus',14)} Create My Plan</button>
    </div>`;
  el.innerHTML=`
  <div class="table-card${_mpFormOpen?' mp-form-open':''}">
    <div class="table-header"><h3>My Plans</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${headerBtns}</div>
    </div>
    ${formHtml}
    ${_mpFormOpen?'':cardsHtml}
  </div>`;
  if(_mpFormOpen)mpUpdatePreview();
}
function openMemberPlanForm(){_mpFormOpen=true;_mpEditId=null;_mpSelected=new Set();_mpSearch='';_mpMuscle='All';_mpSets='3';_mpReps='10';_mpName='';renderMyWorkoutPlan();}
function cancelMemberPlanForm(){_mpFormOpen=false;_mpEditId=null;_mpSelected=new Set();_mpSets='3';_mpReps='10';_mpName='';renderMyWorkoutPlan();}
function mpRefreshPicker(){
  // Targeted refresh: list + chips + sidebar only — keeps search input focus/caret.
  const list=document.getElementById('mp_exList');
  if(!list){renderMyWorkoutPlan();return;}
  const lib=_mpFilterLib();
  list.innerHTML=lib.length?lib.map(_mpCardHtml).join(''):'<div class="mp-ex-empty">No exercises found</div>';
  const chips=document.getElementById('mp_chips');
  if(chips){
    const muscles=_mpMuscles();
    chips.innerHTML=muscles.map(m=>`<span class="filter-chip${m===_mpMuscle?' active':''}" onclick="mpSetFilter('${esc(m)}')">${esc(m)}</span>`).join('');
  }
  const pc=document.getElementById('mp_pickCount');
  if(pc)pc.textContent=_mpSelected.size+' selected';
  const side=document.querySelector('.mp-form-side');
  if(side){
    // Preserve stepper input values while refreshing chips/summary/foot
    const setsEl=document.getElementById('mp_sets');
    const repsEl=document.getElementById('mp_reps');
    const setsV=setsEl?setsEl.value:_mpSets;
    const repsV=repsEl?repsEl.value:_mpReps;
    side.innerHTML=_mpSideHtml();
    const s2=document.getElementById('mp_sets'); if(s2)s2.value=setsV;
    const r2=document.getElementById('mp_reps'); if(r2)r2.value=repsV;
  }
  mpUpdatePreview();
}
function mpOnSearch(v){
  _mpSearch=v;
  mpRefreshPicker();
}
function mpSetFilter(m){
  _mpMuscle=m;
  mpRefreshPicker();
}
function mpToggleEx(name){
  if(_mpSelected.has(name))_mpSelected.delete(name);
  else _mpSelected.add(name);
  mpRefreshPicker();
}
function mpClamp(n){n=parseInt(n,10);if(isNaN(n)||n<1)n=1;if(n>99)n=99;return n;}
function mpStep(field,delta){
  if(field==='sets')_mpSets=String(mpClamp(Number(_mpSets||'3')+delta));
  else _mpReps=String(mpClamp(Number(_mpReps||'10')+delta));
  const el=document.getElementById(field==='sets'?'mp_sets':'mp_reps');
  if(el)el.value=field==='sets'?_mpSets:_mpReps;
  mpUpdatePreview();
}
function mpSetRaw(field,v){
  const n=mpClamp(v);
  if(field==='sets')_mpSets=String(n);
  else _mpReps=String(n);
  mpUpdatePreview();
}
function mpUpdatePreview(){
  const el=document.getElementById('mp_preview');if(!el)return;
  const n=_mpSelected.size;
  const sets=esc(_mpSets||'3');
  const reps=esc(_mpReps||'10');
  el.innerHTML=n?`Will save <strong>${n} exercise${n>1?'s':''}</strong> · <strong>${sets}×${reps}</strong>`:'Pick at least one exercise';
  const c=document.getElementById('mp_count');if(c)c.textContent=String(n);
  const s=document.getElementById('mp_sum');if(s)s.textContent=sets+'×'+reps;
}
function saveMemberPlan(){
  const err=document.getElementById('mpError');if(err)err.style.display='none';
  const name=(_mpName||'').trim();
  const sets=(_mpSets&&String(_mpSets).trim())?String(_mpSets).trim():'3';
  const reps=(_mpReps&&String(_mpReps).trim())?String(_mpReps).trim():'10';
  const selected=[..._mpSelected];
  if(!name||!selected.length){if(err){err.textContent='Plan name and at least one exercise are required.';err.style.display='block';}return;}
  const mid=currentUser.memberId||currentUser.id;
  const exercises=selected.map(n=>({name:n,sets,reps,done:false}));
  if(_mpEditId){
    const all=WorkoutPlans.all();
    const i=all.findIndex(p=>p.id===_mpEditId);
    if(i>-1){
      // Preserve done flags where exercise name matches
      const prev=(all[i].exercises||[]);
      const exercises2=selected.map(n=>{const old=prev.find(e=>e.name===n);return{name:n,sets,reps,done:old?!!old.done:false};});
      all[i]={...all[i],name,exercises:exercises2,updatedAt:today(),updatedBy:currentUser.username};
      WorkoutPlans.save(all);
      toast('Plan updated.');
    }
  }else{
    WorkoutPlans.add({id:'WP'+uid(),trainerId:null,trainerName:'Self',memberId:mid,name,exercises,createdAt:today(),createdBy:'member',createdByName:currentUser.name});
    toast('Your plan has been created.','success');
  }
  _mpFormOpen=false;_mpEditId=null;_mpSelected=new Set();_mpSets='3';_mpReps='10';_mpName='';renderMyWorkoutPlan();
}
function editMemberPlan(id){
  const p=WorkoutPlans.one(id);if(!p)return;
  if(p.createdBy!=='member'&&!(p.trainerId==null&&p.trainerName==='Self')){toast('Only your self-created plans can be edited.','error');return;}
  _mpFormOpen=true;_mpEditId=id;_mpSearch='';_mpMuscle='All';_mpName=p.name||'';
  _mpSelected=new Set((p.exercises||[]).map(e=>e.name));
  const first=(p.exercises||[])[0];
  _mpSets=first&&first.sets?String(first.sets):'3';
  _mpReps=first&&first.reps?String(first.reps):'10';
  renderMyWorkoutPlan();
}
function deleteMemberPlan(id){
  const p=WorkoutPlans.one(id);if(!p)return;
  if(p.createdBy!=='member'&&!(p.trainerId==null&&p.trainerName==='Self')){toast('Only your self-created plans can be deleted.','error');return;}
  openConfirm('Delete Plan','Remove your self-created plan "'+esc(p.name)+'"? This cannot be undone.',()=>{
    WorkoutPlans.remove(id);
    toast('Plan deleted.');
    renderMyWorkoutPlan();
  },'Delete','btn-danger');
}
function togglePlanExercise(planId,idx,checked){
  const all=WorkoutPlans.all(); const i=all.findIndex(p=>p.id===planId); if(i<0) return;
  if(all[i].exercises&&all[i].exercises[idx]){
    // Immutable replace of the plan (and its exercises array) so pushCollection can diff
    const exercises=all[i].exercises.map((e,j)=>j===idx?{...e,done:checked}:e);
    all[i]={...all[i],exercises};
    WorkoutPlans.save(all); renderMyWorkoutPlan(); toast(checked?'Exercise marked done':'Unchecked');
  }
}
function renderMyWorkouts(){
  const el=document.getElementById('panelMyWorkouts'); if(!el) return;
  const mid=currentUser.memberId||currentUser.id;
  const list=Workouts.all().filter(w=>w.memberId===mid).sort((a,b)=> (b.date||'').localeCompare(a.date||'') );
  el.innerHTML=`
  <div class="table-card" style="margin-bottom:16px"><div class="table-header"><h3>Add Workout Entry</h3></div>
    <div style="padding:16px 20px;display:grid;gap:12px">
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Exercise *</label><select id="wk_exercise">${ExerciseLibrary.all().map(e=>`<option value="${esc(e.name)}">${esc(e.name)} — ${esc(e.muscle)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Date *</label><input type="date" id="wk_date" value="${today()}" max="${today()}"></div>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Sets</label><input type="number" id="wk_sets" placeholder="3" min="1"></div>
        <div class="form-group"><label>Reps</label><input type="number" id="wk_reps" placeholder="10" min="1"></div>
        <div class="form-group"><label>Weight (kg)</label><input type="number" id="wk_weight" placeholder="40" step="0.5"></div>
        <div class="form-group"><label>Duration (min)</label><input type="number" id="wk_duration" placeholder="45" min="1"></div>
      </div>
      <div class="form-group"><label>Notes</label><input type="text" id="wk_notes" placeholder="How did it feel?"></div>
      <div style="display:flex;gap:8px"><button class="btn-primary" onclick="addWorkoutEntry()">Save Workout</button><button class="btn-secondary" onclick="renderMyWorkouts()">Clear</button></div>
      <div id="wkError" class="error-msg" style="display:none"></div>
    </div>
  </div>
  <div class="table-card"><div class="table-header"><h3>Workout History <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${list.length} entries • streak: ${calcStreak(mid)} days</span></h3></div>
  ${list.length?`<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Exercise</th><th>Sets×Reps</th><th>Weight</th><th>Duration</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${list.map(w=>`<tr><td>${formatDate(w.date)}</td><td>${esc(w.exercise)}</td><td>${esc(w.sets||'-')}×${esc(w.reps||'-')}</td><td>${w.weight?esc(w.weight)+' kg':'-'}</td><td>${w.duration?w.duration+' min':'-'}</td><td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.notes||'-')}</td><td><button class="btn-icon" title="Delete" style="color:var(--red);border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)" onclick="deleteWorkout('${w.id}')">${iconSvg('trash',12)}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state" style="padding:30px"><div class="empty-icon">📋</div><p>No workouts logged yet</p></div>`}
  </div>`;
}
function calcStreak(memberId){
  const dates=[...new Set(Workouts.all().filter(w=>w.memberId===memberId).map(w=>w.date))].sort().reverse();
  if(!dates.length) return 0; let streak=1; let d=new Date(dates[0]); for(let i=1;i<dates.length;i++){ const prev=new Date(d); prev.setDate(prev.getDate()-1); if(dates[i]===prev.toISOString().split('T')[0]){ streak++; d=prev; } else break; } return streak;
}
function addWorkoutEntry(){
  const err=document.getElementById('wkError'); if(err) err.style.display='none';
  const mid=currentUser.memberId||currentUser.id;
  const exercise=document.getElementById('wk_exercise')?document.getElementById('wk_exercise').value.trim():'';
  const date=document.getElementById('wk_date')?document.getElementById('wk_date').value:'';
  const sets=document.getElementById('wk_sets')?document.getElementById('wk_sets').value.trim():'';
  const reps=document.getElementById('wk_reps')?document.getElementById('wk_reps').value.trim():'';
  const weight=document.getElementById('wk_weight')?document.getElementById('wk_weight').value.trim():'';
  const duration=document.getElementById('wk_duration')?document.getElementById('wk_duration').value.trim():'';
  const notes=document.getElementById('wk_notes')?document.getElementById('wk_notes').value.trim():'';
  if(!exercise||!date){ if(err){err.textContent='Please select exercise and date.';err.style.display='block';} return; }
  Workouts.add({id:'WO'+uid(),memberId:mid,exercise,date,sets,reps,weight,duration,notes,createdAt:today()});
  toast('Workout saved.'); renderMyWorkouts();
}
function deleteWorkout(id){ openConfirm('Delete Workout','Remove this workout entry?',()=>{ Workouts.remove(id); renderMyWorkouts(); toast('Deleted.'); },'Delete','btn-danger'); }
function renderMyProgress(){
  const el=document.getElementById('panelMyProgress'); if(!el) return;
  const mid=currentUser.memberId||currentUser.id;
  const list=Measurements.all().filter(m=>m.memberId===mid).sort((a,b)=>a.date.localeCompare(b.date));
  const latest=list.slice(-1)[0];
  el.innerHTML=`
  <div class="table-card" style="margin-bottom:16px"><div class="table-header"><h3>Log Measurement</h3></div>
    <div style="padding:16px 20px;display:grid;gap:12px">
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Weight (kg) *</label><input type="number" id="ms_weight" placeholder="70" step="0.1"></div>
        <div class="form-group"><label>Body Fat %</label><input type="number" id="ms_fat" placeholder="15" step="0.1"></div>
        <div class="form-group"><label>Muscle Mass (kg)</label><input type="number" id="ms_muscle" placeholder="35" step="0.1"></div>
      </div>
      <div class="form-group"><label>Date *</label><input type="date" id="ms_mdate" value="${today()}" max="${today()}"></div>
      <button class="btn-primary" onclick="addMeasurement()">Save Measurement</button>
      <div id="msMError" class="error-msg" style="display:none"></div>
    </div>
  </div>
  <div class="charts-grid">
    <div class="chart-card"><div class="chart-title">Weight Trend ${latest?`— Latest: ${latest.weight} kg on ${formatDate(latest.date)}`:''}</div>
      ${list.length?`<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:10px 0">${list.slice(-8).map(m=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"><div style="width:100%;background:linear-gradient(180deg,var(--green),var(--orange-dark));border-radius:6px 6px 0 0;height:${Math.max(8, (Number(m.weight)||0)/Math.max(...list.map(x=>Number(x.weight)||1))*80)}px"></div><span style="font-size:9px;color:var(--gray-500)">${m.date.slice(5)}</span></div>`).join('')}</div>`:`<div class="empty-state" style="padding:20px"><p>No measurements yet</p></div>`}
    </div>
    <div class="table-card"><div class="table-header"><h3>History <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${list.length} records</span></h3></div>
      ${list.length?`<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Weight</th><th>Body Fat</th><th>Muscle</th><th></th></tr></thead><tbody>${list.slice().reverse().map(m=>`<tr><td>${formatDate(m.date)}</td><td>${esc(m.weight||'-')} kg</td><td>${esc(m.bodyFat||'-')}${m.bodyFat?'%':''}</td><td>${esc(m.muscle||'-')} kg</td><td><button class="btn-icon" onclick="deleteMeasurement('${m.id}')">${iconSvg('trash',12)}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state" style="padding:20px"><p>No records</p></div>`}
    </div>
  </div>`;
}
function addMeasurement(){
  const err=document.getElementById('msMError'); if(err) err.style.display='none';
  const mid=currentUser.memberId||currentUser.id;
  const weight=document.getElementById('ms_weight')?document.getElementById('ms_weight').value.trim():'';
  const fat=document.getElementById('ms_fat')?document.getElementById('ms_fat').value.trim():'';
  const muscle=document.getElementById('ms_muscle')?document.getElementById('ms_muscle').value.trim():'';
  const date=document.getElementById('ms_mdate')?document.getElementById('ms_mdate').value:'';
  if(!weight||!date){ if(err){err.textContent='Weight and date are required.';err.style.display='block';} return; }
  Measurements.add({id:'MS'+uid(),memberId:mid,date,weight,bodyFat:fat,muscle,createdAt:today()});
  toast('Measurement saved.'); renderMyProgress();
}
function deleteMeasurement(id){ openConfirm('Delete Measurement','Remove this record?',()=>{ Measurements.remove(id); renderMyProgress(); toast('Deleted.'); },'Delete','btn-danger'); }
function renderMyGoals(){
  const el=document.getElementById('panelMyGoals'); if(!el) return;
  const mid=currentUser.memberId||currentUser.id;
  const list=Goals.all().filter(g=>g.memberId===mid).sort((a,b)=>a.deadline.localeCompare(b.deadline));
  el.innerHTML=`
  <div class="table-card" style="margin-bottom:16px"><div class="table-header"><h3>Add Goal</h3></div>
    <div style="padding:16px 20px;display:grid;gap:12px">
      <div class="form-group"><label>Goal *</label><input type="text" id="goal_title" placeholder="e.g. Lose 5kg by December"></div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Target Value *</label><input type="number" id="goal_target" placeholder="5"></div>
        <div class="form-group"><label>Current</label><input type="number" id="goal_current" placeholder="0"></div>
        <div class="form-group"><label>Deadline</label><input type="date" id="goal_deadline"></div>
      </div>
      <button class="btn-primary" onclick="addGoal()">Add Goal</button>
      <div id="goalError" class="error-msg" style="display:none"></div>
    </div>
  </div>
  <div class="table-card"><div class="table-header"><h3>My Goals <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${list.length} goal(s)</span></h3></div>
    ${list.length?`<div style="display:grid;gap:12px;padding:16px 20px">${list.map(g=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="font-weight:700;color:var(--white);font-size:13px">${esc(g.title)}</div><button class="btn-icon" onclick="deleteGoal('${g.id}')">${iconSvg('trash',12)}</button></div><div style="font-size:11px;color:var(--gray-500);margin-top:4px">${g.current||0} / ${g.target} • deadline ${g.deadline?formatDate(g.deadline):'—'}</div><div style="margin-top:8px;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Goal.wrap(g).progressPct}%;background:linear-gradient(90deg,var(--green),var(--orange));border-radius:4px;transition:.3s"></div></div><div style="font-size:10px;color:var(--gray-500);margin-top:4px">${Goal.wrap(g).progressPct}% • <a onclick="updateGoalProgress('${g.id}')" style="color:var(--green);cursor:pointer;text-decoration:underline">Update progress</a></div></div>`).join('')}</div>`:`<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">⭐</div><p>No goals yet</p></div>`}
  </div>`;
}
function addGoal(){
  const err=document.getElementById('goalError'); if(err) err.style.display='none';
  const mid=currentUser.memberId||currentUser.id;
  const title=document.getElementById('goal_title')?document.getElementById('goal_title').value.trim():'';
  const target=document.getElementById('goal_target')?document.getElementById('goal_target').value.trim():'';
  const current=document.getElementById('goal_current')?document.getElementById('goal_current').value.trim():'0';
  const deadline=document.getElementById('goal_deadline')?document.getElementById('goal_deadline').value:'';
  if(!title||!target){ if(err){err.textContent='Goal and target are required.';err.style.display='block';} return; }
  Goals.add({id:'GO'+uid(),memberId:mid,title,target,current,deadline,createdAt:today()});
  toast('Goal added.'); renderMyGoals();
}
function deleteGoal(id){ openConfirm('Delete Goal','Remove this goal?',()=>{ Goals.remove(id); renderMyGoals(); toast('Deleted.'); },'Delete','btn-danger'); }
function updateGoalProgress(id){
  const g=Goals.one(id); if(!g) return;
  const val=prompt('Enter current value (target '+g.target+')', g.current||'0'); if(val===null) return;
  const all=Goals.all(); const idx=all.findIndex(x=>x.id===id); if(idx<0) return; all[idx].current=String(val).trim(); Goals.save(all); renderMyGoals(); toast('Progress updated.');
}
const _exDefaultDemos={
  'barbell squat':{gif:'assets/exercise-demos/barbell-squat.gif',credit:'© Gym visual'},
  'bench press':{gif:'assets/exercise-demos/bench-press.gif',credit:'© Gym visual'},
  'deadlift':{gif:'assets/exercise-demos/deadlift.gif',credit:'© Gym visual'},
  'pull-up':{gif:'assets/exercise-demos/pull-up.gif',credit:'© Gym visual'},
  'shoulder press':{gif:'assets/exercise-demos/shoulder-press.gif',credit:'© Gym visual'},
  'plank':{gif:'assets/exercise-demos/plank.gif',credit:'© Gym visual'},
  'lunges':{gif:'assets/exercise-demos/lunges.gif',credit:'© Gym visual'},
  'bicep curl':{gif:'assets/exercise-demos/bicep-curl.gif',credit:'© Gym visual'},
  'triceps dip':{gif:'assets/exercise-demos/triceps-dip.gif',credit:'© Gym visual'},
  'treadmill run':{gif:'assets/exercise-demos/treadmill-run.gif',credit:'© Gym visual'},
  'leg press':{gif:'assets/exercise-demos/leg-press.gif',credit:'© Gym visual'},
  'lat pulldown':{gif:'assets/exercise-demos/lat-pulldown.gif',credit:'© Gym visual'}
};
function _exMediaFor(e){
  if(!e) return null;
  if(e.apiId&&_wxMediaMap&&_wxMediaMap[e.apiId]) return _wxMediaMap[e.apiId];
  const key=_wxNameKey(e.name);
  if(key&&_exDefaultDemos[key]) return _exDefaultDemos[key];
  return (e.name&&_wxMediaByName&&_wxMediaByName[key])||null;
}
function _exCardHtml(e){
  const media=_exMediaFor(e);
  const hasMedia=!!(media&&(media.mp4||media.gif));
  const isGif=!!(media&&media.gif&&!media.mp4);
  const poster=hasMedia?esc(media.poster||media.gif):'';
  const mc=_wbMuscleColors[e.muscle]||'m-default';
  const pending=!!(e.apiId&&_wxMediaLoading&&!_wxMediaMap);
  const mediaHtml=hasMedia
    ? `<span class="ex-card-media${isGif?' is-gif':''}"><img class="ex-card-poster" src="${poster}" alt="" loading="lazy" decoding="async" width="300" height="360">${isGif?'<span class="ex-card-wm">Animated</span>':(media.watermarked?'<span class="ex-card-wm">Preview</span>':'')}${isGif?'':`<span class="ex-card-play" aria-hidden="true"></span>`}</span>`
    : `<span class="ex-card-media ${pending?'is-loading':'is-no-media'}"><span class="ex-card-noMedia" aria-hidden="true">${pending?'Loading demo':'No demo'}</span></span>`;
  return `<button type="button" class="ex-card${hasMedia?' is-video':' is-no-media'}" data-ex-id="${esc(e.id)}" aria-haspopup="dialog" aria-label="${esc(e.name)}, ${esc(e.muscle||'Exercise')}, ${hasMedia?(isGif?'animated demonstration':'video demonstration'):'details only'}">${mediaHtml}<span class="ex-card-body"><span class="ex-card-title">${esc(e.name)}</span><span class="ex-card-tags"><span class="wb-muscle-pill ${mc}">${esc(e.muscle||'Other')}</span><span class="wb-muscle-pill m-default">${esc(e.equipment||'Bodyweight')}</span><span class="wb-muscle-pill ex-tag-level">${esc(e.level||'Intermediate')}</span></span><span class="ex-card-desc">${esc(e.desc||'')}</span></span></button>`;
}
function _exGridHtml(list){
  if(!list.length) return '<div class="ex-empty"><p>No exercises match.</p></div>';
  return list.map(_exCardHtml).join('');
}
async function loadWorkoutXMedia(force){
  if(_wxMediaLoading) return;
  if(_wxMediaMap&&!force) return;
  _wxMediaLoading=true;
  _wxMediaError='';
  const base=String(window.WORKOUTX_API_BASE||'').replace(/\/$/,'');
  try{
    if(!base&&/\.github\.io$/i.test(location.hostname)) throw new Error('Set window.WORKOUTX_API_BASE to the Vercel API URL.');
    const res=await fetch(base+'/api/exercises',{cache:force?'reload':'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const list=Array.isArray(data.exercises)?data.exercises:[];
    if(!list.length) throw new Error('No exercises returned.');
    const map={},byName={};
    list.forEach(ex=>{
      if(!ex.media||!ex.media.mp4) return;
      if(ex.apiId) map[ex.apiId]=ex.media;
      if(ex.name) byName[_wxNameKey(ex.name)]=ex.media;
    });
    _wxMediaMap=map;
    _wxMediaByName=byName;
    // Normally the static seed already added the 50. Only use the API
    // metadata as a fallback when the static file could not load.
    const hasStatic=Array.isArray(window.WORKOUTX_EXERCISES)&&window.WORKOUTX_EXERCISES.length;
    if(!hasStatic&&!ExerciseLibrary.all().some(e=>e.apiId)) mergeWorkoutXExercises(list);
  }catch(e){
    _wxMediaError=/\.github\.io$/i.test(location.hostname)&&!base
      ?'Video demos need the Vercel API URL. Set window.WORKOUTX_API_BASE.'
      :'Video demos are unavailable right now.';
  }finally{
    _wxMediaLoading=false;
    if(document.getElementById('panelExerciseLibrary')) renderExerciseLibrary();
  }
}
function _exSearchTerms(q){return String(q||'').toLowerCase().split(/\s+/).filter(Boolean);}
function _exMatchesTerms(e,terms){
  const text=`${e.name||''} ${e.muscle||''} ${e.equipment||''} ${e.level||''} ${e.target||''} ${e.bodyPart||''} ${e.desc||''}`.toLowerCase();
  return terms.every(t=>text.includes(t));
}
function renderExerciseLibrary(){
  const el=document.getElementById('panelExerciseLibrary'); if(!el) return;
  seedExerciseLibrary();
  if(!_wxMediaMap&&!_wxMediaLoading&&!_wxMediaError) loadWorkoutXMedia();
  const terms=_exSearchTerms(window._exLibQuery);
  let list=ExerciseLibrary.all();
  if(terms.length) list=list.filter(e=>_exMatchesTerms(e,terms));
  const animated=list.filter(e=>_exMediaFor(e)).length;
  const countText=`${list.length} exercise${list.length===1?'':'s'}${animated?` · ${animated} animated`:''}`;
  const notice=_wxMediaError
    ?`<div class="ex-notice" role="status">${esc(_wxMediaError)} <button type="button" class="ex-notice-retry" data-ex-retry>Retry</button></div>`
    :(_wxMediaLoading&&!_wxMediaMap?`<div class="ex-notice" role="status">Loading video demos...</div>`:'');
  let grid=document.getElementById('exGrid');
  if(!grid){
    el.innerHTML=`<div class="table-card"><div class="table-header ex-lib-head"><h3>Exercise Library <span id="exCount" class="ex-count" aria-live="polite">${esc(countText)}</span></h3><input type="text" id="exSearch" placeholder="Search name, muscle, or equipment..." value="${esc(window._exLibQuery||'')}" oninput="window._exLibQuery=this.value; clearTimeout(window._exSearchTimer); window._exSearchTimer=setTimeout(renderExerciseLibrary,120)" class="search-input ex-search" aria-label="Search exercises"></div><div id="exNotice">${notice}</div><div id="exGrid" class="ex-grid">${_exGridHtml(list)}</div></div>`;
    grid=document.getElementById('exGrid');
  }else{
    const count=document.getElementById('exCount'); if(count) count.textContent=countText;
    const noticeEl=document.getElementById('exNotice'); if(noticeEl) noticeEl.innerHTML=notice;
    grid.innerHTML=_exGridHtml(list);
  }
  if(grid) grid.setAttribute('aria-busy',_wxMediaLoading?'true':'false');
  if(!el._exClickBound){
    el._exClickBound=true;
    el.addEventListener('click',function(ev){
      const retry=ev.target.closest('[data-ex-retry]');
      if(retry){ev.preventDefault();_wxMediaMap=null;_wxMediaByName=null;_wxMediaError='';loadWorkoutXMedia(true);renderExerciseLibrary();return;}
      const card=ev.target.closest('.ex-card');
      if(card){ev.preventDefault();openExerciseMedia(card.dataset.exId);}
    });
  }
}
let _exReturnFocus=null;
function openExerciseMedia(id){
  const ex=ExerciseLibrary.one(id);
  if(!ex) return;
  _exReturnFocus=document.activeElement;
  const media=_exMediaFor(ex);
  const title=document.getElementById('exMediaTitle');
  if(title) title.textContent=ex.name||'Exercise';
  const body=document.getElementById('exMediaBody');
  if(!body) return;
  const mc=_wbMuscleColors[ex.muscle]||'m-default';
  const tags=`<div class="ex-card-tags ex-modal-tags"><span class="wb-muscle-pill ${mc}">${esc(ex.muscle||'Other')}</span><span class="wb-muscle-pill m-default">${esc(ex.equipment||'Bodyweight')}</span><span class="wb-muscle-pill ex-tag-level">${esc(ex.level||'Intermediate')}</span></div>`;
  const pending=!!(ex.apiId&&_wxMediaLoading&&!_wxMediaMap);
  const isVideo=!!(media&&media.mp4);
  const isGif=!!(media&&media.gif&&!isVideo);
  const video=isVideo
    ?`<div class="ex-player" id="exPlayer"><video id="exModalVideo" class="ex-video" src="${esc(media.mp4)}" playsinline muted loop autoplay preload="auto" aria-label="${esc(ex.name)} demonstration, silent loop"></video><div class="ex-player-loading" id="exPlayerLoading"><span class="ex-spinner"></span><span>Loading demo</span></div></div>`
    :isGif
      ?`<div class="ex-player ex-player-gif" id="exPlayer"><img id="exModalGif" class="ex-video ex-gif" src="${esc(media.gif)}" alt="${esc(ex.name)} animated demonstration" width="180" height="180" decoding="async"></div>`
      :`<div class="ex-player ex-player-empty"><span>${pending?'Video is still loading. Try again in a moment.':'Demo not available for this exercise.'}</span></div>`;
  const caption=isVideo
    ?`<div class="ex-player-caption" id="exPlayerCaption"><span class="ex-loop-dot" aria-hidden="true"></span>Silent demo · loops continuously</div>`
    :isGif
      ?`<div class="ex-player-caption" id="exPlayerCaption"><span class="ex-loop-dot" aria-hidden="true"></span>Animated demo · ${esc(media.credit||'loops continuously')}</div>`
      :'';
  const instructions=Array.isArray(ex.instructions)&&ex.instructions.length
    ?`<div class="ex-modal-section"><h4>How to do it</h4><ol>${ex.instructions.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>`:'';
  const tips=Array.isArray(ex.tips)&&ex.tips.length
    ?`<div class="ex-modal-section"><h4>Form tips</h4><ul>${ex.tips.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`:'';
  const facts=`<div class="ex-modal-facts"><span><b>Muscle</b>${esc(ex.muscle||'-')}</span><span><b>Equipment</b>${esc(ex.equipment||'-')}</span><span><b>Level</b>${esc(ex.level||'-')}</span>${ex.recommendedSets?`<span><b>Sets</b>${esc(ex.recommendedSets)}</span>`:''}${ex.recommendedReps?`<span><b>Reps</b>${esc(ex.recommendedReps)}</span>`:''}</div>`;
  body.innerHTML=`<div class="ex-modal-stage">${video}${caption}</div><div class="ex-modal-info">${tags}<p class="ex-modal-desc">${esc(ex.desc||'')}</p>${facts}${instructions}${tips}</div>`;
  openModal('exerciseMediaModal');
  const v=document.getElementById('exModalVideo');
  if(v){
    const wrap=document.getElementById('exPlayer');
    const loading=document.getElementById('exPlayerLoading');
    const hideLoading=()=>{if(loading)loading.classList.add('is-hidden');};
    v.muted=true;
    v.defaultMuted=true;
    v.playsInline=true;
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.addEventListener('playing',()=>{hideLoading();if(wrap)wrap.dataset.looping='1';},{once:true});
    // The demo is a loop, not a player: if anything pauses it, resume while open.
    v.addEventListener('pause',()=>{
      if(wrap&&wrap.dataset.looping==='1'&&!v.ended&&document.getElementById('exerciseMediaModal').classList.contains('open'))v.play().catch(()=>{});
    });
    v.addEventListener('error',()=>{
      if(wrap){wrap.classList.add('is-error');wrap.innerHTML='<div class="ex-player-error"><strong>Demo unavailable</strong><span>Refresh the page to reload the demo.</span></div>';}
      const cap=document.getElementById('exPlayerCaption');if(cap){cap.innerHTML='<span class="ex-loop-dot is-off" aria-hidden="true"></span>Demo unavailable';}
    },{once:true});
    const begin=()=>{
      v.muted=true;
      const p=v.play();
      if(!p||typeof p.then!=='function')return;
      p.then(()=>{if(wrap)wrap.dataset.looping='1';}).catch(()=>{});
    };
    if(wrap)wrap.addEventListener('click',begin);
    v.addEventListener('canplay',begin,{once:true});
    v.addEventListener('canplaythrough',begin,{once:true});
    v.addEventListener('loadedmetadata',begin,{once:true});
    v.addEventListener('loadeddata',()=>{hideLoading();begin();},{once:true});
    begin();
  }
  setTimeout(()=>{const btn=document.querySelector('#exerciseMediaModal .modal-close');if(btn)btn.focus({preventScroll:true});},0);
}
function closeExerciseMedia(){
  const wrap=document.getElementById('exPlayer');
  if(wrap)wrap.dataset.looping='0';
  const g=document.getElementById('exModalGif');
  if(g)g.removeAttribute('src');
  const v=document.getElementById('exModalVideo');
  if(v){try{v.pause();v.removeAttribute('src');v.load();}catch(e){}}
  closeModal('exerciseMediaModal');
  if(_exReturnFocus&&document.body.contains(_exReturnFocus)){try{_exReturnFocus.focus({preventScroll:true});}catch(e){}}
  _exReturnFocus=null;
}
/* ====== EXERCISE PICKER STATE ====== */
let _wbSelected=new Set(),_wbSearch='',_wbMuscle='All';
const _wbMuscleColors={Legs:'m-legs',Back:'m-back',Chest:'m-chest',Shoulders:'m-shoulders',Core:'m-core',Arms:'m-arms',Cardio:'m-cardio'};
function _wbMuscles(){return['All',...new Set(ExerciseLibrary.all().map(e=>e.muscle))];}
function _wbFiltered(){let list=ExerciseLibrary.all();const q=_wbSearch.toLowerCase();if(q)list=list.filter(e=>`${e.name} ${e.muscle} ${e.equipment} ${e.level} ${e.desc}`.toLowerCase().includes(q));if(_wbMuscle!=='All')list=list.filter(e=>e.muscle===_wbMuscle);return list;}
window.wbToggle=function(name){if(_wbSelected.has(name))_wbSelected.delete(name);else _wbSelected.add(name);_wbRenderList();_wbRenderSummary();};
window.wbRemove=function(name){_wbSelected.delete(name);_wbRenderList();_wbRenderSummary();};
window.wbClear=function(){_wbSelected.clear();_wbRenderList();_wbRenderSummary();};
window.wbSetFilter=function(muscle,el){_wbMuscle=muscle;document.querySelectorAll('.wb-muscle-chips .filter-chip').forEach(c=>c.classList.remove('active'));if(el)el.classList.add('active');_wbRenderList();};
window.wbOnSearch=function(q){_wbSearch=q;_wbRenderList();};
function _wbRenderSummary(){
  const el=document.getElementById('wb_selSummary');if(!el)return;
  const n=_wbSelected.size;if(!n){el.innerHTML='';return;}
  const chips=[..._wbSelected].map(name=>`<span class="wb-sel-chip">${esc(name)}<button onclick="wbRemove('${esc(name)}')">&times;</button></span>`).join('');
  el.innerHTML=`<span class="wb-selected-count">${n} exercise${n>1?'s':''} selected</span>${chips}${n>1?`<span class="wb-sel-clear" onclick="wbClear()">Clear all</span>`:''}`;
}
function _wbRenderList(){
  const el=document.getElementById('wb_exList');if(!el)return;
  const list=_wbFiltered();
  if(!list.length){el.innerHTML=`<div class="wb-ex-empty">No exercises match your filter.</div>`;return;}
  el.innerHTML=list.map(e=>{
    const sel=_wbSelected.has(e.name);
    const mc=_wbMuscleColors[e.muscle]||'m-default';
    return `<label class="wb-ex-row${sel?' is-selected':''}" onclick="wbToggle('${esc(e.name)}')"><span class="wb-cb"></span><span class="wb-ex-name">${esc(e.name)}</span><span class="wb-muscle-pill ${mc}">${esc(e.muscle)}</span></label>`;
  }).join('');
  // Check scroll position for fade hint
  el.classList.toggle('at-bottom',el.scrollTop+el.clientHeight>=el.scrollHeight-4);
}
function renderWorkoutBuilder(){
  const el=document.getElementById('panelWorkoutBuilder'); if(!el) return;
  const trainerId=currentUser.id;
  const members=Members.all().filter(m=>m.status!=='Archived');
  _wbSearch='';_wbMuscle='All';_wbSelected.clear();
  const muscles=_wbMuscles();
  el.innerHTML=`
  <div class="table-card" style="margin-bottom:16px"><div class="table-header"><h3>Create Workout Plan</h3></div>
    <div style="padding:16px 20px;display:grid;gap:12px">
      <div class="form-group"><label>Select Member *</label><select id="wb_member">${members.map(m=>`<option value="${m.id}">${esc(m.name)} — ${esc(m.id)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Plan Name *</label><input type="text" id="wb_name" placeholder="e.g. 4-week Strength Foundation"></div>
      <div class="form-group">
        <label>Exercises *</label>
        <div class="wb-pick-toolbar"><input type="text" class="search-input" placeholder="Search exercises..." oninput="wbOnSearch(this.value)"></div>
        <div class="wb-muscle-chips">${muscles.map(m=>`<span class="filter-chip${m==='All'?' active':''}" onclick="wbSetFilter('${esc(m)}',this)">${esc(m)}</span>`).join('')}</div>
        <div id="wb_selSummary" class="wb-selected-bar"></div>
        <div id="wb_exList" class="wb-ex-list" onscroll="this.classList.toggle('at-bottom',this.scrollTop+this.clientHeight>=this.scrollHeight-4)"></div>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Sets</label><input type="number" id="wb_sets" placeholder="3"></div>
        <div class="form-group"><label>Reps</label><input type="number" id="wb_reps" placeholder="10"></div>
      </div>
      <div class="form-group"><label>Notes</label><input type="text" id="wb_notes" placeholder="Focus on form, rest 60s"></div>
      <button class="btn-primary" onclick="createWorkoutPlan()">Assign Plan to Member</button>
      <div id="wbError" class="error-msg" style="display:none"></div>
    </div>
  </div>
  <div class="table-card"><div class="table-header"><h3>Assigned Plans <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${WorkoutPlans.all().filter(p=>p.trainerId===trainerId).length} plan(s)</span></h3></div>
    ${WorkoutPlans.all().filter(p=>p.trainerId===trainerId).length?`<div style="padding:16px 20px;display:grid;gap:10px">${WorkoutPlans.all().filter(p=>p.trainerId===trainerId).map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 14px"><div><div style="font-weight:700;color:var(--white);font-size:13px">${esc(p.name)}</div><div style="font-size:11px;color:var(--gray-500)">${esc((Members.one(p.memberId)||{}).name||p.memberId)} • ${p.exercises? p.exercises.length:0} exercises • ${formatDate(p.createdAt)}</div></div><button class="btn-icon" onclick="deleteWorkoutPlan('${p.id}')">${iconSvg('trash',12)}</button></div>`).join('')}</div>`:`<div class="empty-state" style="padding:30px"><p>No plans yet</p></div>`}
  </div>`;
  _wbRenderList();
}
function createWorkoutPlan(){
  const err=document.getElementById('wbError'); if(err) err.style.display='none';
  const memberId=document.getElementById('wb_member')?document.getElementById('wb_member').value:'';
  const name=document.getElementById('wb_name')?document.getElementById('wb_name').value.trim():'';
  const sets=document.getElementById('wb_sets')?document.getElementById('wb_sets').value.trim():'3';
  const reps=document.getElementById('wb_reps')?document.getElementById('wb_reps').value.trim():'10';
  const selected=[..._wbSelected];
  if(!memberId||!name||!selected.length){ if(err){err.textContent='Member, plan name and at least one exercise are required.';err.style.display='block';} return; }
  const exercises=selected.map(n=>({name:n,sets,reps,done:false}));
  WorkoutPlans.add({id:'WP'+uid(),trainerId:currentUser.id,trainerName:currentUser.name,memberId,name,exercises,createdAt:today()});
  toast('Workout plan assigned.'); renderWorkoutBuilder();
}
function deleteWorkoutPlan(id){ openConfirm('Delete Plan','Remove this workout plan?',()=>{ WorkoutPlans.remove(id); renderWorkoutBuilder(); toast('Deleted.'); },'Delete','btn-danger'); }
function renderMemberLogs(){
  const el=document.getElementById('panelMemberLogs'); if(!el) return;
  const trainerId=currentUser.id;
  const myPlans=WorkoutPlans.all().filter(p=>p.trainerId===trainerId);
  const memberIds=[...new Set(myPlans.map(p=>p.memberId))];
  const members=memberIds.map(id=>Members.one(id)).filter(Boolean);
  el.innerHTML=`
  <div class="table-card"><div class="table-header"><h3>Assigned Members — Logs</h3></div>
    ${members.length?`<div style="padding:16px 20px;display:grid;gap:16px">${members.map(m=>{
      const wos=Workouts.all().filter(w=>w.memberId===m.id).slice(-5).reverse();
      const ms=Measurements.all().filter(x=>x.memberId===m.id).slice(-1)[0];
      const plans=myPlans.filter(p=>p.memberId===m.id);
      return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="font-weight:800;color:var(--white);font-size:14px">${esc(m.name)} <span style="font-size:11px;color:var(--gray-500)">(${esc(m.id)} • ${esc(m.status)})</span></div><span style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(127,250,136,.12);color:var(--green)">${plans.length} plan(s) • ${wos.length} workouts</span></div>
        ${ms?`<div style="font-size:11px;color:var(--gray-500);margin-top:4px">Latest measurement: ${ms.weight} kg on ${formatDate(ms.date)}</div>`:''}
        ${wos.length?`<div style="margin-top:10px;display:grid;gap:6px">${wos.map(w=>`<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,.2);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--gray-300)"><span><strong style="color:var(--white)">${esc(w.exercise)}</strong> ${w.sets}×${w.reps} ${w.weight?w.weight+'kg':''} • ${formatDate(w.date)}</span><span style="font-size:10px;color:var(--gray-500)">${esc(w.duration||'')} ${w.duration?'min':''}</span></div>`).join('')}</div>`:`<div style="font-size:12px;color:var(--gray-500);margin-top:8px">No workouts logged yet</div>`}
      </div>`;
    }).join('')}</div>`:`<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">👥</div><p>No assigned members yet — assign a plan in Workout Builder</p></div>`}
  </div>`;
}
function renderMySessions(){
  const el=document.getElementById('panelMySessions'); if(!el) return;
  const mid=currentUser.memberId||currentUser.id;
  const mySessions=Sessions.all().filter(s=>s.memberId===mid).sort((a,b)=> (a.date||'').localeCompare(b.date||'') );
  const assignedTrainerId=(Members.one(mid)||{}).assignedTrainerId;
  const assignedTrainer=Users.all().find(u=>u.id===assignedTrainerId&&isBookableTrainer(u));
  const defaultType=assignedTrainer?(sessionTypesForTrainer(assignedTrainer.id)[0]||allSessionTypes()[0]):allSessionTypes()[0];
  el.innerHTML=`
  <div class="table-card" style="margin-bottom:16px"><div class="table-header"><h3>Book a Session</h3></div>
    <div style="padding:16px 20px;display:grid;gap:12px">
      <div class="form-group"><label>Session Type *</label><select id="bs_type" onchange="updateBsTrainerOptions()">${allSessionTypes().map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Trainer *</label>
        <input type="text" id="bs_trainerSearch" placeholder="Search trainer..." oninput="bsFilterTrainers(this.value)" onclick="bsFilterTrainers(this.value)" autocomplete="off">
        <div id="bs_trainerList" style="background:var(--navy-700);border:1px solid var(--navy-600);border-radius:8px;max-height:220px;overflow-y:auto;display:none;position:relative;z-index:20"></div>
        <input type="hidden" id="bs_trainer">
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Date *</label><input type="date" id="bs_date" min="${today()}" value="${today()}" onchange="bsTrainerSlotChanged()"></div>
        <div class="form-group"><label>Start *</label><input type="time" id="bs_start" onchange="bsTrainerSlotChanged()"></div>
        <div class="form-group"><label>End *</label><input type="time" id="bs_end" onchange="bsTrainerSlotChanged()"></div>
      </div>
      <div style="font-size:11px;color:var(--gray-500);margin-top:-4px">Available trainers are filtered by session type, date and time — overlapping schedules are excluded.</div>
      <div id="bsAvailHint" class="sf-avail-hint" style="display:none"></div>
      <button class="btn-primary" onclick="bookSession()">Request Session</button>
      <div id="bsError" class="error-msg" style="display:none"></div>
      <div style="font-size:11px;color:var(--gray-500);line-height:1.5">Your request goes to the trainer as <strong>Pending</strong> — they will Accept or Decline. You can reschedule after decline.</div>
    </div>
  </div>
  <div class="table-card"><div class="table-header"><h3>My Sessions <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${mySessions.length} session(s)</span></h3></div>
    ${mySessions.length?`<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time</th><th>Trainer</th><th>Type</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${mySessions.map(s=>{
      const tr=Users.one(s.trainerId);
      const statusColor={Pending:'var(--gold)',Accepted:'var(--cyan)',Scheduled:'var(--cyan)',Completed:'var(--green)',Declined:'var(--red)',Cancelled:'var(--red)'}[s.status]||'var(--gray-500)';
      const actionBtn=s.status==='Declined'?`<button class="btn-secondary btn-sm" onclick="rescheduleSession('${s.id}')" style="padding:4px 10px;font-size:11px">Reschedule</button>`:`<span style="font-size:11px;color:var(--gray-500)">—</span>`;
      return `<tr><td>${formatDate(s.date)}</td><td>${esc(s.start||'')}–${esc(s.end||'')}</td><td>${esc(tr? (tr.coachName||tr.name): s.trainerName||s.trainerId)}</td><td>${esc(s.type||'-')}</td><td><span class="badge" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:${statusColor}">${esc(s.status)}</span></td><td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.progressNotes||s.notes||'-')}</td><td>${actionBtn}</td></tr>`;
    }).join('')}</tbody></table></div>`:`<div class="empty-state" style="padding:30px"><div class="empty-icon">📅</div><p>No sessions yet — book one above</p></div>`}
  </div>`;
  const typeSel=document.getElementById('bs_type');
  if(typeSel&&defaultType)typeSel.value=defaultType;
  updateBsTrainerOptions(assignedTrainerId);
}
function updateBsTrainerOptions(preferredId){
  const typeSel=document.getElementById('bs_type');
  const hidden=document.getElementById('bs_trainer');
  const search=document.getElementById('bs_trainerSearch');
  if(!typeSel||!hidden||!search)return;
  const type=typeSel.value;
  const date=document.getElementById('bs_date')?document.getElementById('bs_date').value:'';
  const start=document.getElementById('bs_start')?document.getElementById('bs_start').value:'';
  const end=document.getElementById('bs_end')?document.getElementById('bs_end').value:'';
  hidden.value='';
  search.value='';
  search.placeholder='Search available trainer...';
  // Reschedule: keep the old trainer only if they are still free for this slot.
  if(preferredId){
    const preferred=Users.one(preferredId);
    if(preferred&&isTrainerAvailable(preferred,type,date,start,end)){
      hidden.value=preferred.id;
      search.value=preferred.coachName||preferred.name;
    }
  }
  updateBsAvailability();
  bsFilterTrainers(search.value);
}
function bsTrainerSlotChanged(){
  const hidden=document.getElementById('bs_trainer');
  const search=document.getElementById('bs_trainerSearch');
  const selected=hidden&&hidden.value?Users.one(hidden.value):null;
  const type=document.getElementById('bs_type')?document.getElementById('bs_type').value:'';
  const date=document.getElementById('bs_date')?document.getElementById('bs_date').value:'';
  const start=document.getElementById('bs_start')?document.getElementById('bs_start').value:'';
  const end=document.getElementById('bs_end')?document.getElementById('bs_end').value:'';
  if(selected&&!isTrainerAvailable(selected,type,date,start,end)){
    hidden.value='';
    if(search)search.value='';
    toast('The selected trainer is no longer available for that slot. Please choose another available trainer.','info');
  }
  bsFilterTrainers(search?search.value:'');
  updateBsAvailability();
}
function selectBsTrainer(id,name){
  const hidden=document.getElementById('bs_trainer');if(hidden)hidden.value=id;
  const search=document.getElementById('bs_trainerSearch');if(search)search.value=name;
  const list=document.getElementById('bs_trainerList');if(list)list.style.display='none';
  // If the selected trainer offers a different session type, switch to their
  // first type so the saved session matches the trainer's specialization.
  const trainer=Users.one(id);
  const typeSel=document.getElementById('bs_type');
  if(trainer&&typeSel&&!sessionTypesForTrainer(id).includes(typeSel.value)){
    const types=sessionTypesForTrainer(id);
    if(types.length)typeSel.value=types[0];
  }
  updateBsAvailability();
}
function updateBsAvailability(){
  const hint=document.getElementById('bsAvailHint');
  if(!hint)return;
  const trainerId=document.getElementById('bs_trainer')?document.getElementById('bs_trainer').value:'';
  const date=document.getElementById('bs_date')?document.getElementById('bs_date').value:'';
  const start=document.getElementById('bs_start')?document.getElementById('bs_start').value:'';
  const end=document.getElementById('bs_end')?document.getElementById('bs_end').value:'';
  const type=document.getElementById('bs_type')?document.getElementById('bs_type').value:'';
  const trainer=Users.one(trainerId);
  if(!trainer){hint.style.display='none';hint.innerHTML='';return;}
  const av=trainerAvailabilityInfo(trainer,date);
  const booked=trainerBookedRanges(trainer.id,date);
  const specs=trainerSpecList(trainer);
  let html=`⏰ <strong>${esc(trainer.coachName||trainer.name)}</strong> available: ${esc(av.text)}`;
  if(specs.length)html+=`<br>🏋️ ${specs.map(esc).join(', ')}`;
  if(!av.dayOk)html+=`<br><span style="color:var(--red)">Not available on ${esc(av.dayAbbr)} — choose another date.</span>`;
  if(booked.length)html+=`<br><span style="color:var(--gold)">Booked: ${esc(booked.join(', '))}</span>`;
  if(date&&start&&end){
    if(isTrainerAvailable(trainer,type,date,start,end))html+=`<br><span style="color:var(--green)">✓ ${esc(start)}–${esc(end)} is free.</span>`;
    else html+=`<br><span style="color:var(--red)">✕ ${esc(start)}–${esc(end)} conflicts with this trainer's schedule or hours.</span>`;
  }
  hint.innerHTML=html;hint.style.display='block';
}
function bookSession(){
  const err=document.getElementById('bsError'); if(err) err.style.display='none';
  const trainerId=document.getElementById('bs_trainer')?document.getElementById('bs_trainer').value:'';
  const date=document.getElementById('bs_date')?document.getElementById('bs_date').value:'';
  const start=document.getElementById('bs_start')?document.getElementById('bs_start').value:'';
  const end=document.getElementById('bs_end')?document.getElementById('bs_end').value:'';
  const type=document.getElementById('bs_type')?document.getElementById('bs_type').value:'';
  if(!trainerId||!date||!start||!end||!type){ if(err){err.textContent='Session type, trainer, date, start and end are required.';err.style.display='block';} return; }
  if(date<today()){ if(err){err.textContent='Cannot request a session on a past date. Please choose today or a future date.';err.style.display='block';} return; }
  if(start>=end){ if(err){err.textContent='End time must be after start time.';err.style.display='block';} return; }
  const trainer=Users.one(trainerId);
  if(!trainer){ if(err){err.textContent='Trainer not found.';err.style.display='block';} return; }
  if(!isBookableTrainer(trainer)){ if(err){err.textContent='That trainer is not available for booking right now. Please choose another trainer.';err.style.display='block';} return; }
  if(!sessionTypesForTrainer(trainerId).includes(type)){ if(err){err.textContent='The selected trainer does not offer '+type+'. Please choose another type or trainer.';err.style.display='block';} return; }
  const availErr=trainerAvailabilityError(trainer,date,start,end);
  if(availErr){ if(err){err.textContent=availErr;err.style.display='block';} return; }
  const mid=currentUser.memberId||currentUser.id; const mem=Members.one(mid);
  // conflict check: same member same date overlap + trainer double-booking
  const sameDay=Sessions.all().filter(s=>s.memberId===mid&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined');
  const overlap=sameDay.some(s=> !(end<=s.start || start>=s.end) );
  if(overlap){ if(err){err.textContent='You already have a session at that time.';err.style.display='block';} return; }
  const trainerDay=Sessions.all().filter(s=>s.trainerId===trainerId&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined');
  const trainerOverlap=trainerDay.some(s=> !(end<=s.start || start>=s.end) );
  if(trainerOverlap){ if(err){err.textContent='Trainer is already booked at that time — please choose another slot.';err.style.display='block';} return; }
  if(trainerDay.length>=8){ if(err){err.textContent='Trainer is fully booked on that date — please choose another day.';err.style.display='block';} return; }
  if(sameDay.length>=3){ if(err){err.textContent='You can have at most 3 sessions per day.';err.style.display='block';} return; }
  if(!isTrainerAvailable(trainer,type,date,start,end)){ if(err){err.textContent='That trainer is no longer available for the selected slot. Please choose another available trainer or time.';err.style.display='block';} return; }
  const rlMid=String(mid);
  if(!rateLimitOk('gms_rl_book_gap_'+rlMid,1,10000)||!rateLimitOk('gms_rl_book_'+rlMid,5,10*60*1000)){
    if(err){err.textContent='Too many booking requests — please wait a few minutes.';err.style.display='block';} return;
  }
  Sessions.add({id:'SES'+uid(),memberId:mid,memberName:mem?mem.name:currentUser.name,trainerId,trainerName:trainer? (trainer.coachName||trainer.name):'',date,start,end,type,status:'Pending',progressNotes:'',notes:'',createdAt:today(),createdBy:currentUser.name});
  toast('Session request sent — awaiting trainer approval.'); renderMySessions(); updateSchedPendingBadge();
}
function rescheduleSession(id){
  const s=Sessions.one(id); if(!s) return;
  const tp=document.getElementById('bs_type');
  if(tp){
    if(![...tp.options].some(o=>o.value===s.type))tp.insertAdjacentHTML('beforeend','<option value="'+esc(s.type)+'">'+esc(s.type)+'</option>');
    tp.value=s.type;
  }
  const d=document.getElementById('bs_date'); if(d) d.value=(s.date>=today()?s.date:today());
  const st=document.getElementById('bs_start'); if(st) st.value=s.start;
  const en=document.getElementById('bs_end'); if(en) en.value=s.end;
  updateBsTrainerOptions(s.trainerId);
  window.scrollTo({top:0,behavior:'smooth'});
  const el=document.getElementById('bs_trainerSearch'); if(el) el.focus();
  toast('Prefilled previous session — adjust time and request again.');
}
function acceptSession(id){
  const all=Sessions.all(); const i=all.findIndex(s=>s.id===id); if(i<0)return;
  const s=all[i];
  const live=all.filter(x=>x.id!==id&&x.date===s.date&&x.status!=='Cancelled'&&x.status!=='Declined'&&x.status!=='Pending');
  if(live.some(x=>x.trainerId===s.trainerId&&!(s.end<=x.start||s.start>=x.end))){toast('Cannot accept — this trainer already has a session at that time.','error');return;}
  if(live.some(x=>x.memberId===s.memberId&&!(s.end<=x.start||s.start>=x.end))){toast('Cannot accept — this member already has a session at that time.','error');return;}
  all[i]={...s,status:'Scheduled'};
  Sessions.save(all);
  if(window.GMSFB&&GMSFB.enabled) GMSFB.pushCollection(KEY.sessions, all);
  toast('Session accepted.'); renderSchedule(); updateSchedPendingBadge();
}
function declineSession(id){ openConfirm('Decline Session','Decline this session request?',()=>{ const all=Sessions.all(); const i=all.findIndex(s=>s.id===id); if(i>=0){ all[i]={...all[i],status:'Declined'}; Sessions.save(all); if(window.GMSFB&&GMSFB.enabled) GMSFB.pushCollection(KEY.sessions, all); toast('Session declined.'); renderSchedule(); updateSchedPendingBadge(); } },'Decline','btn-danger'); }
function updateSchedPendingBadge(){
  if(!currentUser||currentUser.role!=='trainer') return;
  const pending=Sessions.all().filter(s=>s.trainerId===currentUser.id&&s.status==='Pending').length;
  const badge=document.getElementById('schedPendingBadge');
  if(badge){ badge.textContent=pending; badge.style.display=pending>0?'flex':'none'; }
}
function renderMessages(){
  const el=document.getElementById('panelMessages');
  if(!el) return;
  const all=Messages.all().slice().reverse();
  const threads=[];
  all.forEach(m=>{
    let t=threads.find(x=>x.memberId===m.memberId);
    if(!t){t={memberId:m.memberId,memberName:m.memberName||'Member',unread:0,last:m};threads.push(t);}
    t.last=m;if(m.direction==='in'&&!m.read)t.unread++;
  });
  // Fix: new members with no messages yet were invisible — add them so admin/staff can start a conversation and no empty-state bug
  const members=Members.all().filter(m=>m.status!=='Archived');
  members.forEach(mem=>{
    if(!threads.find(x=>x.memberId===mem.id)){
      threads.push({memberId:mem.id, memberName:mem.name, unread:0, last:{text:'No messages yet — tap to start conversation', date:mem.createdAt||today(), time:'', ts:0}});
    }
  });
  threads.sort((a,b)=>(b.unread - a.unread) || ((b.last.ts||0)-(a.last.ts||0)) );
  const _query=(window._msgSearchQuery||'').toLowerCase();
  const filtered=_query?threads.filter(t=> `${t.memberName} ${t.last.text} ${t.memberId}`.toLowerCase().includes(_query)):threads;
  el.innerHTML=`
  <div class="table-card">
    <div class="table-header" style="flex-wrap:wrap;gap:10px"><h3>Member Messages <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${filtered.length} conversation(s)</span></h3><div style="display:flex;gap:8px;align-items:center;flex:1;justify-content:flex-end;min-width:200px"><input type="text" id="msgSearch" placeholder="Search members..." value="${esc(window._msgSearchQuery||'')}" oninput="filterMessageThreads(this.value)" class="search-input" style="min-width:180px;flex:1;max-width:280px;padding:8px 12px;font-size:13px"></div></div>
    ${filtered.length?filtered.map(t=>`<div style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background=''" onclick="openMsgThread('${t.memberId}')">
      <div class="user-avatar" style="width:38px;height:38px;font-size:12px;background:linear-gradient(135deg,var(--orange),var(--orange-dark));flex-shrink:0">${esc(initials(t.memberName))}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:800;color:var(--white);font-size:14px">${esc(t.memberName)}</span>
          ${t.unread?`<span class="nav-badge" style="display:flex;position:static">${t.unread}</span>`:''}
        </div>
        <div style="font-size:12px;color:var(--gray-500);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.last.text)}</div>
      </div>
      <span style="font-size:11px;color:var(--gray-500);flex-shrink:0">${formatDate(t.last.date)} ${esc(t.last.time||'')}</span>
      <button type="button" class="btn-icon" style="flex-shrink:0;width:32px;height:32px;border-radius:8px;border:1px solid rgba(239,68,68,.2);background:rgba(239,68,68,.08);color:var(--red);display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation(); deleteConversation('${t.memberId}')" title="Delete conversation" aria-label="Delete conversation">${iconSvg('trash',14)}</button>
    </div>`).join(''):`<div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><p>${_query?'No conversations match your search.':'No messages yet'}</p>${_query?'':`<p class="empty-sub">Member questions from the "Need Help?" section will appear here.</p>`}</div>`}
  </div>`;
}
function filterMessageThreads(q){ window._msgSearchQuery=q||''; renderMessages(); const el=document.getElementById('msgSearch'); if(el){ const v=el.value; el.focus(); el.setSelectionRange(v.length,v.length); } }
function deleteConversation(memberId){
  const mem=Members.one(memberId); const name=mem?mem.name:memberId;
  openConfirm('Delete Conversation','Are you sure you want to delete the conversation with <strong>'+esc(name)+'</strong>? This will permanently remove all messages for this member.', async ()=>{
    const all=Messages.all();
    const removed=all.filter(m=>m.memberId===memberId).map(m=>m.id);
    const filtered=all.filter(m=>m.memberId!==memberId);
    Messages.save(filtered);
    if(window.GMSFB&&GMSFB.enabled){
      GMSFB.pushCollection(KEY.messages, filtered);
      // Explicit cloud delete for every message in this thread
      if(removed.length){try{GMSFB.deleteDocs(KEY.messages,removed);}catch(e){}}
    }
    toast('Conversation deleted.');
    renderMessages();
  }, 'Delete', 'btn-danger');
}
//
// Export/Import Messages functions
//
function exportMessages(){
  const msgs=Messages.all();
  const data=JSON.stringify(msgs);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='messages-backup.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Messages exported.');
}
function importMessages(){
  const input=document.createElement('input');
  input.type='file';
  input.accept='application/json';
  input.onchange=e=>{
    const file=e.target.files[0];
    const reader=new FileReader();
    reader.onload=f=>{
      try{
        const msgs=JSON.parse(reader.result);
        if(msgs&&Array.isArray(msgs)&&msgs.length>0){
          if(confirm('This will replace all current messages. Continue?')){
            Messages.save(msgs);
            renderMessages();
            toast('Messages imported.');
          }
        }else{alert('Invalid messages format.');}
      }catch(e){alert('Error reading file.');}
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ======================================================================
// PANEL: ANNOUNCEMENTS (gym closures, events, anniversaries)
// ======================================================================
const ANNOUNCE_META={general:{icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a5 5 0 0 1 0 8"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/></svg>`,label:'General',cls:'badge-active'},event:{icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,label:'Event',cls:'badge-expiring'},holiday:{icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,label:'Holiday / Closed',cls:'badge-expired'},alert:{icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,label:'Alert',cls:'badge-suspended'}};
function renderAnnouncements(){
  const el=document.getElementById('panelAnnouncements');
  const all=Announcements.all().slice().reverse();
  el.innerHTML=`
  <div class="page-actions">
    <div class="table-controls">
      <span style="font-size:11px;color:var(--gray-500)">Post gym closures, events and anniversaries — members see these on their dashboard</span>
    </div>
    <button class="btn-primary" style="display:inline-flex;align-items:center;gap:8px" onclick="openAnnounceModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a5 5 0 0 1 0 8"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/></svg> Post Announcement</button>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>Announcements <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${all.length} total</span></h3></div>
    ${all.length?all.map(a=>{
      const meta=ANNOUNCE_META[a.type]||ANNOUNCE_META.general;
      return `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.06)">
        <div style="font-size:22px;flex-shrink:0">${meta.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:800;color:var(--white);font-size:14px">${esc(a.title)}</span>
            <span class="badge ${meta.cls}">${meta.label}</span>
            ${a.date?`<span style="font-size:11px;color:var(--gray-500)">${formatDate(a.date)}</span>`:''}
          </div>
          <div style="font-size:12.5px;color:var(--gray-500);margin-top:6px;white-space:pre-wrap">${esc(a.text)}</div>
          <div style="font-size:11px;color:var(--gray-600);margin-top:8px">Posted by ${esc(a.createdBy||'Admin')} · ${formatDate(a.createdAt)}</div>
        </div>
        <button class="btn-icon" style="flex-shrink:0" title="Delete announcement" onclick="deleteAnnouncement('${a.id}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>`;
    }).join(''):`<div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a5 5 0 0 1 0 8"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/></svg></div><p>No announcements yet</p><p class="empty-sub">Post a gym closure, event or anniversary — members will see it on their dashboard.</p></div>`}
  </div>`;
}
function openAnnounceModal(){
  document.getElementById('an_type').value='general';
  document.getElementById('an_date').value=today();
  document.getElementById('an_title').value='';
  document.getElementById('an_text').value='';
  const err=document.getElementById('announceFormError');
  if(err){err.textContent='';err.style.display='none';}
  openModal('announceModal');
}
function saveAnnouncement(){
  const err=document.getElementById('announceFormError');
  const title=document.getElementById('an_title').value.trim();
  const text=document.getElementById('an_text').value.trim();
  if(!title||!text){err.textContent='Please fill in the title and message.';err.style.display='block';return;}
  if(title.length>120){err.textContent='Title is too long — max 120 characters.';err.style.display='block';return;}
  if(text.length>2000){err.textContent='Message is too long — max 2000 characters.';err.style.display='block';return;}
  Announcements.add({id:nextId(KEY.announcements,'ANN'),type:document.getElementById('an_type').value,date:document.getElementById('an_date').value,title:sanitizeText(title),text:sanitizeText(text),createdBy:currentUser.name||'Admin',createdAt:today(),time:new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})});
  logActivity('Posted','Announcement','"'+title+'"');
  closeModal('announceModal');
  renderAnnouncements();
  toast('Announcement posted. Members can see it now.');
}
function deleteAnnouncement(id){
  const a=Announcements.one(id);
  if(!a)return;
  openConfirm('Delete Announcement','Delete "'+a.title+'"? Members will no longer see it.',function(){
    Announcements.remove(id);
    logActivity('Deleted','Announcement','"'+a.title+'"');
    renderAnnouncements();
    toast('Announcement deleted.');
  },'Delete','btn-danger');
}
function announceStripHtml(){
  const all=Announcements.all().slice().reverse().slice(0,4);
  if(!all.length)return'';
  return `<div style="display:grid;gap:10px;margin-bottom:16px">${all.map(a=>{
    const meta=ANNOUNCE_META[a.type]||ANNOUNCE_META.general;
    return `<div style="display:flex;align-items:flex-start;gap:12px;background:linear-gradient(135deg,rgba(127,250,136,.08),rgba(127,250,136,.02));border:1px solid rgba(127,250,136,.25);border-radius:14px;padding:14px 16px">
      <div style="font-size:20px;flex-shrink:0">${meta.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:800;color:var(--white);font-size:13.5px">${esc(a.title)}</span>
          <span class="badge ${meta.cls}" style="font-size:9.5px;padding:2px 8px">${meta.label}</span>
        </div>
        <div style="font-size:12.5px;color:var(--gray-500);margin-top:4px;white-space:pre-wrap">${esc(a.text)}</div>
        ${a.date?`<div style="font-size:11px;color:var(--orange);font-weight:600;margin-top:6px">📅 ${formatDate(a.date)}</div>`:''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ======================================================================
// PANEL: PAYMENT QUEUE (pending_payment activation)
// ======================================================================
let _confirmPaymentMemberId=null;
let _queueSearch='',_queuePlanFilter='All';
const _queueSelected=new Set();
function renderQueue(){
  const el=document.getElementById('panelQueue');
  if(window.GMSFB&&GMSFB.enabled&&(_cloudMap(KEY.members)===null||_cloudMap(KEY.payments)===null)){
    el.innerHTML='<div class="table-card"><div class="empty-state" style="padding:40px"><div class="empty-icon">☁️</div><p>Loading pending payments from Firebase…</p></div></div>';
    return;
  }
  const plans=Plans.all().filter(p=>p.status==='Active');
  let pending=Members.all().filter(m=>m.status==='pending_payment');
  if(_queueSearch){const s=_queueSearch.toLowerCase();pending=pending.filter(m=>m.name.toLowerCase().includes(s)||m.id.toLowerCase().includes(s)||(m.email||'').toLowerCase().includes(s));}
  if(_queuePlanFilter!=='All')pending=pending.filter(m=>m.planId===_queuePlanFilter);
  pending.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  // Badge must mirror the cards below. Notifications can outlive a member
  // (deleted/archived/paid) and made this show 8 with an empty queue.
  const total=pending.length;
  const items=pending.map(m=>{
    const plan=m.planId?Plans.one(m.planId):null;
    const ageDays=Math.max(0,Math.floor((Date.now()-new Date(m.createdAt||Date.now()))/86400000));
    const daysLeft=PENDING_ARCHIVE_DAYS-ageDays;
    const urgent=daysLeft<=1;
    const ageColor=ageDays<=2?'var(--green)':(ageDays>=PENDING_ARCHIVE_DAYS-2?'var(--red)':'var(--gold)');
    return`<div class="queue-card${urgent?' urgent':''}">
      <label class="queue-check" title="Select for bulk confirm"><input type="checkbox" onchange="toggleQueueSelect('${m.id}',this.checked)" ${_queueSelected.has(m.id)?'checked':''}></label>
      <div class="queue-main">
        <div class="queue-avatar" style="${m.avatar?'padding:0;overflow:hidden':''}">${m.avatar?`<img src="${m.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(m.name))}</div>
        <div class="queue-info">
          <div class="queue-name">${esc(m.name)}${bgCheckFlagged(m)?'<span class="badge badge-suspended" style="margin-left:6px">BG Flagged</span>':''}${urgent?'<span class="badge badge-expired" style="margin-left:6px">auto-archive soon</span>':''}${m.createdBy==='Self'?'<span class="badge badge-pending" style="margin-left:6px">Self-Registered</span>':''}</div>
          <div class="queue-meta"><span class="queue-meta-id">${esc(m.id)}</span></div>
          <div class="queue-meta"><span class="queue-ico">${iconSvg('mail',12)}</span><span>${esc(m.email||'no email')}</span></div>
          <div class="queue-meta"><span class="queue-ico">${iconSvg('phone',12)}</span><span>${esc(m.contact||'—')}</span></div>
        </div>
      </div>
      <div class="queue-detail">
        <div class="queue-plan-row"><span class="queue-plan-name">${esc(plan?plan.name:'—')}</span><span class="badge badge-pending">Pending</span></div>
        <div class="queue-price">₱${plan?Number(plan.price).toLocaleString():'0'}</div>
        <div class="queue-date" style="color:${ageColor}">Registered ${formatDate(m.createdAt)} (${ageDays}d ago)</div>
      </div>
      <div class="queue-actions" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="openConfirmPayment('${m.id}')">💰 Confirm Payment</button>
        <button class="btn-danger btn-sm" onclick="deleteQueueItem('${m.id}')" title="Delete pending registration" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.28);color:#ef4444">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');
  const bulkBtn=_queueSelected.size?`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-primary btn-sm" onclick="confirmSelectedPayments()">✓ Confirm Selected (${_queueSelected.size})</button><button class="btn-danger btn-sm" onclick="deleteSelectedQueue()" style="background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.28);color:#ef4444">🗑 Delete Selected (${_queueSelected.size})</button></div>`:'';
  const totalBadge=total?`<span class="badge badge-expiring" style="margin-left:6px">${total}</span>`:'';
  el.innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div class="section-title" style="margin-bottom:4px">Pending Payments ${totalBadge}</div>
      <div style="font-size:12px;color:var(--gray-500)">Members who self-registered and are awaiting counter payment. Unpaid sign-ups are auto-archived after ${PENDING_ARCHIVE_DAYS} days.</div>
    </div>
    ${bulkBtn}
  </div>
  <div class="queue-toolbar">
    <input class="search-input" placeholder="Search by name, ID or email…" value="${esc(_queueSearch)}" oninput="_queueSearch=this.value;renderQueue()">
    <select class="filter-sel" onchange="_queuePlanFilter=this.value;renderQueue()">
      <option value="All">All Plans</option>
      ${plans.map(p=>`<option value="${p.id}" ${p.id===_queuePlanFilter?'selected':''}>${esc(p.name)}</option>`).join('')}
    </select>
  </div>
  ${pending.length?`<div class="queue-list">${items}</div>`:`<div class="table-card"><div class="empty-state"><div class="empty-icon">✅</div><p>All caught up! No pending payments right now.</p></div></div>`}`;
  setTimeout(repairMicoDuplicatePayments,0);
}
function deleteQueueItem(memberId){
  const m=Members.one(memberId);
  if(!m){toast('Member not found.','error');return;}
  const plan=m.planId?Plans.one(m.planId):null;
  openConfirm(
    'Delete Pending Registration?',
    `<div style="display:flex;gap:12px;align-items:flex-start;text-align:left"><div class="user-avatar" style="width:42px;height:42px;background:rgba(239,68,68,.14);color:#ef4444;flex-shrink:0">${esc(initials(m.name))}</div><div><div style="font-weight:800;color:var(--white)">${esc(m.name)}</div><div style="font-size:11px;font-family:monospace;color:var(--gray-500)">${esc(m.id)} · ${esc(plan?plan.name:'—')}</div><div style="font-size:12px;color:var(--gray-300);margin-top:8px;line-height:1.6">This will <strong style="color:#ef4444">archive</strong> the pending registration for <strong>${esc(m.name)}</strong>. The entry will be removed from Payment Queue and moved to archived records. This cannot be undone — the member will need to register again if needed.</div></div></div>`,
    async ()=>{
      // soft-archive: keeps audit, removes from queue, resolves notification
      const all=Members.all();
      const idx=all.findIndex(x=>x.id===memberId);
      if(idx<0){toast('Member not found.','error');return;}
      all[idx].status='Archived';
      all[idx].archivedAt=today();
      all[idx].archivedBy=currentUser?currentUser.name:'';
      Members.save(all);
      resolveNotifsForMember(memberId);
      _queueSelected.delete(memberId);
      // log
      try{
        const act={id:'ACT'+Date.now(),action:'Archive',category:'Member',detail:all[idx].name,extra:'Deleted from Payment Queue | ID: '+memberId+' | Plan: '+(plan?plan.name:'—'),by:currentUser?currentUser.name:'',byUsername:currentUser?currentUser.username:'',byRole:currentUser?currentUser.role:'',at:new Date().toISOString()};
        const acts=ActivityLog.all(); acts.push(act); ActivityLog.save(acts);
      }catch(e){}
      // cloud sync
      if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
        try{
          await Promise.all([
            GMSFB.pushCollection(KEY.members, Members.all()),
            GMSFB.pushCollection(KEY.notifications, Notifications.all()),
            GMSFB.pushCollection(KEY.activityLog, ActivityLog.all())
          ]);
          await new Promise(r=>setTimeout(r,300));
        }catch(e){console.warn('[deleteQueueItem] sync',e);}
      }
      toast('Pending registration deleted / archived.','success');
      updateQueueBadge();
      renderQueue();
      scanRenewals();
    },
    '🗑 Yes, Delete',
    'btn-danger'
  );
}
function deleteSelectedQueue(){
  const ids=[..._queueSelected].filter(id=>{const m=Members.one(id);return m&&m.status==='pending_payment';});
  if(!ids.length){toast('No selected pending items.','error');return;}
  const names=ids.map(id=>Members.one(id).name);
  openConfirm(
    `Delete ${ids.length} pending registration${ids.length!==1?'s':''}?`,
    `Archive <strong>${esc(names.length>3?names.slice(0,3).join(', ')+' +'+(names.length-3)+' more':names.join(', '))}</strong> from Payment Queue?<br><span style="font-size:12px;color:var(--gray-500)">Archived records can be purged permanently via Reports → Purge Archived.</span>`,
    async ()=>{
      const all=Members.all();
      let count=0;
      ids.forEach(id=>{
        const idx=all.findIndex(x=>x.id===id);
        if(idx>-1 && all[idx].status==='pending_payment'){ all[idx].status='Archived'; all[idx].archivedAt=today(); all[idx].archivedBy=currentUser?currentUser.name:''; resolveNotifsForMember(id); _queueSelected.delete(id); count++; }
      });
      Members.save(all);
      try{
        const act={id:'ACT'+Date.now(),action:'Bulk Archive',category:'Member',detail:count+' pending registrations',extra:'Bulk delete from Payment Queue | IDs: '+ids.join(', '),by:currentUser?currentUser.name:'',byUsername:currentUser?currentUser.username:'',byRole:currentUser?currentUser.role:'',at:new Date().toISOString()};
        const acts=ActivityLog.all(); acts.push(act); ActivityLog.save(acts);
      }catch(e){}
      if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
        try{
          await Promise.all([
            GMSFB.pushCollection(KEY.members, Members.all()),
            GMSFB.pushCollection(KEY.notifications, Notifications.all()),
            GMSFB.pushCollection(KEY.activityLog, ActivityLog.all())
          ]);
          await new Promise(r=>setTimeout(r,300));
        }catch(e){}
      }
      toast(`${count} pending registration${count!==1?'s':''} archived.`,'success');
      updateQueueBadge();
      renderQueue();
      scanRenewals();
    },
    `🗑 Delete (${ids.length})`,
    'btn-danger'
  );
}
function toggleQueueSelect(id,checked){if(checked)_queueSelected.add(id);else _queueSelected.delete(id);renderQueue();}
async function confirmSelectedPayments(){
  const ids=[..._queueSelected].filter(id=>Members.one(id));
  if(!ids.length){toast('No members selected.','error');return;}
  const names=ids.map(id=>Members.one(id).name);
  const flagged=ids.filter(id=>bgCheckBlocksActivation(Members.one(id)));
  if(flagged.length){toast('Clear the background check first: '+flagged.map(id=>Members.one(id).name).join(', '),'error');return;}
  const totalAmt=ids.reduce((s,id)=>{const m=Members.one(id);const p=m.planId?Plans.one(m.planId):null;return s+(p?Number(p.price):0);},0);
  openConfirm(
    `Confirm ${ids.length} payment${ids.length!==1?'s':''}?`,
    `Mark <strong>${esc(names.length>2?names.slice(0,2).join(', ')+' +'+(names.length-2)+' more':names.join(', '))}</strong> as paid (₱${totalAmt.toLocaleString()})?<br><span style="font-size:12px;color:var(--gray-500)">Each member's QR activates immediately on any device.</span>`,
    async ()=>{
      let done=0;const failed=[];
      for(const id of ids){
        const m=Members.one(id);
        if(!m){failed.push(id);continue;}
        const p=m.planId?Plans.one(m.planId):null;
        try{
          await applyPaymentConfirmation(id,p?Number(p.price):0,'Cash','');
          done++;
        }catch(e){
          failed.push(m.name);
          console.warn('[confirmSelectedPayments]',id,e);
        }
      }
      _queueSelected.clear();
      if(done)toast(`${done} payment${done!==1?'s':''} confirmed and saved. Members can now log in on any device.`,'success');
      if(failed.length)toast('Not confirmed: '+failed.join(', ')+'. Please try again.','error');
      updateQueueBadge();
      renderQueue();
      scanRenewals();
    },
    `✓ Confirm (${ids.length})`,
    'btn-primary'
  );
}
// One-time data repair for the duplicate Mico Duamin payment created by the
// old non-atomic confirmation path. Keeps the payment that matches the
// member's current plan, deletes the extras, and activates the member if the
// kept payment is valid. Runs once per admin/staff session.
let _micoRepairDone=false,_micoRepairRunning=false,_micoRepairFailAt=0;
async function repairMicoDuplicatePayments(){
  if(_micoRepairDone||_micoRepairRunning)return;
  if(Date.now()-_micoRepairFailAt<15000)return;
  if(!currentUser||currentUser.role!=='admin')return;
  if(!window.GMSFB||!GMSFB.enabled||!GMSFB.ready||!GMSFB.auth||!GMSFB.auth.currentUser)return;
  if(GMSFB._lastCloud.members===undefined||GMSFB._lastCloud.payments===undefined)return;
  const allMembers=Members.all();
  const isMico=function(m){return (m.name||'').trim().toLowerCase()==='mico duamin';};
  const member=allMembers.find(m=>m.id==='MEM-0003'&&isMico(m))||allMembers.find(m=>isMico(m)&&m.status==='pending_payment');
  // Only repair a still-pending Mico. Once the member is active this must be a
  // no-op so a future renewal payment is never mistaken for a duplicate.
  if(!member||member.status!=='pending_payment'){_micoRepairDone=true;return;}
  const pays=Payments.all().filter(p=>p.memberId===member.id);
  if(!pays.length){_micoRepairDone=true;return;}
  _micoRepairRunning=true;
  try{
    const sorted=pays.slice().sort(newestPaymentFirst);
    const keep=sorted.find(p=>p.planId===member.planId)||sorted[0];
    const remove=pays.filter(p=>p.id!==keep.id);
    const ops=remove.map(p=>({col:'payments',id:p.id,delete:true}));
    let activated=false;
    if(member.status==='pending_payment'){
      if(!GMSFB._lastCloud.settings&&typeof GMSFB.waitForSnap==='function'){try{await GMSFB.waitForSnap('settings',1500);}catch(e){}}
      const plan=keep.planId?Plans.one(keep.planId):Plans.one(member.planId);
      const start=keep.date||today();
      const expiry=keep.newExpiry||addMonths(start,plan?plan.duration:1);
      const nonce=newQrNonce(member.id);
      const token='FCG.'+member.id+'.'+start.replace(/-/g,'')+'.'+qrSig(member.id,start,nonce,getQrSecret());
      const activation={status:'Active',planId:keep.planId||member.planId,planStart:start,startDate:start,expiryDate:expiry,qrNonce:nonce,qrToken:token};
      ops.push({col:'members',id:member.id,data:activation,merge:true});
      Notifications.all().filter(n=>n.memberId===member.id&&n.type==='pending_payment'&&n.status==='open')
        .forEach(n=>ops.push({col:'notifications',id:n.id,data:{status:'resolved',resolvedAt:new Date().toISOString()},merge:true}));
      GMSFB.applyLocalPatch(KEY.members,member.id,activation);
      activated=true;
    }
    if(!ops.length){_micoRepairDone=true;return;}
    const res=await GMSFB.commitDocs(ops);
    if(!res||!res.ok){
      if(activated&&typeof GMSFB.revertLocalPatch==='function')GMSFB.revertLocalPatch(KEY.members,member.id,member);
      _micoRepairFailAt=Date.now();
      console.warn('[repairMico]',res);
      return;
    }
    _micoRepairDone=true;
    if(activated){
      resolveNotifsForMember(member.id);
      _dismissedIds.add(member.id);
      logActivity('Activated','Member',member.name,'ID: '+member.id+' | Repaired existing payment '+keep.id+' | Removed '+remove.length+' duplicate(s)');
    }
    if(remove.length){
      toast('Removed '+remove.length+' duplicate payment record'+(remove.length!==1?'s':'')+' for '+member.name+(activated?' and activated the membership.':'.'),'success');
    }
    updateQueueBadge();
    if(typeof _lastPanel!=='undefined'){
      if(_lastPanel==='queue')renderQueue();
      if(_lastPanel==='billing')refreshBillingTable();
    }
  }catch(e){
    _micoRepairFailAt=Date.now();
    console.warn('[repairMico]',e);
  }finally{
    _micoRepairRunning=false;
  }
}
function openConfirmPayment(memberId){
  _confirmPaymentMemberId=memberId;
  const m=Members.one(memberId);
  if(!m)return;
  const plan=m.planId?Plans.one(m.planId):null;
  document.getElementById('cpm_memberId').value=memberId;
  document.getElementById('confirmPaymentError').style.display='none';
  if(bgCheckBlocksActivation(m)){
    const err=document.getElementById('confirmPaymentError');
    err.textContent='Background check is Flagged — clear it in the member profile before activating.';
    err.style.display='block';
  }
  document.getElementById('cpm_summary').innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:12px">
      <div class="user-avatar" style="width:40px;height:40px;background:rgba(251,191,36,.15);color:var(--gold);flex-shrink:0">${esc(initials(m.name))}</div>
      <div>
        <div style="font-weight:800;color:var(--white);font-size:14px">${esc(m.name)}</div>
        <div style="font-size:11px;font-family:monospace;color:var(--gray-500)">${esc(m.id)} · ${esc(m.email||'no email')}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
      <div style="background:var(--navy-700);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px">Plan</div><div style="font-weight:700;color:var(--white);margin-top:2px">${esc(plan?plan.name:'—')}</div></div>
      <div style="background:var(--navy-700);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px">Plan Price</div><div style="font-weight:700;color:var(--green);margin-top:2px">₱${plan?Number(plan.price).toLocaleString():'0'}</div></div>
      <div style="background:var(--navy-700);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px">Duration</div><div style="font-weight:700;color:var(--white);margin-top:2px">${plan?plan.duration+' month(s)':'-'}</div></div>
      <div style="background:var(--navy-700);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:1px">New Expiry</div><div style="font-weight:700;color:var(--white);margin-top:2px">${plan?formatDate(addMonths(today(),plan.duration)):'—'}</div></div>
    </div>`;
  document.getElementById('cpm_amount').value=plan?plan.price:'';
  document.getElementById('cpm_method').value='';
  document.getElementById('cpm_reference').value='';
  toggleCpmReference();
  openModal('confirmPaymentModal');
}
function toggleCpmReference(){
  const method=document.getElementById('cpm_method').value;
  const wrap=document.getElementById('cpm_refWrap');
  if(wrap)wrap.style.display=method==='GCash'?'block':'none';
}
async function applyPaymentConfirmation(memberId,amount,method,reference,opts){
  opts=opts||{};
  const member=Members.one(memberId);
  if(!member)return null;
  // Make sure the settings snapshot (QR secret) is available before signing
  // a new token. Without this, a slow first snapshot could generate a second
  // secret and invalidate QR codes on other devices.
  if(window.GMSFB&&GMSFB.enabled&&!GMSFB._lastCloud.settings&&typeof GMSFB.waitForSnap==='function'){
    try{await GMSFB.waitForSnap('settings',1500);}catch(e){}
  }
  const planId=opts.planId||member.planId;
  const plan=planId?Plans.one(planId):null;
  const start=opts.date||today();
  const newExpiry=addMonths(start,plan?plan.duration:1);
  const now=new Date();
  const newId=opts.paymentId||nextId(KEY.payments,'PAY');
  const payment={id:newId,memberId,memberName:member.name,planId,planName:plan?plan.name:'Unknown',amount:amount|| (plan?Number(plan.price):0),date:start,newExpiry,method:method||'Cash',reference:sanitizeText(reference||''),notes:sanitizeText(opts.notes||''),recordedBy:currentUser.name,recordedByUsername:currentUser.username,staffId:currentUser.id,status:'Paid',source:opts.source||'activation',timestamp:now.getTime(),createdAt:start};
  const nonce=newQrNonce(memberId);
  const token='FCG.'+memberId+'.'+start.replace(/-/g,'')+'.'+qrSig(memberId,start,nonce,getQrSecret());
  // Fields that unlock the member. Written in the same atomic batch as the
  // payment so the queue cannot say "confirmed" before Firestore has them.
  const activation={status:'Active',planId,planStart:start,startDate:start,expiryDate:newExpiry,qrNonce:nonce,qrToken:token};
  const openNotifs=Notifications.all().filter(n=>n.memberId===memberId&&n.type==='pending_payment'&&n.status==='open');
  if(window.GMSFB&&GMSFB.enabled){
    if(!GMSFB.auth||!GMSFB.auth.currentUser){
      throw new Error('Firebase session expired — please log out and log in again before confirming payments.');
    }
    // Overlay first so a cached snapshot cannot flash the pending card back
    // while the batch is in flight; cleared again if the commit fails.
    GMSFB.applyLocalPatch(KEY.members,memberId,activation);
    const ops=[
      {col:'members',id:memberId,data:activation,merge:true},
      {col:'payments',id:newId,data:payment,merge:false}
    ];
    openNotifs.forEach(n=>ops.push({col:'notifications',id:n.id,data:{status:'resolved',resolvedAt:new Date().toISOString()},merge:true}));
    let res;
    try{ res=await GMSFB.commitDocs(ops); }
    catch(e){ res={ok:false,error:e&&e.message}; }
    if(!res||!res.ok){
      if(typeof GMSFB.revertLocalPatch==='function')GMSFB.revertLocalPatch(KEY.members,memberId,member);
      else GMSFB.clearLocalPatch(KEY.members,memberId);
      throw new Error('Could not save to Firebase ('+((res&&(res.error||res.reason))||'error')+'). Please check your connection and try again.');
    }
    // commitDocs updated the live snapshot for members/payments/notifications.
    // Keep the new payment visible if a cached pre-write snapshot arrives.
    if(typeof GMSFB.applyLocalPatch==='function')GMSFB.applyLocalPatch(KEY.payments,newId,payment);
  }else{
    // Local-only fallback (Firebase not configured).
    const payments=Payments.all();
    payments.push(payment);
    Payments.save(payments);
    Members.update(memberId,activation);
  }
  resolveNotifsForMember(memberId);
  if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.applyLocalPatch==='function'){
    GMSFB.applyLocalPatch(KEY.members,memberId,activation);
  }
  _queueSelected.delete(memberId);
  logActivity('Activated','Member',member.name,'ID: '+memberId+' | Plan: '+(plan?plan.name:'—')+' | Payment: '+method+' ₱'+(amount||(plan?Number(plan.price):0)));
  return {member:Members.one(memberId)||{...member,...activation},payment};
}
async function confirmPayment(){
  const memberId=document.getElementById('cpm_memberId').value;
  const amount=parseFloat(document.getElementById('cpm_amount').value);
  const method=document.getElementById('cpm_method').value;
  const reference=document.getElementById('cpm_reference').value.trim();
  const err=document.getElementById('confirmPaymentError');
  const btn=document.querySelector('#confirmPaymentModal .btn-primary');
  err.style.display='none';
  if(!memberId||!amount||!method){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  if(amount<=0){err.textContent='Invalid payment amount.';err.style.display='block';return;}
  if(method==='GCash'&&!reference){err.textContent='Please enter the GCash reference number.';err.style.display='block';return;}
  if(bgCheckBlocksActivation(Members.one(memberId))){
    err.textContent='Background check is Flagged — clear it in the member profile before activating.';
    err.style.display='block';
    return;
  }
  if(btn){btn.disabled=true; btn.textContent='Confirming…';}
  try{
    const result=await applyPaymentConfirmation(memberId,amount,method,reference);
    const member=result&&result.member;
    if(!member){err.textContent='Member not found.';err.style.display='block';return;}
    closeModal('confirmPaymentModal');
    toast(`Payment confirmed — ${member.name} is now active. Member can now log in on any device.`);
    updateQueueBadge();
    renderQueue();
    scanRenewals();
  }catch(e){
    err.textContent=(e&&e.message)?e.message:'Sync failed — please check internet and try again.';
    err.style.display='block';
    updateQueueBadge();
    renderQueue();
    console.error(e);
  }finally{
    if(btn){btn.disabled=false; btn.textContent='Confirm Payment';}
  }
}

// ======================================================================
// PANEL: QR SCANNER (entrance attendance via QR)
// ======================================================================
let _scanStream=null,_scanRaf=null,_scanCanvas=null,_scanCtx=null,_scanning=false,_scanLocked=false;
function renderScanner(){
  const el=document.getElementById('panelScanner');
  el.innerHTML=`
  <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:16px;align-items:start">
    <div class="scan-card">
      <div class="scan-header">
        <div>
          <div class="section-title" style="margin-bottom:4px">Camera Scanner</div>
          <div style="font-size:12px;color:var(--gray-500)">First scan = check-in · Second scan = check-out</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" id="scanStartBtn" onclick="startScanner()">▶ Start Camera</button>
          <button class="btn-secondary btn-sm" id="scanStopBtn" style="display:none" onclick="stopScanner()">■ Stop</button>
        </div>
      </div>
      <div class="scan-viewport" id="scanViewport">
        <video id="scanVideo" playsinline muted style="width:100%;height:100%;object-fit:cover;display:none"></video>
        <div class="scan-placeholder" id="scanPlaceholder">${iconSvg('camera',36)}<div style="font-size:13px;color:var(--gray-500);margin-top:8px">Camera is off</div></div>
        <div class="scan-corner tl"></div><div class="scan-corner tr"></div><div class="scan-corner bl"></div><div class="scan-corner br"></div>
      </div>
      <div id="scanError" class="error-msg" style="margin-top:10px"></div>
    </div>
    <div style="display:grid;gap:16px">
      <div class="table-card">
        <div class="table-header"><h3>Manual Entry</h3></div>
        <div class="form-group" style="margin-bottom:12px">
          <label>Paste / Type QR Token</label>
          <input type="text" id="scanManualInput" placeholder="FCG.MEM-xxxx.yyyymmdd.xxxxxxxx" onkeydown="if(event.key==='Enter')scanManualToken()" style="font-family:monospace;font-size:12px">
        </div>
        <button class="btn-primary btn-sm" onclick="scanManualToken()">Validate Token</button>
      </div>
      <div id="scanResult" class="scan-result-wrap"></div>
    </div>
  </div>`;
  stopScanner();
  const manual=document.getElementById('scanManualInput');
  if(manual)manual.value='';
}
function startScanner(){
  const video=document.getElementById('scanVideo');
  const placeholder=document.getElementById('scanPlaceholder');
  const err=document.getElementById('scanError');
  if(!video)return;
  if(err)err.style.display='none';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    if(err){err.textContent='Camera not supported in this browser. Use Manual Entry instead.';err.style.display='block';}
    return;
  }
  stopScanner();
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(stream=>{
    _scanStream=stream;
    video.srcObject=stream;
    video.style.display='block';
    if(placeholder)placeholder.style.display='none';
    const sb=document.getElementById('scanStartBtn');if(sb)sb.style.display='none';
    const st=document.getElementById('scanStopBtn');if(st)st.style.display='';
    video.play().then(()=>{
      _scanCanvas=document.createElement('canvas');
      _scanCtx=_scanCanvas.getContext('2d');
      _scanning=true;
      _scanLoop();
    }).catch(()=>{});
  }).catch(()=>{
    if(err){err.textContent='Camera access denied. Use Manual Entry instead.';err.style.display='block';}
  });
}
function stopScanner(){
  _scanning=false;
  if(_scanRaf){cancelAnimationFrame(_scanRaf);_scanRaf=null;}
  if(_scanStream){_scanStream.getTracks().forEach(t=>t.stop());_scanStream=null;}
  const video=document.getElementById('scanVideo');
  if(video){video.srcObject=null;video.style.display='none';}
  const placeholder=document.getElementById('scanPlaceholder');
  if(placeholder)placeholder.style.display='';
  const sb=document.getElementById('scanStartBtn');if(sb)sb.style.display='';
  const st=document.getElementById('scanStopBtn');if(st)st.style.display='none';
}
function _scanLoop(){
  if(!_scanning)return;
  const video=document.getElementById('scanVideo');
  if(!video||video.readyState!==video.HAVE_ENOUGH_DATA){_scanRaf=requestAnimationFrame(_scanLoop);return;}
  const w=video.videoWidth,h=video.videoHeight;
  if(w===0||h===0){_scanRaf=requestAnimationFrame(_scanLoop);return;}
  _scanCanvas.width=w;_scanCanvas.height=h;
  _scanCtx.drawImage(video,0,0,w,h);
  const img=_scanCtx.getImageData(0,0,w,h);
  const code=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
  if(code&&code.data&&!_scanLocked)processQrToken(code.data);
  _scanRaf=requestAnimationFrame(_scanLoop);
}
function processQrToken(token){
  if(!token)return;
  if(_scanLocked){showScanResult('busy','Processing…','Wait a moment before the next scan.');return;}
  const parsed=parseQrToken(token);
  if(!parsed){showScanResult('invalid','Invalid QR Code','This is not a valid FitCore entrance QR.');return;}
  if(parsed.dateStr!==today()){showScanResult('invalid','QR is Outdated','Entrance QRs rotate daily. Ask the member to refresh their QR.');return;}
  const member=Members.one(parsed.memberId);
  if(!member){showScanResult('invalid','Member Not Found','No member record matches this QR.');return;}
  const now=new Date();
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const todayAttend=Attendance.all().find(a=>a.memberId===member.id&&a.date===today());
  if(todayAttend){
    // Already checked in today — 2nd scan = check-out (if not yet out), else block re-entry / re-out
    if(todayAttend.checkOut){
      showScanResult('blocked','Already Checked Out',member.name+' already checked out at '+todayAttend.checkOut+' (duration: '+(todayAttend.duration||'—')+').');
      playScanSound('duplicate');
      toast('Already checked out — '+member.name,'error');
      if(navigator.vibrate) try{navigator.vibrate([120,80,120]);}catch(e){}
      return;
    }
    // Perform check-out: set checkOut, checkOutTs, duration
    const ts=now.getTime();
    const inTs=todayAttend.checkInTs||ts;
    const durMins=Math.max(0,Math.round((ts-inTs)/60000));
    const hrs=Math.floor(durMins/60);const mins=durMins%60;
    const duration=hrs>0?(hrs+'h '+mins+'m'):(mins+'m');
    const attendance=Attendance.all();
    const idx=attendance.findIndex(a=>a.id===todayAttend.id);
    if(idx>=0){
      attendance[idx].checkOut=time;
      attendance[idx].checkOutTs=ts;
      attendance[idx].duration=duration;
      attendance[idx].recordedBy=currentUser.name;
      Attendance.save(attendance);
    }
    showScanResult('checkout','Check-Out Recorded',member.name+' ('+member.id+') — out at '+time+' · Duration: '+duration);
    playScanSound('success');
    toast('Check-out recorded — '+member.name+' · '+duration,'success');
    if(navigator.vibrate) try{navigator.vibrate(120);}catch(e){}
    _scanLocked=true;
    setTimeout(()=>{_scanLocked=false;},4000);
    return;
  }
  // Entry-block checks (only when checking IN — pending/archived/expired/flagged block entry)
  if(member.status==='pending_payment'){showScanResult('blocked','Payment Pending',member.name+' has not paid yet — send to the counter.');return;}
  if(member.status==='Archived'){showScanResult('blocked','Account Archived','Member account is archived.');return;}
  if(bgCheckFlagged(member)){showScanResult('blocked','Background Check Flagged',member.name+' is flagged — entry blocked. Clear it in the member profile.');return;}
  if(daysUntil(member.expiryDate)<0){showScanResult('blocked','Plan Expired',member.name+'\'s plan expired on '+formatDate(member.expiryDate)+'. Renew at the counter — entry blocked.');return;}
  Attendance.add({id:uid(),memberId:member.id,date:today(),time,checkIn:time,checkInTs:now.getTime(),checkOut:null,checkOutTs:null,duration:null,recordedBy:currentUser.name,scannedBy:currentUser.name,source:'qr'});
  showScanResult('granted','Entry Granted',member.name+' ('+member.id+') — logged at '+time);
  playScanSound('success');
  toast('Entry granted — '+member.name+' ('+member.id+')','success');
  if(navigator.vibrate) try{navigator.vibrate(120);}catch(e){}
  _scanLocked=true;
  setTimeout(()=>{_scanLocked=false;},4000);
}
function scanManualToken(){
  const input=document.getElementById('scanManualInput');
  const err=document.getElementById('scanError');
  if(!input)return;
  const val=input.value.trim();
  if(!val){if(err){err.textContent='Please paste or type the QR token.';err.style.display='block';}return;}
  if(err)err.style.display='none';
  processQrToken(val);
}
function showScanResult(type,title,sub){
  const wrap=document.getElementById('scanResult');
  if(!wrap)return;
  const meta={
    granted:{cls:'ok',ico:'✅',color:'var(--green)'},
    checkout:{cls:'ok',ico:'✅',color:'var(--green)'},
    blocked:{cls:'block',ico:'🚫',color:'var(--red)'},
    invalid:{cls:'block',ico:'⚠️',color:'var(--red)'},
    busy:{cls:'block',ico:'⏳',color:'var(--gold)'}
  };
  const m=meta[type]||meta.invalid;
  if(type==='granted'||type==='checkout'){
    const badgeLabel=type==='checkout'?'Check-out recorded':'Check-in recorded';
    wrap.innerHTML=`<div class="scan-result ok scan-animate">
      <div class="scan-success-icon-wrap" style="filter:drop-shadow(0 0 18px rgba(127,250,136,.35))">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" style="display:block;margin:0 auto" aria-hidden="true">
          <circle cx="36" cy="36" r="32" stroke="rgba(127,250,136,.22)" stroke-width="2" fill="rgba(127,250,136,.10)"/>
          <circle cx="36" cy="36" r="32" stroke="var(--green)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="201" stroke-dashoffset="201" style="animation:scanCircleDraw .58s ease .12s forwards" fill="none"/>
          <path d="M22 36 L32 46 L50 26" stroke="var(--green)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-dasharray="48" stroke-dashoffset="48" style="animation:scanCheckDraw .44s ease .48s forwards"/>
        </svg>
      </div>
      <div style="font-weight:800;color:var(--green);margin-top:12px;font-size:16px;letter-spacing:.2px">${esc(title)}</div>
      ${sub?`<div style="font-size:12px;color:var(--gray-500);margin-top:6px;line-height:1.5">${esc(sub)}</div>`:''}
      <div style="margin-top:14px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--green);background:rgba(127,250,136,.12);border:1px solid rgba(127,250,136,.22);border-radius:999px;padding:7px 12px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${badgeLabel}</span></div>
    </div>`;
    const vp=document.getElementById('scanViewport');
    if(vp){vp.classList.remove('scan-flash');void vp.offsetWidth;vp.classList.add('scan-flash');setTimeout(()=>vp.classList.remove('scan-flash'),1000);}
  } else {
    wrap.innerHTML=`<div class="scan-result ${m.cls}">
      <div style="font-size:30px">${m.ico}</div>
      <div style="font-weight:800;color:${m.color};margin-top:8px">${esc(title)}</div>
      ${sub?`<div style="font-size:12px;color:var(--gray-500);margin-top:4px">${esc(sub)}</div>`:''}
    </div>`;
  }
  iconize(wrap);
}

// ======================================================================
// PANEL: WALK-IN
// ======================================================================
let walkinSearch='';let walkinPage=1;
function renderWalkin(){
  const el=document.getElementById('panelWalkin');
  el.innerHTML=`
  <div class="page-actions">
    <div class="table-controls">
      <input class="search-input" placeholder="Search visitor name…" value="${esc(walkinSearch)}" oninput="walkinSearch=this.value;walkinPage=1;refreshWalkinTable()">
      ${currentUser.role==='admin'?`<button class="btn-secondary" onclick="openWalkinSettingsModal()">⚙ Walk-In Price: ₱${getWalkinFee().toLocaleString()}</button>`:''}
    </div>
    <button class="btn-primary" onclick="openWalkinModal()">🚶 Register Walk-In</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px" id="walkinStats"></div>
  <div class="table-card" id="walkinTableCard"></div>`;
  refreshWalkinTable();
}
function refreshWalkinTable(){
  let data=Walkins.all();
  if(walkinSearch){const s=walkinSearch.toLowerCase();data=data.filter(w=>w.visitorName.toLowerCase().includes(s));}
  // Stats
  const today_=today();
  const todayCount=Walkins.all().filter(w=>w.date===today_).length;
  const totalRevenue=Walkins.all().reduce((a,w)=>a+Number(w.fee),0);
  const thisMonth=new Date();
  const monthlyCount=Walkins.all().filter(w=>{const d=new Date(w.date);return d.getMonth()===thisMonth.getMonth()&&d.getFullYear()===thisMonth.getFullYear();}).length;
  document.getElementById('walkinStats').innerHTML=`
    <div class="stat-card orange"><div class="stat-label">Today's Walk-Ins</div><div class="stat-value">${todayCount}</div><div class="stat-hint">₱${(todayCount*getWalkinFee()).toLocaleString()} collected today</div></div>
    <div class="stat-card green"><div class="stat-label">This Month</div><div class="stat-value">${monthlyCount}</div><div class="stat-hint">Walk-in visits</div></div>
    <div class="stat-card gold"><div class="stat-label">Total Walk-In Revenue</div><div class="stat-value" style="font-size:22px">₱${totalRevenue.toLocaleString()}</div><div class="stat-hint">All-time earnings</div></div>`;
  data=data.slice().reverse();
  const perPage=10;const total=data.length;const pages=Math.ceil(total/perPage)||1;
  const slice=data.slice((walkinPage-1)*perPage,walkinPage*perPage);
  const rows=slice.length?slice.map(w=>`<tr>
    <td>${esc(w.id)}</td>
    <td>${esc(w.visitorName)}</td>
    <td>${formatDate(w.date)}</td>
    <td>${esc(w.time)}</td>
    <td style="color:var(--green);font-weight:600">₱${Number(w.fee).toLocaleString()}</td>
    <td>${esc(w.recordedBy||'—')}</td>
    <td><div class="td-actions"><button class="btn-icon" title="View Receipt" onclick="viewWalkinReceipt('${w.id}')">🧾</button></div></td>
  </tr>`).join(''):`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🚶</div><p>No walk-in records found</p></div></td></tr>`;
  let pag='';if(pages>1){pag=`<div class="pagination"><button class="page-btn" onclick="walkinPage=${walkinPage-1};refreshWalkinTable()" ${walkinPage===1?'disabled':''}>‹</button>${Array.from({length:pages},(_,i)=>`<button class="page-btn ${i+1===walkinPage?'active':''}" onclick="walkinPage=${i+1};refreshWalkinTable()">${i+1}</button>`).join('')}<button class="page-btn" onclick="walkinPage=${walkinPage+1};refreshWalkinTable()" ${walkinPage===pages?'disabled':''}>›</button><span class="page-info">${total} records</span></div>`;}
  document.getElementById('walkinTableCard').innerHTML=`
    <div class="table-header"><h3>Walk-In Records <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${total} record${total!==1?'s':''}</span></h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Visitor Name</th><th>Date</th><th>Time</th><th>Fee</th><th>Recorded By</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${pag}`;
}
// ======================================================================
// RECEIPT PRINT (receipt-only clean sheet via hidden iframe)
// ======================================================================
function printReceipt(){
  const node=document.querySelector('#receiptBody .receipt');
  if(!node){toast('No receipt to print.','error');return;}
  // Hidden iframe instead of window.open(): pop-up blockers and mobile
  // browsers frequently block or blank the old pop-up approach.
  const old=document.getElementById('rcPrintFrame');
  if(old&&old.parentNode)old.parentNode.removeChild(old);
  const frame=document.createElement('iframe');
  frame.id='rcPrintFrame';
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
  document.body.appendChild(frame);
  const doc=frame.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FitCore Receipt</title><style>
  *{box-sizing:border-box;margin:0;padding:0}
  @page{margin:12mm}
  body{font-family:'Roboto','Segoe UI',Arial,sans-serif;background:#fff;color:#0a0a0a;padding:26px;display:flex;justify-content:center;font-size:14px;line-height:1.5}
  .sheet{width:100%;max-width:430px}
  .receipt{background:#fff;color:#0a0a0a;padding:30px 28px 22px;border-radius:18px;position:relative;overflow:hidden;width:100%;border:1px solid #e6ebf4}
  .receipt::before{content:'';position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg,#16a34a 0%,#fbbf24 50%,#b3bcb5 100%)}
  .receipt-header{text-align:center;margin-bottom:16px}
  .receipt-sticker{display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
  .receipt h2{font-family:'Arial Black',Impact,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#0a0a0a;line-height:1;margin-bottom:6px}
  .receipt h2 span{color:#16a34a}
  .receipt-sub{font-size:10px;color:#8b96ad;letter-spacing:2px;text-transform:uppercase;font-weight:700}
  .receipt-tag{display:inline-block;margin-top:12px;padding:5px 14px;border-radius:100px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
  .tag-paid{background:linear-gradient(135deg,#bbf7d0,#86efac);color:#14532d;border:1px solid #86efac}
  .tag-renew{background:linear-gradient(135deg,#fde68a,#fbbf24);color:#78350f;border:1px solid #fbbf24}
  .tag-walkin{background:linear-gradient(135deg,#e5e7eb,#cbd5d1);color:#0a0a0a;border:1px solid #cbd5d1}
  .receipt-meta{display:flex;justify-content:space-between;gap:12px;background:#f6f8fc;border:1px solid #e6ebf4;border-radius:10px;padding:10px 14px;margin-bottom:12px}
  .receipt-meta div{min-width:0}
  .receipt-meta span{display:block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#8b96ad;margin-bottom:2px}
  .receipt-meta strong{font-size:12px;color:#0a0a0a;letter-spacing:.5px}
  .receipt-body{padding:4px 2px}
  .receipt-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-bottom:1px dashed #dde3ee;font-size:13px}
  .receipt-row:last-child{border-bottom:none}
  .receipt-row span{color:#6d7ca0}
  .receipt-row strong{color:#0a0a0a;font-weight:700;text-align:right}
  .receipt-total{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,rgba(34,197,94,.10),rgba(251,191,36,.08));border:1px solid rgba(34,197,94,.35);border-radius:12px;padding:14px 16px;margin-top:14px}
  .receipt-total span{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#15803d}
  .receipt-total strong{font-size:24px;font-family:'Arial Black',Impact,sans-serif;font-weight:900;color:#15803d}
  .receipt-foot{margin-top:16px;text-align:center}
  .receipt-footer-note{font-size:11px;color:#8b96ad}
  .receipt-barcode{width:170px;height:34px;margin:14px auto 8px;background:repeating-linear-gradient(90deg,#0a0a0a 0 2px,transparent 2px 5px,#0a0a0a 5px 6px,transparent 6px 10px);opacity:.85}
  .receipt-thanks{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8b96ad}
  @media print{
    body{padding:0}
    .receipt{border:none;border-radius:0;max-width:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .receipt::before{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
  </style></head><body><div class="sheet">${node.outerHTML}</div></body></html>`);
  doc.close();
  const printNow=function(){
    try{
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }catch(e){toast('Print failed. Please try again.','error');}
    setTimeout(function(){if(frame.parentNode)frame.parentNode.removeChild(frame);},60000);
  };
  if(doc.readyState==='complete')setTimeout(printNow,200);
  else frame.onload=function(){setTimeout(printNow,200);};
}
function viewWalkinReceipt(id){
  const w=Walkins.all().find(x=>x.id===id);if(!w)return;
  const users=Users.all();
  const match=users.find(u=>u.username===w.recordedBy||u.name===w.recordedBy);
  const staffDisplay=match?match.name:(w.recordedBy||'—');
  const recordedTime=w.time||'—';
  document.getElementById('receiptBody').innerHTML=`
  <div class="receipt">
    <div class="receipt-header">
      <div class="receipt-sticker">
        <svg width="46" height="46" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="48" rx="12" fill="url(#rcGrad)"/>
          <rect x="8" y="21" width="7" height="6" rx="2" fill="white"/>
          <rect x="33" y="21" width="7" height="6" rx="2" fill="white"/>
          <rect x="13" y="17" width="5" height="14" rx="2" fill="white"/>
          <rect x="30" y="17" width="5" height="14" rx="2" fill="white"/>
          <rect x="18" y="22" width="12" height="4" rx="2" fill="white"/>
          <defs><linearGradient id="rcGrad" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stop-color="#7ffa88"/><stop offset="100%" stop-color="#4ade80"/></linearGradient></defs>
        </svg>
      </div>
      <h2>FITCORE <span>GMS</span></h2>
      <div class="receipt-sub">Gym Management System</div>
      <div class="receipt-tag tag-walkin">🎟️ Walk-In Receipt</div>
    </div>
    <div class="receipt-meta">
      <div><span>Receipt No.</span><strong>${w.id}</strong></div>
      <div><span>Visit Date</span><strong>${formatDate(w.date)}</strong></div>
    </div>
    <div class="receipt-body">
      <div class="receipt-row"><span>Visitor Name</span><strong>${esc(w.visitorName)}</strong></div>
      <div class="receipt-row"><span>Visit Type</span><strong>Walk-In (Single Visit)</strong></div>
      <div class="receipt-row"><span>Time In</span><strong>${esc(recordedTime)}</strong></div>
      <div class="receipt-row"><span>Payment Method</span><strong>Cash</strong></div>
    </div>
    <div class="receipt-total">
      <span>Amount Paid</span>
      <strong>&#8369;${Number(w.fee).toLocaleString()}</strong>
    </div>
    <div class="receipt-foot">
      <div class="receipt-footer-note">Recorded by <strong>${esc(staffDisplay)}</strong> &middot; ${formatDate(w.date)} ${esc(recordedTime)}</div>
      <div class="receipt-barcode" aria-hidden="true"></div>
      <div class="receipt-thanks">Train hard &middot; Stay strong &middot; See you at FitCore</div>
    </div>
  </div>`;
  openModal('receiptModal');
}
function openWalkinModal(){
  document.getElementById('wi_name').value='';
  document.getElementById('walkinError').style.display='none';
  const fee=getWalkinFee();
  const feeEl=document.getElementById('walkinFeeDisplay');
  if(feeEl)feeEl.textContent='₱'+formatPeso(fee);
  const feeNote=document.getElementById('walkinFeeNote');
  if(feeNote)feeNote.textContent='Daily rate · Single visit · Set by admin';
  document.getElementById('walkinFooterDefault').style.display='flex';
  document.getElementById('walkinFooterConfirm').style.display='none';
  openModal('walkinModal');
}
function walkinAskConfirm(){
  const name=document.getElementById('wi_name').value.trim();
  const err=document.getElementById('walkinError');
  err.style.display='none';
  if(!name){err.textContent="Please enter the visitor's full name to proceed.";err.style.display='block';return;}
  const confEl=document.getElementById('walkinConfirmText');
  if(confEl)confEl.innerHTML=`⚠️ Are you sure you want to record this walk-in and collect <strong>₱${formatPeso(getWalkinFee())}</strong>?`;
  document.getElementById('walkinFooterDefault').style.display='none';
  document.getElementById('walkinFooterConfirm').style.display='flex';
}
function walkinCancelConfirm(){
  document.getElementById('walkinFooterDefault').style.display='flex';
  document.getElementById('walkinFooterConfirm').style.display='none';
}
function saveWalkin(){
  const name=document.getElementById('wi_name').value.trim();
  const err=document.getElementById('walkinError');
  err.style.display='none';
  if(!name){err.textContent="Please enter the visitor's full name to proceed.";err.style.display='block';return;}
  const walkins=Walkins.all();
  const now=new Date();
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const newId='WI-'+String(walkins.length+1).padStart(4,'0');
  const fee=getWalkinFee();
  walkins.push({id:newId,visitorName:sanitizeText(name),date:today(),time,fee,recordedBy:currentUser.username,createdAt:today()});
  Walkins.save(walkins);
  toast(`Walk-in recorded for ${name}. Fee: ₱${fee.toLocaleString()}.00`);
  closeModal('walkinModal');renderWalkin();
}
function deleteWalkin(id){
  openConfirm('Delete Walk-In','Are you sure you want to delete this walk-in record?',()=>{
    Walkins.remove(id);toast('Walk-in record deleted.','info');renderWalkin();
  });
}
function openWalkinSettingsModal(){
  if(currentUser.role!=='admin'){toast('Only admins can change the walk-in price.','error');return;}
  document.getElementById('wiFeeInput').value=getWalkinFee();
  document.getElementById('walkinFeeError').style.display='none';
  openModal('walkinSettingsModal');
}
function saveWalkinFee(){
  if(currentUser.role!=='admin'){toast('Only admins can change the walk-in price.','error');return;}
  const err=document.getElementById('walkinFeeError');
  err.style.display='none';
  const val=parseFloat(document.getElementById('wiFeeInput').value);
  if(!val||val<=0){err.textContent='Please enter a valid price greater than zero.';err.style.display='block';return;}
  if(val>10000){err.textContent='Price looks too high. Enter a reasonable daily rate.';err.style.display='block';return;}
  setWalkinFee(val);
  logActivity('Updated','Settings','Walk-in daily rate set to ₱'+val.toLocaleString(),'Daily walk-in fee');
  toast(`Walk-in price updated to ₱${val.toLocaleString()}.00`);
  closeModal('walkinSettingsModal');
  renderWalkin();
  const explore=document.getElementById('landingExplore');
  if(explore&&explore.style.display!=='none')renderExplorePlans();
  syncStaticWalkinPrice();
}

// ======================================================================
// PANEL: PLANS
// ======================================================================
function renderPlans(){
  const el=document.getElementById('panelPlans');
  const plans=Plans.all();
  const members=Members.all().filter(m=>m.status!=='Archived');
  const isStaff=currentUser.role==='staff';
  // Get admin info
  const admin=Users.all().find(u=>u.role==='admin');
  const adminName=admin?admin.name:'Administrator';
  const adminContact=admin&&admin.contact?admin.contact:'—';
  const adminUsername=admin?admin.username:'—';
  const cards=plans.map(p=>{
    const count=members.filter(m=>m.planId===p.id).length;
    const benefits=(p.benefits||'').split(/\n|,/).map(b=>b.trim()).filter(Boolean);
    return`<div class="plan-card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div><div class="plan-card-name">${esc(p.name)}</div><span class="badge ${p.status==='Active'?'badge-active':'badge-inactive'}">${esc(p.status)}</span></div>
        ${!isStaff?`<div class="td-actions"><button class="btn-icon" onclick="openPlanModal('${p.id}')">✏️</button></div>`:''}
      </div>
      <div class="plan-card-price">₱${Number(p.price).toLocaleString()}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--navy-700);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px">Duration</div><div style="font-weight:700">${p.duration} mo.</div></div>
        <div style="background:var(--navy-700);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px">Sessions</div><div style="font-weight:700">${p.sessions}</div></div>
      </div>
      ${benefits.map(b=>`<div class="plan-feature">✓ ${esc(b)}</div>`).join('')}
      <div style="margin-top:10px;font-size:11px;color:var(--gray-500)">${count} active member${count!==1?'s':''}</div>
    </div>`;}).join('');
  el.innerHTML=`
  <div class="page-actions">
    ${isStaff?`<div style="background:rgba(179,188,181,.08);border:1px solid rgba(179,188,181,.25);border-radius:10px;padding:16px 20px;font-size:13px;color:#b3bcb5;width:100%">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-weight:700;font-size:14px;color:#93c5fd">
        <span style="font-size:18px">👁</span> View Only — Contact the Administrator to modify membership plans.
      </div>
      <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:22px">📞</span>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--gray-500);margin-bottom:2px">Admin Contact Number</div>
          <div style="color:var(--white);font-weight:800;font-size:16px;letter-spacing:1px">${esc(adminContact)}</div>
        </div>
      </div>
    </div>`:'<div></div>'}
    ${!isStaff?`<button class="btn-primary" onclick="openPlanModal()">+ Add New Plan</button>`:''}
  </div>
  <div class="plan-grid">${cards||`<div class="empty-state"><div class="empty-icon">📋</div><p>No plans created yet</p></div>`}</div>`;
}
let editingPlanId=null;
function openPlanModal(id=null){
  editingPlanId=id;
  document.getElementById('planModalTitle').textContent=id?'Edit Plan':'Add New Plan';
  document.getElementById('planFormError').style.display='none';
  if(id){
    const p=Plans.one(id);if(!p)return;
    document.getElementById('plf_name').value=p.name;document.getElementById('plf_price').value=p.price;
    document.getElementById('plf_dur').value=p.duration;
    if(p.sessions==='Unlimited'){document.getElementById('plf_unlimited').checked=true;document.getElementById('plf_sessions').value='';document.getElementById('plf_sessions').disabled=true;}
    else{document.getElementById('plf_unlimited').checked=false;document.getElementById('plf_sessions').value=p.sessions;document.getElementById('plf_sessions').disabled=false;}
    document.getElementById('plf_benefits').value=p.benefits||'';document.getElementById('plf_status').value=p.status||'Active';
  } else {
    ['plf_name','plf_price','plf_dur','plf_sessions','plf_benefits'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('plf_unlimited').checked=false;document.getElementById('plf_sessions').disabled=false;document.getElementById('plf_status').value='Active';
  }
  openModal('planModal');
}
function toggleUnlimited(cb){document.getElementById('plf_sessions').disabled=cb.checked;if(cb.checked)document.getElementById('plf_sessions').value='';}
function savePlan(){
  if(!currentUser||currentUser.role!=='admin'){toast('Only admins can create or edit membership plans.','error');return;}
  const name=document.getElementById('plf_name').value.trim();
  const price=parseFloat(document.getElementById('plf_price').value);
  const dur=parseInt(document.getElementById('plf_dur').value);
  const unlimited=document.getElementById('plf_unlimited').checked;
  const sessions=unlimited?'Unlimited':parseInt(document.getElementById('plf_sessions').value);
  const benefits=document.getElementById('plf_benefits').value.trim();
  const status=document.getElementById('plf_status').value;
  const err=document.getElementById('planFormError');
  err.style.display='none';
  if(!name||!price||!dur||(!unlimited&&!sessions)){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  if(price<=0||dur<=0){err.textContent='Invalid price or duration. Please enter values greater than zero.';err.style.display='block';return;}
  const plans=Plans.all();
  const dup=plans.find(p=>p.name.toLowerCase()===name.toLowerCase()&&p.id!==editingPlanId);
  if(dup){err.textContent='Plan name already in use. Please choose a different plan name.';err.style.display='block';return;}
  const data={name:sanitizeText(name),price,duration:dur,sessions,benefits:sanitizeText(benefits),status};
  if(editingPlanId){
    const idx=plans.findIndex(p=>p.id===editingPlanId);
    if(idx>-1)plans[idx]={...plans[idx],...data};Plans.save(plans);toast('Plan updated.');
  } else {plans.push({id:uid(),...data});Plans.save(plans);toast('Plan created.');}
  closeModal('planModal');renderPlans();renderExplorePlans();
}
function renderExplorePlans(){
  const container=document.getElementById('exploreCardsContainer');
  if(!container)return;
  if(!Plans.all().length&&window.GMSFB&&GMSFB.enabled&&typeof GMSFB.ensureSeededPlans==='function')GMSFB.ensureSeededPlans();
  const plans=Plans.all().filter(p=>p.status==='Active');
  const badges=['Starter','Popular','Best Value','Elite','Premium','Top Pick'];
  const featuredIdx=1; // second plan is "featured" (orange border)
  let html=plans.map((p,i)=>{
    const isFeatured=i===featuredIdx;
    const durLabel=p.duration===1?'/mo':(p.duration===3?'/3mo':'/'+p.duration+'mo');
    const sessLabel=p.sessions==='Unlimited'?'Unlimited Sessions':(p.sessions+' Sessions');
    const benefitLines=p.benefits?p.benefits.split('\n').filter(b=>b.trim()).map(b=>`<li>&#10003; ${esc(b.trim())}</li>`).join(''):'<li>&#10003; Gym Access</li>';
    const badge=badges[i]||'Plan';
    return`<div class="explore-card${isFeatured?' featured':''} reveal reveal-d${i%4}">
      <div class="ec-badge">${esc(badge)}</div>
      <div class="ec-name">${esc(p.name)}</div>
      <div class="ec-price">&#8369;${Number(p.price).toLocaleString()}<span>${esc(durLabel)}</span></div>
      <ul class="ec-features">${benefitLines}<li>&#10003; ${esc(sessLabel)}</li></ul>
      <button class="btn-primary ec-btn" onclick="startMemberSignup('${p.id}')">Choose ${esc(p.name)} →</button>
    </div>`;
  }).join('');
  // Always append the static Walk-In card at the end
  html+=`<div class="explore-card walkin-card reveal reveal-d3">
    <div class="ec-badge">No Commitment</div>
    <div class="ec-name">Walk-In</div>
    <div class="ec-price">&#8369;${getWalkinFee().toLocaleString()}<span>/day</span></div>
    <ul class="ec-features"><li>&#10003; Full Gym Access</li><li>&#10003; Single Day Pass</li><li>&#10003; No Registration</li><li>&#10003; Pay at Front Desk</li></ul>
    <button class="btn-primary ec-btn btn-gold" onclick="showLandingSection('register',null)">Visit Us →</button>
    <div class="walkin-note">&#9888; For occasional visitors.<br>No membership required.</div>
  </div>`;
  container.innerHTML=html;
  initReveals();
}

// ======================================================================
// LANDING: TRAINERS, COUNTERS, SCROLL REVEALS
// ======================================================================
function renderTrainers(){
  const container=document.getElementById('trainersGrid');
  if(!container)return;
  const trainers=Users.all().filter(u=>u.role==='trainer'&&u.status==='active');
  if(!trainers.length){
    container.innerHTML=`<div class="empty-state" style="grid-column:1/-1;background:var(--glass-bg);border:var(--glass-border);border-radius:var(--radius)"><div class="empty-icon">&#127948;</div><p>Trainer profiles are being set up. Check back soon!</p></div>`;
    return;
  }
  container.innerHTML=trainers.map((t,i)=>{
    const name=t.coachName||t.name;
    const _tSpecs=trainerSpecList(t);
    const specs=_tSpecs.length?_tSpecs.slice(0,3).map(esc).join(' · '):'Certified Trainer';
    const days=(t.availableDays&&t.availableDays.length)?`<span>${iconSvg('calendar',12)} ${t.availableDays.map(esc).join(', ')}</span>`:'';
    const hours=(t.availableFrom&&t.availableTo)?`<span>${iconSvg('clock',12)} ${esc(t.availableFrom)} – ${esc(t.availableTo)}</span>`:'';
    return`<div class="trainer-card reveal reveal-d${i%4}">
      <div class="tc-avatar">${esc(initials(name))}</div>
      <div class="tc-name">${esc(name)}</div>
      <div class="tc-role">${specs}</div>
      ${t.bio?`<p class="tc-bio">${esc(t.bio)}</p>`:''}
      <div class="tc-meta">${days}${hours}</div>
    </div>`;
  }).join('');
  initReveals();
}

let _revealObserver=null;
function initReveals(){
  const els=document.querySelectorAll('.reveal:not(.visible)');
  if(!els.length)return;
  if(_revealObserver){
    els.forEach(el=>_revealObserver.observe(el));
    return;
  }
  _revealObserver=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(en.isIntersecting){en.target.classList.add('visible');_revealObserver.unobserve(en.target);}
    });
  },{threshold:.12});
  els.forEach(el=>_revealObserver.observe(el));
}

function animateCount(el,target,dur=1100,from=0){
  if(!el)return;
  const end=parseInt(target,10);
  if(isNaN(end)){el.textContent=target;return;}
  const token=(el._countToken=(el._countToken||0)+1);const t0=performance.now();
  function step(t){
    const p=Math.min(1,(t-t0)/dur);
    const eased=1-Math.pow(1-p,3);
    if(el._countToken!==token)return;el.textContent=Math.round(from+(end-from)*eased);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function initHeroStats(){
  document.querySelectorAll('#landingHome [data-count]').forEach(el=>{
    if(el.dataset.counted)return;
    el.dataset.counted='1';
    animateCount(el,el.dataset.count);
  });
}

/* ======================================================================
   Portfolio-style FX: cursor glow + scroll progress bar
   ====================================================================== */
function initCursorGlow(){
  const glow=document.getElementById('cursorGlow');
  if(!glow)return;
  if(window.matchMedia&&window.matchMedia('(hover:none),(pointer:coarse)').matches){glow.style.display='none';return;}
  let raf=null;
  window.addEventListener('mousemove',e=>{
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      glow.style.left=e.clientX+'px';
      glow.style.top=e.clientY+'px';
      glow.classList.remove('idle');
      raf=null;
    });
  },{passive:true});
  document.addEventListener('mouseleave',()=>glow.classList.add('idle'));
}
function initProgressBar(){
  const fill=document.getElementById('progressFill');
  if(!fill)return;
  function update(){
    const doc=document.documentElement;
    const max=doc.scrollHeight-doc.clientHeight;
    fill.style.width=(max>0?(window.scrollY/max)*100:0)+'%';
  }
  window.addEventListener('scroll',update,{passive:true});
  window.addEventListener('resize',update);
  update();
}

function deletePlan(id){
  if(!currentUser||currentUser.role!=='admin'){toast('Only admins can delete membership plans.','error');return;}
  const p=Plans.one(id);
  if(activeCount>0){toast('Cannot delete this plan. There are active members currently enrolled in it.','error');return;}
  openConfirm('Delete Plan',`Delete plan "${esc(p?p.name:'')}"?`,()=>{
    Plans.remove(id);toast('Plan deleted.');renderPlans();renderExplorePlans();
  });
}

// ======================================================================
// PANEL: REPORTS
// ======================================================================
let reportType='revenue';
function renderActivityLog(){
  // Internal audit trail for admin/staff/trainer. Member activity is private.
  const el=document.getElementById('panelActivityLog');
  if(!el) return;
  pruneMemberActivity();
  const cloudOk=!!(window.GMSFB&&GMSFB.enabled&&GMSFB.ready&&!(typeof GMSFB.degraded==='function'&&GMSFB.degraded()));
  el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px"><div><h2 style="font-size:18px;font-weight:800;color:var(--white);margin:0">Activity Log</h2><p style="font-size:12px;color:var(--gray-500);margin:4px 0 0">Internal team only (admin, staff, trainer). Member activity is private and excluded.</p></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${cloudOk?'var(--green)':'var(--gold)'};border:1px solid ${cloudOk?'rgba(127,250,136,.28)':'rgba(251,191,36,.3)'};background:${cloudOk?'rgba(127,250,136,.08)':'rgba(251,191,36,.08)'};border-radius:999px;padding:5px 9px">${cloudOk?'Cloud synced':'Sync issue'}</span><button class="btn-secondary btn-sm" onclick="renderActivityLog()">Refresh</button></div></div><div id="activityLogOutput"></div>`;
  let log=(ActivityLog.all()||[]).filter(e=>!_isMemberActivity(e));
  log=log.slice().sort((a,b)=> new Date(b.at) - new Date(a.at));
  const output=document.getElementById('activityLogOutput');
  if(!log.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><p>No internal activity recorded yet.</p><p style="font-size:12px;color:var(--gray-500);margin-top:6px">Member actions are private and never appear here.</p></div>`;return;}
  const actionColor={'Added':'#7ffa88','Edited':'#fbbf24','Deleted':'#ef4444','Status Changed':'#b3bcb5'};
  const actionBg={'Added':'rgba(127,250,136,.12)','Edited':'rgba(251,191,36,.12)','Deleted':'rgba(239,68,68,.12)','Status Changed':'rgba(96,165,250,.12)'};
  const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
  const rows=log.map(e=>{
    const clr=actionColor[e.action]||'var(--gray-300)';
    const bg=actionBg[e.action]||'rgba(255,255,255,.05)';
    const roleClr=roleColorMap[e.byRole]||'var(--gray-300)';
    const dt=new Date(e.at);
    const dateStr=dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const timeStr=dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return `<tr>
      <td><span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:4px;background:${bg};color:${clr};white-space:nowrap">${esc(e.action)}</span></td>
      <td>${esc(e.category)}</td>
      <td style="font-weight:700">${esc(e.detail||'')}</td>
      <td>${esc(e.extra||'')}</td>
      <td><span style="font-weight:700">${esc(e.by||'')}</span> <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.09);color:${roleClr};margin-left:3px;text-transform:uppercase">${esc(e.byRole||'')}</span></td>
      <td><div style="font-size:12px;font-weight:700">${dateStr}</div><div style="font-size:11px;color:var(--gray-300)">${timeStr}</div></td>
    </tr>`;
  }).join('');
  output.innerHTML=`<div class="table-card"><div class="table-header"><h3>Activity Log <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:6px">${log.length} record${log.length!==1?'s':''}</span></h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printActivityLog()">Print</button><button class="btn-secondary btn-sm" onclick="exportActivityLogCSV()">Export CSV</button></div></div><div style="overflow-x:auto"><table><thead><tr><th>Action</th><th>Category</th><th>Name / Detail</th><th>Info</th><th>Done By</th><th>Date & Time</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function printActivityLog(){
  const out=document.getElementById('activityLogOutput');
  if(!out||!out.innerHTML.trim()){toast('No activity to print.','error');return;}
  const old=document.getElementById('reportPrintFrame'); if(old&&old.parentNode)old.parentNode.removeChild(old);
  const frame=document.createElement('iframe'); frame.id='reportPrintFrame'; frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;'; document.body.appendChild(frame);
  const doc=frame.contentWindow.document; doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>Activity Log</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th{background:#0a0a0a;color:#fff;padding:8px;text-align:left}td{padding:7px;border-bottom:1px solid #eee} .badge{padding:2px 8px;border-radius:100px;font-size:9.5px;font-weight:800}</style></head><body>${out.innerHTML}</body></html>`);
  doc.close(); setTimeout(()=>frame.contentWindow.print(),300);
}
function exportActivityLogCSV(){
  let log=(ActivityLog.all()||[]).filter(e=>!_isMemberActivity(e));
  if(!log.length){toast('No internal activity to export.','error');return;}
  const csv='Action,Category,Detail,Extra,Done By,Role,Date\n' + log.map(e=> `${e.action},${e.category},"${(e.detail||'').replace(/"/g,'""')}","${(e.extra||'').replace(/"/g,'""')}",${e.by},${e.byRole},${e.at}`).join('\n');
  const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='activity_log_'+today()+'.csv'; a.click(); URL.revokeObjectURL(url);
}
function renderReports(){
  const el=document.getElementById('panelReports');
  const isStaff=currentUser.role==='staff';
  el.innerHTML=`
  <div class="report-tabs">
    <button class="rtab ${reportType==='revenue'?'active':''}" onclick="reportType='revenue';renderReports()">💰 Revenue</button>
    <button class="rtab ${reportType==='attendance'?'active':''}" onclick="reportType='attendance';renderReports()">📋 Attendance</button>
    <button class="rtab ${reportType==='membership'?'active':''}" onclick="reportType='membership';renderReports()">👥 Membership</button>
    ${!isStaff?`<button class="rtab ${reportType==='trainer'?'active':''}" onclick="reportType='trainer';renderReports()">🏋️ Trainer Schedule</button>
    <button class="rtab ${reportType==='activity'?'active':''}" onclick="reportType='activity';renderReports()">📝 Activity Log</button>`:''}
  </div>
  ${isStaff&&(reportType==='trainer'||reportType==='activity')?(reportType='revenue',''):''}
  <div class="report-filters" id="reportFilters">
    <div class="form-group"><label>From Date</label><input type="date" id="rpt_from" class="search-input"></div>
    <div class="form-group"><label>To Date</label><input type="date" id="rpt_to" class="search-input"></div>
    ${reportType==='revenue'?`<div class="form-group"><label>Plan</label><select id="rpt_plan" class="filter-sel"><option value="all">All Plans</option>${Plans.all().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>`:''}
    ${reportType==='attendance'?`<div class="form-group"><label>Member</label><select id="rpt_member" class="filter-sel"><option value="all">All Members</option>${Members.all().filter(m=>m.status!=='Archived').map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>`:''}
    ${reportType==='membership'?`<div class="form-group"><label>Search Member</label><div style="position:relative"><input type="text" id="rpt_member_search" class="search-input" placeholder="Type member name…" oninput="filterMemberReportList(this.value)" onfocus="filterMemberReportList(this.value)" autocomplete="off" style="width:100%"><div id="rpt_member_drop" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--navy-800);border:1.5px solid var(--orange);border-radius:10px;z-index:200;max-height:240px;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,.6)">${(()=>{const active=Members.all().filter(m=>m.status!=='Archived');const deleted=Members.all().filter(m=>m.status==='Archived');let html='';if(active.length){html+=`<div style="padding:6px 12px 4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--green);background:rgba(127,250,136,.05);border-bottom:1px solid rgba(127,250,136,.12);position:sticky;top:0">✓ Active Members</div>`;html+=active.map(m=>`<div class="country-item" style="padding:9px 14px" onclick="selectMemberReport('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}')"><span style="font-weight:600">${esc(m.name)}</span></div>`).join('');}if(deleted.length){html+=`<div style="padding:6px 12px 4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#fca5a5;background:rgba(239,68,68,.05);border-top:1px solid rgba(239,68,68,.15);border-bottom:1px solid rgba(239,68,68,.1);position:sticky;top:0">⚠ Deleted Members</div>`;html+=deleted.map(m=>`<div class="country-item" style="padding:9px 14px;opacity:.75" onclick="selectMemberReport('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}')"><span style="font-weight:600;color:var(--gray-300)">${esc(m.name)}</span><span style="margin-left:8px;font-size:9px;font-weight:800;color:#fca5a5;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.25);border-radius:4px;padding:1px 6px">DELETED</span></div>`).join('');}return html;})()}</div></div><input type="hidden" id="rpt_member_id" value="all"></div>`:''}

    ${reportType==='trainer'?`<div class="form-group"><label>Search Trainer</label><div style="position:relative"><input type="text" id="rpt_trainer_search" class="search-input" placeholder="Type trainer name…" oninput="filterTrainerReportList(this.value)" autocomplete="off" style="width:100%"><div id="rpt_trainer_drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--navy-800);border:1.5px solid var(--orange);border-radius:8px;z-index:200;max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.5)">${Users.all().filter(u=>u.role==='trainer').map(u=>`<div class="country-item" onclick="selectTrainerReport('${u.id}','${esc(u.name).replace(/'/g,"&#39;")}')"><span>${esc(u.name)}</span></div>`).join('')}</div></div><input type="hidden" id="rpt_trainer_filter" value="all"></div>`:''}

    ${reportType==='activity'?`<div class="form-group"><label>Category</label><select id="rpt_act_cat" class="filter-sel"><option value="all">All</option><option value="Member">Member</option><option value="Session">Session</option></select></div><div class="form-group"><label>Action</label><select id="rpt_act_action" class="filter-sel"><option value="all">All Actions</option><option value="Added">Added</option><option value="Edited">Edited</option><option value="Deleted">Deleted</option><option value="Status Changed">Status Changed</option></select></div>`:''}
    <div class="form-group" style="align-self:end"><button class="btn-primary" onclick="generateReport()">Generate Report</button></div>
  </div>
  <div class="report-output" id="reportOutput"></div>`;
}
function generateReport(){
  const fromInput=document.getElementById('rpt_from')?.value||'';
  const toInput=document.getElementById('rpt_to')?.value||'';
  const from=fromInput;
  const to=toInput||today();
  const output=document.getElementById('reportOutput');
  output.classList.add('visible');
  if(reportType==='revenue'){
    let data=Payments.all();
    if(from)data=data.filter(p=>p.date>=from);
    if(to)data=data.filter(p=>p.date<=to);
    const planFilter=document.getElementById('rpt_plan')?.value||'all';
    if(planFilter!=='all')data=data.filter(p=>p.planId===planFilter);
    // Walk-in revenue
    let walkins=Walkins.all();
    if(from)walkins=walkins.filter(w=>w.date>=from);
    if(to)walkins=walkins.filter(w=>w.date<=to);
    const walkinRevenue=walkins.reduce((a,w)=>a+Number(w.fee),0);
    if(!data.length&&!walkins.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>No data found for the selected filters. Try adjusting the date range.</p></div>`;return;}
    const memberRevenue=data.reduce((a,p)=>a+Number(p.amount),0);
    const total=memberRevenue+walkinRevenue;
    const txCount=data.length+walkins.length;
    const avgAmount=txCount?total/txCount:0;
    // Group by month (combined)
    const byMonth={};
    data.forEach(p=>{const m=p.date.slice(0,7);byMonth[m]=(byMonth[m]||0)+Number(p.amount);});
    walkins.forEach(w=>{const m=w.date.slice(0,7);byMonth[m]=(byMonth[m]||0)+Number(w.fee);});
    const months=Object.keys(byMonth).sort();
    const monthShort=m=>new Date(m+'-01').toLocaleString('en-US',{month:'short'});
    const maxVal=Math.max(...Object.values(byMonth),1);
    const barW=50;const gap=16;const chartH=120;
    const bars=months.map((m,i)=>{const v=byMonth[m];const bh=Math.max(4,(v/maxVal)*chartH);const x=i*(barW+gap)+10;const y=chartH-bh+20;return`<g><rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="5" fill="url(#repBarGrad)"/><rect x="${x}" y="${y}" width="${barW}" height="3" rx="1.5" fill="rgba(255,255,255,.35)"/><text x="${x+barW/2}" y="${chartH+32}" text-anchor="middle" fill="#b3bcb5" font-size="10">${monthShort(m)}</text><text x="${x+barW/2}" y="${y-4}" text-anchor="middle" fill="#7ffa88" font-size="9" font-weight="700">₱${v>=1000?(v/1000).toFixed(1)+'k':v}</text></g>`;}).join('');
    const svgW=Math.max(300,months.length*(barW+gap)+30);
    const gridLines=[20,50,80,110,140].map(y=>`<line x1="10" y1="${y}" x2="${svgW-10}" y2="${y}" stroke="rgba(179,188,181,.12)" stroke-width="1"/>`).join('');
    const revUsers=Users.all();
    function revRecorderLabel(name){
      if(!name||name==='—')return'—';
      const u=revUsers.find(x=>x.name===name||x.username===name);
      if(!u)return name;
      const roleMap={admin:'Admin',staff:'Staff',trainer:'Trainer'};
      const tag=roleMap[u.role]||u.role;
      const col=u.role==='admin'?'var(--orange)':u.role==='trainer'?'var(--green)':'#d7ddd8';
      return`${esc(u.name)} <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:${col};margin-left:4px">${esc(tag)}</span>`;
    }
    const rows=data.slice().reverse().map(p=>`<tr><td>${esc(p.id)}</td><td>${esc(p.memberName)}</td><td>${esc(p.planName)}</td><td style="color:var(--green)">₱${Number(p.amount).toLocaleString()}</td><td>${formatDate(p.date)}</td><td>${esc(p.method)}</td><td>${revRecorderLabel(p.recordedBy)}</td><td><span class="badge badge-paid">Membership</span></td></tr>`).join('');
    const walkinRows=walkins.slice().reverse().map(w=>`<tr><td>${esc(w.id)}</td><td>${esc(w.visitorName)}</td><td>Walk-In</td><td style="color:var(--orange)">₱${Number(w.fee).toLocaleString()}</td><td>${formatDate(w.date)}</td><td>Cash</td><td>${revRecorderLabel(w.recordedBy)}</td><td><span class="badge badge-pending">Walk-In</span></td></tr>`).join('');
    output.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card orange"><div class="stat-label">Total Revenue</div><div class="stat-value" style="font-size:22px">₱${total.toLocaleString()}</div><div class="stat-hint">Memberships + Walk-Ins</div></div>
      <div class="stat-card green"><div class="stat-label">Membership Revenue</div><div class="stat-value" style="font-size:22px">₱${memberRevenue.toLocaleString()}</div></div>
      <div class="stat-card blue" style="border-left-color:#fbbf24"><div class="stat-label">Walk-In Revenue</div><div class="stat-value" style="font-size:22px">₱${walkinRevenue.toLocaleString()}</div><div class="stat-hint">${walkins.length} visit${walkins.length!==1?'s':''}${walkins.length?` · avg ₱${(walkinRevenue/walkins.length).toFixed(0)} per visit`:''}</div></div>
      <div class="stat-card gold"><div class="stat-label">Avg Transaction</div><div class="stat-value" style="font-size:22px">₱${avgAmount.toFixed(0)}</div></div>
    </div>
    ${months.length?`<div class="chart-card" style="margin-bottom:20px"><div class="chart-title">Combined Revenue by Month</div><svg viewBox="0 0 ${svgW} 160" style="height:160px"><defs><linearGradient id="repBarGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7ffa88"/><stop offset="100%" stop-color="#4ade80"/></linearGradient></defs>${gridLines}${bars}</svg></div>`:''}
    <div class="table-card">
      <div class="table-header"><h3>Revenue Records</h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printReport()">🖨️ Print</button><button class="btn-secondary btn-sm" onclick="exportCSV('revenue')">📥 Export CSV</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Name</th><th>Plan / Type</th><th>Amount</th><th>Date</th><th>Method</th><th>Recorded By</th><th>Type</th></tr></thead><tbody>${rows}${walkinRows}</tbody></table></div>
    </div>`;
  } else if(reportType==='attendance'){
    let data=Attendance.all();
    if(from)data=data.filter(a=>a.date>=from);
    if(to)data=data.filter(a=>a.date<=to);
    const memberFilter=document.getElementById('rpt_member')?.value||'all';
    if(memberFilter!=='all'){
      const memberIds=Sessions.all().filter(s=>s.memberId===memberFilter).map(s=>s.memberId);
      data=data.filter(a=>memberIds.includes(a.memberId));
    }
    if(!data.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>No data found for the selected filters. Try adjusting the date range.</p></div>`;return;}
    const checkedIn=data.filter(a=>a.checkIn&&!a.checkOut).length;
    const completed=data.filter(a=>a.checkOut).length;
    const users=Users.all();
    function recorderLabel(name){
      if(!name||name==='—')return'—';
      const u=users.find(x=>x.name===name||x.username===name);
      if(!u)return esc(name);
      const roleMap={admin:'Admin',staff:'Staff',trainer:'Trainer'};
      const tag=roleMap[u.role]||u.role;
      const col=u.role==='admin'?'var(--orange)':u.role==='trainer'?'var(--green)':'#d7ddd8';
      return`${esc(u.name)} <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:${col};margin-left:4px">${esc(tag)}</span>`;
    }
    const rows=data.slice().reverse().map(a=>{const m=Members.all().find(x=>x.id===a.memberId);return`<tr><td>${formatDate(a.date)}</td><td>${esc(a.checkIn||a.time||'—')}</td><td>${a.checkOut?esc(a.checkOut):'<span style="color:var(--gold)">In Gym</span>'}</td><td>${esc(a.duration||'—')}</td><td>${esc(m?m.name:'Unknown')}</td><td>${recorderLabel(a.recordedBy)}</td></tr>`;}).join('');
    output.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card orange"><div class="stat-label">Total Check-Ins</div><div class="stat-value">${data.length}</div></div>
      <div class="stat-card green"><div class="stat-label">Completed</div><div class="stat-value">${completed}</div><div class="stat-hint">Checked out</div></div>
      <div class="stat-card gold"><div class="stat-label">Still In Gym</div><div class="stat-value">${checkedIn}</div></div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Attendance Records</h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printReport()">🖨️ Print</button><button class="btn-secondary btn-sm" onclick="exportCSV('attendance')">📥 Export CSV</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th>Member</th><th>Recorded By</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  } else if(reportType==='trainer'){
    const allSessions=Sessions.all();
    const allUsers=Users.all();
    const allMembers=Members.all();
    let sessions=allSessions.slice();
    if(from)sessions=sessions.filter(s=>s.date>=from);
    if(to)sessions=sessions.filter(s=>s.date<=to);
    const trainerFil=document.getElementById('rpt_trainer_filter')?.value||'all';
    if(trainerFil!=='all')sessions=sessions.filter(s=>s.trainerId===trainerFil);
    if(!sessions.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>No trainer schedule data found for the selected filters.</p></div>`;return;}
    const totalSessions=sessions.length;
    const uniqueTrainers=trainerFil!=='all'?1:[...new Set(sessions.map(s=>s.trainerId))].length;
    const uniqueMembers=[...new Set(sessions.map(s=>s.memberId).filter(Boolean))].length;
    const statusCounts={Scheduled:0,Completed:0,Cancelled:0};
    sessions.forEach(s=>{if(statusCounts[s.status]!==undefined)statusCounts[s.status]++;});
    const rows=sessions.slice().sort((a,b)=>a.date<b.date?1:-1).map(s=>{
      const trainer=allUsers.find(u=>u.id===s.trainerId);
      const member=allMembers.find(m=>m.id===s.memberId);
      const trainerName=trainer?trainer.name:'—';
      const memberName=member?member.name:(s.memberName||'—');
      const statusCls={Scheduled:'badge-pending',Completed:'badge-active',Cancelled:'badge-locked'}[s.status]||'';
      const timeDisplay=s.time||(s.startTime?s.startTime+(s.endTime?' – '+s.endTime:''):'—');
      const createdByUser=s.createdBy?allUsers.find(u=>u.name===s.createdBy||u.username===s.createdByUsername):null;
      const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
      const roleColor=createdByUser?roleColorMap[createdByUser.role]||'var(--gray-300)':'var(--gray-300)';
      const roleTag=createdByUser?`<span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:${roleColor};margin-left:4px;text-transform:uppercase">${createdByUser.role}</span>`:'';
      const editedByUser=s.editedBy?allUsers.find(u=>u.name===s.editedBy||u.username===s.editedByUsername):null;
      const editedRoleColor=editedByUser?roleColorMap[editedByUser.role]||'var(--gray-300)':'var(--gray-300)';
      const editedRoleTag=editedByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${editedRoleColor};margin-left:4px;text-transform:uppercase">${editedByUser.role}</span>`:'';
      const createdByDisplay=s.createdBy?`<div style="font-size:12px;font-weight:600">${esc(s.createdBy)}${roleTag}</div>${s.editedBy?`<div style="font-size:11px;color:var(--gray-500);margin-top:2px">✎ ${esc(s.editedBy)}${editedRoleTag}</div>`:''}`:'<span style="color:var(--gray-500)">—</span>';
      return`<tr>
        <td>${formatDate(s.date)}</td>
        <td><strong>${esc(trainerName)}</strong></td>
        <td>${esc(timeDisplay)}</td>
        <td>${esc(s.type||s.sessionType||'—')}</td>
        <td>${esc(memberName)}</td>
        <td><span class="badge ${statusCls}">${esc(s.status)}</span></td>
        <td>${createdByDisplay}</td>
        <td>${esc(s.notes||'—')}</td>
      </tr>`;
    }).join('');
    const trainerFil2=document.getElementById('rpt_trainer_filter')?.value||'all';
    const singleTrainer=trainerFil2!=='all'?allUsers.find(u=>u.id===trainerFil2):null;
    output.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card orange"><div class="stat-label">Total Sessions</div><div class="stat-value">${totalSessions}</div>${singleTrainer?`<div class="stat-hint">${esc(singleTrainer.name)}</div>`:''}</div>
      <div class="stat-card green"><div class="stat-label">Completed</div><div class="stat-value">${statusCounts.Completed}</div></div>
      <div class="stat-card gold"><div class="stat-label">Scheduled</div><div class="stat-value">${statusCounts.Scheduled}</div></div>
      <div class="stat-card blue" style="border-left-color:#ef4444"><div class="stat-label">Cancelled</div><div class="stat-value">${statusCounts.Cancelled}</div></div>
      ${!singleTrainer?`<div class="stat-card blue"><div class="stat-label">Trainers</div><div class="stat-value">${uniqueTrainers}</div></div>`:`<div class="stat-card blue"><div class="stat-label">Members Handled</div><div class="stat-value">${uniqueMembers}</div></div>`}
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Trainer Schedule Records</h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printReport()">🖨️ Print</button><button class="btn-secondary btn-sm" onclick="exportCSV('trainer')">📥 Export CSV</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Trainer</th><th>Time</th><th>Session Type</th><th>Member</th><th>Status</th><th>Created / Edited By</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  } else if(reportType==='activity'){
    pruneMemberActivity();
    let log=(ActivityLog.all()||[]).filter(e=>!_isMemberActivity(e));
    const from2=document.getElementById('rpt_from')?.value||'';
    const to2=document.getElementById('rpt_to')?.value||today();
    if(from2)log=log.filter(e=>e.at>=from2+'T00:00:00.000Z'||e.at>=from2);
    if(to2)log=log.filter(e=>e.at<=to2+'T23:59:59.999Z'||e.at<=to2+'T23:59:59');
    const catF=document.getElementById('rpt_act_cat')?.value||'all';
    const actF=document.getElementById('rpt_act_action')?.value||'all';
    if(catF!=='all')log=log.filter(e=>e.category===catF);
    if(actF!=='all')log=log.filter(e=>e.action===actF);
    const actionColor={'Added':'#7ffa88','Edited':'#fbbf24','Deleted':'#ef4444','Status Changed':'#b3bcb5'};
    const actionBg={'Added':'rgba(127,250,136,.12)','Edited':'rgba(251,191,36,.12)','Deleted':'rgba(239,68,68,.12)','Status Changed':'rgba(96,165,250,.12)'};
    const catIcon={'Member':'👤','Session':'📅'};
    const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
    const totalAdded=log.filter(e=>e.action==='Added').length;
    const totalEdited=log.filter(e=>e.action==='Edited').length;
    const totalDeleted=log.filter(e=>e.action==='Deleted').length;
    const totalStatus=log.filter(e=>e.action==='Status Changed').length;
    if(!log.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">📝</div><p>No activity recorded yet. Actions like adding, editing, or deleting members and sessions will appear here.</p></div>`;return;}
    const rows=log.map(e=>{
      const clr=actionColor[e.action]||'var(--gray-300)';
      const bg=actionBg[e.action]||'rgba(255,255,255,.05)';
      const roleClr=roleColorMap[e.byRole]||'var(--gray-300)';
      const dt=new Date(e.at);
      const dateStr=dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      const timeStr=dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return`<tr>
        <td><span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:4px;background:${bg};color:${clr};letter-spacing:.5px;text-transform:uppercase;white-space:nowrap">${esc(e.action)}</span></td>
        <td><span style="font-size:12px;font-weight:700;color:var(--white)">${catIcon[e.category]||'•'} ${esc(e.category)}</span></td>
        <td style="font-size:12px;color:var(--white);font-weight:700;max-width:200px">${esc(e.detail||'—')}</td>
        <td style="font-size:12px;color:var(--white);font-weight:700;max-width:200px">${esc(e.extra||'—')}</td>
        <td><div style="font-size:12px;font-weight:700;color:var(--white)">${esc(e.by||'—')} <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.09);color:${roleClr};margin-left:3px;text-transform:uppercase">${esc(e.byRole||'')}</span></div></td>
        <td style="white-space:nowrap"><div style="font-size:12px;color:var(--white);font-weight:700">${dateStr}</div><div style="font-size:11px;color:var(--gray-300);margin-top:2px">🕐 ${timeStr}</div></td>
      </tr>`;}).join('');
    output.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-label">Added</div><div class="stat-value">${totalAdded}</div></div>
      <div class="stat-card gold"><div class="stat-label">Edited</div><div class="stat-value">${totalEdited}</div></div>
      <div class="stat-card orange" style="border-top-color:#ef4444"><div class="stat-label">Deleted</div><div class="stat-value">${totalDeleted}</div></div>
      <div class="stat-card blue"><div class="stat-label">Status Changed</div><div class="stat-value">${totalStatus}</div></div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Activity Log</h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printReport()">🖨️ Print</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Action</th><th>Category</th><th>Name / Detail</th><th>Info</th><th>Done By</th><th>Date & Time</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  } else {
    const allMembers=Members.all();
    const members=allMembers.filter(m=>m.status!=='Archived');
    const archivedMembers=allMembers.filter(m=>m.status==='Archived');
    const allPayments=Payments.all();
    let filtered=members;
    if(from)filtered=filtered.filter(m=>(m.createdAt||m.startDate)>=from);
    if(to)filtered=filtered.filter(m=>(m.createdAt||m.startDate)<=to);
    // Member search filter (includes archived)
    const memberIdFilter=document.getElementById('rpt_member_id')?.value||'all';
    let singleMemberMode=false;
    let singleMember=null;
    if(memberIdFilter!=='all'){
      const foundInAll=allMembers.find(m=>m.id===memberIdFilter);
      filtered=allMembers.filter(m=>m.id===memberIdFilter);
      singleMemberMode=true;
      singleMember=foundInAll||null;
    }
    if(!filtered.length){output.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>No data found for the selected filters. Try adjusting the date range.</p></div>`;return;}
    const active=filtered.filter(m=>m.status==='Active'||m.status==='Expiring Soon').length;
    const expired=filtered.filter(m=>m.status==='Expired').length;
    const archivedCount=filtered.filter(m=>m.status==='Archived').length;
    const allUsers=Users.all();
    const roleColorMap={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
    const rows=filtered.map(m=>{
      const pl=Plans.all().find(p=>p.id===m.planId);
      const badgeCls={Active:'badge-active',Expired:'badge-expired','Expiring Soon':'badge-expiring',Suspended:'badge-suspended',Archived:'badge-archived'}[m.status]||'';
      const payCount=allPayments.filter(p=>p.memberId===m.id).length;
      // Created By
      const createdByUser=m.createdBy?allUsers.find(u=>u.name===m.createdBy||u.username===m.createdByUsername):null;
      const cRoleColor=createdByUser?roleColorMap[createdByUser.role]||'var(--gray-300)':'var(--gray-300)';
      const cRoleTag=createdByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${cRoleColor};margin-left:4px;text-transform:uppercase">${createdByUser.role}</span>`:'';
      const createdLine=m.createdBy?`<div style="font-size:12px;font-weight:600">${esc(m.createdBy)}${cRoleTag}</div>`:`<span style="color:var(--gray-500)">—</span>`;
      // Edited By
      const editedByUser=m.editedBy?allUsers.find(u=>u.name===m.editedBy||u.username===m.editedByUsername):null;
      const eRoleColor=editedByUser?roleColorMap[editedByUser.role]||'var(--gray-300)':'var(--gray-300)';
      const eRoleTag=editedByUser?`<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);color:${eRoleColor};margin-left:4px;text-transform:uppercase">${editedByUser.role}</span>`:'';
      const editedLine=m.editedBy?`<div style="font-size:11px;color:var(--gray-500);margin-top:2px">✎ ${esc(m.editedBy)}${eRoleTag}</div>`:'';
      const isArchived=m.status==='Archived';const rowStyle=isArchived?'opacity:0.6;background:rgba(239,68,68,.03);':'';
      return`<tr style="${rowStyle}"><td style="${isArchived?'text-decoration:line-through;color:var(--gray-500)':''}">${esc(m.id)}</td><td><div style="display:flex;align-items:center;gap:6px">${isArchived?'🗑️':''}<span style="${isArchived?'text-decoration:line-through;color:var(--gray-500)':''}">${esc(m.name)}</span></div></td><td>${esc(pl?pl.name:'—')}</td><td>${formatDate(m.startDate)}</td><td>${formatDate(m.expiryDate)}</td><td><span class="badge ${badgeCls}">${esc(isArchived?'Deleted':m.status)}</span></td><td style="text-align:center"><span style="background:rgba(179,188,181,.12);color:var(--orange);font-size:13px;font-weight:800;padding:3px 10px;border-radius:6px;border:1px solid rgba(179,188,181,.25)">${payCount}x</span></td><td><div>${createdLine}${editedLine}</div></td></tr>`;
    }).join('');
    // If single member, show their payment history too
    let payHistorySection='';
    if(singleMemberMode&&singleMember){
      const memberPayments=allPayments.filter(p=>p.memberId===singleMember.id).slice().reverse();
      const totalPaid=memberPayments.reduce((a,p)=>a+Number(p.amount),0);
      const payRows=memberPayments.length?memberPayments.map(p=>`<tr><td>${esc(p.id)}</td><td>${esc(p.planName)}</td><td style="color:var(--green);font-weight:700">₱${Number(p.amount).toLocaleString()}</td><td>${formatDate(p.date)}</td><td>${formatDate(p.newExpiry)}</td><td>${esc(p.method||'—')}</td><td>${esc(p.recordedBy||'—')}</td></tr>`).join(''):`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💳</div><p>No payments found</p></div></td></tr>`;
      payHistorySection=`
      <div class="table-card" style="margin-top:16px">
        <div class="table-header"><h3>💳 Payment History — ${esc(singleMember.name)}</h3><span style="font-size:12px;color:var(--gray-500);font-weight:400">${memberPayments.length} payment${memberPayments.length!==1?'s':''} · Total: <span style="color:var(--green);font-weight:700">₱${totalPaid.toLocaleString()}</span></span></div>
        <div style="overflow-x:auto"><table><thead><tr><th>Pay ID</th><th>Plan</th><th>Amount</th><th>Date</th><th>New Expiry</th><th>Method</th><th>Recorded By</th></tr></thead><tbody>${payRows}</tbody></table></div>
      </div>`;
    }
    output.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card orange"><div class="stat-label">Total Members</div><div class="stat-value">${filtered.length}</div></div>
      <div class="stat-card green"><div class="stat-label">Active</div><div class="stat-value">${active}</div></div>
      <div class="stat-card gold"><div class="stat-label">Expired</div><div class="stat-value">${expired}</div></div>
      ${archivedCount>0?`<div class="stat-card" style="border-top-color:#fca5a5"><div class="stat-label" style="color:#fca5a5">🗑️ Deleted</div><div class="stat-value" style="color:#fca5a5">${archivedCount}</div><div class="stat-hint">removed members</div></div>`:''}
      ${singleMemberMode&&singleMember?`<div class="stat-card blue"><div class="stat-label">Total Payments</div><div class="stat-value">${allPayments.filter(p=>p.memberId===singleMember.id).length}x</div><div class="stat-hint">membership renewals</div></div>`:''}
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Membership Report <span style="font-size:11px;font-weight:400;color:var(--gray-500);margin-left:6px">including deleted members</span></h3><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" onclick="printReport()">🖨️ Print</button><button class="btn-secondary btn-sm" onclick="exportCSV('membership')">📥 Export CSV</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Name</th><th>Plan</th><th>Start</th><th>Expiry</th><th>Status</th><th>Times Paid</th><th>Created / Edited By</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>${payHistorySection}`;
  }
}
function filterTrainerReportList(val){
  const drop=document.getElementById('rpt_trainer_drop');
  if(!drop)return;
  const all=Users.all().filter(u=>u.role==='trainer');
  const filtered=val?all.filter(u=>u.name.toLowerCase().includes(val.toLowerCase())):all;
  drop.style.display=filtered.length?'block':'none';
  drop.innerHTML=filtered.map(u=>`<div class="country-item" onclick="selectTrainerReport('${u.id}','${esc(u.name).replace(/'/g,"&#39;")}')"><span>${esc(u.name)}</span></div>`).join('');
  if(!val){document.getElementById('rpt_trainer_filter').value='all';}
}
function selectTrainerReport(id,name){
  const inp=document.getElementById('rpt_trainer_search');
  const hid=document.getElementById('rpt_trainer_filter');
  const drop=document.getElementById('rpt_trainer_drop');
  if(inp)inp.value=name;
  if(hid)hid.value=id;
  if(drop)drop.style.display='none';
}

function filterMemberReportList(val){
  const drop=document.getElementById('rpt_member_drop');
  if(!drop)return;
  const all=Members.all();
  const filtered=val?all.filter(m=>m.name.toLowerCase().includes(val.toLowerCase())):all;
  if(!filtered.length){drop.style.display='none';return;}
  const active=filtered.filter(m=>m.status!=='Archived');
  const deleted=filtered.filter(m=>m.status==='Archived');
  let html='';
  if(active.length){
    html+=`<div style="padding:6px 12px 4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--green);background:rgba(127,250,136,.05);border-bottom:1px solid rgba(127,250,136,.12)">✓ Active Members</div>`;
html+=active.map(m=>`<div class="country-item" style="padding:9px 14px" onclick="selectMemberReport('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}')"><span style="font-weight:600">${esc(m.name)}</span></div>`).join('');
  }
  if(deleted.length){
    html+=`<div style="padding:6px 12px 4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#fca5a5;background:rgba(239,68,68,.05);border-top:1px solid rgba(239,68,68,.15);border-bottom:1px solid rgba(239,68,68,.1)">⚠ Deleted Members</div>`;
html+=deleted.map(m=>`<div class="country-item" style="padding:9px 14px;opacity:.75" onclick="selectMemberReport('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}')"><span style="font-weight:600;color:var(--gray-300)">${esc(m.name)}</span><span style="margin-left:8px;font-size:9px;font-weight:800;color:#fca5a5;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.25);border-radius:4px;padding:1px 6px">DELETED</span></div>`).join('');
  }
  drop.innerHTML=html;
  drop.style.display='block';
  if(!val){document.getElementById('rpt_member_id').value='all';}
}
function selectMemberReport(id,name){
  const inp=document.getElementById('rpt_member_search');
  const hid=document.getElementById('rpt_member_id');
  const drop=document.getElementById('rpt_member_drop');
  if(inp)inp.value=name;
  if(hid)hid.value=id;
  if(drop)drop.style.display='none';
}
document.addEventListener('click',function(e){
  if(!e.target.closest('#rpt_member_search')&&!e.target.closest('#rpt_member_drop')){
    const drop=document.getElementById('rpt_member_drop');
    if(drop)drop.style.display='none';
  }
  if(!e.target.closest('#rpt_trainer_search')&&!e.target.closest('#rpt_trainer_drop')){
    const drop=document.getElementById('rpt_trainer_drop');
    if(drop)drop.style.display='none';
  }
});
function printReport(){
  const output=document.getElementById('reportOutput');
  if(!output||!output.innerHTML.trim()){toast('Generate a report first.','error');return;}
  // Hidden iframe (same reliable approach as receipt printing) — pop-up
  // blockers and mobile browsers often block or blank window.open().
  const old=document.getElementById('reportPrintFrame');
  if(old&&old.parentNode)old.parentNode.removeChild(old);
  const frame=document.createElement('iframe');
  frame.id='reportPrintFrame';
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
  document.body.appendChild(frame);
  const doc=frame.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>FitCore GMS — Report</title>
  <style>
  :root{--orange:#7ffa88;--orange-dark:#4ade80;--gold:#fbbf24;--green:#4ade80;--gray-300:#b3bcb5;--gray-500:#5e625f;--navy-900:#0a0a0a;--cyan:#b3bcb5}
  *{box-sizing:border-box}
  @page{margin:12mm}
  body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#0a0a0a;padding:0;margin:0;font-size:12.5px;background:#fff}
  .page{max-width:920px;margin:0 auto;padding:28px 32px}
  .print-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:3px solid #7ffa88;margin-bottom:18px}
  .ph-brand{display:flex;align-items:center;gap:10px}
  .ph-logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#7ffa88,#4ade80);color:#fff;font-family:Impact,'Arial Black',sans-serif;font-size:21px;font-weight:900;display:flex;align-items:center;justify-content:center}
  .ph-name{font-family:Impact,'Arial Black',sans-serif;font-size:17px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;line-height:1.1}
  .ph-name em{font-style:normal;color:#7ffa88}
  .ph-tag{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#5e625f;margin-top:2px}
  .ph-meta{text-align:right;font-size:10.5px;color:#5e625f;line-height:1.6}
  .ph-meta strong{color:#0a0a0a}
  .stats-grid{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .stat-card{border:1px solid #e6ebf4;border-radius:12px;padding:12px 16px;min-width:130px;border-top:3px solid #7ffa88}
  .stat-card.green{border-top-color:#4ade80}
  .stat-card.gold{border-top-color:#fbbf24}
  .stat-card.blue{border-top-color:#0ea5e9}
  .stat-label{font-size:9px;font-weight:800;text-transform:uppercase;color:#5e625f;margin-bottom:4px;letter-spacing:1px}
  .stat-value{font-size:23px;font-weight:900;color:#0a0a0a;font-family:Impact,'Arial Black',sans-serif}
  .stat-hint{font-size:10px;color:#5e625f;margin-top:3px}
  .chart-card{border:1px solid #e6ebf4;border-radius:12px;padding:14px 16px;margin-bottom:16px}
  .chart-title{font-size:9px;font-weight:800;text-transform:uppercase;color:#5e625f;margin-bottom:10px;letter-spacing:1.5px}
  .chart-card svg{width:100%}
  .table-card{border:1px solid #e6ebf4;border-radius:12px;overflow:hidden;margin-bottom:14px}
  .table-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#f6f8fc;border-bottom:1px solid #e6ebf4}
  .table-header h3{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#0a0a0a;margin:0}
  .table-header .btn-secondary,.table-header button{display:none}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  thead th{background:#0a0a0a;color:#fff;padding:8px 10px;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.5px}
  tbody td{padding:7px 10px;border-bottom:1px solid #eef1f6;vertical-align:middle}
  tbody tr:nth-child(even){background:#fafbfd}
  .badge{display:inline-block;padding:2px 8px;border-radius:100px;font-size:9.5px;font-weight:800;text-transform:uppercase}
  .badge-active,.badge-paid{background:#dcfce7;color:#166534}
  .badge-expired,.badge-locked{background:#fee2e2;color:#991b1b}
  .badge-pending{background:#fef3c7;color:#92400e}
  .badge-expiring{background:#fde68a;color:#92400e}
  .badge-suspended{background:#fecaca;color:#991b1b}
  .badge-archived{background:#e2e8f0;color:#475569}
  .report-doc-head{display:none}
  .empty-state{text-align:center;padding:36px 16px;color:#5e625f;font-size:12px}
  .print-foot{margin-top:18px;padding-top:12px;border-top:1px solid #e6ebf4;display:flex;justify-content:space-between;gap:12px;font-size:10px;color:#5e625f}
  .print-foot strong{color:#0a0a0a}
  @media print{button{display:none}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}tbody tr:nth-child(even){-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><div class="page">
  <div class="print-header">
    <div class="ph-brand">
      <div class="ph-logo">F</div>
      <div><div class="ph-name">FITCORE <em>GMS</em></div><div class="ph-tag">Gym Management System</div></div>
    </div>
    <div class="ph-meta"><strong>Generated</strong>: ${new Date().toLocaleString()}<br><strong>By</strong>: ${esc(currentUser.name)} (${esc(currentUser.role)})</div>
  </div>
  ${output.innerHTML}
  <div class="print-foot">
    <div><strong>FitCore GMS</strong> &mdash; Gym Management System</div>
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
  </div></body></html>`);
  doc.close();
  const printNow=function(){
    try{
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }catch(e){toast('Print failed. Please try again.','error');}
    setTimeout(function(){if(frame.parentNode)frame.parentNode.removeChild(frame);},60000);
  };
  if(doc.readyState==='complete')setTimeout(printNow,250);
  else frame.onload=function(){setTimeout(printNow,250);};
}
// Neutralize spreadsheet formula injection: cells starting with = + - @ (or tab/CR) get a
// leading apostrophe so Excel/Sheets treat them as text, not formulas.
function csvCell(v){
  const s=String(v==null?'':v);
  const guarded=/^[=+\-@\t\r]/.test(s)?'\''+s:s;
  return '"'+guarded.replace(/"/g,'""')+'"';
}
function exportCSV(type){
  let csv='';let filename='';
  if(type==='revenue'){
    const data=Payments.all();
    const walkins=Walkins.all();
    csv='ID,Name,Plan/Type,Amount,Date,Method,Category\n'
      +data.map(p=>`${csvCell(p.id)},${csvCell(p.memberName)},${csvCell(p.planName)},${p.amount},${p.date},${csvCell(p.method)},Membership`).join('\n')
      +'\n'+walkins.map(w=>`${csvCell(w.id)},${csvCell(w.visitorName)},Walk-In,${w.fee},${w.date},Cash,Walk-In`).join('\n');
    filename='revenue_report.csv';
  } else if(type==='attendance'){
    const data=Attendance.all();
    csv='Date,Check-In,Check-Out,Duration,Member ID,Recorded By\n'+data.map(a=>`${a.date},${csvCell(a.checkIn||a.time||'')},${csvCell(a.checkOut||'')},${csvCell(a.duration||'')},${csvCell(a.memberId)},${csvCell(a.recordedBy||'')}`).join('\n');
    filename='attendance_report.csv';
  } else if(type==='trainer'){
    const sessions=Sessions.all();
    const users=Users.all();
    const members=Members.all();
    csv='Date,Trainer,Time,Session Type,Member,Status,Created By,Edited By,Notes\n'+sessions.map(s=>{
      const trainer=users.find(u=>u.id===s.trainerId);
      const member=members.find(m=>m.id===s.memberId);
      const time=s.time||(s.startTime?s.startTime+(s.endTime?' - '+s.endTime:''):'');
      return `${s.date},${csvCell(trainer?trainer.name:'')},${csvCell(time)},${csvCell(s.type||s.sessionType||'')},${csvCell(member?member.name:(s.memberName||''))},${csvCell(s.status)},${csvCell(s.createdBy||'')},${csvCell(s.editedBy||'')},${csvCell(s.notes||'')}`;
    }).join('\n');
    filename='trainer_schedule_report.csv';
  } else {
    const data=Members.all().filter(m=>m.status!=='Archived');
    csv='ID,Name,Plan ID,Start Date,Expiry Date,Status,Created By,Edited By\n'+data.map(m=>`${csvCell(m.id)},${csvCell(m.name)},${csvCell(m.planId||'')},${m.startDate},${m.expiryDate},${csvCell(m.status)},${csvCell(m.createdBy||'')},${csvCell(m.editedBy||'')}`).join('\n');
    filename='membership_report.csv';
  }
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  toast('CSV exported successfully.');
}

// ======================================================================
// PANEL: USER MANAGEMENT
// ======================================================================
let userSearch='';
let userRoleTab='staff';
function renderUsers(){
  const el=document.getElementById('panelUsers');
  const counts={admin:0,staff:0,trainer:0};
  Users.all().forEach(u=>{if(counts[u.role]!==undefined)counts[u.role]++;});
  const tab=(role,label)=>`<button class="rtab ${userRoleTab===role?'active':''}" onclick="userRoleTab='${role}';renderUsers()">${label} <span class="user-tab-count">(${counts[role]})</span></button>`;
  const searchPh={admin:'Admins',staff:'Staff',trainer:'Trainers'}[userRoleTab]||'users';
  el.innerHTML=`
  <div class="report-tabs">
    ${tab('admin','Admins')}
    ${tab('staff','Staff')}
    ${tab('trainer','Trainers')}
  </div>
  <div class="page-actions">
    <input class="search-input" placeholder="Search ${searchPh}…" value="${esc(userSearch)}" oninput="userSearch=this.value;refreshUserTable()">
    <button class="btn-primary" onclick="openUserModal()">+ Add User</button>
  </div>
  <div class="table-card" id="userTableCard"></div>`;
  refreshUserTable();
  updatePendingBadge();
}
function refreshUserTable(){
  const label={admin:'Admins',staff:'Staff',trainer:'Trainers'}[userRoleTab]||'Users';
  const singular={admin:'admin',staff:'staff',trainer:'trainer'}[userRoleTab]||'user';
  let data=Users.all().filter(u=>u.role===userRoleTab);
  if(userSearch){const s=userSearch.toLowerCase();data=data.filter(u=>(u.name||'').toLowerCase().includes(s)||(u.username||'').toLowerCase().includes(s)||String(u.authEmail||u.email||'').toLowerCase().includes(s));}
  const rows=data.length?data.map(u=>{
    const roleCls={admin:'badge-admin',staff:'badge-staff',trainer:'badge-trainer'}[u.role]||'';
    const statusCls=u.status==='locked'?'badge-locked':u.status==='pending'?'badge-pending':'badge-active';
    const statusLabel=u.status==='locked'?'Locked':u.status==='pending'?'Pending':'Active';
    const _uSpecs=trainerSpecList(u);
    const trainerExtra=u.role==='trainer'&&_uSpecs.length?`<div style="font-size:10px;color:var(--orange);margin-top:2px">🏋️ ${_uSpecs.slice(0,2).map(esc).join(', ')+(_uSpecs.length>2?' +more':'')}</div>`:'';
    const trainerHours=u.role==='trainer'&&u.availableFrom?`<div style="font-size:10px;color:var(--gray-500);margin-top:1px">⏰ ${esc(u.availableFrom)}–${esc(u.availableTo||'')}</div>`:'';
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="user-avatar avatar-${u.role}" style="width:28px;height:28px;font-size:10px;${u.avatar?'padding:0;overflow:hidden':''}">${u.avatar?`<img src="${u.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:esc(initials(u.name))}</div><div><div>${esc(u.name)}${u.coachName&&u.coachName!==u.name?` <span style="font-size:10px;color:var(--gray-500)">(${esc(u.coachName)})</span>`:''}</div><div style="font-size:11px;color:var(--gray-500);font-family:monospace;margin-top:2px">${esc(u.contact||'—')}</div>${trainerExtra}${trainerHours}</div></div></td>
      <td>${esc(u.username)}</td>
      <td style="font-size:11px">${esc(u.authEmail||u.email||'—')}</td>
      <td><span class="badge ${roleCls}">${esc(u.role)}</span></td>
      <td>${formatDate(u.createdAt||today())}</td>
      <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      <td><div class="td-actions">
        <button class="btn-icon" title="View" onclick="viewUser('${u.id}')">👤</button>
        <button class="btn-icon" title="Edit" onclick="openUserModal('${u.id}')">✎</button>
        ${u.status==='pending'?`<button class="btn-icon" title="Approve" style="color:var(--green)" onclick="approveUser('${u.id}')">✔</button>`:`<button class="btn-icon" title="${u.status==='locked'?'Unlock':'Lock'}" onclick="toggleUserLock('${u.id}')">${u.status==='locked'?'○':'●'}</button>`}
        ${u.id===currentUser.id?`<button class="btn-icon" title="Cannot delete your own account" style="opacity:.3;cursor:not-allowed;color:var(--gray-500);border-color:rgba(255,255,255,.08)" disabled>✕</button>`:`<button class="btn-icon" title="Delete User" style="color:var(--red);border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)" onmouseover="this.style.background='var(--red)';this.style.color='#fff'" onmouseout="this.style.background='rgba(239,68,68,.08)';this.style.color='var(--red)'" onclick="deleteUser('${u.id}')">✕</button>`}
      </div></td>
    </tr>`;}).join(''):`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">—</div><p>No ${singular} found</p></div></td></tr>`;
  document.getElementById('userTableCard').innerHTML=`
    <div class="table-header"><h3>${label}</h3></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Username</th><th>Email / Gmail</th><th>Role</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
let editingUserId=null;
function toggleTrainerFields(){
  const v=document.getElementById('uf_role').value;
  const tf=document.getElementById('uf_trainerFields');
  if(tf)tf.style.display=v==='trainer'?'block':'none';
  if(v==='trainer')updateUfSpecChips();
}
// Render selected specializations as removable chips in the Add/Edit User modal
function updateUfSpecChips(){
  const container=document.getElementById('ufSpecChips');
  if(!container)return;
  const checked=document.querySelectorAll('#ufSpecGrid input[type=checkbox]:checked');
  if(!checked.length){container.innerHTML='';return;}
  container.innerHTML=Array.from(checked).map(cb=>{
    return `<span class="uf-chip" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer" onclick="this.closest('.form-group').querySelectorAll('input[value=\"'+cb.value+'\"]')[0].checked=false;updateUfSpecChips()">${esc(cb.value)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
  }).join('');
}
// Live duplicate check for the Add/Edit User email field. This is only a
// convenience guard; saveUser() re-checks and Firebase Auth rejects the real
// duplicate at account-creation time.
function checkUfEmail(val){
  const errEl=document.getElementById('uf_email_error');
  const email=String(val||'').trim().toLowerCase();
  if(!errEl)return true;
  if(!email){errEl.style.display='none';return true;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){errEl.textContent='Please enter a valid email address.';errEl.style.display='block';return false;}
  if(email.endsWith('@fitcoregym.local')){errEl.textContent='Please use a real email address (e.g. name@gmail.com).';errEl.style.display='block';return false;}
  const dupUser=Users.all().find(u=>u.id!==editingUserId&&(String(u.authEmail||'').toLowerCase()===email||String(u.email||'').toLowerCase()===email));
  if(dupUser){errEl.textContent='Email already exists — used by '+dupUser.name+'.';errEl.style.display='block';return false;}
  const dupMember=Members.all().find(m=>String(m.email||'').toLowerCase()===email||String(m.authEmail||'').toLowerCase()===email);
  if(dupMember){errEl.textContent='Email already exists — used by member '+dupMember.name+' ('+dupMember.id+').';errEl.style.display='block';return false;}
  errEl.style.display='none';
  return true;
}
// Wire spec checkbox change events (once on load)
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('#ufSpecGrid input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change',updateUfSpecChips);
  });
});
function openUserModal(id=null){
  editingUserId=id;
  document.getElementById('userModalTitle').textContent=id?'Edit User':'Add User';
  document.getElementById('userFormError').style.display='none';
  const ufEmailErr=document.getElementById('uf_email_error');
  if(ufEmailErr)ufEmailErr.style.display='none';
  if(id){
    const u=Users.one(id);if(!u)return;
    document.getElementById('uf_name').value=u.name;document.getElementById('uf_contact').value=u.contact||'';document.getElementById('uf_user').value=u.username;
    const emailEl=document.getElementById('uf_email');
    if(emailEl){
      const realEmail=u.authEmail&&!String(u.authEmail).endsWith('@fitcoregym.local')?u.authEmail:(u.email&&!String(u.email).endsWith('@fitcoregym.local')?u.email:'');
      emailEl.value=realEmail||'';
      emailEl.disabled=u.role==='admin';
      emailEl.placeholder=u.role==='admin'?'Admin identity is managed in Firebase Console':'e.g. trainer@gmail.com';
    }
    document.getElementById('uf_pass').value='';document.getElementById('uf_pass2').value='';
    document.getElementById('uf_pass').placeholder='Leave blank to keep current password';
    document.getElementById('uf_role').value=u.role;
    // Hide role field for admin users — role cannot be changed
    const roleRow=document.getElementById('uf_role_row');
    if(roleRow)roleRow.style.display=u.role==='admin'?'none':'block';
    // Trainer fields
    toggleTrainerFields();
    if(u.role==='trainer'){
      document.getElementById('uf_coachName').value=u.coachName||'';
      document.getElementById('uf_bio').value=u.bio||'';
      // Check specialization boxes (legacy values may be comma-separated)
      const _editSpecs=trainerSpecList(u);
      document.querySelectorAll('#ufSpecGrid input[type=checkbox]').forEach(cb=>{cb.checked=_editSpecs.includes(cb.value);});
      // Check availability day boxes
      document.querySelectorAll('#ufAvailDays input[type=checkbox]').forEach(cb=>{cb.checked=(u.availableDays||[]).includes(cb.value);});
      // Set hours
      document.getElementById('ufAvailFrom').value=u.availableFrom||'';
      document.getElementById('ufAvailTo').value=u.availableTo||'';
      // Avatar (single preview)
      document.getElementById('uf_avatar').value=u.avatar||'';
      updateUfAvatar(u.name||u.coachName||'');
      updateUfSpecChips();
    } else {
      document.getElementById('uf_coachName').value='';document.getElementById('uf_bio').value='';
      document.querySelectorAll('#ufSpecGrid input[type=checkbox],#ufAvailDays input[type=checkbox]').forEach(cb=>{cb.checked=false;});
      document.getElementById('ufAvailFrom').value='';document.getElementById('ufAvailTo').value='';
      // Clear avatar (single preview)
      document.getElementById('uf_avatar').value='';
      updateUfAvatar('');
      updateUfSpecChips();
    }
  } else {
    ['uf_name','uf_contact','uf_user','uf_pass','uf_pass2','uf_email'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('uf_pass').placeholder='Minimum 8 characters';
    const newEmailEl=document.getElementById('uf_email');
    if(newEmailEl){newEmailEl.disabled=false;newEmailEl.placeholder='e.g. trainer@gmail.com';}
    document.getElementById('uf_role').value=userRoleTab;
    const roleRow=document.getElementById('uf_role_row');
    if(roleRow)roleRow.style.display='block';
    // Clear trainer fields
    toggleTrainerFields();
    document.getElementById('uf_coachName').value='';document.getElementById('uf_bio').value='';
    document.querySelectorAll('#ufSpecGrid input[type=checkbox],#ufAvailDays input[type=checkbox]').forEach(cb=>{cb.checked=false;});
    document.getElementById('ufAvailFrom').value='';document.getElementById('ufAvailTo').value='';
    // Clear avatar
    document.getElementById('uf_avatar').value='';
    document.getElementById('uf_avatar_preview').src='';document.getElementById('uf_avatar_preview').style.display='none';
    document.getElementById('uf_avatar_initials').style.backgroundImage='';document.getElementById('uf_avatar_initials').textContent='';
    document.getElementById('uf_avatar_clear').style.display='none';
    updateUfSpecChips();
  }
  openModal('userModal');
}
async function saveUser(){
  const name=document.getElementById('uf_name').value.trim();
  const contact=document.getElementById('uf_contact').value.trim();
  const username=document.getElementById('uf_user').value.trim();
  const emailEl=document.getElementById('uf_email');
  const email=(emailEl?emailEl.value.trim().toLowerCase():'');
  const pass=document.getElementById('uf_pass').value;
  const pass2=document.getElementById('uf_pass2').value;
  const existingUser=editingUserId?Users.one(editingUserId):null;
  let role=document.getElementById('uf_role').value;
  if(existingUser&&existingUser.role==='admin')role='admin';
  const err=document.getElementById('userFormError');
  err.style.display='none';
  if(!name||!username||(!editingUserId&&!pass)||!role){err.textContent='Please fill in all required fields.';err.style.display='block';return;}
  if(!editingUserId&&!email){err.textContent='Email / Gmail is required so the user can log in and reset their password.';err.style.display='block';return;}
  if(email){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent='Please enter a valid email address.';err.style.display='block';return;}
    if(email.endsWith('@fitcoregym.local')&&role!=='admin'){err.textContent='Please use a real email address (e.g. name@gmail.com), not a staff-managed email.';err.style.display='block';return;}
  }
  if(contact&&!/^09\d{9}$/.test(contact)){err.textContent='Please enter a valid 11-digit contact number (e.g. 09171234567).';err.style.display='block';return;}
  if(pass&&pass.length<8){err.textContent='Password must be at least 8 characters.';err.style.display='block';return;}
  if(pass&&pass!==pass2){err.textContent='Passwords do not match. Please re-enter your password correctly.';err.style.display='block';return;}
  // Trainer validation
  let coachName='',specializations=[],availableDays=[],availableFrom='',availableTo='',bio='';
  if(role==='trainer'){
    coachName=sanitizeText(document.getElementById('uf_coachName').value.trim());
    bio=sanitizeText(document.getElementById('uf_bio').value.trim());
    document.querySelectorAll('#ufSpecGrid input[type=checkbox]').forEach(cb=>{if(cb.checked)specializations.push(cb.value);});
    document.querySelectorAll('#ufAvailDays input[type=checkbox]').forEach(cb=>{if(cb.checked)availableDays.push(cb.value);});
    availableFrom=document.getElementById('ufAvailFrom').value;
    availableTo=document.getElementById('ufAvailTo').value;
    if(!specializations.length){err.textContent='Please select at least one specialization.';err.style.display='block';return;}
    if(!availableDays.length){err.textContent='Please select at least one available day.';err.style.display='block';return;}
    if(!availableFrom||!availableTo){err.textContent='Please select working hours (Start and End).';err.style.display='block';return;}
    if(availableFrom===availableTo){err.textContent='Start and End time cannot be the same.';err.style.display='block';return;}
  }
  const users=Users.all();
  const dup=users.find(u=>u.username===username&&u.id!==editingUserId);
  if(dup){err.textContent='Username already taken. Please choose a different username.';err.style.display='block';return;}
  // One Auth identity per Gmail across users and members.
  if(email){
    const dupUser=users.find(u=>u.id!==editingUserId&&(String(u.authEmail||'').toLowerCase()===email||String(u.email||'').toLowerCase()===email));
    if(dupUser){err.textContent='Email already exists — used by '+dupUser.name+'.';err.style.display='block';return;}
    const dupMember=Members.all().find(m=>String(m.email||'').toLowerCase()===email||String(m.authEmail||'').toLowerCase()===email);
    if(dupMember){err.textContent='Email already exists — used by member '+dupMember.name+' ('+dupMember.id+').';err.style.display='block';return;}
  }
  const oldAuthEmail=String((existingUser&&existingUser.authEmail)||'').toLowerCase();
  let authEmail=oldAuthEmail;
  let authChanged=false;
  let resetSent=false, resetMsg='';
  if(!existingUser){
    // New account: the Gmail is the Firebase Auth identity so Forgot Password
    // sends a real reset link. No synthetic .local address.
    authEmail=email;
    if(!(window.GMSFB&&GMSFB.enabled)){err.textContent='User accounts require an internet connection. Please connect and try again.';err.style.display='block';return;}
    const r=await GMSFB.createUserCreds(authEmail,pass,contact);
    if(!r.ok){
      if(r.code==='auth/email-already-in-use'){
        // Recover a half-finished earlier add: verify the password and attach
        // the profile instead of silently failing (the old "trainer missing
        // from Users" bug).
        const si=await GMSFB.secSignIn(authEmail,pass);
        if(!si.ok){err.textContent='Email already exists with a different password. Use Forgot Password or another Gmail.';err.style.display='block';return;}
      } else {err.textContent=r.error;err.style.display='block';return;}
    }
    GMSFB.secondarySignOut();
  } else if(role==='admin'){
    // Never move the built-in admin identity from this form.
    if(!authEmail)authEmail=GMSFB.adminAuthEmail;
    if(pass)resetMsg='Admin password changes must be done in Firebase Console → Authentication.';
  } else if(email&&email!==oldAuthEmail){
    // Move a legacy synthetic account to a real Gmail identity.
    if(!pass){err.textContent='Enter a password to set up the new Gmail login for this user.';err.style.display='block';return;}
    if(!(window.GMSFB&&GMSFB.enabled)){err.textContent='Changing the login email needs an internet connection.';err.style.display='block';return;}
    const r=await GMSFB.createUserCreds(email,pass,contact);
    if(!r.ok){
      if(r.code==='auth/email-already-in-use'){
        const si=await GMSFB.secSignIn(email,pass);
        if(!si.ok){err.textContent='Email already exists. Ask the user to use Forgot Password, or enter their existing password here.';err.style.display='block';return;}
      } else {err.textContent=r.error;err.style.display='block';return;}
    }
    GMSFB.secondarySignOut();
    authEmail=email;
    authChanged=true;
  } else if(pass){
    // Same identity: send a secure Firebase reset link instead of storing a hash.
    if(authEmail&&!authEmail.endsWith('@fitcoregym.local')&&window.GMSFB&&GMSFB.enabled&&GMSFB.auth){
      try{ await GMSFB.auth.sendPasswordResetEmail(authEmail); resetSent=true; }
      catch(e){ resetMsg='Could not send reset email: '+((e&&e.message)||'unknown error'); }
    } else {
      resetMsg='No real Gmail on file. Enter a Gmail above plus a password to enable Forgot Password.';
    }
  }
  if(authEmail)authEmail=authEmail.toLowerCase();
  const doc={name,contact,username,role,status:'active',createdAt:today(),authEmail,email:email||authEmail};
  // Profile photo (avatar) — optional for trainers
  let avatar='';
  if(role==='trainer'){
    avatar=document.getElementById('uf_avatar').value||'';
    doc.coachName=coachName;doc.specializations=specializations;doc.availableDays=availableDays;doc.availableFrom=availableFrom;doc.availableTo=availableTo;doc.bio=bio;
    if(avatar)doc.avatar=avatar;
  }
  if(editingUserId){
    const idx=users.findIndex(u=>u.id===editingUserId);
    if(idx>-1){
      Object.assign(users[idx],{name,contact,username,role,authEmail,email:email||authEmail});
      if(authChanged||pass){
        delete users[idx].passwordHash;
        delete users[idx].passwordResetAt;
        delete users[idx].password;
      }
      if(role==='trainer'){Object.assign(users[idx],{coachName,specializations,availableDays,availableFrom,availableTo,bio,avatar});}
      else if(existingUser&&existingUser.role==='trainer'){delete users[idx].coachName;delete users[idx].specializations;delete users[idx].availableDays;delete users[idx].availableFrom;delete users[idx].availableTo;delete users[idx].bio;delete users[idx].avatar;}
    }
    Users.save(users);
    if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
      try{ await GMSFB.pushCollection(KEY.users,Users.all()); }catch(e){ console.warn('[saveUser] sync',e); }
    }
    if(pass&&!resetSent&&!authChanged) toast('User updated. '+resetMsg,'info');
    else toast(resetSent?'User updated. Password reset link sent.':'User updated.','success');
  } else {
    users.push({id:uid(),...doc});
    Users.save(users);
    if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
      try{ await GMSFB.pushCollection(KEY.users,Users.all()); }catch(e){ console.warn('[saveUser] sync',e); }
    }
    toast(role==='trainer'?'Trainer account created — login with the Gmail above.':'User created.','success');
  }
  userRoleTab=role;
  closeModal('userModal');renderUsers();updatePendingBadge();
}
async function toggleUserLock(id){
  if(id===currentUser.id){toast('You cannot lock your own account.','error');return;}
  const users=Users.all();const idx=users.findIndex(u=>u.id===id);
  if(idx<0)return;
  users[idx].status=users[idx].status==='locked'?'active':'locked';
  Users.save(users);
  // ensure cloud sync completes so other devices see the lock immediately
  if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
    try{ await GMSFB.pushCollection(KEY.users, users); }catch(e){}
  }
  toast(`User ${users[idx].status==='locked'?'locked':'unlocked'}. Member can no longer log in until unlocked.`,'info');renderUsers();updatePendingBadge();
}
async function approveUser(id){
  const users=Users.all();const idx=users.findIndex(u=>u.id===id);
  if(idx<0)return;
  users[idx].status='active';
  Users.save(users);
  // Crucial: wait for Firestore so staff/trainer can log in on ANY device right after approval (cross-device fix)
  if(window.GMSFB&&GMSFB.enabled&&typeof GMSFB.pushCollection==='function'){
    try{ await GMSFB.pushCollection(KEY.users, users); await new Promise(r=>setTimeout(r,400)); }catch(e){ console.warn('[approveUser] sync',e); }
  }
  toast('Account approved. User can now log in on any device.','success');renderUsers();updatePendingBadge();
  if(typeof renderDashboard==='function'&&currentUser&&currentUser.role==='admin') renderDashboard();
}
function viewUser(id){
  const u=Users.one(id);if(!u)return;
  const roleMap={admin:'Admin',staff:'Staff',trainer:'Trainer'};
  const roleColors={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
  const avatarCls={admin:'avatar-admin',staff:'avatar-staff',trainer:'avatar-trainer'}[u.role]||'avatar-staff';
  const tag=roleMap[u.role]||u.role;
  const col=roleColors[u.role]||'var(--gray-300)';
  const upAv=document.getElementById('up_avatar');
  upAv.className='user-avatar '+avatarCls;
  upAv.style.cssText='width:64px;height:64px;font-size:20px;font-weight:800;border-radius:14px;flex-shrink:0;background-size:cover;background-position:center;background-repeat:no-repeat;'+(u.avatar?'cursor:zoom-in;':'');
  if(u.avatar){
    upAv.style.backgroundImage='url("'+u.avatar+'")';
    upAv.textContent='';
    upAv.title='Click to zoom';
    upAv.onclick=function(){openAvatarZoom(u.avatar, u.name);};
  } else {
    upAv.style.backgroundImage='';
    upAv.textContent=initials(u.name);
    upAv.title='';
    upAv.onclick=null;
  }
  document.getElementById('up_name').textContent=u.name;
  document.getElementById('up_username').textContent='@'+u.username;
  document.getElementById('up_role_badge').innerHTML=`<span class="badge" style="background:rgba(255,255,255,.07);color:${col};font-size:10px">${tag}</span>`;
  document.getElementById('up_contact').textContent=u.contact||'—';
  document.getElementById('up_user2').textContent=u.username;
  document.getElementById('up_status').innerHTML=`<span class="badge ${u.status==='locked'?'badge-locked':'badge-active'}">${u.status==='locked'?'Locked':'Active'}</span>`;
  document.getElementById('up_created').textContent=formatDate(u.createdAt||today());
  document.getElementById('up_edit_btn').onclick=function(){closeModal('userProfileModal');openUserModal(id);};
  // Trainer extra info — uses HTML placeholder in modal-body (not modal-foot)
  let trainerSection=document.getElementById('up_trainer_section');
  if(u.role==='trainer'&&(u.coachName||u.specializations||u.availableDays||u.bio)){
    const specs=trainerSpecList(u);
    const days=Array.isArray(u.availableDays)?u.availableDays:[];
    const hours=(u.availableFrom&&u.availableTo)?`${u.availableFrom} – ${u.availableTo}`:'—';
    trainerSection.style.display='block';
    trainerSection.innerHTML=`
      <div style="padding:0 24px 16px">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--orange);margin-bottom:12px">Trainer Profile</div>
          <div style="font-size:12px;line-height:2;color:var(--gray-300)">
            <div><span style="color:var(--gray-500);width:110px;display:inline-block">Coach Name:</span><strong style="color:var(--white)">${esc(u.coachName||u.name||'—')}</strong></div>
            <div style="margin-top:6px"><span style="color:var(--gray-500);display:block;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:1px">Best For:</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${specs.length?specs.map(s=>`<span class="uf-chip">${esc(s)}</span>`).join(''):'<span style="color:var(--gray-500)">—</span>'}</div>
            </div>
            <div style="margin-top:8px"><span style="color:var(--gray-500);display:block;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:1px">Available Days:</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${days.length?days.map(d=>`<span class="uf-day-chip">${esc(d)}</span>`).join(''):'<span style="color:var(--gray-500)">—</span>'}</div>
            </div>
            <div style="margin-top:8px"><span style="color:var(--gray-500);width:110px;display:inline-block">Hours:</span><strong style="color:var(--orange)">${esc(hours)}</strong></div>
            ${u.bio?`<div style="margin-top:10px;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--gray-300);line-height:1.6;border:1px solid rgba(255,255,255,.06)">${esc(u.bio)}</div>`:''}
          </div>
        </div>
      </div>`;
  } else {
    trainerSection.style.display='none';trainerSection.innerHTML='';
  }
  openModal('userProfileModal');
}
function deleteUser(id){
  if(id===currentUser.id){toast('You cannot delete your own account.','error');return;}
  const u=Users.one(id);
  const roleColors={admin:'var(--orange)',staff:'#d7ddd8',trainer:'var(--green)'};
  const roleColor=u?roleColors[u.role]||'var(--gray-300)':'var(--gray-300)';
  const detail=u?`<div style="margin-top:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.8">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.06)">
      <div class="user-avatar avatar-${u.role}" style="width:36px;height:36px;font-size:12px;font-weight:800;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${u.avatar?'padding:0;overflow:hidden':''}">${u.avatar?`<img src="${u.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`:initials(u.name)}</div>
      <div><div style="font-weight:700;color:var(--white);font-size:13px">${esc(u.name)}</div><div style="color:var(--gray-500);font-size:11px;font-family:monospace">@${esc(u.username)}</div></div>
      <span style="margin-left:auto;font-size:9px;font-weight:800;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.07);color:${roleColor};text-transform:uppercase">${esc(u.role)}</span>
    </div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Contact:</span> <strong style="color:var(--white)">${esc(u.contact||'—')}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Status:</span> <strong style="color:${u.status==='locked'?'var(--red)':'var(--green)'}">${u.status==='locked'?'Locked':'Active'}</strong></div>
    <div><span style="color:var(--gray-500);width:80px;display:inline-block">Created:</span> <strong style="color:var(--white)">${formatDate(u.createdAt||today())}</strong></div>
  </div><div style="margin-top:10px;font-size:11px;color:var(--red);background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:6px;padding:8px 12px">⚠ This will permanently remove the user and cannot be undone.</div>`:'';
  openConfirm('Delete User',`Are you sure you want to delete this user?${detail}`,()=>{
    Users.remove(id);toast('User deleted.');renderUsers();updatePendingBadge();
  });
}

// ======================================================================
// CHECK-IN / CHECK-OUT
// ======================================================================
// ---- CHECK-IN search helpers ----
let _ciMembers=[];
function openCheckin(){
  _ciMembers=Members.all().filter(m=>m.status!=='Archived'&&m.status!=='Expired');
  document.getElementById('ci_search').value='';
  document.getElementById('ci_member').value='';
  document.getElementById('ci_list').style.display='none';
  document.getElementById('ci_selected').style.display='none';
  document.getElementById('checkinError').style.display='none';
  openModal('checkinModal');
  setTimeout(()=>document.getElementById('ci_search').focus(),100);
}
function filterCheckinList(val){
  const list=document.getElementById('ci_list');
  document.getElementById('ci_member').value='';
  document.getElementById('ci_selected').style.display='none';
  if(!val.trim()){list.style.display='none';return;}
  const q=val.toLowerCase();
  const matches=_ciMembers.filter(m=>m.name.toLowerCase().includes(q)||m.id.toLowerCase().includes(q)).slice(0,10);
  if(!matches.length){list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">No members found</div>';list.style.display='block';return;}
  list.innerHTML=matches.map(m=>`<div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;justify-content:space-between;align-items:center"
    onmousedown="selectCheckinMember('${m.id}','${esc(m.name).replace(/'/g,"&#39;")}','${m.status}')"
    onmouseover="this.style.background='rgba(127,250,136,.08)'" onmouseout="this.style.background=''">
    <span>${esc(m.name)}</span>
    <span style="font-size:10px;color:var(--gray-500)">${esc(m.id)}</span>
  </div>`).join('');
  list.style.display='block';
}
function selectCheckinMember(id,name,status){
  document.getElementById('ci_member').value=id;
  document.getElementById('ci_search').value=name;
  document.getElementById('ci_list').style.display='none';
  const sel=document.getElementById('ci_selected');
  sel.innerHTML=`✅ <strong>${esc(name)}</strong> <span style="font-size:11px;color:var(--gray-500)">${esc(id)}</span>`;
  sel.style.display='block';
}
function doCheckin(){
  const memberId=document.getElementById('ci_member').value;
  const err=document.getElementById('checkinError');
  err.style.display='none';
  if(!memberId){err.textContent='Please search and select a member first.';err.style.display='block';return;}
  const member=Members.one(memberId);
  if(bgCheckFlagged(member)){err.textContent='Background check is Flagged — entry blocked. Clear it in the member profile first.';err.style.display='block';return;}
  const today_=today();
  const attendance=Attendance.all();
  const existing=attendance.find(a=>a.memberId===memberId&&a.date===today_);
  if(existing){err.textContent='Member already checked in today — only one entry per day is allowed.';err.style.display='block'; toast('Duplicate — already checked in today','error'); return;}
  const now=new Date();
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const ts=now.getTime();
  attendance.push({id:uid(),memberId,date:today_,time,checkIn:time,checkInTs:ts,checkOut:null,checkOutTs:null,duration:null,recordedBy:currentUser.name});
  Attendance.save(attendance);
  toast('Check-in recorded successfully.');closeModal('checkinModal');
  if(document.getElementById('panelDashboard').classList.contains('active'))renderDashboard();
}

// ---- CHECK-OUT dropdown helpers ----
let _coAttendance=[];
function openCheckout(){
  const today_=today();
  const attendance=Attendance.all();
  const members=Members.all();
  _coAttendance=attendance.filter(a=>a.date===today_&&a.checkIn&&!a.checkOut).map(a=>{
    const m=members.find(x=>x.id===a.memberId);
    return{...a,memberName:m?m.name:'Unknown'};
  });
  document.getElementById('co_search').value='';
  document.getElementById('co_member').value='';
  document.getElementById('co_list').style.display='none';
  document.getElementById('co_selected').style.display='none';
  document.getElementById('checkoutError').style.display='none';
  openModal('checkoutModal');
  setTimeout(()=>document.getElementById('co_search').focus(),120);
}
function filterCheckoutList(val){
  const list=document.getElementById('co_list');
  document.getElementById('co_member').value='';
  document.getElementById('co_selected').style.display='none';
  if(!val.trim()){list.style.display='none';return;}
  const q=val.toLowerCase();
  const matches=_coAttendance.filter(a=>a.memberName.toLowerCase().includes(q)).slice(0,10);
  if(!matches.length){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">No checked-in members found</div>';
    list.style.display='block';return;
  }
  list.innerHTML=matches.map(a=>`<div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;justify-content:space-between;align-items:center"
    onmousedown="selectCheckoutMember('${a.id}','${esc(a.memberName).replace(/'/g,"&#39;")}','${esc(a.checkIn)}')"
    onmouseover="this.style.background='rgba(179,188,181,.08)'" onmouseout="this.style.background=''">
    <span>${esc(a.memberName)}</span>
    <span style="font-size:10px;color:var(--gray-500)">In: ${esc(a.checkIn)}</span>
  </div>`).join('');
  list.style.display='block';
}
function selectCheckoutMember(attId,name,checkIn){
  document.getElementById('co_member').value=attId;
  document.getElementById('co_search').value=name;
  document.getElementById('co_list').style.display='none';
  const sel=document.getElementById('co_selected');
  sel.innerHTML='&#x1F6AA; <strong>'+esc(name)+'</strong> <span style="font-size:11px;color:var(--gray-500)">Checked in: '+esc(checkIn)+'</span>';
  sel.style.display='block';
}

function doCheckout(){
  const attId=document.getElementById('co_member').value;
  const err=document.getElementById('checkoutError');
  err.style.display='none';
  if(!attId){err.textContent='Please search and select a checked-in member first.';err.style.display='block';return;}
  const attendance=Attendance.all();
  const idx=attendance.findIndex(a=>a.id===attId);
  if(idx<0){err.textContent='Record not found.';err.style.display='block';return;}
  const now=new Date();
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const ts=now.getTime();
  const inTs=attendance[idx].checkInTs||ts;
  const durMs=ts-inTs;
  const durMins=Math.round(durMs/60000);
  const hrs=Math.floor(durMins/60);const mins=durMins%60;
  const duration=hrs>0?`${hrs}h ${mins}m`:`${mins}m`;
  attendance[idx].checkOut=time;attendance[idx].checkOutTs=ts;attendance[idx].duration=duration;
  Attendance.save(attendance);
  toast(`Check-out recorded. Duration: ${duration}`);closeModal('checkoutModal');
  if(document.getElementById('panelDashboard').classList.contains('active'))renderDashboard();
}

// ======================================================================
// CLOSE MODAL ON BACKDROP CLICK
// ======================================================================
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click',e=>{
    if(e.target!==el) return;
    if(el.id==='exerciseMediaModal') closeExerciseMedia();
    else el.classList.remove('open');
  });
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  const modal=document.getElementById('exerciseMediaModal');
  if(modal&&modal.classList.contains('open')) closeExerciseMedia();
});

// ======================================================================
// INIT
// ======================================================================
(function(){
  seedData();
  updateHeroMemberCount();
  initHeroStats();
  initReveals();
  initCursorGlow();
  initProgressBar();
  const sess=getSession();
  if(sess){currentUser=sess;loadApp();}
})();

// ======================================================================
// ACTIVITY LOG
// ======================================================================
function logActivity(action,category,detail,extra){
  // Internal audit trail only: never record what a member did.
  if(currentUser&&currentUser.role==='member')return;
  const log=ActivityLog.all()||[];
  log.unshift({id:'ACT'+Date.now(),action,category,detail,extra:extra||'',
    by:currentUser?currentUser.name:'System',byUsername:currentUser?currentUser.username:'',
    byRole:currentUser?currentUser.role:'',at:new Date().toISOString()});
  if(log.length>500)log.length=500;
  ActivityLog.save(log);
}
// ======================================================================
// MOBILE RESPONSIVE HELPERS
// ======================================================================
function toggleMobileMenu(){
  const btn=document.getElementById('lnHamburger');
  const menu=document.getElementById('lnMobileMenu');
  if(btn&&menu){btn.classList.toggle('open');menu.classList.toggle('open');}
}
function closeMobileMenu(){
  const btn=document.getElementById('lnHamburger');
  const menu=document.getElementById('lnMobileMenu');
  if(btn)btn.classList.remove('open');
  if(menu)menu.classList.remove('open');
}
function toggleSidebar(){
  const sb=document.getElementById('appSidebar');
  const ov=document.getElementById('sidebarOverlay');
  if(sb){sb.classList.toggle('mobile-open');}
  if(ov){ov.classList.toggle('open');}
}
function closeSidebar(){
  const sb=document.getElementById('appSidebar');
  const ov=document.getElementById('sidebarOverlay');
  if(sb)sb.classList.remove('mobile-open');
  if(ov)ov.classList.remove('open');
}
// Close sidebar on nav item click (mobile)
document.addEventListener('click',function(e){
  if(window.innerWidth<=768&&e.target.closest('.nav-item')){closeSidebar();}
});
// Auto-close sidebar when screen resizes above mobile breakpoint
window.addEventListener('resize',function(){
  if(window.innerWidth>768){closeSidebar();}
});
// ======================================================================
// COUNTRY PHONE PICKER
// ======================================================================
const COUNTRIES=[
  {flag:'PH',name:'Philippines',code:'+63'},
  {flag:'US',name:'United States',code:'+1'},
  {flag:'GB',name:'United Kingdom',code:'+44'},
  {flag:'AU',name:'Australia',code:'+61'},
  {flag:'CA',name:'Canada',code:'+1'},
  {flag:'JP',name:'Japan',code:'+81'},
  {flag:'KR',name:'South Korea',code:'+82'},
  {flag:'CN',name:'China',code:'+86'},
  {flag:'IN',name:'India',code:'+91'},
  {flag:'SG',name:'Singapore',code:'+65'},
  {flag:'MY',name:'Malaysia',code:'+60'},
  {flag:'ID',name:'Indonesia',code:'+62'},
  {flag:'TH',name:'Thailand',code:'+66'},
  {flag:'VN',name:'Vietnam',code:'+84'},
  {flag:'HK',name:'Hong Kong',code:'+852'},
  {flag:'TW',name:'Taiwan',code:'+886'},
  {flag:'NZ',name:'New Zealand',code:'+64'},
  {flag:'AE',name:'UAE',code:'+971'},
  {flag:'SA',name:'Saudi Arabia',code:'+966'},
  {flag:'QA',name:'Qatar',code:'+974'},
  {flag:'BH',name:'Bahrain',code:'+973'},
  {flag:'KW',name:'Kuwait',code:'+965'},
  {flag:'OM',name:'Oman',code:'+968'},
  {flag:'DE',name:'Germany',code:'+49'},
  {flag:'FR',name:'France',code:'+33'},
  {flag:'IT',name:'Italy',code:'+39'},
  {flag:'ES',name:'Spain',code:'+34'},
  {flag:'PT',name:'Portugal',code:'+351'},
  {flag:'NL',name:'Netherlands',code:'+31'},
  {flag:'BE',name:'Belgium',code:'+32'},
  {flag:'CH',name:'Switzerland',code:'+41'},
  {flag:'SE',name:'Sweden',code:'+46'},
  {flag:'NO',name:'Norway',code:'+47'},
  {flag:'DK',name:'Denmark',code:'+45'},
  {flag:'FI',name:'Finland',code:'+358'},
  {flag:'RU',name:'Russia',code:'+7'},
  {flag:'BR',name:'Brazil',code:'+55'},
  {flag:'MX',name:'Mexico',code:'+52'},
  {flag:'AR',name:'Argentina',code:'+54'},
  {flag:'ZA',name:'South Africa',code:'+27'},
  {flag:'NG',name:'Nigeria',code:'+234'},
  {flag:'KE',name:'Kenya',code:'+254'},
  {flag:'GH',name:'Ghana',code:'+233'},
  {flag:'PK',name:'Pakistan',code:'+92'},
  {flag:'BD',name:'Bangladesh',code:'+880'},
  {flag:'LK',name:'Sri Lanka',code:'+94'},
  {flag:'NP',name:'Nepal',code:'+977'},
  {flag:'MM',name:'Myanmar',code:'+95'},
  {flag:'KH',name:'Cambodia',code:'+855'},
  {flag:'BN',name:'Brunei',code:'+673'},
  {flag:'PG',name:'Papua New Guinea',code:'+675'},
];
let selectedCountry=COUNTRIES[0];
function renderCountryList(filter=''){
  const list=document.getElementById('countryList');
  if(!list)return;
  const filtered=filter?COUNTRIES.filter(c=>c.name.toLowerCase().includes(filter.toLowerCase())||c.code.includes(filter)):COUNTRIES;
  list.innerHTML=filtered.map(c=>`<div class="country-item${c.code===selectedCountry.code&&c.name===selectedCountry.name?' selected':''}" onclick="selectCountry('${c.flag}','${c.name}','${c.code}')"><span class="ci-flag">${c.flag}</span><span class="ci-name">${c.name}</span><span class="ci-code">${c.code}</span></div>`).join('');
}
function filterCountries(val){renderCountryList(val);}
function selectCountry(flag,name,code){
  selectedCountry={flag,name,code};
  document.getElementById('phoneFlag').textContent=flag;
  document.getElementById('phoneDialCode').textContent=code;
  closeCountryDrop();
}
function toggleCountryDrop(){
  const drop=document.getElementById('countryDrop');
  const btn=document.getElementById('phoneFlagBtn');
  const isOpen=drop.classList.contains('open');
  if(isOpen){closeCountryDrop();}
  else{drop.classList.add('open');btn.classList.add('open');renderCountryList();document.getElementById('countrySearch').value='';setTimeout(()=>document.getElementById('countrySearch').focus(),50);}
}
function closeCountryDrop(){
  const d=document.getElementById('countryDrop');if(d)d.classList.remove('open');
  const b=document.getElementById('phoneFlagBtn');if(b)b.classList.remove('open');
}
let selectedMsCountry=COUNTRIES[0];
function renderMsCountryList(filter=''){
  const list=document.getElementById('msCountryList');
  if(!list)return;
  const filtered=filter?COUNTRIES.filter(c=>c.name.toLowerCase().includes(filter.toLowerCase())||c.code.includes(filter)):COUNTRIES;
  list.innerHTML=filtered.map(c=>`<div class="country-item${c.code===selectedMsCountry.code&&c.name===selectedMsCountry.name?' selected':''}" onclick="selectMsCountry('${c.flag}','${c.name}','${c.code}')"><span class="ci-flag">${c.flag}</span><span class="ci-name">${c.name}</span><span class="ci-code">${c.code}</span></div>`).join('');
}
function filterMsCountries(val){renderMsCountryList(val);}
function selectMsCountry(flag,name,code){
  selectedMsCountry={flag,name,code};
  const f=document.getElementById('msPhoneFlag');if(f)f.textContent=flag;
  const d=document.getElementById('msPhoneDialCode');if(d)d.textContent=code;
  const inp=document.getElementById('msContact');
  if(inp){
    if(code==='+63'){inp.placeholder='09171234567';inp.maxLength=11;inp.value=inp.value.replace(/\D/g,'').slice(0,11);}
    else{inp.placeholder='Enter number';inp.maxLength=15;}
  }
  closeMsCountryDrop();
}
function toggleMsCountryDrop(){
  const drop=document.getElementById('msCountryDrop');
  const btn=document.getElementById('msPhoneFlagBtn');
  if(!drop||!btn)return;
  const isOpen=drop.classList.contains('open');
  if(isOpen){closeMsCountryDrop();}
  else{drop.classList.add('open');btn.classList.add('open');renderMsCountryList();const s=document.getElementById('msCountrySearch');if(s){s.value='';setTimeout(()=>s.focus(),50);}}
}
function closeMsCountryDrop(){
  const d=document.getElementById('msCountryDrop');if(d)d.classList.remove('open');
  const b=document.getElementById('msPhoneFlagBtn');if(b)b.classList.remove('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.phone-wrap')){closeCountryDrop();closeMsCountryDrop();}
});
// keep trainer placeholder/maxlength in sync with country
const _origSelectCountry=selectCountry;
selectCountry=function(flag,name,code){
  selectedCountry={flag,name,code};
  const f=document.getElementById('phoneFlag');if(f)f.textContent=flag;
  const d=document.getElementById('phoneDialCode');if(d)d.textContent=code;
  const inp=document.getElementById('regContact');
  if(inp){
    if(code==='+63'){inp.placeholder='09171234567';inp.maxLength=11;inp.value=inp.value.replace(/\D/g,'').slice(0,11);}
    else{inp.placeholder='Enter number';inp.maxLength=15;}
  }
  closeCountryDrop();
};

// ============================= INIT =============================
// Convert every static emoji in the markup (header, nav, modals, landing)
// into SVG icons the moment the script loads. A MutationObserver keeps the
// rule for any content injected later (table refreshes, dropdowns, toasts).
(()=>{
  iconize(document);
  syncStaticWalkinPrice();
  const iconObserver=new MutationObserver(ms=>{
    for(const m of ms){
      if(!m.addedNodes||!m.addedNodes.length)continue;
      for(const n of m.addedNodes){
        if(n.nodeType===1)iconize(n);
        else if(n.nodeType===3&&n.parentNode)iconize(n.parentNode);
      }
    }
  });
  iconObserver.observe(document.body,{childList:true,subtree:true});
})();
loadPhProvinces().catch(function(){
  ['ms','reg'].forEach(function(prefix){
    const sel=document.getElementById(prefix+'Province');
    if(sel)phAddrError(sel,'Unable to load provinces — tap to retry');
  });
});

function updateHeroMemberCount(){
  const el=document.getElementById('heroMemberCount');
  if(!el)return;
  const fb=window.GMSFB;
  if(fb&&fb.enabled&&fb.ready&&fb._lastCloud&&fb._lastCloud.members===undefined)return;
  const count=Members.all().filter(m=>m&&m.status!=='Archived').length;
  const prev=parseInt(el.getAttribute('data-count'),10);
  if(prev===count&&el.dataset.counted)return;
  const from=parseInt(el.textContent,10)||0;
  el.setAttribute('data-count',count);
  el.dataset.counted='1';
  animateCount(el,count,700,from);
}

function bsTrainerReason(u,type,date,start,end){
  if(!trainerOffersType(u,type))return 'Does not offer '+type;
  const av=trainerAvailabilityInfo(u,date);
  if(date&&!av.dayOk)return 'Not available on '+av.dayAbbr+' (works '+av.daysText+')';
  if(date&&start&&end){
    const sM=parseTimeToMin(start),eM=parseTimeToMin(end);
    if(sM==null||eM==null||sM>=eM)return 'Check start and end time';
    if(av.hasHours&&(sM<av.fromMin||eM>av.toMin))return 'Outside available hours ('+av.hoursText+')';
    const clash=Sessions.all().some(function(s){return s.trainerId===u.id&&s.date===date&&s.status!=='Cancelled'&&s.status!=='Declined'&&!(end<=s.start||start>=s.end);});
    if(clash)return 'Already booked at that time';
  }
  return isTrainerAvailable(u,type,date,start,end)?'':'Fully booked that day';
}
function bsFilterTrainers(q){
  const list=document.getElementById('bs_trainerList');
  const hidden=document.getElementById('bs_trainer');
  const search=document.getElementById('bs_trainerSearch');
  if(!list||!hidden||!search)return;
  const currentId=hidden.value;
  const current=currentId?Users.one(currentId):null;
  const currentName=current?(current.coachName||current.name):'';
  if(!currentId||String(q||'').trim()!==currentName)hidden.value='';
  const type=document.getElementById('bs_type')?document.getElementById('bs_type').value:'';
  const date=document.getElementById('bs_date')?document.getElementById('bs_date').value:'';
  const start=document.getElementById('bs_start')?document.getElementById('bs_start').value:'';
  const end=document.getElementById('bs_end')?document.getElementById('bs_end').value:'';
  if(!type){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">Select a session type first</div>';
    list.style.display='block';return;
  }
  const fb=window.GMSFB;
  if(fb&&fb.enabled&&fb.ready&&fb._lastCloud&&fb._lastCloud.users===undefined){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">Loading trainers...</div>';
    list.style.display='block';return;
  }
  const query=String(q||'').toLowerCase().trim();
  const all=Users.all().filter(isBookableTrainer).filter(function(u){
    if(!query)return true;
    const specs=trainerSpecList(u);
    return (u.name||'').toLowerCase().includes(query)||(u.coachName||'').toLowerCase().includes(query)||specs.some(function(s){return s.toLowerCase().includes(query);});
  }).map(function(u){return {u:u,reason:bsTrainerReason(u,type,date,start,end)};});
  all.sort(function(a,b){
    if(!a.reason!==!b.reason)return a.reason?1:-1;
    return String(a.u.coachName||a.u.name||'').localeCompare(String(b.u.coachName||b.u.name||''));
  });
  if(!all.length){
    list.innerHTML='<div style="padding:10px 14px;color:var(--gray-500);font-size:13px">No trainers found.</div>';
    list.style.display='block';return;
  }
  const hasSlot=!!(date&&start&&end);
  list.innerHTML=hasSlot?'':'<div style="padding:6px 12px;font-size:10px;color:var(--gray-500);border-bottom:1px solid rgba(255,255,255,.05)">Pick start and end time to check exact slot availability.</div>';
  all.forEach(function(item){
    const u=item.u,reason=item.reason;
    const av=trainerAvailabilityInfo(u,date);
    const booked=trainerBookedRanges(u.id,date);
    const specs=trainerSpecList(u);
    const ok=!reason;
    const slotText=hasSlot?'✓ Available for '+esc(start)+'–'+esc(end):'✓ Available on '+esc(av.dayAbbr||'this day');
    const status=ok
      ?'<span style="font-size:10px;color:var(--green)">'+slotText+'</span>'
      :'<span style="font-size:10px;color:var(--red)">✕ '+esc(reason)+'</span>';
    const other=booked.length?'<span style="font-size:10px;color:var(--gray-500)">Other bookings: '+esc(booked.join(', '))+'</span>':'';
    const nick=(u.coachName&&u.coachName!==u.name)?' <span style="font-size:11px;color:var(--gray-500)">('+esc(u.name)+')</span>':'';
    const specHtml=specs.length?'<span style="font-size:10px;color:var(--orange)">'+specs.slice(0,3).map(esc).join(', ')+'</span>':'';
    const div=document.createElement('div');
    div.style.cssText='padding:9px 12px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;flex-direction:column;gap:2px;'+(ok?'cursor:pointer':'cursor:not-allowed;opacity:.55');
    div.innerHTML='<span style="font-weight:600;color:var(--white)">'+esc(u.coachName||u.name)+nick+'</span>'+specHtml+'<span style="font-size:10px;color:var(--gray-500)">⏰ '+esc(av.text)+'</span>'+status+other;
    if(ok){
      div.addEventListener('mousedown',function(){selectBsTrainer(u.id,u.coachName||u.name);});
      div.addEventListener('mouseover',function(){this.style.background='rgba(179,188,181,.1)';});
      div.addEventListener('mouseout',function(){this.style.background='';});
    }
    list.appendChild(div);
  });
  list.style.display='block';
}
