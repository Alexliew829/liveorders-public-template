import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function normalizeSellingId(raw) {
  const match = raw.match(/\b([aAbB])[ \-_.~〜]*0*(\d{1,3})\b/);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2].padStart(3, '0')}`;
}
function extractQuantity(msg) {
  let qty = 1;
  const matches = msg.match(/(?:[+xX*\u00D7\uFF0D\-\u2013])\s*(\d{1,3})/gi);
  if (matches?.length) {
    const nums = matches.map(m => parseInt(m.replace(/[^\d]/g, ''))).filter(n => !isNaN(n));
    if (nums.length > 0) qty = Math.max(...nums);
  }
  return qty;
}
async function fetchAllComments(postId) {
  const all = [];
  let next = `https://graph.facebook.com/${postId}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`;
  while (next) {
    const res = await fetch(next);
    const json = await res.json();
    if (!json?.data?.length) break;
    all.push(...json.data);
    next = json.paging?.next || null;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '只允许 POST 请求' });

  try {
    const configSnap = await db.collection('config').doc('last_post_id').get();
    if (!configSnap.exists) return res.status(400).json({ error: '未设定直播贴文 ID' });

    const post_id = configSnap.data().post_id;
    const force = req.query.force === '1';

    const comments = await fetchAllComments(post_id);
    console.log('共抓到留言：', comments.length);
    if (!comments.length) return res.status(200).json({ message: '⚠️ 没有抓到任何留言，请确认贴文或权限。', added: 0 });

    // ✅ 清空旧记录
    const oldDocs = await db.collection('triggered_comments').listDocuments();
    await Promise.all(oldDocs.map(doc => doc.delete()));
    console.log('✅ 已清空旧留言记录');

    let added = 0, ignored = 0, skipped = 0;
    const log = [];

    for (const c of comments) {
      const { id: comment_id, message, from } = c;
      if (!message || !from || from.id === PAGE_ID) {
        ignored++; log.push({ comment_id, reason: '主页留言或无 from' }); continue;
      }

      const selling_id = normalizeSellingId(message);
      if (!selling_id) {
        skipped++; log.push({ comment_id, user: from.name, reason: '无法识别编号' }); continue;
      }

      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) {
        skipped++; log.push({ comment_id, user: from.name, id: selling_id, reason: '找不到商品' }); continue;
      }

      const prefix = selling_id[0];
      const quantity = extractQuantity(message);
      const user_id = from.id;
      const user_name = from.name || `访客_${comment_id.slice(-4)}`;
      const product = productSnap.data();
      const cleanPrice = typeof product.price === 'string'
        ? parseFloat(product.price.replace(/,/g, '')) : product.price || 0;

      const payload = {
        post_id,
        comment_id,
        message,
        user_id,
        user_name,
        created_at: Date.now(),
        replied: false,
        selling_id,
        product_name: product.product_name || '',
        price: cleanPrice
      };

      if (prefix === 'B') {
        payload.quantity = 1;
        await db.collection('triggered_comments').doc(selling_id).set(payload);
        added++; log.push({ comment_id, user: user_name, id: selling_id, quantity: 1 });
      } else {
        const docId = `${selling_id}_${comment_id}`;
        const stock = product.stock || 0;
        let q = quantity;

        if (!force && stock > 0) {
          const snap = await db.collection('triggered_comments').where('selling_id', '==', selling_id).get();
          let ordered = 0;
          snap.forEach(doc => ordered += parseInt(doc.data().quantity) || 0);
          if (ordered >= stock) {
            skipped++; log.push({ comment_id, user: user_name, id: selling_id, reason: `超出库存（已下单${ordered}）` }); continue;
          }
          if (ordered + q > stock) q = stock - ordered;
        }

        await db.collection('triggered_comments').doc(docId).set({ ...payload, quantity: q });
        added++; log.push({ comment_id, user: user_name, id: selling_id, quantity: q });
      }
    }

    return res.status(200).json({
      message: `✅ 补扫完成，共新增 ${added} 条订单（旧记录已覆盖）`,
      added, skipped, ignored, total: comments.length, log
    });
  } catch (err) {
    console.error('留言补抓失败', err.message);
    return res.status(500).json({ error: '留言补抓失败', details: err.message });
  }
}
