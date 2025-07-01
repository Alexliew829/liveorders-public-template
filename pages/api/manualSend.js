// pages/api/manualSend.js

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  const { comment_id } = req.query;

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    const docRef = db.collection('triggered_comments').doc(comment_id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: '找不到对应留言' });
    }

    const data = snap.data();

    // ✅ 已发送过就不重复发
    if (data.replied || data.status === 'sent') {
      return res.status(200).json({ message: '付款连接已发送，无需重复' });
    }

    const {
      user_name,
      payment_url,
      product_name = '',
      price = '',
      price_fmt,
      selling_id = ''
    } = data;

    if (!payment_url || typeof payment_url !== 'string' || !payment_url.startsWith('http')) {
      return res.status(400).json({ error: '付款链接格式无效，无法发送' });
    }

    // ✅ 自动格式化价格（如果没有 price_fmt）
    const priceDisplay = price_fmt || (typeof price === 'number'
      ? `RM${price.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
      : price);

    // ✅ 简单去除 user_name 中异常符号（避免 Facebook 无法 tag）
    const mentionName = user_name?.replace(/[^\w\s\u4e00-\u9fa5]/g, '');
    const replyMessage = [
      user_name ? `感谢下单 @${mentionName} 🙏` : `感谢您的下单 🙏`,
      `${selling_id} ${product_name} ${priceDisplay}`,
      `付款连接：${payment_url}`,
      `⚠️ 请在 60 分钟内完成付款，逾期将取消订单 ⚠️`
    ].join('\n');

    const replyRes = await fetch(
      `https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyMessage })
      }
    );

    const replyData = await replyRes.json();

    if (!replyRes.ok) {
      return res.status(500).json({ error: 'Facebook 回复失败', detail: replyData });
    }

    await docRef.update({
      replied: true,
      status: 'sent',
      sent_at: Timestamp.now()
    });

    return res.status(200).json({
      success: true,
      message: '付款连接已发送',
      comment_id,
      reply_id: replyData.id
    });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
