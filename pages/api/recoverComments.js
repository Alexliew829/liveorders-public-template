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
  try {
    const video_id = '652662174499621';
    const comments = [];
    let url = `https://graph.facebook.com/${video_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`;

    // 分页抓留言
    while (url) {
      const r = await fetch(url);
      const json = await r.json();
      if (!json?.data) break;

      comments.push(...json.data);
      url = json.paging?.next || null;
    }

    let written = 0;
    for (const c of comments) {
      const { id: comment_id, message, from, created_time } = c;
      if (!message || !from || from.id === PAGE_ID) continue;

      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      const ref = db.collection('triggered_comments').doc(comment_id);
      const snap = await ref.get();
      if (snap.exists) continue;

      await ref.set({
        comment_id,
        message,
        user_id: from.id,
        user_name: from.name || null,
        selling_id,
        created_at: created_time || new Date().toISOString(),
      });
      written++;
    }

    return res.status(200).json({
      message: `✅ 已写入 ${written} 条订单`,
      total_comments: comments.length,
    });

  } catch (err) {
    console.error('抓取失败：', err);
    return res.status(500).json({ error: '留言恢复失败', details: err.message });
  }
}
