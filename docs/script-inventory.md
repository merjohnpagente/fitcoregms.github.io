# script.js — Readable Inventory (FitCore GMS)

> File: `script.js` — 9,916,485 chars, 1 line (obfuscated build), tracked in repo (NOT gitignored).
> `.gitignore` only ignores `src/` (readable source, local-only) ug `node_modules/`.
> Kini nga inventory naglista sa 377 readable functions nga naa sa sulod, grouped by module,
> para makita unsay features sa system nga walay pagbasa sa obfuscated code.

## Auth + Landing
showLandingSection, doLogin, confirmLogout, doLogout, showLoginError, togglePw, showLogin, showRegister, toggleMobileMenu, closeMobileMenu, toggleSidebar, closeSidebar, getSession, setSession, clearSession, showPendingGate, checkPendingStatus, showForcePasswordChange

## Staff/Trainer Register
resetRegisterForm, selectRegRole, regStep1Next, regGoStep1, regGoStep2, regStep2Next, onRegRoleChange, doRegister, regDoneBack, showRegTab, updateStrength, _resetPwVis, showRegTab, regGoMember

## Member Signup (3-step + plans)
populateMsPlanSelect, pickMsPlan, updateMsPlanCard, startMemberSignup, msBackToLogin, msStep1Next, msStep2Next, msGoStep1, msGoStep2, msGoStep3, resetMemberSignupForm, updateMsStrength, msStep3Next, msValidateCredentials, submitMemberSignup, onMsDobChange, onMfDobChange, dobPolicy, calcAge

## Forgot Password + OTP (EmailJS)
clearFpVerified, showFpStep, getFpOtp, setFpOtp, initFpOtp, onFpOtpPaste, openForgotModal, fpBackToLogin, fpBackToStep1, toggleFpMethod, updateFpVerifyBtnState, onFpCodeInput, sendForgotCode, fpBackToLoginAlias, resendForgotCode, startFpResendCooldown, updateFpStrength, fpSubmitCode, fpVerifyCode, handleForgotVerify, verifyForgotCode, submitForgotPassword, confirmForgotPassword

## Dashboard + Navigation (per role)
refreshCurrentPanel, initScrollRefresh, loadApp, buildSidebar, renderTopbar, startClock, navigate, renderPanel, greet, dashHero, renderDashboard, buildAdminDashboard, buildStaffDashboard, buildTrainerDashboard, buildMemberDashboard, scanRenewals, updatePendingBadge, updateSchedPendingBadge, updateQueueBadge, ensureSyncWarnEl, updateSyncWarning

## Members
renderMembers, refreshMemberTable, openMemberModal, saveMember, deleteMember, renumberMembers, resetAllMembers, viewMember, setBgCheck, openEditFromProfile, adminResetMemberPassword, openMemberProfileEdit, saveMemberProfileEdit, refreshMemberHome, copyMemberToken, profileCheckIn, nextMemberId, nextId, uid, isMemberExpired, renderHistory, refreshHistoryTable, renderMemberLogs

## Billing + Payments + Receipts
renderBilling, refreshBillingTable, openPaymentModal, togglePfReference, openPaymentForMember, filterMemberDropdown, selectPayMember, onPayPlanChange, savePayment, deletePayment, openEditPayment, onEditPlanChange, saveEditPayment, viewRenewalReceipt, viewReceipt, openConfirmPayment, toggleCpmReference, applyPaymentConfirmation, confirmPayment, confirmSelectedPayments, confirmRenew, dismissRenewal, dismissAllRenewals, renderRenewed, showRenewedPage, backToRenewals, printReceipt, formatPeso, signupRateCheck, pushPendingPaymentNotif

## Check-In/Out + QR Scanner
openCheckin, filterCheckinList, selectCheckinMember, doCheckin, openCheckout, filterCheckoutList, selectCheckoutMember, doCheckout, renderScanner, startScanner, stopScanner, _scanLoop, processQrToken, scanManualToken, showScanResult, playScanSound, qrSig, getQrSecret, newQrNonce, getMemberNonce, qrTokenFor, parseQrToken, renderQrTo, renderMyQr, downloadMyQr, refreshMyQr

## Walk-In + Fees
renderWalkin, refreshWalkinTable, openWalkinModal, walkinAskConfirm, walkinCancelConfirm, saveWalkin, deleteWalkin, openWalkinSettingsModal, saveWalkinFee, getWalkinFee, setWalkinFee, syncStaticWalkinPrice, viewWalkinReceipt

