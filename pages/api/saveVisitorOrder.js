import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const PAGE_ID = process.env.PAGE_ID;
    const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) throw new Error('无法获取贴文 ID');

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;

    for (const c of comments) {
      const message = c.message || '';
      const match = message.match(/\b([ABab])\s?0*(\d{1,3})\b/);
      if (!match) continue;

      const selling_id = `${match[1].toUpperCase()}${match[2].padStart(3, '0')}`;
      const comment_id = c.id;
      const user_id = c.from?.id ?? null;
      const user_name = c.from?.name ?? '';

      const ref = db.collection('triggered_comments').doc(comment_id);
      const exists = await ref.get();
      if (exists.exists) continue;

      // 准备写入资料，避免 undefined
      const data = {
        comment_id,
        post_id,
        selling_id,
        message,
        user_name,
        created_time: new Date().toISOString(),
      };
      if (user_id) {
        data.user_id = user_id;
      }

      await ref.set(data);
      count++;
    }

    return res.status(200).json({ message: '写入完成', total: count });
  } catch (err) {
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
