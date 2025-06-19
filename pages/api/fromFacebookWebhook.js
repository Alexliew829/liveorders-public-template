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
  // Webhook 验证（GET）
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

  // 留言处理（POST）
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

        const { id: comment_id, message, created_time, from, post_id } = comment;

        // 忽略主页自己留言
        if (!from || from.id === PAGE_ID) {
          skipped++;
          continue;
        }

        // 写入 debug_comments 方便调试
        await db.collection('debug_comments').add({
          comment_id,
          message,
          from,
          created_time,
          post_id
        });

        // 检查是否 A 或 B 编号（支持 A1、B01、B 88、a001）
        const matched = message?.toUpperCase().match(/([AB])\s*\d{1,3}/);
        if (!matched) {
          skipped++;
          continue;
        }

        const rawType = matched[1]; // A 或 B
        const selling_id = rawType + matched[0].replace(/\D/g, '').padStart(3, '0');
        const category = rawType;

        await db.collection('triggered_comments').add({
          comment_id,
          created_at: created_time,
          from,
          post_id,
          selling_id,
          status: 'pending',
          replied: false,
          sent_at: '',
          product_name: '',
          price: 0,
          price_fmt: '',
          user_id: from.id || '',
          user_name: from.name || '',
          category
        });

        success++;
      }
    }

    return res.status(200).json({ message: '识别完成', success, skipped });
  } catch (err) {
    console.error('❌ Webhook 错误：', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
