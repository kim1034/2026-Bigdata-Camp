import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBackendFirestore } from '../db/firebase';

const scrypt = promisify(scryptCallback);

export type PasswordAuthUser = {
  uid: string;
  userId: string;
  nickname: string;
  age: number;
  gender: string;
  friendCode: string;
  workspaceId: string;
  createdAt?: string;
};

type StoredUser = PasswordAuthUser & {
  passwordHash: string;
  passwordSalt: string;
  passwordAlgorithm: 'scrypt';
  updatedAt: string;
};

function normalizeUserId(userId: string) {
  return userId.trim().toLowerCase();
}

function safeWorkspaceId(userId: string) {
  return `user_${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function friendCodeForUser(userId: string) {
  return `PIN-${createHash('sha1').update(userId).digest('hex').slice(0, 6).toUpperCase()}`;
}

function publicUser(user: StoredUser): PasswordAuthUser {
  return {
    uid: user.uid,
    userId: user.userId,
    nickname: user.nickname,
    age: user.age,
    gender: user.gender,
    friendCode: user.friendCode || friendCodeForUser(user.userId),
    workspaceId: user.workspaceId,
    createdAt: user.createdAt,
  };
}

function validateUserId(userId: string) {
  if (!/^[a-z0-9_]{4,20}$/.test(userId)) {
    throw new Error('아이디는 영문 소문자, 숫자, 밑줄만 사용해 4~20자로 입력해 주세요.');
  }
}

function validatePassword(password: string) {
  if (password.length < 6 || password.length > 72) {
    throw new Error('비밀번호는 6~72자로 입력해 주세요.');
  }
}

function validateProfile(nickname: string, age: number, gender: string) {
  if (nickname.trim().length < 2 || nickname.trim().length > 16) {
    throw new Error('닉네임은 2~16자로 입력해 주세요.');
  }
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw new Error('나이는 1~120 사이의 숫자로 입력해 주세요.');
  }
  if (!['female', 'male', 'other', 'none'].includes(gender)) {
    throw new Error('성별 값을 확인해 주세요.');
  }
}

async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return {
    hash: derivedKey.toString('hex'),
    salt,
  };
}

async function verifyPassword(password: string, storedHash: string, salt: string) {
  const { hash } = await hashPassword(password, salt);
  const stored = Buffer.from(storedHash, 'hex');
  const candidate = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

async function getUserDoc(userId: string) {
  return doc(getBackendFirestore(), 'users', userId);
}

export async function registerPasswordUser(input: {
  userId: string;
  password: string;
  nickname: string;
  age: number;
  gender: string;
}) {
  const userId = normalizeUserId(input.userId);
  const password = String(input.password || '');
  const nickname = String(input.nickname || '').trim();
  const age = Number(input.age);
  const gender = String(input.gender || 'none');

  validateUserId(userId);
  validatePassword(password);
  validateProfile(nickname, age, gender);

  const userRef = await getUserDoc(userId);
  const existing = await getDoc(userRef);
  if (existing.exists()) {
    throw new Error('이미 사용 중인 아이디입니다.');
  }

  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(password);
  const user: StoredUser = {
    uid: userId,
    userId,
    nickname,
    age,
    gender,
    friendCode: friendCodeForUser(userId),
    workspaceId: safeWorkspaceId(userId),
    passwordHash: hash,
    passwordSalt: salt,
    passwordAlgorithm: 'scrypt',
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(userRef, user);
  return publicUser(user);
}

export async function loginPasswordUser(input: { userId: string; password: string }) {
  const userId = normalizeUserId(input.userId);
  const password = String(input.password || '');

  validateUserId(userId);
  validatePassword(password);

  const userRef = await getUserDoc(userId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  const user = snapshot.data() as StoredUser;
  const nextFriendCode = user.friendCode || friendCodeForUser(userId);
  const matched = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!matched) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  await setDoc(
    userRef,
    {
      lastLoginAt: new Date().toISOString(),
      friendCode: nextFriendCode,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return publicUser(user);
}
