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
  const isDebug = req.query.debug !== undefined;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    const commentsRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from&limit=100`);
    const commentsData = await commentsRes.json();
    const comments = commentsData?.data || [];

    let added = 0;
    for (const c of comments) {
      if (!c.message || c.from?.id !== PAGE_ID) continue;

      const match = c.message.match(/([AB]\s*\d{1,3})[\s\-~_]*([^\sRMrm]+)[^\d]*(RM|rm)?\s*(\d+[\d,.]*)/);
      if (!match) continue;

      const selling_id = match[1].replace(/\s+/g, '').toUpperCase();
      const product_name = match[2].trim();
      const price = parseFloat(match[4].replace(/,/g, ''));
      const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      await db.collection('live_products').doc(selling_id).set({
        post_id,
        selling_id,
        product_name,
        price,
        price_fmt,
        updated_at: new Date().toISOString()
      }, { merge: true });

      added++;
    }

    return res.status(200).json({ message: '记录商品完成', added, post_id });
  } catch (err) {
    console.error('[记录商品失败]', err);
    return res.status(500).json({ error: '记录商品失败', detail: err.message });
  }
}
