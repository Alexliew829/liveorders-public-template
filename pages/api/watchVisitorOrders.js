import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${process.env.FB_ACCESS_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${process.env.FB_ACCESS_TOKEN}&fields=id,message,from,created_time&limit=100`;

    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    // 删除旧留言记录
    const oldComments = await db.collection('triggered_comments').where('post_id', '==', post_id).get();
    const batch = db.batch();
    oldComments.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    let success = 0,
      skipped = 0,
      failed = 0;

    for (const comment of allComments) {
      const { message, from, id: comment_id, created_time } = comment;

      if (!message || !from || from.id === PAGE_ID) {
        skipped++;
        continue;
      }

      const cleanMessage = message.toUpperCase().replace(/\s+/g, '');
      const match = cleanMessage.match(/\bB(\d{1,3})\b/);

      if (!match) {
        skipped++;
        continue;
      }

      const selling_id = `B${match[1].padStart(3, '0')}`; // 标准格式为 B+三位数字

      try {
        await db.collection('triggered_comments').doc(selling_id).set({
          comment_id,
          post_id,
          user_id: from.id || '',
          user_name: from.name || '',
          selling_id,
          category: 'B',
          product_name: '',
          price: 0,
          price_fmt: '',
          created_time,
          replied: false,
        });

        success++;
      } catch (err) {
        console.error('❌ 写入失败:', err);
        failed++;
      }
    }

    return res.status(200).json({
      message: '识别完成',
      post_id,
      success,
      skipped,
      failed,
      total: allComments.length,
    });
  } catch (err) {
    console.error('识别留言失败:', err);
    return res.status(500).json({ error: '识别失败', detail: err.message });
  }
}
