import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  const post_id = req.query.post_id;

  if (req.method !== 'POST' || !post_id) {
    return res.status(405).json({ error: '只允许 POST 请求，并需传入 post_id' });
  }

  try {
    // 获取直播贴文时间
    const postRes = await fetch(`https://graph.facebook.com/${post_id}?access_token=${PAGE_TOKEN}&fields=created_time`);
    const postData = await postRes.json();
    const postCreated = new Date(postData?.created_time);
    if (!postCreated) {
      return res.status(404).json({ error: '无法获取贴文时间', raw: postData });
    }

    // 获取留言
    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from,created_time&limit=100`;

    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    let success = 0, skipped = 0, failed = 0;

    for (const comment of allComments) {
      const { message, from, id: comment_id, created_time } = comment;

      if (!message || !from?.id || from.id === PAGE_ID) {
        skipped++;
        continue; // 忽略主页留言
      }

      const commentTime = new Date(created_time);
      const hoursDiff = (commentTime - postCreated) / (1000 * 60 * 60);
      if (hoursDiff > 8 || hoursDiff < 0) {
        skipped++;
        continue; // 超过 8 小时
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
        const saveRes = await fetch(`${req.headers.origin || 'https://your.vercel.app'}/api/saveOrder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
      message: '识别完成 ✅',
      success,
      skipped,
      failed,
      total: allComments.length,
    });
  } catch (err) {
    console.error('[识别留言失败]', err);
    return res.status(500).json({ error: '识别失败', detail: err.message });
  }
}
