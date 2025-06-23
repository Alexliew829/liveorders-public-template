import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('验证失败');
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 GET 或 POST 请求' });
  }

  try {
    const body = req.body;
    console.log('📩 Webhook 收到内容：', JSON.stringify(body, null, 2));

    const entries = body.entry || [];
    let success = 0, skipped = 0;

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;
        const comment = value.comment;
        if (!comment) {
          skipped++;
          continue;
        }

        const { id: comment_id, message = '', created_time, from, post_id } = comment;

        if (!from || from.id === PAGE_ID) {
          skipped++;
          continue;
        }

        const user_id = from?.id || '';
        const user_name = from?.name || '匿名用户';
        const safe_from = { id: user_id, name: user_name };

        // 写入调试记录
        await db.collection('debug_comments').doc(comment_id).set({
          comment_id,
          message,
          from: safe_from,
          created_time,
          post_id
        });

        // 标准化留言
        const normalized = message.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const match = normalized.match(/^([AB])0*(\d{1,3})$/);
        if (!match) {
          skipped++;
          continue;
        }

        const category = match[1];
        const number = match[2].padStart(3, '0');
        const selling_id = category + number;

        // 检查商品是否存在
        const productRef = db.collection('live_products').doc(selling_id);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
          skipped++;
          continue;
        }
        const product = productSnap.data();

        // B 类只允许一人下单
        if (product.category === 'B') {
          const existing = await db.collection('triggered_comments')
            .where('selling_id', '==', selling_id)
            .limit(1)
            .get();
          if (!existing.empty) {
            skipped++;
            continue;
          }
        }

        // 写入 triggered_comments（使用 comment_id 去重）
        await db.collection('triggered_comments').doc(comment_id).set({
          user_id,
          user_name,
          from: safe_from,
          comment_id,
          post_id,
          created_time,
          selling_id,
          category,
          product_name: product.product_name,
          price: product.price,
          price_fmt: product.price_fmt,
          status: 'pending',
          replied: false,
          sent_at: ''
        });

        success++;
      }
    }

    return res.status(200).json({ message: '留言识别完成', success, skipped });
  } catch (err) {
    console.error('❌ Webhook 错误：', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
