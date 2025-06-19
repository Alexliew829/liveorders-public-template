import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  // Step 1: Facebook Webhook 验证（GET 请求）
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('验证失败');
    }
  }

  // Step 2: 接收留言（POST 请求）
  if (req.method === 'POST') {
    try {
      const body = req.body;

      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const comment = changes?.value;

      const message = comment?.message;
      const comment_id = comment?.comment_id;
      const post_id = comment?.post_id;
      const from = comment?.from;
      const created_time = comment?.created_time;

      if (!message || !comment_id || !post_id || !from) {
        return res.status(200).json({ status: '跳过无效留言' });
      }

      // 忽略主页自己留言
      if (from.id === PAGE_ID) {
        return res.status(200).json({ status: '跳过主页留言' });
      }

      const cleanMsg = message.toUpperCase().replace(/\s+/g, '');
      const match = cleanMsg.match(/\b(B\d{1,3})\b/);

      const selling_id = match ? `B${match[1].replace('B', '').padStart(3, '0')}` : '';
      const docId = `${comment_id}_${post_id}`;

      await db.collection('triggered_comments').doc(docId).set({
        comment_id,
        post_id,
        user_id: from.id,
        user_name: from.name || '',
        selling_id,
        message,
        created_time,
        replied: false,
        category: selling_id ? 'B' : '',
        price: 0,
        price_fmt: '',
        product_name: '',
      });

      return res.status(200).json({ status: '写入成功', selling_id });
    } catch (err) {
      console.error('Webhook处理失败:', err);
      return res.status(500).json({ error: '内部错误', detail: err.message });
    }
  }

  return res.status(405).json({ error: '方法不允许' });
}
