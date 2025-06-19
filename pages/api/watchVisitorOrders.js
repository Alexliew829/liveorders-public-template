import { initializeApp, cert, getApps } from 'firebase-admin/app';
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
    const postRes = await fetch(`https://graph.facebook.com/${process.env.PAGE_ID}/posts?access_token=${process.env.FB_ACCESS_TOKEN}&limit=1`);
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

    let success = 0, skipped = 0, failed = 0;

    for (const comment of allComments) {
      const { message, from, id: comment_id, created_time } = comment;

      if (!message || !from?.id || from.id === process.env.PAGE_ID) {
        skipped++;
        continue;
      }

      const payload = {
        message,
        from_id: from.id,
        from_name: from.name || '',
        comment_id,
        post_id,
        created_time,
      };

      try {
        const saveRes = await fetch(`${req.headers.origin || 'https://your.vercel.app'}/api/watchVisitorOrders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (saveRes.ok) {
          const result = await saveRes.json().catch(() => ({}));
          if (result.success) success++;
          else skipped++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }
    }

    return res.status(200).json({
      message: '识别下单完成 ✅',
      post_id,
      success,
      skipped,
      failed,
      total: allComments.length
    });
  } catch (err) {
    console.error('[识别留言失败]', err);
    return res.status(500).json({ error: '识别失败', detail: err.message });
  }
}
