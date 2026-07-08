import { Router } from 'express';
import {
  deleteFriend,
  getFriendHub,
  getFriendRequests,
  getFriendsPublicCollections,
  getShareInbox,
  respondFriendRequest,
  sendFriendRequest,
  shareWithFriends,
} from '../services/friends.service';

export const friendsRouter = Router();

friendsRouter.get('/friends', async (req, res) => {
  try {
    const friends = await getFriendHub(String(req.query.userId || ''));
    res.json({ friends });
  } catch (error) {
    res.status(400).json({ error: 'FRIENDS_FAILED', message: error instanceof Error ? error.message : '친구 목록을 불러오지 못했습니다.' });
  }
});

friendsRouter.get('/friends/requests', async (req, res) => {
  try {
    const requests = await getFriendRequests(String(req.query.userId || ''));
    res.json(requests);
  } catch (error) {
    res.status(400).json({ error: 'FRIEND_REQUESTS_FAILED', message: error instanceof Error ? error.message : '친구 요청을 불러오지 못했습니다.' });
  }
});

friendsRouter.get('/friends/public-collections', async (req, res) => {
  try {
    const collections = await getFriendsPublicCollections(String(req.query.userId || ''));
    res.json({ collections });
  } catch (error) {
    res.status(400).json({ error: 'PUBLIC_COLLECTIONS_FAILED', message: error instanceof Error ? error.message : '친구 공개 컬렉션을 불러오지 못했습니다.' });
  }
});

friendsRouter.post('/friends/request', async (req, res) => {
  try {
    const request = await sendFriendRequest(String(req.body?.fromUserId || ''), String(req.body?.target || ''));
    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ error: 'FRIEND_REQUEST_FAILED', message: error instanceof Error ? error.message : '친구 요청에 실패했습니다.' });
  }
});

friendsRouter.post('/friends/requests/:id/accept', async (req, res) => {
  try {
    const result = await respondFriendRequest(String(req.params.id), String(req.body?.userId || ''), 'accept');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: 'FRIEND_ACCEPT_FAILED', message: error instanceof Error ? error.message : '친구 요청 수락에 실패했습니다.' });
  }
});

friendsRouter.post('/friends/requests/:id/reject', async (req, res) => {
  try {
    const result = await respondFriendRequest(String(req.params.id), String(req.body?.userId || ''), 'reject');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: 'FRIEND_REJECT_FAILED', message: error instanceof Error ? error.message : '친구 요청 거절에 실패했습니다.' });
  }
});

friendsRouter.delete('/friends/:friendUserId', async (req, res) => {
  try {
    const result = await deleteFriend(String(req.query.userId || req.body?.userId || ''), String(req.params.friendUserId));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: 'FRIEND_DELETE_FAILED', message: error instanceof Error ? error.message : '친구 삭제에 실패했습니다.' });
  }
});

friendsRouter.post('/share', async (req, res) => {
  try {
    const share = await shareWithFriends({
      ownerUserId: String(req.body?.ownerUserId || ''),
      sharedWithUserIds: Array.isArray(req.body?.sharedWithUserIds) ? req.body.sharedWithUserIds : [],
      type: String(req.body?.type || ''),
      targetId: String(req.body?.targetId || ''),
      title: String(req.body?.title || ''),
      payload: req.body?.payload || null,
      permission: String(req.body?.permission || 'view'),
    });
    res.status(201).json({ share });
  } catch (error) {
    res.status(400).json({ error: 'SHARE_FAILED', message: error instanceof Error ? error.message : '친구 공유에 실패했습니다.' });
  }
});

friendsRouter.get('/share/inbox', async (req, res) => {
  try {
    const items = await getShareInbox(String(req.query.userId || ''));
    res.json({ items });
  } catch (error) {
    res.status(400).json({ error: 'SHARE_INBOX_FAILED', message: error instanceof Error ? error.message : '공유함을 불러오지 못했습니다.' });
  }
});
