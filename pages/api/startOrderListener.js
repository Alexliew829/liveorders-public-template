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
  const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
  const postData = await postRes.json();
  const post_id = postData?.data?.[0]?.id;

  if (!post_id) {
    return res.status(404).json({ error: '找不到贴文 ID', raw: postData });
  }

  const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`);
  const commentData = await commentRes.json();
  const comments = commentData?.data || [];

  let saved = 0, skipped = 0;
  for (const comment of comments) {
    const msg = comment.message || '';
    const match = msg.match(/([ABab])\s*0*(\d{1,3})[^\d]*([\u4e00-\u9fa5\w\s-]{1,20})[^\d]*RM\s*([\d,.]+)/i);
    if (!match) {
      skipped++;
      continue;
    }

    const [ , type, number, product_name, priceRaw ] = match;
    const selling_id = `${type.toUpperCase()}${parseInt(number).toString().padStart(3, '0')}`;
    const price = parseFloat(priceRaw.replace(/,/g, ''));
    const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

    await db.collection('live_products').doc(selling_id).set({
      post_id,
      selling_id,
      product_name: product_name.trim(),
      price,
      price_fmt,
      created_time: comment.created_time,
    }, { merge: true }); // ✅ 强制覆盖旧资料

    saved++;
  }

  return res.status(200).json({
    message: '商品资料记录完成',
    post_id,
    saved,
    skipped,
    total: comments.length
  });
}
