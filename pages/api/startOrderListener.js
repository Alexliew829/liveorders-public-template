// pages/api/startOrderListener.js

export default async function handler(req, res) {
  const pageId = process.env.PAGE_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;
  const makeWebhookUrl = process.env.MAKE_ORDER_WEBHOOK_URL; // 👈 你等下设置这个

  try {
    // 抓取最新贴文 ID
    const fbRes = await fetch(`https://graph.facebook.com/${pageId}/posts?access_token=${accessToken}&limit=1`);
    const fbData = await fbRes.json();
    const latestPostId = fbData?.data?.[0]?.id;

    if (!latestPostId) {
      return res.status(500).json({ error: "无法取得最新贴文 ID" });
    }

    // 通知 Make Webhook 启动监听
    const makeRes = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post_id: latestPostId,
        trigger: "start_order_listener",
        time: new Date().toISOString()
      })
    });

    if (!makeRes.ok) {
      return res.status(500).json({ error: "无法触发 Make Webhook" });
    }

    return res.status(200).json({
      message: "✅ 已启动下单监听流程",
      post_id: latestPostId
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
