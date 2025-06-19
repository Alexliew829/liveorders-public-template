import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  const post_id = req.query.post_id;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    if (!post_id) {
      return res.status(400).json({ error: '缺少 post_id 参数' });
    }

    // 删除旧的商品与订单资料
    const oldProducts = await db.collection('live_products').get();
    const oldOrders = await db.collection('orders').get();

    const deleteOps = [];
    oldProducts.forEach(doc => deleteOps.push(doc.ref.delete()));
    oldOrders.forEach(doc => deleteOps.push(doc.ref.delete()));
    await Promise.all(deleteOps);

    // 获取贴文留言
    const comments = [];
    let next = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,created_time&limit=100`;

    while (next) {
      const response = await fetch(next);
      const data = await response.json();
      comments.push(...(data.data || []));
      next = data.paging?.next || null;
    }

    const results = [];

    for (const comment of comments) {
      const msg = comment.message?.trim();
      if (!msg) continue;

      const match = msg.match(/^(A|B)\s*(\d{1,4})[\s-]*(.+?)\s*RM\s*([\d,.]+)/i);
      if (!match) continue;

      const [_, cat, rawId, name, priceStr] = match;
      const category = cat.toUpperCase();
      const selling_id = `${category}${parseInt(rawId, 10)}`;
      const price_raw = parseFloat(priceStr.replace(/,/g, ''));
      const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      const product = {
        selling_id,
        category,
        product_name: name.trim(),
        price: price_raw,
        price_fmt,
        comment_id: comment.id,
        post_id,
        created_at: comment.created_time || Timestamp.now().toDate().toISOString(),
      };

      results.push(product);
      await db.collection('live_products').doc().set(product);
    }

    return res.status(200).json({ success: true, count: results.length });
  } catch (err) {
    console.error('写入商品资料失败:', err);
    return res.status(500).json({ error: '写入失败', detail: err.message });
  }
}
