import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env['firebase-admin-key.json']);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from&limit=100`
    );
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;

    for (const comment of commentData.data) {
      const { message, from } = comment;
      if (!message || from?.id !== PAGE_ID) continue;

      const regex = /[Bb]\s*0*(\d{1,3})\s+(.+?)\s*(?:RM|rm)?\s*([\d,.]+)/;
      const match = message.match(regex);
      if (!match) continue;

      const rawId = match[1];
      let product_name = match[2]?.trim();
      const rawPrice = match[3]?.replace(/,/g, '');

      product_name = product_name.replace(/\s*rm\s*$/i, '').trim();
      product_name = product_name.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 8);

      const selling_id = `B${rawId.padStart(3, '0')}`;
      const price_raw = parseFloat(rawPrice).toFixed(2);
      const price_fmt = parseFloat(rawPrice).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      await db.collection('live_products').add({
        selling_id,
        post_id,
        product_name,
        price_raw,
        price_fmt,
        created_at: new Date()
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
