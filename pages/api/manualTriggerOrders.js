// pages/api/manualTriggerOrders.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  const post_id = req.query.post_id;
  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`
    );
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到留言', raw: commentData });
    }

    let successCount = 0;
    let skipCount = 0;

    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from || from.id === PAGE_ID) {
        skipCount++;
        continue;
      }

      const payload = {
        message,
        from_id: from.id,
        from_name: from.name,
        comment_id,
        post_id,
        created_time,
      };

      const saveRes = await fetch(`${req.headers.origin}/api/saveVisitorOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const saveResult = await saveRes.json();
      if (saveResult.success) {
        successCount++;
      } else {
        skipCount++;
      }
    }

    return res.status(200).json({ success: true, saved: successCount, skipped: skipCount });
  } catch (err) {
    return res.status(500).json({ error: '执行错误', detail: err.message });
  }
}
