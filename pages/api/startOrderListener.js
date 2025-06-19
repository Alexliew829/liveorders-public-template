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

    // 删除旧的商品资料
    const oldDocs = await db.collection('live_products').get();
    const deletePromises = oldDocs.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);

    // 获取该贴文所有留言
    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from,created_time&limit=100`;

    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    const regex = /(A|B)\s*0*(\d{1,3})[\s\-～_]*([^RrMm\n]+)[^\d]*RM\s*([\d,.]+)/i;
    let count = 0;

    for (const comment of allComments) {
      const { message = '', id: comment_id, created_time } = comment;
      const match = message.match(regex);
      if (!match) continue;

      const category = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = category + number;
      const product_name = match[3].trim();
      const price_raw = parseFloat(match[4].replace(/,/g, ''));
      const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        category,
        product_name,
        price: price_raw,
        price_fmt,
        comment_id,
        post_id,
        created_at: created_time
      });
      count++;
    }

    return res.status(200).json({ message: '记录商品完成', post_id, total: count });
  } catch (err) {
    console.error('[记录商品失败]', err);
    return res.status(500).json({ error: '记录商品失败', detail: err.message });
  }
}
