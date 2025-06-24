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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // 获取已有订单的 post_id
    const oldCommentsSnap = await db.collection('triggered_comments').limit(1).get();
    const oldPostId = oldCommentsSnap.empty ? null : oldCommentsSnap.docs[0].data().post_id;

    // 如果贴文 ID 不一样，清空旧订单
    if (oldPostId && oldPostId !== post_id) {
      const oldOrdersSnap = await db.collection('triggered_comments').get();
      const batch = db.batch();
      oldOrdersSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let success = 0;
    let skipped = 0;

    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || !from || from.id === PAGE_ID) continue;

      // 识别编号（B01、A_65、b 003 等格式）
      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      // 检查商品是否存在
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;

      // 是否已写入
      const existing = await db.collection('triggered_comments').doc(comment_id).get();
      if (existing.exists) {
        skipped++;
        continue;
      }

      // B 类商品只能一个人，检查是否已有
      if (type === 'B') {
        const conflict = await db.collection('triggered_comments')
          .where('selling_id', '==', selling_id)
          .limit(1)
          .get();
        if (!conflict.empty) {
          skipped++;
          continue;
        }
      }

      await db.collection('triggered_comments').doc(comment_id).set({
        user_id: from.id,
        user_name: from.name || null,
        selling_id,
        comment_id,
        post_id,
        created_at: new Date().toISOString(),
        replied: false,
      });

      success++;
    }

    return res.status(200).json({
      message: '订单写入完成',
      success,
      skipped,
    });

  } catch (err) {
    console.error('错误：', err);
    return res.status(500).json({ error: '执行失败', message: err.message });
  }
}