## Membership Plans (+ Landing catalogue)
renderPlans, openPlanModal, toggleUnlimited, savePlan, deletePlan, renderExplorePlans

## Schedule + Sessions + Trainer/Staff Profiles
renderSchedule, getSchedSessions, viewSession, calNav, calToday, renderMonthView, renderWeekView, renderListView, confirmCompleteSession, confirmCancelSession, markSessionDone, getMondayOf, buildTimeOptions, parseTimeToMin, dateToDayAbbr, onSessionDateChange, applyTrainerTimeWindow, filterSessionTrainer, selectSessTrainer, sessionTypesForTrainer, allSessionTypes, isBookableTrainer, trainerSpecs, trainerOffersType, trainersForSessionType, trainerAvailabilityInfo, trainerBookedRanges, trainerAvailabilityError, populateSessionTypeOptions, onSessionTypeChange, updateSessionTypesByTrainer, openSessionModal, editSession, filterSessionMember, selectSessMember, saveSession, toggleSessionStatus, deleteSession, renderMySessions, updateBsTrainerOptions, updateBsAvailability, bookSession, rescheduleSession, acceptSession, declineSession, renderTrainerProfile, openTrainerEditModal, saveTrainerProfile, updateSepAvatar, openStaffEditModal, saveStaffProfile, renderMyAssigned

## Workouts + Progress + Goals
renderExerciseLibrary, seedExerciseLibrary, renderWorkoutBuilder, _wbMuscles, _wbFiltered, _wbRenderSummary, _wbRenderList, createWorkoutPlan, deleteWorkoutPlan, renderMyWorkoutPlan, openMemberPlanForm, cancelMemberPlanForm, mpRefreshPicker, mpOnSearch, mpSetFilter, mpToggleEx, mpClamp, mpStep, mpSetRaw, mpUpdatePreview, saveMemberPlan, editMemberPlan, deleteMemberPlan, togglePlanExercise, _mpMuscles, _mpFilterLib, _mpCardHtml, _mpSideHtml, renderMyWorkouts, calcStreak, addWorkoutEntry, deleteWorkout, renderMyProgress, addMeasurement, deleteMeasurement, renderMyGoals, addGoal, deleteGoal, updateGoalProgress, memberChangePlan, mbStepsHtml, mbToggleHowToPay

## Messages + Announcements + Notifications + Queue
renderMessages, filterMessageThreads, deleteConversation, exportMessages, importMessages, renderAnnouncements, openAnnounceModal, saveAnnouncement, deleteAnnouncement, announceStripHtml, renderNotifications, openMemberMessageModal, openMsgThread, renderMsgThread, sendMessage, myUnreadReplies, updateMyBadges, myMsgBubble, deleteMsg, renderMyMessages, sendMyMessage, updateMessageBadge, resolveNotifsForMember, openPendingNotifs, renderQueue, deleteQueueItem, deleteSelectedQueue, toggleQueueSelect

## Users (Admin) + Reports + Activity Log
renderUsers, refreshUserTable, toggleTrainerFields, updateUfSpecChips, openUserModal, saveUser, toggleUserLock, approveUser, viewUser, deleteUser, renderReports, generateReport, filterTrainerReportList, selectTrainerReport, filterMemberReportList, selectMemberReport, printReport, csvCell, exportCSV, renderActivityLog, printActivityLog, exportActivityLogCSV, logActivity

## Landing UI + Countries + Helpers + Security
initReveals, animateCount, initHeroStats, initCursorGlow, initProgressBar, updateHeroMemberCount, renderTrainers, renderCountryList, filterCountries, selectCountry, toggleCountryDrop, closeCountryDrop, renderMsCountryList, filterMsCountries, selectMsCountry, toggleMsCountryDrop, closeMsCountryDrop, deepClone, hashStr, sha256hex, hashPassword, verifyPassword, migrateLegacyPasswords, esc, sanitizeText, formatDate, formatDateTime, formatFullDate, addDays, addMonths, today, daysUntil, cleanDigits, isPhDial, validatePhone, normalizeContact, phoneErrorMsg, onImagePick, removeImage, compressDataUrl, seedData, openModal, closeModal, openConfirm, toast, iconSvg, _iconSvgNode, iconize, capitalize, initials, memberAvatarOf, userAvatarOf, setUserAvatar, openAvatarZoom
