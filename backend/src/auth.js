import crypto from "crypto";

const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");

  return `${ITERATIONS}:${salt}:${hash}`;
}

export function createSessionToken() {
  return `demo_${crypto.randomBytes(24).toString("hex")}`;
}

export function createResetCode() {
  return String(crypto.randomInt(100000, 999999));
}

export function verifyPassword(password, storedPassword) {
  const [iterations, salt, storedHash] = storedPassword.split(":");
  const hash = crypto
    .pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
    .toString("hex");

  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company,
    createdAt: user.createdAt
  };
}
