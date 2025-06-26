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
    // Step 1: 清空旧留言
    const old = await db.collection('triggered_comments').get();
    const batch = db.batch();
    old.docs.forEach(doc => batch.delete(doc.ref));
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

    let count = 0;
    for (const comment of comments) {
      const msg = comment.message?.trim() || '';
      const matched = msg.match(/^(A|B)\s*(\d{1,3})\D+(.+?)RM\s*([\d,\.]+)/i);
      if (!matched) continue;

      const category = matched[1].toUpperCase();
      const num = matched[2].padStart(3, '0');
      const name = matched[3].trim();
      const price_raw = parseFloat(matched[4].replace(/,/g, ''));
      const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      await db.collection('live_products').doc(`${category}${num}`).set({
        post_id,
        selling_id: `${category}${num}`,
        product_name: `${category}${num} ${name}`,
        price: price_fmt,
        price_raw,
        category,
        created_at: new Date()
      });
      count++;
    }

    res.status(200).json({ success: true, message: `已清空旧留言并记录 ${count} 项商品`, post_id });
  } catch (err) {
    console.error('[记录商品失败]', err);
    res.status(500).json({ error: '记录失败', detail: err.message });
  }
}
