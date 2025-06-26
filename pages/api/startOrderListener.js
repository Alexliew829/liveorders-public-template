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
    // Step 1: 清空旧商品资料
    const oldProducts = await db.collection('live_products').get();
    const batch = db.batch();
    oldProducts.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Step 2: 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // Step 3: 获取该贴文下留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    const savedIds = new Set();
    let count = 0;

    for (const comment of comments) {
      const msg = comment.message?.trim() || '';
      const match = msg.match(/(A|B)\s*0*?(\d{1,3})[^\d]*?(.+?)(RM)?\s*([\d,\.]+)/i);
      if (!match) continue;

      const category = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const name = match[3].trim();
      const price_raw = parseFloat(match[5].replace(/,/g, ''));
      if (isNaN(price_raw)) continue;

      const selling_id = `${category}${number}`;
      if (savedIds.has(selling_id)) continue;
      savedIds.add(selling_id);

      await db.collection('live_products').doc(selling_id).set({
        post_id,
        selling_id,
        product_name: `${selling_id} ${name}`,
        price: price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 }),
        price_raw,
        category,
        original_id: match[1] + match[2],
        created_at: new Date()
      });

      count++;
    }

    res.status(200).json({ success: true, message: `✅ 已清空旧商品并写入 ${count} 项`, post_id });
  } catch (err) {
    console.error('[记录商品失败]', err);
    res.status(500).json({ error: '记录失败', detail: err.message });
  }
}
