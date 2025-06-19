import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const data = req.body;

    // 支持 Make.com 格式或 Facebook 格式
    const entry = data.entry?.[0];
    const change = entry?.changes?.[0];
    const comment = change?.value?.message || data.message;
    const from = change?.value?.from || data.from;
    const post_id = change?.value?.post_id || data.post_id;
    const comment_id = change?.value?.comment_id || data.comment_id;

    if (!comment || !from || !post_id || !comment_id) {
      return res.status(400).json({ error: '字段不完整', raw: data });
    }

    const docRef = db.collection('triggered_comments').doc(comment_id);
    await docRef.set({
      comment_id,
      post_id,
      user_id: from.id || '',
      user_name: from.name || '',
      message: comment,
      created_at: new Date().toISOString()
    });

    return res.status(200).json({ success: true, comment_id });
  } catch (err) {
    console.error('写入失败:', err);
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
