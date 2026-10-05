import express from "express";
import path from "path";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { db, withTransaction } from "../db/index.js";
import { RP_NAME, RP_ID, RP_ORIGIN } from "../config.js";
import { uploadAvatar, uploadBanner, verifyFiles, promoteStableUpload } from "../services/uploads.js";
import { deleteUserAccountData } from "../services/account.js";
import { regenerateSession, destroyUserSessions } from "../services/sessions.js";
import { recordMetric, recordActive } from "../services/metrics.js";
import {
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
  loginThrottleKey,
  isRecoveryLocked,
  recordRecoveryFailure,
  clearRecoveryFailures,
  sensitiveKey,
  isSensitiveLocked,
  recordSensitiveFailure,
  clearSensitiveFailures,
} from "../utils/throttles.js";
import { clearActivityState } from "../middleware/activity.js";

const router = express.Router();

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRecoveryCode() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}
router.post("/api/auth/register", async (req, res) => {
  const { username, password, securityQuestion, securityAnswer, wantsRecoveryCode } = req.body;
  const trimmedUsername = String(username || "").trim();
  if (!trimmedUsername || !password)
    return res.json({ ok: false, error: "Missing credentials." });
  if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
    return res.json({ ok: false, error: "Username must be 3-20 characters." });
  }
  if (String(password).length < 8)
    return res.json({ ok: false, error: "Password must be at least 8 characters." });
  if (String(password).length > 200)
    return res.json({ ok: false, error: "Password must be 200 characters or fewer." });
  if (securityQuestion && String(securityQuestion).length > 200)
    return res.json({ ok: false, error: "Security question must be 200 characters or fewer." });
  if (securityAnswer && String(securityAnswer).length > 200)
    return res.json({ ok: false, error: "Security answer must be 200 characters or fewer." });
  try {
    const hashed = await bcrypt.hash(password, 10);

    let securityAnswerHash = null;
    let recoveryCodeHash = null;
    let plaintextRecoveryCode = null;

    if (securityQuestion && securityAnswer) {
      securityAnswerHash = await bcrypt.hash(
        String(securityAnswer).trim().toLowerCase(),
        10
      );
    }

    if (wantsRecoveryCode) {
      plaintextRecoveryCode = generateRecoveryCode();
      recoveryCodeHash = await bcrypt.hash(plaintextRecoveryCode, 10);
    }

    await db.run(
      `INSERT INTO users (username, password, security_question, security_answer_hash, recovery_code_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [
        trimmedUsername,
        hashed,
        securityQuestion && securityAnswer ? String(securityQuestion) : null,
        securityAnswerHash,
        recoveryCodeHash,
      ]
    );

    const response = { ok: true };
    if (plaintextRecoveryCode) response.recoveryCode = plaintextRecoveryCode;
    recordMetric("new_users");
    res.json(response);
  } catch (err) {
    if (err.message.includes("UNIQUE"))
      res.json({ ok: false, error: "Username already exists." });
    else res.json({ ok: false, error: "Registration failed." });
  }
});

router.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ ok: false, error: "Missing credentials." });
  const throttleKey = loginThrottleKey(req, username);
  if (isLoginLocked(throttleKey)) {
    return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
  }
  try {
    const user = await db.get("SELECT * FROM users WHERE username = ?", username);
    if (!user) {
      recordLoginFailure(throttleKey);
      return res.json({ ok: false, error: "Invalid username or password." });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      recordLoginFailure(throttleKey);
      return res.json({ ok: false, error: "Invalid username or password." });
    }
    clearLoginFailures(throttleKey);
    await regenerateSession(req, user);
    recordMetric("logins");
    recordActive(req.session.user.id);
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, error: "Login failed." });
  }
});

router.post("/api/auth/logout", (req, res) => {
  const userId = req.session?.user?.id;
  req.session.destroy(() => {
    if (userId) {
      clearActivityState(userId);
      db.run("UPDATE users SET last_seen = NULL WHERE id = ?", [userId]).catch(() => {});
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});


router.post("/api/auth/passkey/register-options", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const existing = await db.all("SELECT credential_id FROM passkeys WHERE user_id = ?", req.session.user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: req.session.user.username,
      userDisplayName: req.session.user.username,
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credential_id })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    req.session.passkeyRegChallenge = options.challenge;
    res.json({ ok: true, options });
  } catch (err) {
    console.error("Passkey register-options error:", err);
    res.status(500).json({ ok: false, error: "Failed to start passkey registration." });
  }
});

router.post("/api/auth/passkey/register-verify", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  const expectedChallenge = req.session.passkeyRegChallenge;
  if (!expectedChallenge) return res.status(400).json({ ok: false, error: "No registration in progress." });
  try {
    const { deviceName, response } = req.body;
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
    });
    delete req.session.passkeyRegChallenge;

    if (!verification.verified || !verification.registrationInfo) {
      return res.json({ ok: false, error: "Passkey verification failed." });
    }

    const passkeyCount = await db.get("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?", [req.session.user.id]);
    if (passkeyCount.n >= 10) {
      return res.status(400).json({ ok: false, error: "Passkey limit reached (10 per account)." });
    }

    const { credential } = verification.registrationInfo;
    await db.run(
      "INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_name) VALUES (?, ?, ?, ?, ?)",
      [
        req.session.user.id,
        credential.id,
        Buffer.from(credential.publicKey).toString("base64url"),
        credential.counter,
        deviceName ? String(deviceName).slice(0, 60) : null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Passkey register-verify error:", err);
    delete req.session.passkeyRegChallenge;
    res.status(400).json({ ok: false, error: "Passkey verification failed." });
  }
});

router.get("/api/auth/passkeys", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const passkeys = await db.all(
      "SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC",
      req.session.user.id
    );
    res.json({ ok: true, passkeys });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load passkeys." });
  }
});

router.delete("/api/auth/passkeys/:id", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const passkey = await db.get("SELECT * FROM passkeys WHERE id = ?", req.params.id);
    if (!passkey) return res.status(404).json({ ok: false, error: "Passkey not found." });
    if (passkey.user_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your passkey." });
    await db.run("DELETE FROM passkeys WHERE id = ?", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to remove passkey." });
  }
});

router.post("/api/auth/passkey/login-options", async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
    });
    req.session.passkeyLoginChallenge = options.challenge;
    res.json({ ok: true, options });
  } catch (err) {
    console.error("Passkey login-options error:", err);
    res.status(500).json({ ok: false, error: "Failed to start passkey login." });
  }
});

router.post("/api/auth/passkey/login-verify", async (req, res) => {
  const expectedChallenge = req.session.passkeyLoginChallenge;
  if (!expectedChallenge) return res.status(400).json({ ok: false, error: "No login in progress." });
  const throttleKey = loginThrottleKey(req, "passkey");
  if (isLoginLocked(throttleKey)) {
    return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
  }
  try {
    const { response } = req.body;
    const passkey = await db.get("SELECT * FROM passkeys WHERE credential_id = ?", response?.id);
    if (!passkey) {
      recordLoginFailure(throttleKey);
      return res.json({ ok: false, error: "Passkey not recognized." });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64url"),
        counter: passkey.counter,
      },
    });
    delete req.session.passkeyLoginChallenge;

    if (!verification.verified) {
      recordLoginFailure(throttleKey);
      return res.json({ ok: false, error: "Passkey verification failed." });
    }

    await db.run(
      "UPDATE passkeys SET counter = ? WHERE id = ?",
      [verification.authenticationInfo.newCounter, passkey.id]
    );

    const user = await db.get("SELECT id, username FROM users WHERE id = ?", passkey.user_id);
    if (!user) {
      recordLoginFailure(throttleKey);
      return res.json({ ok: false, error: "Account no longer exists." });
    }

    clearLoginFailures(throttleKey);
    await regenerateSession(req, user);
    recordMetric("logins");
    recordActive(req.session.user.id);
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Passkey login-verify error:", err);
    delete req.session.passkeyLoginChallenge;
    recordLoginFailure(throttleKey);
    res.status(400).json({ ok: false, error: "Passkey verification failed." });
  }
});

router.get("/api/auth/status", async (req, res) => {
  if (req.session.user) {
    try {
      const user = await db.get(
        "SELECT id, username, avatarUrl, theme_preference FROM users WHERE id = ?",
        [req.session.user.id]
      );
      if (user) {
        res.json({
          ok: true,
          user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl },
          themePreference: user.theme_preference || null,
        });
      } else {
        res.json({ ok: true, user: req.session.user });
      }
    } catch (err) {
      res.json({ ok: true, user: req.session.user });
    }
  } else {
    res.json({ ok: false });
  }
});

router.post("/api/auth/change-password", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, liked: false });
    }
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { oldPassword, newPassword } = req.body;
    const username = req.session.user.username;
    if (!oldPassword || !newPassword) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    if (String(newPassword).length < 8) {
      return res.json({ ok: false, error: "Password must be at least 8 characters." });
    }
    if (String(newPassword).length > 200) {
      return res.json({ ok: false, error: "Password must be 200 characters or fewer." });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", username);
    if (!user) return res.json({ ok: false, error: "User not found" });
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      recordSensitiveFailure(lockKey);
      return res.json({ ok: false, error: "Incorrect current password" });
    }
    clearSensitiveFailures(lockKey);
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.run(
      "UPDATE users SET password = ? WHERE username = ?",
      [hashed, username]
    );
    try {
      await destroyUserSessions(user.id);
    } catch (err) {
      console.error("Failed to destroy sessions after password change:", err);
    }
    req.session.destroy(() => {});
    res.clearCookie("connect.sid");
    res.json({ ok: true, loggedOut: true });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err);
    res.json({ ok: false, error: "Failed to change password." });
  }
});

router.post("/api/auth/change-username", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, error: "Not logged in" });
    }
    const oldUsername = req.session.user.username;
    const trimmedNewUsername = String(req.body.newUsername || "").trim();
    if (!trimmedNewUsername || trimmedNewUsername.length < 3 || trimmedNewUsername.length > 20) {
      return res.json({ ok: false, error: "Username must be 3-20 characters." });
    }
    const exists = await db.get(
      "SELECT 1 FROM users WHERE username = ?",
      trimmedNewUsername
    );
    if (exists) {
      return res.json({ ok: false, error: "Username already taken" });
    }
    try {
      await withTransaction(async () => {
        await db.run(
          "UPDATE users SET username = ? WHERE username = ?",
          [trimmedNewUsername, oldUsername]
        );
        await db.run(
          "UPDATE addons SET author = ? WHERE author = ?",
          [trimmedNewUsername, oldUsername]
        );
        await db.run(
          "UPDATE comments SET username = ? WHERE username = ?",
          [trimmedNewUsername, oldUsername]
        );
        await db.run(
          "UPDATE follows SET followed_username = ? WHERE followed_username = ?",
          [trimmedNewUsername, oldUsername]
        );
        await db.run(
          "UPDATE creator_invites SET invited_username = ? WHERE invited_username = ?",
          [trimmedNewUsername, oldUsername]
        );
      });
    } catch (err) {
      if (err.message.includes("UNIQUE")) {
        return res.json({ ok: false, error: "Username already taken" });
      }
      throw err;
    }
    req.session.user.username = trimmedNewUsername;
    res.json({ ok: true, username: trimmedNewUsername });
  } catch (err) {
    console.error("CHANGE USERNAME ERROR:", err);
    res.json({ ok: false, error: "Failed to change username." });
  }
});

router.post("/api/auth/recovery-options", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: "Missing username." });
  const throttleKey = loginThrottleKey(req, "recovery-options");
  if (isLoginLocked(throttleKey)) {
    return res.json({ ok: false, error: "Too many attempts. Try again later." });
  }
  try {
    const user = await db.get(
      "SELECT security_question, recovery_code_hash FROM users WHERE username = ?",
      [username]
    );
    if (!user) {
      recordLoginFailure(throttleKey);
      return res.json({
        ok: true,
        hasSecurityQuestion: false,
        question: null,
        hasRecoveryCode: false,
      });
    }
    res.json({
      ok: true,
      hasSecurityQuestion: !!user.security_question,
      question: user.security_question || null,
      hasRecoveryCode: !!user.recovery_code_hash,
    });
  } catch (err) {
    console.error("RECOVERY OPTIONS ERROR:", err);
    res.json({ ok: false, error: "Failed to load recovery options." });
  }
});

router.post("/api/auth/recover-password", async (req, res) => {
  const { username, securityAnswer, recoveryCode, newPassword } = req.body;
  if (!username || !newPassword)
    return res.json({ ok: false, error: "Missing fields." });
  if (String(newPassword).length < 8)
    return res.json({ ok: false, error: "Password must be at least 8 characters." });
  if (String(newPassword).length > 200)
    return res.json({ ok: false, error: "Password must be 200 characters or fewer." });
  if (!securityAnswer && !recoveryCode)
    return res.json({ ok: false, error: "Provide a security answer or recovery code." });

  try {
    if (isRecoveryLocked(username)) {
      return res.json({
        ok: false,
        error: "Too many failed attempts. Try again later.",
      });
    }

    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      recordRecoveryFailure(username);
      return res.json({ ok: false, error: "Security answer or recovery code did not match." });
    }

    let verified = false;
    let verifiedByCode = false;

    if (securityAnswer && user.security_answer_hash) {
      verified = await bcrypt.compare(
        String(securityAnswer).trim().toLowerCase(),
        user.security_answer_hash
      );
    }

    if (!verified && recoveryCode && user.recovery_code_hash) {
      verified = await bcrypt.compare(String(recoveryCode).trim(), user.recovery_code_hash);
      if (verified) verifiedByCode = true;
    }

    if (!verified) {
      recordRecoveryFailure(username);
      return res.json({ ok: false, error: "Security answer or recovery code did not match." });
    }

    clearRecoveryFailures(username);
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password = ? WHERE username = ?", [hashed, username]);

    if (verifiedByCode) {
      await db.run("UPDATE users SET recovery_code_hash = NULL WHERE username = ?", [username]);
    }

    try {
      await destroyUserSessions(user.id);
    } catch (err) {
      console.error("Failed to destroy sessions after password recovery:", err);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("RECOVER PASSWORD ERROR:", err);
    res.json({ ok: false, error: "Recovery failed." });
  }
});

router.post("/api/auth/regenerate-recovery-code", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  try {
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", [
      req.session.user.username,
    ]);
    if (!user) return res.json({ ok: false, error: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      recordSensitiveFailure(lockKey);
      return res.json({ ok: false, error: "Incorrect current password" });
    }
    clearSensitiveFailures(lockKey);

    const newCode = generateRecoveryCode();
    const hash = await bcrypt.hash(newCode, 10);
    await db.run("UPDATE users SET recovery_code_hash = ? WHERE username = ?", [
      hash,
      req.session.user.username,
    ]);
    res.json({ ok: true, recoveryCode: newCode });
  } catch (err) {
    console.error("REGENERATE RECOVERY CODE ERROR:", err);
    res.json({ ok: false, error: "Failed to regenerate recovery code." });
  }
});

router.post("/api/auth/set-security-question", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  try {
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { securityQuestion, securityAnswer, currentPassword } = req.body;
    if (!securityQuestion || !securityAnswer || !currentPassword) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", [
      req.session.user.username,
    ]);
    if (!user) return res.json({ ok: false, error: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      recordSensitiveFailure(lockKey);
      return res.json({ ok: false, error: "Incorrect current password" });
    }
    clearSensitiveFailures(lockKey);

    const answerHash = await bcrypt.hash(String(securityAnswer).trim().toLowerCase(), 10);
    await db.run(
      "UPDATE users SET security_question = ?, security_answer_hash = ? WHERE username = ?",
      [securityQuestion, answerHash, req.session.user.username]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("SET SECURITY QUESTION ERROR:", err);
    res.json({ ok: false, error: "Failed to save security question." });
  }
});

router.post("/api/auth/remove-security-question", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  try {
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", [
      req.session.user.username,
    ]);
    if (!user) return res.json({ ok: false, error: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      recordSensitiveFailure(lockKey);
      return res.json({ ok: false, error: "Incorrect current password" });
    }
    clearSensitiveFailures(lockKey);

    await db.run(
      "UPDATE users SET security_question = NULL, security_answer_hash = NULL WHERE username = ?",
      [req.session.user.username]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("REMOVE SECURITY QUESTION ERROR:", err);
    res.json({ ok: false, error: "Failed to remove security question." });
  }
});

router.post("/api/auth/remove-recovery-code", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  try {
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", [
      req.session.user.username,
    ]);
    if (!user) return res.json({ ok: false, error: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      recordSensitiveFailure(lockKey);
      return res.json({ ok: false, error: "Incorrect current password" });
    }
    clearSensitiveFailures(lockKey);

    await db.run(
      "UPDATE users SET recovery_code_hash = NULL WHERE username = ?",
      [req.session.user.username]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("REMOVE RECOVERY CODE ERROR:", err);
    res.json({ ok: false, error: "Failed to remove recovery code." });
  }
});

router.delete("/api/auth/account", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  try {
    const lockKey = sensitiveKey(req.session.user.id);
    if (isSensitiveLocked(lockKey)) {
      return res.json({ ok: false, error: "Too many failed attempts. Try again later." });
    }
    const { password } = req.body;
    if (!password) {
      return res.json({ ok: false, error: "Password confirmation required." });
    }

    const username = req.session.user.username;
    const userId = req.session.user.id;

    const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return res.json({ ok: false, error: "User not found." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      recordSensitiveFailure(sensitiveKey(userId));
      return res.json({ ok: false, error: "Incorrect password." });
    }
    clearSensitiveFailures(sensitiveKey(userId));

    await deleteUserAccountData(username, userId);

    try {
      await destroyUserSessions(userId);
    } catch (err) {
      console.warn("Session cleanup failed after account deletion:", err);
    }

    req.session.destroy((err) => {
      if (err) console.warn("Session destroy failed after account deletion:", err);
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  } catch (err) {
    console.error("DELETE ACCOUNT ERROR:", err);
    return res.status(500).json({ ok: false, error: "Account deletion failed partway through. Some data may already be removed — contact support." });
  }
});

router.post("/api/auth/upload-avatar", (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  uploadAvatar.single("avatar")(req, res, function (err) {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.session.user.id;
    if (!req.file) {
      return res.json({ ok: false, error: "No file uploaded" });
    }
    try {
      verifyFiles(req.file, "image");
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    const avatarUrl = promoteStableUpload(req.file.path, path.join(process.cwd(), "avatars"), userId);
    await db.run("UPDATE users SET avatarUrl = ? WHERE id = ?", [avatarUrl, userId]);
    res.json({ ok: true, userId, avatarUrl });
  } catch (err) {
    console.error("UPLOAD AVATAR ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to upload avatar." });
  }
});

router.post("/api/auth/upload-banner", (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  uploadBanner.single("banner")(req, res, function (err) {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ ok: false, error: "No file uploaded" });
    }
    try {
      verifyFiles(req.file, "image");
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    const bannerUrl = promoteStableUpload(req.file.path, path.join(process.cwd(), "banners"), req.session.user.id);
    await db.run("UPDATE users SET bannerUrl = ? WHERE id = ?", [bannerUrl, req.session.user.id]);
    res.json({ ok: true, bannerUrl });
  } catch (err) {
    console.error("UPLOAD BANNER ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to upload banner." });
  }
});

export default router;
