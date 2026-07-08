import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getBackendFirestore } from '../db/firebase';
import { sendItinerarySharePushNotifications } from './push.service';

type UserProfile = {
  userId: string;
  uid?: string;
  nickname?: string;
  friendCode?: string;
  workspaceId?: string;
};

function normalizeUserId(userId: string) {
  return String(userId || '').trim().toLowerCase();
}

function normalizeFriendCode(value: string) {
  return String(value || '').trim().toUpperCase();
}

function requireUserId(userId: string) {
  const normalized = normalizeUserId(userId);
  if (!normalized) throw new Error('로그인이 필요합니다.');
  return normalized;
}

function publicProfile(user: UserProfile) {
  return {
    userId: user.userId || user.uid,
    nickname: user.nickname || user.userId || user.uid,
    friendCode: user.friendCode || '',
    workspaceId: user.workspaceId || '',
  };
}

async function getUser(userId: string) {
  const snapshot = await getDoc(doc(getBackendFirestore(), 'users', normalizeUserId(userId)));
  if (!snapshot.exists()) throw new Error('사용자를 찾지 못했습니다.');
  return publicProfile(snapshot.data() as UserProfile);
}

async function findUserByIdOrCode(identifier: string) {
  const db = getBackendFirestore();
  const normalizedId = normalizeUserId(identifier);
  if (normalizedId) {
    const byId = await getDoc(doc(db, 'users', normalizedId));
    if (byId.exists()) return publicProfile(byId.data() as UserProfile);
  }

  const code = normalizeFriendCode(identifier);
  const snapshot = await getDocs(query(collection(db, 'users'), where('friendCode', '==', code)));
  const first = snapshot.docs[0];
  if (!first) throw new Error('친구 코드 또는 아이디를 찾지 못했습니다.');
  return publicProfile(first.data() as UserProfile);
}

function requestId(fromUserId: string, toUserId: string) {
  return `${normalizeUserId(fromUserId)}__${normalizeUserId(toUserId)}`;
}

function friendDoc(userId: string, friendUserId: string) {
  return doc(getBackendFirestore(), 'users', normalizeUserId(userId), 'friends', normalizeUserId(friendUserId));
}

async function deleteItinerarySharesFromInbox(userId: string, ownerUserId: string) {
  const db = getBackendFirestore();
  const snapshot = await getDocs(collection(db, 'users', normalizeUserId(userId), 'shareInbox'));
  const targetDocs = snapshot.docs.filter((item) => {
    const data = item.data() as any;
    return normalizeUserId(data.ownerUserId) === normalizeUserId(ownerUserId) && data.type === 'itinerary';
  });

  for (let index = 0; index < targetDocs.length; index += 450) {
    const batch = writeBatch(db);
    targetDocs.slice(index, index + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }

  return targetDocs.length;
}

export async function getFriendHub(userIdInput: string) {
  const userId = requireUserId(userIdInput);
  const db = getBackendFirestore();
  const friendsSnapshot = await getDocs(collection(db, 'users', userId, 'friends'));
  return friendsSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a: any, b: any) => String(a.nickname || '').localeCompare(String(b.nickname || '')));
}

export async function getFriendRequests(userIdInput: string) {
  const userId = requireUserId(userIdInput);
  const db = getBackendFirestore();
  const [incoming, outgoing] = await Promise.all([
    getDocs(query(collection(db, 'friendRequests'), where('toUserId', '==', userId))),
    getDocs(query(collection(db, 'friendRequests'), where('fromUserId', '==', userId))),
  ]);

  return {
    incoming: incoming.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item: any) => item.status === 'pending'),
    outgoing: outgoing.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item: any) => item.status === 'pending'),
  };
}

export async function sendFriendRequest(fromUserIdInput: string, targetIdentifier: string) {
  const fromUserId = requireUserId(fromUserIdInput);
  const [fromUser, targetUser] = await Promise.all([
    getUser(fromUserId),
    findUserByIdOrCode(targetIdentifier),
  ]);
  const toUserId = normalizeUserId(targetUser.userId);
  if (fromUserId === toUserId) throw new Error('나 자신에게는 친구 요청을 보낼 수 없습니다.');

  const existingFriend = await getDoc(friendDoc(fromUserId, toUserId));
  if (existingFriend.exists()) throw new Error('이미 친구입니다.');

  const db = getBackendFirestore();
  const id = requestId(fromUserId, toUserId);
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'friendRequests', id),
    {
      id,
      fromUserId,
      fromNickname: fromUser.nickname,
      fromFriendCode: fromUser.friendCode,
      fromWorkspaceId: fromUser.workspaceId,
      toUserId,
      toNickname: targetUser.nickname,
      toFriendCode: targetUser.friendCode,
      toWorkspaceId: targetUser.workspaceId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  return { id, toUser: targetUser, status: 'pending' };
}

