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

    const commentsRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message&limit=100`);
    const commentsData = await commentsRes.json();
    const allComments = commentsData?.data || [];

    // 删除旧商品与旧订单
    const batch = db.batch();

    const liveProducts = await db.collection('live_products').get();
    liveProducts.forEach(doc => batch.delete(doc.ref));

    const orders = await db.collection('orders').get();
    orders.forEach(doc => batch.delete(doc.ref));

    await batch.commit();

    let count = 0;
    const added = [];

    for (const c of allComments) {
      const message = c.message || '';
      const match = message.match(/([AB]\s*\d{1,3})\s+(.+)\s+RM\s*(\d+[,.]?\d*)/i);

      if (!match) continue;

      const [, rawId, product_name, priceRaw] = match;
      const selling_id = rawId.toUpperCase().replace(/\s+/g, '');
      const category = selling_id.startsWith('A') ? 'A' : 'B';
      const price = parseFloat(priceRaw.toString().replace(/,/g, ''));
      const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      await db.collection('live_products').add({
        selling_id,
        category,
        product_name,
        price,
        price_fmt,
        comment_id: c.id,
        post_id,
        created_at: new Date().toISOString(),
      });

      added.push(selling_id);
      count++;
    }

    return res.status(200).json({ success: true, count, added });
  } catch (err) {
    console.error('[记录商品失败]', err);
    return res.status(500).json({ error: '记录商品失败', detail: err.message });
  }
}
