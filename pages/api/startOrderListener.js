// pages/api/startOrderListener.js

export default async function handler(req, res) {
  const makeWebhookUrl = process.env.MAKE_WEBHOOK_URL;
  const pageId = process.env.PAGE_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;

  // 马来西亚时间：UTC+8
  const now = new Date();
  const hour = now.getUTCHours() + 8;
  const adjustedHour = hour >= 24 ? hour - 24 : hour;

  if (!(adjustedHour >= 20 || adjustedHour < 2)) {
    return res.status(403).json({
      success: false,
      message: "⛔ 当前不在监听时段（每天20:00~02:00）"
    });
  }

  try {
    const fbResponse = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/posts?limit=1&access_token=${accessToken}`
    );
    const fbData = await fbResponse.json();
    const latestPostId = fbData?.data?.[0]?.id;

    if (!latestPostId) {
      return res.status(500).json({
        success: false,
        message: "❌ 无法取得最新贴文 ID"
      });
    }

    const makeResponse = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post_id: latestPostId,
        trigger: "start_order",
        time: new Date().toISOString()
      })
    });

    if (!makeResponse.ok) {
      return res.status(500).json({
        success: false,
        message: "❌ Make Webhook 执行失败"
      });
    }

    return res.status(200).json({
      success: true,
      message: `✅ 已触发自动下单监听，Post ID: ${latestPostId}`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "❌ 系统错误",
      error: error.message
    });
  }
}