export async function respondFriendRequest(requestIdInput: string, userIdInput: string, action: 'accept' | 'reject') {
  const userId = requireUserId(userIdInput);
  const db = getBackendFirestore();
  const targetRef = doc(db, 'friendRequests', requestIdInput);
  const snapshot = await getDoc(targetRef);
  if (!snapshot.exists()) throw new Error('친구 요청을 찾지 못했습니다.');

  const request = snapshot.data() as any;
  if (request.toUserId !== userId) throw new Error('이 요청을 처리할 권한이 없습니다.');
  if (request.status !== 'pending') throw new Error('이미 처리된 요청입니다.');

  const now = new Date().toISOString();
  if (action === 'reject') {
    await updateDoc(targetRef, { status: 'rejected', respondedAt: now, updatedAt: now });
    return { id: requestIdInput, status: 'rejected' };
  }

  const batch = writeBatch(db);
  batch.set(friendDoc(request.toUserId, request.fromUserId), {
    userId: request.fromUserId,
    nickname: request.fromNickname,
    friendCode: request.fromFriendCode,
    workspaceId: request.fromWorkspaceId || '',
    status: 'accepted',
    createdAt: now,
  });
  batch.set(friendDoc(request.fromUserId, request.toUserId), {
    userId: request.toUserId,
    nickname: request.toNickname,
    friendCode: request.toFriendCode,
    workspaceId: request.toWorkspaceId || '',
    status: 'accepted',
    createdAt: now,
  });
  batch.update(targetRef, { status: 'accepted', respondedAt: now, updatedAt: now });
  await batch.commit();

  return { id: requestIdInput, status: 'accepted' };
}

export async function deleteFriend(userIdInput: string, friendUserIdInput: string) {
  const userId = requireUserId(userIdInput);
  const friendUserId = requireUserId(friendUserIdInput);
  const [removedSharedItineraries] = await Promise.all([
    deleteItinerarySharesFromInbox(userId, friendUserId),
    deleteDoc(friendDoc(userId, friendUserId)),
    deleteDoc(friendDoc(friendUserId, userId)),
  ]);
  return { deleted: true, removedSharedItineraries };
}

export async function shareWithFriends(input: {
  ownerUserId: string;
  sharedWithUserIds: string[];
  type: string;
  targetId: string;
  title: string;
  payload: unknown;
  permission?: string;
}) {
  const ownerUserId = requireUserId(input.ownerUserId);
  const owner = await getUser(ownerUserId);
  const sharedWithUserIds = Array.from(new Set((input.sharedWithUserIds || []).map(requireUserId))).filter(
    (item) => item !== ownerUserId
  );
  if (!sharedWithUserIds.length) throw new Error('공유할 친구를 선택해 주세요.');

  const db = getBackendFirestore();
  const now = new Date().toISOString();
  const shareRef = doc(collection(db, 'sharedItems'));
  const share = {
    id: shareRef.id,
    type: input.type,
    targetId: String(input.targetId || ''),
    title: String(input.title || '공유 항목'),
    ownerUserId,
    ownerNickname: owner.nickname,
    sharedWithUserIds,
    permission: input.permission || 'view',
    payload: input.payload || null,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(shareRef, share);
  sharedWithUserIds.forEach((friendUserId) => {
    batch.set(doc(db, 'users', friendUserId, 'shareInbox', shareRef.id), share);
  });
  batch.set(doc(db, 'users', ownerUserId), { sharedItemIds: arrayUnion(shareRef.id), updatedAt: now }, { merge: true });
  await batch.commit();

  if (share.type === 'itinerary') {
    sendItinerarySharePushNotifications({
      ownerNickname: share.ownerNickname,
      recipientUserIds: sharedWithUserIds,
      shareId: share.id,
      title: share.title,
    }).catch((error) => {
      console.warn('Failed to send itinerary share push notification', error);
    });
  }

  return share;
}

export async function getShareInbox(userIdInput: string) {
  const userId = requireUserId(userIdInput);
  const snapshot = await getDocs(collection(getBackendFirestore(), 'users', userId, 'shareInbox'));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getFriendsPublicCollections(userIdInput: string) {
  const userId = requireUserId(userIdInput);
  const db = getBackendFirestore();
  const friends = await getFriendHub(userId);

  const publicCollections = await Promise.all(
    friends.map(async (friend: any) => {
      let workspaceId = friend.workspaceId || '';
      let ownerNickname = friend.nickname || friend.userId;

      if (!workspaceId) {
        try {
          const profile = await getUser(friend.userId);
          workspaceId = profile.workspaceId;
          ownerNickname = profile.nickname || ownerNickname;
        } catch {
          return [];
        }
      }

      if (!workspaceId) return [];

      const snapshot = await getDocs(collection(db, 'workspaces', workspaceId, 'collections'));
      return snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item: any) => item.visibility === 'friends' || item.isPublicToFriends === true)
        .map((item: any) => ({
          ...item,
          ownerUserId: friend.userId,
          ownerNickname,
          ownerWorkspaceId: workspaceId,
        }));
    })
  );

  return publicCollections
    .flat()
    .sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
}
